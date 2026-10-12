-- ============================================================================
-- 03_VIEWS.SQL
-- Vistas Consolidadas de Auditoría y Reporte Académico
-- XIX Simposio de Ingeniería - Dev 2
-- ============================================================================

DROP VIEW IF EXISTS public.vista_asistencia_coordinacion CASCADE;

CREATE VIEW public.vista_asistencia_coordinacion
WITH (security_invoker = true)
AS
SELECT 
    p.carnet,
    p.nombre_oficial,
    p.correo_institucional,
    p.carrera,
    p.semestre,
    MAX(CASE WHEN c.dia = 1 THEN to_char(c.hora_checkin, 'YYYY-MM-DD HH24:MI:SS') ELSE NULL END) AS checkin_dia_1,
    MAX(CASE WHEN c.dia = 2 THEN to_char(c.hora_checkin, 'YYYY-MM-DD HH24:MI:SS') ELSE NULL END) AS checkin_dia_2,
    CASE 
        WHEN COUNT(c.dia) = 2 THEN 'COMPLETO (2 DIAS)'
        WHEN COUNT(c.dia) = 1 THEN 'PARCIAL (1 DIA)'
        ELSE 'AUSENTE'
    END AS estado_asistencia
FROM public.padron_estudiantes p
LEFT JOIN public.checkins_asistencia c ON p.carnet = c.carnet
GROUP BY p.carnet, p.nombre_oficial, p.correo_institucional, p.carrera, p.semestre
ORDER BY p.nombre_oficial ASC;
