import { supabase } from './supabase';
import { cargarPadron } from '../db';
import { guardarAjustes, leerAjustes } from '../config';

const PAGINA = 1000; // Supabase devuelve como máximo 1000 filas por consulta

// Trae todas las filas en páginas de 1000. consulta = (desde, hasta) => petición de Supabase
async function paginar(nombre, consulta) {
  const filas = [];
  for (let desde = 0; ; desde += PAGINA) {
    const { data, error } = await consulta(desde, desde + PAGINA - 1);
    if (error) throw new Error(`${nombre}: ${error.message}`);
    filas.push(...data);
    if (data.length < PAGINA) return filas;
  }
}

// Las tablas ya no se leen directo: se usan funciones que piden la clave de la puerta (08_seguridad.sql).
// Si la base todavía no tiene esas funciones, se usa la función anterior para no dejar la puerta sin padrón.
const sinFuncion = (e) => /could not find the function|PGRST202|does not exist/i.test(e.message);

async function traerPadron(clave) {
  try {
    return await paginar('puerta_padron', (a, b) => supabase.rpc('puerta_padron', { p_clave: clave }).range(a, b));
  } catch (e) {
    if (!sinFuncion(e)) throw e;
    return paginar('obtener_padron_movil', (a, b) => supabase.rpc('obtener_padron_movil').range(a, b));
  }
}

async function traerIngresos(clave) {
  try {
    return await paginar('puerta_ingresos', (a, b) => supabase.rpc('puerta_ingresos', { p_clave: clave }).range(a, b));
  } catch (e) {
    if (!sinFuncion(e)) throw e;
    return paginar('checkins_asistencia', (a, b) => supabase.from('checkins_asistencia').select('carnet, dia').range(a, b));
  }
}

// Descarga el padrón y los ingresos ya registrados, y los guarda en el celular.
export async function descargarPadron() {
  const clave = leerAjustes().clavePuerta;
  const padron = await traerPadron(clave).catch(e => {
    if (!/clave de puerta incorrecta/i.test(e.message)) throw e;
    throw new Error(clave ? 'la clave de la puerta es incorrecta' : 'falta la clave de la puerta (escríbela en Ajustes)');
  });
  // Un padrón vacío casi siempre es un problema de permisos: no se toma como descarga válida
  if (!padron.length) throw new Error('el servidor devolvió el padrón vacío');
  const lista = padron.map(e => ({
    carnet: String(e.carnet),
    nombre: e.nombre_oficial ?? '',
  }));

  let ingresos = [];
  try {
    const ch = await traerIngresos(clave);
    ingresos = ch.map(c => ({ carnet: String(c.carnet), dia: Number(c.dia) }));
  } catch (e) {
    console.warn('No se pudieron leer los ingresos del servidor:', e.message);
  }

  await cargarPadron(lista, ingresos);
  guardarAjustes({ ultimaDescarga: new Date().toISOString() });
  return { estudiantes: lista.length, ingresos: ingresos.length };
}

const CADA_MINUTOS = 10;
let actualizando = false;

// Descarga el padrón solo si hay internet y la última descarga tiene más de 10 minutos.
// No lanza errores: si falla, se intenta en la siguiente oportunidad.
export async function actualizarPadronSiHaceFalta() {
  const { ultimaDescarga } = leerAjustes();
  const vieja = !ultimaDescarga || Date.now() - new Date(ultimaDescarga).getTime() > CADA_MINUTOS * 60000;
  if (!navigator.onLine || !vieja || actualizando) return null;
  actualizando = true;
  try {
    return await descargarPadron();
  } catch (e) {
    console.warn('No se pudo actualizar el padrón:', e.message);
    return null;
  } finally {
    actualizando = false;
  }
}
