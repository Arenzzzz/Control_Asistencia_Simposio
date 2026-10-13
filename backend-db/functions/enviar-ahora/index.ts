// Función de Supabase "enviar-ahora".
// Le pide a GitHub que corra de inmediato el envío de QR (.github/workflows/envio-automatico.yml),
// sin esperar el ciclo de 5 minutos. La llaman el portal y la mesa; el token de GitHub
// queda guardado aquí y nunca llega a la app.
//
// Datos que necesita (en los secretos de la función o, si no hay permiso para crearlos,
// en la tabla privada public.config_privada; ver backend-db/migrations/06_config_privada.sql):
//   GITHUB_TOKEN  token con permiso "Actions: Read and write" sobre el repositorio
//   GITHUB_REPO   dueño/repositorio, p. ej. Arenzzzz/Control_Asistencia_Simposio
//   GITHUB_RAMA   (opcional) rama donde está el flujo; por defecto main
// Al crearla, desactivar "Verify JWT": la app la llama con la llave pública.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Si se pide varias veces seguidas (varios estudiantes confirmando a la vez), basta con una corrida:
// GitHub además junta las corridas pendientes del mismo grupo.
const ESPERA_MS = 20_000;
let ultimoPedido = 0;

// Lee la configuración: primero los secretos de la función; si faltan, la tabla privada.
// La tabla se lee con la llave de servicio, que Supabase le da a toda función.
let cache: Record<string, string> | null = null;

async function leerConfig(): Promise<Record<string, string>> {
  const desdeSecretos: Record<string, string> = {};
  for (const k of ["GITHUB_TOKEN", "GITHUB_REPO", "GITHUB_RAMA"]) {
    const v = Deno.env.get(k);
    if (v) desdeSecretos[k] = v;
  }
  if (desdeSecretos.GITHUB_TOKEN && desdeSecretos.GITHUB_REPO) return desdeSecretos;
  if (cache) return { ...cache, ...desdeSecretos };

  const url = Deno.env.get("SUPABASE_URL");
  if (!url) return desdeSecretos;
  // Llave de servicio: la clásica (JWT) o, si el proyecto usa las nuevas, la primera llave secreta
  let headers: Record<string, string> | null = null;
  const clasica = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (clasica) headers = { apikey: clasica, Authorization: `Bearer ${clasica}` };
  else {
    try {
      const nueva = Object.values(JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}"))[0];
      if (typeof nueva === "string") headers = { apikey: nueva };
    } catch { /* sin llaves nuevas */ }
  }
  if (!headers) return desdeSecretos;
  const r = await fetch(`${url}/rest/v1/config_privada?select=clave,valor`, { headers });
  if (!r.ok) return desdeSecretos;
  const filas: { clave: string; valor: string }[] = await r.json();
  cache = Object.fromEntries(filas.map((f) => [f.clave, f.valor]));
  return { ...cache, ...desdeSecretos };
}

function responder(cuerpo: Record<string, unknown>, estado = 200) {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return responder({ ok: false, mensaje: "Método no permitido." }, 405);

  const config = await leerConfig();
  const token = config.GITHUB_TOKEN;
  const repo = config.GITHUB_REPO;
  const rama = config.GITHUB_RAMA ?? "main";
  if (!token || !repo) {
    return responder({ ok: false, mensaje: "Falta configurar GITHUB_TOKEN o GITHUB_REPO." }, 500);
  }

  const ahora = Date.now();
  if (ahora - ultimoPedido < ESPERA_MS) {
    return responder({ ok: true, mensaje: "El envío ya está en marcha. Los QR llegarán en 1 o 2 minutos." });
  }
  ultimoPedido = ahora;

  const r = await fetch(
    `https://api.github.com/repos/${repo}/actions/workflows/envio-automatico.yml/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "simposio-xix",
      },
      body: JSON.stringify({ ref: rama }),
    },
  );

  if (r.status === 204) {
    return responder({ ok: true, mensaje: "Envío iniciado. Los QR pendientes llegarán en 1 o 2 minutos." });
  }
  ultimoPedido = 0;
  cache = null; // por si cambiaron el token en la tabla
  const detalle = (await r.text()).slice(0, 300);
  return responder({ ok: false, mensaje: `GitHub respondió ${r.status}.`, detalle }, 502);
});
