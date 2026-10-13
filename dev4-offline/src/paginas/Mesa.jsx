import { useState } from 'react';
import { leerAjustes } from '../config';
import { useEnLinea } from '../useEnLinea';
import { buscar, vincularBoleta, registrarIngreso, reenviarQr } from '../sync/mesa';
import { enviarAhora } from '../sync/envio';
import Encabezado from '../components/Encabezado';

const ZONAS = { VERDE: 'ok', AMARILLA: 'aviso', ROJA: 'mal', PENDIENTE: 'aviso' };
const hora = (iso) => new Date(iso).toLocaleString('es-GT', { dateStyle: 'short', timeStyle: 'short' });

function estadoQr(qr) {
  if (!qr) return ['Sin QR', 'mal'];
  if (!qr.enviado_en) return ['QR por enviar', 'aviso'];
  return [`QR enviado ${hora(qr.enviado_en)}`, 'ok'];
}

function Aviso({ r }) {
  if (!r) return null;
  return <p className={`aviso ${r.ok ? 'ok' : r.status === 'ALERTA' ? 'aviso' : 'mal'}`} role="status">{r.mensaje}</p>;
}

function TarjetaEstudiante({ e, sesion, alCambiar }) {
  const [just, setJust] = useState('');
  const [correo, setCorreo] = useState('');
  const [r, setR] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [q, qTipo] = estadoQr(e.qr);
  const entro = (d) => e.ingresos.some(i => i.dia === d);
  const boletaVerde = e.boletas.find(b => b.zona === 'VERDE')?.boleta ?? null;

  async function hacer(fn, enviar = false) {
    setOcupado(true);
    let res = await fn();
    if (res.ok && enviar) {
      const env = await enviarAhora();
      res = { ...res, mensaje: env.ok ? 'El QR se está enviando; llegará en 1 o 2 minutos.' : res.mensaje };
    }
    setR(res); setOcupado(false);
    if (res.ok) alCambiar();
  }

  return (
    <div className="bloque">
      <h2>{e.nombre}</h2>
      <p className="tenue">Carné {e.carnet} · {e.correo}</p>
      <div className="botones">
        {e.boletas.length
          ? e.boletas.map(b => <span key={b.boleta} className={`chip ${ZONAS[b.zona] ?? 'aviso'}`}>Boleta {b.boleta} · {b.zona}</span>)
          : <span className="chip mal">Sin boleta asignada</span>}
        <span className={`chip ${qTipo}`}>{q}</span>
        <span className={`chip ${entro(1) ? 'ok' : 'aviso'}`}>Día 1: {entro(1) ? 'ingresó' : 'no'}</span>
        <span className={`chip ${entro(2) ? 'ok' : 'aviso'}`}>Día 2: {entro(2) ? 'ingresó' : 'no'}</span>
      </div>
      <div className="campos" style={{ marginTop: 10 }}>
        <label>Justificación
          <input value={just} onChange={ev => setJust(ev.target.value)} placeholder="Ej. presentó DPI y comprobante" />
        </label>
        <label>Correo nuevo (opcional)
          <input value={correo} onChange={ev => setCorreo(ev.target.value)} placeholder="Para reenviar el QR a otro correo" type="email" />
        </label>
      </div>
      <div className="botones">
        <button className="principal" disabled={ocupado || entro(sesion.dia)}
          onClick={() => hacer(() => registrarIngreso(sesion.clave, e.carnet, boletaVerde, sesion.dia, sesion.operador, just))}>
          Registrar ingreso del día {sesion.dia}
        </button>
        <button disabled={ocupado || !e.qr}
          onClick={() => hacer(() => reenviarQr(sesion.clave, e.carnet, correo), true)}>
          Reenviar QR
        </button>
      </div>
      <Aviso r={r} />
    </div>
  );
}

