# 🏛️ Backend & Concurrencia Transaccional - XIX Simposio de Ingeniería

Módulo de base de datos relacional, control transaccional atómico contra condiciones de carrera (*Race Conditions*) y procedimientos RPC desarrollado en **Supabase / PostgreSQL** para el control de acceso y asistencia.

---

## 📁 Estructura del Módulo

```text
backend-db/
├── migrations/
│   ├── 01_schema_and_policies.sql      # Tablas, índices, tabla privada credenciales_qr y RLS
│   ├── 02_rpc_functions.sql            # Funciones atómicas (puertas, offline, desempate y mesa)
│   └── 03_views.sql                    # Vista consolidada para Coordinación Académica
├── tests/
│   ├── test_concurrencia.js            # Simulación de estrés (15 peticiones en paralelo)
│   └── seed_mock_data.sql              # Datos sintéticos y pruebas unitarias
├── package.json
├── .env.example
├── .gitignore
└── README.md
