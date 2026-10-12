import { useEffect, useRef } from "react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";

export default function ScannerComponent({ onScanResult, isProcessing }) {
  const scannerRegionId = "qr-reader";
  const scannerRef = useRef(null);
  // Se guardan en refs para que la cámara se inicie una sola vez y no se reinicie en cada escaneo
  const onScanRef = useRef(onScanResult);
  const ocupadoRef = useRef(isProcessing);
  useEffect(() => { onScanRef.current = onScanResult; }, [onScanResult]);
  useEffect(() => { ocupadoRef.current = isProcessing; }, [isProcessing]);

  useEffect(() => {
    const html5QrCode = new Html5Qrcode(scannerRegionId, {
      formatsToSupport: [ Html5QrcodeSupportedFormats.QR_CODE ], // Desactiva la búsqueda de códigos de barras
      verbose: false
    });
    scannerRef.current = html5QrCode;

    const config = {
      fps: 10, // Escaneo estable
      qrbox: { width: 250, height: 250 },
      aspectRatio: 1.0,
      formatsToSupport: [ Html5QrcodeSupportedFormats.QR_CODE ] // Desactiva la búsqueda de códigos de barras
    };

    let detenido = false;
    const inicio = html5QrCode.start(
      { 
        facingMode: "environment" 
        // ¡Línea de focusMode eliminada para máxima estabilidad!
      },
      config,
      (decodedText) => {
        if (!ocupadoRef.current) {
          ocupadoRef.current = true; // evita dos lecturas del mismo QR en el mismo instante
          onScanRef.current(decodedText);
        }
      },
      () => {} // Ignorar errores de no-detección frame a frame
    ).catch((err) => {
      console.error("Error al iniciar la cámara.", err);
    });

    return () => {
      if (detenido) return;
      detenido = true;
      inicio.then(() => {
        if (html5QrCode.isScanning) return html5QrCode.stop();
      }).catch(console.error);
    };
  }, []);

  // En Vite usamos style={} para algunos estilos complejos o dependemos del CSS de Tailwind
  return (
    <div style={{ position: 'relative', width: '100%', height: '100vh', backgroundColor: 'black', overflow: 'hidden', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
      <div id={scannerRegionId} style={{ width: '100%', maxWidth: '400px' }}></div>
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: '250px', height: '250px', border: '4px solid rgba(255,255,255,0.5)', borderRadius: '16px', position: 'relative', boxShadow: '0 0 0 1000px rgba(0,0,0,0.5)' }}>
          {/* Línea de escaneo simulada con CSS en index.css */}
          <div className="scan-line" style={{ width: '100%', height: '4px', backgroundColor: '#4ade80', position: 'absolute', top: 0 }}></div>
        </div>
        <p style={{ marginTop: '2rem', color: 'white', fontWeight: 'bold', fontSize: '1.125rem', backgroundColor: 'rgba(0,0,0,0.5)', padding: '0.5rem 1rem', borderRadius: '0.5rem', backdropFilter: 'blur(4px)' }}>
          Apunta el código QR del carné
        </p>
      </div>
    </div>
  );
}