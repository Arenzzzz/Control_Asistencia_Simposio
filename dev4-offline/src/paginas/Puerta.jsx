import { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, borrarDatosLocales, protegerAlmacenamiento } from '../db';
import { leerAjustes, guardarAjustes } from '../config';
import { descargarPadron } from '../sync/padron';
import { sincronizarCola } from '../sync/sync';
import { procesarEscaneo } from '../qr/escanear';
import { TOKEN_VALIDO } from '../qr/tokensPrueba';
import { useEnLinea } from '../useEnLinea';

const RESULTADOS = {
  ok: ['Puede ingresar', 'ok'],
  ya_ingresado: ['Ya ingresó hoy', 'mal'],
  no_encontrado: ['No está en el padrón del celular', 'aviso'],
  qr_invalido: ['QR inválido o alterado', 'mal'],
  qr_vencido: ['QR vencido', 'mal'],
};
const ESTADOS = { aceptado: 'Enviado', duplicado: 'Ya estaba en el servidor', procesado: 'Enviado', invalido: 'Rechazado por el servidor' };
const hora = (iso) => new Date(iso).toLocaleTimeString('es-GT', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const fecha = (iso) => new Date(iso).toLocaleString('es-GT', { dateStyle: 'short', timeStyle: 'short' });

export default function Puerta() {
  const enLinea = useEnLinea();
  const [ajustes, setAjustes] = useState(leerAjustes);
  const [aviso, setAviso] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [token, setToken] = useState('');
  const [resultado, setResultado] = useState(null);
  const [confirmarBorrado, setConfirmarBorrado] = useState(false);
  const [protegido, setProtegido] = useState(null);

  // El padrón se actualiza en segundo plano (useMantenimiento); aquí solo se refresca la fecha mostrada
  useEffect(() => {
    protegerAlmacenamiento().then(setProtegido);
    const timer = setInterval(() => setAjustes(leerAjustes()), 15000);
    return () => clearInterval(timer);
  }, []);

  const totalPadron = useLiveQuery(() => db.estudiantes.count(), [], 0);
  const pendientes = useLiveQuery(() => db.cola_checkins.where('sincronizado').equals(0).count(), [], 0);
  const recientes = useLiveQuery(() => db.cola_checkins.orderBy('id').toArray()
    .then(c => c.sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 15)), [], []);

  const cambiar = (campo, valor) => setAjustes(guardarAjustes({ [campo]: valor }));

  async function descargar() {
    setOcupado(true); setAviso(null);
    try {
      const r = await descargarPadron();
      setAjustes(leerAjustes());
      setAviso({ tipo: 'ok', texto: `Padrón descargado: ${r.estudiantes} estudiantes y ${r.ingresos} ingresos previos.` });
    } catch (e) {
      setAviso({ tipo: 'mal', texto: `No se pudo descargar el padrón: ${e.message}` });
    } finally { setOcupado(false); }
  }

  async function sincronizar() {
    setOcupado(true); setAviso(null);
    const r = await sincronizarCola();
    setOcupado(false);
    if (r.omitido) setAviso({ tipo: 'aviso', texto: enLinea ? 'Ya hay un envío en curso.' : 'Sin conexión: los ingresos se enviarán al volver la red.' });
    else if (r.ok) setAviso({ tipo: 'ok', texto: r.enviados ? `Se enviaron ${r.enviados} ingresos.` : 'No había ingresos pendientes.' });
    else setAviso({ tipo: 'mal', texto: `No se pudo enviar: ${r.error}. Se reintentará solo.` });
  }

  async function procesar(e) {
    e.preventDefault();
    if (!token.trim()) return;
    setResultado(await procesarEscaneo(token));
    setToken('');
  }

  async function borrar() {
    const r = await borrarDatosLocales();
    setConfirmarBorrado(false);
    setAviso(r.ok ? { tipo: 'ok', texto: 'Se borraron los datos del celular.' }
      : { tipo: 'mal', texto: `Hay ${r.pendientes} ingresos sin enviar. Sincroniza antes de borrar.` });
  }

  const res = resultado && (resultado.ok ? RESULTADOS.ok : RESULTADOS[resultado.motivo]);
  const sinStaff = !ajustes.staffId.trim();

  return (
    <div className="pagina">
      <header className="encabezado">
        <div>
          <a href="#/" className="volver">← Volver al escáner</a>
          <h1>Ajustes de puerta</h1>
          <p className="tenue">XIX Simposio de Ingeniería</p>
        </div>
        <span className={`estado-red ${enLinea ? 'ok' : 'mal'}`}>{enLinea ? 'En línea' : 'Sin conexión'}</span>
      </header>

      <section className="resumen">
        <div><b>{totalPadron}</b><span>Estudiantes en el celular</span></div>
        <div><b className={pendientes ? 'aviso-txt' : ''}>{pendientes}</b><span>Ingresos sin enviar</span></div>
        <div><b>{ajustes.dia === 1 ? 'Día 1' : 'Día 2'}</b><span>Puerta {ajustes.puerta}</span></div>
      </section>

      {aviso && <p className={`aviso ${aviso.tipo}`} role="status">{aviso.texto}</p>}

      <section className="bloque">
        <h2>Este celular</h2>
        <div className="campos">
          <label>Operador
            <input id="staff" value={ajustes.staffId} placeholder="Nombre o código del staff"
              onChange={e => cambiar('staffId', e.target.value)} />
          </label>
          <label>Puerta
            <select id="puerta" value={ajustes.puerta} onChange={e => cambiar('puerta', e.target.value)}>
              {['1', '2', '3', '4'].map(p => <option key={p} value={p}>Puerta {p}</option>)}
            </select>
          </label>
          <label>Día
            <select id="dia" value={ajustes.dia} onChange={e => cambiar('dia', Number(e.target.value))}>
              <option value={1}>Día 1</option>
              <option value={2}>Día 2</option>
            </select>
          </label>
        </div>
        {sinStaff && <p className="tenue">Escribe el operador para que cada ingreso quede registrado con su nombre.</p>}
      </section>

      <section className="bloque">
        <h2>Padrón</h2>
        <p className="tenue">
          {ajustes.ultimaDescarga ? `Última descarga: ${fecha(ajustes.ultimaDescarga)} ·` : 'Todavía no se ha descargado.'}
          {' '}Se actualiza solo cada 10 minutos cuando hay internet. Descárgalo antes del evento.
        </p>
        {protegido === false && (
          <p className="tenue">El navegador no garantiza conservar los datos. Instala la app en la pantalla de inicio para protegerlos.</p>
        )}
        <div className="botones">
          <button className="principal" onClick={descargar} disabled={!enLinea || ocupado}>Descargar padrón</button>
          <button onClick={sincronizar} disabled={ocupado || !pendientes}>Enviar ingresos ahora</button>
        </div>
      </section>

      <section className="bloque">
        <h2>Probar un escaneo</h2>
        <p className="tenue">Para pruebas sin cámara: pega el texto de un QR. El escáner usa esta misma función.</p>
        <form onSubmit={procesar} className="botones">
          <input id="token" className="ancho" value={token} onChange={e => setToken(e.target.value)} placeholder="eyJ…" autoComplete="off" />
          <button className="principal" type="submit">Procesar</button>
          <button type="button" onClick={() => setToken(TOKEN_VALIDO)}>Usar QR de prueba</button>
        </form>
        {res && (
          <div className={`resultado ${res[1]}`}>
            <b>{res[0]}</b>
            {resultado.carnet && <span>{resultado.nombre || 'Sin nombre'} · {resultado.carnet}</span>}
          </div>
        )}
      </section>

      <section className="bloque">
        <h2>Últimos ingresos</h2>
        {recientes.length ? (
          <div className="tabla"><table>
            <thead><tr><th>Hora</th><th>Carné</th><th>Día</th><th>Puerta</th><th>Estado</th></tr></thead>
            <tbody>{recientes.map(c => (
              <tr key={c.id}>
                <td>{hora(c.timestamp)}</td><td>{c.carnet}</td><td>{c.dia}</td><td>{c.puerta}</td>
                <td>{c.sincronizado
                  ? <span className={`chip ${c.estado === 'invalido' ? 'mal' : 'ok'}`}>{ESTADOS[c.estado] ?? 'Enviado'}</span>
                  : <span className="chip aviso">Sin enviar</span>}</td>
              </tr>))}
            </tbody>
          </table></div>
        ) : <p className="vacio">Aún no hay ingresos en este celular.</p>}
      </section>

      <section className="bloque">
        <h2>Borrar datos del celular</h2>
        <p className="tenue">Borra el padrón y el historial local. No se permite si hay ingresos sin enviar.</p>
        {confirmarBorrado ? (
          <div className="botones">
            <button className="peligro" onClick={borrar}>Sí, borrar</button>
            <button onClick={() => setConfirmarBorrado(false)}>Cancelar</button>
          </div>
        ) : <button onClick={() => setConfirmarBorrado(true)}>Borrar datos</button>}
      </section>
    </div>
  );
}
