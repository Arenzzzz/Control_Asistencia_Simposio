import { useEffect } from 'react';
import { iniciarSincronizacion } from './sync/sync';
import { actualizarPadronSiHaceFalta } from './sync/padron';
import { protegerAlmacenamiento } from './db';

// Tareas de fondo del celular del staff, en cualquier pantalla:
// - envía la cola de ingresos (al reconectar, al volver a la app y cada 30 s)
// - mantiene el padrón al día (al abrir, al reconectar y revisando cada minuto si pasaron 10)
// - pide al navegador que no borre la base local
export function useMantenimiento(activo) {
  useEffect(() => {
    if (!activo) return undefined;
    protegerAlmacenamiento();
    const detenerSync = iniciarSincronizacion();
    const actualizar = () => actualizarPadronSiHaceFalta();
    actualizar();
    window.addEventListener('online', actualizar);
    const timer = setInterval(actualizar, 60000);
    return () => {
      detenerSync();
      window.removeEventListener('online', actualizar);
      clearInterval(timer);
    };
  }, [activo]);
}
