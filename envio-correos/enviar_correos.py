"""Envío de correos del XIX Simposio de Ingeniería.

- Zona VERDE: el QR firmado de cada estudiante (una sola vez por credencial).
- Zona AMARILLA: aviso a los candidatos de cada boleta para que confirmen en el portal.
- Solo se envía lo aprobado: los QR del autómata y los avisos esperan el botón
  "Aprobar y enviar" del Panel; los del portal y la mesa salen de inmediato.

Lee la base con DATABASE_URL y envía por SMTP (sirve Gmail, el correo de la
universidad o el SMTP de Resend). Marca cada envío en la base, así que se puede
correr varias veces o por partes sin repetir correos.

Uso:
  export DATABASE_URL="postgresql://..."
  export SMTP_HOST="smtp.gmail.com" SMTP_PORT="587"
  export SMTP_USER="cuenta@gmail.com" SMTP_PASS="contraseña-de-aplicación"
  export SMTP_FROM="Simposio de Ingeniería <cuenta@gmail.com>"

  python enviar_correos.py --prueba tu-correo@ejemplo.com   # manda un ejemplo de cada tipo solo a ti
  python enviar_correos.py --verdes --limite 100            # QR, de 100 en 100
  python enviar_correos.py --amarillas                      # avisos del portal
  python enviar_correos.py --verdes --amarillas --carnets 1517925,1052124   # solo a esos carnés (pruebas)
"""
from __future__ import annotations

import argparse
import html
import io
import os
import smtplib
import sys
import time
from email.message import EmailMessage
from email.utils import make_msgid

import psycopg
import segno

PORTAL = "https://simposio-xix-url.netlify.app/#/portal"
FECHAS = "jueves 15 y viernes 16 de octubre"
# Pausa entre correos: Microsoft 365 permite unos 30 por minuto por cuenta; con 3 s salen unos 20
PAUSA_SEG = float(os.environ.get("PAUSA_SEG", "3"))
POR_SESION = int(os.environ.get("POR_SESION", "40"))  # correos por sesión antes de reconectar
REINTENTOS = 3  # reconexiones por correo si el servidor corta la sesión


class EnvioDetenido(Exception):
    """El servidor de correo rechazó el envío (límite de envío, sesión cerrada, etc.)."""


def qr_png(token: str) -> bytes:
    buf = io.BytesIO()
    segno.make_qr(token, error="m").save(buf, kind="png", scale=6, border=4)
    return buf.getvalue()


def correo_verde(nombre: str, carnet: str, token: str) -> EmailMessage:
    m = EmailMessage()
    m["Subject"] = "Tu entrada al XIX Simposio de Ingeniería"
    cid = make_msgid(domain="simposio.local")
    n = html.escape(nombre)
    m.set_content(
        f"Hola, {nombre}.\n\nTu pago fue validado. Presenta el QR adjunto en la entrada del simposio, "
        f"el {FECHAS}. Es el mismo QR para los dos días y solo permite una entrada por día, "
        f"así que no lo compartas.\n\nCarné: {carnet}\n"
    )
    m.add_alternative(f"""\
<div style="font-family:Arial,sans-serif;color:#142033;max-width:480px;margin:auto;text-align:center">
  <h2 style="color:#123b6d">XIX Simposio de Ingeniería</h2>
  <p>Hola, <b>{n}</b>. Tu pago fue validado.</p>
  <p>Presenta este código en la entrada el <b>{FECHAS}</b>.</p>
  <img src="cid:{cid[1:-1]}" alt="Código QR de acceso" width="300" style="border:1px solid #d3d9e3;border-radius:8px">
  <p style="font-size:13px;color:#5b677a">Carné {html.escape(carnet)} · Es el mismo QR para los dos días y solo permite
  una entrada por día. No lo compartas.</p>
</div>""", subtype="html")
    m.get_payload()[1].add_related(qr_png(token), maintype="image", subtype="png", cid=cid,
                                   filename=f"qr-{carnet}.png")
    return m


def correo_amarillo(nombre: str) -> EmailMessage:
    # No se incluye el número de boleta: solo quien hizo el pago lo tiene en su comprobante.
    m = EmailMessage()
    m["Subject"] = "Confirma tu inscripción al XIX Simposio de Ingeniería"
    n = html.escape(nombre)
    texto = (
        f"Hola, {nombre}.\n\nRecibimos un pago del simposio a un nombre parecido al tuyo, pero no pudimos "
        f"confirmar a quién pertenece. Si tú pagaste, entra al portal y escribe tu carné y el número de "
        f"boleta de tu comprobante:\n{PORTAL}\n\nSi no pagaste el simposio, ignora este correo.\n"
    )
    m.set_content(texto)
    m.add_alternative(f"""\
<div style="font-family:Arial,sans-serif;color:#142033;max-width:480px;margin:auto">
  <h2 style="color:#123b6d">XIX Simposio de Ingeniería</h2>
  <p>Hola, <b>{n}</b>.</p>
  <p>Recibimos un pago del simposio a un nombre parecido al tuyo, pero no pudimos confirmar a quién pertenece.</p>
  <p>Si tú pagaste, entra al portal y escribe tu carné y el número de boleta de tu comprobante:</p>
  <p style="text-align:center"><a href="{PORTAL}" style="background:#123b6d;color:#fff;padding:12px 20px;
  border-radius:8px;text-decoration:none;display:inline-block">Confirmar mi inscripción</a></p>
  <p style="font-size:13px;color:#5b677a">Si no pagaste el simposio, ignora este correo.</p>
</div>""", subtype="html")
    return m


