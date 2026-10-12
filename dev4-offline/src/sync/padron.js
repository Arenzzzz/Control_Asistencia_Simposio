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

const traerTodo = (tabla, columnas) =>
  paginar(tabla, (a, b) => supabase.from(tabla).select(columnas).range(a, b));

// El padrón ya no se puede leer directo (protege los correos). Se usa la función
// obtener_padron_movil, que solo entrega carné y nombre. Si aún no existe, se intenta la tabla.
async function traerPadron() {
  try {
    return await paginar('obtener_padron_movil', (a, b) => supabase.rpc('obtener_padron_movil').range(a, b));
  } catch (e) {
    console.warn('No se pudo usar obtener_padron_movil, se intenta la tabla:', e.message);
    return traerTodo('padron_estudiantes', 'carnet, nombre_oficial');
  }
}

// Descarga el padrón y los ingresos ya registrados, y los guarda en el celular.
export async function descargarPadron() {
  const padron = await traerPadron();
  // Un padrón vacío casi siempre es un problema de permisos: no se toma como descarga válida
  if (!padron.length) throw new Error('el servidor devolvió el padrón vacío (revisar permisos con Dev 2)');
  const lista = padron.map(e => ({
    carnet: String(e.carnet),
    nombre: e.nombre_oficial ?? '',
  }));

  let ingresos = [];
  try {
    const ch = await traerTodo('checkins_asistencia', 'carnet, dia');
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
