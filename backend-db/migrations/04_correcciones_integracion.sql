-- ============================================================================
-- 04_CORRECCIONES_INTEGRACION.SQL
-- Ajustes para que la base, el pipeline (Dev 1) y la app de puerta (Dev 4)
-- funcionen juntos. Se ejecuta después de 01, 02 y 03.
-- XIX Simposio de Ingeniería
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Padrón para los celulares de puerta
--    El padrón ya no tiene lectura pública (protege correos). Los celulares
--    lo descargan por esta función, que solo entrega carné y nombre.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.obtener_padron_movil()
RETURNS TABLE (carnet VARCHAR, nombre_oficial VARCHAR)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT carnet, nombre_oficial
    FROM public.padron_estudiantes
    ORDER BY carnet;
$$;

GRANT EXECUTE ON FUNCTION public.obtener_padron_movil() TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. Credenciales QR
--    El QR es un token firmado con RS256 por el pipeline de Dev 1 (unos 500
--    caracteres), así que la columna pasa a TEXT. Se agrega la marca de envío
--    para que el despacho de correos (Dev 5) solo mande los nuevos.
--    Los tokens de texto plano ('SIMP26-…') se eliminan: cualquiera podría
--    inventarlos y la app de puerta los rechaza.
-- ----------------------------------------------------------------------------
ALTER TABLE public.credenciales_qr ALTER COLUMN token_qr TYPE TEXT;
ALTER TABLE public.credenciales_qr ADD COLUMN IF NOT EXISTS enviado_en TIMESTAMP WITH TIME ZONE;
DELETE FROM public.credenciales_qr WHERE token_qr NOT LIKE 'eyJ%';

-- ----------------------------------------------------------------------------
-- 3. Portal de zona amarilla
--    Exige que la boleta traiga candidatos y que el carné sea uno de ellos.
--    No genera el QR: deja la boleta en VERDE y el pipeline lo firma.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolver_excepcion_estudiante(
    p_carnet VARCHAR,
    p_boleta VARCHAR
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_nombre VARCHAR;
    v_datos_extra JSONB;
BEGIN
    SELECT nombre_oficial INTO v_nombre
    FROM public.padron_estudiantes
    WHERE carnet = p_carnet;

    IF v_nombre IS NULL THEN
        RETURN jsonb_build_object(
            'status', 'ERROR',
            'mensaje', 'El carné no figura en el padrón oficial de la facultad.'
        );
    END IF;

    SELECT datos_extra INTO v_datos_extra
    FROM public.tesoreria_pagos
    WHERE boleta = p_boleta
      AND zona = 'AMARILLA'
      AND carnet_asignado IS NULL
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'status', 'ERROR',
            'mensaje', 'La boleta no existe en revisión, ya fue vinculada o requiere atención en la Mesa de Resolución.'
        );
    END IF;

    -- Sin lista de candidatos no se puede confirmar a quién pertenece el pago
    IF jsonb_typeof(v_datos_extra->'candidatos') IS DISTINCT FROM 'array'
       OR NOT EXISTS (
            SELECT 1
            FROM jsonb_array_elements(v_datos_extra->'candidatos') c
            WHERE c->>'carnet' = p_carnet
       ) THEN
        RETURN jsonb_build_object(
            'status', 'ERROR',
            'mensaje', 'El carné no corresponde a esta boleta. Acude a la Mesa de Resolución el día del evento con tu comprobante.'
        );
    END IF;

    UPDATE public.tesoreria_pagos
    SET carnet_asignado = p_carnet,
        zona = 'VERDE',
        estado = 'CONCILIADO',
        datos_extra = v_datos_extra || jsonb_build_object(
            'resuelto_en_portal', true,
            'zona_origen', 'AMARILLA',
            'fecha_resolucion', NOW()
        )
    WHERE boleta = p_boleta;

    RETURN jsonb_build_object(
        'status', 'OK',
        'mensaje', 'Identidad confirmada. Recibirás tu QR de acceso en tu correo institucional.',
        'carnet', p_carnet,
        'nombre', v_nombre
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. Mesa de resolución
--    Registra el ingreso del día y deja la boleta en VERDE para que el
--    pipeline firme el QR del otro día. Ya no genera un token de texto.
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
SET search_path = public
AS $$
DECLARE
    v_nombre VARCHAR;
    v_tickets_disponibles INT;
BEGIN
    SELECT nombre_oficial INTO v_nombre
    FROM public.padron_estudiantes
    WHERE carnet = p_carnet;

    IF v_nombre IS NULL THEN
        RETURN jsonb_build_object('status', 'ERROR', 'mensaje', 'Carné no encontrado en el padrón oficial.');
    END IF;

    IF EXISTS (SELECT 1 FROM public.checkins_asistencia WHERE carnet = p_carnet AND dia = p_dia) THEN
        RETURN jsonb_build_object('status', 'ALERTA', 'mensaje', 'El estudiante ya tiene asistencia registrada para este día.');
    END IF;

    SELECT (tickets_totales - tickets_entregados) INTO v_tickets_disponibles
    FROM public.inventario_tickets
    WHERE dia = p_dia
    FOR UPDATE;

    IF v_tickets_disponibles IS NULL THEN
        RETURN jsonb_build_object('status', 'ERROR', 'mensaje', 'El día operativo especificado no está configurado.');
    END IF;

    IF v_tickets_disponibles <= 0 THEN
        RETURN jsonb_build_object('status', 'ERROR', 'mensaje', 'Inventario de tickets agotado para esta jornada.');
    END IF;

    INSERT INTO public.checkins_asistencia (carnet, dia, puerta, staff_id)
    VALUES (p_carnet, p_dia, 'Mesa Resolucion', p_operador);

    UPDATE public.inventario_tickets
    SET tickets_entregados = tickets_entregados + 1
    WHERE dia = p_dia;

    IF p_boleta IS NOT NULL THEN
        UPDATE public.tesoreria_pagos
        SET zona = 'VERDE',
            estado = 'RESUELTO_MANUAL',
            carnet_asignado = p_carnet,
            datos_extra = COALESCE(datos_extra, '{}'::jsonb) || jsonb_build_object(
                'justificacion', p_justificacion,
                'operador', p_operador,
                'fecha_resolucion_manual', NOW(),
                'resuelto_en_mesa', true
            )
        WHERE boleta = p_boleta;
    END IF;

    RETURN jsonb_build_object(
        'status', 'OK',
        'mensaje', 'Ingreso manual autorizado para ' || v_nombre || '. El QR para el otro día se enviará por correo.',
        'carnet', p_carnet,
        'nombre', v_nombre
    );
END;
$$;
