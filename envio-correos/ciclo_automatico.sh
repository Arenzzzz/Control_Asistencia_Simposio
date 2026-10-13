#!/bin/bash
# Un ciclo del envío automático: firma los QR de las boletas que se volvieron VERDE
# (pipeline, portal o mesa) y envía los correos pendientes.
# Lo corre GitHub cada 5 minutos (.github/workflows/envio-automatico.yml) o, como respaldo, launchd en una Mac.
set -u
# En la Mac los datos vienen de ~/.simposio.env; en GitHub vienen de los secretos del repositorio.
if [ -f "$HOME/.simposio.env" ]; then
  source "$HOME/.simposio.env"
fi
PY="$HOME/.venv-simposio/bin/python3"
[ -x "$PY" ] || PY="python3"
DIR="$(cd "$(dirname "$0")" && pwd)"
RAIZ="$(dirname "$DIR")"

# Evita que dos ciclos corran a la vez si uno tarda más de 5 minutos
LOCK="/tmp/simposio-envios.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  echo "$(date '+%Y-%m-%d %H:%M:%S') El ciclo anterior sigue corriendo; se omite este."
  exit 0
fi
trap 'rmdir "$LOCK"' EXIT

echo "=== $(date '+%Y-%m-%d %H:%M:%S') ==="
cd "$RAIZ/DEV 1" && "$PY" correr_pipeline.py --vence "$VENCE" --solo-credenciales
cd "$DIR"
if [ -n "${CARNETS_PRUEBA:-}" ]; then
  # Modo prueba: solo los QR de esos carnés (los avisos amarillos se mandan a mano en pruebas)
  "$PY" enviar_correos.py --verdes --carnets "$CARNETS_PRUEBA" --limite "${LIMITE:-40}"
else
  "$PY" enviar_correos.py --verdes --amarillas --limite "${LIMITE:-40}"
fi
