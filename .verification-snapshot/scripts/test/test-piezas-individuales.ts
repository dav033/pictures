/**
 * Piezas SIEMPRE individuales (piezas-individuales.ts, regla del dueño 2026-10-06) y «Ajustar mi plan» sin modelo
 * (ajuste-estructural.ts). Determinista, sin red y sin coste.
 *
 * - Nombres que pone el servidor: «Columna izquierda/derecha», «Semiarco orgánico izquierdo», «Columna 1..3».
 * - La instrucción del plan guiado lista cada pieza por separado (repeticiones 1, id y lado propios) y no activa
 *   `extraerRestriccionesUsuario` (la trampa de «Columna 1» → «el cliente pidió una columna»).
 * - La garantía: `separarEstructurasRepetidas` sobre el plan REAL del registro guiada-20261006-212136-dgkw9b
 *   (EST_02_COLUMNA con repeticiones 2 en la entrada) da tres piezas individuales válidas.
 * - Con foto: la pareja en espejo unificada sale en dos piezas, cada una con su elemento, y la cobertura sigue completa.
 * - Quitar una pieza y añadir un color tocan solo lo que deben: medidas, armados y nombres de lo demás, iguales.
 *
 * Run: npx tsx --conditions=react-server scripts/test/test-piezas-individuales.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PlanActualGuiadoSchema, PropuestaComposicionSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
import { instruccionPlanGuiado, planActualDesdePlan, resumenPlanGuiado } from "@/lib/ia/guiado/instruccion-plan";
import { generarPasosPlan } from "@/lib/ia/guiado/generar-pasos-plan";
import { normalizarPropuestaComposicion } from "@/lib/ia/guiado/propuesta-composicion";
import { unificarPiezasEspejo } from "@/lib/ia/referencia/piezas-espejo";
import { ReferenceBlueprintV2Schema, type ReferenceBlueprintV2 } from "@/lib/ia/referencia/reference-blueprint";
import { PARTE_COLOR_NUEVO, acabadoMotorDeTitulo, entradaColorNuevo, planAdmiteColorNuevo, planConColor, planSinPieza } from "@/lib/plan/ajuste-estructural";
import { MAX_PIEZAS_PLAN, nombrarPiezasIndividuales, nombresIndividuales, piezasIndividualesDePropuesta, recortarCantidades, separarEstructurasRepetidas } from "@/lib/plan/piezas-individuales";
import { extraerRestriccionesUsuario, validarCoberturaReferencia } from "@/lib/plan/restricciones";
import { PlanDecoracionSchema, type EstructuraPlan, type PlanDecoracion } from "@/lib/plan/tipos";
import { cajasDeEstructuras } from "@/lib/plan/ubicaciones";

const ESTRUCTURA_ID = /^EST_\d{2}_[A-Z_]+$/;

// --- Nombres -------------------------------------------------------------------------------------------------------
assert.deepEqual(nombresIndividuales("columna", 2), ["Columna izquierda", "Columna derecha"]);
assert.deepEqual(nombresIndividuales("columna_asimetrica", 2), ["Columna orgánica izquierda", "Columna orgánica derecha"]);
assert.deepEqual(nombresIndividuales("semiarco_asimetrico", 2), ["Semiarco orgánico izquierdo", "Semiarco orgánico derecho"]);
assert.deepEqual(nombresIndividuales("semiarco", 2, ["derecho", "izquierdo"]), ["Semiarco derecho", "Semiarco izquierdo"]);
assert.deepEqual(nombresIndividuales("columna", 3), ["Columna 1", "Columna 2", "Columna 3"]);
assert.deepEqual(nombresIndividuales("centro_mesa", 2), ["Centro de mesa con globos 1", "Centro de mesa con globos 2"], "sin lado: numeradas");
assert.deepEqual(nombresIndividuales("arco_asimetrico", 1), ["Arco orgánico"], "una sola conserva el nombre");

// --- La propuesta como piezas individuales ------------------------------------------------------------------------
const individuales = piezasIndividualesDePropuesta([{ estructura: "arco_asimetrico", cantidad: 1 }, { estructura: "columna", cantidad: 2 }]);
assert.deepEqual(individuales, {
  piezas: [
    { estructura: "arco_asimetrico", estructuraId: "EST_01_ARCO_ASIMETRICO" },
    { estructura: "columna", estructuraId: "EST_02_COLUMNA", ubicacion: "lateral_izquierdo" },
    { estructura: "columna", estructuraId: "EST_03_COLUMNA", ubicacion: "lateral_derecho" },
  ],
  recortadas: 0,
});
// Al quitar la columna izquierda, la que queda sigue a la derecha; dos que ya traen lado lo conservan.
assert.equal(piezasIndividualesDePropuesta([{ estructura: "columna", cantidad: 1, ubicacion: "lateral_derecho" }]).piezas[0]!.ubicacion, "lateral_derecho");
assert.deepEqual(piezasIndividualesDePropuesta([{ estructura: "columna", cantidad: 1, ubicacion: "lateral_derecho" }, { estructura: "columna", cantidad: 1 }]).piezas.map((pieza) => pieza.ubicacion), ["lateral_derecho", "lateral_izquierdo"]);
// Tope: 4 + 4 + 4 → 8 piezas, la más numerosa pierde primero.
const recorte = recortarCantidades([{ cantidad: 4 }, { cantidad: 4 }, { cantidad: 4 }]);
assert.deepEqual([recorte.piezas.map((pieza) => pieza.cantidad), recorte.recortadas], [[2, 3, 3], 4]);
assert.equal(piezasIndividualesDePropuesta([{ estructura: "centro_mesa", cantidad: 4 }, { estructura: "bouquet", cantidad: 4 }, { estructura: "columna", cantidad: 4 }]).piezas.length, MAX_PIEZAS_PLAN);
// Los contratos internos de la guiada admiten 8 piezas y no 9.
const ocho = Array.from({ length: 8 }, () => ({ estructura: "centro_mesa" as const, cantidad: 1 }));
assert.equal(PropuestaComposicionSchema.safeParse({ frase: "x", colores: ["rosado"], piezas: ocho }).success, true);
assert.equal(PropuestaComposicionSchema.safeParse({ frase: "x", colores: ["rosado"], piezas: [...ocho, ocho[0]!] }).success, false);
assert.equal(PlanActualGuiadoSchema.safeParse({ piezas: ocho, colores: ["rosado"] }).success, true);

// --- La instrucción del plan guiado ---------------------------------------------------------------------------------
const propuesta = normalizarPropuestaComposicion({ frase: "x", colores: ["azul", "plateado", "blanco", "rosado"], piezas: [{ estructura: "semiarco_asimetrico", cantidad: 1 }, { estructura: "columna", cantidad: 2 }] });
const instruccion = instruccionPlanGuiado(propuesta);
assert.ok(instruccion.includes("- Columna (estructura_oficial: columna; estructura_id: EST_02_COLUMNA; ubicacion: lateral_izquierdo; repeticiones: 1; colores de esta pieza: azul, plateado, blanco, rosado)"), instruccion);
assert.ok(instruccion.includes("- Columna (estructura_oficial: columna; estructura_id: EST_03_COLUMNA; ubicacion: lateral_derecho; repeticiones: 1; colores de esta pieza: azul, plateado, blanco, rosado)"), instruccion);
assert.ok(!/repeticiones: [2-9]/.test(instruccion) && !/\d+ × /.test(instruccion), "nunca una estructura repetida");
assert.ok(!/izquierda|derecha|Columna \d/.test(instruccion), "los nombres individuales los pone el servidor, no el texto");
// La trampa: un nombre con número o «una columna» en el texto se vuelve restricción y el plan de dos se rechaza en bucle.
for (const cantidad of [2, 3]) {
  const texto = instruccionPlanGuiado(normalizarPropuestaComposicion({ frase: "x", colores: ["rosado", "dorado"], piezas: [{ estructura: "arco_asimetrico", cantidad: 1 }, { estructura: "columna", cantidad }] }));
  const restricciones = extraerRestriccionesUsuario(texto);
  assert.deepEqual(restricciones.estructuras, [], `${cantidad} columnas: ${JSON.stringify(restricciones.estructuras)}`);
  assert.equal(restricciones.presupuesto, undefined);
}

// --- La garantía, sobre el plan real ---------------------------------------------------------------------------------
type Fixture = { plan: PlanDecoracion; plan_hash: string; approval_token: string; estructuras: Array<{ estructura_id: string; lineas: Array<{ color?: string; unidades: number; diam_pulg?: number }> }>; compras: unknown[] };
const real = JSON.parse(readFileSync("scripts/test/fixtures/plan-guiado-columnas-repetidas.json", "utf8")) as Fixture;
const planReal = PlanDecoracionSchema.parse(real.plan);
const columnaReal = planReal.estructuras.find((estructura) => estructura.estructura_id === "EST_02_COLUMNA")!;
assert.equal(columnaReal.repeticiones, 2, "el plan del registro trae la columna repetida");
const separado = separarEstructurasRepetidas(planReal);
const valido = PlanDecoracionSchema.parse(separado.plan);
assert.equal(valido.estructuras.length, 3);
assert.ok(valido.estructuras.every((estructura) => estructura.repeticiones === 1 && ESTRUCTURA_ID.test(estructura.estructura_id)));
assert.deepEqual(separado.separadas, [{ origen: "EST_02_COLUMNA", nuevas: ["EST_02_COLUMNA_B"] }]);
const [izquierda, derecha] = valido.estructuras.slice(1) as [EstructuraPlan, EstructuraPlan];
assert.deepEqual([izquierda.nombre, izquierda.ubicacion, derecha.nombre, derecha.ubicacion], ["Columna izquierda", "lateral_izquierdo", "Columna derecha", "lateral_derecho"], "la pareja de la entrada queda una a cada lado");
for (const copia of [izquierda, derecha]) {
  assert.deepEqual([copia.materiales, copia.medidas, copia.mezcla, copia.densidad, copia.armado_columna], [columnaReal.materiales, columnaReal.medidas, columnaReal.mezcla, columnaReal.densidad, columnaReal.armado_columna], "cada copia es la misma pieza");
}
assert.deepEqual(valido.estructuras[0], planReal.estructuras[0], "el semiarco no se toca");
assert.deepEqual(separarEstructurasRepetidas(valido), { plan: valido, separadas: [], sinSeparar: [], renombradas: [] }, "idempotente");
const cajas = cajasDeEstructuras(valido.estructuras);
assert.ok(cajas.EST_02_COLUMNA!.bbox.x + cajas.EST_02_COLUMNA!.bbox.width / 2 < 0.5 && cajas.EST_02_COLUMNA_B!.bbox.x + cajas.EST_02_COLUMNA_B!.bbox.width / 2 > 0.5, "izquierda y derecha en la escena");

// Unidades declaradas: piso + resto, primero las primeras. Y lo que no cabe no se separa.
function plan(estructuras: Array<Partial<EstructuraPlan> & Pick<EstructuraPlan, "estructura_id" | "tipo" | "ubicacion">>): PlanDecoracion {
  return PlanDecoracionSchema.parse({
    plan_version: "1.0", plan_id: "00000000-0000-0000-0000-000000000000",
    concepto: { titulo: "Prueba", descripcion: "prueba", paleta: ["rosado"] }, espacio: { tipo: "salon", fuente: "supuesto" }, supuestos: [],
    estructuras: estructuras.map((estructura, indice) => ({
      nombre: "Pieza", rol_escena: indice === 0 ? "focal" : "soporte", medidas: { alto_m: 2 }, repeticiones: 1, densidad: "media", mezcla: "clasica",
      materiales: [{ product_id: "p1", variant_id: "v1", color: "rosado", participacion: 1, rol_material: "principal" }], porque: "prueba", ...estructura,
    })),
  });
}
const bouquets = separarEstructurasRepetidas(plan([{ estructura_id: "EST_01_BOUQUET", tipo: "kit", ubicacion: "sobre_mesa_principal", estructura_oficial: "bouquet", repeticiones: 3, unidades_declaradas: 50 }]));
assert.deepEqual(bouquets.plan.estructuras.map((estructura) => estructura.unidades_declaradas), [17, 17, 16]);
assert.deepEqual(bouquets.plan.estructuras.map((estructura) => estructura.nombre), ["Bouquet de globos 1", "Bouquet de globos 2", "Bouquet de globos 3"]);
const muchas = separarEstructurasRepetidas(plan([{ estructura_id: "EST_01_ARCO", tipo: "arco", ubicacion: "arco_central", estructura_oficial: "arco" }, { estructura_id: "EST_02_CENTRO_MESA", tipo: "centro_mesa", ubicacion: "mesas_invitados", estructura_oficial: "centro_mesa", repeticiones: 10 }]));
assert.deepEqual([muchas.separadas, muchas.sinSeparar.map((item) => item.motivo)], [[], [`pasaría de ${MAX_PIEZAS_PLAN} piezas`]]);
const pared = separarEstructurasRepetidas(plan([{ estructura_id: "EST_01_PARED_DENSA", tipo: "pared", ubicacion: "fondo_pared", estructura_oficial: "pared_densa", repeticiones: 2 }]));
assert.equal(pared.sinSeparar[0]?.motivo, "solo cabe una pieza en fondo_pared");
// Dos columnas que el modelo ya escribió aparte pero en el mismo lado: el servidor las pone una a cada lado y les da nombre.
const mismoLado = nombrarPiezasIndividuales(plan([{ estructura_id: "EST_01_ARCO", tipo: "arco", ubicacion: "arco_central", estructura_oficial: "arco" }, { estructura_id: "EST_02_COLUMNA", tipo: "columna", ubicacion: "lateral_izquierdo", estructura_oficial: "columna", nombre: "Columna de globos" }, { estructura_id: "EST_03_COLUMNA", tipo: "columna", ubicacion: "lateral_izquierdo", estructura_oficial: "columna", nombre: "Columna de globos" }]));
assert.deepEqual(mismoLado.plan.estructuras.map((estructura) => [estructura.nombre, estructura.ubicacion]), [["Pieza", "arco_central"], ["Columna izquierda", "lateral_izquierdo"], ["Columna derecha", "lateral_derecho"]]);

// --- Con foto: la pareja en espejo -----------------------------------------------------------------------------------
type Elemento = ReferenceBlueprintV2["elements"][number];
function elemento(id: string, x: number, colores: string[]): Elemento {
  return {
    element_id: id, source_image_id: "REF_01", name: "Organic balloon column", category: "balloon_structure", scene_role: "midground", detection_confidence: 0.9,
    visible_evidence: "organic balloon piece", reference_bbox: { x, y: 0.02, width: 0.34, height: 0.8 }, depth_layer: 2, include_policy: "include", approved: true,
    source_type: "reference_only", quantity: { mode: "exact", min: 1, max: 1 },
    appearance: { observed_colors: colores, resolved_colors: [], color_policy: "adapt_to_event_palette", material: "latex", shape: "tall dense asymmetrical column, standing on the floor", composition: "single uniform material" },
    relationships: [], uncertainties: [],
    visual_semantics: { structure_type: "columna", placement: x < 0.5 ? "lateral_izquierdo" : "lateral_derecho", design_role: "soporte", repetition_group: id, density: "lujosa" },
    model_decision: { action: "include", match_type: "none", reason: "relevante", adaptation: "sin catalogo" },
  } as Elemento;
}
const blueprint = unificarPiezasEspejo(ReferenceBlueprintV2Schema.parse({
  schema_version: "2.0", source_images: [{ image_id: "REF_01", approved_roles: ["composition_reference"] }],
  elements: [elemento("REF_01_E01", 0.02, ["light pink", "chrome silver"]), elemento("REF_01_E02", 0.62, ["light pink", "chrome silver"])],
  composition: { focal_point: "cake table", density: "dense", symmetry: "symmetric", negative_space: [] },
  palette: { observed: ["light pink", "chrome silver"], priority: [] }, unresolved_decisions: [],
}));
const conFoto = plan([{ estructura_id: "EST_01_COLUMNA_ASIMETRICA", tipo: "columna", ubicacion: "lateral_izquierdo", estructura_oficial: "columna_asimetrica", repeticiones: 2, referencia_element_id: "REF_01_E01" }]);
assert.deepEqual(validarCoberturaReferencia(conFoto, blueprint), [], "antes: la repetición cubre a la compañera");
const fotoSeparada = separarEstructurasRepetidas(conFoto, blueprint);
assert.deepEqual(fotoSeparada.plan.estructuras.map((estructura) => [estructura.estructura_id, estructura.referencia_element_id, estructura.ubicacion, estructura.nombre]), [
  ["EST_01_COLUMNA_ASIMETRICA", "REF_01_E01", "lateral_izquierdo", "Columna orgánica izquierda"],
  ["EST_01_COLUMNA_ASIMETRICA_B", "REF_01_E02", "lateral_derecho", "Columna orgánica derecha"],
], "cada pieza materializa su propio elemento de la foto");
assert.deepEqual(validarCoberturaReferencia(fotoSeparada.plan, blueprint), [], "después: cada una cubre el suyo");

// --- Resumen, plan actual y pasos con piezas individuales ------------------------------------------------------------
const resuelto = { ...real, plan: valido, estructuras: [real.estructuras[0]!, { ...real.estructuras[1]!, lineas: real.estructuras[1]!.lineas.map((linea) => ({ ...linea, unidades: Math.ceil(linea.unidades / 2) })) }, { ...real.estructuras[1]!, estructura_id: "EST_02_COLUMNA_B", lineas: real.estructuras[1]!.lineas.map((linea) => ({ ...linea, unidades: Math.ceil(linea.unidades / 2) })) }] };
const resumen = resumenPlanGuiado(resuelto);
assert.ok(resumen.includes("columna izquierda de 2 m y columna derecha de 2 m"), resumen);
const actual = planActualDesdePlan(resuelto)!;
assert.deepEqual(actual.piezas.map((pieza) => [pieza.estructura, pieza.cantidad, pieza.ubicacion ?? null]), [["semiarco_asimetrico", 1, null], ["columna", 1, "lateral_izquierdo"], ["columna", 1, "lateral_derecho"]]);
assert.deepEqual(actual.piezas[1]!.medidas, { alto_m: 2 });
assert.equal(actual.piezas[0]!.participacion!.reduce((suma, parte) => suma + parte.parte, 0).toFixed(2), "1.00");
const pasos = generarPasosPlan(resuelto).pasos.map((paso) => paso.texto);
assert.ok(pasos.some((texto) => texto.startsWith("Arma la Columna izquierda y la Columna derecha, iguales, de 2 m de alto cada una.")), pasos.join("\n"));

// «Cambiar algo» tras ajustes: la instrucción conserva medidas y reparto de lo que sigue, sin activar restricciones.
const cambio = instruccionPlanGuiado(normalizarPropuestaComposicion({ frase: "x", colores: ["azul", "plateado", "blanco", "rosado"], piezas: [{ estructura: "semiarco_asimetrico", cantidad: 1 }, { estructura: "columna", cantidad: 1 }] }), { planAnterior: actual });
assert.ok(/- Semiarco orgánico \(estructura_oficial: semiarco_asimetrico; estructura_id: EST_01_SEMIARCO_ASIMETRICO; repeticiones: 1; medidas: ancho_m 1\.5, alto_m 2\.2; participacion: azul 0\.\d+, plateado 0\.\d+, blanco 0\.\d+, rosado 0\.\d+\)/.test(cambio), cambio);
assert.ok(cambio.includes("usa EXACTAMENTE esas medidas"), cambio);
assert.deepEqual(extraerRestriccionesUsuario(cambio).estructuras, [], "las medidas y el reparto no se vuelven restricciones");
assert.equal(extraerRestriccionesUsuario(cambio).presupuesto, undefined);
assert.deepEqual(extraerRestriccionesUsuario(cambio).tamanos, extraerRestriccionesUsuario(instruccion).tamanos, "ningún tamaño nuevo obligatorio");
const conColorNuevo = instruccionPlanGuiado(normalizarPropuestaComposicion({ frase: "x", colores: ["azul", "plateado", "blanco", "rosado", "dorado"], piezas: [{ estructura: "semiarco_asimetrico", cantidad: 1 }] }), { planAnterior: actual });
assert.ok(conColorNuevo.includes("medidas: ancho_m 1.5, alto_m 2.2") && !conColorNuevo.includes("participacion:"), "con un color nuevo solo se conservan las medidas");

// --- «Ajustar mi plan» sin modelo -------------------------------------------------------------------------------------
const sinDerecha = planSinPieza(valido, "EST_02_COLUMNA_B")!;
assert.deepEqual(sinDerecha.plan.estructuras.map((estructura) => estructura.estructura_id), ["EST_01_SEMIARCO_ASIMETRICO", "EST_02_COLUMNA"]);
assert.deepEqual(sinDerecha.plan.estructuras, valido.estructuras.slice(0, 2), "lo demás queda exactamente igual");
assert.equal(sinDerecha.nuevaFocal, null);
const sinSemiarco = planSinPieza(valido, "EST_01_SEMIARCO_ASIMETRICO")!;
assert.deepEqual([sinSemiarco.nuevaFocal, sinSemiarco.plan.estructuras[0]!.rol_escena], ["EST_02_COLUMNA", "focal"], "si se va la focal, otra la toma (el plan exige una)");
PlanDecoracionSchema.parse(sinSemiarco.plan);
assert.equal(planSinPieza(plan([{ estructura_id: "EST_01_ARCO", tipo: "arco", ubicacion: "arco_central", estructura_oficial: "arco" }]), "EST_01_ARCO"), null, "la última pieza no se quita");

assert.equal(acabadoMotorDeTitulo("B2b Globo Latex Redondo Fashion Blanco"), "mate");
assert.equal(acabadoMotorDeTitulo("Globo Reflex Dorado R-12"), "cromado");
const blanco = planConColor(valido, { product_id: "p-blanco-nuevo", color: "dorado", acabadoMotor: "mate" });
const conDorado = PlanDecoracionSchema.parse(blanco.plan);
assert.deepEqual(blanco.piezas, ["EST_01_SEMIARCO_ASIMETRICO", "EST_02_COLUMNA", "EST_02_COLUMNA_B"]);
for (const [indice, estructura] of conDorado.estructuras.entries()) {
  const antes = valido.estructuras[indice]!;
  assert.deepEqual([estructura.medidas, estructura.nombre, estructura.ubicacion, estructura.mezcla], [antes.medidas, antes.nombre, antes.ubicacion, antes.mezcla], "medidas, nombres y lados intactos");
  assert.equal(estructura.materiales.length, antes.materiales.length + 1);
  assert.ok(Math.abs(estructura.materiales.reduce((suma, material) => suma + material.participacion, 0) - 1) < 0.001);
  assert.equal(estructura.materiales.at(-1)!.participacion.toFixed(2), PARTE_COLOR_NUEVO.toFixed(2));
}
const semiarco = conDorado.estructuras[0]!.armado_arco_organico!;
assert.deepEqual(semiarco.forma, valido.estructuras[0]!.armado_arco_organico!.forma, "el armado conserva su forma");
assert.deepEqual(semiarco.colores.paleta.at(-1), { material: 4, peso: 15, acabado: "mate", rol: "normal" });
const columna = conDorado.estructuras[1]!.armado_columna!;
assert.deepEqual(columna.materiales, [...valido.estructuras[1]!.armado_columna!.materiales, 4], "la columna gana una posición de color");
assert.equal(entradaColorNuevo(conDorado.estructuras[0]!, "dorado").modo, null, "un color que ya está no se añade dos veces");
assert.equal(planAdmiteColorNuevo(valido), true);
const soloSemiarco = planConColor(valido, { product_id: "p-blanco-nuevo", color: "dorado", acabadoMotor: "mate" }, new Set(["EST_01_SEMIARCO_ASIMETRICO"]));
assert.deepEqual(soloSemiarco.piezas, ["EST_01_SEMIARCO_ASIMETRICO"], "el reintento deja fuera las piezas que el catálogo no cubre");
assert.deepEqual(soloSemiarco.plan.estructuras.slice(1), valido.estructuras.slice(1));

console.log(`test-piezas-individuales: OK — ${valido.estructuras.map((estructura) => estructura.nombre).join(", ")}; ${resumen}`);
