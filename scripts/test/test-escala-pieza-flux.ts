/**
 * La imagen respeta la ESCALA del plan en todas las piezas (2026-10-07, pedido del dueño: «GUIRNALDA SACA ESTA
 * ABERRACIÓN»).
 *
 * Producción (guiada-20261007-055050-xkkihw, idea deco-real-18-sddefault «Guirnalda rosa pastel y dorado»): una
 * guirnalda de 2,4 m con 37 globos (5, 12 y 18″) llegó a FLUX como
 *   «A grand organic balloon garland made of mixed small 5-inch, medium 12-inch and large 18-inch latex balloons, …
 *   running along the rear wall. …»
 * y FLUX base pintó un marco orgánico de pared a pared con cientos de globos, algunos de 36″. El caption no decía ni
 * el largo ni los globos, «grand» salía de «focal y ≥ 2,4 m», «running along the rear wall» la estiraba de pared a
 * pared y nada acotaba la talla. El arreglo (caption-flux.ts, vocabulario-base.ts): sujeto + escala primero (medidas
 * en m / ft y «about N balloons» de cada pieza), «small» solo para una guirnalda o bouquet corto y «grand» solo para
 * una instalación de verdad grande, la guirnalda corta colgada sobre la mesa principal (objeto de tamaño conocido),
 * lo que la pieza NO es dicho en positivo (FLUX.2 no admite negativos: una sola tira horizontal que cubre parte de la
 * pared con los extremos libres; ningún globo mayor que la talla mayor del plan, con su objeto) y plano medio en una
 * escena pequeña.
 *
 * Se compila con la MISMA cadena que /api/generate (`scripts/lib/caption-de-cuerpo-generate.ts`: plan → blueprint →
 * escena aprobada → contexto visual → `compileProductPrompt`), sin red, sin base de datos y sin FLUX (US$0). La
 * clásica y la guiada mandan el mismo cuerpo (test-cuerpo-generacion.ts) y pasan por el mismo compilador.
 *
 *   npx tsx --conditions=react-server scripts/test/test-escala-pieza-flux.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { captionDeCuerpoGenerate, type CuerpoGenerateGuardado } from "../lib/caption-de-cuerpo-generate";
import { BASE_PROMPT_MAX_LENGTH } from "../../src/lib/ia/kagutsuchi/caption-flux";
import { compileProductPrompt, type ElementSizeConfirmation } from "../../src/lib/ia/kagutsuchi/producto-flux";
import { preflightFluxPrompt } from "../../src/lib/ia/kagutsuchi/preflight-flux";
import { medidaBase, topeTallaBase } from "../../src/lib/ia/kagutsuchi/vocabulario-base";
import type { SceneSpec } from "../../src/lib/ia/escena/scene-spec";
import type { VisualContext } from "../../src/lib/ia/escena/visual-context";
import type { FraseDeEstructura } from "../../src/lib/ia/uzume/mezcla-color-escena";

const RAIZ = process.cwd();
const ANALISIS = path.join(RAIZ, "data", "biblioteca-real", "analisis");
const IDEAS = JSON.parse(readFileSync(path.join(RAIZ, "src", "lib", "biblioteca-sempertex", "planes-ideas.json"), "utf8")) as { ideas: Record<string, { plan: PlanGuardado }> };

type EstructuraGuardada = { medidas: Record<string, number> };
type PlanGuardado = { concepto: { paleta: string[] }; estructuras: EstructuraGuardada[] };
type Guardado = { plan_resuelto: { plan: PlanGuardado } & Record<string, unknown>; material_estimate: Parameters<typeof captionDeCuerpoGenerate>[1]["material_estimate"] };

/** El prompt de producción ANTES del arreglo (registro de Vercel, regla:prompt_flux, 10:51:15 Z, las tres veces igual). */
const PROMPT_PRODUCCION_ANTES = "A grand organic balloon garland made of mixed small 5-inch, medium 12-inch and large 18-inch latex balloons, mostly soft matte light pink (#E6CFD6) with reflective chrome gold and matte white (#FFFFFF) running along the rear wall. Baby shower celebration atmosphere, professional event photograph, realistic latex balloons with natural reflections, sharp detail, natural depth.";

let fallos = 0;
async function caso(nombre: string, prueba: () => Promise<void> | void): Promise<void> {
  try {
    await prueba();
    console.log(`ok   ${nombre}`);
  } catch (error) {
    fallos += 1;
    console.error(`FALLA ${nombre}\n${error instanceof Error ? error.message : String(error)}`);
  }
}

