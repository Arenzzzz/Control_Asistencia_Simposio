-- ============================================================================
-- 09_DOCENTES.SQL
-- Los docentes pagan Q150 y los estudiantes Q300. El padrón distingue el tipo
-- para que el pipeline compare cada boleta solo con el grupo de su tarifa.
-- Los docentes se cargan en padron_estudiantes con tipo = 'DOCENTE' y su
-- código de empleado en la columna carnet.
-- XIX Simposio de Ingeniería - Dev 4
-- ============================================================================

ALTER TABLE public.padron_estudiantes
    ADD COLUMN IF NOT EXISTS tipo VARCHAR(20) NOT NULL DEFAULT 'ESTUDIANTE';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'padron_tipo_valido') THEN
        ALTER TABLE public.padron_estudiantes
            ADD CONSTRAINT padron_tipo_valido CHECK (tipo IN ('ESTUDIANTE', 'DOCENTE'));
    END IF;
END $$;

-- Ejemplo para cargar un docente:
-- INSERT INTO padron_estudiantes (carnet, nombre_oficial, correo_institucional, tipo)
-- VALUES ('D-12345', 'NOMBRE COMPLETO DEL DOCENTE', 'docente@url.edu.gt', 'DOCENTE');
