/**
 * Experimento PAGADO «render fiel» (2026-10-08): ¿qué camino de FLUX recrea la captura del taller 3D 1 a 1 sin
 * inventar? Misma captura y mismo texto nuevo (inventario cerrado, sala «Igual al visor») en cuatro variantes, dos
 * semillas cada una:
 *   a) FLUX.2 `/edit` (lo de hoy en /api/render-3d-imagen), 1536 × 1024;
 *   b) FLUX.1 [dev] imagen-a-imagen, strength 0,35, 1200 × 800 (< 1 MP: se cobra 1 MP);
 *   c) igual con strength 0,55;
 *   d) FLUX.1 [dev] + ControlNet Union (canny de la captura + profundidad de fal-ai/imageutils/depth) por
 *      `flux-general/image-to-image`, strength 0,7;
 *   e) como d con strength 0,9 y canny 0,7.
 * Tope declarado: US$0,60 en total. Antes de cada llamada suma lo previsto; si se pasaría, no llama. Lo que ya está
 * en la carpeta no se vuelve a pedir (rehacer la hoja o las medidas no cuesta). Gemini no genera nada aquí.
 * Cada llamada queda en la auditoría (`decidir` + el evento `imagen` de flux.ts, conversación «exp-render-fiel»).
 *
 * Resultado 2026-10-08 (medidas.json, hoja-comparativa.png en la carpeta; referencia: 4 objetos grandes):
 *   a) IoU 0,66 · objetos 3 (+0 añadidos) · ΔE 22,9 · US$0,048 — foto real; ya no inventa (4 árboles, 1 perro,
 *      1 calabaza, sin mesas), pero cambia colores (copas verde oscuro, perro rosado) y pinta la sala de otro tono;
 *   b) IoU 0,96 · 4 (+0) · ΔE 2,6 · US$0,03 — es la captura casi tal cual: sigue pareciendo render;
 *   c) IoU 0,91 · 4 (+0) · ΔE 4,7 · US$0,03 — sigue pareciendo render y pierde detalles (acentos, perro);
 *   d) IoU 0,97 · 4 (+0) · ΔE 8,8 · US$0,075 — forma intacta, aspecto de render suavizado;
 *   e) (1 semilla) IoU 0,85 · 5 (+0) · ΔE 20,3 · US$0,075 — forma intacta, colores perdidos (troncos amarillos).
 * Ninguna variante de FLUX.1 da a la vez fidelidad y foto: el taller sigue con FLUX.2 `/edit` y el texto nuevo.
 * Gasto: US$0,441 en imágenes entregadas + un e fallido (422) contado por si acaso = US$0,516 de 0,60.
 * Red: Node necesita `NODE_OPTIONS=--use-system-ca` (inspección TLS) y `fal.run` está bloqueado (usar la cola).
 *
 * Uso:
 *   npx tsx scripts/exp/captura-render-fiel.ts            (captura limpia desde :3010, sin coste)
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/exp/render-fiel.ts [--solo a,b] [--semillas 11] [--seco]   (--seco: solo dice qué pediría y cuánto)
 *   python scripts/exp/render-fiel-medir.py <carpeta>      (IoU, conteo, color y hoja comparativa, sin coste)
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import sharp from "sharp";

for (const archivo of [".env.local", ".env"]) if (existsSync(archivo)) process.loadEnvFile(archivo);
process.env.REGISTRO_ACTIVO = "1";

const CARPETA = "C:/Users/davidt/Downloads/pictures-workspace/render-fiel";
const TOPE_USD = 0.6;
const SEMILLAS = [11, 22] as const;
const FIEL = { ancho: 1200, alto: 800 } as const;

type Variante = { id: "a" | "b" | "c" | "d" | "e"; nombre: string; costo: number };
const VARIANTES: readonly Variante[] = [
  { id: "a", nombre: "FLUX.2 /edit (línea base)", costo: (2 + 2) * 0.012 },
  { id: "b", nombre: "FLUX.1 dev i2i strength 0,35", costo: 0.03 },
  { id: "c", nombre: "FLUX.1 dev i2i strength 0,55", costo: 0.03 },
  { id: "d", nombre: "FLUX.1 dev + ControlNet Union canny+depth, strength 0,7", costo: 0.075 },
  // Añadida tras ver a-d: b, c y d conservan la escena pero siguen pareciendo render; e regenera casi todo (0,9)
  // con la estructura sujeta por el ControlNet. (Con `negative_prompt` fal respondió 422 «Could not load
  // pipeline»: el negativo NAG no va con el ControlNet Union; se quitó.)
  { id: "e", nombre: "FLUX.1 dev + ControlNet canny+depth, strength 0,9", costo: 0.075 },
];

type Gasto = { total: number; llamadas: Array<{ archivo: string; variante: string; semilla: number; costo: number; ms: number; cuando: string }> };

async function main() {
  const args = process.argv.slice(2);
  const seco = args.includes("--seco");
  const solo = args.includes("--solo") ? new Set((args[args.indexOf("--solo") + 1] ?? "").split(",")) : null;
  const semillas = args.includes("--semillas") ? (args[args.indexOf("--semillas") + 1] ?? "").split(",").map(Number) : [...SEMILLAS];
  const { decidir, conContexto } = await import("../../src/lib/registro/servidor");
  const { generarConSempertexFlux, generarConFluxFiel, costeFluxFiel } = await import("../../src/lib/ia/kagutsuchi/flux");
  const { promptRender3d, promptRender3dFiel } = await import("../../src/lib/globos3d/render-ia");

  const captura = readFileSync(join(CARPETA, "captura-3d.jpg"));
  const descripcion = readFileSync(join(CARPETA, "descripcion.txt"), "utf8");
  const promptEdit = promptRender3d(descripcion, "igual_visor");
  const promptFiel = promptRender3dFiel(descripcion, "igual_visor");
  writeFileSync(join(CARPETA, "prompts.txt"), `FLUX.2 /edit (${promptEdit.length}):\n${promptEdit}\n\nFLUX.1 (${promptFiel.length}):\n${promptFiel}\n`);
  if (costeFluxFiel(FIEL.ancho, FIEL.alto, false) !== 0.03) throw new Error("La base de FLUX.1 pasaría de 1 MP.");

  const base = await sharp(captura).resize(FIEL.ancho, FIEL.alto, { fit: "fill" }).png().toBuffer();
  writeFileSync(join(CARPETA, "base-1200.png"), base);
  const rutaGasto = join(CARPETA, "gasto.json");
  const gasto: Gasto = existsSync(rutaGasto) ? JSON.parse(readFileSync(rutaGasto, "utf8")) as Gasto : { total: 0, llamadas: [] };
  const guardarGasto = () => writeFileSync(rutaGasto, JSON.stringify(gasto, null, 2));

  // Controles de la variante d: canny (OpenCV sobre la base) y profundidad (MiDaS de fal, gratis).
  async function controles() {
    const canny = join(CARPETA, "control-canny.png");
    if (!existsSync(canny)) execFileSync("python", ["scripts/exp/render-fiel-medir.py", "--canny", join(CARPETA, "base-1200.png"), canny], { stdio: "inherit" });
    const profundidad = join(CARPETA, "control-depth.png");
    if (!existsSync(profundidad)) {
      if (seco) return null;
      const key = process.env.FAL_KEY;
      if (!key) throw new Error("Falta FAL_KEY en .env.local.");
      // Por la cola (queue.fal.run): el filtro web de la red bloquea fal.run (403 en HTML).
      const auth = { Authorization: `Key ${key}` };
      const envio = await fetch("https://queue.fal.run/fal-ai/imageutils/depth", {
        method: "POST", headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ image_url: `data:image/png;base64,${base.toString("base64")}` }),
      });
      if (!envio.ok) throw new Error(`fal-ai/imageutils/depth respondió ${envio.status}`);
      const cola = (await envio.json()) as { status_url?: string; response_url?: string };
      if (!cola.status_url?.startsWith("https://queue.fal.run/") || !cola.response_url?.startsWith("https://queue.fal.run/")) throw new Error("La cola de profundidad no es de fal.");
      for (let i = 0; i < 60; i++) {
        const estado = (await (await fetch(cola.status_url, { headers: auth })).json()) as { status?: string };
        if (estado.status === "COMPLETED") break;
        if (estado.status === "FAILED" || estado.status === "CANCELLED") throw new Error("La profundidad falló en fal.");
        await new Promise((r) => setTimeout(r, 1000));
      }
      const url = ((await (await fetch(cola.response_url, { headers: auth })).json()) as { image?: { url?: string } }).image?.url;
      if (!url || !/^https:\/\/([a-z0-9-]+\.)*fal\.media\//.test(url)) throw new Error("La profundidad no vino de fal.media.");
      const png = await sharp(Buffer.from(await (await fetch(url)).arrayBuffer())).resize(FIEL.ancho, FIEL.alto, { fit: "fill" }).png().toBuffer();
      writeFileSync(profundidad, png);
      decidir("exp:render_fiel_profundidad", "mapa de profundidad de la captura (fal-ai/imageutils/depth, US$0)", { bytes: png.length });
    }
    return [
      { modo: "canny" as const, base64: readFileSync(canny).toString("base64"), mime: "image/png", escala: 0.6, fin: 0.8 },
      { modo: "depth" as const, base64: readFileSync(profundidad).toString("base64"), mime: "image/png", escala: 0.6, fin: 0.8 },
    ];
  }

  await conContexto({ conversacion: "exp-render-fiel" }, async () => {
    // Los controles de d se preparan antes de contar nada: si fallan, no hubo llamada a FLUX.
    const controlesD = (["d", "e"] as const).some((id) => (!solo || solo.has(id)) && SEMILLAS.some((s) => !existsSync(join(CARPETA, `${id}-s${s}.png`)))) ? await controles() : null;
    for (const v of VARIANTES) {
      if (solo && !solo.has(v.id)) continue;
      for (const semilla of semillas) {
        const archivo = `${v.id}-s${semilla}.png`;
        if (existsSync(join(CARPETA, archivo))) { console.log(`${archivo}: ya está (no se vuelve a pagar)`); continue; }
        if (gasto.total + v.costo > TOPE_USD + 1e-9) { console.log(`${archivo}: NO se pide — pasaría el tope (${gasto.total.toFixed(3)} + ${v.costo.toFixed(3)} > ${TOPE_USD})`); continue; }
        if (seco) { console.log(`${archivo}: pediría ${v.nombre} por ~US$${v.costo.toFixed(3)}`); continue; }
        decidir("exp:render_fiel_llamada", `variante ${v.id} (${v.nombre}), semilla ${semilla}`, { variante: v.id, semilla, costoPrevisto: v.costo, gastoPrevio: gasto.total, tope: TOPE_USD });
        const t0 = Date.now();
        try {
          const imagen = v.id === "a"
            ? await generarConSempertexFlux(promptEdit, "3:2", [], {
              loras: [], guidanceScale: 3.5, seed: semilla, telemetria: { superficie: "exp-render-fiel" },
              imagenesEdit: [{ id: "captura-3d", descripcion: "Captura del taller 3D: la decoración que se conserva", base64: captura.toString("base64"), mime: "image/jpeg", role: "previous_generated_result", priority: 1, allowed_use: "base que se conserva: forma, cantidades y colores de la decoración" }],
            })
            : await generarConFluxFiel(promptFiel, {
              imagen: { base64: base.toString("base64"), mime: "image/png", ancho: FIEL.ancho, alto: FIEL.alto },
              strength: v.id === "b" ? 0.35 : v.id === "c" ? 0.55 : v.id === "d" ? 0.7 : 0.9,
              seed: semilla,
              ...(v.id === "d" ? { controles: controlesD ?? [] } : {}),
              ...(v.id === "e" ? { controles: (controlesD ?? []).map((c) => (c.modo === "canny" ? { ...c, escala: 0.7 } : c)), } : {}),
              telemetria: { superficie: "exp-render-fiel" },
            });
          writeFileSync(join(CARPETA, archivo), Buffer.from(imagen.base64, "base64"));
          gasto.total = Math.round((gasto.total + v.costo) * 1000) / 1000;
          gasto.llamadas.push({ archivo, variante: v.id, semilla, costo: v.costo, ms: Date.now() - t0, cuando: new Date().toISOString() });
          guardarGasto();
          console.log(`${archivo}: ok en ${Math.round((Date.now() - t0) / 1000)} s · gasto ${gasto.total.toFixed(3)} USD`);
        } catch (error) {
          const mensaje = error instanceof Error ? error.message : String(error);
          decidir("exp:render_fiel_error", `variante ${v.id} semilla ${semilla} falló`, { mensaje: mensaje.slice(0, 300) });
          // Si fal llegó a aceptar el pedido, se cuenta como cobrado (por si acaso): solo el rechazo al enviar no cuesta.
          if (!/rechazó la solicitud/.test(mensaje)) {
            gasto.total = Math.round((gasto.total + v.costo) * 1000) / 1000;
            gasto.llamadas.push({ archivo: `${archivo} (error)`, variante: v.id, semilla, costo: v.costo, ms: Date.now() - t0, cuando: new Date().toISOString() });
            guardarGasto();
          }
          console.log(`${archivo}: ERROR ${mensaje.slice(0, 300)} — se detiene esta variante`);
          break;
        }
      }
    }
  });
  console.log(`Gasto total: US$${gasto.total.toFixed(3)} de ${TOPE_USD}`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
