"""CLI del Dev 1: clasifica pagos y firma los QR conectándose a Supabase.

Uso:
  export DATABASE_URL="postgresql://..."      # Supabase → Connect → Session pooler
  python correr_pipeline.py --tarifa 300 --tarifa-docente 150 --vence 2026-10-16 --db
  python correr_pipeline.py --vence 2026-10-30 --solo-credenciales

--vence es el último día del simposio: los QR valen hasta las 23:59 de ese día
(hora de Guatemala). La llave privada se lee de private_key.pem (no se sube al repo).
"""
from __future__ import annotations
import argparse
import json
import os
import sys
from collections import Counter
from datetime import datetime, timedelta, timezone

import psycopg

from Clasificador import Config, clasificar_lote, separar_padron
from Firma_qr import sign_qr

HORA_GT = timezone(timedelta(hours=-6))


def fin_del_dia(fecha: str) -> int:
    """'2026-10-30' -> epoch de 2026-10-30 23:59:59 en Guatemala."""
    dia = datetime.strptime(fecha, "%Y-%m-%d").replace(tzinfo=HORA_GT)
    return int((dia + timedelta(days=1, seconds=-1)).timestamp())


def leer_padron_db(conn_url: str) -> list[dict]:
    with psycopg.connect(conn_url) as conn:
        with conn.cursor() as cur:
            # La columna tipo (ESTUDIANTE / DOCENTE) la agrega 09_docentes.sql
            cur.execute("SELECT EXISTS (SELECT 1 FROM information_schema.columns "
                        "WHERE table_name = 'padron_estudiantes' AND column_name = 'tipo');")
            con_tipo = cur.fetchone()[0]
            cur.execute("SELECT carnet, nombre_oficial, " + ("tipo" if con_tipo else "'ESTUDIANTE'")
                        + " FROM padron_estudiantes;")
            return [{"carnet": str(row[0]), "nombre": row[1], "tipo": row[2]} for row in cur.fetchall()]


def leer_pagos_db(conn_url: str) -> list[dict]:
    with psycopg.connect(conn_url) as conn:
        with conn.cursor() as cur:
            # La base guarda 'PENDIENTE' en mayúsculas
            cur.execute(
                "SELECT boleta, nombre_digitado, monto FROM tesoreria_pagos "
                "WHERE zona IS NULL OR upper(zona) = 'PENDIENTE';"
            )
            return [{"boleta": row[0], "nombre": row[1], "monto": row[2]} for row in cur.fetchall()]


def actualizar_db(filas: list[dict], conn_url: str) -> None:
    sql = """
        UPDATE tesoreria_pagos
        SET carnet_asignado = %s, zona = %s, datos_extra = %s::jsonb, estado = %s
        WHERE boleta = %s;
    """
    with psycopg.connect(conn_url) as conn:
        with conn.cursor() as cur:
            datos = [(f["carnet_asignado"], f["zona"], f["datos_extra"], 'PROCESADO', f["boleta"]) for f in filas]
            cur.executemany(sql, datos)
        conn.commit()


def generar_credenciales(conn_url: str, vence_epoch: int) -> int:
    """Firma el QR de cada boleta VERDE que aún no tiene credencial.

    Cubre las verdes del pipeline y las que se resolvieron después en el portal
    o en la mesa. Se puede correr las veces que haga falta: no repite QR.
    """
    with psycopg.connect(conn_url) as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT DISTINCT ON (t.carnet_asignado) t.carnet_asignado, t.boleta
                FROM tesoreria_pagos t
                WHERE t.zona = 'VERDE' AND t.carnet_asignado IS NOT NULL
                  AND NOT EXISTS (SELECT 1 FROM credenciales_qr c WHERE c.carnet = t.carnet_asignado)
                ORDER BY t.carnet_asignado, t.boleta;
            """)
            pendientes = cur.fetchall()
            for carnet, boleta in pendientes:
                token = sign_qr(str(carnet), vence_epoch)
                cur.execute(
                    "INSERT INTO credenciales_qr (carnet, token_qr, boleta_origen) VALUES (%s, %s, %s) "
                    "ON CONFLICT (carnet) DO NOTHING;",
                    (carnet, token, boleta),
                )
        conn.commit()
    return len(pendientes)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--tarifa", type=float, help="Monto de la boleta de estudiantes (ej. 300)")
    ap.add_argument("--tarifa-docente", type=float, help="Monto de la boleta de docentes (ej. 150)")
    ap.add_argument("--vence", required=True, help="Último día del simposio, AAAA-MM-DD")
    ap.add_argument("--db", action="store_true", help="Guardar la clasificación en Supabase")
    ap.add_argument("--solo-credenciales", action="store_true",
                    help="No clasifica; solo firma QR para las VERDE nuevas (portal y mesa)")
    a = ap.parse_args(argv)

    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        print("Error: define la variable de entorno DATABASE_URL")
        sys.exit(1)
    vence = fin_del_dia(a.vence)

    if not a.solo_credenciales:
        if a.tarifa is None:
            print("Error: falta --tarifa")
            sys.exit(1)
        print("Descargando registros de Supabase...")
        padron = separar_padron(leer_padron_db(db_url))
        print("Padrón: " + ", ".join(f"{len(p.people)} {t.lower()}s" for t, p in padron.items()))
        pagos = leer_pagos_db(db_url)
        print(f"Clasificando {len(pagos)} pagos pendientes...")
        resultados = clasificar_lote(pagos, padron, Config(tarifa=a.tarifa, tarifa_docente=a.tarifa_docente))
        print(dict(Counter(r.zona for r in resultados)), file=sys.stderr)

        if not a.db:
            print("Prueba sin guardar (agrega --db para guardar).")
            return
        if resultados:
            # Se usa la boleta tal como está en la base (el clasificador la normaliza)
            actualizar_db([{
                "boleta": p["boleta"],
                "carnet_asignado": r.carnet_asignado,
                "zona": r.zona,
                "datos_extra": json.dumps(r.datos_extra(), ensure_ascii=False),
            } for p, r in zip(pagos, resultados)], db_url)
            print("Clasificación guardada.")

    nuevas = generar_credenciales(db_url, vence)
    print(f"QR firmados: {nuevas} (válidos hasta {a.vence} 23:59, hora de Guatemala).")


if __name__ == "__main__":
    main()