class Correo:
    def __init__(self):
        faltan = [v for v in ("SMTP_HOST", "SMTP_USER", "SMTP_PASS") if not os.environ.get(v)]
        if faltan:
            sys.exit(f"Error: faltan las variables {', '.join(faltan)}")
        self.remitente = os.environ.get("SMTP_FROM") or os.environ["SMTP_USER"]
        # Las respuestas de los estudiantes van a esta dirección y no al correo que envía
        self.responder_a = os.environ.get("SMTP_REPLY_TO", "").strip()
        self.smtp = None
        self.en_sesion = 0
        self.conectar()

    def conectar(self):
        """Abre (o vuelve a abrir) la sesión con el servidor de correo."""
        self.cerrar()
        self.smtp = smtplib.SMTP(os.environ["SMTP_HOST"], int(os.environ.get("SMTP_PORT", "587")), timeout=30)
        if os.environ.get("SMTP_SIN_TLS") != "1":
            self.smtp.starttls()
        self.smtp.login(os.environ["SMTP_USER"], os.environ["SMTP_PASS"])
        self.en_sesion = 0

    def enviar(self, para: str, m: EmailMessage) -> None:
        m["From"] = self.remitente
        m["To"] = para
        if self.responder_a:
            m["Reply-To"] = self.responder_a
        # Microsoft cierra las sesiones largas: se abre una nueva cada cierto número de correos
        if self.en_sesion >= POR_SESION:
            self.conectar()
        for intento in range(1, REINTENTOS + 1):
            try:
                self.smtp.send_message(m)
                break
            except smtplib.SMTPRecipientsRefused:
                raise  # solo ese correo está mal: se sigue con los demás
            except (smtplib.SMTPServerDisconnected, ConnectionError, TimeoutError) as e:
                # Se cortó la sesión: se espera un poco, se vuelve a conectar y se reintenta el mismo correo
                if intento == REINTENTOS:
                    raise EnvioDetenido(str(e)) from e
                print(f"  Sesión cerrada por el servidor ({e}); reconectando (intento {intento})…")
                time.sleep(15 * intento)
                try:
                    self.conectar()
                except (smtplib.SMTPException, OSError) as e2:
                    raise EnvioDetenido(str(e2)) from e2
            except (smtplib.SMTPException, OSError) as e:
                # Límite de envío u otro rechazo: se detiene la tanda y lo pendiente sale en el siguiente ciclo
                raise EnvioDetenido(str(e)) from e
        self.en_sesion += 1
        time.sleep(PAUSA_SEG)

    def cerrar(self):
        if self.smtp is None:
            return
        try:
            self.smtp.quit()
        except (smtplib.SMTPException, OSError):
            pass  # la sesión ya estaba cerrada
        self.smtp = None


def enviar_verdes(conn, correo: Correo, limite: int, carnets: list[str] | None = None) -> int:
    with conn.cursor() as cur:
        cur.execute("""
            SELECT c.carnet, p.nombre_oficial, p.correo_institucional, c.token_qr
            FROM credenciales_qr c JOIN padron_estudiantes p USING (carnet)
            WHERE c.enviado_en IS NULL
              -- Solo los aprobados (10_aprobacion.sql); si la columna no existe, todos
              AND coalesce((to_jsonb(c)->>'aprobado')::boolean, TRUE)
              AND (%s::text[] IS NULL OR c.carnet = ANY(%s::text[]))
            ORDER BY c.carnet LIMIT %s;
        """, (carnets, carnets, limite))
        filas = cur.fetchall()
    enviados = 0
    for carnet, nombre, para, token in filas:
        try:
            correo.enviar(para, correo_verde(nombre, carnet, token))
        except smtplib.SMTPException as e:
            print(f"  No se pudo enviar a {carnet}: {e}")
            continue
        with conn.cursor() as cur:
            cur.execute("UPDATE credenciales_qr SET enviado_en = NOW() WHERE carnet = %s;", (carnet,))
        conn.commit()  # se marca uno por uno: si se corta, no se repite lo ya enviado
        enviados += 1
        print(f"  QR enviado a {carnet} ({enviados}/{len(filas)})")
    return enviados


