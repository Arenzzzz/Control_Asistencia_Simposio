import { supabase } from './supabase';

// Portal de zona amarilla: el estudiante confirma qué carné corresponde a su boleta.
// Llama a la función de Dev 2. Devuelve { ok, mensaje, nombre? }
export async function resolverExcepcion(carnet, boleta) {
  if (!navigator.onLine) {
    return { ok: false, mensaje: 'No hay conexión a internet. Intenta de nuevo cuando tengas señal.' };
  }
  const { data, error } = await supabase.rpc('resolver_excepcion_estudiante', {
    p_carnet: carnet.trim(),
    p_boleta: boleta.trim().toUpperCase(),
  }).abortSignal(AbortSignal.timeout(20000));
  if (error) return { ok: false, mensaje: 'No se pudo contactar al servidor. Intenta de nuevo en unos minutos.' };
  if (data?.status === 'OK') return { ok: true, mensaje: data.mensaje, nombre: data.nombre };
  return { ok: false, mensaje: data?.mensaje ?? 'No se pudo confirmar la boleta.' };
}
