/**
 * La imagen de «Ver cómo quedaría» respeta las piezas del plan: N piezas → N piezas, cada una con su forma, y
 * ningún arco que el plan no tenga.
 *
 * Caso real del dueño (2026-10-07, guiada-20261006-215048-bnrhtj en Vercel): «2 × Columna orgánica de globos»
 * de 1,8 m (una estructura `columna_asimetrica`, `repeticiones: 2`, `lateral_izquierdo`). Python no tiene dibujo
 * para una columna sin armado (`guia-escena` → `omitidas: sin_dibujo`), así que la guía de escena se cayó y FLUX
 * recibió solo el caption: «Two organic balloon columns … matching one another, one standing on the left and one
 * on the right, with open space between them.» FLUX pintó UN arco orgánico. «Open space between them» también
 * lo cumple un arco (el hueco entre sus dos patas): el caption no decía que las dos piezas son torres de pie,
 * cada una con su remate, ni que nada las une por arriba.
 *
 * Cubre las dos formas del plan: «repeticiones 2» (planes viejos) y dos piezas individuales
 * `lateral_izquierdo`/`lateral_derecho` (piezas siempre individuales), solas y con un semiarco.
 *
 * Sin red ni llamadas pagadas: PlanResuelto congelado → planBlueprint → SceneSpec → compileFluxCaption → preflight,
 * la misma cadena que `/api/generate`.
 *   npx tsx --conditions=react-server scripts/test/test-imagen-piezas-del-plan.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PLAN_RESUELTO_CONTRACT_VERSION, PlanResueltoV1Schema } from "@/lib/ia/contracts/domain-v1";
import { buildApprovedSceneSpec } from "@/lib/ia/escena/scene-spec";
import { buildVisualContext } from "@/lib/ia/escena/visual-context";
import { BASE_PROMPT_MAX_LENGTH, compileFluxCaption } from "@/lib/ia/kagutsuchi/caption-flux";
import { preflightFluxPrompt } from "@/lib/ia/kagutsuchi/preflight-flux";
import { MaterialEstimateSchema } from "@/lib/materiales/estimacion";
import { planBlueprint } from "@/lib/plan/blueprint";
import { planResueltoDesdePython } from "@/lib/plan/python-mapper";
import type { PlanResuelto } from "@/lib/plan/resuelto";
import { cajasDeEstructuras } from "@/lib/plan/ubicaciones";
import { REQUEST_ID_PLAN_FIJADO } from "../lib/vectores-golden";

type Json = Record<string, unknown>;
type Fixture = { plan_resuelto: Json & { plan: Json & { estructuras: Json[] }; estructuras: Json[] }; material_estimate: Json & { balloons: Json[] } };

const DIRECTORIO = join(process.cwd(), "scripts", "fixtures", "planes-fijados");
const leer = (nombre: string): Fixture => JSON.parse(readFileSync(join(DIRECTORIO, `${nombre}.json`), "utf8")) as Fixture;

/** Columna (EST_02_COLUMNAS, 1,8 m, rep 2) y semiarco orgánico (EST_01_SEMIARCO) de dos planes congelados. */
const COLUMNAS = leer("qa-lateral-repetida-x2");
const SEMIARCO = leer("calibracion-cumple-semiarco-columna");
const ARCO = COLUMNAS;

type Pieza = {
  /** De qué fixture y con qué id sale la pieza. */
  de: Fixture;
  origen: string;
  id: string;
  cambios: Json;
};

