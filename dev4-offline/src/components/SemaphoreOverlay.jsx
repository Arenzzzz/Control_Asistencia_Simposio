import { useState, useEffect } from 'react';

const MOTIVOS = {
  qr_invalido: 'QR inválido o alterado',
  qr_vencido: 'QR vencido',
  no_encontrado: 'El carné no está en el padrón de este celular',
  ya_ingresado: 'Este QR ya se usó hoy',
};

export default function SemaphoreOverlay({ status, resultado, onDismiss }) {
  const [canDismiss, setCanDismiss] = useState(false);

  useEffect(() => {
    // Cuando el semáforo aparece, bloqueamos el toque por 2 segundos
    // (el componente se vuelve a montar en cada escaneo, así que canDismiss empieza en false)
    if (status !== 'IDLE' && status !== 'PROCESSING') {
      const timer = setTimeout(() => {
        setCanDismiss(true); // Después de 2 seg, ya se permite el toque
      }, 2000);
      
      return () => clearTimeout(timer); // Limpieza de seguridad
    }
  }, [status]);

  if (status === 'IDLE' || status === 'PROCESSING') return null;

  const config = {
    'OK': { color: '#16a34a', title: 'ACCESO CONCEDIDO', subtitle: 'Entregar 1 Ticket Físico', icon: '✅' },
    'ALERTA': { color: '#dc2626', title: 'DENEGADO / YA INGRESÓ', subtitle: 'Derivar a Mesa de Problemas INMEDIATAMENTE', icon: '⛔' },
    'ERROR': { color: '#eab308', title: 'QR INVÁLIDO O ERROR', subtitle: 'Derivar a Mesa de Problemas', icon: '⚠️' }
  };

  const current = config[status] || config['ERROR'];

  const handleClick = () => {
    // Solo permitimos cerrar si ya pasaron los 2 segundos
    if (canDismiss) {
      onDismiss();
    }
  };

  return (
    <div 
      onClick={handleClick}
      style={{
        position: 'fixed', inset: 0, zIndex: 50, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        color: 'white', backgroundColor: current.color, cursor: canDismiss ? 'pointer' : 'not-allowed', textAlign: 'center'
      }}
    >
      <span style={{ fontSize: '6rem', marginBottom: '1rem' }}>{current.icon}</span>
      <h1 style={{ fontSize: '3rem', fontWeight: '900', padding: '0 1rem', margin: 0 }}>{current.title}</h1>
      {resultado?.carnet && (
        <p style={{ fontSize: '1.4rem', margin: '1rem 1rem 0', fontWeight: 'bold' }}>
          {resultado.nombre || 'Sin nombre'} · {resultado.carnet}
        </p>
      )}
      {resultado && !resultado.ok && MOTIVOS[resultado.motivo] && (
        <p style={{ fontSize: '1.1rem', margin: '0.5rem 1rem 0' }}>{MOTIVOS[resultado.motivo]}</p>
      )}
      <p style={{ fontSize: '1.5rem', marginTop: '1.5rem', fontWeight: 'bold', backgroundColor: 'rgba(0,0,0,0.3)', padding: '0.5rem 1rem', borderRadius: '0.75rem' }}>
        {current.subtitle}
      </p>
      
      {/* Indicador visual de bloqueo */}
      <p style={{ position: 'absolute', bottom: '2.5rem', fontSize: '1.125rem', opacity: canDismiss ? 1 : 0.4, transition: 'opacity 0.3s' }}>
        {canDismiss ? "Toca la pantalla para continuar" : "Espera 2 segundos..."}
      </p>
    </div>
  );
}