/** El caption de un plan guardado de la biblioteca, con el plan de la idea del catálogo o con medidas cambiadas. */
async function captionDePlan(archivo: string, opciones: { idea?: string; medidas?: Record<string, number>; cuerpo?: CuerpoGenerateGuardado; maxLength?: number } = {}) {
  const guardado = JSON.parse(readFileSync(path.join(ANALISIS, archivo), "utf8")) as Guardado;
  let plan = opciones.idea ? IDEAS.ideas[opciones.idea]!.plan : guardado.plan_resuelto.plan;
  if (opciones.medidas) plan = { ...plan, estructuras: plan.estructuras.map((estructura, indice) => (indice === 0 ? { ...estructura, medidas: { ...estructura.medidas, ...opciones.medidas } } : estructura)) };
  const cuerpo = opciones.cuerpo ?? { brief: { tipo_evento: "baby shower", colores: plan.concepto.paleta, estilo: "Baby shower niña" } as never, solicitudUsuario: "Baby shower. Niña.", creatividad: 2 };
  // El plan guardado ya está mapeado (`planResueltoDesdePython`); el contrato de transporte se le devuelve para el adaptador.
  const r = await captionDeCuerpoGenerate(cuerpo, { plan_resuelto: { schema_version: "plan-resuelto.v1", ...guardado.plan_resuelto, plan }, material_estimate: guardado.material_estimate }, opciones.maxLength);
  return r;
}

