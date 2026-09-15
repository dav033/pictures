import assert from "node:assert/strict";
import { analizarReferenciasV2 } from "@/lib/ia/analizar-referencias-v2";
import { ReferenceBlueprintV2Schema, type ReferenceBlueprintV2 } from "@/lib/ia/reference-blueprint";
import { normalizeFinishColors, tieneElementosAprobados, tieneEstructurasDeGlobos } from "@/lib/ia/reference-structure";
import type { ChatPort, Herramienta, PeticionChat, TurnoChat } from "@/lib/ia/tipos";

/**
 * Deterministic normalization rules of the reference analysis (auditoría
 * 2026-09-14, hallazgos #2, #7, #8, #9, #11–#16, #19, #22 and the UI
 * contract). The provider is mocked: no network, no key.
 */

type Respuestas = { inventory: Record<string, unknown>; audit?: Record<string, unknown> };

function mockChat(respuestas: Respuestas, opciones: { retrasoMs?: number; peticiones?: PeticionChat[] } = {}): ChatPort & { llamadas: () => number } {
  let llamadas = 0;
  return {
    id: "gemini",
    modelo: "mock-reglas",
    llamadas: () => llamadas,
    async turno(peticion: PeticionChat): Promise<TurnoChat> {
      llamadas += 1;
      opciones.peticiones?.push(peticion);
      if (opciones.retrasoMs) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, opciones.retrasoMs);
          peticion.signal?.addEventListener("abort", () => { clearTimeout(timer); reject(peticion.signal?.reason ?? new Error("aborted")); }, { once: true });
        });
      }
      const nombre = peticion.herramientas[0]!.nombre;
      const args = nombre === "return_reference_inventory" ? respuestas.inventory : respuestas.audit ?? { images: [{ image_id: "REF_01", elements: [] }] };
      return { texto: "", llamadas: [{ nombre, args }], uso: { entrada: 0, salida: 0 }, modelo: "mock-reglas" };
    },
    async *turnoStream() {
      throw new Error("not used");
    },
  };
}

let semilla = 0;
function foto(): { id: string; mime: string; base64: string; descripcion: string } {
  semilla += 1;
  return { id: "REF_01", mime: "image/jpeg", base64: Buffer.from(`foto-reglas-${semilla}`).toString("base64"), descripcion: "test" };
}

function inventario(elements: Array<Record<string, unknown>>): Record<string, unknown> {
  return { images: [{ image_id: "REF_01", suggested_roles: ["composition_reference"], elements, composition: { focal_point: "x", density: "moderate", symmetry: "symmetric" }, palette: { observed: ["white"] } }] };
}

function elemento(name: string, extra: Record<string, unknown>): Record<string, unknown> {
  return { name, detection_confidence: 0.9, visible_evidence: `${name} visible`, reference_bbox: { x: 0.1, y: 0.1, width: 0.3, height: 0.6 }, composition_relevance: "essential", model_decision: { action: "include", match_type: "none", reason: "r", adaptation: "a" }, ...extra };
}

async function analizar(elements: Array<Record<string, unknown>>, audit?: Array<Record<string, unknown>>): Promise<ReferenceBlueprintV2> {
  const chat = mockChat({ inventory: inventario(elements), audit: audit ? { images: [{ image_id: "REF_01", elements: audit }] } : undefined });
  const result = await analizarReferenciasV2(chat, [foto()], [], "perceptual");
  return ReferenceBlueprintV2Schema.parse(result.blueprint);
}

function por(blueprint: ReferenceBlueprintV2, name: string) {
  const found = blueprint.elements.find((element) => element.name === name);
  assert.ok(found, `falta ${name}: ${blueprint.elements.map((element) => element.name).join(" | ")}`);
  return found;
}

let casos = 0;
async function caso(nombre: string, fn: () => Promise<void> | void): Promise<void> {
  await fn();
  casos += 1;
  console.log(`ok - ${nombre}`);
}

