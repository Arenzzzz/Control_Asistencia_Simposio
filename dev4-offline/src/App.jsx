import { useSyncExternalStore } from 'react';
import Escaner from './paginas/Escaner';
import Puerta from './paginas/Puerta';
import Portal from './paginas/Portal';
import Mesa from './paginas/Mesa';
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
//   #/mesa     → mesa de resolución (necesita internet y la clave de la mesa)
export default function App() {
  const ruta = useRuta();
  const esPortal = ruta === '#/portal';
  const esMesa = ruta === '#/mesa';

  // Sincronización y padrón funcionan en las pantallas de puerta, no en el portal ni en la mesa
  useMantenimiento(!esPortal && !esMesa);

  if (esPortal) return <Portal />;
  if (esMesa) return <Mesa />;
  if (ruta === '#/ajustes') return <Puerta />;
  return <Escaner />;
}
