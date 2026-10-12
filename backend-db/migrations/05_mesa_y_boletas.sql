-- ============================================================================
-- 05_MESA_Y_BOLETAS.SQL
-- 1. Números de boleta flexibles (con o sin espacios y prefijo de agencia).
-- 2. Funciones de la mesa de resolución, protegidas con una clave de operador.
-- Se ejecuta después de 04_correcciones_integracion.sql.
-- XIX Simposio de Ingeniería
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. BOLETAS
-- ----------------------------------------------------------------------------

-- Deja solo letras y números: '86 2604-1537' -> '8626041537'
CREATE OR REPLACE FUNCTION public.normalizar_boleta(p TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE
AS $$ SELECT regexp_replace(upper(coalesce(p, '')), '[^0-9A-Z]', '', 'g') $$;

-- ¿El número que escribió la persona corresponde a la boleta guardada?
-- Acepta el número exacto o con/sin el prefijo de agencia (uno termina en el otro),
-- siempre que la parte común tenga al menos 6 caracteres.
CREATE OR REPLACE FUNCTION public.boleta_coincide(p_guardada TEXT, p_escrita TEXT)
RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE
AS $$
    SELECT a = b
        OR (length(b) >= 6 AND a LIKE '%' || b)
        OR (length(a) >= 6 AND b LIKE '%' || a)
    FROM (SELECT public.normalizar_boleta(p_guardada) AS a, public.normalizar_boleta(p_escrita) AS b) n
    WHERE n.a <> '' AND n.b <> '';
$$;

-- Al registrar boletas se quitan los espacios que vengan en el número
CREATE OR REPLACE FUNCTION public.limpiar_boleta_al_insertar()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.boleta := regexp_replace(trim(NEW.boleta), '\s+', '', 'g');
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_limpiar_boleta ON public.tesoreria_pagos;
CREATE TRIGGER trg_limpiar_boleta
BEFORE INSERT ON public.tesoreria_pagos
FOR EACH ROW EXECUTE FUNCTION public.limpiar_boleta_al_insertar();

-- Boletas que ya estaban guardadas con espacios
UPDATE public.tesoreria_pagos
SET boleta = regexp_replace(trim(boleta), '\s+', '', 'g')
WHERE boleta ~ '\s'
  AND NOT EXISTS (SELECT 1 FROM public.credenciales_qr c WHERE c.boleta_origen = tesoreria_pagos.boleta);

-- Portal de zona amarilla con número de boleta flexible
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
    v_boleta VARCHAR;
    v_datos_extra JSONB;
    v_coincidencias INT;
BEGIN
    SELECT nombre_oficial INTO v_nombre
    FROM public.padron_estudiantes
    WHERE carnet = trim(p_carnet);

    IF v_nombre IS NULL THEN
        RETURN jsonb_build_object('status', 'ERROR',
            'mensaje', 'El carné no figura en el padrón oficial de la facultad.');
    END IF;

    SELECT count(*), min(boleta) INTO v_coincidencias, v_boleta
    FROM public.tesoreria_pagos
    WHERE zona = 'AMARILLA' AND carnet_asignado IS NULL
      AND public.boleta_coincide(boleta, p_boleta);

    IF v_coincidencias = 0 THEN
        RETURN jsonb_build_object('status', 'ERROR',
            'mensaje', 'La boleta no existe en revisión, ya fue vinculada o requiere atención en la Mesa de Resolución.');
    END IF;
    IF v_coincidencias > 1 THEN
        RETURN jsonb_build_object('status', 'ERROR',
            'mensaje', 'Ese número coincide con varias boletas. Escríbelo completo, tal como aparece en tu comprobante.');
    END IF;

    SELECT datos_extra INTO v_datos_extra
    FROM public.tesoreria_pagos WHERE boleta = v_boleta FOR UPDATE;

    IF jsonb_typeof(v_datos_extra->'candidatos') IS DISTINCT FROM 'array'
       OR NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(v_datos_extra->'candidatos') c
            WHERE c->>'carnet' = trim(p_carnet)
       ) THEN
        RETURN jsonb_build_object('status', 'ERROR',
            'mensaje', 'El carné no corresponde a esta boleta. Acude a la Mesa de Resolución el día del evento con tu comprobante.');
    END IF;

    UPDATE public.tesoreria_pagos
    SET carnet_asignado = trim(p_carnet),
        zona = 'VERDE',
        estado = 'CONCILIADO',
        datos_extra = v_datos_extra || jsonb_build_object(
            'resuelto_en_portal', true, 'zona_origen', 'AMARILLA', 'fecha_resolucion', NOW())
    WHERE boleta = v_boleta;

    RETURN jsonb_build_object('status', 'OK',
        'mensaje', 'Identidad confirmada. Recibirás tu QR de acceso en tu correo institucional.',
        'carnet', trim(p_carnet), 'nombre', v_nombre);
