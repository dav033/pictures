/**
 * Experimento PAGADO «render de la boda» (2026-10-09): ¿qué camino de FLUX conserva las mesas, la disposición y la cámara de la captura
 * del taller 3D? Es la reproducción de la conversación 3d-20261009-103125-92b58a (FLUX borró las mesas): misma escena (`escenaBodaRender`:
 * sala de 12 × 9 m, 6 mesas con 4 sillas y un centro de globos cada una, marco orgánico con el panel «Boda Real») y la captura de la sala entera
 * (`captura-boda-render.ts`). Variantes:
 *   a) FLUX.2 `/edit` con el texto de ANTES (prohibía «no other furniture, tables» y «plain and empty») — la línea base que falló;
 *   b) FLUX.2 `/edit` con el texto NUEVO (las mesas y sillas son lo principal; `promptRender3d` con `PREFIJO_MOBILIARIO`);
 *   c) FLUX.1 [dev] imagen-a-imagen, strength 0,55 (`generarConFluxFiel`);
 *   d) FLUX.1 [dev] + ControlNet Union (canny + profundidad), strength 0,7;
 *   e) FLUX.1 [dev] imagen-a-imagen, strength 0,40;
 *   f) FLUX.1 [dev] imagen-a-imagen, strength 0,70 (la única que queda dentro del tope de 6 imágenes).
 * Tope DURO: US$0,40 en total. Antes de cada llamada se suma lo previsto y, si se pasaría, no se llama. Lo que ya está en la carpeta no se
 * vuelve a pedir. Cada llamada queda en la auditoría (`decidir` + el evento `imagen` de flux.ts, conversación «exp-render-boda»).
 *
 * Resultado 2026-10-09 (6 imágenes, US$0,261 de 0,40; carpeta scratchpad/render-fiel con la captura junto a cada una): a) y b) dan foto real pero
 * reencuadran la sala, cambian sillas y rótulo o la disposición (b borró el panel «Boda Real»); c) 0,55 y e) 0,40 conservan mesas, 4 sillas por mesa,
 * centros, marco, panel y cámara; d) ControlNet sale peor (rótulo ilegible, globos manchados); f) 0,70 ya cambia el arco y borra el panel. Ganó c) 0,55:
 * es lo que usa ahora /api/render-3d-imagen con mobiliario y el lugar «Igual al visor» (`STRENGTH_FIEL`). Ninguna da una foto real de una sala.
 *
 * Para la variante a) hace falta la versión anterior del texto (se borró de src al terminar):
 *   git show dca3aebd:src/lib/globos3d/render-ia.ts > src/lib/globos3d/_render-ia-viejo.ts
 *
 * Uso (FAL_KEY se lee de .env.local del repo principal; nunca se imprime):
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/exp/render-boda.ts <carpeta> [--solo a,b] [--semillas 11] [--seco]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import sharp from "sharp";

for (const archivo of [".env.local", ".env", "C:/Users/davidt/Downloads/pictures-workspace/demo-decoracion/.env.local"]) if (existsSync(archivo)) process.loadEnvFile(archivo);
process.env.REGISTRO_ACTIVO = "1";

const CARPETA = process.argv[2];
if (!CARPETA) throw new Error("Falta la carpeta (la de captura-3d-escena.jpg y descripcion.txt).");
const TOPE_USD = 0.4;
const SEMILLA = 11;

type Variante = { id: "a" | "b" | "c" | "d" | "e" | "f"; nombre: string; costo: number };
const VARIANTES: readonly Variante[] = [
  { id: "a", nombre: "FLUX.2 /edit, texto de antes (prohibía mesas)", costo: 0.048 },
  { id: "b", nombre: "FLUX.2 /edit, texto nuevo (mesas y sillas principales)", costo: 0.048 },
  { id: "c", nombre: "FLUX.1 dev i2i strength 0,55", costo: 0.03 },
  { id: "d", nombre: "FLUX.1 dev + ControlNet canny+depth, strength 0,7", costo: 0.075 },
  { id: "e", nombre: "FLUX.1 dev i2i strength 0,40", costo: 0.03 },
  { id: "f", nombre: "FLUX.1 dev i2i strength 0,70", costo: 0.03 },
];

type Gasto = { total: number; llamadas: Array<{ archivo: string; variante: string; semilla: number; costo: number; ms: number; cuando: string }> };

/** El texto de antes: el módulo viejo (`_render-ia-viejo.ts`, copia de la versión anterior) y su descripción con las mesas como «props». */
function descripcionVieja(nueva: string): string {
  const mesas = /Furniture \(main items of the scene\):[^]*?keep every table, chair and centrepiece with this count and layout/;
  const props = "Set pieces (not balloons): 32 party props (6 × round banquet table with a floor-length tablecloth in white (#F7F6F2), 24 × Tiffany (chiavari) chair in yellow (#D6B25A) and off-white (#F4EFE4), a round backdrop panel), exactly as in the input";
  return nueva.replace(mesas, props).replace(/, all plain\./, ", all plain and empty.").replace("Nothing else is in the room beyond the furniture and decorations listed: no extra tables or chairs, food, extra balloons or props", "Nothing else is in the room: no other furniture, tables, food, extra balloons or props");
}

