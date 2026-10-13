import { useState, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import ScannerComponent from '../components/ScannerComponent';
import SemaphoreOverlay from '../components/SemaphoreOverlay';
import Encabezado from '../components/Encabezado';
import { procesarEscaneo } from '../qr/escanear';
import { sincronizarCola } from '../sync/sync';
import { db } from '../db';
import { leerAjustes } from '../config';
import { useEnLinea } from '../useEnLinea';

const sonar = (archivo) => new Audio(archivo).play().catch(() => {});
const horaCorta = (d) => new Date(d).toLocaleTimeString('es-GT', { hour: 'numeric', minute: '2-digit' });
const horaLarga = (d) => new Date(d).toLocaleTimeString('es-GT', { hour: 'numeric', minute: '2-digit', second: '2-digit' });
const iniciales = (nombre = '') => nombre.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase() || '?';

const MOTIVOS = {
  qr_invalido: 'El QR es inválido o fue alterado.',
  qr_vencido: 'El QR ya venció.',
  no_encontrado: 'El carné no está en el padrón de este celular.',
};

// Cómo se muestra cada resultado en la tarjeta de verificación
const VISTAS = {
  OK: { tono: 'ok', insignia: 'Autorizado', mensaje: 'Asistencia registrada. Entrega 1 ticket físico.' },
  ALERTA: { tono: 'mal', insignia: 'Ya ingresó', mensaje: 'Este QR ya se usó hoy. Deriva a la mesa de resolución.' },
  ERROR: { tono: 'aviso', insignia: 'Rechazado', mensaje: 'Deriva a la mesa de resolución.' },
};

// Pantalla principal del staff: cámara (Dev 3) + lógica sin conexión (Dev 4), con el diseño de Stitch
export default function Escaner() {
  const enLinea = useEnLinea();
  const [status, setStatus] = useState('IDLE'); // IDLE, PROCESSING, OK, ALERTA, ERROR
  const [resultado, setResultado] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [escaneoId, setEscaneoId] = useState(0);
  const [ultimo, setUltimo] = useState(null); // último resultado, queda visible en la tarjeta
  const ajustes = leerAjustes();
  const dia = Number(ajustes.dia);

  const totalPadron = useLiveQuery(() => db.estudiantes.count(), [], null);
  const pendientes = useLiveQuery(() => db.cola_checkins.where('sincronizado').equals(0).count(), [], 0);
  // Ingresos de hoy: los de este celular y los de otras puertas que llegaron con el padrón
  const totalHoy = useLiveQuery(() => db.estudiantes.filter(e => Boolean(e[`dia${dia}`])).count(), [dia], 0);
  const recientes = useLiveQuery(async () => {
    const hoy = await db.cola_checkins.where('dia').equals(dia).toArray();
    hoy.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    const top = hoy.slice(0, 5);
    const ests = await db.estudiantes.bulkGet(top.map(c => c.carnet));
    return top.map((c, i) => ({ ...c, nombre: ests[i]?.nombre ?? c.carnet }));
  }, [dia], []);

  const handleScan = useCallback(async (decodedText) => {
    setIsProcessing(true);
    setEscaneoId(n => n + 1);
    setStatus('PROCESSING');
    let r = null;
    let estado = 'ERROR';
    try {
      r = await procesarEscaneo(decodedText);
      estado = r.ok ? 'OK' : r.motivo === 'ya_ingresado' ? 'ALERTA' : 'ERROR';
      if (r.ok && navigator.onLine) sincronizarCola(); // con señal, el ingreso se envía de inmediato
    } catch (error) {
      console.error('Error al procesar el QR:', error);
    }
    sonar(estado === 'OK' ? '/Sonido acierto.mp3' : '/Sonido error.mp3');
    setResultado(r);
    setStatus(estado);
    setUltimo({ r, estado, hora: new Date().toISOString() });
  }, []);

  const handleDismiss = useCallback(() => {
    setStatus('IDLE');
    setResultado(null);
    setIsProcessing(false); // la cámara vuelve a aceptar lecturas
  }, []);

  const sinPadron = totalPadron === 0;
  const vista = ultimo && VISTAS[ultimo.estado];

  return (
    <>
      <Encabezado activa="escaner" enLinea={enLinea} destacado={1}
        detalle={['Control de ingreso', ajustes.staffId || 'Sin operador', `Puerta ${ajustes.puerta}`, `Día ${dia}`]} />

      <main className="escaner">
        <section className="tarjeta tarjeta-camara" aria-label="Cámara">
          <div className="tarjeta-cab">
            <span className="vivo"><span className="punto" />Cámara de acceso lista</span>
            <span className="chip neutro">Cámara trasera</span>
          </div>
          {sinPadron && (
            <p className="aviso aviso" role="status">
              <b>Este celular no tiene el padrón.</b>{' '}
              {enLinea ? 'Se está descargando…' : 'Conéctate a internet para descargarlo.'}{' '}
              <a href="#/ajustes">Ir a ajustes</a>
            </p>
          )}
          <div className="visor">
            <ScannerComponent onScanResult={handleScan} isProcessing={isProcessing} />
          </div>
          <div className="visor-pie">
            <span>{pendientes ? `${pendientes} ingreso${pendientes === 1 ? '' : 's'} sin enviar` : 'Todos los ingresos enviados'}</span>
            <span>{totalPadron ?? '…'} estudiantes en el celular</span>
          </div>
        </section>

        <div className="columna">
          <section className="tarjeta verificacion" aria-live="polite">
            <div className="verificacion__cab">
              <span className="rotulo">Resultado de verificación</span>
              {vista && <span className={`chip ${vista.tono}`}>{vista.insignia}</span>}
            </div>
            {ultimo ? (
              <>
                <div className="persona">
                  <div className={`avatar ${vista.tono}`}>{ultimo.r?.carnet ? iniciales(ultimo.r.nombre) : '!'}</div>
                  <div>
                    <h2>{ultimo.r?.nombre || (ultimo.r?.carnet ? 'Sin nombre en el padrón' : 'QR no válido')}</h2>
                    {ultimo.r?.carnet && <span className="chip neutro">Carné: {ultimo.r.carnet}</span>}
                  </div>
                </div>
                <div className="datos">
                  <div><span>Hora de lectura</span><b>{horaLarga(ultimo.hora)}</b></div>
                  <div><span>Punto de acceso</span><b>Puerta {ajustes.puerta} · Día {dia}</b></div>
                </div>
                <p className={`banner ${vista.tono}`}>
                  {ultimo.estado === 'ERROR' && ultimo.r?.motivo && MOTIVOS[ultimo.r.motivo] ? `${MOTIVOS[ultimo.r.motivo]} ` : ''}
                  {vista.mensaje}
                </p>
              </>
            ) : (
              <p className="esperando">Esperando lectura. Apunta el código QR del estudiante a la cámara.</p>
            )}
          </section>

          <section className="tarjeta ultimos">
            <div className="ultimos__cab">
              <span className="titulo-tarjeta">Últimos accesos</span>
              <span className="tenue">Total hoy: <b>{totalHoy}</b></span>
            </div>
            {recientes.length ? recientes.map(c => (
              <div key={c.id} className="fila">
                <span>{c.nombre}</span>
                <span className="tenue">{horaCorta(c.timestamp)}</span>
              </div>
            )) : <p className="vacio">Aún no hay ingresos hoy en este celular.</p>}
          </section>
        </div>
      </main>

      <SemaphoreOverlay key={escaneoId} status={status} resultado={resultado} onDismiss={handleDismiss} />
    </>
  );
}
