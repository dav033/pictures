/**
 * Dos piezas en espejo de la misma foto son UNA pieza repetida (`piezas-espejo.ts`, 2026-10-04).
 *
 * - El caso real: la foto de ejemplo 01 analizada en vivo dio «columna» a la izquierda (vuelo slight) y
 *   «semiarco» a la derecha (vuelo strong), cada una con su grupo. Las dos salen del mismo tipo (columna: la
 *   media de los vuelos, 33,5 %, no pasa la frontera del 35 % del prompt), del mismo grupo, rol y densidad,
 *   con la inclinación en espejo, la forma en espejo y los colores de las dos (las burbujas transparentes).
 * - Lo que no es una pareja no se toca: otros colores, el mismo lado, alturas muy distintas, otra foto.
 * - El plan: una estructura de 2 repeticiones cubre a las dos (`validarCoberturaReferencia`) y el chat lo lee
 *   en el bloque de la referencia; la guía de escena pone la segunda instancia en la caja de la otra, en espejo.
 * - La galería: las parejas de `analisis-ejemplos.json` (01 y 08) se unifican; las demás quedan igual.
 * - La guía: si el caption completo no cabe con la nota, se usa el caption sin las frases de forma.
 *
 * Determinista y sin red. Run: npx tsx --conditions=react-server scripts/test/test-piezas-espejo.ts
 */
import assert from "node:assert/strict";
import { configurarPersistenciaTelemetria } from "@sempertex/agente-core";
import { ANALISIS_EJEMPLOS } from "@/lib/ia/amaterasu/analisis-ejemplos";
import { instanciasDeEscena } from "@/lib/ia/kagutsuchi/guia-escena";
import { guiaEscenaParaGeneracion } from "@/lib/ia/kagutsuchi/preparar-guia-escena";
import { serializeReferenceBlueprint } from "@/lib/ia/omoikane/prompt-sistema";
import { companerasDeGrupo, unificarPiezasEspejo } from "@/lib/ia/referencia/piezas-espejo";
import { ReferenceBlueprintV2Schema, type ReferenceBlueprintV2 } from "@/lib/ia/referencia/reference-blueprint";
import type { PlanGuiaEscenaResultV1 } from "@/lib/plan/guia-escena";
import type { PlanResuelto } from "@/lib/plan/resuelto";
import { validarCoberturaReferencia } from "@/lib/plan/restricciones";
import { PlanDecoracionSchema, type PlanDecoracion } from "@/lib/plan/tipos";

configurarPersistenciaTelemetria(undefined);

type Elemento = ReferenceBlueprintV2["elements"][number];

function pieza(id: string, extra: { tipo: "columna" | "semiarco"; ubicacion: "lateral_izquierdo" | "lateral_derecho"; rol: "focal" | "soporte"; caja: Elemento["reference_bbox"]; colores: string[]; forma: string; inclinacion?: number; imagen?: string }): Elemento {
  return {
    element_id: id, source_image_id: extra.imagen ?? "REF_01", name: extra.tipo === "columna" ? "Organic balloon column" : "Organic balloon half-arch", category: "balloon_structure",
    scene_role: "midground", detection_confidence: 0.9, visible_evidence: "organic balloon piece", reference_bbox: extra.caja, depth_layer: 2,
    include_policy: "include", approved: true, source_type: "reference_only", quantity: { mode: "exact", min: 1, max: 1 },
    appearance: { observed_colors: extra.colores, resolved_colors: [], color_policy: "adapt_to_event_palette", material: "latex", shape: extra.forma, composition: "single uniform material", ...(extra.inclinacion === undefined ? {} : { inclinacion: extra.inclinacion }) },
    relationships: [], uncertainties: [],
    visual_semantics: { structure_type: extra.tipo, placement: extra.ubicacion, design_role: extra.rol, repetition_group: id, density: "lujosa" },
    model_decision: { action: "include", match_type: "none", reason: "relevante", adaptation: "sin catalogo en este modo" },
  } as Elemento;
}

const MESA = {
  element_id: "REF_01_E03", source_image_id: "REF_01", name: "White round pedestal table", category: "furniture", scene_role: "midground", detection_confidence: 0.9,
  visible_evidence: "table", reference_bbox: { x: 0.31, y: 0.58, width: 0.33, height: 0.4 }, depth_layer: 3, include_policy: "include", approved: true, source_type: "reference_only",
  quantity: { mode: "exact", min: 1, max: 1 },
  appearance: { observed_colors: ["white"], resolved_colors: [], color_policy: "adapt_to_event_palette", material: "wood", shape: "shape not determinable", composition: "single uniform material" },
  relationships: [], uncertainties: [], model_decision: { action: "include", match_type: "none", reason: "relevante", adaptation: "sin catalogo" },
} as Elemento;

