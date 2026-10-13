// Ajustes de este celular: quién opera, en qué puerta y qué día.
// Se guardan en el propio dispositivo para que sigan ahí sin internet.
const CLAVE = 'simposio-ajustes';
const PREDETERMINADO = { staffId: '', puerta: '1', dia: 1, ultimaDescarga: null, clavePuerta: '', diaAutoFecha: null };

// Días del simposio (hora de Guatemala). El celular se pone solo en el día que toca.
const DIAS_EVENTO = { '2026-10-15': 1, '2026-10-16': 2 };
const hoyGuatemala = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Guatemala' });

export function leerAjustes() {
  try {
    return { ...PREDETERMINADO, ...JSON.parse(localStorage.getItem(CLAVE) || '{}') };
  } catch {
    return { ...PREDETERMINADO };
  }
}

// Si hoy es día del simposio y aún no se ajustó hoy, se cambia al día correcto una sola vez.
// Después el staff puede cambiarlo a mano y se respeta.
export function ajustarDiaPorFecha() {
  const hoy = hoyGuatemala();
  const dia = DIAS_EVENTO[hoy];
  const a = leerAjustes();
  if (!dia || a.diaAutoFecha === hoy) return a;
  return guardarAjustes({ dia, diaAutoFecha: hoy });
}

export function guardarAjustes(cambios) {
  const nuevos = { ...leerAjustes(), ...cambios };
  try {
    localStorage.setItem(CLAVE, JSON.stringify(nuevos));
  } catch {
    // Sin almacenamiento disponible: los ajustes solo duran mientras la app esté abierta
  }
  return nuevos;
}
