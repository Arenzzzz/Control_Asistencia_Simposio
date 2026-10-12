#!/bin/bash
# Activa el envío automático cada 5 minutos en esta Mac (launchd).
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
PLIST="$HOME/Library/LaunchAgents/com.simposio.envios.plist"
[ -f "$HOME/.simposio.env" ] || { echo "Falta ~/.simposio.env (copia simposio.env.ejemplo y llénalo)."; exit 1; }
[ -x "$HOME/.venv-simposio/bin/python3" ] || { echo "Falta el entorno ~/.venv-simposio."; exit 1; }
chmod 600 "$HOME/.simposio.env"
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.simposio.envios</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>$DIR/ciclo_automatico.sh</string></array>
  <key>StartInterval</key><integer>300</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$HOME/simposio-envios.log</string>
  <key>StandardErrorPath</key><string>$HOME/simposio-envios.log</string>
</dict>
</plist>
PLIST
launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Envío automático activado: corre ahora y luego cada 5 minutos."
echo "Registro: tail -f ~/simposio-envios.log"