END;
$$;

-- ----------------------------------------------------------------------------
-- 2. MESA DE RESOLUCIÓN
--    Las funciones piden la clave de la mesa. La clave se guarda como SHA-256
--    en una tabla sin acceso público. Para fijarla (o cambiarla):
--      INSERT INTO mesa_config (id, clave_sha256)
--      VALUES (1, encode(sha256(convert_to('LA-CLAVE', 'UTF8')), 'hex'))
--      ON CONFLICT (id) DO UPDATE SET clave_sha256 = EXCLUDED.clave_sha256;
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mesa_config (
    id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    clave_sha256 TEXT NOT NULL
);
ALTER TABLE public.mesa_config ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public._mesa_clave_valida(p_clave TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.mesa_config
        WHERE clave_sha256 = encode(sha256(convert_to(coalesce(p_clave, ''), 'UTF8')), 'hex')
    );
$$;
REVOKE EXECUTE ON FUNCTION public._mesa_clave_valida(TEXT) FROM PUBLIC, anon, authenticated;

-- El ingreso manual ya no se puede llamar directo: pasa por mesa_registrar_ingreso
REVOKE EXECUTE ON FUNCTION public.resolver_checkin_manual(VARCHAR, VARCHAR, INT, VARCHAR, TEXT)
    FROM PUBLIC, anon, authenticated;

-- Búsqueda por carné, nombre o número de boleta
CREATE OR REPLACE FUNCTION public.mesa_buscar(p_clave TEXT, p_texto TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_texto TEXT := trim(coalesce(p_texto, ''));
    v_patron TEXT;
    v_estudiantes JSONB;
    v_boletas JSONB;
BEGIN
    IF NOT public._mesa_clave_valida(p_clave) THEN
        RETURN jsonb_build_object('status', 'ERROR', 'mensaje', 'Clave de la mesa incorrecta.');
    END IF;
    IF length(v_texto) < 3 THEN
        RETURN jsonb_build_object('status', 'ERROR', 'mensaje', 'Escribe al menos 3 caracteres.');
    END IF;
    -- Sin tildes y sin distinguir mayúsculas
    v_patron := '%' || translate(lower(v_texto), 'áéíóúüñ', 'aeiouun') || '%';

    WITH est AS (
        SELECT p.carnet, p.nombre_oficial, p.correo_institucional
        FROM public.padron_estudiantes p
        WHERE p.carnet = v_texto
           OR translate(lower(p.nombre_oficial), 'áéíóúüñ', 'aeiouun') LIKE v_patron
           OR p.carnet IN (SELECT t.carnet_asignado FROM public.tesoreria_pagos t
                           WHERE t.carnet_asignado IS NOT NULL AND public.boleta_coincide(t.boleta, v_texto))
        ORDER BY p.nombre_oficial
        LIMIT 15
    )
    SELECT coalesce(jsonb_agg(jsonb_build_object(
        'carnet', e.carnet,
        'nombre', e.nombre_oficial,
        'correo', e.correo_institucional,
        'boletas', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                        'boleta', t.boleta, 'zona', t.zona, 'estado', t.estado, 'monto', t.monto)), '[]'::jsonb)
                    FROM public.tesoreria_pagos t WHERE t.carnet_asignado = e.carnet),
        'qr', (SELECT jsonb_build_object('generado_en', c.generado_en, 'enviado_en', c.enviado_en)
               FROM public.credenciales_qr c WHERE c.carnet = e.carnet),
        'ingresos', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                        'dia', ch.dia, 'hora', ch.hora_checkin, 'puerta', ch.puerta) ORDER BY ch.dia), '[]'::jsonb)
                     FROM public.checkins_asistencia ch WHERE ch.carnet = e.carnet)
    )), '[]'::jsonb)
    INTO v_estudiantes FROM est e;

    -- Boletas que aún no tienen dueño (amarillas y rojas)
    SELECT coalesce(jsonb_agg(jsonb_build_object(
        'boleta', t.boleta, 'nombre', t.nombre_digitado, 'monto', t.monto, 'zona', t.zona,
        'motivo', t.datos_extra->>'motivo',
        'candidatos', coalesce((SELECT jsonb_agg(jsonb_build_object('carnet', c->>'carnet', 'nombre', c->>'nombre'))
                                FROM jsonb_array_elements(
                                    CASE WHEN jsonb_typeof(t.datos_extra->'candidatos') = 'array'
                                         THEN t.datos_extra->'candidatos' ELSE '[]'::jsonb END) c), '[]'::jsonb)
    )), '[]'::jsonb)
    INTO v_boletas
    FROM (SELECT * FROM public.tesoreria_pagos t
          WHERE t.carnet_asignado IS NULL
            AND (public.boleta_coincide(t.boleta, v_texto)
                 OR translate(lower(t.nombre_digitado), 'áéíóúüñ', 'aeiouun') LIKE v_patron)
          ORDER BY t.boleta LIMIT 15) t;

    RETURN jsonb_build_object('status', 'OK', 'estudiantes', v_estudiantes, 'boletas', v_boletas);
