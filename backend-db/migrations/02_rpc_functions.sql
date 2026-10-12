-- ============================================================================
-- 02_RPC_FUNCTIONS.SQL
-- Funciones Almacenadas Transaccionales y de Contingencia
-- XIX Simposio de Ingeniería
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. REGISTRO ATÓMICO EN PUERTA (Dev 3 - PWA Móvil)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.registrar_checkin_atomico(
    p_carnet VARCHAR,
    p_dia INT,
    p_puerta VARCHAR,
    p_staff_id VARCHAR
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_nombre VARCHAR;
    v_tickets_disponibles INT;
    v_hora_anterior TIMESTAMP WITH TIME ZONE;
    v_puerta_anterior VARCHAR;
BEGIN
    -- 1. Validar existencia en el padrón oficial
    SELECT nombre_oficial INTO v_nombre
    FROM public.padron_estudiantes 
    WHERE carnet = p_carnet;

    IF v_nombre IS NULL THEN
        RETURN jsonb_build_object(
            'status', 'ERROR',
            'code', 'QR_NO_ENCONTRADO',
            'mensaje', 'Estudiante no registrado en padrón. Derivar a Mesa de Resolución.'
        );
    END IF;

    -- 2. Bloqueo transaccional de fila para evitar condiciones de carrera (Race Conditions)
    SELECT (tickets_totales - tickets_entregados) INTO v_tickets_disponibles
    FROM public.inventario_tickets
    WHERE dia = p_dia
    FOR UPDATE;

    IF v_tickets_disponibles IS NULL THEN
        RETURN jsonb_build_object(
            'status', 'ERROR',
            'code', 'DIA_INVALIDO',
            'mensaje', 'El día operativo especificado no está configurado.'
        );
    END IF;

    IF v_tickets_disponibles <= 0 THEN
        RETURN jsonb_build_object(
            'status', 'ERROR',
            'code', 'TICKETS_AGOTADOS',
            'mensaje', 'Inventario de tickets físicos agotado para este día.'
        );
    END IF;

    -- 3. Validar si ya cuenta con asistencia hoy
    SELECT hora_checkin, puerta INTO v_hora_anterior, v_puerta_anterior
    FROM public.checkins_asistencia 
    WHERE carnet = p_carnet AND dia = p_dia;

    IF v_hora_anterior IS NOT NULL THEN
        RETURN jsonb_build_object(
            'status', 'ALERTA',
            'code', 'YA_INGRESADO',
            'mensaje', '¡Alerta! QR ya utilizado hoy a las ' || to_char(v_hora_anterior, 'HH24:MI:SS') || ' en ' || v_puerta_anterior
        );
    END IF;

    -- 4. Inserción y descuento atómico de inventario
    INSERT INTO public.checkins_asistencia (carnet, dia, puerta, staff_id)
    VALUES (p_carnet, p_dia, p_puerta, p_staff_id);

    UPDATE public.inventario_tickets
    SET tickets_entregados = tickets_entregados + 1
    WHERE dia = p_dia;

    RETURN jsonb_build_object(
        'status', 'OK',
        'code', 'ACCESO_CONCEDIDO',
        'carnet', p_carnet,
        'nombre', v_nombre,
        'tickets_restantes', (v_tickets_disponibles - 1),
        'mensaje', 'Acceso autorizado. Entregar 1 ticket físico.'
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- 2. SINCRONIZACIÓN OFFLINE POR LOTES (Dev 4 - PWA Offline)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sincronizar_checkins_offline(
    p_checkins JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_item RECORD;
    v_insertados INT := 0;
    v_duplicados INT := 0;
    v_invalidos INT := 0;
    v_puerta_normalizada VARCHAR(20);
    v_hora_real TIMESTAMP WITH TIME ZONE;
    v_estudiante_existe BOOLEAN;
BEGIN
    FOR v_item IN 
        SELECT * 
        FROM jsonb_to_recordset(p_checkins) AS x(
            carnet VARCHAR,
            dia INT,
            puerta VARCHAR,
            staff_id VARCHAR,
            hora_checkin TIMESTAMP WITH TIME ZONE
        )
        ORDER BY hora_checkin ASC
    LOOP
        -- Normalizar puerta (ej: "3" -> "Puerta 3")
        IF v_item.puerta ~ '^[0-9]+$' THEN
            v_puerta_normalizada := 'Puerta ' || v_item.puerta;
        ELSE
            v_puerta_normalizada := COALESCE(v_item.puerta, 'Puerta Desconocida');
        END IF;

        -- Priorizar marca temporal local de escaneo
        v_hora_real := COALESCE(v_item.hora_checkin, NOW());

        -- Validar carné en padrón para no abortar por Foreign Key
        SELECT EXISTS (
            SELECT 1 FROM public.padron_estudiantes WHERE carnet = v_item.carnet
        ) INTO v_estudiante_existe;

        IF NOT v_estudiante_existe THEN
            v_invalidos := v_invalidos + 1;
            CONTINUE;
        END IF;

        -- Inserción segura con bloqueo de duplicados
        INSERT INTO public.checkins_asistencia (
            carnet, 
            dia, 
            puerta, 
            staff_id, 
            hora_checkin
        )
        VALUES (
            v_item.carnet, 
            v_item.dia, 
            v_puerta_normalizada, 
            COALESCE(v_item.staff_id, 'staff_offline'), 
            v_hora_real
        )
        ON CONFLICT (carnet, dia) DO NOTHING;

        IF FOUND THEN
            UPDATE public.inventario_tickets
            SET tickets_entregados = tickets_entregados + 1
            WHERE dia = v_item.dia;
            
            v_insertados := v_insertados + 1;
        ELSE
            v_duplicados := v_duplicados + 1;
        END IF;

    END LOOP;

    RETURN jsonb_build_object(
        'status', 'OK',
        'insertados', v_insertados,
        'duplicados_rechazados', v_duplicados,
        'invalidos', v_invalidos
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. RESOLUCIÓN DE EXCEPCIONES: PORTAL ZONA AMARILLA (Dev 4 - Web)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolver_excepcion_estudiante(
    p_carnet VARCHAR,
    p_boleta VARCHAR
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_nombre VARCHAR;
    v_correo VARCHAR;
    v_datos_extra JSONB;
    v_boleta_existe BOOLEAN;
    v_es_candidato_valido BOOLEAN;
    v_token_qr VARCHAR;
BEGIN
    -- 1. Verificar carné en padrón oficial
    SELECT nombre_oficial, correo_institucional 
    INTO v_nombre, v_correo
    FROM public.padron_estudiantes
    WHERE carnet = p_carnet;

    IF v_nombre IS NULL THEN
        RETURN jsonb_build_object(
            'status', 'ERROR',
            'mensaje', 'El carné no figura en el padrón oficial de la facultad.'
        );
    END IF;

    -- 2. Obtener boleta en Zona Amarilla sin conciliar
    SELECT datos_extra 
    INTO v_datos_extra
    FROM public.tesoreria_pagos 
    WHERE boleta = p_boleta 
      AND zona = 'AMARILLA' 
      AND carnet_asignado IS NULL;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'status', 'ERROR',
            'mensaje', 'La boleta no existe en revisión, ya fue vinculada o requiere atención en Mesa de Resolución.'
        );
    END IF;

    -- 3. Validar si el carné ingresado está en la lista de candidatos que dejó el pipeline
    -- Si el pipeline guardó un arreglo "candidatos", el carné DEBE estar dentro
    IF v_datos_extra ? 'candidatos' THEN
        SELECT EXISTS (
            SELECT 1 
            FROM jsonb_array_elements(v_datos_extra->'candidatos') c 
            WHERE c->>'carnet' = p_carnet
        ) INTO v_es_candidato_valido;
        
        IF NOT v_es_candidato_valido THEN
            RETURN jsonb_build_object(
                'status', 'ERROR',
                'mensaje', 'El carné no coincide con los candidatos registrados para este pago. Acuda a la Mesa de Resolución el día del evento.'
            );
        END IF;
    END IF;

    -- 4. Construir payload o token para el QR
    v_token_qr := 'SIMP26-' || p_carnet;

    -- 5. Promover a Zona VERDE y CONCILIADO
    UPDATE public.tesoreria_pagos
    SET carnet_asignado = p_carnet,
        zona = 'VERDE',
        estado = 'CONCILIADO',
        datos_extra = v_datos_extra || jsonb_build_object(
            'resuelto_en_portal', true,
            'zona_origen', 'AMARILLA',
            'fecha_resolucion', NOW(),
            'qr_habilitado', true
        )
    WHERE boleta = p_boleta;

    -- 6. Retornar datos al portal web para renderizar el QR en pantalla
    RETURN jsonb_build_object(
        'status', 'OK',
        'mensaje', 'Identidad confirmada exitosamente. Tu acceso ha sido habilitado.',
        'carnet', p_carnet,
        'nombre', v_nombre,
        'correo', v_correo,
        'qr_data', v_token_qr
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. CONTINGENCIA PRESENCIAL: MESA DE RESOLUCIÓN (Dev 5 - Laptop)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolver_checkin_manual(
    p_carnet VARCHAR,
    p_boleta VARCHAR,
    p_dia INT,
    p_operador VARCHAR,
    p_justificacion TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_nombre VARCHAR;
    v_tickets_disponibles INT;
    v_ya_ingreso BOOLEAN;
BEGIN
    SELECT nombre_oficial INTO v_nombre 
    FROM public.padron_estudiantes WHERE carnet = p_carnet;

    IF v_nombre IS NULL THEN
        RETURN jsonb_build_object('status', 'ERROR', 'mensaje', 'Carnet no encontrado en padrón.');
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM public.checkins_asistencia WHERE carnet = p_carnet AND dia = p_dia
    ) INTO v_ya_ingreso;

    IF v_ya_ingreso THEN
        RETURN jsonb_build_object('status', 'ALERTA', 'mensaje', 'El estudiante ya tiene asistencia registrada para este día.');
    END IF;

    SELECT (tickets_totales - tickets_entregados) INTO v_tickets_disponibles
    FROM public.inventario_tickets WHERE dia = p_dia FOR UPDATE;

    IF v_tickets_disponibles <= 0 THEN
        RETURN jsonb_build_object('status', 'ERROR', 'mensaje', 'Inventario de tickets agotado.');
    END IF;

    INSERT INTO public.checkins_asistencia (carnet, dia, puerta, staff_id)
    VALUES (p_carnet, p_dia, 'Mesa Resolucion', p_operador);

    UPDATE public.inventario_tickets
    SET tickets_entregados = tickets_entregados + 1
    WHERE dia = p_dia;

    IF p_boleta IS NOT NULL THEN
        UPDATE public.tesoreria_pagos
        SET estado = 'RESUELTO_MANUAL',
            carnet_asignado = p_carnet,
            datos_extra = datos_extra || jsonb_build_object('justificacion', p_justificacion, 'operador', p_operador)
        WHERE boleta = p_boleta;
    END IF;

    RETURN jsonb_build_object(
        'status', 'OK',
        'mensaje', 'Ingreso manual y entrega de ticket autorizada para ' || v_nombre
    );
END;
$$;