/** El blueprint del análisis en vivo de la captura (cajas leídas de ella, sobre el ancho de la foto). */
function blueprintDelCaso(elementos?: Elemento[]): ReferenceBlueprintV2 {
  return ReferenceBlueprintV2Schema.parse({
    schema_version: "2.0",
    source_images: [{ image_id: "REF_01", approved_roles: ["composition_reference"] }],
    elements: elementos ?? [
      pieza("REF_01_E01", { tipo: "columna", ubicacion: "lateral_izquierdo", rol: "soporte", caja: { x: 0.0, y: 0.02, width: 0.38, height: 0.77 }, colores: ["light pink", "chrome silver", "matte white", "clear"], forma: "tall dense asymmetrical column, on the left, slight top overhang, standing on the floor", inclinacion: 0.22 }),
      pieza("REF_01_E02", { tipo: "semiarco", ubicacion: "lateral_derecho", rol: "focal", caja: { x: 0.54, y: 0.0, width: 0.34, height: 0.85 }, colores: ["chrome silver", "light pink", "white"], forma: "tall dense asymmetrical half-arch, on the right, curving toward the left, strong top overhang, standing on the floor", inclinacion: -0.45 }),
      MESA,
    ],
    composition: { focal_point: "cake table", density: "dense", symmetry: "symmetric", negative_space: [] },
    palette: { observed: ["light pink", "chrome silver", "white", "clear"], priority: [] },
    unresolved_decisions: [],
  });
}

function porId(blueprint: ReferenceBlueprintV2, id: string): Elemento {
  return blueprint.elements.find((elemento) => elemento.element_id === id)!;
}

function testCasoReal(): void {
  const antes = blueprintDelCaso();
  const despues = unificarPiezasEspejo(antes);
  ReferenceBlueprintV2Schema.parse(despues);
  const izquierda = porId(despues, "REF_01_E01");
  const derecha = porId(despues, "REF_01_E02");
  assert.equal(izquierda.visual_semantics?.structure_type, "columna");
  assert.equal(derecha.visual_semantics?.structure_type, "columna", "la media de los vuelos (33,5 %) no pasa la frontera del 35 %: columna inclinada");
  assert.equal(izquierda.visual_semantics?.repetition_group, "REF_01_E01");
  assert.equal(derecha.visual_semantics?.repetition_group, "REF_01_E01", "mismo grupo: la misma pieza repetida");
  assert.equal(izquierda.visual_semantics?.design_role, "focal");
  assert.equal(derecha.visual_semantics?.design_role, "focal", "el mismo rol: el preflight exige rol igual para una pareja");
  assert.ok(Math.abs((izquierda.appearance.inclinacion ?? 0) - 0.335) < 1e-9, `inclinación izquierda ${izquierda.appearance.inclinacion}`);
  assert.ok(Math.abs((derecha.appearance.inclinacion ?? 0) + 0.335) < 1e-9, "en espejo, hacia el centro");
  assert.equal(derecha.appearance.shape, "tall dense asymmetrical column, on the right, slight top overhang, standing on the floor", "la forma de la columna, en espejo");
  assert.ok(derecha.appearance.observed_colors.includes("clear"), `las burbujas que solo vio en una las tienen las dos: ${derecha.appearance.observed_colors}`);
  assert.equal(izquierda.appearance.observed_colors.length, 4, "lo que ya tenía no se duplica (white y matte white son el mismo blanco)");
  assert.deepEqual(porId(despues, "REF_01_E03"), MESA, "la mesa no se toca");
  assert.equal(antes.elements[1]!.visual_semantics?.structure_type, "semiarco", "nunca modifica el recibido");
  assert.equal(unificarPiezasEspejo(despues), despues, "idempotente: una pareja ya agrupada no se vuelve a tocar");
  assert.deepEqual(companerasDeGrupo(despues, "REF_01_E01").map((elemento) => elemento.element_id), ["REF_01_E02"]);

  // Dos vuelos fuertes sí son un semiarco en espejo.
  const fuertes = blueprintDelCaso();
  fuertes.elements[0] = { ...fuertes.elements[0]!, visual_semantics: { ...fuertes.elements[0]!.visual_semantics!, structure_type: "semiarco" }, appearance: { ...fuertes.elements[0]!.appearance, inclinacion: 0.45 } };
  fuertes.elements[1] = { ...fuertes.elements[1]!, visual_semantics: { ...fuertes.elements[1]!.visual_semantics!, structure_type: "columna" }, appearance: { ...fuertes.elements[1]!.appearance, inclinacion: -0.45 } };
  const semiarcos = unificarPiezasEspejo(fuertes);
  assert.deepEqual(semiarcos.elements.slice(0, 2).map((elemento) => elemento.visual_semantics?.structure_type), ["semiarco", "semiarco"]);
  console.log("[PASS] caso real: columna + semiarco en espejo → dos columnas del mismo grupo, inclinadas hacia el centro y con las burbujas");
}