async function run(): Promise<void> {
  await caso("#2 un globo aerostático no es estructura cotizable y la foto no 'tiene globos'", async () => {
    const blueprint = await analizar([elemento("Hot Air Balloon", { category: "balloon_structure", reference_bbox: { x: 0.4, y: 0.1, width: 0.2, height: 0.3 } })]);
    const globo = por(blueprint, "Hot Air Balloon");
    assert.equal(globo.category, "other");
    assert.equal(globo.approved, false);
    assert.equal(globo.visual_semantics, undefined);
    assert.equal(tieneEstructurasDeGlobos(blueprint), false);
  });

  await caso("#2 foil suelto o burbuja sin estructura no se aprueban; un nombre estructural sí se clasifica", async () => {
    const blueprint = await analizar([
      elemento("Gold foil balloons", { category: "balloon_structure" }),
      elemento("Giant soap bubbles", { category: "balloon_structure", reference_bbox: { x: 0.6, y: 0.1, width: 0.2, height: 0.2 } }),
      elemento("Guirnalda orgánica de globos", { category: "balloon_structure", reference_bbox: { x: 0.05, y: 0.05, width: 0.9, height: 0.3 } }),
    ]);
    assert.equal(por(blueprint, "Gold foil balloons").approved, false);
    assert.equal(por(blueprint, "Gold foil balloons").category, "balloon_structure");
    assert.equal(por(blueprint, "Giant soap bubbles").category, "other");
    assert.equal(por(blueprint, "Giant soap bubbles").approved, false);
    const guirnalda = por(blueprint, "Guirnalda orgánica de globos");
    assert.equal(guirnalda.approved, true);
    assert.equal(guirnalda.visual_semantics?.structure_type, "guirnalda");
    assert.equal(tieneEstructurasDeGlobos(blueprint), true);
  });

  await caso("#16 'Draped High Cocktail Table' es mobiliario, no cortina ni capa de fondo", async () => {
    const blueprint = await analizar([elemento("Draped High Cocktail Table", { category: "draped table", scene_role: "foreground" })]);
    const mesa = por(blueprint, "Draped High Cocktail Table");
    assert.equal(mesa.category, "furniture");
    assert.notEqual(mesa.scene_role, "backdrop");
    const cortina = await analizar([elemento("Black drapes", { category: "fabric drapes" })]);
    assert.equal(por(cortina, "Black drapes").category, "curtain");
  });

  await caso("#8 F10: hallazgos del verificador con confianza baja o duplicados no se aprueban", async () => {
    const nube = (name: string, x: number, width: number, confidence = 0.9) => elemento(name, { category: "balloon_structure", detection_confidence: confidence, reference_bbox: { x, y: 0.02, width, height: 0.25 }, structure: { structure_type: "ceiling_installation", horizontal_position: "center" } });
    const blueprint = await analizar(
      [nube("Left Ceiling Balloon Cloud", 0.02, 0.3), nube("Center Ceiling Balloon Cloud", 0.35, 0.3)],
      [
        nube("Right Ceiling Balloon Cloud", 0.55, 0.4, 0.49),
        nube("Left-center balloon cloud", 0.2, 0.3, 0.85),
        elemento("Gold sequin backdrop", { category: "backdrop", detection_confidence: 0.9, reference_bbox: { x: 0.2, y: 0.4, width: 0.6, height: 0.5 } }),
      ],
    );
    assert.equal(por(blueprint, "Right Ceiling Balloon Cloud").approved, false, "confianza 0,49 no se aprueba");
    assert.equal(por(blueprint, "Left-center balloon cloud").approved, false, "misma categoría y tipo con solape es duplicado");
    assert.equal(por(blueprint, "Gold sequin backdrop").approved, true, "un hallazgo nuevo y seguro del verificador sí se aprueba");
    assert.equal(blueprint.elements.filter((element) => element.approved && element.category === "balloon_structure").length, 2);
  });

  await caso("#9 una pieza full_width con evidencia izquierda/derecha son dos piezas con su recuadro", async () => {
    const blueprint = await analizar([elemento("Balloon garlands", {
      category: "balloon_structure",
      visible_evidence: "Two organic garlands framing the stage on the left and right sides",
      reference_bbox: { x: 0.02, y: 0.1, width: 0.96, height: 0.7 },
      structure: { structure_type: "garland", horizontal_position: "full_width" },
    })]);
    const izquierda = por(blueprint, "Balloon garlands (left)");
    const derecha = por(blueprint, "Balloon garlands (right)");
    assert.equal(izquierda.visual_semantics?.placement, "lateral_izquierdo");
    assert.equal(derecha.visual_semantics?.placement, "lateral_derecho");
    assert.ok(izquierda.reference_bbox.x + izquierda.reference_bbox.width <= derecha.reference_bbox.x + 1e-9);
    assert.equal(izquierda.quantity.max, 1);
    const unica = await analizar([elemento("Balloon garland", { category: "balloon_structure", reference_bbox: { x: 0.02, y: 0.1, width: 0.96, height: 0.3 }, structure: { structure_type: "garland", horizontal_position: "full_width" } })]);
    assert.equal(unica.elements.length, 1, "sin evidencia izquierda/derecha no se parte");
  });

  await caso("#11 foil y figuras dentro de una pared de globos forman parte de ella", async () => {
    const blueprint = await analizar([
      elemento("Pastel balloon wall", { category: "balloon_structure", reference_bbox: { x: 0.1, y: 0.05, width: 0.8, height: 0.85 }, structure: { structure_type: "balloon_wall", horizontal_position: "full_width" } }),
      elemento("Gold foil number 30", { category: "balloon_structure", reference_bbox: { x: 0.35, y: 0.3, width: 0.15, height: 0.25 }, structure: { structure_type: "sculpture", horizontal_position: "center", grounded: false } }),
      elemento("Foil star cluster", { category: "balloon_structure", reference_bbox: { x: 0.6, y: 0.2, width: 0.12, height: 0.15 }, structure: { structure_type: "cluster", horizontal_position: "right", grounded: false } }),
      elemento("Balloon column", { category: "balloon_structure", reference_bbox: { x: 0.0, y: 0.2, width: 0.08, height: 0.75 }, structure: { structure_type: "column", horizontal_position: "left" } }),
    ]);
    const pared = por(blueprint, "Pastel balloon wall");
    assert.equal(pared.approved, true);
    for (const name of ["Gold foil number 30", "Foil star cluster"]) {
      const pieza = por(blueprint, name);
      assert.equal(pieza.approved, false, `${name} no es una estructura independiente`);
      assert.ok(pieza.relationships.some((relation) => relation.target_element_id === pared.element_id));
    }
    assert.equal(por(blueprint, "Balloon column").approved, true, "una columna fuera de la pared sigue siendo estructura");
    const centros = await analizar([
      elemento("Balloon centerpiece arrangement", { category: "balloon_structure", reference_bbox: { x: 0.3, y: 0.4, width: 0.4, height: 0.4 }, structure: { structure_type: "centerpiece" } }),
      elemento("Small centerpiece left", { category: "balloon_structure", reference_bbox: { x: 0.32, y: 0.5, width: 0.1, height: 0.2 }, structure: { structure_type: "centerpiece" } }),
    ]);
    assert.equal(por(centros, "Small centerpiece left").approved, false, "F11: un arreglo no se parte en varios centros de mesa");
  });

  await caso("#12 globos sueltos en el piso no son guirnalda; una guirnalda baja va al piso, no al fondo", async () => {
    const sueltos = await analizar([elemento("Floor Loose Balloons", { category: "balloon_structure", visible_evidence: "loose white balloons scattered on the floor", reference_bbox: { x: 0.0, y: 0.82, width: 1, height: 0.18 }, structure: { structure_type: "garland", horizontal_position: "full_width" } })]);
    assert.equal(por(sueltos, "Floor Loose Balloons").approved, false);
    assert.equal(tieneEstructurasDeGlobos(sueltos), false);
    const piso = await analizar([elemento("Floor balloon garland", { category: "balloon_structure", visible_evidence: "a loose organic garland running along the floor", reference_bbox: { x: 0.0, y: 0.8, width: 1, height: 0.15 }, structure: { structure_type: "garland", horizontal_position: "full_width" } })]);
    assert.equal(por(piso, "Floor balloon garland").visual_semantics?.placement, "piso_frontal");
  });

  await caso("#13 el esquema declara quantity y composition; 'Left Balloon Columns' cuenta más de una", async () => {
    const peticiones: PeticionChat[] = [];
    const chat = mockChat({ inventory: inventario([elemento("Left Balloon Columns", { category: "balloon_structure", structure: { structure_type: "column", horizontal_position: "left" } })]) }, { peticiones });
    const result = await analizarReferenciasV2(chat, [foto()], [], "perceptual");
    const herramienta = peticiones[0]!.herramientas[0] as Herramienta;
    const imagen = (herramienta.esquema as { properties: { images: { items: { properties: Record<string, { properties?: Record<string, unknown>; items?: { properties: Record<string, unknown> } }> } } } }).properties.images.items.properties;
    assert.ok(imagen.elements!.items!.properties.quantity, "quantity declarado");
    assert.deepEqual(Object.keys(imagen.composition!.properties ?? {}).sort(), ["density", "focal_point", "symmetry"]);
    const columnas = por(result.blueprint, "Left Balloon Columns");
    assert.ok(columnas.quantity.min > 1, JSON.stringify(columnas.quantity));
  });

  await caso("#14 acabado perla: sinónimos y evidencia llegan a los colores observados", async () => {
    assert.deepEqual(normalizeFinishColors(["purple", "white"], "balloons with a soft pearlescent sheen"), ["pearl purple", "pearl white"]);
    assert.deepEqual(normalizeFinishColors(["iridescent white", "clear"], ""), ["pearl white", "clear"]);
    assert.deepEqual(normalizeFinishColors(["gold", "white"], "chrome gold and pearl white balloons"), ["gold", "white"], "dos acabados en el texto es ambiguo: no se asigna");
    const blueprint = await analizar([elemento("Lilac balloon arch", { category: "balloon_structure", observed_colors: ["lilac", "white"], material: "satin latex balloons", structure: { structure_type: "arch", horizontal_position: "center" } })]);
    assert.deepEqual(por(blueprint, "Lilac balloon arch").appearance.observed_colors, ["pearl lilac", "pearl white"]);
    const tela = await analizar([elemento("White satin drape", { category: "curtain", observed_colors: ["white"], material: "satin fabric" })]);
    assert.deepEqual(por(tela, "White satin drape").appearance.observed_colors, ["white"], "el satín de una tela no es acabado de globo");
  });

  await caso("#15 un arco exento siempre es arco central; un semiarco a un lado no queda 'fondo'", async () => {
    const blueprint = await analizar([
      elemento("Balloon arch", { category: "balloon_structure", reference_bbox: { x: 0.05, y: 0.05, width: 0.9, height: 0.9 }, structure: { structure_type: "arch", horizontal_position: "full_width" } }),
      elemento("Balloon half-arch", { category: "balloon_structure", reference_bbox: { x: 0.02, y: 0.1, width: 0.3, height: 0.8 }, structure: { structure_type: "half_arch", horizontal_position: "full_width", top_overhang: "strong", curves_toward: "right" } }),
    ]);
    assert.equal(por(blueprint, "Balloon arch").visual_semantics?.placement, "arco_central");
    const semiarco = por(blueprint, "Balloon half-arch");
    assert.equal(semiarco.visual_semantics?.placement, "lateral_izquierdo");
    assert.match(semiarco.appearance.shape, /strong top overhang/, "#22 top_overhang se conserva en el blueprint");
    assert.match(semiarco.appearance.shape, /on the left/, "la forma y la ubicación dicen el mismo lado");
  });

  await caso("contrato UI: recuadro normalizado dentro de la imagen, imagen fuente y banderas", async () => {
    const chat = mockChat({ inventory: inventario([elemento("Balloon column", { category: "balloon_structure", reference_bbox: { x: 0.9, y: 0.5, width: 0.5, height: 0.9 }, structure: { structure_type: "column", horizontal_position: "right" } })]) });
    const result = await analizarReferenciasV2(chat, [foto()], [], "perceptual");
    const [columna] = result.blueprint.elements;
    assert.equal(columna?.source_image_id, "REF_01");
    assert.ok(columna!.reference_bbox.x + columna!.reference_bbox.width <= 1 + 1e-9);
    assert.ok(columna!.reference_bbox.y + columna!.reference_bbox.height <= 1 + 1e-9);
    assert.equal(result.tieneEstructurasDeGlobos, true);
    assert.equal(result.tieneElementos, true);
    const vacio = await analizarReferenciasV2(mockChat({ inventory: inventario([]) }), [foto()], [], "perceptual");
    assert.equal(vacio.tieneElementos, false, "sin elementos el resultado lo indica");
    assert.equal(vacio.tieneEstructurasDeGlobos, false);
    assert.equal(tieneElementosAprobados(null), false);
  });

  await caso("#7 la caché se puede saltar con forzarNuevoAnalisis y el nuevo resultado la reemplaza", async () => {
    const referencia = foto();
    const primero = mockChat({ inventory: inventario([]) });
    const a = await analizarReferenciasV2(primero, [referencia], [], "perceptual");
    const b = await analizarReferenciasV2(primero, [referencia], [], "perceptual");
    assert.equal(primero.llamadas(), 2, "inventario + auditoría una sola vez");
    assert.equal(a.metadata.cached, false);
    assert.equal(b.metadata.cached, true);
    const segundo = mockChat({ inventory: inventario([elemento("Balloon arch", { category: "balloon_structure", structure: { structure_type: "arch" } })]) });
    const forzado = await analizarReferenciasV2(segundo, [referencia], [], "perceptual", undefined, undefined, { forzarNuevoAnalisis: true });
    assert.equal(segundo.llamadas(), 2, "reintentar vuelve a llamar al proveedor");
    assert.equal(forzado.metadata.cached, false);
    assert.equal(forzado.tieneEstructurasDeGlobos, true);
    const despues = await analizarReferenciasV2(segundo, [referencia], [], "perceptual");
    assert.equal(despues.metadata.cached, true);
    assert.equal(despues.tieneEstructurasDeGlobos, true, "la caché guarda el análisis nuevo, no el malo");
  });

  await caso("#19 dos análisis concurrentes de la misma foto comparten una llamada; cancelar uno no cancela el otro", async () => {
    const referencia = foto();
    const chat = mockChat({ inventory: inventario([]) }, { retrasoMs: 30 });
    const [x, y] = await Promise.all([
      analizarReferenciasV2(chat, [referencia], [], "perceptual"),
      analizarReferenciasV2(chat, [referencia], [], "perceptual", undefined, undefined, { forzarNuevoAnalisis: true }),
    ]);
    assert.equal(chat.llamadas(), 2, "una sola ejecución (inventario + auditoría)");
    assert.deepEqual(x.blueprint, y.blueprint);

    const otra = foto();
    const lento = mockChat({ inventory: inventario([]) }, { retrasoMs: 40 });
    const cancelado = new AbortController();
    const p1 = analizarReferenciasV2(lento, [otra], [], "perceptual", undefined, cancelado.signal);
    const p2 = analizarReferenciasV2(lento, [otra], [], "perceptual");
    cancelado.abort(new Error("CLIENT_CANCELLED"));
    await assert.rejects(p1, /CLIENT_CANCELLED/);
    const sigue = await p2;
    assert.equal(sigue.tieneElementos, false);
    assert.equal(lento.llamadas(), 2);

    const sola = foto();
    const abandonado = mockChat({ inventory: inventario([]) }, { retrasoMs: 40 });
    const unico = new AbortController();
    const p3 = analizarReferenciasV2(abandonado, [sola], [], "perceptual", undefined, unico.signal);
    unico.abort(new Error("CLIENT_CANCELLED"));
    await assert.rejects(p3, /CLIENT_CANCELLED/);
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(abandonado.llamadas(), 1, "sin nadie esperando, la llamada compartida se cancela y no sigue a la auditoría");
  });

  console.log(`[PASS] ${casos} reglas deterministas del análisis de referencia`);
}

run().catch((error: unknown) => {
  console.error("[FAIL]", error);
  process.exitCode = 1;
});
