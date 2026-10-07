/**
 * Flores de globo en el caption FLUX (2026-10-07): la frase de las flores de una pieza («with 2 small balloon flowers of
 * 5-inch pearl white petals around chrome gold centers»), sin comas, delante de la frase de su pieza, y el caption entero
 * del plan EXACTO de la idea del dueño («Aro de globos blanco, dorado y nude con flores») dentro de 1000 caracteres, con
 * la misma cadena que /api/generate (`scripts/lib/caption-de-cuerpo-generate.ts`). Sin red, sin base y sin FLUX (US$0).
 *
 *   npx tsx --conditions=react-server scripts/test/test-flores-caption-flux.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { BASE_PROMPT_MAX_LENGTH } from "@/lib/ia/kagutsuchi/caption-flux";
import { frasesDeEstructuras } from "@/lib/ia/uzume/mezcla-color-escena";
import { fraseFloresFlux } from "@/lib/plan/flores-pieza";
import { captionDeCuerpoGenerate } from "../lib/caption-de-cuerpo-generate";

const RAIZ = process.cwd();
let fallos = 0;
async function caso(nombre: string, prueba: () => Promise<void> | void): Promise<void> {
  try {
    await prueba();
    console.log(`ok   ${nombre}`);
  } catch (error) {
    fallos += 1;
    console.error(`FALLA ${nombre}: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  }
}

async function principal(): Promise<void> {
  await caso("3. caption FLUX: la frase de las flores, sin comas, delante de la de su pieza y dentro de 1000 caracteres", async () => {
    const frase = fraseFloresFlux(
      { flores: { cantidad: 2, petalos: 6, petalo: { product_id: "silk", color: "blanco" }, centro: { product_id: "reflex", color: "dorado" } }, repeticiones: 1 },
      [
        { adorno: "flor", product_id: "silk", color: "blanco", unidades: 12, diam_pulg: 5, titulo: "B2b Globo Latex Redondo Silk Blanco Nácar — R-5 / PAQUETE X 20" },
        { adorno: "flor", product_id: "reflex", color: "dorado", unidades: 2, diam_pulg: 5, titulo: "B2b Globo Latex Redondo Reflex Dorado — R-5 / PAQUETE X 20" },
      ],
    );
    assert.equal(frase, "with 2 small balloon flowers of 5-inch pearl white petals around chrome gold centers");
    assert.doesNotMatch(frase!, /,/, "sin comas: el compilador acorta por comas desde el final");
    // El plan EXACTO de la idea del dueño, resuelto, con sus flores: la misma cadena que /api/generate.
    const guardado = JSON.parse(readFileSync(path.join(RAIZ, "data", "biblioteca-real", "analisis", "nueva-sempertex-08.plan.json"), "utf8"));
    const idea = JSON.parse(readFileSync(path.join(RAIZ, "src", "lib", "biblioteca-sempertex", "planes-ideas.json"), "utf8")).ideas["deco-real-28-aro-blanco-dorado-y-nude"];
    const plan = { ...guardado.plan_resuelto.plan, estructuras: guardado.plan_resuelto.plan.estructuras.map((estructura: Record<string, unknown>, indice: number) => (indice === 0 ? { ...estructura, flores: idea.plan.estructuras[0].flores } : estructura)) };
    const estructuras = guardado.plan_resuelto.estructuras.map((estructura: { lineas: Array<Record<string, unknown>> }, indice: number) => {
      if (indice !== 0) return estructura;
      const silk = estructura.lineas.find((linea) => String(linea.titulo).includes("Silk") && linea.diam_pulg === 5)!;
      const reflex = estructura.lineas.find((linea) => String(linea.titulo).includes("Reflex") && linea.diam_pulg === 5)!;
      return { ...estructura, lineas: [...estructura.lineas, { ...silk, unidades: 12, adorno: "flor" }, { ...reflex, unidades: 2, adorno: "flor" }] };
    });
    const frases = frasesDeEstructuras({ plan, estructuras } as never);
    assert.ok(frases?.some((item) => item.estructura_id === "EST_01_ARO_CIRCULAR" && item.prompt_lora.startsWith("with 2 small balloon flowers of 5-inch pearl white petals around chrome gold centers")), JSON.stringify(frases));
    const cuerpo = { brief: { tipo_evento: "boda", colores: ["blanco", "dorado", "beige"], estilo: "Boda" } as never, solicitudUsuario: "Aro de globos blanco, dorado y nude con flores.", creatividad: 2 };
    const python = { plan_resuelto: { schema_version: "plan-resuelto.v1", ...guardado.plan_resuelto, plan, estructuras }, material_estimate: guardado.material_estimate };
    const r = await captionDeCuerpoGenerate(cuerpo, python);
    assert.ok(r.prompt.length <= BASE_PROMPT_MAX_LENGTH, `cabe en ${BASE_PROMPT_MAX_LENGTH} (mide ${r.prompt.length})\n${r.prompt}`);
    assert.match(r.prompt, /small balloon flowers of 5-inch pearl white petals around chrome gold centers/, r.prompt);
    console.log(`     caption (${r.prompt.length}): ${r.prompt}`);
    // Con el tope de 1000 caracteres, la compactación quita escenario y cola antes que las flores.
    const corto = await captionDeCuerpoGenerate(cuerpo, python, 1000);
    assert.ok(corto.prompt.length <= 1000, `cabe en 1000 (mide ${corto.prompt.length})\n${corto.prompt}`);
    assert.match(corto.prompt, /small balloon flowers of 5-inch pearl white petals around chrome gold centers/, corto.prompt);
    console.log(`     caption con tope 1000 (${corto.prompt.length}): ${corto.prompt}`);
    // Sin flores, la petición de siempre: ninguna frase nueva.
    assert.equal(frasesDeEstructuras({ plan: guardado.plan_resuelto.plan, estructuras: guardado.plan_resuelto.estructuras } as never), undefined);
  });

  if (fallos) {
    console.error(`${fallos} caso(s) fallaron`);
    process.exit(1);
  }
  console.log("flores en el caption: todo bien");
}

void principal();
