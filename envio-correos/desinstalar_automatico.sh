#!/bin/bash
# Detiene el envío automático.
PLIST="$HOME/Library/LaunchAgents/com.simposio.envios.plist"
launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
rm -f "$PLIST"
echo "Envío automático detenido."