function TarjetaBoleta({ b, sesion, alCambiar }) {
  const [just, setJust] = useState('');
  const [carnet, setCarnet] = useState('');
  const [r, setR] = useState(null);
  const [ocupado, setOcupado] = useState(false);

  async function asignar(c) {
    setOcupado(true);
    const res = await vincularBoleta(sesion.clave, b.boleta, c, sesion.operador, just);
    if (res.ok) enviarAhora(); // el QR del nuevo dueño sale de inmediato
    setR(res); setOcupado(false);
    if (res.ok) alCambiar();
  }

  return (
    <div className="bloque">
      <h2>Boleta {b.boleta}</h2>
      <p className="tenue">Nombre en la boleta: {b.nombre} · Q{Number(b.monto).toFixed(2)}</p>
      <div className="botones">
        <span className={`chip ${ZONAS[b.zona] ?? 'aviso'}`}>{b.zona}</span>
        {b.motivo && <span className="chip aviso">{b.motivo}</span>}
      </div>
      <label style={{ marginTop: 10 }}>Justificación
        <input value={just} onChange={ev => setJust(ev.target.value)} placeholder="Ej. comprobante original revisado" />
      </label>
      {b.candidatos.length > 0 && (
        <div className="botones">
          {b.candidatos.map(c => (
            <button key={c.carnet} disabled={ocupado} onClick={() => asignar(c.carnet)}>
              Asignar a {c.nombre ?? c.carnet} ({c.carnet})
            </button>
          ))}
        </div>
      )}
      <div className="botones">
        <input className="ancho" value={carnet} onChange={ev => setCarnet(ev.target.value)} placeholder="Otro carné" />
        <button className="principal" disabled={ocupado || !carnet.trim()} onClick={() => asignar(carnet)}>Asignar</button>
      </div>
      <Aviso r={r} />
    </div>
  );
}

export default function Mesa() {
  const enLinea = useEnLinea();
  const [operador, setOperador] = useState(() => leerAjustes().staffId || '');
  const [clave, setClave] = useState('');
  const [dia, setDia] = useState(() => leerAjustes().dia || 1);
  const [texto, setTexto] = useState('');
  const [res, setRes] = useState(null);
  const [buscando, setBuscando] = useState(false);
  const [envio, setEnvio] = useState(null);
  const [enviando, setEnviando] = useState(false);

  async function enviarPendientes() {
    setEnviando(true);
    setEnvio(await enviarAhora());
    setEnviando(false);
  }

  async function hacerBusqueda(e) {
    e?.preventDefault();
    if (!clave || texto.trim().length < 3) {
      setRes({ ok: false, mensaje: !clave ? 'Escribe la clave de la mesa.' : 'Escribe al menos 3 caracteres.' });
      return;
    }
    setBuscando(true);
    setRes(await buscar(clave, texto));
    setBuscando(false);
  }

  const sesion = { clave, operador: operador.trim() || 'Mesa', dia: Number(dia) };
  const nada = res?.ok && !res.estudiantes.length && !res.boletas.length;

  return (
    <>
    <Encabezado activa="mesa" enLinea={enLinea} destacado={1}
      detalle={['Mesa de resolución', operador.trim() || 'Sin operador', `Día ${dia}`]} />
    <div className="pagina">
      <div className="titulo-pagina">
        <h1>Mesa de resolución</h1>
        <p>Búsqueda y soporte por carné ilegible, QR perdido o boleta física.</p>
      </div>

      <section className="bloque">
        <div className="campos">
          <label>Operador<input value={operador} onChange={e => setOperador(e.target.value)} placeholder="Nombre de quien atiende" /></label>
          <label>Clave de la mesa<input type="password" value={clave} onChange={e => setClave(e.target.value)} autoComplete="current-password" /></label>
          <label>Día
            <select value={dia} onChange={e => setDia(Number(e.target.value))}>
              <option value={1}>Día 1</option><option value={2}>Día 2</option>
            </select>
          </label>
        </div>
        <form onSubmit={hacerBusqueda} className="botones">
          <input className="ancho" value={texto} onChange={e => setTexto(e.target.value)} placeholder="Carné, nombre o número de boleta" />
          <button className="principal" type="submit" disabled={buscando || !enLinea}>{buscando ? 'Buscando…' : 'Buscar'}</button>
        </form>
        {res && !res.ok && <p className="aviso mal">{res.mensaje}</p>}
        {nada && <p className="vacio">No se encontró nada. Revisa el carné o el número de boleta.</p>}
        <div className="botones">
          <button onClick={enviarPendientes} disabled={enviando || !enLinea}>
            {enviando ? 'Iniciando envío…' : 'Enviar QR pendientes ahora'}
          </button>
        </div>
        <Aviso r={envio} />
      </section>

      {res?.ok && res.estudiantes.length > 0 && <h2>Estudiantes</h2>}
      {res?.ok && res.estudiantes.map(e => <TarjetaEstudiante key={e.carnet} e={e} sesion={sesion} alCambiar={hacerBusqueda} />)}
      {res?.ok && res.boletas.length > 0 && <h2>Boletas sin dueño</h2>}
      {res?.ok && res.boletas.map(b => <TarjetaBoleta key={b.boleta} b={b} sesion={sesion} alCambiar={hacerBusqueda} />)}
    </div>
    </>
  );
}
