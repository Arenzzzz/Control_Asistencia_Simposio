-- ============================================================================
-- TESTS/SEED_MOCK_DATA.SQL
-- Datos Sintéticos de Prueba y Validaciones Unitarias
-- XIX Simposio de Ingeniería - Dev 2
-- ============================================================================

-- 1. PURGA PARA ENTORNO DE PRUEBAS
TRUNCATE TABLE public.checkins_asistencia RESTART IDENTITY CASCADE;
TRUNCATE TABLE public.credenciales_qr CASCADE;
TRUNCATE TABLE public.tesoreria_pagos CASCADE;
TRUNCATE TABLE public.padron_estudiantes CASCADE;

UPDATE public.inventario_tickets 
SET tickets_entregados = 0 
WHERE dia IN (1, 2);

-- ----------------------------------------------------------------------------
-- 2. INSERCIÓN DE DATOS SIMULADOS
-- ----------------------------------------------------------------------------

INSERT INTO public.padron_estudiantes (carnet, nombre_oficial, correo_institucional, carrera, semestre)
VALUES
    ('2021001', 'Juan Carlos Perez Gomez', 'juan.perez@ingenieria.edu', 'Ingeniería en Ciencias y Sistemas', '7mo'),
    ('2021002', 'Maria Rene Morales Lopez', 'maria.morales@ingenieria.edu', 'Ingeniería Industrial', '5to'),
    ('2021003', 'Carlos Eduardo Lopez Juarez', 'carlos.lopez@ingenieria.edu', 'Ingeniería Civil', '9no')
ON CONFLICT (carnet) DO NOTHING;

-- Credencial QR para el caso Verde
INSERT INTO public.credenciales_qr (carnet, token_qr, boleta_origen)
VALUES ('2021001', 'SIMP26-2021001', 'BOL-1001')
ON CONFLICT (carnet) DO NOTHING;

INSERT INTO public.tesoreria_pagos (boleta, nombre_digitado, monto, carnet_asignado, zona, estado, datos_extra)
VALUES
    ('BOL-1001', 'Juan Perez', 50.00, '2021001', 'VERDE', 'CONCILIADO', '{"agencia": "Central"}'::jsonb),
    -- Boleta con candidatos estructurados como arreglo de objetos
    ('BOL-2002', 'Maria Morales', 50.00, NULL, 'AMARILLA', 'NO_CONCILIADO', '{"candidatos": [{"carnet": "2021002", "nombre": "Maria Rene Morales Lopez"}]}'::jsonb),
    ('BOL-9999', 'Estudiante Desconocido', 50.00, NULL, 'ROJA', 'NO_CONCILIADO', '{"k": 5}'::jsonb)
ON CONFLICT (boleta) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 3. PRUEBAS DE EJECUCIÓN
-- ----------------------------------------------------------------------------

-- Check-in con Token QR (Dev 3)
SELECT public.registrar_checkin_atomico('SIMP26-2021001', 1, 'Puerta 1', 'operador_juan');

-- Desempate con validación de candidatos tipo objeto (Dev 4)
SELECT public.resolver_excepcion_estudiante('2021002', 'BOL-2002');
