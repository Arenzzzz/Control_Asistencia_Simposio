-- ============================================================================
-- 11_ACCESO_Y_CORREOS.SQL
-- * validar_clave: la app comprueba la clave antes de abrir la mesa, el panel o
--   los ajustes del celular.
-- * panel_registros: agrega la descarga 'correos' (estado de cada QR y aviso).
-- Correr después de 10_aprobacion.sql.
-- XIX Simposio de Ingeniería - Dev 4
-- ============================================================================

-- p_tipo: 'mesa' (mesa y panel) o 'puerta' (ajustes del celular; también acepta la de la mesa)
CREATE OR REPLACE FUNCTION public.validar_clave(p_tipo TEXT, p_clave TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_ok BOOLEAN;
BEGIN
    v_ok := CASE p_tipo
                WHEN 'mesa' THEN public._mesa_clave_valida(p_clave)
                WHEN 'puerta' THEN public._puerta_clave_valida(p_clave)
                ELSE FALSE
            END;
    IF v_ok THEN
        RETURN jsonb_build_object('status', 'OK');
    END IF;
    RETURN jsonb_build_object('status', 'ERROR', 'mensaje', 'Clave incorrecta.');
END;
$$;

-- Registros para descargar en CSV. p_tipo: 'ingresos' | 'asistencia' | 'boletas' | 'correos'
CREATE OR REPLACE FUNCTION public.panel_registros(p_clave TEXT, p_tipo TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v JSONB;
BEGIN
    IF NOT public._mesa_clave_valida(p_clave) THEN
        RETURN jsonb_build_object('status', 'ERROR', 'mensaje', 'Clave incorrecta.');
    END IF;

    IF p_tipo = 'ingresos' THEN
        -- Un registro por cada ingreso a la puerta
        SELECT coalesce(jsonb_agg(jsonb_build_object(
            'carne', c.carnet,
            'nombre', p.nombre_oficial,
            'correo', p.correo_institucional,
            'dia', c.dia,
            'fecha_hora', to_char(c.hora_checkin AT TIME ZONE 'America/Guatemala', 'YYYY-MM-DD HH24:MI:SS'),
            'puerta', c.puerta,
            'operador', c.staff_id
        ) ORDER BY c.hora_checkin), '[]'::jsonb)
        INTO v
        FROM checkins_asistencia c LEFT JOIN padron_estudiantes p USING (carnet);

    ELSIF p_tipo = 'asistencia' THEN
        -- Un registro por estudiante con pago validado: QR y asistencia de cada día
        SELECT coalesce(jsonb_agg(fila ORDER BY fila->>'nombre'), '[]'::jsonb)
        INTO v
        FROM (
            SELECT jsonb_build_object(
                'carne', p.carnet,
                'nombre', p.nombre_oficial,
                'correo', p.correo_institucional,
                'boleta', (SELECT string_agg(t.boleta, ' ') FROM tesoreria_pagos t
                           WHERE t.carnet_asignado = p.carnet AND t.zona = 'VERDE'),
                'qr_enviado', (SELECT to_char(q.enviado_en AT TIME ZONE 'America/Guatemala', 'YYYY-MM-DD HH24:MI')
                               FROM credenciales_qr q WHERE q.carnet = p.carnet),
                'ingreso_dia_1', (SELECT to_char(min(c.hora_checkin) AT TIME ZONE 'America/Guatemala', 'YYYY-MM-DD HH24:MI')
                                  FROM checkins_asistencia c WHERE c.carnet = p.carnet AND c.dia = 1),
                'ingreso_dia_2', (SELECT to_char(min(c.hora_checkin) AT TIME ZONE 'America/Guatemala', 'YYYY-MM-DD HH24:MI')
                                  FROM checkins_asistencia c WHERE c.carnet = p.carnet AND c.dia = 2),
                'asistencia', CASE (SELECT count(DISTINCT c.dia) FROM checkins_asistencia c WHERE c.carnet = p.carnet)
                                  WHEN 2 THEN 'Completa (2 días)'
                                  WHEN 1 THEN 'Parcial (1 día)'
                                  ELSE 'No asistió' END
            ) AS fila
            FROM padron_estudiantes p
            WHERE EXISTS (SELECT 1 FROM tesoreria_pagos t WHERE t.carnet_asignado = p.carnet AND t.zona = 'VERDE')
               OR EXISTS (SELECT 1 FROM checkins_asistencia c WHERE c.carnet = p.carnet)
        ) x;

    ELSIF p_tipo = 'boletas' THEN
        -- Todas las boletas de Tesorería con su clasificación
        SELECT coalesce(jsonb_agg(jsonb_build_object(
            'boleta', t.boleta,
            'nombre_boleta', t.nombre_digitado,
            'monto', t.monto,
            'fecha_pago', to_char(t.fecha_pago AT TIME ZONE 'America/Guatemala', 'YYYY-MM-DD HH24:MI'),
            'zona', t.zona,
            'estado', t.estado,
            'carne_asignado', t.carnet_asignado,
            'motivo', t.datos_extra->>'motivo'
        ) ORDER BY t.zona, t.boleta), '[]'::jsonb)
        INTO v
        FROM tesoreria_pagos t;

    ELSIF p_tipo = 'correos' THEN
        -- Estado de cada correo: QR de las verdes y avisos del portal de las amarillas
        SELECT coalesce(jsonb_agg(fila ORDER BY fila->>'estado', fila->>'tipo', fila->>'nombre'), '[]'::jsonb)
        INTO v
        FROM (
            SELECT jsonb_build_object(
                'tipo', 'QR de acceso',
                'estado', CASE WHEN q.enviado_en IS NOT NULL THEN '3. Enviado'
                               WHEN q.aprobado THEN '2. Aprobado, por enviar'
                               ELSE '1. Por aprobar' END,
                'carne', q.carnet,
                'nombre', p.nombre_oficial,
                'correo', p.correo_institucional,
                'boleta', q.boleta_origen,
                'enviado', to_char(q.enviado_en AT TIME ZONE 'America/Guatemala', 'YYYY-MM-DD HH24:MI'),
                'candidatos', NULL
            ) AS fila
            FROM credenciales_qr q LEFT JOIN padron_estudiantes p USING (carnet)
            UNION ALL
            SELECT jsonb_build_object(
                'tipo', 'Aviso del portal',
                'estado', CASE WHEN t.datos_extra ? 'aviso_portal_enviado' THEN '3. Enviado'
                               WHEN t.datos_extra ? 'aviso_aprobado' THEN '2. Aprobado, por enviar'
                               ELSE '1. Por aprobar' END,
                'carne', NULL,
                'nombre', t.nombre_digitado,
                'correo', NULL,
                'boleta', t.boleta,
                'enviado', to_char((t.datos_extra->>'aviso_portal_enviado')::timestamptz AT TIME ZONE 'America/Guatemala', 'YYYY-MM-DD HH24:MI'),
                'candidatos', (SELECT string_agg(concat(c->>'carnet', ' · ', c->>'nombre'), ' | ')
                               FROM jsonb_array_elements(CASE WHEN jsonb_typeof(t.datos_extra->'candidatos') = 'array'
                                                              THEN t.datos_extra->'candidatos' ELSE '[]'::jsonb END) c)
            )
            FROM tesoreria_pagos t
            WHERE t.zona = 'AMARILLA' AND t.carnet_asignado IS NULL
        ) x;

    ELSE
        RETURN jsonb_build_object('status', 'ERROR', 'mensaje', 'Tipo de registro desconocido.');
    END IF;

    RETURN jsonb_build_object('status', 'OK', 'filas', v);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.validar_clave(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validar_clave(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.panel_registros(TEXT, TEXT) TO anon, authenticated;
