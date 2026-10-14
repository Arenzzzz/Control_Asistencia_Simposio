-- ============================================================================
-- 10_APROBACION.SQL
-- Los correos del pipeline no salen hasta que alguien los aprueba en el Panel.
--   * Los QR que firma el pipeline (boletas verdes del autómata) quedan "por aprobar".
--   * Los avisos del portal (boletas amarillas) también esperan aprobación.
--   * Lo que ya revisó una persona sale de inmediato: confirmación en el portal,
--     boleta asignada en la mesa y "Reenviar QR".
-- El botón "Aprobar y enviar" del Panel llama a panel_aprobar_envio.
-- Correr después de 07_panel.sql y 08_seguridad.sql (reemplaza panel_estadisticas).
-- XIX Simposio de Ingeniería - Dev 4
-- ============================================================================

ALTER TABLE public.credenciales_qr ADD COLUMN IF NOT EXISTS aprobado BOOLEAN NOT NULL DEFAULT TRUE;

-- Los QR del pipeline que aún no se enviaron quedan por aprobar
UPDATE public.credenciales_qr c SET aprobado = FALSE
WHERE c.enviado_en IS NULL
  AND NOT EXISTS (SELECT 1 FROM public.tesoreria_pagos t
                  WHERE t.boleta = c.boleta_origen AND t.estado IN ('CONCILIADO', 'RESUELTO_MANUAL'));

-- Aprueba todo lo pendiente (QR y avisos del portal). Después la app pide el envío.
CREATE OR REPLACE FUNCTION public.panel_aprobar_envio(p_clave TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_qr INT;
    v_avisos INT;
BEGIN
    IF NOT public._mesa_clave_valida(p_clave) THEN
        RETURN jsonb_build_object('status', 'ERROR', 'mensaje', 'Clave incorrecta.');
    END IF;
    UPDATE public.credenciales_qr SET aprobado = TRUE WHERE enviado_en IS NULL AND NOT aprobado;
    GET DIAGNOSTICS v_qr = ROW_COUNT;
    UPDATE public.tesoreria_pagos
    SET datos_extra = datos_extra || jsonb_build_object('aviso_aprobado', NOW())
    WHERE zona = 'AMARILLA' AND carnet_asignado IS NULL
      AND NOT (datos_extra ? 'aviso_portal_enviado') AND NOT (datos_extra ? 'aviso_aprobado');
    GET DIAGNOSTICS v_avisos = ROW_COUNT;
    RETURN jsonb_build_object('status', 'OK', 'qr', v_qr, 'avisos', v_avisos,
        'mensaje', format('Se aprobaron %s QR y %s avisos del portal.', v_qr, v_avisos));
END;
$$;

CREATE OR REPLACE FUNCTION public.mesa_reenviar_qr(p_clave TEXT, p_carnet TEXT, p_correo TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT public._mesa_clave_valida(p_clave) THEN
        RETURN jsonb_build_object('status', 'ERROR', 'mensaje', 'Clave de la mesa incorrecta.');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.credenciales_qr WHERE carnet = trim(p_carnet)) THEN
        RETURN jsonb_build_object('status', 'ERROR',
            'mensaje', 'Este carné todavía no tiene QR. Primero asígnale una boleta.');
    END IF;
    IF coalesce(trim(p_correo), '') <> '' THEN
        IF trim(p_correo) !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
            RETURN jsonb_build_object('status', 'ERROR', 'mensaje', 'El correo no es válido.');
        END IF;
        UPDATE public.padron_estudiantes SET correo_institucional = trim(p_correo) WHERE carnet = trim(p_carnet);
    END IF;
    -- Lo pide una persona de la mesa: queda aprobado y sale de inmediato
    UPDATE public.credenciales_qr SET enviado_en = NULL, aprobado = TRUE WHERE carnet = trim(p_carnet);
    RETURN jsonb_build_object('status', 'OK', 'mensaje', 'El QR se volverá a enviar en unos minutos.');
END;
$$;

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
            'enviados',  (SELECT count(*) FROM credenciales_qr WHERE enviado_en IS NOT NULL),
            'por_aprobar', (SELECT count(*) FROM credenciales_qr WHERE enviado_en IS NULL AND NOT aprobado)
        ),
        'avisos', jsonb_build_object(
            'por_aprobar', (SELECT count(*) FROM tesoreria_pagos
                            WHERE zona = 'AMARILLA' AND carnet_asignado IS NULL
                              AND NOT (datos_extra ? 'aviso_portal_enviado')
                              AND NOT (datos_extra ? 'aviso_aprobado')),
            'enviados', (SELECT count(*) FROM tesoreria_pagos WHERE datos_extra ? 'aviso_portal_enviado')
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
        -- Últimos 15 ingresos de todas las puertas
        'recientes', (SELECT coalesce(jsonb_agg(r ORDER BY r->>'orden' DESC), '[]'::jsonb) FROM (
                        SELECT jsonb_build_object(
                            'orden', to_char(c.hora_checkin, 'YYYYMMDDHH24MISSUS'),
                            'hora', to_char(c.hora_checkin AT TIME ZONE 'America/Guatemala', 'HH24:MI'),
                            'carnet', c.carnet, 'nombre', p.nombre_oficial,
                            'dia', c.dia, 'puerta', c.puerta, 'operador', c.staff_id) AS r
                        FROM checkins_asistencia c LEFT JOIN padron_estudiantes p USING (carnet)
                        ORDER BY c.hora_checkin DESC LIMIT 15) x),
        'tickets', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                        'dia', dia, 'totales', tickets_totales, 'entregados', tickets_entregados) ORDER BY dia), '[]'::jsonb)
                    FROM inventario_tickets)
    ) INTO v;
    RETURN v;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.panel_aprobar_envio(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.panel_aprobar_envio(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.panel_estadisticas(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mesa_reenviar_qr(TEXT, TEXT, TEXT) TO anon, authenticated;
