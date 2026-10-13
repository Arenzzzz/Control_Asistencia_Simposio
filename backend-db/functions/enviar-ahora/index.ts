// Función de Supabase "enviar-ahora".
// Le pide a GitHub que corra de inmediato el envío de QR (.github/workflows/envio-automatico.yml),
// sin esperar el ciclo de 5 minutos. La llaman el portal y la mesa; el token de GitHub
// queda guardado aquí y nunca llega a la app.
//
// Secretos de la función (Edge Functions → Secrets):
//   GITHUB_TOKEN  token con permiso "Actions: Read and write" sobre el repositorio
//   GITHUB_REPO   dueño/repositorio, p. ej. arenz/Control_Asistencia_Simposio
//   GITHUB_RAMA   (opcional) rama donde está el flujo; por defecto main
// Al crearla, desactivar "Enforce JWT Verification": la app la llama con la llave pública.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Si se pide varias veces seguidas (varios estudiantes confirmando a la vez), basta con una corrida:
// GitHub además junta las corridas pendientes del mismo grupo.
const ESPERA_MS = 20_000;
let ultimoPedido = 0;

function responder(cuerpo: Record<string, unknown>, estado = 200) {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return responder({ ok: false, mensaje: "Método no permitido." }, 405);

  const token = Deno.env.get("GITHUB_TOKEN");
  const repo = Deno.env.get("GITHUB_REPO");
  const rama = Deno.env.get("GITHUB_RAMA") ?? "main";
  if (!token || !repo) {
    return responder({ ok: false, mensaje: "Falta configurar GITHUB_TOKEN o GITHUB_REPO en la función." }, 500);
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
  const detalle = (await r.text()).slice(0, 300);
  return responder({ ok: false, mensaje: `GitHub respondió ${r.status}.`, detalle }, 502);
});
