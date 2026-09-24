/**
 * Barrido combinatorio del compilador LoRA contra el preflight (A2 de
 * docs/mejoras/PLAN-ESTRUCTURAS-Y-UX.md).
 *
 * Invariante: toda escena que el plan puede aprobar (focal + soportes +
 * acentos, hasta 6 estructuras y 4 colores) compila a un prompt que pasa el
 * preflight. Un fallo aquí es exactamente el LORA_PREFLIGHT_FAILED que antes
 * llegaba al cliente.
 *
 * Sin red ni llamadas pagadas. Run: npx tsx scripts/test-lora-preflight-barrido.ts [--detalle]
 */
import assert from "node:assert/strict";
import type { SceneSpec } from "../src/lib/ia/escena/scene-spec";
import { LORA_PROMPT_MAX_LENGTH } from "../src/lib/ia/kagutsuchi/lora-caption-compiler";
import { compileProductPrompt, type ElementSizeConfirmation } from "../src/lib/ia/kagutsuchi/lora-product-runtime";
import { preflightLoraPrompt } from "../src/lib/ia/kagutsuchi/lora-prompt-preflight";
import { buildVisualContext } from "../src/lib/ia/escena/visual-context";
import { ensureLoraTriggers } from "../src/lib/ia/kagutsuchi/sempertex-lora";
import { PRODUCT_VOCABULARY } from "../src/lib/lora/product-vocabulary-data";

type Elemento = SceneSpec["elements"][number];
type Tipo = "arco" | "semiarco" | "guirnalda" | "columna" | "pared" | "centro_mesa" | "backdrop" | "kit" | "accesorio";
type Ubicacion = "fondo_pared" | "arco_central" | "sobre_mesa_principal" | "lateral_izquierdo" | "lateral_derecho" | "piso_frontal" | "mesas_invitados" | "entrada" | "techo";
type Rol = "focal" | "soporte" | "acento";

// Productos reales del vocabulario v007 (los mismos de test-lora-product-runtime.ts).
const PRODUCTO_POR_COLOR: Readonly<Record<string, string>> = {
  dorado: "7109611258049",
  plateado: "20014244",
  rosado: "20010671",
  blanco: "7109565710529",
  fucsia: "7105908572353",
  crema: "10467043344577",
};

const TAMANOS_ESTRUCTURA = ["R-5", "R-9", "R-12", "R-18"];

function elemento(id: string, nombre: string, tipo: Tipo, ubicacion: Ubicacion, rol: Rol, colores: string[], grupo?: string): Elemento {
  const productIds = colores.map((color) => PRODUCTO_POR_COLOR[color]!);
  return {
    element_id: id,
    name: nombre,
    category: tipo === "backdrop" ? "backdrop" : "balloon_structure",
    source_type: "catalog_backed",
    catalog_product_id: productIds[0],
    catalog_product_ids: productIds,
    required: true,
    quantity: { mode: "exact", min: 1, max: 1 },
    target_bbox: { x: 0.1, y: 0.1, width: 0.8, height: 0.7 },
    depth_layer: 10,
    resolved_colors: colores,
    visual_semantics: { structure_type: tipo, placement: ubicacion, design_role: rol, repetition_group: grupo ?? id, density: "media" },
    identity_constraints: [],
    relationships: [],
  } as Elemento;
}

function escena(elementos: Elemento[]): SceneSpec {
  return {
    schema_version: "1.0",
    generation_mode: "text_to_image",
    canvas: { aspect_ratio: "3:2", content_rect: { x: 0, y: 0, width: 1, height: 1 } },
    venue: { preserve: [], protected_regions: [], editable_regions: [] },
    elements: elementos,
    positive_prompt: { required_elements: [], composition: [], venue_preservation: [], photorealistic_integration: [] },
    negative_prompt: { forbidden_elements: [], forbidden_venue_changes: [], forbidden_compositing_artifacts: [] },
    metadata: { created_by: "server_default", plan_hash: "plan-barrido" },
  } as SceneSpec;
}

const PALETAS: readonly string[][] = [
  ["dorado"],
  ["rosado", "dorado"],
  ["blanco", "plateado"],
  ["rosado", "dorado", "plateado"],
  ["fucsia", "blanco", "dorado"],
  ["rosado", "crema", "dorado", "plateado"],
];

const EVENTOS = [
  { tipo_evento: "XV años", estilo: "glamour", espacio: "salón", pedido: "Quiero decorar unos XV años en un salón, estilo glamour" },
  { tipo_evento: "boda", estilo: "elegante", espacio: "jardín", pedido: "Decoración para boda en jardín, elegante" },
  { tipo_evento: "cumpleaños", estilo: "divertido", espacio: "casa", pedido: "Cumpleaños infantil en casa" },
  { tipo_evento: "baby shower", estilo: "delicado", espacio: "terraza", pedido: "Baby shower en terraza con estilo delicado" },
  { tipo_evento: "corporativo", estilo: "moderno", espacio: "auditorio", pedido: "Evento corporativo en auditorio, moderno" },
];

