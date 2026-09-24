import assert from "node:assert/strict";
import type { PlanResuelto } from "@/lib/plan/resuelto";
import { planBlueprint } from "@/lib/plan/blueprint";
import { buildApprovedSceneSpec, type SceneSpec } from "@/lib/ia/escena/scene-spec";
import { cajasDeEstructuras } from "@/lib/plan/ubicaciones";
import { buildImagePrompt, placementDescription, promptElementName, tieneContratoDeColor } from "@/lib/ia/uzume/build-image-prompt";
import { compileLoraCaption, GROUPING_ONLY_CONTEXT, translateLoraColor } from "@/lib/ia/kagutsuchi/lora-caption-compiler";
import { verificarCoherenciaPrompt, verificarColoresCaptionLora, type EscenaParaCoherencia } from "@/lib/plan/coherencia";
import { bloqueMezclaPorEstructura } from "@/lib/ia/escena/tamano-fisico";
import { planFijado, type PlanFijadoDeFixture } from "./lib/planes-fijados";

/**
 * La proporción de color por estructura tiene que llegar al prompt de imagen.
 *
 * Antes `planBlueprint` agregaba por variante (color × TAMAÑO), así que un
 * mismo color salía partido en trozos, `resolved_colors` seguía el orden de
 * las líneas del despiece (el acento podía ir primero) y `composition` se
 * cortaba con `slice(0, 240)` a mitad de fragmento.
 *
 * Determinista y sin red: plan congelado (`scripts/lib/planes-fijados.ts`,
 * ADR-0023 paso 5) -> planBlueprint -> SceneSpec. El sujeto de este test es el
 * blueprint y el prompt, nunca el resolutor: los planes son entradas.
 * Run: npx tsx --conditions=react-server scripts/test-plan-color-prompt.ts
 */

const PRODUCTOS = [
  { productId: "P-BLANCO", color: "blanco", acabado: "fashion" },
  { productId: "P-DORADO", color: "dorado", acabado: "reflex" },
  { productId: "P-ROSADO", color: "rosado", acabado: "fashion" },
];
const TAMANOS = [
  { codigo: "R-5", diam: 5 },
  { codigo: "R-9", diam: 9 },
  { codigo: "R-12", diam: 12 },
  { codigo: "R-18", diam: 18 },
  { codigo: "R-24", diam: 24 },
];

const rows = PRODUCTOS.flatMap((producto) => TAMANOS.map((tamano) => ({
  product_id: producto.productId,
  variant_id: `V-${producto.productId}-${tamano.codigo}`,
  sku: `SKU-${producto.productId}-${tamano.codigo}`,
  producto_titulo: `Globo ${producto.color}`,
  variante_titulo: tamano.codigo,
  precio: 10000,
  unidades_paq: 50,
  disponible: true,
  producto_disponible: true,
  codigo_tamano: tamano.codigo,
  forma: "redondo",
  diam_pulg: tamano.diam,
  colores_producto: [producto.color],
  colores_variante: [producto.color],
  acabados_producto: [producto.acabado],
  descripcion: `Globo látex ${producto.color} ${tamano.codigo}.`,
})));
// El catálogo sigue aquí: de él salen los colores por variante que la escena
// necesita. Lo que ya no vive aquí es el plan resuelto (ADR-0023, paso 5).

function planResuelto(fixture: string): PlanFijadoDeFixture {
  const fijado = planFijado(fixture);
  assert.equal(fijado.plan.sin_cobertura.length, 0, `el plan debe resolver sin huecos: ${JSON.stringify(fijado.plan.sin_cobertura)}`);
  return fijado;
}

function escenaDe({ plan, materialEstimate }: PlanFijadoDeFixture): SceneSpec {
  const blueprint = planBlueprint(plan);
  return buildApprovedSceneSpec({
    blueprint,
    aspectRatio: "3:2",
    targetBoxes: Object.fromEntries(Object.entries(cajasDeEstructuras(plan.plan.estructuras)).map(([id, layout]) => [id, layout.bbox])),
    catalogProducts: Object.fromEntries(blueprint.elements.map((element) => [element.element_id, (element.model_decision?.bill_of_materials ?? []).map((linea) => ({
      id: linea.catalog_product_id,
      name: linea.catalog_product_id,
      description: "",
      category: "balloon",
      colors: [rows.find((row) => row.variant_id === linea.catalog_product_id)!.colores_variante[0]!],
      share: linea.share,
      role: linea.role,
    }))])),
    materialEstimate,
    generationMode: "text_to_image",
    createdBy: "server_default",
    planHash: plan.plan_hash,
    catalogOnly: true,
  });
}