function testNoSonPareja(): void {
  const base = blueprintDelCaso();
  const cambiar = (indice: 0 | 1, cambio: Partial<Elemento>) => {
    const copia = structuredClone(base);
    copia.elements[indice] = { ...copia.elements[indice]!, ...cambio } as Elemento;
    return copia;
  };
  const casos: Array<[string, ReferenceBlueprintV2]> = [
    ["otros colores", cambiar(1, { appearance: { ...base.elements[1]!.appearance, observed_colors: ["chrome gold", "burgundy"] } })],
    ["el mismo lado", cambiar(1, { reference_bbox: { x: 0.05, y: 0.0, width: 0.3, height: 0.85 } })],
    ["mucho más baja", cambiar(1, { reference_bbox: { x: 0.54, y: 0.5, width: 0.34, height: 0.35 } })],
    ["otra foto", cambiar(1, { source_image_id: "REF_02" })],
    ["no aprobada", cambiar(1, { approved: false })],
    ["asimétrica en la foto", cambiar(1, { reference_bbox: { x: 0.9, y: 0.0, width: 0.1, height: 0.85 } })],
  ];
  for (const [nombre, blueprint] of casos) assert.equal(unificarPiezasEspejo(blueprint), blueprint, nombre);
  console.log("[PASS] lo que no es una pareja en espejo queda igual (colores, lado, alto, foto, aprobación, simetría)");
}

function planConColumnas(repeticiones: number): PlanDecoracion {
  return PlanDecoracionSchema.parse({
    plan_version: "1.0",
    plan_id: "00000000-0000-0000-0000-000000000000",
    concepto: { titulo: "Columnas rosa y plata", descripcion: "dos columnas orgánicas", paleta: ["rosado", "plateado", "blanco", "transparente"] },
    espacio: { tipo: "salon", fuente: "supuesto" },
    estructuras: [{
      estructura_id: "EST_01_COLUMNA", nombre: "Columna orgánica", tipo: "columna", rol_escena: "focal", ubicacion: "lateral_izquierdo",
      medidas: { alto_m: 2.4 }, densidad: "lujosa", mezcla: "organica_fina", repeticiones,
      materiales: [{ product_id: "prod-1", participacion: 1, rol_material: "principal" }],
      porque: "las dos columnas de la foto", referencia_element_id: "REF_01_E01",
    }],
    supuestos: [],
    referencia_omitida: [{ element_id: "REF_01_E03", motivo: "la mesa no se cotiza", motivo_tipo: "fuera_de_catalogo" }],
  });
}

