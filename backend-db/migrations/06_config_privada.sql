-- ============================================================================
-- 06_CONFIG_PRIVADA.SQL
-- Datos privados para la función "enviar-ahora" (token de GitHub), por si no se
-- pueden guardar como secretos de Edge Functions. RLS activo y sin políticas:
-- la app (anon) no puede leerla; solo la función, con la llave de servicio.
-- XIX Simposio de Ingeniería - Dev 4
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.config_privada (
    clave TEXT PRIMARY KEY,
    valor TEXT NOT NULL
);

ALTER TABLE public.config_privada ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.config_privada FROM anon, authenticated;

-- Llenar con los valores reales (no subir el token al repositorio):
-- INSERT INTO public.config_privada (clave, valor) VALUES
--   ('GITHUB_TOKEN', 'github_pat_...'),
--   ('GITHUB_REPO',  'Arenzzzz/Control_Asistencia_Simposio')
-- ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor;