/** Un plan resuelto con estas piezas: las del fixture, con su id nuevo y sus campos declarados cambiados. */
function plan(piezas: readonly Pieza[]): PlanResuelto {
  const base = structuredClone(COLUMNAS.plan_resuelto);
  const declaradas: Json[] = [];
  const resueltas: Json[] = [];
  for (const pieza of piezas) {
    const renombrar = <T>(valor: T): T => JSON.parse(JSON.stringify(valor).split(`"${pieza.origen}"`).join(`"${pieza.id}"`)) as T;
    const declarada = pieza.de.plan_resuelto.plan.estructuras.find((estructura) => estructura.estructura_id === pieza.origen);
    const resuelta = pieza.de.plan_resuelto.estructuras.find((estructura) => estructura.estructura_id === pieza.origen);
    assert.ok(declarada && resuelta, `falta ${pieza.origen} en el fixture`);
    declaradas.push({ ...renombrar(declarada), ...pieza.cambios });
    const cambiosResueltos = Object.fromEntries(Object.entries(pieza.cambios).filter(([clave]) => clave === "ubicacion" || clave === "repeticiones" || clave === "nombre" || clave === "tipo"));
    resueltas.push({ ...renombrar(resuelta), ...cambiosResueltos });
  }
  const crudo = { ...base, plan: { ...base.plan, estructuras: declaradas }, estructuras: resueltas, costes_por_estructura: [] };
  return planResueltoDesdePython(PlanResueltoV1Schema.parse({ schema_version: PLAN_RESUELTO_CONTRACT_VERSION, request_id: REQUEST_ID_PLAN_FIJADO, ...crudo }));
}

function estimado(piezas: readonly Pieza[]) {
  const balloons = piezas.flatMap((pieza) => pieza.de.material_estimate.balloons
    .filter((linea) => linea.structure_id === pieza.origen)
    .map((linea) => ({ ...linea, structure_id: pieza.id })));
  return MaterialEstimateSchema.parse({ ...COLUMNAS.material_estimate, balloons });
}

/** El caption de FLUX de estas piezas, con la misma cadena que `/api/generate`, y su preflight. */
function caption(piezas: readonly Pieza[]): { prompt: string; ok: boolean; errores: string[] } {
  const resuelto = plan(piezas);
  const blueprint = planBlueprint(resuelto);
  const cajas = cajasDeEstructuras(resuelto.plan.estructuras);
  const sceneSpec = buildApprovedSceneSpec({
    blueprint,
    aspectRatio: "3:2",
    targetBoxes: Object.fromEntries(Object.entries(cajas).map(([id, layout]) => [id, layout.bbox])),
    // Como `/api/generate`: cada material con su título y su color de catálogo (aquí, los de las líneas de Python).
    catalogProducts: Object.fromEntries(blueprint.elements.map((element) => [element.element_id, (element.model_decision?.bill_of_materials ?? []).map((linea) => {
      const delPlan = resuelto.estructuras.flatMap((estructura) => estructura.lineas).find((candidata) => candidata.variant_id === linea.catalog_product_id || candidata.product_id === linea.catalog_product_id);
      return { id: linea.catalog_product_id, name: delPlan?.titulo ?? linea.catalog_product_id, description: "", category: "balloon", colors: delPlan?.color ? [delPlan.color] : [], share: linea.share, role: linea.role };
    })])),
    materialEstimate: estimado(piezas),
    generationMode: "text_to_image",
    createdBy: "server_default",
    planHash: resuelto.plan_hash,
    catalogOnly: true,
  });
  const officialStructures = new Map(resuelto.plan.estructuras.flatMap((estructura) => estructura.estructura_oficial ? [[estructura.estructura_id, estructura.estructura_oficial] as const] : []));
  const compilacion = compileFluxCaption({ sceneSpec, visualContext: buildVisualContext({ brief: { tipo_evento: "cumpleaños" } }), officialStructures });
  const reporte = preflightFluxPrompt({ sceneSpec, clauses: compilacion.clauses, prompt: compilacion.prompt });
  return { prompt: compilacion.prompt, ok: reporte.ok, errores: reporte.errors };
}

