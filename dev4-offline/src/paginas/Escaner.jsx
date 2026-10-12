import React, { useState } from 'react';
import ScannerComponent from '../components/ScannerComponent';
import SemaphoreOverlay from '../components/SemaphoreOverlay';
import { procesarEscaneo } from '../qr/escanear';

export default function Escaner() {
  const [status, setStatus] = useState('IDLE');
  const [isProcessing, setIsProcessing] = useState(false);

  const handleScan = async (decodedText) => {
    if (isProcessing) return;
    setIsProcessing(true);
    setStatus('PROCESSING');

    try {
      const resultado = await procesarEscaneo(decodedText);
      
      if (resultado.ok) {
        setStatus('OK');
        new Audio('/Sonido acierto.mp3').play().catch(e => console.log(e));
      } else {
        if (resultado.motivo === 'ya_ingresado') {
          setStatus('ALERTA');
        } else {
          setStatus('ERROR');
        }
        new Audio('/Sonido error.mp3').play().catch(e => console.log(e));
      }
    } catch (error) {
      console.error("Error crítico:", error);
      setStatus('ERROR');
      new Audio('/Sonido error.mp3').play().catch(e => console.log(e));
    }
  };

  const handleDismiss = () => {
    setStatus('IDLE');
    setIsProcessing(false);
  };

  return (
    <div style={{ width: '100%', height: '100vh', backgroundColor: 'black' }}>
      {/* Asegúrate de que tu ScannerComponent.jsx tenga fps: 10 y NO tenga focusMode continuous */}
      <ScannerComponent onScanResult={handleScan} isProcessing={isProcessing} />
      <SemaphoreOverlay status={status} onDismiss={handleDismiss} />
    </div>
  );
}