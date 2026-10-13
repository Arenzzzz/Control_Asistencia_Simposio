import { supabase } from './supabase';

// Panel de estadísticas: usa la clave de la mesa. Devuelven { ok, mensaje, ...datos }
async function llamar(funcion, args) {
  if (!navigator.onLine) return { ok: false, mensaje: 'El panel necesita internet.' };
  const { data, error } = await supabase.rpc(funcion, args).abortSignal(AbortSignal.timeout(20000));
  if (error) {
    const lento = /abort|timeout/i.test(`${error.name} ${error.message}`);
    return { ok: false, mensaje: lento ? 'El servidor tardó demasiado en responder.' : 'No se pudo contactar al servidor: ' + error.message };
  }
  return { ...data, ok: data?.status === 'OK', mensaje: data?.mensaje ?? '' };
}

export const leerEstadisticas = (clave) => llamar('panel_estadisticas', { p_clave: clave });
export const leerRegistros = (clave, tipo) => llamar('panel_registros', { p_clave: clave, p_tipo: tipo });

// Arma el CSV (UTF-8 con BOM para que Excel respete las tildes) y lo descarga
export function descargarCsv(filas, columnas, nombreArchivo) {
  const celda = (v) => {
    const t = v === null || v === undefined ? '' : String(v);
    return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const lineas = [
    columnas.map(c => celda(c.titulo)).join(','),
    ...filas.map(f => columnas.map(c => celda(f[c.campo])).join(',')),
  ];
  const blob = new Blob(['﻿' + lineas.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombreArchivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