async function main() {
  const args = process.argv.slice(3);
  const seco = args.includes("--seco");
  const solo = args.includes("--solo") ? new Set((args[args.indexOf("--solo") + 1] ?? "").split(",")) : null;
  const semillas = args.includes("--semillas") ? (args[args.indexOf("--semillas") + 1] ?? "").split(",").map(Number) : [SEMILLA];
  const { decidir, conContexto } = await import("../../src/lib/registro/servidor");
  const { generarConSempertexFlux, generarConFluxFiel, costeFluxFiel } = await import("../../src/lib/ia/kagutsuchi/flux");
  const { promptRender3d, promptRender3dFiel } = await import("../../src/lib/globos3d/render-ia");
  // Ruta en una variable: el archivo existe solo mientras se corre la variante a (ver la cabecera) y tsc no debe buscarlo.
  const rutaViejo = "../../src/lib/globos3d/_render-ia-viejo";
  const viejo = (await import(rutaViejo)) as { promptRender3d: (descripcion: string, ambiente: string) => string };

  const captura = readFileSync(join(CARPETA, "captura-3d-escena.jpg"));
  const descripcion = readFileSync(join(CARPETA, "descripcion.txt"), "utf8");
  const meta = await sharp(captura).metadata();
  const razon = (meta.width ?? 3) / (meta.height ?? 2);
  const aspecto = razon < 0.8 ? "2:3" : razon > 1.25 ? "3:2" : "1:1";
  const fiel = aspecto === "3:2" ? { ancho: 1200, alto: 800 } : aspecto === "2:3" ? { ancho: 800, alto: 1200 } : { ancho: 1000, alto: 1000 };
  if (costeFluxFiel(fiel.ancho, fiel.alto, false) !== 0.03) throw new Error("La base de FLUX.1 pasaría de 1 MP.");
  const promptViejo = viejo.promptRender3d(descripcionVieja(descripcion), "igual_visor");
  const promptNuevo = promptRender3d(descripcion, "igual_visor");
  const promptFiel = promptRender3dFiel(descripcion, "igual_visor");
  writeFileSync(join(CARPETA, "prompts.txt"), `a) FLUX.2 /edit, antes (${promptViejo.length}):\n${promptViejo}\n\nb) FLUX.2 /edit, nuevo (${promptNuevo.length}):\n${promptNuevo}\n\nc-f) FLUX.1 (${promptFiel.length}):\n${promptFiel}\n`);

  const base = await sharp(captura).resize(fiel.ancho, fiel.alto, { fit: "fill" }).png().toBuffer();
  writeFileSync(join(CARPETA, "base-fiel.png"), base);
  const rutaGasto = join(CARPETA, "gasto.json");
  const gasto: Gasto = existsSync(rutaGasto) ? JSON.parse(readFileSync(rutaGasto, "utf8")) as Gasto : { total: 0, llamadas: [] };
  const guardarGasto = () => writeFileSync(rutaGasto, JSON.stringify(gasto, null, 2));

  async function controles() {
    const canny = join(CARPETA, "control-canny.png");
    if (!existsSync(canny)) execFileSync("python", ["scripts/exp/render-fiel-medir.py", "--canny", join(CARPETA, "base-fiel.png"), canny], { stdio: "inherit" });
    const profundidad = join(CARPETA, "control-depth.png");
    if (!existsSync(profundidad)) {
      const key = process.env.FAL_KEY;
      if (!key) throw new Error("Falta FAL_KEY.");
      // Por la cola (queue.fal.run): el filtro web de la red bloquea fal.run. La profundidad (MiDaS) es gratis.
      const auth = { Authorization: `Key ${key}` };
      const envio = await fetch("https://queue.fal.run/fal-ai/imageutils/depth", { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ image_url: `data:image/png;base64,${base.toString("base64")}` }) });
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
      writeFileSync(profundidad, await sharp(Buffer.from(await (await fetch(url)).arrayBuffer())).resize(fiel.ancho, fiel.alto, { fit: "fill" }).png().toBuffer());
      decidir("exp:render_boda_profundidad", "mapa de profundidad de la captura (fal-ai/imageutils/depth, US$0)", {});
    }
    return [
      { modo: "canny" as const, base64: readFileSync(canny).toString("base64"), mime: "image/png", escala: 0.6, fin: 0.8 },
      { modo: "depth" as const, base64: readFileSync(profundidad).toString("base64"), mime: "image/png", escala: 0.6, fin: 0.8 },
    ];
  }

  await conContexto({ conversacion: "exp-render-boda" }, async () => {
    const pide = (id: string) => !solo || solo.has(id);
    const controlesD = !seco && pide("d") && semillas.some((s) => !existsSync(join(CARPETA, `d-s${s}.png`))) ? await controles() : null;
    for (const v of VARIANTES) {
      if (!pide(v.id)) continue;
      for (const semilla of semillas) {
        const archivo = `${v.id}-s${semilla}.png`;
        if (existsSync(join(CARPETA, archivo))) { console.log(`${archivo}: ya está (no se vuelve a pagar)`); continue; }
        if (gasto.total + v.costo > TOPE_USD + 1e-9) { console.log(`${archivo}: NO se pide — pasaría el tope (${gasto.total.toFixed(3)} + ${v.costo.toFixed(3)} > ${TOPE_USD})`); continue; }
        if (seco) { console.log(`${archivo}: pediría ${v.nombre} por ~US$${v.costo.toFixed(3)}`); continue; }
        decidir("exp:render_boda_llamada", `variante ${v.id} (${v.nombre}), semilla ${semilla}`, { variante: v.id, semilla, costoPrevisto: v.costo, gastoPrevio: gasto.total, tope: TOPE_USD });
        const t0 = Date.now();
        try {
          const edit = (prompt: string) => generarConSempertexFlux(prompt, aspecto, [], {
            loras: [], guidanceScale: 3.5, seed: semilla, telemetria: { superficie: "exp-render-boda" },
            imagenesEdit: [{ id: "captura-3d", descripcion: "Captura del taller 3D: la decoración que se conserva", base64: captura.toString("base64"), mime: "image/jpeg", role: "previous_generated_result", priority: 1, allowed_use: "base que se conserva: forma, cantidades y colores de la decoración" }],
          });
          const imagen = v.id === "a" ? await edit(promptViejo)
            : v.id === "b" ? await edit(promptNuevo)
              : await generarConFluxFiel(promptFiel, {
                imagen: { base64: base.toString("base64"), mime: "image/png", ancho: fiel.ancho, alto: fiel.alto },
                strength: v.id === "c" ? 0.55 : v.id === "d" ? 0.7 : v.id === "e" ? 0.4 : 0.7,
                seed: semilla,
                ...(v.id === "d" ? { controles: controlesD ?? [] } : {}),
                telemetria: { superficie: "exp-render-boda" },
              });
          writeFileSync(join(CARPETA, archivo), Buffer.from(imagen.base64, "base64"));
          gasto.total = Math.round((gasto.total + v.costo) * 1000) / 1000;
          gasto.llamadas.push({ archivo, variante: v.id, semilla, costo: v.costo, ms: Date.now() - t0, cuando: new Date().toISOString() });
          guardarGasto();
          console.log(`${archivo}: ok en ${Math.round((Date.now() - t0) / 1000)} s · gasto ${gasto.total.toFixed(3)} USD`);
        } catch (error) {
          const mensaje = error instanceof Error ? error.message : String(error);
          decidir("exp:render_boda_error", `variante ${v.id} semilla ${semilla} falló`, { mensaje: mensaje.slice(0, 300) });
          // Si fal llegó a aceptar el pedido se cuenta como cobrado (por si acaso): solo el rechazo al enviar no cuesta.
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
