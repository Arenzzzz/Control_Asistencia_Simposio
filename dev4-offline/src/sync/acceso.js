import { supabase } from './supabase';

// Claves para abrir la mesa, el panel ('mesa') y los ajustes del celular ('puerta').
// La sesión dura mientras la app esté abierta (sessionStorage).
const CLAVE_SESION = { mesa: 'simposio-sesion-mesa', puerta: 'simposio-sesion-ajustes' };

export function leerSesion(tipo) {
  try { return sessionStorage.getItem(CLAVE_SESION[tipo]) || ''; } catch { return ''; }
}
export function guardarSesion(tipo, clave) {
  try { sessionStorage.setItem(CLAVE_SESION[tipo], clave); } catch { /* sin almacenamiento */ }
}
export function cerrarSesion(tipo) {
  try { sessionStorage.removeItem(CLAVE_SESION[tipo]); } catch { /* sin almacenamiento */ }
}

const sinFuncion = (m) => /could not find the function|PGRST202/i.test(m);

// Pregunta al servidor si la clave es correcta. Devuelve { ok, mensaje, sinConexion? }
export async function validarClave(tipo, clave) {
  if (!clave) return { ok: false, mensaje: 'Escribe la clave.' };
  if (!navigator.onLine) return { ok: false, sinConexion: true, mensaje: 'Sin conexión a internet.' };
  try {
    const { data, error } = await supabase.rpc('validar_clave', { p_tipo: tipo, p_clave: clave })
      .abortSignal(AbortSignal.timeout(20000));
    if (!error) return data?.status === 'OK' ? { ok: true } : { ok: false, mensaje: 'Clave incorrecta.' };
    if (!sinFuncion(error.message)) return { ok: false, mensaje: 'No se pudo contactar al servidor: ' + error.message };
    // Base sin 11_acceso_y_correos.sql: se comprueba con otra función que pide la misma clave
    if (tipo === 'mesa') {
      const r = await supabase.rpc('panel_estadisticas', { p_clave: clave });
      return r.data?.status === 'OK' ? { ok: true } : { ok: false, mensaje: 'Clave incorrecta.' };
    }
    const r = await supabase.rpc('puerta_ingresos', { p_clave: clave }).range(0, 0);
    return r.error ? { ok: false, mensaje: 'Clave incorrecta.' } : { ok: true };
  } catch {
    return { ok: false, mensaje: 'El servidor tardó demasiado en responder.' };
  }
}
