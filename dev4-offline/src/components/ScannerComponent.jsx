import React, { useEffect, useRef } from "react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";

export default function ScannerComponent({ onScanResult, isProcessing }) {
  const scannerRegionId = "qr-reader";
  const scannerRef = useRef(null);

  useEffect(() => {
    const html5QrCode = new Html5Qrcode(scannerRegionId);
    scannerRef.current = html5QrCode;

    const config = {
      fps: 30, // Escaneo casi instantáneo
      qrbox: { width: 250, height: 250 },
      aspectRatio: 1.0,
      formatsToSupport: [ Html5QrcodeSupportedFormats.QR_CODE ] // Desactiva la búsqueda de códigos de barras
    };

    html5QrCode.start(
      { 
        facingMode: "environment",
        advanced: [{ focusMode: "continuous" }] // Fuerza el hardware del celular a enfocar rápido
      },
      config,
      (decodedText) => {
        if (!isProcessing) {
          onScanResult(decodedText);
        }
      },
      (errorMessage) => {} // Ignorar errores de no-detección frame a frame
    ).catch((err) => {
      console.error("Error al iniciar la cámara.", err);
    });

    return () => {
      if (html5QrCode.isScanning) {
        html5QrCode.stop().catch(console.error);
      }
    };
  }, [isProcessing, onScanResult]);

  // En Vite usamos style={} para algunos estilos complejos o dependemos del CSS de Tailwind
  return (
    <div style={{ position: 'relative', width: '100%', height: '100vh', backgroundColor: 'black', overflow: 'hidden', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
      <div id={scannerRegionId} style={{ width: '100%', maxWidth: '400px', height: '100%', objectFit: 'cover' }}></div>
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