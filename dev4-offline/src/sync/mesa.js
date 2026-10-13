import { supabase } from './supabase';

// Llamadas de la mesa de resolución. Todas piden la clave de la mesa.
// Devuelven { ok, mensaje, ...datos }
async function llamar(funcion, args) {
  if (!navigator.onLine) return { ok: false, mensaje: 'La mesa necesita internet.' };
  // Límite de 20 s: si el servidor no responde, se muestra un error en lugar de quedarse buscando
  const { data, error } = await supabase.rpc(funcion, args).abortSignal(AbortSignal.timeout(20000));
  if (error) {
    const lento = /abort|timeout/i.test(`${error.name} ${error.message}`);
    return { ok: false, mensaje: lento ? 'El servidor tardó demasiado en responder. Intenta de nuevo.' : 'No se pudo contactar al servidor: ' + error.message };
  }
  return { ...data, ok: data?.status === 'OK', mensaje: data?.mensaje ?? '' };
}

export const buscar = (clave, texto) =>
  llamar('mesa_buscar', { p_clave: clave, p_texto: texto });

export const vincularBoleta = (clave, boleta, carnet, operador, justificacion) =>
  llamar('mesa_vincular_boleta', { p_clave: clave, p_boleta: boleta, p_carnet: carnet, p_operador: operador, p_justificacion: justificacion });

export const registrarIngreso = (clave, carnet, boleta, dia, operador, justificacion) =>
  llamar('mesa_registrar_ingreso', { p_clave: clave, p_carnet: carnet, p_boleta: boleta, p_dia: dia, p_operador: operador, p_justificacion: justificacion });

export const reenviarQr = (clave, carnet, correo) =>
  llamar('mesa_reenviar_qr', { p_clave: clave, p_carnet: carnet, p_correo: correo });
