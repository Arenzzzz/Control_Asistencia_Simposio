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
    // Colores del diseño de Stitch: salvia (acceso), terracota (ya ingresó), ámbar (QR inválido)
    'OK': { color: '#3e5c41', title: 'ACCESO CONCEDIDO', subtitle: 'Entregar 1 ticket físico', icon: '✓' },
    'ALERTA': { color: '#9e3d22', title: 'DENEGADO / YA INGRESÓ', subtitle: 'Derivar a la mesa de resolución', icon: '✕' },
    'ERROR': { color: '#8a5a14', title: 'QR INVÁLIDO O ERROR', subtitle: 'Derivar a la mesa de resolución', icon: '!' }
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
        color: '#faf8f5', backgroundColor: current.color, cursor: canDismiss ? 'pointer' : 'not-allowed', textAlign: 'center'
      }}
    >
      <span aria-hidden="true" style={{ width: '7rem', height: '7rem', borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: '4rem', fontWeight: 700, background: 'rgba(250,248,245,0.18)', border: '3px solid rgba(250,248,245,0.6)', marginBottom: '1.5rem' }}>{current.icon}</span>
      <h1 style={{ color: 'inherit', fontSize: 'clamp(2rem, 8vw, 3rem)', fontWeight: 800, letterSpacing: '-0.02em', padding: '0 1rem', margin: 0 }}>{current.title}</h1>
      {resultado?.carnet && (
        <p style={{ fontSize: '1.4rem', margin: '1rem 1rem 0', fontWeight: 'bold' }}>
          {resultado.nombre || 'Sin nombre'} · {resultado.carnet}
        </p>
      )}
      {resultado && !resultado.ok && MOTIVOS[resultado.motivo] && (
        <p style={{ fontSize: '1.1rem', margin: '0.5rem 1rem 0' }}>{MOTIVOS[resultado.motivo]}</p>
      )}
      <p style={{ fontSize: '1.5rem', fontWeight: 'bold', backgroundColor: 'rgba(44,37,35,0.28)', padding: '0.6rem 1.2rem', borderRadius: '9999px', margin: '1.5rem 1rem 0' }}>
        {current.subtitle}
      </p>
      
      {/* Indicador visual de bloqueo */}
      <p style={{ position: 'absolute', bottom: '2.5rem', fontSize: '1.125rem', opacity: canDismiss ? 1 : 0.4, transition: 'opacity 0.3s' }}>
        {canDismiss ? "Toca la pantalla para continuar" : "Espera 2 segundos..."}
      </p>
    </div>
  );
}