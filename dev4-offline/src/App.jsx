import React, { useState } from 'react';
import ScannerComponent from './components/ScannerComponent';
import SemaphoreOverlay from './components/SemaphoreOverlay';

// Importamos la función del Dev 4
import { procesarEscaneo } from './qr/escanear';

function App() {
  const [status, setStatus] = useState('IDLE'); // Estados: IDLE, PROCESSING, OK, ALERTA, ERROR
  const [isProcessing, setIsProcessing] = useState(false);

  const handleScan = async (decodedText) => {
    // Evitamos escanear doble mientras se procesa uno
    if (isProcessing) return;
    setIsProcessing(true);
    setStatus('PROCESSING');

    try {
      // 1. Mandamos el texto del QR a la lógica del Dev 4
      const resultado = await procesarEscaneo(decodedText);
      
      // 2. Evaluamos su respuesta
      if (resultado.ok) {
        // Todo en orden (Verde)
        setStatus('OK');
        new Audio('/Sonido acierto.mp3').play().catch(e => console.log(e));
      } else {
        // Falló por algo. Verificamos el motivo.
        if (resultado.motivo === 'ya_ingresado') {
          setStatus('ALERTA'); // Rojo
        } else {
          setStatus('ERROR'); // Amarillo (qr_invalido, qr_vencido, no_encontrado)
        }
        new Audio('/Sonido error.mp3').play().catch(e => console.log(e));
      }
    } catch (error) {
      console.error("Error crítico:", error);
      setStatus('ERROR');
      new Audio('/Sonido error.mp3').play().catch(e => console.log(e));
    }
  };

  // Esta función es llamada por el semáforo cuando el usuario toca la pantalla
  const handleDismiss = () => {
    setStatus('IDLE');
    setIsProcessing(false); // Liberamos la cámara para el siguiente alumno
  };

  return (
    <div style={{ width: '100%', height: '100vh', backgroundColor: 'black' }}>
      {/* La cámara siempre está debajo */}
      <ScannerComponent onScanResult={handleScan} isProcessing={isProcessing} />
      
      {/* El semáforo aparece encima tapando todo cuando hay un resultado */}
      <SemaphoreOverlay status={status} onDismiss={handleDismiss} />
    </div>
  );
}

export default App;