/** Colores de cada rol dentro de la paleta: el focal usa todos, soportes y acentos subconjuntos. */
function subpaleta(paleta: string[], desde: number, cuantos: number): string[] {
  return Array.from({ length: Math.min(cuantos, paleta.length) }, (_, i) => paleta[(desde + i) % paleta.length]!);
}

const FOCALES: ReadonlyArray<(p: string[]) => Elemento[]> = [
  (p) => [elemento("EST_01_ARCO", "Arco orgánico", "arco", "arco_central", "focal", p)],
  (p) => [elemento("EST_01_SEMIARCO", "Semiarco", "semiarco", "arco_central", "focal", p)],
  (p) => [elemento("EST_01_PARED", "Pared de globos", "pared", "fondo_pared", "focal", p)],
  (p) => [elemento("EST_01_BACKDROP", "Backdrop", "backdrop", "fondo_pared", "focal", p)],
];

const SOPORTES: ReadonlyArray<(p: string[]) => Elemento[]> = [
  () => [],
  (p) => [
    elemento("EST_02_COLUMNA_IZQ", "Columna izquierda", "columna", "lateral_izquierdo", "soporte", subpaleta(p, 0, 2), "cols"),
    elemento("EST_03_COLUMNA_DER", "Columna derecha", "columna", "lateral_derecho", "soporte", subpaleta(p, 0, 2), "cols"),
  ],
  (p) => [elemento("EST_02_GUIRNALDA", "Guirnalda de entrada", "guirnalda", "entrada", "soporte", subpaleta(p, 1, 2))],
  (p) => [
    elemento("EST_02_COLUMNA_IZQ", "Columna izquierda", "columna", "lateral_izquierdo", "soporte", subpaleta(p, 0, 2), "cols"),
    elemento("EST_03_COLUMNA_DER", "Columna derecha", "columna", "lateral_derecho", "soporte", subpaleta(p, 0, 2), "cols"),
    elemento("EST_04_GUIRNALDA", "Guirnalda de techo", "guirnalda", "techo", "soporte", subpaleta(p, 1, 2)),
  ],
];

const ACENTOS: ReadonlyArray<(p: string[]) => Elemento[]> = [
  () => [],
  (p) => [elemento("EST_05_CENTRO", "Centro de mesa principal", "centro_mesa", "sobre_mesa_principal", "acento", subpaleta(p, 1, 2))],
  (p) => [
    elemento("EST_05_CENTRO", "Centro de mesa principal", "centro_mesa", "sobre_mesa_principal", "acento", subpaleta(p, 1, 2)),
    elemento("EST_06_CENTROS_INVITADOS", "Centros de mesa invitados", "centro_mesa", "mesas_invitados", "acento", subpaleta(p, 2, 1)),
  ],
  (p) => [
    elemento("EST_05_CENTRO", "Centro de mesa principal", "centro_mesa", "sobre_mesa_principal", "acento", subpaleta(p, 1, 2)),
    elemento("EST_06_ACCESORIO", "Accesorio frontal", "accesorio", "piso_frontal", "acento", subpaleta(p, 0, 1)),
  ],
];

// ---------------------------------------------------------------------------
// Selección suelta sin plan (fallo real observado en /api/generate el
// 2026-09-14: "LORA_PREFLIGHT_FAILED: 3 tipo(s) sin visual_semantics del plan,
// inferido(s) por nombre (balloon decoration kit…)"). No es un problema de
// longitud: el preflight debe marcarlo como `requiresPlanSemantics` para que
// la ruta responda LORA_PLAN_REQUIRED en vez de un fallo reintentable.
// ---------------------------------------------------------------------------
{
  const sinSemantica = (id: string, nombre: string, color: string): Elemento => {
    const conSemantica = elemento(id, nombre, "kit", "arco_central", "acento", [color]);
    return Object.fromEntries(Object.entries(conSemantica).filter(([clave]) => clave !== "visual_semantics")) as Elemento;
  };
  const suelta = escena([
    sinSemantica("CATALOG_E01", "B2b Globo Latex Redondo Fashion Blanco", "blanco"),
    sinSemantica("CATALOG_E02", "B2b Globo Latex Redondo Fashion Dorado", "dorado"),
  ]);
  const sinPlan = { ...suelta, metadata: { ...suelta.metadata, plan_hash: undefined } } as SceneSpec;
  const contextoSuelto = buildVisualContext({ userRequest: "globos blancos y dorados" });
  const compilada = compileProductPrompt({ sceneSpec: sinPlan, visualContext: contextoSuelto, vocabulary: PRODUCT_VOCABULARY });
  const reporteSinPlan = preflightLoraPrompt({ sceneSpec: sinPlan, clauses: compilada.clauses, prompt: compilada.prompt, vocabulary: PRODUCT_VOCABULARY });
  assert.equal(reporteSinPlan.ok, false);
  assert.equal(reporteSinPlan.requiresPlanSemantics, true, reporteSinPlan.errors.join("; "));

  // La misma escena bajo un plan aprobado es un defecto de mapeo, no "pide una propuesta".
  const conPlan = compileProductPrompt({ sceneSpec: suelta, visualContext: contextoSuelto, vocabulary: PRODUCT_VOCABULARY });
  const reporteConPlan = preflightLoraPrompt({ sceneSpec: suelta, clauses: conPlan.clauses, prompt: conPlan.prompt, vocabulary: PRODUCT_VOCABULARY });
  assert.equal(reporteConPlan.ok, false);
  assert.equal(reporteConPlan.requiresPlanSemantics, false);
  console.log("ok - selección suelta sin plan → requiresPlanSemantics; con plan_hash no");
}

