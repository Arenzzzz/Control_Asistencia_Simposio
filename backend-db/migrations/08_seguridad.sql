-- ============================================================================
-- 08_SEGURIDAD.SQL
-- Cierra el acceso público a la base. Con la llave pública de la app (anon)
-- ya no se puede leer ni escribir ninguna tabla. Solo quedan abiertas:
--   * el portal de zona amarilla (resolver_excepcion_estudiante), que pide
--     boleta y carné que coincidan;
--   * las funciones de la puerta, que piden la clave de la puerta;
--   * las de la mesa y el panel, que piden la clave de la mesa.
-- El pipeline, el envío de correos y la función enviar-ahora usan la conexión
-- de administrador o la llave de servicio, así que no se ven afectados.
--
-- Para fijar (o cambiar) la clave de la puerta:
--   INSERT INTO puerta_config (id, clave_sha256)
--   VALUES (1, encode(sha256(convert_to('LA-CLAVE', 'UTF8')), 'hex'))
--   ON CONFLICT (id) DO UPDATE SET clave_sha256 = EXCLUDED.clave_sha256;
-- La clave de la mesa también sirve en la puerta.
-- XIX Simposio de Ingeniería - Dev 4
-- ============================================================================

-- 1. Clave de la puerta (tabla sin acceso público, solo guarda el SHA-256)
CREATE TABLE IF NOT EXISTS public.puerta_config (
    id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    clave_sha256 TEXT NOT NULL
);
ALTER TABLE public.puerta_config ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public._puerta_clave_valida(p_clave TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.puerta_config
        WHERE clave_sha256 = encode(sha256(convert_to(coalesce(p_clave, ''), 'UTF8')), 'hex')
    ) OR public._mesa_clave_valida(p_clave);
$$;

-- 2. Funciones de la puerta (reemplazan la lectura directa de tablas)

-- Padrón para el celular: solo carné y nombre
CREATE OR REPLACE FUNCTION public.puerta_padron(p_clave TEXT)
RETURNS TABLE (carnet VARCHAR, nombre_oficial VARCHAR)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT public._puerta_clave_valida(p_clave) THEN
        RAISE EXCEPTION 'Clave de puerta incorrecta' USING ERRCODE = '28000';
    END IF;
    RETURN QUERY SELECT p.carnet, p.nombre_oficial FROM public.padron_estudiantes p ORDER BY p.carnet;
END;
$$;

-- Ingresos ya registrados (para que otra puerta no deje entrar dos veces)
CREATE OR REPLACE FUNCTION public.puerta_ingresos(p_clave TEXT)
RETURNS TABLE (carnet VARCHAR, dia INT)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT public._puerta_clave_valida(p_clave) THEN
        RAISE EXCEPTION 'Clave de puerta incorrecta' USING ERRCODE = '28000';
    END IF;
    RETURN QUERY SELECT c.carnet, c.dia FROM public.checkins_asistencia c ORDER BY c.id;
END;
$$;

-- Envío de los ingresos guardados sin conexión
CREATE OR REPLACE FUNCTION public.puerta_sincronizar(p_clave TEXT, p_checkins JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT public._puerta_clave_valida(p_clave) THEN
        RAISE EXCEPTION 'Clave de puerta incorrecta' USING ERRCODE = '28000';
    END IF;
    RETURN public.sincronizar_checkins_offline(p_checkins);
END;
$$;

-- 3. Sin lectura ni escritura directa de tablas y vistas para anon y authenticated
DROP POLICY IF EXISTS "Lectura publica checkins" ON public.checkins_asistencia;
DROP POLICY IF EXISTS "Lectura publica inventario" ON public.inventario_tickets;

DO $$
DECLARE t RECORD;
BEGIN
    -- RLS activo en todas las tablas del esquema público
    FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
    END LOOP;
END $$;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;

-- 4. Funciones: nadie las ejecuta salvo las que se abren abajo
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.resolver_excepcion_estudiante(VARCHAR, VARCHAR) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.puerta_padron(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.puerta_ingresos(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.puerta_sincronizar(TEXT, JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mesa_buscar(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mesa_vincular_boleta(TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mesa_registrar_ingreso(TEXT, TEXT, TEXT, INT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mesa_reenviar_qr(TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.panel_estadisticas(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.panel_registros(TEXT, TEXT) TO anon, authenticated;

-- 5. Lo que se cree después tampoco queda abierto por defecto
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;

-- 6. Revisión: debe devolver solo las 10 funciones abiertas de arriba y ninguna tabla
-- SELECT 'función' AS tipo, p.proname AS nombre FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--  WHERE n.nspname = 'public' AND has_function_privilege('anon', p.oid, 'EXECUTE')
-- UNION ALL
-- SELECT 'tabla', c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v', 'm')
--    AND (has_table_privilege('anon', c.oid, 'SELECT') OR has_table_privilege('anon', c.oid, 'INSERT'));