END;
$$;

-- Asignar una boleta sin dueño a un carné (antes del evento o en la mesa).
-- Queda en VERDE y el envío automático le firma y manda el QR.
CREATE OR REPLACE FUNCTION public.mesa_vincular_boleta(
    p_clave TEXT, p_boleta TEXT, p_carnet TEXT, p_operador TEXT, p_justificacion TEXT
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_nombre VARCHAR;
    v_boleta VARCHAR;
BEGIN
    IF NOT public._mesa_clave_valida(p_clave) THEN
        RETURN jsonb_build_object('status', 'ERROR', 'mensaje', 'Clave de la mesa incorrecta.');
    END IF;
    IF coalesce(trim(p_justificacion), '') = '' THEN
        RETURN jsonb_build_object('status', 'ERROR', 'mensaje', 'Escribe la justificación (por ejemplo, qué comprobante se revisó).');
    END IF;

    SELECT nombre_oficial INTO v_nombre FROM public.padron_estudiantes WHERE carnet = trim(p_carnet);
    IF v_nombre IS NULL THEN
        RETURN jsonb_build_object('status', 'ERROR', 'mensaje', 'El carné no está en el padrón.');
    END IF;

    SELECT boleta INTO v_boleta FROM public.tesoreria_pagos WHERE boleta = p_boleta FOR UPDATE;
    IF v_boleta IS NULL THEN
        RETURN jsonb_build_object('status', 'ERROR', 'mensaje', 'La boleta no existe.');
    END IF;
    IF EXISTS (SELECT 1 FROM public.tesoreria_pagos WHERE boleta = v_boleta AND carnet_asignado IS NOT NULL) THEN
        RETURN jsonb_build_object('status', 'ERROR', 'mensaje', 'La boleta ya está asignada a otro carné.');
    END IF;

    UPDATE public.tesoreria_pagos
    SET carnet_asignado = trim(p_carnet),
        zona = 'VERDE',
        estado = 'RESUELTO_MANUAL',
        datos_extra = coalesce(datos_extra, '{}'::jsonb) || jsonb_build_object(
            'resuelto_en_mesa', true, 'operador', p_operador,
            'justificacion', p_justificacion, 'fecha_resolucion_manual', NOW())
    WHERE boleta = v_boleta;

    RETURN jsonb_build_object('status', 'OK',
        'mensaje', 'Boleta asignada a ' || v_nombre || '. Su QR se enviará por correo en unos minutos.');
END;
$$;

-- Registrar el ingreso del día en la mesa (por ejemplo, si no trae el QR)
CREATE OR REPLACE FUNCTION public.mesa_registrar_ingreso(
    p_clave TEXT, p_carnet TEXT, p_boleta TEXT, p_dia INT, p_operador TEXT, p_justificacion TEXT
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT public._mesa_clave_valida(p_clave) THEN
        RETURN jsonb_build_object('status', 'ERROR', 'mensaje', 'Clave de la mesa incorrecta.');
    END IF;
    IF coalesce(trim(p_justificacion), '') = '' THEN
        RETURN jsonb_build_object('status', 'ERROR', 'mensaje', 'Escribe la justificación del ingreso manual.');
    END IF;
    RETURN public.resolver_checkin_manual(trim(p_carnet), nullif(trim(coalesce(p_boleta, '')), ''),
                                          p_dia, p_operador, p_justificacion);
END;
$$;

-- Volver a enviar el QR (opcionalmente a otro correo)
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
    UPDATE public.credenciales_qr SET enviado_en = NULL WHERE carnet = trim(p_carnet);
    RETURN jsonb_build_object('status', 'OK', 'mensaje', 'El QR se volverá a enviar en unos minutos.');
END;
$$;

GRANT EXECUTE ON FUNCTION public.mesa_buscar(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mesa_vincular_boleta(TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mesa_registrar_ingreso(TEXT, TEXT, TEXT, INT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mesa_reenviar_qr(TEXT, TEXT, TEXT) TO anon, authenticated;
