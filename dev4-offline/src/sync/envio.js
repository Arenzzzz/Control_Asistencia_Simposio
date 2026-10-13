import { supabase } from './supabase';

// Pide que los QR pendientes se envíen ya, sin esperar el ciclo de 5 minutos
// (función "enviar-ahora" de Supabase, que activa el envío en GitHub).
// Nunca lanza errores: si no se puede, el ciclo automático los envía igual.
export async function enviarAhora() {
  const respaldo = 'No se pudo iniciar el envío ahora; saldrá solo en el siguiente ciclo (máximo 5 minutos).';
  if (!navigator.onLine) return { ok: false, mensaje: respaldo };
  try {
    const { data, error } = await supabase.functions.invoke('enviar-ahora', { body: {} });
    if (error || !data?.ok) return { ok: false, mensaje: respaldo };
    return { ok: true, mensaje: data.mensaje };
  } catch {
    return { ok: false, mensaje: respaldo };
  }
}
