/**
 * Experimento PAGADO «color fiel» (2026-10-08): FLUX.2 `/edit` cambiaba los colores de la captura (ΔE ~23). Medido
 * en render-fiel/a-s*.png: toda la imagen sale más cálida y oscura (la pared pasa de L92 b*4 a L78 b*24) y el
 * «Fashion Azul Caribe» (#4bbbcf, celeste aguamarina) sale verde azulado: el texto lo llamaba «turquoise» y la sala
 * «warm off-white». Variante f: el mismo `/edit` y la misma captura con el texto corregido (nombre real del color +
 * hex oficial de cada globo, pared neutra y una frase de balance de blancos y exposición). Dos semillas.
 * Tope declarado: US$0,12 (2 × 0,048). Lo que ya está en la carpeta no se vuelve a pedir.
 *
 * Uso: NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/exp/render-color.ts [--seco]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

for (const archivo of [".env.local", ".env"]) if (existsSync(archivo)) process.loadEnvFile(archivo);
process.env.REGISTRO_ACTIVO = "1";

const CARPETA = "C:/Users/davidt/Downloads/pictures-workspace/render-fiel";
const TOPE_USD = 0.12;
const COSTO = (2 + 2) * 0.012;
const SEMILLAS = [11, 22] as const;

/** El texto de render-fiel/descripcion.txt con el nombre real y el hex oficial (hexGlobo) de cada color. */
const CAMBIOS: ReadonlyArray<[string, string]> = [
  ["dark brown trunk with small brown accents, turquoise and matte lime green canopy and matte red balloon fruits",
    "chocolate brown (#684C41) trunk with small brown (#835836) accents, a canopy of light Caribbean blue (#4BBBCF, a pale aqua blue, not green) and lime green (#8AC85B) balloons, and red (#E01B2B) balloon fruits"],
  ["with brown trunk, matte dark green and bright matte green fronds and dark brown coconuts",
    "with brown (#835836) trunk, dark green (#007B45) and bright green (#02AE26) fronds and chocolate brown (#684C41) coconuts"],
  ["in matte nude beige with brown accents", "in latte beige (#CA9E5D) with brown (#835836) accents"],
  ["in matte orange and matte lime green", "in orange (#E75D1D) and lime green (#8AC85B)"],
  ["warm off-white back and side walls", "neutral off-white (#EEEAE5) back and side walls"],
  ["about 29% turquoise, 23% dark brown, 20% brown, 19% matte lime green, 5% matte red, 1% matte dark green",
    "about 29% Caribbean blue #4BBBCF, 23% chocolate brown #684C41, 20% brown #835836, 19% lime green #8AC85B, 5% red #E01B2B, 1% dark green #007B45"],
];
const FIDELIDAD = "Color fidelity: neutral daylight white balance and the same exposure and brightness as the input; every balloon keeps exactly the color it has in the input image and the hex code given; do not warm, darken, desaturate or recolor anything.";

async function main() {
  const seco = process.argv.includes("--seco");
  const { decidir, conContexto } = await import("../../src/lib/registro/servidor");
  const { generarConSempertexFlux } = await import("../../src/lib/ia/kagutsuchi/flux");
  const { promptRender3d } = await import("../../src/lib/globos3d/render-ia");

  let descripcion = readFileSync(join(CARPETA, "descripcion.txt"), "utf8");
  for (const [de, a] of CAMBIOS) {
    if (!descripcion.includes(de)) throw new Error(`No está en descripcion.txt: «${de.slice(0, 50)}…»`);
    descripcion = descripcion.replace(de, a);
  }
  const prompt = `${promptRender3d(descripcion, "igual_visor")} ${FIDELIDAD}`;
  writeFileSync(join(CARPETA, "prompt-f.txt"), `${prompt.length}\n${prompt}\n`);
  const captura = readFileSync(join(CARPETA, "captura-3d.jpg"));
  const rutaGasto = join(CARPETA, "gasto-color.json");
  const gasto = existsSync(rutaGasto) ? JSON.parse(readFileSync(rutaGasto, "utf8")) as { total: number } : { total: 0 };

  await conContexto({ conversacion: "exp-render-color" }, async () => {
    for (const semilla of SEMILLAS) {
      const archivo = `f-s${semilla}.png`;
      if (existsSync(join(CARPETA, archivo))) { console.log(`${archivo}: ya está`); continue; }
      if (gasto.total + COSTO > TOPE_USD + 1e-9) { console.log(`${archivo}: NO — pasaría el tope de US$${TOPE_USD}`); continue; }
      if (seco) { console.log(`${archivo}: pediría FLUX.2 /edit por ~US$${COSTO}`); continue; }
      decidir("exp:render_color_llamada", `variante f (FLUX.2 /edit, texto con hex), semilla ${semilla}`, { semilla, costoPrevisto: COSTO, gastoPrevio: gasto.total, tope: TOPE_USD });
      const imagen = await generarConSempertexFlux(prompt, "3:2", [], {
        loras: [], guidanceScale: 3.5, seed: semilla, telemetria: { superficie: "exp-render-color" },
        imagenesEdit: [{ id: "captura-3d", descripcion: "Captura del taller 3D: la decoración que se conserva", base64: captura.toString("base64"), mime: "image/jpeg", role: "previous_generated_result", priority: 1, allowed_use: "base que se conserva: forma, cantidades y colores de la decoración" }],
      });
      writeFileSync(join(CARPETA, archivo), Buffer.from(imagen.base64, "base64"));
      gasto.total = Math.round((gasto.total + COSTO) * 1000) / 1000;
      writeFileSync(rutaGasto, JSON.stringify(gasto));
      console.log(`${archivo}: ok · gasto US$${gasto.total.toFixed(3)}`);
    }
  });
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
