-- ============================================================================
-- 02_RPC_FUNCTIONS.SQL
-- Procedimientos Almacenados Transaccionales Atómicos (SECURITY DEFINER)
-- XIX Simposio de Ingeniería - Dev 2
-- ============================================================================

-- 1. Check-in Atómico en Puertas (Dev 3 y Dev 4)
-- Con bloqueo FOR UPDATE contra condiciones de carrera y soporte dual para token o carné
DROP FUNCTION IF EXISTS public.registrar_checkin_atomico(character varying, integer, character varying, character varying);

CREATE OR REPLACE FUNCTION public.registrar_checkin_atomico(
    p_token_o_carnet VARCHAR,
    p_dia INT,
    p_puerta VARCHAR,
    p_staff_id VARCHAR
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_carnet VARCHAR;
    v_nombre VARCHAR;
    v_tickets_disponibles INT;
    v_hora_anterior TIMESTAMP WITH TIME ZONE;
    v_puerta_anterior VARCHAR;
BEGIN
    -- 1. Identificar al estudiante por token QR o carné directo
    SELECT p.carnet, p.nombre_oficial
    INTO v_carnet, v_nombre
    FROM public.padron_estudiantes p
    LEFT JOIN public.credenciales_qr c ON p.carnet = c.carnet
    WHERE c.token_qr = p_token_o_carnet OR p.carnet = p_token_o_carnet;

    IF v_nombre IS NULL THEN
        RETURN jsonb_build_object(
            'status', 'ERROR',
            'code', 'QR_NO_ENCONTRADO',
            'mensaje', 'Credencial no registrada o no habilitada. Derivar a Mesa de Resolución.'
        );
    END IF;

    -- 2. Bloquear lote de inventario diario con FOR UPDATE
    SELECT (tickets_totales - tickets_entregados)
    INTO v_tickets_disponibles
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

    -- 3. Validar duplicidad de ingreso en la jornada
    SELECT hora_checkin, puerta
    INTO v_hora_anterior, v_puerta_anterior
    FROM public.checkins_asistencia 
    WHERE carnet = v_carnet AND dia = p_dia;

    IF v_hora_anterior IS NOT NULL THEN
        RETURN jsonb_build_object(
            'status', 'ALERTA',
            'code', 'YA_INGRESADO',
            'mensaje', '¡Alerta! QR ya utilizado hoy a las ' || to_char(v_hora_anterior, 'HH24:MI:SS') || ' en ' || v_puerta_anterior
        );
    END IF;

    -- 4. Inserción de asistencia y descuento del ticket físico
    INSERT INTO public.checkins_asistencia (carnet, dia, puerta, staff_id)
    VALUES (v_carnet, p_dia, p_puerta, p_staff_id);

    UPDATE public.inventario_tickets
    SET tickets_entregados = tickets_entregados + 1
    WHERE dia = p_dia;

    RETURN jsonb_build_object(
        'status', 'OK',
        'code', 'ACCESO_CONCEDIDO',
        'carnet', v_carnet,
        'nombre', v_nombre,
        'tickets_restantes', (v_tickets_disponibles - 1),
        'mensaje', 'Acceso autorizado. Entregar 1 ticket físico.'
    );
END;
$$;

-- ----------------------------------------------------------------------------

-- 2. Sincronización de Lotes Offline (Dev 4)
-- Respeta la marca de tiempo del cliente, normaliza puertas y tolera carnés inválidos
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
        -- Normalizar puerta
        IF v_item.puerta ~ '^[0-9]+$' THEN
            v_puerta_normalizada := 'Puerta ' || v_item.puerta;
        ELSE
            v_puerta_normalizada := COALESCE(v_item.puerta, 'Puerta Desconocida');
        END IF;

        v_hora_real := COALESCE(v_item.hora_checkin, NOW());

        -- Validar existencia en padrón para no abortar por Foreign Key
        SELECT EXISTS (
            SELECT 1 FROM public.padron_estudiantes WHERE carnet = v_item.carnet
        ) INTO v_estudiante_existe;

        IF NOT v_estudiante_existe THEN
            v_invalidos := v_invalidos + 1;
            CONTINUE;
        END IF;

        -- Inserción segura ignorando duplicados
        INSERT INTO public.checkins_asistencia (carnet, dia, puerta, staff_id, hora_checkin)
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

-- 3. Portal de Autogestión / Desempate de Zona Amarilla (Dev 4)
-- Valida candidatos como objetos JSON e inserta en la tabla privada de QR
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
    v_es_candidato_valido BOOLEAN;
    v_token_qr VARCHAR;
BEGIN
    -- Validar existencia en padrón oficial
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

    -- Validar boleta pendiente en Zona Amarilla
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

    -- Validar que el carné esté en la lista de candidatos estructurados como objetos
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

    -- Generar credencial QR y guardarla en la tabla privada
    v_token_qr := 'SIMP26-' || p_carnet;

    INSERT INTO public.credenciales_qr (carnet, token_qr, boleta_origen)
    VALUES (p_carnet, v_token_qr, p_boleta)
    ON CONFLICT (carnet) DO UPDATE 
    SET token_qr = EXCLUDED.token_qr, 
        boleta_origen = EXCLUDED.boleta_origen;

    -- Actualizar estado contable a VERDE / CONCILIADO
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

-- 4. Mesa de Resolución Presencial / Laptop de Contingencia (Dev 5)
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
    v_token_qr VARCHAR;
BEGIN
    -- 1. Validar que el carné exista en el padrón
    SELECT nombre_oficial INTO v_nombre 
    FROM public.padron_estudiantes 
    WHERE carnet = p_carnet;

    IF v_nombre IS NULL THEN
        RETURN jsonb_build_object(
            'status', 'ERROR', 
            'mensaje', 'Carné no encontrado en el padrón oficial.'
        );
    END IF;

    -- 2. Validar que no haya ingresado previamente en el día solicitado
    SELECT EXISTS (
        SELECT 1 FROM public.checkins_asistencia 
        WHERE carnet = p_carnet AND dia = p_dia
    ) INTO v_ya_ingreso;

    IF v_ya_ingreso THEN
        RETURN jsonb_build_object(
            'status', 'ALERTA', 
            'mensaje', 'El estudiante ya tiene asistencia registrada para este día.'
        );
    END IF;

    -- 3. Bloquear lote de inventario diario (FOR UPDATE)
    SELECT (tickets_totales - tickets_entregados) INTO v_tickets_disponibles
    FROM public.inventario_tickets 
    WHERE dia = p_dia 
    FOR UPDATE;

    IF v_tickets_disponibles IS NULL THEN
        RETURN jsonb_build_object(
            'status', 'ERROR',
            'mensaje', 'El día operativo especificado no está configurado.'
        );
    END IF;

    IF v_tickets_disponibles <= 0 THEN
        RETURN jsonb_build_object(
            'status', 'ERROR', 
            'mensaje', 'Inventario de tickets agotado para esta jornada.'
        );
    END IF;

    -- 4. Registrar check-in presencial del día en curso y descontar ticket
    INSERT INTO public.checkins_asistencia (carnet, dia, puerta, staff_id)
    VALUES (p_carnet, p_dia, 'Mesa Resolucion', p_operador);

    UPDATE public.inventario_tickets
    SET tickets_entregados = tickets_entregados + 1
    WHERE dia = p_dia;

    -- 5. Generar token y registrar en la tabla privada credenciales_qr
    v_token_qr := 'SIMP26-' || p_carnet;

    INSERT INTO public.credenciales_qr (carnet, token_qr, boleta_origen)
    VALUES (p_carnet, v_token_qr, p_boleta)
    ON CONFLICT (carnet) DO UPDATE 
    SET token_qr = EXCLUDED.token_qr,
        boleta_origen = COALESCE(EXCLUDED.boleta_origen, credenciales_qr.boleta_origen);

    -- 6. Promover boleta a VERDE / CONCILIADO para que Dev 5 despache el correo
    IF p_boleta IS NOT NULL THEN
        UPDATE public.tesoreria_pagos
        SET zona = 'VERDE',
            estado = 'CONCILIADO',
            carnet_asignado = p_carnet,
            datos_extra = COALESCE(datos_extra, '{}'::jsonb) || jsonb_build_object(
                'justificacion', p_justificacion, 
                'operador', p_operador,
                'fecha_resolucion_manual', NOW(),
                'resuelto_en_mesa', true,
                'qr_habilitado', true
            )
        WHERE boleta = p_boleta;
    END IF;

    RETURN jsonb_build_object(
        'status', 'OK',
        'mensaje', 'Ingreso manual autorizado y ticket físico entregado a ' || v_nombre || '. Credencial QR habilitada para el Día 2.',
        'carnet', p_carnet,
        'nombre', v_nombre,
        'qr_data', v_token_qr
    );
END;
$$;
