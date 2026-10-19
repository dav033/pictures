/**
 * A5 (docs/mejoras/PLAN-ESTRUCTURAS-Y-UX.md): la propuesta es coherente con lo
 * pedido.
 *
 * - Regresión: unos XV años en rosa, dorado y plateado salieron solo con
 *   serpentinas plateadas. confirmar_plan_decoracion debe rechazarlo con un
 *   motivo corregible (PLAN_SIN_GLOBOS) y un mensaje para el cliente limpio.
 * - Exenciones: "sin globos", "solo serpentinas", artículos que no son globos
 *   sin mencionar globos, y categoría desconocida.
 * - Cardinalidad de evento abierto: cuenta instancias y respeta composición o
 *   presupuesto explícitos (causa de bucles en eval/chat/jerga-v001.json).
 *
 * Sin red ni proveedores: ninguna de estas ramas llega a resolver un plan, así
 * que no necesita seleccionar backend. Forzaba `PYTHON_BACKEND_ENABLED=false`
 * por precaución; esas variables desaparecen con el paso 5 del ADR-0023 y se
 * comprobó que el resultado no cambia sin ellas.
 * Run: npx tsx --conditions=react-server scripts/test/test-plan-sin-globos.ts
 */
import assert from "node:assert/strict";
import type { Pool } from "pg";

let casos = 0;
function ok(nombre: string): void {
  casos += 1;
  console.log(`ok ${casos} - ${nombre}`);
}