/** Lo mismo que arma route.ts para la comprobación estructural de color. */
function escenaParaCoherencia(escena: SceneSpec): EscenaParaCoherencia {
  return {
    elementos: escena.elements.map((element) => ({
      element_id: element.element_id,
      nombre_en_prompt: promptElementName(element.name),
      estructura_id: element.visual_semantics?.repetition_group ?? element.element_id.split("#")[0]!,
      resolved_colors: element.resolved_colors,
      espera_linea_de_color: tieneContratoDeColor(element),
    })),
  };
}

/** Mirror of the route's private officialStructuresDePlan (src/app/api/generate/route.ts), for the same prompt vocabulary as the catalog. */
function officialStructuresDeEstructuras(estructuras: ReadonlyArray<{ estructura_id: string; estructura_oficial?: string }>): ReadonlyMap<string, string> {
  return new Map(estructuras.flatMap((estructura) => estructura.estructura_oficial ? [[estructura.estructura_id, estructura.estructura_oficial] as const] : []));
}

/** El mismo bloque de tamaños que arma route.ts, necesario para la coherencia. */
function sizeMixDe(plan: PlanResuelto, escena: SceneSpec): string | undefined {
  const ubicaciones = new Map<string, string>();
  for (const element of escena.elements) {
    const grupo = element.visual_semantics?.repetition_group ?? element.element_id.split("#")[0]!;
    if (!ubicaciones.has(grupo)) ubicaciones.set(grupo, placementDescription(element.target_bbox, element.category));
  }
  return bloqueMezclaPorEstructura(plan.estructuras.map((estructura) => ({
    nombre: estructura.nombre,
    total_unidades: estructura.total_unidades,
    repeticiones: estructura.repeticiones,
    ubicacion_en_palabras: ubicaciones.get(estructura.estructura_id),
    mezcla_real: estructura.mezcla_real.map((linea) => ({ diamPulg: linea.diam_pulg, forma: linea.forma, unidades: linea.unidades })),
  }))) ?? undefined;
}