def enviar_amarillas(conn, correo: Correo, limite: int, carnets: list[str] | None = None) -> int:
    with conn.cursor() as cur:
        cur.execute("""
            SELECT boleta, datos_extra->'candidatos'
            FROM tesoreria_pagos
            WHERE zona = 'AMARILLA' AND carnet_asignado IS NULL
              AND NOT (datos_extra ? 'aviso_portal_enviado')
              AND datos_extra ? 'aviso_aprobado'  -- aprobado en el Panel
              AND (%s::text[] IS NULL OR EXISTS (
                    SELECT 1 FROM jsonb_array_elements(datos_extra->'candidatos') c
                    WHERE c->>'carnet' = ANY(%s::text[])))
            ORDER BY boleta LIMIT %s;
        """, (carnets, carnets, limite))
        boletas = cur.fetchall()
    enviados = 0
    for boleta, candidatos in boletas:
        destinatarios = [c.get("carnet") for c in (candidatos or []) if isinstance(c, dict) and c.get("carnet")]
        if carnets is not None:  # en pruebas solo se escribe a los carnés indicados
            destinatarios = [c for c in destinatarios if c in carnets]
        if not destinatarios:
            print(f"  Boleta {boleta} sin candidatos: queda para la mesa de resolución")
            continue
        with conn.cursor() as cur:
            cur.execute("SELECT nombre_oficial, correo_institucional FROM padron_estudiantes WHERE carnet = ANY(%s);",
                        (destinatarios,))
            destinos = cur.fetchall()
        try:
            for nombre, para in destinos:
                correo.enviar(para, correo_amarillo(nombre))
                enviados += 1
        except smtplib.SMTPException as e:
            print(f"  No se pudo avisar la boleta {boleta}: {e}")
            continue
        if carnets is not None:
            # En pruebas no se marca la boleta: los demás candidatos aún no recibieron el aviso
            print(f"  Boleta {boleta}: aviso de prueba enviado a {len(destinos)} candidato(s)")
            continue
        with conn.cursor() as cur:
            cur.execute("""UPDATE tesoreria_pagos
                           SET datos_extra = datos_extra || jsonb_build_object('aviso_portal_enviado', NOW())
                           WHERE boleta = %s;""", (boleta,))
        conn.commit()
        print(f"  Boleta {boleta}: aviso enviado a {len(destinos)} candidato(s)")
    return enviados


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--verdes", action="store_true", help="Enviar los QR pendientes")
    ap.add_argument("--amarillas", action="store_true", help="Enviar los avisos del portal pendientes")
    ap.add_argument("--limite", type=int, default=100, help="Máximo de envíos por corrida (por defecto 100)")
    ap.add_argument("--prueba", metavar="CORREO", help="Enviar solo un ejemplo de cada tipo a este correo")
    ap.add_argument("--carnets", help="Enviar solo a estos carnés, separados por comas (para pruebas con el grupo)")
    a = ap.parse_args(argv)

    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        sys.exit("Error: define la variable de entorno DATABASE_URL")
    if not (a.verdes or a.amarillas or a.prueba):
        sys.exit("Indica --prueba CORREO, --verdes o --amarillas")

    carnets = [c.strip() for c in a.carnets.split(",") if c.strip()] if a.carnets else None
    correo = Correo()
    try:
        with psycopg.connect(db_url) as conn:
            if a.prueba:
                with conn.cursor() as cur:
                    cur.execute("SELECT c.carnet, p.nombre_oficial, c.token_qr FROM credenciales_qr c "
                                "JOIN padron_estudiantes p USING (carnet) ORDER BY c.carnet LIMIT 1;")
                    fila = cur.fetchone()
                if fila:
                    correo.enviar(a.prueba, correo_verde(fila[1], fila[0], fila[2]))
                correo.enviar(a.prueba, correo_amarillo("Estudiante de prueba"))
                print(f"Ejemplos enviados a {a.prueba}. No se marcó nada en la base.")
                return
            try:
                if a.verdes:
                    n = enviar_verdes(conn, correo, a.limite, carnets)
                    print(f"QR enviados en esta corrida: {n}")
                if a.amarillas:
                    n = enviar_amarillas(conn, correo, a.limite, carnets)
                    print(f"Avisos del portal enviados en esta corrida: {n}")
            except EnvioDetenido as e:
                # Lo que ya salió quedó marcado; el resto se envía en el siguiente ciclo
                print(f"Envío detenido por el servidor de correo: {e}")
                print("Lo pendiente se enviará en el siguiente ciclo. Si se repite, esperar unos minutos.")
                sys.exit(1)
    finally:
        correo.cerrar()


if __name__ == "__main__":
    main()
