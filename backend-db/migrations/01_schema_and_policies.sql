-- ============================================================================
-- 01_SCHEMA_AND_POLICIES.SQL
-- Definición de Tablas, Índices y Políticas RLS
-- XIX Simposio de Ingeniería
-- ============================================================================

-- 1. TABLAS BASE

-- A. Padrón oficial entregado por Coordinación
CREATE TABLE IF NOT EXISTS public.padron_estudiantes (
    carnet VARCHAR(20) PRIMARY KEY,
    nombre_oficial VARCHAR(150) NOT NULL,
    correo_institucional VARCHAR(120) NOT NULL,
    carrera VARCHAR(100),
    semestre VARCHAR(20)
);

-- B. Conciliación de Tesorería (JSONB flexible para campos adicionales de Tesorería)
CREATE TABLE IF NOT EXISTS public.tesoreria_pagos (
    boleta VARCHAR(50) PRIMARY KEY,
    nombre_digitado VARCHAR(150) NOT NULL,
    monto NUMERIC(10, 2) NOT NULL,
    fecha_pago TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    carnet_asignado VARCHAR(20) REFERENCES public.padron_estudiantes(carnet),
    zona VARCHAR(20) CHECK (zona IN ('VERDE', 'AMARILLA', 'ROJA', 'PENDIENTE')) DEFAULT 'PENDIENTE',
    estado VARCHAR(30) DEFAULT 'NO_CONCILIADO',
    datos_extra JSONB DEFAULT '{}'::jsonb
);

-- C. Lote global de tickets por día (sin correlativo individual)
CREATE TABLE IF NOT EXISTS public.inventario_tickets (
    dia INT PRIMARY KEY,
    tickets_totales INT NOT NULL,
    tickets_entregados INT DEFAULT 0
);

-- Inicialización de cupos (Día 1 y Día 2)
INSERT INTO public.inventario_tickets (dia, tickets_totales, tickets_entregados)
VALUES (1, 600, 0), (2, 600, 0)
ON CONFLICT (dia) DO NOTHING;

-- D. Auditoría inmutable de asistencia / check-in
CREATE TABLE IF NOT EXISTS public.checkins_asistencia (
    id BIGSERIAL PRIMARY KEY,
    carnet VARCHAR(20) NOT NULL REFERENCES public.padron_estudiantes(carnet),
    dia INT NOT NULL,
    hora_checkin TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    puerta VARCHAR(20) NOT NULL,
    staff_id VARCHAR(50),
    CONSTRAINT unique_checkin_dia UNIQUE (carnet, dia)
);

-- Tabla privada para tokens de acreditación QR (sin acceso público)
CREATE TABLE IF NOT EXISTS public.credenciales_qr (
    carnet VARCHAR(20) PRIMARY KEY REFERENCES public.padron_estudiantes(carnet),
    token_qr VARCHAR(100) NOT NULL UNIQUE,
    generado_en TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    boleta_origen VARCHAR(50) REFERENCES public.tesoreria_pagos(boleta)
);

-- Habilitar RLS estricto (por defecto nadie sin Service Role puede leer/escribir)
ALTER TABLE public.credenciales_qr ENABLE ROW LEVEL SECURITY;
-- Índices de consulta rápida
CREATE INDEX IF NOT EXISTS idx_checkins_carnet_dia ON public.checkins_asistencia(carnet, dia);
CREATE INDEX IF NOT EXISTS idx_tesoreria_carnet_asignado ON public.tesoreria_pagos(carnet_asignado);

-- ----------------------------------------------------------------------------
-- 2. SEGURIDAD: ROW LEVEL SECURITY (RLS)
-- ----------------------------------------------------------------------------

ALTER TABLE public.padron_estudiantes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tesoreria_pagos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventario_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checkins_asistencia ENABLE ROW LEVEL SECURITY;

-- Políticas de sólo lectura pública (las escrituras pasan por RPC o Service Role)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Lectura publica padron') THEN
        CREATE POLICY "Lectura publica padron" ON public.padron_estudiantes FOR SELECT TO anon USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Lectura publica inventario') THEN
        CREATE POLICY "Lectura publica inventario" ON public.inventario_tickets FOR SELECT TO anon USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Lectura publica checkins') THEN
        CREATE POLICY "Lectura publica checkins" ON public.checkins_asistencia FOR SELECT TO anon USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Lectura publica tesoreria') THEN
        CREATE POLICY "Lectura publica tesoreria" ON public.tesoreria_pagos FOR SELECT TO anon USING (true);
    END IF;
END $$;
