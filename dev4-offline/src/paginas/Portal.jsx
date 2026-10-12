import { useState } from 'react';
import { resolverExcepcion } from '../sync/portal';
import { useEnLinea } from '../useEnLinea';

// La boleta puede venir en el enlace del correo: #/portal?boleta=B-10232
function boletaDelEnlace() {
  const q = window.location.hash.split('?')[1] ?? window.location.search.slice(1);
  return new URLSearchParams(q).get('boleta') ?? '';
}

export default function Portal() {
  const enLinea = useEnLinea();
  const [boleta, setBoleta] = useState(boletaDelEnlace);
  const [carnet, setCarnet] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [respuesta, setRespuesta] = useState(null);

  async function enviar(e) {
    e.preventDefault();
    if (!boleta.trim() || !carnet.trim()) {
      setRespuesta({ ok: false, mensaje: 'Escribe el número de boleta y tu carné.' });
      return;
    }
    setEnviando(true);
    setRespuesta(await resolverExcepcion(carnet, boleta));
    setEnviando(false);
  }

  return (
    <div className="pagina estrecha">
      <header className="encabezado">
        <div>
          <h1>Confirma tu entrada</h1>
          <p className="tenue">XIX Simposio de Ingeniería</p>
        </div>
      </header>

      {respuesta?.ok ? (
        <section className="bloque">
          <div className="resultado ok">
            <b>Listo, {respuesta.nombre}</b>
            <span>Tu boleta quedó vinculada al carné {carnet.trim()}. Recibirás tu QR de acceso en tu correo institucional.</span>
          </div>
        </section>
      ) : (
        <section className="bloque">
          <p>Encontramos tu pago, pero el nombre de la boleta coincide con más de un estudiante o tiene diferencias.
            Confirma tu carné para generar tu entrada.</p>
          <form onSubmit={enviar} className="formulario">
            <label>Número de boleta
              <input id="boleta" value={boleta} onChange={e => setBoleta(e.target.value)} placeholder="Como aparece en tu comprobante" autoComplete="off" />
            </label>
            <label>Carné
              <input id="carnet" value={carnet} onChange={e => setCarnet(e.target.value)} placeholder="Ej. 2026-0002" autoComplete="off" inputMode="text" />
            </label>
            <button className="principal" type="submit" disabled={enviando || !enLinea}>
              {enviando ? 'Confirmando…' : 'Confirmar'}
            </button>
          </form>
          {!enLinea && <p className="aviso aviso">Necesitas conexión a internet para confirmar.</p>}
          {respuesta && !respuesta.ok && <p className="aviso mal" role="alert">{respuesta.mensaje}</p>}
          <p className="tenue">Si tus datos no coinciden, acércate a la mesa de resolución el día del evento con tu comprobante de pago.</p>
        </section>
      )}
    </div>
  );
}