type Fallo = { escena: string; errores: string[]; longitud: number; prompt: string };

const detalle = process.argv.includes("--detalle");
// El trigger real lo antepone ensureLoraTriggers después de compilar (igual
// que /api/generate). Se prueban el trigger de estilo y uno de estructura largo.
const TRIGGERS = ["eventdecor_style_v2", "eventdecor_structure_v12"];
let total = 0;
let compactadas = 0;
let maxLongitud = 0;
const fallos: Fallo[] = [];
const conteoErrores = new Map<string, number>();

/** Compila una escena igual que /api/generate y devuelve el prompt efectivo y sus errores de preflight. */
function evaluarEscena(elementos: Elemento[], paleta: string[], evento: (typeof EVENTOS)[number], trigger: string) {
  const spec = escena(elementos);
  const contexto = buildVisualContext({
    brief: { tipo_evento: evento.tipo_evento, estilo: evento.estilo, colores: paleta, espacio: evento.espacio },
    userRequest: `${evento.pedido}, colores ${paleta.join(", ")}`,
  });
  // Peor caso realista de tamaños confirmados: todos los tamaños por producto
  // en la estructura focal y uno por producto en el resto.
  const sizeConfirmations: ElementSizeConfirmation[] = elementos.flatMap((el, indice) => {
    const tamanos = indice === 0 ? TAMANOS_ESTRUCTURA : ["R-12"];
    return (el.catalog_product_ids ?? []).flatMap((productId) => tamanos.map((sizeCode) => ({ elementId: el.element_id, productId, sizeCode })));
  });
  const resultado = compileProductPrompt({ sceneSpec: spec, visualContext: contexto, vocabulary: PRODUCT_VOCABULARY, sizeConfirmations, trigger });
  const prompt = ensureLoraTriggers(resultado.prompt, [{ path: "barrido", trigger, scale: 1 }]);
  const reporte = preflightLoraPrompt({ sceneSpec: spec, clauses: resultado.clauses, prompt, triggers: [trigger], vocabulary: PRODUCT_VOCABULARY });
  const errores = [
    ...reporte.errors,
    ...(resultado.unresolved_products.length ? [`productos sin resolver: ${resultado.unresolved_products.length}`] : []),
  ];
  return { prompt, errores, compactada: resultado.diagnostics.some((linea) => linea.includes("prompt compacted")) };
}

const combinaciones = FOCALES.flatMap((focal, iFocal) =>
  SOPORTES.flatMap((soporte, iSoporte) =>
    ACENTOS.flatMap((acento, iAcento) =>
      PALETAS.flatMap((paleta, iPaleta) =>
        EVENTOS.flatMap((evento) =>
          TRIGGERS.map((trigger) => ({
            nombre: `focal${iFocal}-soporte${iSoporte}-acento${iAcento}-paleta${iPaleta}-${evento.tipo_evento}-${trigger}`,
            elementos: [...focal(paleta), ...soporte(paleta), ...acento(paleta)],
            paleta,
            evento,
            trigger,
          })))))));

for (const combinacion of combinaciones) {
  const { prompt, errores, compactada } = evaluarEscena(combinacion.elementos, combinacion.paleta, combinacion.evento, combinacion.trigger);
  total += 1;
  maxLongitud = Math.max(maxLongitud, prompt.length);
  if (compactada) compactadas += 1;
  if (!errores.length) continue;
  fallos.push({ escena: combinacion.nombre, errores, longitud: prompt.length, prompt });
  for (const error of errores) {
    const clave = error.replace(/\d+/g, "N").replace(/EST_\w+/g, "EST_*");
    conteoErrores.set(clave, (conteoErrores.get(clave) ?? 0) + 1);
  }
}

console.log(`Escenas: ${total}; compactadas: ${compactadas}; longitud máxima: ${maxLongitud}/${LORA_PROMPT_MAX_LENGTH}; fallos: ${fallos.length}`);
for (const [error, veces] of [...conteoErrores.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${veces}× ${error}`);
if (detalle) {
  for (const fallo of fallos.slice(0, 5)) console.log(`\n[${fallo.escena}] (${fallo.longitud})\n  ${fallo.errores.join("\n  ")}\n  ${fallo.prompt}`);
}

assert.equal(total, FOCALES.length * SOPORTES.length * ACENTOS.length * PALETAS.length * EVENTOS.length * TRIGGERS.length);
assert.equal(fallos.length, 0, `${fallos.length} escenas no pasan el preflight; primera: ${fallos[0]?.escena} → ${fallos[0]?.errores.join("; ")}`);
console.log("LoRA preflight barrido: OK");
