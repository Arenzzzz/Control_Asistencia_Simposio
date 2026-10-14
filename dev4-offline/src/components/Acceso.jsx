import { useState } from 'react';
import { useEnLinea } from '../useEnLinea';

// Pantalla de acceso: solo pide la clave. La página se muestra cuando onEntrar responde ok.
export default function Acceso({ titulo, descripcion, etiqueta, ayuda, onEntrar, permitirSinConexion = false }) {
  const enLinea = useEnLinea();
  const [clave, setClave] = useState('');
  const [error, setError] = useState(null);
  const [entrando, setEntrando] = useState(false);

  async function entrar(e) {
    e.preventDefault();
    setEntrando(true); setError(null);
    const r = await onEntrar(clave.trim());
    setEntrando(false);
    if (!r.ok) setError(r.mensaje);
  }

  return (
    <div className="pagina estrecha">
      <section className="bloque acceso">
        <div className="acceso__candado" aria-hidden="true">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 018 0v4" />
          </svg>
        </div>
        <h1>{titulo}</h1>
        {descripcion && <p className="tenue">{descripcion}</p>}
        <form onSubmit={entrar} className="formulario">
          <label>{etiqueta}
            <input type="password" value={clave} onChange={e => setClave(e.target.value)} autoComplete="current-password" autoFocus />
          </label>
          <button className="principal" type="submit" disabled={entrando || !clave || (!enLinea && !permitirSinConexion)}>
            {entrando ? 'Comprobando…' : 'Entrar'}
          </button>
        </form>
        {!enLinea && !permitirSinConexion && <p className="aviso aviso">Necesitas internet para entrar.</p>}
        {error && <p className="aviso mal" role="alert">{error}</p>}
        {ayuda && <p className="tenue">{ayuda}</p>}
      </section>
    </div>
  );
}