const ORGANICA = { estructura_oficial: "columna_asimetrica", mezcla: "organica_fina", densidad: "lujosa" } as const;
const columnaPar = (cambios: Json = {}, id = "EST_01_COLUMNAS"): Pieza => ({ de: COLUMNAS, origen: "EST_02_COLUMNAS", id, cambios: { ...ORGANICA, rol_escena: "focal", ubicacion: "lateral_izquierdo", repeticiones: 2, ...cambios } });
const columna = (id: string, ubicacion: "lateral_izquierdo" | "lateral_derecho", cambios: Json = {}): Pieza => ({ de: COLUMNAS, origen: "EST_02_COLUMNAS", id, cambios: { ...ORGANICA, nombre: "Columna orgánica", rol_escena: "focal", ubicacion, repeticiones: 1, ...cambios } });
const semiarco = (cambios: Json = {}): Pieza => ({ de: SEMIARCO, origen: "EST_01_SEMIARCO", id: "EST_01_SEMIARCO_ASIMETRICO", cambios: { estructura_oficial: "semiarco_asimetrico", rol_escena: "focal", ubicacion: "fondo_pared", repeticiones: 1, ...cambios } });
const arco = (): Pieza => ({ de: ARCO, origen: "EST_01_ARCO", id: "EST_01_ARCO", cambios: {} });

const CASOS = {
  A: { nombre: "A. caso del dueño: 2 columnas orgánicas, repeticiones 2", piezas: [columnaPar()] },
  B: { nombre: "B. 2 columnas orgánicas individuales (izquierda / derecha)", piezas: [columna("EST_01_COLUMNA", "lateral_izquierdo"), columna("EST_02_COLUMNA", "lateral_derecho")] },
  C: { nombre: "C. semiarco + 2 columnas, repeticiones 2 en la entrada (registro 2026-10-06)", piezas: [semiarco(), columnaPar({ ubicacion: "entrada", rol_escena: "soporte" }, "EST_02_COLUMNA")] },
  D: { nombre: "D. semiarco + 2 columnas, repeticiones 2 en laterales", piezas: [semiarco(), columnaPar({ rol_escena: "soporte" }, "EST_02_COLUMNA")] },
  E: { nombre: "E. semiarco + 2 columnas individuales", piezas: [semiarco(), columna("EST_02_COLUMNA", "lateral_izquierdo", { rol_escena: "soporte" }), columna("EST_03_COLUMNA", "lateral_derecho", { rol_escena: "soporte" })] },
  F: { nombre: "F. arco + 2 columnas (el arco SÍ está en el plan)", piezas: [arco(), columnaPar({ rol_escena: "soporte" }, "EST_02_COLUMNAS")] },
  G: { nombre: "G. una sola columna orgánica (CASE-001)", piezas: [columna("EST_01_COLUMNA", "lateral_izquierdo", { ubicacion: "arco_central" })] },
  H: { nombre: "H. 4 columnas, repeticiones 4 en laterales", piezas: [columnaPar({ repeticiones: 4 })] },
} satisfies Record<string, { nombre: string; piezas: Pieza[] }>;

const r = Object.fromEntries(Object.entries(CASOS).map(([clave, caso]) => [clave, caption(caso.piezas)])) as Record<keyof typeof CASOS, ReturnType<typeof caption>>;
if (process.argv.includes("--imprimir")) {
  for (const [clave, caso] of Object.entries(CASOS)) {
    const salida = r[clave as keyof typeof CASOS];
    console.log(`\n## ${caso.nombre}\nok=${salida.ok} ${salida.errores.join("; ")}\n${salida.prompt}`);
  }
}

for (const [clave, caso] of Object.entries(CASOS)) {
  const salida = r[clave as keyof typeof CASOS];
  assert.ok(salida.ok, `${caso.nombre}: el preflight debe pasar; ${salida.errores.join("; ")}`);
  // El límite es el del compilador (1500 desde el 2026-10-07, pedido del dueño), no una cifra fija.
  assert.ok(salida.prompt.length <= BASE_PROMPT_MAX_LENGTH, `${caso.nombre}: ${salida.prompt.length} caracteres`);
}