function testPlanYGuia(): void {
  const blueprint = unificarPiezasEspejo(blueprintDelCaso());
  assert.deepEqual(validarCoberturaReferencia(planConColumnas(2), blueprint), [], "una estructura x2 cubre las dos piezas del grupo");
  assert.deepEqual(validarCoberturaReferencia(planConColumnas(1), blueprint), ["REF_01_E02"], "con una sola repetición, la segunda sigue sin cubrir");
  assert.deepEqual(validarCoberturaReferencia(planConColumnas(2), blueprintDelCaso()), ["REF_01_E02"], "sin unificar, cada pieza es la suya (comportamiento de siempre)");

  const texto = serializeReferenceBlueprint(blueprint);
  const lineaDerecha = texto.split("\n").find((linea) => linea.startsWith("- REF_01_E02")) ?? "";
  assert.match(lineaDerecha, /MISMA PIEZA EN ESPEJO que REF_01_E01: materialízalas con UNA sola estructura de repeticiones 2, ubicación lateral_izquierdo y referencia_element_id REF_01_E01/);
  assert.match(lineaDerecha, /estructura oficial "Columna/, "el chat ve el mismo tipo en las dos");
  assert.doesNotMatch(serializeReferenceBlueprint(blueprintDelCaso()), /MISMA PIEZA EN ESPEJO/, "sin pareja, el bloque no cambia");

  const estructuras = planConColumnas(2).estructuras as unknown as PlanResuelto["plan"]["estructuras"];
  const instancias = instanciasDeEscena(estructuras, blueprint);
  assert.equal(instancias.length, 2);
  assert.deepEqual(instancias.map((instancia) => instancia.fuente), ["foto", "foto"], "las dos instancias van en las cajas de la foto");
  assert.deepEqual(instancias[0]!.caja, porId(blueprint, "REF_01_E01").reference_bbox);
  assert.deepEqual(instancias[1]!.caja, porId(blueprint, "REF_01_E02").reference_bbox, "la segunda en la caja de la pieza derecha");
  assert.deepEqual(instancias.map((instancia) => instancia.espejo), [false, true], "la derecha en espejo");
  console.log("[PASS] plan: una estructura x2 cubre la pareja, el chat lo lee y la guía pone cada instancia en su caja");
}

function testGaleria(): void {
  const parejas: Record<string, string[][]> = {};
  for (const ejemplo of ANALISIS_EJEMPLOS.ejemplos) {
    const antes = ejemplo.resultado.blueprint;
    const despues = unificarPiezasEspejo(antes);
    ReferenceBlueprintV2Schema.parse(despues);
    const grupos = new Map<string, string[]>();
    for (const elemento of despues.elements) {
      const grupo = elemento.visual_semantics?.repetition_group;
      if (grupo) grupos.set(grupo, [...(grupos.get(grupo) ?? []), elemento.element_id]);
    }
    parejas[ejemplo.id] = [...grupos.values()].filter((ids) => ids.length > 1);
  }
  assert.deepEqual(parejas["ejemplo-01"], [["REF_01_E02", "REF_01_E03"]], "ejemplo 01 (la foto del caso): las dos columnas son una pareja");
  assert.deepEqual(parejas["ejemplo-08"], [["REF_01_E02", "REF_01_E03"]], "ejemplo 08: las dos columnas rosa y oro");
  for (const id of ["ejemplo-02", "ejemplo-03", "ejemplo-04", "ejemplo-05", "ejemplo-06", "ejemplo-07", "ejemplo-09", "ejemplo-10"]) {
    assert.deepEqual(parejas[id], [], `${id}: sin pareja en espejo`);
  }
  console.log("[PASS] galería: 01 y 08 se agrupan; 06 (un arco envolvente con dos lados de ancho distinto) y el resto, igual");
}

async function testGuiaSinFrases(): Promise<void> {
  const blueprint = unificarPiezasEspejo(blueprintDelCaso());
  const estructuras = planConColumnas(2).estructuras as unknown as PlanResuelto["plan"]["estructuras"];
  const plan = { plan: { estructuras }, estructuras: [{ estructura_id: "EST_01_COLUMNA", repeticiones: 2, mezcla_real: [], lineas: [] }] } as unknown as PlanResuelto;
  const pedirDiscos = async (): Promise<PlanGuiaEscenaResultV1> => ({
    operation_schema_version: "plan-guia-escena-result.v1",
    piezas: [{ estructura_id: "EST_01_COLUMNA", fuente: "motor", ancho_m: 0.8, alto_m: 2.2, discos: [{ x_m: 0, y_m: 0.3, r_m: 0.2, hex: "#f2b6c8" }, { x_m: 0.1, y_m: 1.2, r_m: 0.2, hex: "#c0c0c0" }] }],
    omitidas: [],
    total_discos: 2,
  } as PlanGuiaEscenaResultV1);
  // Lo que pasó el 2026-10-04: con las frases de Python el caption no baja de ~800 y con la nota pasa de 1000.
  const conFrases = (maximo: number) => ({ prompt: "x".repeat(Math.max(800, maximo)), frases: true });
  const sinFrases = (maximo: number) => ({ prompt: "x".repeat(Math.min(560, maximo)), frases: false });
  const cabe = (compilacion: { prompt: string }) => compilacion.prompt.length + 400 <= 1000;
  const comun = { admite: true, plan, foto: blueprint, aspecto: "3:2" as const, pedirDiscos, maximo: 1000, cabe, largo: (c: { prompt: string }) => c.prompt.length };
  const antes = await guiaEscenaParaGeneracion({ ...comun, compilar: conFrases });
  assert.equal(antes.resumen?.usada, false, "sin la alternativa, la guía se cae (lo que pasó)");
  assert.match(antes.resumen?.motivo ?? "", /no cabe/);
  const ahora = await guiaEscenaParaGeneracion({ ...comun, compilar: conFrases, compilarSinFrases: sinFrases });
  assert.equal(ahora.resumen?.usada, true, "con la alternativa, la guía viaja");
  assert.equal(ahora.resumen?.caption_sin_frases_de_forma, true, "y la respuesta dice que el caption va sin las frases de forma");
  assert.equal(ahora.compilacion?.frases, false);
  assert.equal(ahora.resumen?.cajas_de_la_foto, 2, "las dos instancias en las cajas de la foto");
  const cabeCompleto = await guiaEscenaParaGeneracion({ ...comun, compilar: sinFrases, compilarSinFrases: conFrases });
  assert.equal(cabeCompleto.resumen?.caption_sin_frases_de_forma, undefined, "si el completo cabe, no se toca");
  console.log("[PASS] guía de escena: si el caption con las frases de forma no cabe con la nota, viaja sin ellas y lo dice");
}

async function main(): Promise<void> {
  testCasoReal();
  testNoSonPareja();
  testPlanYGuia();
  testGaleria();
  await testGuiaSinFrases();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
