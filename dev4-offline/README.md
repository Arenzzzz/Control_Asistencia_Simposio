# Dev 4 · Funcionamiento sin conexión y portal de zona amarilla

App web (PWA) del XIX Simposio de Ingeniería. Funciona sin internet en la puerta del evento y envía los ingresos al servidor cuando vuelve la conexión.

## Cómo correrla

```bash
npm install
cp .env.example .env.local         # y llenar VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY
npm run dev                        # desarrollo: http://localhost:5173
npm run build && npm run preview   # versión instalable (PWA): http://localhost:4173
```

## Pantallas

| Ruta | Para quién | Qué hace |
|---|---|---|
| `#/` | Staff en la puerta | Escáner con cámara y semáforo (Dev 3). Muestra conexión, día, puerta e ingresos sin enviar. |
| `#/ajustes` | Staff en la puerta | Configura operador, puerta y día; descarga el padrón; muestra los ingresos y cuántos faltan por enviar; permite probar un QR pegando su texto. |
| `#/panel` | Coordinación | Estadísticas en vivo (pagos, QR, ingresos por hora y puerta, zonas) y descarga de registros en CSV. Usa la clave de la mesa y las funciones de `07_panel.sql`. |
| `#/mesa` | Mesa de resolución | Busca por carné, nombre o boleta; asigna boletas sin dueño, registra ingresos manuales y reenvía QR. Necesita internet y la clave de la mesa. |
| `#/portal?boleta=B-10232` | Estudiante en zona amarilla | Confirma qué carné corresponde a su boleta. Llama a `resolver_excepcion_estudiante`. Este es el enlace que va en el correo de Dev 5. Al confirmar, pide el envío inmediato del QR. |
| `#/panel` | Coordinación | Estadísticas en vivo (pagos, QR, ingresos por hora y puerta, zonas) y descarga de registros en CSV. Usa la clave de la mesa y las funciones de `07_panel.sql`. |
| `#/mesa` | Mesa de resolución | Busca por carné, nombre o boleta; asigna boletas, registra ingresos, reenvía el QR y tiene el botón "Enviar QR pendientes ahora". |

## Función para la pantalla de escaneo (Dev 3)

```js
import { procesarEscaneo } from './src/qr/escanear';

const r = await procesarEscaneo(textoDelQr);           // usa día, puerta y operador guardados en el celular
const r = await procesarEscaneo(textoDelQr, 1, '3');   // o se indican a mano
// r = { ok: true, carnet, nombre }
//   | { ok: false, motivo: 'qr_invalido' | 'qr_vencido' | 'no_encontrado' | 'ya_ingresado', carnet?, nombre? }
```

No necesita internet. La sincronización y la actualización del padrón corren solas en las pantallas del staff (`useMantenimiento`).

## Cómo funciona

1. **Antes del evento (con internet):** se descargan `padron_estudiantes` y los ingresos ya registrados a IndexedDB (Dexie).
2. **En la puerta (sin internet):** el QR se verifica con la llave pública RS256 de Dev 1 (`src/qr/public_key.pem`), se busca el carné en el padrón local y se revisa que no haya entrado ese día. El ingreso se guarda en `cola_checkins` con un UUID, el operador y la hora real del escaneo.
3. **Al volver la red:** la cola se envía a `sincronizar_checkins_offline` (al reconectar, al volver a la app y cada 30 s). Solo se marca como enviado lo que el servidor confirma; lo demás se reintenta.

## Archivos

- `src/db.js` · base local, registro de ingresos y carga del padrón
- `src/config.js` · operador, puerta y día de este celular
- `src/qr/` · verificación del QR y `procesarEscaneo`
- `src/sync/` · conexión con Supabase: sincronización, padrón y portal
- `src/paginas/` · pantallas de puerta y portal
