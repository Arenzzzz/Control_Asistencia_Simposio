import { useSyncExternalStore } from 'react';
import Escaner from './paginas/Escaner';
import Puerta from './paginas/Puerta';
import Portal from './paginas/Portal';
import { useMantenimiento } from './useMantenimiento';

const suscribir = (cb) => {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
};
const useRuta = () => useSyncExternalStore(suscribir, () => window.location.hash.split('?')[0]);

// Rutas:
//   #/         → escáner con cámara (Dev 3) para el staff
//   #/ajustes  → operador, puerta, día, padrón e ingresos (Dev 4)
//   #/portal   → portal de zona amarilla para estudiantes (Dev 4)
export default function App() {
  const ruta = useRuta();
  const esPortal = ruta === '#/portal';

  // Sincronización y padrón funcionan en las pantallas del staff, no en el portal
  useMantenimiento(!esPortal);

  if (esPortal) return <Portal />;
  if (ruta === '#/ajustes') return <Puerta />;
  return <Escaner />;
}
