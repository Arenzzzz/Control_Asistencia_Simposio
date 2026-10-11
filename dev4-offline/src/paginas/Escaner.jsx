import { useState, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import ScannerComponent from '../components/ScannerComponent';
import SemaphoreOverlay from '../components/SemaphoreOverlay';
import { procesarEscaneo } from '../qr/escanear';
import { sincronizarCola } from '../sync/sync';
import { db } from '../db';
import { leerAjustes } from '../config';
import { useEnLinea } from '../useEnLinea';

const sonar = (archivo) => new Audio(archivo).play().catch(() => {});

// Pantalla principal del staff: cámara (Dev 3) + lógica sin conexión (Dev 4)
export default function Escaner() {
  const enLinea = useEnLinea();
  const [status, setStatus] = useState('IDLE'); // IDLE, PROCESSING, OK, ALERTA, ERROR
  const [resultado, setResultado] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [escaneoId, setEscaneoId] = useState(0);
  const ajustes = leerAjustes();

  const totalPadron = useLiveQuery(() => db.estudiantes.count(), [], null);
  const pendientes = useLiveQuery(() => db.cola_checkins.where('sincronizado').equals(0).count(), [], 0);

  const handleScan = useCallback(async (decodedText) => {
    setIsProcessing(true);
    setEscaneoId(n => n + 1);
    setStatus('PROCESSING');
    try {
      const r = await procesarEscaneo(decodedText);
      setResultado(r);
      if (r.ok) {
        setStatus('OK');
        sonar('/Sonido acierto.mp3');
        if (navigator.onLine) sincronizarCola(); // con señal, el ingreso se envía de inmediato
      } else {
        setStatus(r.motivo === 'ya_ingresado' ? 'ALERTA' : 'ERROR');
        sonar('/Sonido error.mp3');
      }
    } catch (error) {
      console.error('Error al procesar el QR:', error);
      setResultado(null);
      setStatus('ERROR');
      sonar('/Sonido error.mp3');
    }
  }, []);

  const handleDismiss = useCallback(() => {
    setStatus('IDLE');
    setResultado(null);
    setIsProcessing(false); // la cámara vuelve a aceptar lecturas
  }, []);

  const sinPadron = totalPadron === 0;

  return (
    <div style={{ width: '100%', height: '100vh', backgroundColor: 'black', position: 'relative' }}>
      <ScannerComponent onScanResult={handleScan} isProcessing={isProcessing} />

      <div className="barra-escaner">
        <span className={`estado-red ${enLinea ? 'ok' : 'mal'}`}>{enLinea ? 'En línea' : 'Sin conexión'}</span>
        <span>Día {ajustes.dia} · Puerta {ajustes.puerta}{pendientes ? ` · ${pendientes} sin enviar` : ''}</span>
        <a href="#/ajustes">Ajustes</a>
      </div>

      {sinPadron && (
        <div className="aviso-escaner">
          <b>Este celular no tiene el padrón.</b>
          <span>{enLinea ? 'Se está descargando…' : 'Conéctate a internet para descargarlo.'}</span>
          <a href="#/ajustes">Ir a ajustes</a>
        </div>
      )}

      <SemaphoreOverlay key={escaneoId} status={status} resultado={resultado} onDismiss={handleDismiss} />
    </div>
  );
}