async function main(): Promise<void> {
  const { crearEstadoConversacion, crearRegistroHerramientas } = await import("../../src/lib/ia/herramientas/registro-herramientas");
  const { detectarJergaInterna } = await import("../../src/lib/ia/omoikane/jerga-interna");
  const { extraerRestriccionesUsuario, permitePropuestaSinGlobos, validarCardinalidadEventoAbierto, validarEstructurasDeGlobosConGlobos, validarEstructurasFueraDeReferencia, validarPresenciaGlobos } = await import("../../src/lib/plan/restricciones");
  const { ReferenceBlueprintV2Schema } = await import("../../src/lib/ia/referencia/reference-blueprint");
  const { PlanDecoracionSchema } = await import("../../src/lib/plan/tipos");
  type ProductoCandidato = import("../../src/lib/rag/chat/buscar").ProductoCandidato;

  const XV = "Quiero decorar unos XV años en un salón, estilo glamour, colores rosa, dorado y plateado";

  // 1. Detección de pedidos sin globos.
  for (const texto of [
    "Decoración para cumpleaños sin globos, dorado y negro",
    "No quiero globos, solo manteles dorados",
    "Solo serpentinas plateadas para la entrada",
    "Banderolas de feliz cumpleaños doradas",
    "Velas y platos desechables para 20 personas",
  ]) assert.equal(permitePropuestaSinGlobos(texto), true, texto);
  for (const texto of [
    XV,
    "Un arco dorado con serpentinas",
    "Globos y banderolas para baby shower",
    "Boda en jardín, blanco y verde",
  ]) assert.equal(permitePropuestaSinGlobos(texto), false, texto);
  ok("pedidos sin globos: negación, 'solo' accesorios y artículos sin globos; el resto exige globos");

  // 2. Regla pura por categoría del catálogo.
  const material = (productId: string, color: string) => ({ product_id: productId, variant_id: `${productId}-V`, participacion: 1, rol_material: "principal" as const, color });
  const estructura = (id: string, tipo: "accesorio" | "arco", productId: string, color: string, ubicacion: "arco_central" | "lateral_izquierdo" | "lateral_derecho") => ({
    estructura_id: id,
    nombre: `Pieza ${id}`,
    tipo,
    rol_escena: id.startsWith("EST_01") ? "focal" as const : "soporte" as const,
    ubicacion,
    medidas: tipo === "arco" ? { ancho_m: 2.5, alto_m: 2.2 } : {},
    repeticiones: 1,
    densidad: "media" as const,
    mezcla: "clasica" as const,
    materiales: [material(productId, color)],
    ...(tipo === "accesorio" ? { unidades_declaradas: 2 } : {}),
    porque: "Prueba",
  });
  const planSerpentinas = PlanDecoracionSchema.parse({
    plan_version: "1.0",
    plan_id: "77777777-7777-4777-8777-777777777777",
    concepto: { titulo: "XV años glamour", descripcion: "Serpentinas", paleta: ["rosa", "dorado", "plateado"] },
    espacio: { tipo: "salón", fuente: "supuesto" },
    estructuras: [
      estructura("EST_01_SERP", "accesorio", "P-SERP-PLATA", "plateado", "arco_central"),
      estructura("EST_02_SERP", "accesorio", "P-SERP-ROSA", "rosa", "lateral_izquierdo"),
      estructura("EST_03_SERP", "accesorio", "P-SERP-DORADA", "dorado", "lateral_derecho"),
    ],
    supuestos: [],
    restricciones: extraerRestriccionesUsuario(XV),
  });
  const categorias = new Map<string, string | null>([["P-SERP-PLATA", "banderola_cartel"], ["P-SERP-ROSA", "banderola_cartel"], ["P-SERP-DORADA", "complemento"], ["P-GLOBO", "globo_latex"], ["P-KIT", "kit"]]);
  const errores = validarPresenciaGlobos(planSerpentinas, categorias, XV);
  assert.equal(errores.length, 1);
  assert.deepEqual(detectarJergaInterna(errores[0]!), [], errores[0]);
  assert.deepEqual(validarPresenciaGlobos(planSerpentinas, categorias, "Solo serpentinas plateadas para unos XV años"), []);
  assert.deepEqual(validarPresenciaGlobos(planSerpentinas, new Map([["P-SERP-PLATA", "banderola_cartel"]]), XV), [], "categoría desconocida no bloquea");
  const conKit = PlanDecoracionSchema.parse({ ...planSerpentinas, estructuras: [...planSerpentinas.estructuras.slice(0, 2), estructura("EST_03_KIT", "accesorio", "P-KIT", "dorado", "lateral_derecho")] });
  assert.deepEqual(validarPresenciaGlobos(conKit, categorias, XV), [], "un kit de globos cuenta como globos");
  ok("regla por categoría: solo accesorios → rechazo sin jerga; kit o categoría desconocida no bloquean");

  // 3. Regresión real por la herramienta: XV años solo con serpentinas.
  const pool = { query: async () => ({ rows: [] }) } as unknown as Pool;
  const candidato = (productId: string, categoria: string | null, color: string): ProductoCandidato => ({
    productId,
    titulo: productId,
    categoria,
    colores: [color],
    acabados: [],
    ocasiones: [],
    disponible: true,
    imagen: null,
    variantes: [{ variantId: `${productId}-V`, sku: null, titulo: null, precio: 5000, disponible: true, codigoTamano: null, diamPulg: null, forma: null, colores: [color] }],
  });
  const confirmar = (solicitud: string, candidatos: ProductoCandidato[]) => {
    const estado = crearEstadoConversacion({}, solicitud);
    estado.ragCandidatos = candidatos;
    for (const c of candidatos) {
      estado.ragIdsRecuperados.add(c.productId);
      estado.ragVariantIdsRecuperados.set(c.productId, new Set(c.variantes.map((v) => v.variantId)));
    }
    return crearRegistroHerramientas(estado, { pool }).confirmar_plan_decoracion!;
  };
  const args = {
    concepto: planSerpentinas.concepto,
    espacio: planSerpentinas.espacio,
    estructuras: planSerpentinas.estructuras.map(({ ...resto }) => resto),
    supuestos: [],
  };
  const llamada = { nombre: "confirmar_plan_decoracion", args: {} };
  const serpentinas = [candidato("P-SERP-PLATA", "banderola_cartel", "plateado"), candidato("P-SERP-ROSA", "banderola_cartel", "rosa"), candidato("P-SERP-DORADA", "complemento", "dorado")];
  const rechazo = await confirmar(XV, serpentinas)(args, llamada) as Record<string, unknown>;
  assert.equal(rechazo.ok, false, JSON.stringify(rechazo).slice(0, 300));
  assert.equal(rechazo.status, "PLAN_SIN_GLOBOS", JSON.stringify(rechazo).slice(0, 300));
  assert.match(String(rechazo.accion_requerida), /estructura de globos/);
  assert.deepEqual(detectarJergaInterna(String(rechazo.mensaje_cliente)), [], String(rechazo.mensaje_cliente));
  const permitido = await confirmar("Solo serpentinas plateadas, rosas y doradas para unos XV años", serpentinas)(args, llamada) as Record<string, unknown>;
  assert.notEqual(permitido.status, "PLAN_SIN_GLOBOS", JSON.stringify(permitido).slice(0, 300));
  ok("confirmar_plan_decoracion: XV años solo con serpentinas → PLAN_SIN_GLOBOS; 'solo serpentinas' pasa la regla");

  // 4. Cardinalidad de evento abierto.
  const base = (estructuras: unknown[], solicitud: string) => PlanDecoracionSchema.parse({
    ...planSerpentinas,
    plan_id: "88888888-8888-4888-8888-888888888888",
    estructuras,
    restricciones: extraerRestriccionesUsuario(solicitud),
  });
  const arco = { ...estructura("EST_01_ARCO", "arco", "P-GLOBO", "azul", "arco_central"), materiales: [{ product_id: "P-GLOBO", participacion: 1, rol_material: "principal" as const, color: "azul" }] };
  const columnas = (repeticiones: number) => ({ ...arco, estructura_id: "EST_02_COLUMNAS", tipo: "columna" as const, rol_escena: "soporte" as const, ubicacion: "lateral_izquierdo" as const, medidas: { alto_m: 1.8 }, repeticiones });
  const pedidoComposicion = "Baby shower en terraza: 2 arcos y 3 columnas en azul y blanco.";
  assert.deepEqual(validarCardinalidadEventoAbierto(base([{ ...arco, repeticiones: 2 }, columnas(3)], pedidoComposicion), "open", pedidoComposicion, true), [], "composición explícita del cliente");
  const pedidoAbierto = "Fiesta Lunaria en azul";
  assert.deepEqual(validarCardinalidadEventoAbierto(base([arco, columnas(2)], pedidoAbierto), "open", pedidoAbierto, true), [], "arco + par de columnas son 3 piezas");
  assert.equal(validarCardinalidadEventoAbierto(base([arco, columnas(1)], pedidoAbierto), "open", pedidoAbierto, true).length, 1, "dos piezas sin composición explícita siguen rechazándose");
  const pedidoPresupuesto = "Fiesta Lunaria en azul, presupuesto máximo 80.000 pesos";
  assert.deepEqual(validarCardinalidadEventoAbierto(base([arco], pedidoPresupuesto), "open", pedidoPresupuesto, true), [], "con presupuesto explícito manda lo que cabe");
  ok("cardinalidad: cuenta instancias y respeta composición o presupuesto explícitos");

  // 5. Con referencia manda la foto (I3): dos piezas separadas no son "menos de
  // 3", y una guirnalda de piso que la foto no tiene es una estructura inventada.
  const pieza = (id: string, name: string, x: number) => ({
    element_id: id, source_image_id: "REF_01", name, category: "balloon_structure",
    scene_role: "midground", detection_confidence: 0.9, visible_evidence: name,
    reference_bbox: { x, y: 0.1, width: 0.3, height: 0.8 }, depth_layer: 1,
    include_policy: "include", approved: true, source_type: "reference_only",
    quantity: { mode: "exact", min: 1, max: 1 },
    appearance: { observed_colors: ["azul"], resolved_colors: [], color_policy: "match_reference", material: "latex", shape: name, composition: "mixed" },
    relationships: [], uncertainties: [],
  });
  const blueprintDosPiezas = ReferenceBlueprintV2Schema.parse({
    schema_version: "2.0",
    source_images: [{ image_id: "REF_01", approved_roles: ["composition_reference"] }],
    elements: [pieza("REF_01_E01", "left balloon column", 0.05), pieza("REF_01_E02", "right balloon half arch", 0.6)],
    composition: { focal_point: "semiarco", density: "moderate", symmetry: "asymmetric", negative_space: [] },
    palette: { observed: ["azul"], priority: ["azul"] },
    unresolved_decisions: [],
  });
  const pedidoReferencia = "Quiero esta decoración de la referencia para un cumpleaños en un salón, en azul como en la foto.";
  const semiarcoRef = { ...arco, estructura_id: "EST_01_SEMIARCO", tipo: "semiarco" as const, ubicacion: "lateral_derecho" as const, medidas: { ancho_m: 1.2, alto_m: 2.2 }, referencia_element_id: "REF_01_E02" };
  const columnaRef = { ...columnas(1), estructura_id: "EST_02_COLUMNA", referencia_element_id: "REF_01_E01" };
  const guirnaldaPiso = { ...arco, estructura_id: "EST_03_GUIRNALDA", tipo: "guirnalda" as const, rol_escena: "relleno" as const, ubicacion: "piso_frontal" as const, medidas: { largo_m: 1.5 } };
  const fielAReferencia = base([semiarcoRef, columnaRef], pedidoReferencia);
  assert.deepEqual(validarCardinalidadEventoAbierto(fielAReferencia, "open", pedidoReferencia, true, blueprintDosPiezas), [], "las dos piezas de la foto bastan");
  assert.equal(validarCardinalidadEventoAbierto(fielAReferencia, "open", pedidoReferencia, true).length, 1, "sin referencia, dos piezas siguen rechazándose");
  assert.deepEqual(validarEstructurasFueraDeReferencia(fielAReferencia, blueprintDosPiezas, pedidoReferencia), []);
  const conGuirnalda = base([semiarcoRef, columnaRef, guirnaldaPiso], pedidoReferencia);
  const inventadas = validarEstructurasFueraDeReferencia(conGuirnalda, blueprintDosPiezas, pedidoReferencia);
  assert.equal(inventadas.length, 1, "la guirnalda de piso no está en la foto");
  assert.match(inventadas[0]!, /guirnalda/);
  assert.deepEqual(detectarJergaInterna(inventadas[0]!), [], inventadas[0]);
  const pedidoConGuirnalda = `${pedidoReferencia} Agrégale una guirnalda en el piso.`;
  assert.deepEqual(validarEstructurasFueraDeReferencia(base([semiarcoRef, columnaRef, guirnaldaPiso], pedidoConGuirnalda), blueprintDosPiezas, pedidoConGuirnalda), [], "el cliente la pidió");
  assert.deepEqual(validarEstructurasFueraDeReferencia(conGuirnalda, undefined, pedidoReferencia), [], "sin referencia no aplica");
  ok("con referencia: la foto fija la composición y rechaza estructuras que no tiene");

  // 6. Regresión (plan tropical): una "Figura con globos" armada solo con una banderola.
  const figuraConBanderola = { ...estructura("EST_04_FIGURA", "accesorio", "P-BANDEROLA", "verde", "lateral_derecho"), tipo: "kit" as const, nombre: "Figura con globos tropical", estructura_oficial: "figura" as const };
  const banderolaSuelta = { ...estructura("EST_05_BANDEROLA", "accesorio", "P-BANDEROLA", "verde", "lateral_izquierdo"), nombre: "Banderola tropical" };
  const categoriasTropical = new Map<string, string | null>([["P-GLOBO", "globo_latex"], ["P-BANDEROLA", "banderola_cartel"], ["P-FOIL", "globo_metalizado"]]);
  const erroresFigura = validarEstructurasDeGlobosConGlobos(base([arco, figuraConBanderola], "Fiesta tropical"), categoriasTropical);
  assert.equal(erroresFigura.length, 1, "la figura solo con banderola se rechaza");
  assert.match(erroresFigura[0]!, /Figura con globos/);
  assert.deepEqual(detectarJergaInterna(erroresFigura[0]!), [], erroresFigura[0]);
  const figuraConFoil = { ...figuraConBanderola, materiales: [material("P-FOIL", "verde")] };
  assert.deepEqual(validarEstructurasDeGlobosConGlobos(base([arco, figuraConFoil], "Fiesta tropical"), categoriasTropical), [], "una figura de globos metalizados es válida");
  assert.deepEqual(validarEstructurasDeGlobosConGlobos(base([arco, banderolaSuelta], "Fiesta tropical"), categoriasTropical), [], "una banderola como accesorio no es una estructura de globos");
  assert.deepEqual(validarEstructurasDeGlobosConGlobos(base([arco, figuraConBanderola], "Fiesta tropical"), new Map([["P-GLOBO", "globo_latex"]])), [], "una categoría desconocida no bloquea");
  ok("una estructura oficial de globos no puede armarse solo con accesorios");

  console.log(`\n${casos} casos OK (A5)`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
