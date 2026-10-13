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

  // Estilos en index.css (.lector): el visor ocupa la tarjeta de la cámara del diseño de Stitch
  return (
    <div className="lector">
      <div id={scannerRegionId} className="lector__video"></div>
      <div className="lector__capa">
        <div className="lector__marco">
          <div className="scan-line"></div>
        </div>
        <p className="lector__ayuda">Apunta el código QR del carné</p>
      </div>
    </div>
  );
}