function main(): void {
  // 1. Arco de tres materiales y cinco tamaños: la mezcla por color no se
  //    parte por tamaño y el color dominante encabeza.
  const fijadoArco = planResuelto("color-arco-tres-materiales");
  const plan: PlanResuelto = fijadoArco.plan;
  const blueprint = planBlueprint(plan);
  const arco = blueprint.elements[0]!;
  const unidadesPorColor = new Map<string, number>();
  for (const linea of plan.estructuras[0]!.lineas) {
    if (!linea.color) continue;
    unidadesPorColor.set(linea.color, (unidadesPorColor.get(linea.color) ?? 0) + linea.unidades);
  }
  const esperado = [...unidadesPorColor.entries()].sort((a, b) => b[1] - a[1]).map(([color]) => color);
  assert.deepEqual(arco.appearance.resolved_colors, esperado, `resolved_colors va por unidades instaladas: ${JSON.stringify([...unidadesPorColor])}`);
  assert.equal(arco.appearance.resolved_colors[0], "blanco", "el principal (0,6) encabeza, no el acento");
  assert.deepEqual(arco.appearance.observed_colors, arco.appearance.resolved_colors);

  const composicion = arco.appearance.composition;
  // Un fragmento por color, con su rol, sin repetir ninguno y sin cortes a medias.
  assert.ok(composicion.length <= 180, `la composición cabe en un identity_constraint: ${composicion.length}`);
  assert.doesNotMatch(composicion, /more$/, `no se pierde ningún color: ${composicion}`);
  const fragmentos = composicion.split("; ");
  assert.equal(fragmentos.length, 3, composicion);
  for (const color of ["blanco", "dorado", "rosado"]) {
    assert.equal(composicion.split(`(${color})`).length - 1, 1, `${color} aparece exactamente una vez: ${composicion}`);
  }
  assert.match(fragmentos[0]!, /^\d+% principal \(blanco\)$/, composicion);
  assert.match(fragmentos[1]!, /^\d+% secundario \(dorado\)$/, composicion);
  assert.match(fragmentos[2]!, /^\d+% acento \(rosado\)$/, composicion);
  const suma = fragmentos.reduce((total, fragmento) => total + Number(/^(\d+)%/.exec(fragmento)![1]), 0);
  assert.equal(suma, 100, composicion);
  // El bill_of_materials sigue siendo por variante: de ahí salen las compras.
  assert.ok((arco.model_decision?.bill_of_materials?.length ?? 0) > 3, "el BOM conserva una línea por variante");
  console.log("[PASS] planBlueprint: la mezcla de color se agrega por color y producto, ordenada por unidades instaladas");

  // 2. El SceneSpec conserva ese orden en resolved_colors (antes lo rehacía
  //    con el orden del bill_of_materials, es decir el de las variantes).
  const escena = escenaDe(fijadoArco);
  assert.deepEqual(escena.elements[0]!.resolved_colors, esperado, "el scene spec conserva el orden de dominancia del elemento");
  console.log("[PASS] buildApprovedSceneSpec: resolved_colors multi-material conserva el orden del elemento");

  // 3. Manda la dominancia, no el orden en que el plan declaró los
  //    materiales: aquí el acento va declarado primero y las líneas del
  //    despiece lo listan primero, pero el prompt nombra antes al dominante.
  const fijadoAcentoPrimero = planResuelto("color-acento-primero");
  const acentoPrimero = fijadoAcentoPrimero.plan;
  assert.equal([...new Set(acentoPrimero.estructuras[0]!.lineas.map((linea) => linea.color))][0], "dorado", "el despiece sí lista primero el acento");
  const arcoDosColores = planBlueprint(acentoPrimero).elements[0]!;
  assert.deepEqual(arcoDosColores.appearance.resolved_colors, ["blanco", "dorado"]);
  assert.match(arcoDosColores.appearance.composition, /^80% principal \(blanco\); 20% acento \(dorado\)$/, arcoDosColores.appearance.composition);
  assert.deepEqual(escenaDe(fijadoAcentoPrimero).elements[0]!.resolved_colors, ["blanco", "dorado"]);
  console.log("[PASS] planBlueprint: 80/20 se lee como 80/20 y el dominante encabeza aunque el acento se declare primero");

  // 4. La proporción y el acabado de ESTA estructura llegan al prompt de
  //    imagen. El conteo global de la escena sumaba las columnas
  //    doradas al arco, así que el dorado parecía dominante, y el prompt
  //    prometía "material percentages in the scene spec" que no existían.
  const fijadoColumnas = planResuelto("color-arco-con-columnas");
  const conColumnas = fijadoColumnas.plan;
  const escenaColumnas = escenaDe(fijadoColumnas);
  const prompt = buildImagePrompt({ sceneSpec: escenaColumnas, sizeMixBlock: sizeMixDe(conColumnas, escenaColumnas) });
  const lineaArco = prompt.split("\n").find((linea) => linea.includes("APPROVED COLOR VARIETY"))!;
  assert.ok(lineaArco.indexOf("blanco (~85%") < lineaArco.indexOf("dorado (~15%"), lineaArco);
  assert.match(lineaArco, /mostly blanco \(~85%, matte\)/, lineaArco);
  assert.match(lineaArco, /dorado \(~15%, high-shine chrome\)/, lineaArco);
  assert.doesNotMatch(prompt, /material percentages in the scene spec/, "se elimina la frase que apuntaba a datos inexistentes");
  // El estimado global sigue estando, pero ya no es el único dato de color.
  assert.match(prompt, /Installed color distribution: /);
  // Una estructura de un solo color conserva el MONOCHROME LOCK, sin porcentajes.
  const lineasColumnas = prompt.split("\n").filter((linea) => linea.includes("MONOCHROME LOCK"));
  assert.equal(lineasColumnas.length, 2, prompt);
  for (const linea of lineasColumnas) assert.doesNotMatch(linea, /~\d+%/, linea);
  assert.equal(verificarCoherenciaPrompt(prompt, conColumnas).ok, true, JSON.stringify(verificarCoherenciaPrompt(prompt, conColumnas).errores));
  console.log("[PASS] colorVarietyContract describe la mezcla por estructura, con acabado y dominancia");

  // 4b. `verificarCoherenciaPrompt` comprueba el color por estructura de forma
  //     estructural. Una búsqueda de subcadenas no sirve: el bloque global
  //     "Installed color distribution" nombra todos los colores de la escena,
  //     así que se cumpliría aunque una estructura perdiera el suyo.
  const escenaCoherencia = escenaParaCoherencia(escenaColumnas);
  assert.equal(verificarCoherenciaPrompt(prompt, conColumnas, escenaCoherencia).ok, true);
  const recoloreado = prompt.replace(/use exactly these catalog colors: blanco, dorado\./, "use exactly these catalog colors: blanco, plateado.");
  assert.notEqual(recoloreado, prompt);
  const fallo = verificarCoherenciaPrompt(recoloreado, conColumnas, escenaCoherencia);
  assert.equal(fallo.ok, false, "un color cambiado en la línea del arco tiene que fallar");
  assert.match(fallo.errores.join(" | "), /Arco principal[^|]*no lista sus colores/, fallo.errores.join(" | "));
  // Sin la escena, el mismo prompt recoloreado pasa: es justo el hueco que se cierra.
  assert.equal(verificarCoherenciaPrompt(recoloreado, conColumnas).ok, true);
  // Una escena que perdió un color comprado tampoco pasa.
  const escenaSinDorado: EscenaParaCoherencia = {
    elementos: escenaCoherencia.elementos.map((elemento) => elemento.estructura_id === "EST_01_ARCO" ? { ...elemento, resolved_colors: ["blanco"] } : elemento),
  };
  const sinDorado = verificarCoherenciaPrompt(prompt, conColumnas, escenaSinDorado);
  assert.equal(sinDorado.ok, false);
  assert.match(sinDorado.errores.join(" | "), /los colores de EST_01_ARCO en la escena no son los comprados \(faltan dorado\)/, sinDorado.errores.join(" | "));

  // 4c. El caption del LoRA nunca pasa por el prompt de imagen: se comprueba
  //     sobre las cláusulas compiladas, con el mismo traductor de color.
  const clausulas = compileLoraCaption({ sceneSpec: escenaColumnas, visualContext: GROUPING_ONLY_CONTEXT, officialStructures: officialStructuresDeEstructuras(conColumnas.plan.estructuras) }).clauses;
  const captionOk = verificarColoresCaptionLora(conColumnas, escenaCoherencia, { clausulas, traducirColor: translateLoraColor });
  assert.equal(captionOk.ok, true, JSON.stringify(captionOk.errores));
  const clausulasSinDorado = clausulas.map((clausula) => clausula.elementIds.includes("EST_01_ARCO") ? { ...clausula, colors: clausula.colors.filter((color) => color !== "gold") } : clausula);
  const captionFallo = verificarColoresCaptionLora(conColumnas, escenaCoherencia, { clausulas: clausulasSinDorado, traducirColor: translateLoraColor });
  assert.equal(captionFallo.ok, false, "un color perdido en el caption tiene que fallar");
  assert.match(captionFallo.errores.join(" | "), /EST_01_ARCO en el caption LoRA no son los comprados \(faltan gold\)/, captionFallo.errores.join(" | "));
  console.log("[PASS] coherencia: los colores de cada estructura se comprueban en la escena, en el prompt y en el caption LoRA");

  // 4d. Dos estructuras pueden llamarse igual: `PlanDecoracionSchema` no exige
  //     nombres únicos y `promptElementName` además borra el paréntesis de
  //     medidas. Indexar las líneas del prompt por nombre se quedaba con la
  //     ÚLTIMA y hacía fallar cerrado un prompt correcto (route.ts aborta la
  //     generación antes de llamar al proveedor).
  const fijadoHomonimas = planResuelto("color-homonimas");
  const homonimas = fijadoHomonimas.plan;
  const escenaHomonimas = escenaDe(fijadoHomonimas);
  const sizeMixHomonimas = sizeMixDe(homonimas, escenaHomonimas);
  assert.ok(sizeMixHomonimas, "el plan con columnas tiene bloque de tamaños");
  const promptHomonimas = buildImagePrompt({ sceneSpec: escenaHomonimas, sizeMixBlock: sizeMixHomonimas });
  const lineasColumna = promptHomonimas.split("\n").filter((linea) => linea.startsWith("- Columna: "));
  assert.equal(lineasColumna.length, 2, promptHomonimas);
  assert.ok(lineasColumna.some((linea) => linea.includes("use only blanco;")), lineasColumna.join(" | "));
  assert.ok(lineasColumna.some((linea) => linea.includes("use only dorado;")), lineasColumna.join(" | "));
  const escenaCoherenciaHomonimas = escenaParaCoherencia(escenaHomonimas);
  const coherenciaHomonimas = verificarCoherenciaPrompt(promptHomonimas, homonimas, escenaCoherenciaHomonimas);
  assert.equal(coherenciaHomonimas.ok, true, JSON.stringify(coherenciaHomonimas.errores));
  // Perder una de las dos líneas homónimas sigue fallando: el conteo por nombre no cuadra.
  const sinUnaLinea = promptHomonimas.replace("- Columna: MONOCHROME LOCK — use only dorado; do not introduce color variety.\n", "");
  assert.notEqual(sinUnaLinea, promptHomonimas);
  const faltaLinea = verificarCoherenciaPrompt(sinUnaLinea, homonimas, escenaCoherenciaHomonimas);
  assert.equal(faltaLinea.ok, false);
  assert.match(faltaLinea.errores.join(" | "), /trae 1 línea\(s\) de color de "Columna" y la escena espera 2/, faltaLinea.errores.join(" | "));
  // Y cambiar el color de una de ellas también.
  const recoloreadaHomonima = promptHomonimas.replace("use only dorado;", "use only plateado;");
  const falloHomonimo = verificarCoherenciaPrompt(recoloreadaHomonima, homonimas, escenaCoherenciaHomonimas);
  assert.equal(falloHomonimo.ok, false);
  assert.match(falloHomonimo.errores.join(" | "), /la línea de color de "Columna" no lista sus colores/, falloHomonimo.errores.join(" | "));
  // El bloque de tamaños ya no imprime dos cabeceras idénticas sin nada que las distinga.
  const cabeceras = sizeMixHomonimas.split("\n").filter((linea) => linea.startsWith('"Columna"'));
  assert.equal(cabeceras.length, 2, sizeMixHomonimas);
  assert.equal(new Set(cabeceras).size, 2, cabeceras.join(" | "));
  for (const cabecera of cabeceras) assert.match(cabecera, /^"Columna" in the \w+ (?:left|right|center) area of the composition, \d+ balloons total:$/, cabecera);
  assert.doesNotMatch(sizeMixHomonimas, /EST_\d/, sizeMixHomonimas);
  // Una sola estructura con ese nombre no lleva la ubicación pegada al nombre.
  assert.ok(sizeMixHomonimas.includes('"Arco principal", '), sizeMixHomonimas);
  console.log("[PASS] coherencia: dos estructuras con el mismo nombre no hacen fallar un prompt correcto y el bloque de tamaños las distingue");

  // 5. Sin estimado por estructura (catálogo suelto, sin plan) se conserva el
  //    texto sin proporciones en vez de inventar una.
  const sinEstimado = buildImagePrompt({ sceneSpec: { ...escenaColumnas, material_estimate: undefined } as SceneSpec });
  const lineaSinEstimado = sinEstimado.split("\n").find((linea) => linea.includes("APPROVED COLOR VARIETY"))!;
  assert.doesNotMatch(lineaSinEstimado, /~\d+%/, lineaSinEstimado);
  assert.match(lineaSinEstimado, /use exactly these catalog colors: blanco, dorado\./, lineaSinEstimado);
  console.log("[PASS] sin líneas del estimado para la estructura, el prompt no inventa proporciones");
}

try {
  main();
} catch (error: unknown) {
  console.error(error);
  process.exit(1);
}
