// Barra superior común (diseño de Stitch): identidad del simposio, contexto de la puerta,
// estado de la conexión y navegación entre escáner, mesa y ajustes.
const ICONOS = {
  escaner: 'M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z',
  mesa: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01',
  ajustes: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065zM15 12a3 3 0 11-6 0 3 3 0 016 0z',
};

const SECCIONES = [
  { id: 'escaner', ruta: '#/', texto: 'Escáner de puerta', corto: 'Escáner' },
  { id: 'mesa', ruta: '#/mesa', texto: 'Mesa de resolución', corto: 'Mesa' },
  { id: 'ajustes', ruta: '#/ajustes', texto: 'Ajustes', corto: 'Ajustes' },
];

export function Icono({ nombre, tam = 20 }) {
  return (
    <svg width={tam} height={tam} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONOS[nombre]} />
    </svg>
  );
}

// activa: 'escaner' | 'mesa' | 'ajustes' | null (sin navegación, para el portal de estudiantes)
// detalle: textos de contexto, p. ej. ['Control de ingreso', 'Luis', 'Puerta 1', 'Día 1']
// destacado: índice de detalle que se resalta (el operador)
export default function Encabezado({ activa = null, enLinea, detalle = [], destacado = -1 }) {
  return (
    <header className="barra-app">
      <div className="barra-app__in">
        <div className="marca">
          <div className="marca__logo" aria-hidden="true">19</div>
          <div className="marca__texto">
            <p className="marca__titulo">XIX Simposio de Ingeniería</p>
            {detalle.length > 0 && (
              <p className="marca__detalle">
                {detalle.map((d, i) => (
                  <span key={i} className={i === destacado ? 'destacado' : undefined}>{d}</span>
                ))}
              </p>
            )}
          </div>
          {enLinea !== undefined && (
            <span className={`estado-red ${enLinea ? 'ok' : 'mal'}`}>{enLinea ? 'En línea' : 'Sin conexión'}</span>
          )}
        </div>
        {activa && (
          <nav className="nav" aria-label="Secciones">
            {SECCIONES.map(s => (
              <a key={s.id} href={s.ruta} className={s.id === activa ? 'activa' : undefined}
                aria-current={s.id === activa ? 'page' : undefined}>
                <Icono nombre={s.id} />
                <span className="nav__largo">{s.texto}</span>
                <span className="nav__corto">{s.corto}</span>
              </a>
            ))}
          </nav>
        )}
      </div>
    </header>
  );
}