/** Lo que todo caption debe cumplir: cabe, pasa el preflight, sin «grand» de más ni la palabra «arch» si no hay arco. */
function comunes(nombre: string, r: { prompt: string; preflight: { ok: boolean; errors: string[] } }): void {
  assert.ok(r.prompt.length <= BASE_PROMPT_MAX_LENGTH, `${nombre}: cabe en ${BASE_PROMPT_MAX_LENGTH} (mide ${r.prompt.length})\n${r.prompt}`);
  assert.equal(r.preflight.ok, true, `${nombre}: preflight ${r.preflight.errors.join("; ")}\n${r.prompt}`);
  assert.doesNotMatch(r.prompt, /,\s*\(#|#[0-9A-F]{6}(?!\))/i, `${nombre}: ningún hex suelto`);
}

/** Tallas en pulgadas que nombra el caption. */
function tallasDelTexto(texto: string): number[] {
  return [...new Set([...texto.matchAll(/\b(\d+)-inch\b/g)].map((coincidencia) => Number(coincidencia[1])))].sort((a, b) => a - b);
}

async function main(): Promise<void> {
  await caso("vocabulario: medidas en m / ft y tope de talla con su objeto", () => {
    assert.equal(medidaBase(2.4), "2.4 m / 8 ft");
    assert.equal(medidaBase(2.4, true), "2.4 m");
    assert.equal(medidaBase(5.49), "5.5 m / 18 ft");
    assert.equal(medidaBase(0.7), "0.7 m / 2.5 ft");
    assert.equal(topeTallaBase(18), "every balloon at most 18-inch, about beach-ball size");
    assert.equal(topeTallaBase(12, true), "every balloon at most head size");
    assert.equal(topeTallaBase(24), undefined, "con globos de 24″ o más el plan compra jumbos: no se acota");
  });

  await caso("guirnalda de la idea deco-real-18 (37 globos, 2,4 m): tipo, escala, colocación y contra-forma", async () => {
    const r = await captionDePlan("real-18-sddefault.plan.json", { idea: "deco-real-18-sddefault" });
    console.log(`     ANTES  [${PROMPT_PRODUCCION_ANTES.length}] ${PROMPT_PRODUCCION_ANTES}`);
    console.log(`     DESPUÉS [${r.prompt.length}] ${r.prompt}`);
    comunes("guirnalda", r);
    // Con el límite viejo de 1000 la guirnalda también cabe entera (escala y contra-forma): lo que se compacta antes es
    // el entorno del evento (entorno-escena.ts), que con 1500 va completo después de la decoración.
    const viejo = await captionDePlan("real-18-sddefault.plan.json", { idea: "deco-real-18-sddefault", maxLength: 1000 });
    assert.ok(viejo.prompt.length <= 1000 && viejo.preflight.ok, `la guirnalda cabe también en el límite viejo de 1000 (mide ${viejo.prompt.length})`);
    assert.ok(viejo.prompt.startsWith("A small organic balloon garland, 2.4 m / 8 ft long with about 37 balloons, made of "), `con 1000, la escala entera\n${viejo.prompt}`);
    assert.match(viejo.prompt, /One single horizontal strip spanning only part of the wall, both ends hanging free in mid-air, every balloon at most 18-inch, about beach-ball size\./);
    assert.notEqual(r.prompt, PROMPT_PRODUCCION_ANTES);
    // Sujeto + escala primero.
    assert.ok(r.prompt.startsWith("A small organic balloon garland, 2.4 m / 8 ft long with about 37 balloons, made of "), r.prompt);
    assert.doesNotMatch(r.prompt, /\bgrand\b|\blarge organic\b/, "una guirnalda de 37 globos no es «grand»");
    // Colocación realista con un objeto de tamaño conocido, sin estirarla de pared a pared.
    assert.match(r.prompt, /hung horizontally on the rear wall above the main table/);
    assert.doesNotMatch(r.prompt, /running along the rear wall/);
    // Lo que NO es, en positivo (FLUX.2 no admite negativos): una tira, parte de la pared, extremos libres, tope de talla.
    assert.match(r.prompt, /One single horizontal strip spanning only part of the wall, both ends hanging free in mid-air, every balloon at most 18-inch, about beach-ball size\./);
    assert.doesNotMatch(r.prompt, /\barch(es)?\b|\bframe\b|\bgiant\b|\bjumbo\b|\bbackdrop\b/i, "ni se nombra lo que no es");
    // Solo las tallas del plan (5, 12, 18″); nada de 24 ni 36.
    assert.deepEqual(tallasDelTexto(r.prompt), [5, 12, 18]);
    assert.doesNotMatch(r.prompt, /extra-large|\b24-inch|\b36-inch/);
    // Hex pegado a su color; plano medio en una escena pequeña.
    assert.match(r.prompt, /light pink \(#E6CFD6\)/);
    assert.match(r.prompt, /white \(#FFFFFF\)/);
    assert.match(r.prompt, /medium shot showing the whole decoration/);
  });

  await caso("paridad: la escala sale del plan, igual con el brief y la solicitud de cualquier vista", async () => {
    const guiada = await captionDePlan("real-18-sddefault.plan.json", { idea: "deco-real-18-sddefault" });
    const clasica = await captionDePlan("real-18-sddefault.plan.json", { idea: "deco-real-18-sddefault", cuerpo: { brief: { colores: ["rosado", "dorado", "blanco"] } as never, solicitudUsuario: "Quiero una guirnalda rosa pastel y dorado para un baby shower", creatividad: 2 } });
    comunes("clásica", clasica);
    for (const frase of ["A small organic balloon garland, 2.4 m / 8 ft long with about 37 balloons", "above the main table", "One single horizontal strip spanning only part of the wall", "every balloon at most 18-inch"]) {
      assert.ok(guiada.prompt.includes(frase) && clasica.prompt.includes(frase), `«${frase}» en las dos\n${guiada.prompt}\n${clasica.prompt}`);
    }
  });

  await caso("con la foto del espacio la cámara y los muebles ya están: ni mesa inventada ni plano medio", async () => {
    const r = await captionDePlan("real-18-sddefault.plan.json", { idea: "deco-real-18-sddefault" });
    const sceneSpec = { ...r.sceneSpec, generation_mode: "edit_venue" as const, venue: { ...r.sceneSpec.venue, source_image_id: "VENUE_01" } };
    const c = compileProductPrompt({ ...r.entrada, sceneSpec });
    comunes("guirnalda en la foto", { prompt: c.prompt, preflight: preflightFluxPrompt({ sceneSpec, clauses: c.clauses, prompt: c.prompt }) });
    assert.ok(c.prompt.startsWith("A small organic balloon garland, 2.4 m / 8 ft long with about 37 balloons, "), c.prompt);
    assert.match(c.prompt, /hung horizontally on the rear wall\. One single horizontal strip spanning only part of the wall/);
    assert.doesNotMatch(c.prompt, /main table|medium shot/, c.prompt);
  });

  await caso("guirnalda larga (120 globos, 5,5 m): sin «small», corre a lo largo de la pared, tope de 12″", async () => {
    const r = await captionDePlan("real-11-images-26.plan.json");
    comunes("guirnalda larga", r);
    assert.ok(r.prompt.startsWith("An organic balloon garland, 5.5 m / 18 ft long with about 120 balloons, made of "), r.prompt);
    assert.match(r.prompt, /running along the rear wall/);
    assert.match(r.prompt, /One single horizontal strip, both ends hanging free in mid-air, every balloon at most 12-inch, about head size\./);
    assert.doesNotMatch(r.prompt, /spanning only part of the wall|medium shot|\bsmall organic\b/);
  });

  await caso("columnas orgánicas (2 m, 39 y 48 globos): altura y globos de cada una, sin «large»; con 24″ no se acota", async () => {
    const r = await captionDePlan("real-07-eb12910e210c94b6184d025127acce95.plan.json");
    comunes("columnas", r);
    assert.match(r.prompt, /^An organic balloon column, 2 m(?: \/ 7 ft)? tall,? (?:with )?about 39 balloons, made of /);
    assert.match(r.prompt, /an organic balloon column, 2 m(?: \/ 7 ft)? tall,? (?:with )?about 48 balloons, made of /);
    assert.doesNotMatch(r.prompt, /\b(?:grand|large) organic\b/);
    assert.doesNotMatch(r.prompt, /every balloon at most/, "el plan compra globos de 24″");
    assert.doesNotMatch(r.prompt, /horizontal strip/);
  });

  await caso("arco de 3 m (145 globos de 12″): ancho y alto en m / ft, globos, tope de 12″, sin «grand»", async () => {
    const r = await captionDePlan("real-01-305.plan.json", { medidas: { ancho_m: 3, alto_m: 2.5 } });
    comunes("arco", r);
    assert.ok(r.prompt.startsWith("An organic balloon garland arch, 3 m / 10 ft wide and 2.5 m / 8 ft tall with about 145 balloons, made of "), r.prompt);
    assert.match(r.prompt, /Every balloon at most 12-inch, about head size\./);
    assert.deepEqual(tallasDelTexto(r.prompt), [12]);
    assert.doesNotMatch(r.prompt, /\bgrand\b|horizontal strip/);
  });

  await caso("ej06 (tres piezas del motor orgánico, muchos colores): la escala de cada pieza cabe en el límite y también en 1000", () => {
    type Fixture = { sceneSpec: SceneSpec; visualContext: VisualContext; sizeConfirmations: ElementSizeConfirmation[]; productIdAliases: Array<[string, string[]]>; productCatalogTitles: Array<[string, string]>; ambientDecor: string[]; creativeCues: string[]; officialStructures: Array<[string, string]>; colorPatterns: FraseDeEstructura[] };
    const f = JSON.parse(readFileSync(path.join(RAIZ, "scripts", "test", "fixtures", "caption-flux-ejemplo-06.json"), "utf8")) as Fixture;
    // El límite del prompt pasó de 1000 a 1500 el mismo día (pedido del dueño): la escala cabe con los dos.
    for (const limite of [BASE_PROMPT_MAX_LENGTH, 1000]) {
      const c = compileProductPrompt({ sceneSpec: f.sceneSpec, visualContext: f.visualContext, sizeConfirmations: f.sizeConfirmations, productIdAliases: new Map(f.productIdAliases), productCatalogTitles: new Map(f.productCatalogTitles), ambientDecor: f.ambientDecor, creativeCues: f.creativeCues, officialStructures: new Map(f.officialStructures), colorPatterns: f.colorPatterns, maxLength: limite });
      const preflight = preflightFluxPrompt({ sceneSpec: f.sceneSpec, clauses: c.clauses, prompt: c.prompt, maxLength: limite });
      console.log(`     ej06 límite ${limite} [${c.prompt.length}] ${c.prompt}`);
      assert.ok(c.prompt.length <= limite, `ej06: cabe en ${limite} (mide ${c.prompt.length})`);
      assert.equal(preflight.ok, true, `ej06 (${limite}): preflight ${preflight.errors.join("; ")}`);
      for (const escala of [/2\.2 m(?: \/ 7 ft)? tall/, /about 105 balloons/, /1\.8 m(?: \/ 6 ft)? tall/, /about 165 balloons/, /2\.5 m(?: \/ 8 ft)? long/, /about 204 balloons/]) assert.match(c.prompt, escala);
      assert.doesNotMatch(c.prompt, /every balloon at most/, "ej06 compra globos de 24″");
    }
  });

  if (fallos) {
    console.error(`\n${fallos} caso(s) fallaron`);
    process.exit(1);
  }
  console.log("\ntest-escala-pieza-flux: todo OK");
}

void main();