// Las frases que se verificaron con FLUX real (2026-10-07, ver el informe del agente E).
const TORRES = "with open space between them, each a separate freestanding tower rising from its own base on the floor to its own rounded top, with nothing joining them overhead.";
const PUNTA_LIBRE = "rising from its own base on the floor and curving over to one side, its tip ending in mid-air";
const TRES_PIEZAS = "The curved garland and the two columns are three separate pieces standing on the floor, with a wide empty gap of plain wall between each piece and the next.";

// A/B. El caso del dueño: dos torres sueltas, nada encima. «repeticiones 2» y dos piezas individuales dan el MISMO caption.
assert.ok(r.A.prompt.includes(`one standing on the left and one on the right, ${TORRES}`), r.A.prompt);
// Desde el 2026-10-07 cada pieza dice su escala del plan: medida y globos («each 1.8 m / 6 ft tall with about 39
// balloons», caption-flux.ts, «GUIRNALDA SACA ESTA ABERRACIÓN»), y una escena de 80 globos o menos lleva plano medio.
// En este fixture «repeticiones 2» reparte los 78 globos de la estructura (39 por columna) y cada pieza individual
// hereda los 78 enteros: los dos planes compran distinto, así que la cifra (y con ella el encuadre) es lo único que
// puede cambiar entre las dos formas.
const sinCifras = (texto: string): string => texto.replace(/about \d+ balloons/g, "about N balloons").replace("medium shot showing the whole decoration, ", "");
assert.match(r.A.prompt, /^Two organic balloon columns, each 1\.8 m \/ 6 ft tall with about 39 balloons, /, r.A.prompt);
assert.match(r.B.prompt, /^Two organic balloon columns, each 1\.8 m \/ 6 ft tall with about 78 balloons, /, r.B.prompt);
assert.equal(sinCifras(r.B.prompt), sinCifras(r.A.prompt), "dos piezas individuales izquierda/derecha = una pieza con repeticiones 2");
assert.doesNotMatch(r.A.prompt, /\barch\b/, "dos columnas: ningún arco en el caption");
assert.doesNotMatch(r.A.prompt, /separate pieces standing on the floor/, "un solo par de columnas no lleva la frase de escena: el caption verificado con la semilla del dueño no cambia");

// C/D/E. Semiarco + 2 columnas: tres piezas, el semiarco con su punta libre, y ningún «main arch» (el plan no tiene arco).
for (const caso of [r.C, r.D, r.E]) {
  assert.ok(caso.prompt.includes(PUNTA_LIBRE), caso.prompt);
  assert.ok(caso.prompt.includes(TRES_PIEZAS), caso.prompt);
  assert.match(caso.prompt, /each a separate freestanding tower rising from its own base on the floor to its own rounded top, with nothing joining them overhead/);
  assert.doesNotMatch(caso.prompt, /main arch|\barch\b/, "semiarco + columnas: el caption no nombra un arco que el plan no tiene");
}
assert.match(r.D.prompt, /flanking the curved garland/, "las columnas flanquean el semiarco, no «the main arch»");
assert.equal(sinCifras(r.E.prompt), sinCifras(r.D.prompt), "semiarco + dos columnas individuales = semiarco + columnas con repeticiones 2");

// F. Con un arco en el plan las columnas lo flanquean y no se dice que nada pase entre ellas (el arco pasa).
assert.match(r.F.prompt, /flanking the main arch, each a separate freestanding tower on its own base on the floor, standing apart from the arch/);
assert.doesNotMatch(r.F.prompt, /nothing joining them overhead|separate pieces standing on the floor/);

// G. Una sola pieza: sin cambio (CASE-001 no puede empeorar).
assert.doesNotMatch(r.G.prompt, /separate|nothing joining|tip ending|gap/, r.G.prompt);

// H. Cuatro columnas, dos por lado: cada una su torre.
assert.match(r.H.prompt, /two standing on each side, with open space between them, each a separate freestanding tower/);

console.log("[PASS] imagen de la guiada: N piezas → N piezas (2 columnas, semiarco + 2 columnas, repeticiones 2 = piezas individuales, arco del plan, pieza única, 4 columnas)");
