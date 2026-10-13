-- ============================================================================
-- 07_PANEL.SQL
-- Panel de estadísticas y descarga de registros en CSV (pantalla #/panel).
-- Usa la misma clave de la mesa de resolución. Horas en hora de Guatemala.
-- XIX Simposio de Ingeniería - Dev 4
-- ============================================================================

-- Estadísticas generales
CREATE OR REPLACE FUNCTION public.panel_estadisticas(p_clave TEXT)
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

    SELECT jsonb_build_object(
        'status', 'OK',
        'generado_en', now(),
        'padron', (SELECT count(*) FROM padron_estudiantes),
        'boletas', jsonb_build_object(
            'total',     (SELECT count(*) FROM tesoreria_pagos),
            'verde',     (SELECT count(*) FROM tesoreria_pagos WHERE zona = 'VERDE'),
            'amarilla',  (SELECT count(*) FROM tesoreria_pagos WHERE zona = 'AMARILLA'),
            'roja',      (SELECT count(*) FROM tesoreria_pagos WHERE zona = 'ROJA'),
            'pendiente', (SELECT count(*) FROM tesoreria_pagos WHERE zona IS NULL OR upper(zona) = 'PENDIENTE'),
            -- Cómo quedó en verde cada boleta: automático (autómata), portal del estudiante o mesa
            'auto',      (SELECT count(*) FROM tesoreria_pagos WHERE zona = 'VERDE'
                                AND coalesce(estado, 'NO_CONCILIADO') NOT IN ('CONCILIADO', 'RESUELTO_MANUAL')),
            'portal',    (SELECT count(*) FROM tesoreria_pagos WHERE zona = 'VERDE' AND estado = 'CONCILIADO'),
            'mesa',      (SELECT count(*) FROM tesoreria_pagos WHERE zona = 'VERDE' AND estado = 'RESUELTO_MANUAL'),
            'monto_verde', (SELECT coalesce(sum(monto), 0) FROM tesoreria_pagos WHERE zona = 'VERDE')
        ),
        'qr', jsonb_build_object(
            'generados', (SELECT count(*) FROM credenciales_qr),
            'enviados',  (SELECT count(*) FROM credenciales_qr WHERE enviado_en IS NOT NULL)
        ),
        'ingresos', jsonb_build_object(
            'dia1',    (SELECT count(*) FROM checkins_asistencia WHERE dia = 1),
            'dia2',    (SELECT count(*) FROM checkins_asistencia WHERE dia = 2),
            'ambos',   (SELECT count(*) FROM (SELECT carnet FROM checkins_asistencia
                                              GROUP BY carnet HAVING count(DISTINCT dia) = 2) x),
            'unicos',  (SELECT count(DISTINCT carnet) FROM checkins_asistencia),
            'por_hora', (SELECT coalesce(jsonb_agg(jsonb_build_object('dia', dia, 'hora', hora, 'total', total)
                                                   ORDER BY dia, hora), '[]'::jsonb)
                         FROM (SELECT dia,
                                      extract(hour FROM hora_checkin AT TIME ZONE 'America/Guatemala')::int AS hora,
                                      count(*) AS total
                               FROM checkins_asistencia GROUP BY 1, 2) h),
            'por_puerta', (SELECT coalesce(jsonb_agg(jsonb_build_object('dia', dia, 'puerta', puerta, 'total', total)
                                                     ORDER BY dia, puerta), '[]'::jsonb)
                           FROM (SELECT dia, puerta, count(*) AS total
                                 FROM checkins_asistencia GROUP BY 1, 2) p)
        ),
        'tickets', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                        'dia', dia, 'totales', tickets_totales, 'entregados', tickets_entregados) ORDER BY dia), '[]'::jsonb)
                    FROM inventario_tickets)
    ) INTO v;
    RETURN v;
END;
$$;

-- Registros para descargar en CSV. p_tipo: 'ingresos' | 'asistencia' | 'boletas'
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

    ELSE
        RETURN jsonb_build_object('status', 'ERROR', 'mensaje', 'Tipo de registro desconocido.');
    END IF;

    RETURN jsonb_build_object('status', 'OK', 'filas', v);
END;
$$;

GRANT EXECUTE ON FUNCTION public.panel_estadisticas(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.panel_registros(TEXT, TEXT) TO anon, authenticated;
