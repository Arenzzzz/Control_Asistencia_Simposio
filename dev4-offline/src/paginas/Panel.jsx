import { useState, useEffect, useCallback } from 'react';
import Encabezado from '../components/Encabezado';
import { useEnLinea } from '../useEnLinea';
import { leerEstadisticas, leerRegistros, descargarCsv, aprobarEnvio } from '../sync/panel';
import { enviarAhora } from '../sync/envio';

const CLAVE_SESION = 'simposio-panel-clave';
const leerClave = () => { try { return sessionStorage.getItem(CLAVE_SESION) || ''; } catch { return ''; } };
const guardarClave = (c) => { try { sessionStorage.setItem(CLAVE_SESION, c); } catch { /* sin almacenamiento */ } };

const num = (n) => Number(n ?? 0).toLocaleString('es-GT');
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)} %` : '—');
const horaTexto = (h) => `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? ' a. m.' : ' p. m.'}`;

// Zonas de las boletas: colores validados (ver skill de visualización) y siempre con etiqueta y número
const ZONAS = [
  { id: 'verde', texto: 'Verde · pago validado', color: '#3f8a4a' },
  { id: 'amarilla', texto: 'Amarilla · por confirmar', color: '#d39a3f' },
  { id: 'roja', texto: 'Roja · rechazada', color: '#b84a2c' },
  { id: 'pendiente', texto: 'Sin clasificar', color: '#b5aba5' },
];

const DESCARGAS = [
  {
    tipo: 'ingresos', titulo: 'Ingresos a la puerta', detalle: 'Un registro por cada ingreso: carné, nombre, día, hora, puerta y operador.',
    columnas: [['carne', 'Carné'], ['nombre', 'Nombre'], ['correo', 'Correo'], ['dia', 'Día'], ['fecha_hora', 'Fecha y hora'], ['puerta', 'Puerta'], ['operador', 'Operador']],
  },
  {
    tipo: 'asistencia', titulo: 'Asistencia por estudiante', detalle: 'Cada estudiante con pago validado: boleta, QR enviado y si entró cada día.',
    columnas: [['carne', 'Carné'], ['nombre', 'Nombre'], ['correo', 'Correo'], ['boleta', 'Boleta'], ['qr_enviado', 'QR enviado'], ['ingreso_dia_1', 'Ingreso día 1'], ['ingreso_dia_2', 'Ingreso día 2'], ['asistencia', 'Asistencia']],
  },
  {
    tipo: 'boletas', titulo: 'Boletas de Tesorería', detalle: 'Todas las boletas con su zona, estado, carné asignado y motivo.',
    columnas: [['boleta', 'Boleta'], ['nombre_boleta', 'Nombre en la boleta'], ['monto', 'Monto'], ['fecha_pago', 'Fecha de pago'], ['zona', 'Zona'], ['estado', 'Estado'], ['carne_asignado', 'Carné asignado'], ['motivo', 'Motivo']],
  },
];

function Tile({ valor, etiqueta, detalle }) {
  return (
    <div className="tile">
      <span className="tile__etiqueta">{etiqueta}</span>
      <b className="tile__valor">{valor}</b>
      {detalle && <span className="tile__detalle">{detalle}</span>}
    </div>
  );
}

// Columnas por hora (una sola serie: un solo color). El valor aparece al pasar el cursor o tocar.
function IngresosPorHora({ datos }) {
  const [activa, setActiva] = useState(null);
  if (!datos.length) return <p className="vacio">Todavía no hay ingresos este día.</p>;
  const horas = datos.map(d => d.hora);
  const desde = Math.min(7, ...horas), hasta = Math.max(17, ...horas);
  const serie = [];
  for (let h = desde; h <= hasta; h++) serie.push({ hora: h, total: datos.find(d => d.hora === h)?.total ?? 0 });
  const max = Math.max(...serie.map(s => s.total), 1);
  const pico = serie.reduce((a, b) => (b.total > a.total ? b : a));
  return (
    <div className="columnas" onMouseLeave={() => setActiva(null)}>
      <div className="columnas__plot">
        {serie.map(s => (
          <button key={s.hora} type="button" className={`columna${activa === s.hora ? ' activa' : ''}`}
            onMouseEnter={() => setActiva(s.hora)} onFocus={() => setActiva(s.hora)} onClick={() => setActiva(s.hora)}
            aria-label={`${horaTexto(s.hora)}: ${s.total} ingresos`}>
            {(activa === s.hora || (activa === null && s.hora === pico.hora && s.total > 0)) && (
              <span className="columna__valor">{num(s.total)}</span>
            )}
            <span className="columna__barra" style={{ height: `${(s.total / max) * 100}%` }} />
          </button>
        ))}
      </div>
      <div className="columnas__eje" aria-hidden="true">
        {serie.map((s, i) => <span key={s.hora}>{i % 2 === 0 ? (s.hora % 12 || 12) : ''}</span>)}
      </div>
      <p className="tenue columnas__nota">
        Horas del día ({horaTexto(desde)} a {horaTexto(hasta)}).{' '}
        {activa !== null
          ? `${horaTexto(activa)} a ${horaTexto(activa + 1)}: ${num(serie.find(s => s.hora === activa)?.total)} ingresos`
          : `Hora con más ingresos: ${horaTexto(pico.hora)} (${num(pico.total)}). Toca una columna para ver su valor.`}
      </p>
    </div>
  );
}

function IngresosPorPuerta({ datos }) {
  if (!datos.length) return <p className="vacio">Todavía no hay ingresos este día.</p>;
  const max = Math.max(...datos.map(d => d.total), 1);
  return (
    <div className="barras">
      {datos.map(d => (
        <div key={d.puerta} className="barra" title={`Puerta ${d.puerta}: ${d.total} ingresos`}>
          <span className="barra__nombre">Puerta {d.puerta}</span>
          <span className="barra__pista"><span className="barra__relleno" style={{ width: `${(d.total / max) * 100}%` }} /></span>
          <b className="barra__valor">{num(d.total)}</b>
        </div>
      ))}
    </div>
  );
}

// Lista de los últimos ingresos que ya llegaron al servidor (de cualquier puerta)
function UltimosIngresos({ filas }) {
  if (!filas.length) return <p className="vacio">Todavía no hay ingresos registrados.</p>;
  return (
    <div className="tabla"><table>
      <thead><tr><th>Hora</th><th>Nombre</th><th>Carné</th><th>Día</th><th>Puerta</th><th>Operador</th></tr></thead>
      <tbody>{filas.map((f, i) => (
        <tr key={`${f.carnet}-${f.dia}-${i}`}>
          <td>{f.hora}</td><td>{f.nombre ?? '—'}</td><td>{f.carnet}</td><td>{f.dia}</td>
          <td>{String(f.puerta).replace(/^Puerta\s*/i, '')}</td><td>{f.operador ?? '—'}</td>
        </tr>))}
      </tbody>
    </table></div>
  );
}

function Zonas({ b }) {
  const total = ZONAS.reduce((s, z) => s + (b[z.id] ?? 0), 0);
  if (!total) return <p className="vacio">Todavía no hay boletas cargadas.</p>;
  return (
    <>
      <div className="apilada" role="img" aria-label={ZONAS.map(z => `${z.texto}: ${b[z.id] ?? 0}`).join(', ')}>
        {ZONAS.filter(z => b[z.id]).map(z => (
          <span key={z.id} style={{ flexGrow: b[z.id], background: z.color }} title={`${z.texto}: ${b[z.id]}`} />
        ))}
      </div>
      <ul className="leyenda">
        {ZONAS.map(z => (
          <li key={z.id}>
            <span className="leyenda__marca" style={{ background: z.color }} />
            <span>{z.texto}</span>
            <b>{num(b[z.id])}</b>
            <span className="tenue">{pct(b[z.id] ?? 0, total)}</span>
          </li>
        ))}
      </ul>
      <p className="tenue">
        Verdes: {num(b.auto)} por el autómata · {num(b.portal)} confirmadas en el portal · {num(b.mesa)} resueltas en la mesa.
      </p>
    </>
  );
}

export default function Panel() {
  const enLinea = useEnLinea();
  const [clave, setClave] = useState(leerClave);
  const [entrada, setEntrada] = useState('');
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [dia, setDia] = useState(1);
  const [descargando, setDescargando] = useState(null);
  const [aprobando, setAprobando] = useState(false);
  const [confirmar, setConfirmar] = useState(false);
  const [avisoEnvio, setAvisoEnvio] = useState(null);
  const [avisoCsv, setAvisoCsv] = useState(null);

  const cargar = useCallback(async (c) => {
    setCargando(true);
    const r = await leerEstadisticas(c);
    setCargando(false);
    if (r.ok) { setDatos(r); setError(null); guardarClave(c); setClave(c); }
    else {
      setError(r.mensaje);
      if (/clave/i.test(r.mensaje)) { setClave(''); guardarClave(''); setDatos(null); }
    }
  }, []);

  // Con la clave puesta, se actualiza solo cada 30 segundos
  useEffect(() => {
    if (!clave) return;
    const primera = setTimeout(() => cargar(clave), 0);
    const timer = setInterval(() => cargar(clave), 30000);
    return () => { clearTimeout(primera); clearInterval(timer); };
  }, [clave, cargar]);

  // Aprueba los correos que esperan (QR del autómata y avisos del portal) y pide el envío
  async function aprobar() {
    setAprobando(true); setConfirmar(false); setAvisoEnvio(null);
    const r = await aprobarEnvio(clave);
    if (!r.ok) { setAprobando(false); setAvisoEnvio({ ok: false, mensaje: r.mensaje }); return; }
    const env = await enviarAhora();
    setAprobando(false);
    setAvisoEnvio({ ok: true, mensaje: `${r.mensaje} ${env.ok ? 'Los correos salen en 1 o 2 minutos.' : env.mensaje}` });
    cargar(clave);
  }

  async function descargar(d) {
    setDescargando(d.tipo); setAvisoCsv(null);
    const r = await leerRegistros(clave, d.tipo);
    setDescargando(null);
    if (!r.ok) { setAvisoCsv({ ok: false, mensaje: r.mensaje }); return; }
    const fecha = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Guatemala' });
    descargarCsv(r.filas, d.columnas.map(([campo, titulo]) => ({ campo, titulo })), `simposio-${d.tipo}-${fecha}.csv`);
    setAvisoCsv({ ok: true, mensaje: `Se descargó "${d.titulo}" con ${num(r.filas.length)} registros.` });
  }

  const ing = datos?.ingresos;
  const verdes = datos?.boletas?.verde ?? 0;
  const actualizado = datos && new Date(datos.generado_en).toLocaleTimeString('es-GT', { hour: 'numeric', minute: '2-digit', second: '2-digit' });

  return (
    <>
      <Encabezado activa="panel" enLinea={enLinea} detalle={['Panel de estadísticas']} />
      <div className="pagina ancha">
        <div className="titulo-pagina titulo-panel">
          <div>
            <h1>Panel de estadísticas</h1>
            <p>{datos ? `Actualizado a las ${actualizado} · se actualiza solo cada 30 segundos.` : 'Pagos, QR enviados e ingresos del simposio en tiempo real.'}</p>
          </div>
          {datos && <button onClick={() => cargar(clave)} disabled={cargando || !enLinea}>{cargando ? 'Actualizando…' : 'Actualizar'}</button>}
        </div>

        {!clave && (
          <section className="bloque">
            <form className="botones" style={{ marginTop: 0 }} onSubmit={e => { e.preventDefault(); if (entrada) cargar(entrada); }}>
              <label className="ancho">Clave de la mesa
                <input type="password" value={entrada} onChange={e => setEntrada(e.target.value)} autoComplete="current-password" />
              </label>
              <button className="principal" type="submit" disabled={cargando || !enLinea || !entrada} style={{ alignSelf: 'flex-end' }}>
                {cargando ? 'Entrando…' : 'Ver panel'}
              </button>
            </form>
            <p className="tenue">Es la misma clave de la mesa de resolución.</p>
          </section>
        )}
        {error && <p className="aviso mal" role="alert">{error}</p>}

        {datos && (
          <>
            <section className="tarjeta aprobacion">
              <div className="tarjeta-titulo">
                <h2>Correos por aprobar</h2>
                <span className="tenue">No sale nada hasta que lo aprueben</span>
              </div>
              {(() => {
                const qr = datos.qr.por_aprobar ?? 0, avisos = datos.avisos?.por_aprobar ?? 0;
                if (!qr && !avisos) return <p className="tenue">No hay correos esperando aprobación. Los del portal y la mesa salen solos.</p>;
                return (
                  <>
                    <p>
                      <b>{num(qr)}</b> QR de boletas verdes y <b>{num(avisos)}</b> avisos del portal para boletas amarillas.
                      Revisen el CSV de boletas antes de aprobar.
                    </p>
                    {confirmar ? (
                      <div className="botones">
                        <button className="principal" onClick={aprobar} disabled={aprobando || !enLinea}>
                          {aprobando ? 'Aprobando…' : `Sí, enviar ${num(qr + avisos)} correos`}
                        </button>
                        <button onClick={() => setConfirmar(false)} disabled={aprobando}>Cancelar</button>
                      </div>
                    ) : (
                      <div className="botones">
                        <button className="principal" onClick={() => setConfirmar(true)} disabled={!enLinea}>Aprobar y enviar</button>
                      </div>
                    )}
                  </>
                );
              })()}
              {avisoEnvio && <p className={`aviso ${avisoEnvio.ok ? 'ok' : 'mal'}`} role="status" style={{ marginTop: 10 }}>{avisoEnvio.mensaje}</p>}
            </section>

            <section className="tiles" aria-label="Resumen">
              <Tile etiqueta="Pagos validados" valor={num(verdes)}
                detalle={`de ${num(datos.boletas.total)} boletas · Q${num(datos.boletas.monto_verde)}`} />
              <Tile etiqueta="QR enviados" valor={num(datos.qr.enviados)}
                detalle={datos.qr.por_aprobar ? `${num(datos.qr.por_aprobar)} esperan aprobación` : datos.qr.generados - datos.qr.enviados > 0 ? `${num(datos.qr.generados - datos.qr.enviados)} por enviar` : 'Ninguno pendiente'} />
              <Tile etiqueta="Ingresos día 1" valor={num(ing.dia1)} detalle={`${pct(ing.dia1, verdes)} de los pagos validados`} />
              <Tile etiqueta="Ingresos día 2" valor={num(ing.dia2)} detalle={`${num(ing.ambos)} asistieron los dos días`} />
            </section>

            <div className="panel-grid">
              <section className="tarjeta">
                <div className="tarjeta-titulo">
                  <h2>Ingresos por hora</h2>
                  <div className="segmentos" role="group" aria-label="Día">
                    {[1, 2].map(d => (
                      <button key={d} type="button" className={dia === d ? 'activo' : undefined} aria-pressed={dia === d} onClick={() => setDia(d)}>Día {d}</button>
                    ))}
                  </div>
                </div>
                <IngresosPorHora key={dia} datos={ing.por_hora.filter(x => x.dia === dia)} />
              </section>

              <section className="tarjeta">
                <div className="tarjeta-titulo"><h2>Ingresos por puerta · día {dia}</h2></div>
                <IngresosPorPuerta datos={ing.por_puerta.filter(x => x.dia === dia)} />
                <p className="tenue">Estudiantes distintos que han entrado: <b>{num(ing.unicos)}</b> de {num(verdes)} con pago validado.</p>
              </section>

              <section className="tarjeta panel-ancho">
                <div className="tarjeta-titulo">
                  <h2>Últimos ingresos</h2>
                  <span className="tenue">Todas las puertas · se actualiza cada 30 s</span>
                </div>
                <UltimosIngresos filas={datos.recientes ?? []} />
              </section>

              <section className="tarjeta panel-ancho">
                <div className="tarjeta-titulo"><h2>Boletas por zona</h2></div>
                <Zonas b={datos.boletas} />
              </section>
            </div>

            <section className="tarjeta">
              <div className="tarjeta-titulo"><h2>Descargar registros (.csv)</h2></div>
              <p className="tenue">Se abren en Excel o Google Sheets. Los datos son los del momento de la descarga.</p>
              <div className="descargas">
                {DESCARGAS.map(d => (
                  <div key={d.tipo} className="descarga">
                    <div>
                      <b>{d.titulo}</b>
                      <p className="tenue">{d.detalle}</p>
                    </div>
                    <button onClick={() => descargar(d)} disabled={!!descargando || !enLinea}>
                      {descargando === d.tipo ? 'Preparando…' : 'Descargar .csv'}
                    </button>
                  </div>
                ))}
              </div>
              {avisoCsv && <p className={`aviso ${avisoCsv.ok ? 'ok' : 'mal'}`} role="status" style={{ marginTop: 12 }}>{avisoCsv.mensaje}</p>}
            </section>
          </>
        )}
      </div>
    </>
  );
}
