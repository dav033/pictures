import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import { bloqueMezclaPorEstructura } from "@/lib/ia/escena/tamano-fisico";
import type { SceneSpec } from "@/lib/ia/escena/scene-spec";
import { LORA_PROMPT_MAX_LENGTH, translateLoraColor, type LoraVisualClause } from "@/lib/ia/kagutsuchi/lora-caption-compiler";
import { findLoraPromptLanguageLeaks, preflightLoraPrompt } from "@/lib/ia/kagutsuchi/lora-prompt-preflight";

import { CARDINALIDAD_CON_PAR_DE_BOUQUETS, EXCEPCION_CONTEO_CON_ARMADO, fraseInstanciaConArmado, mezclaRealConArmado } from "@/lib/ia/uzume/armado-en-prompt";
import { tieneContratoDeColor } from "@/lib/ia/uzume/build-image-prompt";
import { candadosDeComposicion, conArmadoGuirnaldaEnCaption, GEMINI_COMPOSITION_ASSEMBLY_LOCK, GEMINI_COMPOSITION_HARD_LOCK, GEMINI_COMPOSITION_PATTERN_LOCK, hardLockComposicionGemini, piezasDeLosArmados } from "@/lib/ia/uzume/lora-gemini-composition";
import { armadoDeElemento, frasesDeEstructuras, type FraseDeEstructura } from "@/lib/ia/uzume/mezcla-color-escena";
import { ArmadoBouquetResueltoSchema, type ArmadoBouquetResuelto } from "@/lib/plan/armado-bouquet";
import { verificarCoherenciaPrompt, verificarColoresCaptionLora } from "@/lib/plan/coherencia";
import {
  BOUQUET_15_LADOS,
  BOUQUET_80,
  BOUQUET_SINTETICO,
  BOUQUET_VECTOR_15,
  captionCanonico,
  captionBaseDePlan,
  casosSinArmado,
  escenaBouquet,
  escenaDePlan,
  escenaParaCoherencia,
  promptGeminiDePlan,
  promptGeminiSintetico,
  vector15,
} from "../lib/escenas-armado-bouquet";

/**
 * El armado de un bouquet (ADR-0030) en la generación: Gemini (Uzume), el
 * caption del LoRA (Kagutsuchi, fal.ai) y la etapa 2 del híbrido.
 *
 * TypeScript no redacta ni cuenta un armado: inserta tal cual las frases que
 * Python escribe en `plan_resuelto.armados_bouquet` y solo ajusta su propio
 * texto para no contradecirlas. Lo que fija este test:
 *
 * - sin armado (sin `armados_bouquet` o con la lista vacía) cada prompt de una
 *   escena con bouquets es byte a byte el de antes, contra
 *   `scripts/fixtures/armado-bouquet-prompt/prompts-sin-armado.json`, capturada
 *   una sola vez con los constructores anteriores a este cambio;
 * - con armado, el bouquet —un `kit`, categoría "other", nombre "Bouquet de
 *   globos"— lleva línea de color con la frase de Python y su `color_pattern`
 *   en Gemini (antes `tieneContratoDeColor` lo dejaba fuera y el armado no
 *   llegaba), también en instancias repetidas (`EST_x#n`), y con dos grupos
 *   (un número a cada lado) el contrato de cardinalidad cuenta un par de
 *   bouquets en vez de contradecir al armado;
 * - en el caption LoRA la frase sigue a los materiales una sola vez, sin un
 *   segundo "balloon bouquet", sin "mixed organically", con tantos bouquets
 *   como grupos, y pasa el control de idioma y el preflight en los dos
 *   dialectos;
 * - la etapa 2 del híbrido añade el candado del armado solo cuando lo hay;
 * - el bloque de tamaños nombra un número metalizado por su tipo en la leyenda
 *   de Python, no como "latex balloon".
 *
 * Las frases son salidas reales de Python fijadas a mano
 * (`scripts/fixtures/armado-bouquet-prompt/armados.json`). Determinista y sin red.
 * Run: npx tsx --conditions=react-server scripts/test/test-armado-bouquet-prompt.ts
 */

const DIRECTORIO_FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "armado-bouquet-prompt");

function leerFixture(nombre: string): unknown {
  return JSON.parse(readFileSync(join(DIRECTORIO_FIXTURES, nombre), "utf8"));
}

const ARMADOS = z.object({ _comentario: z.string(), armados: z.record(z.string(), ArmadoBouquetResueltoSchema) }).strict().parse(leerFixture("armados.json")).armados;
const INSTANTANEA = z.record(z.string(), z.string()).parse(leerFixture("prompts-sin-armado.json"));

function armado(nombre: string, cambios: Partial<ArmadoBouquetResuelto> = {}): ArmadoBouquetResuelto {
  const base = ARMADOS[nombre];
  if (!base) throw new Error(`armado de fixture desconocido: ${nombre} (hay ${Object.keys(ARMADOS).join(", ")})`);
  return ArmadoBouquetResueltoSchema.parse({ ...base, ...cambios });
}

function vecesEn(texto: string, fragmento: string): number {
  return texto.split(fragmento).length - 1;
}

function clausulaDe(clauses: readonly LoraVisualClause[], elementId: string): LoraVisualClause {
  const clausula = clauses.find((clause) => clause.elementIds.includes(elementId));
  assert.ok(clausula, `ninguna cláusula representa ${elementId}`);
  return clausula;
}

function preflight(sceneSpec: SceneSpec, resultado: { clauses: LoraVisualClause[]; prompt: string }, prompt = resultado.prompt, maxLength?: number) {
  return preflightLoraPrompt({ sceneSpec, clauses: resultado.clauses, prompt, maxLength });
}

function lineaQueEmpieza(prompt: string, inicio: string): string {
  const linea = prompt.split("\n").find((candidata) => candidata.startsWith(inicio));
  assert.ok(linea, `el prompt no tiene una línea que empiece por ${JSON.stringify(inicio)}`);
  return linea;
}

function escenaJson(prompt: string): { elements: Array<{ name: string; color_pattern?: string }> } {
  return JSON.parse(/<AUTOMATIC_SCENE_SPEC>\n(.+)\n<\/AUTOMATIC_SCENE_SPEC>/.exec(prompt)![1]!) as { elements: Array<{ name: string; color_pattern?: string }> };
}

/** Frases de Python para un armado sobre la escena sintética (`EST_02_BOUQUET`). */
function frasesSinteticas(nombre: string): FraseDeEstructura[] {
  return frasesDeEstructuras({ armados_bouquet: [armado(nombre, { estructura_id: BOUQUET_SINTETICO })] })!;
}

// ---------------------------------------------------------------------------
// 1. Sin armado, byte a byte lo de antes.
// ---------------------------------------------------------------------------

function sinArmadoByteAByte(): void {
  for (const caso of casosSinArmado()) {
    const esperado = INSTANTANEA[caso.nombre];
    assert.ok(esperado !== undefined, `la instantánea no tiene ${caso.nombre}`);
    assert.equal(caso.generar(), esperado, `${caso.nombre} cambió respecto al prompt anterior al armado`);
  }
  // Un plan con la lista vacía (Python no armó nada) tampoco cambia nada.
  const vacio = vector15([]);
  assert.deepEqual(frasesDeEstructuras(vacio.plan), []);
  assert.equal(promptGeminiDePlan(vacio, frasesDeEstructuras(vacio.plan)), INSTANTANEA["gemini/vector-15"]);
  // Las piezas nuevas del adaptador son la identidad sin armado.
  const mezcla = vacio.plan.estructuras.flatMap((estructura) => estructura.mezcla_real);
  assert.deepEqual(mezclaRealConArmado(mezcla), mezcla.map((linea) => ({ diamPulg: linea.diam_pulg, forma: linea.forma, unidades: linea.unidades })));
  assert.equal(hardLockComposicionGemini(false, false), GEMINI_COMPOSITION_HARD_LOCK);
  assert.equal(hardLockComposicionGemini(true), `${GEMINI_COMPOSITION_HARD_LOCK} ${GEMINI_COMPOSITION_PATTERN_LOCK}`);
  const canonico = captionCanonico(escenaBouquet(BOUQUET_80));
  assert.deepEqual(candadosDeComposicion(canonico.clauses), [false, false]);
  assert.ok(canonico.clauses.every((clause) => !("armadoBouquet" in clause)));
  console.log(`[PASS] Gemini sin armado (ausente o vacío): ${casosSinArmado().length} prompts con bouquets conservan la instantánea`);
}

// ---------------------------------------------------------------------------
// 2. Gemini (Uzume).
// ---------------------------------------------------------------------------

function frasesYContratoDeColor(): void {
  const armado15 = armado("vector-15");
  const frases = frasesDeEstructuras({ armados_bouquet: [armado15] })!;
  assert.deepEqual(frases, [{ estructura_id: BOUQUET_VECTOR_15, aplicado: true, prompt_gemini: armado15.prompt_gemini, prompt_lora: armado15.prompt_lora, armado: { grupos: 1, conRemate: false, conNumeros: false } }]);
  const escena = escenaDePlan(vector15([armado15]));
  const bouquet = escena.elements.find((element) => element.element_id === BOUQUET_VECTOR_15)!;
  // Lo que produce planBlueprint para un kit: por eso quedaba fuera del contrato de color.
  assert.equal(bouquet.category, "other");
  assert.equal(bouquet.visual_semantics?.structure_type, "kit");
  assert.equal(tieneContratoDeColor(bouquet), false);
  assert.equal(tieneContratoDeColor(bouquet, frases), true);
  assert.deepEqual(armadoDeElemento(frases, bouquet), { grupos: 1, conRemate: false, conNumeros: false });
  // Un patrón de color no es un armado.
  const patron: FraseDeEstructura = { estructura_id: "EST_01_ARCO", aplicado: true, prompt_gemini: "COLOR PATTERN — x.", prompt_lora: "wrapped in a spiral" };
  assert.equal(armadoDeElemento([patron], escena.elements.find((element) => element.element_id === "EST_01_ARCO")!), undefined);
  console.log("[PASS] el bouquet (kit, categoría other) cumple tieneContratoDeColor solo cuando Python le dio un armado");
}

function geminiConArmadoDelPlan(): void {
  const armado15 = armado("vector-15");
  const fijado = vector15([armado15]);
  const frases = frasesDeEstructuras(fijado.plan)!;
  const prompt = promptGeminiDePlan(fijado, frases);
  const frase = armado15.prompt_gemini;
  // Línea de color: el candado monocromo de siempre (lo lee coherencia.ts) y la frase de Python detrás.
  const linea = lineaQueEmpieza(prompt, "- Bouquet de globos: ");
  assert.equal(linea, `- Bouquet de globos: MONOCHROME LOCK — use only negro; do not introduce color variety. ${frase}`);
  assert.equal(escenaJson(prompt).elements.find((element) => element.name === "Bouquet de globos")?.color_pattern, frase);
  // INSTANCE CONTRACT: el armado manda sobre agrupar globos en arcos o racimos.
  const instancia = prompt.split("\n").find((candidata) => candidata.includes("described by “Bouquet de globos”"))!;
  assert.ok(instancia.includes(`${fraseInstanciaConArmado(1)} Quantity means`), instancia);
  // La regla de conteo perceptual tiene su excepción.
  assert.ok(prompt.includes(`into a very large dense installation.${EXCEPCION_CONTEO_CON_ARMADO}`));
  // Coherencia (la puerta antes de la llamada pagada), con las mismas frases que el constructor.
  const coherencia = verificarCoherenciaPrompt(prompt, fijado.plan, escenaParaCoherencia(escenaDePlan(fijado), frases));
  assert.equal(coherencia.ok, true, coherencia.errores.join("; "));
  // Y nada más cambia: sin esas cuatro inserciones es el prompt de antes. Desde
  // la auditoría G3 el bouquet lleva su línea de color también sin armado
  // (tiene globos en el estimado), así que el armado solo le añade su frase.
  const deshecho = prompt
    .replace(linea, linea.replace(` ${frase}`, ""))
    .replace(`,"color_pattern":${JSON.stringify(frase)}`, "")
    .replace(fraseInstanciaConArmado(1), "")
    .replace(EXCEPCION_CONTEO_CON_ARMADO, "");
  assert.equal(deshecho, INSTANTANEA["gemini/vector-15"]);
  console.log("[PASS] Gemini: el armado del bouquet del plan llega a su línea de color y a su color_pattern; coherencia pasa y nada más cambia");
}

function geminiNumerosYGrupos(): void {
  // El "80": dos colores, números al centro.
  const centro = armado("numeros-centro");
  const prompt = promptGeminiSintetico(escenaBouquet(BOUQUET_80), frasesSinteticas("numeros-centro"));
  const linea = lineaQueEmpieza(prompt, "- Bouquet de globos: ");
  assert.match(linea, /^- Bouquet de globos: APPROVED COLOR VARIETY — use exactly these catalog colors: dorado, negro\. /);
  assert.ok(linea.endsWith(` ${centro.prompt_gemini} Do not invent, recolor, or borrow any additional color.`), linea);
  assert.doesNotMatch(linea, /organic clusters/);
  assert.match(prompt, /CARDINALITY CONTRACT: render exactly 1 arch and 1 balloon bouquet, meaning exactly 2 distinct/);
  assert.ok(!prompt.includes(CARDINALIDAD_CON_PAR_DE_BOUQUETS));

  // Un número a cada lado: dos bouquets en una pieza del plan.
  const lados = armado("numeros-lados");
  assert.equal(lados.grupos, 2);
  const promptLados = promptGeminiSintetico(escenaBouquet(BOUQUET_15_LADOS), frasesSinteticas("numeros-lados"));
  assert.match(promptLados, /CARDINALITY CONTRACT: render exactly 1 arch and 1 pair of matching balloon bouquets, meaning exactly 2 distinct installed structure\(s\)\./);
  assert.ok(promptLados.includes(CARDINALIDAD_CON_PAR_DE_BOUQUETS), promptLados);
  assert.ok(promptLados.includes(fraseInstanciaConArmado(2)));
  assert.match(fraseInstanciaConArmado(2), /two matching freestanding bouquets side by side/);
  assert.ok(lineaQueEmpieza(promptLados, "- Bouquet de globos: ").includes(lados.prompt_gemini));

  // Instancias repetidas (`EST_02_BOUQUET#1`, `#2`): cada una lleva el armado de su estructura.
  const repetido = promptGeminiSintetico(escenaBouquet({ ...BOUQUET_80, repeticiones: 2 }), frasesSinteticas("numeros-centro"));
  for (const numero of [1, 2]) {
    assert.ok(lineaQueEmpieza(repetido, `- Bouquet de globos #${numero} de 2: `).includes(centro.prompt_gemini));
  }
  assert.equal(escenaJson(repetido).elements.filter((element) => element.color_pattern === centro.prompt_gemini).length, 2);
  assert.match(repetido, /render exactly 1 arch and 2 balloon bouquets, meaning exactly 3 distinct/);
  const repetidoLados = promptGeminiSintetico(escenaBouquet({ ...BOUQUET_15_LADOS, repeticiones: 2 }), frasesSinteticas("numeros-lados"));
  assert.match(repetidoLados, /render exactly 1 arch and 2 pairs of matching balloon bouquets, meaning exactly 3 distinct/);
  console.log("[PASS] Gemini: números al centro, un número a cada lado (par de bouquets en la cardinalidad) e instancias repetidas llevan el armado de su estructura");
}

// ---------------------------------------------------------------------------
// 3. Caption LoRA (Kagutsuchi).
// ---------------------------------------------------------------------------

function loraCanonicoConArmado(): void {
    const escena = escenaBouquet(BOUQUET_80);
    const centro = armado("numeros-centro");
    const resultado = captionCanonico(escena, frasesSinteticas("numeros-centro"));
    const caso = resultado.prompt;
    assert.equal(resultado.legacy, false, caso);
    assert.deepEqual(resultado.unresolved_products, [], caso);
    // Los números de 32" del catálogo tienen talla en el vocabulario (16 IN / 32 IN).
    assert.deepEqual(resultado.dropped_sizes, [], caso);
    const clausula = clausulaDe(resultado.clauses, BOUQUET_SINTETICO);
    assert.equal(clausula.colorPattern, centro.prompt_lora);
    assert.deepEqual(clausula.armadoBouquet, { grupos: 1, conRemate: false, conNumeros: true });
    assert.equal(vecesEn(resultado.prompt, centro.prompt_lora), 1, caso);
    // Un solo bouquet nombrado: la frase de Python es un modificador, no otro sustantivo.
    assert.equal(vecesEn(resultado.prompt, "balloon bouquet"), 1, caso);
    assert.ok(resultado.prompt.length <= LORA_PROMPT_MAX_LENGTH, `${resultado.prompt.length}`);
    const texto = resultado.prompt;
    const reporte = preflight(escena, resultado, texto);
    assert.equal(reporte.ok, true, `${caso}: ${reporte.errors.join("; ")}`);
    assert.deepEqual(findLoraPromptLanguageLeaks(texto), [], caso);
    // La compactación nunca toca la frase del armado.
    const alterado = preflight(escena, resultado, texto.replace("staggered heights", "different heights"));
    assert.equal(alterado.ok, false);
    assert.match(alterado.errors.join("; "), /patrón de color ausente o alterado: EST_02_BOUQUET/);
  console.log("[PASS] FLUX base: la frase del armado sigue a los materiales una vez y pasa idioma y preflight");
}

function loraGruposEInstancias(): void {
  const lados = armado("numeros-lados");
  const resultado = captionCanonico(escenaBouquet(BOUQUET_15_LADOS), frasesSinteticas("numeros-lados"));
  const clausula = clausulaDe(resultado.clauses, BOUQUET_SINTETICO);
  assert.deepEqual(clausula.armadoBouquet, { grupos: 2, conRemate: false, conNumeros: true });
  assert.equal(clausula.visibleCount, 2);
  assert.match(resultado.prompt, new RegExp(`two balloon bouquets [^.]*${lados.prompt_lora.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`), resultado.prompt);
  assert.equal(preflight(escenaBouquet(BOUQUET_15_LADOS), resultado).ok, true);

  // Dos instancias del plan con un número a cada lado: cuatro bouquets en una cláusula.
  const repetidoLados = captionCanonico(escenaBouquet({ ...BOUQUET_15_LADOS, repeticiones: 2 }), frasesSinteticas("numeros-lados"));
  assert.deepEqual(clausulaDe(repetidoLados.clauses, `${BOUQUET_SINTETICO}#1`).elementIds, [`${BOUQUET_SINTETICO}#1`, `${BOUQUET_SINTETICO}#2`]);
  assert.match(repetidoLados.prompt, /four balloon bouquets/);
  assert.equal(vecesEn(repetidoLados.prompt, lados.prompt_lora), 1);

  // Dos instancias con los números al centro: dos bouquets, la frase una vez.
  const repetido = captionCanonico(escenaBouquet({ ...BOUQUET_80, repeticiones: 2 }), frasesSinteticas("numeros-centro"));
  assert.match(repetido.prompt, /two balloon bouquets/);
  assert.equal(vecesEn(repetido.prompt, armado("numeros-centro").prompt_lora), 1);
  assert.equal(preflight(escenaBouquet({ ...BOUQUET_80, repeticiones: 2 }), repetido).ok, true);
  console.log("[PASS] LoRA: un número a cada lado dibuja dos bouquets por instancia y las instancias repetidas comparten una cláusula con la frase una vez");
}

function loraLegacyDelPlan(): void {
  const armado15 = armado("vector-15");
  const fijado = vector15([armado15]);
  const frases = frasesDeEstructuras(fijado.plan)!;
  const escena = escenaDePlan(fijado);
  {
    const caption = captionBaseDePlan(fijado, frases);
    const clausula = clausulaDe(caption.clauses, BOUQUET_VECTOR_15);
    assert.equal(clausula.colorPattern, armado15.prompt_lora);
    // "a compact balloon bouquet" / "a grand balloon bouquet": la escala la da el armado, no el rol.
    assert.equal(clausula.scale, undefined);
    assert.equal(vecesEn(caption.prompt, armado15.prompt_lora), 1, caption.prompt);
    const reporte = preflight(escena, caption);
    assert.equal(reporte.ok, true, reporte.errors.join("; "));
    const colores = verificarColoresCaptionLora(fijado.plan, escenaParaCoherencia(escena, frases), { clausulas: caption.clauses, traducirColor: translateLoraColor });
    assert.equal(colores.ok, true, colores.errores.join("; "));
  }
  const sinArmado = captionBaseDePlan(vector15());
  assert.equal(clausulaDe(sinArmado.clauses, BOUQUET_VECTOR_15).scale, "compact", "sin armado el acento conserva su escala");
  console.log("[PASS] LoRA legacy: el armado del plan entra en la cláusula del bouquet sin escala inventada, con coherencia de colores y preflight");
}

// ---------------------------------------------------------------------------
// 4. Etapa 2 del híbrido.
// ---------------------------------------------------------------------------

function hibridoConArmado(): void {
  const soloArmado = captionCanonico(escenaBouquet(BOUQUET_80), frasesSinteticas("numeros-centro")).clauses;
  assert.deepEqual(candadosDeComposicion(soloArmado), [false, true]);
  const candado = hardLockComposicionGemini(...candadosDeComposicion(soloArmado));
  assert.equal(candado, `${GEMINI_COMPOSITION_HARD_LOCK} ${GEMINI_COMPOSITION_ASSEMBLY_LOCK}`);
  assert.match(GEMINI_COMPOSITION_ASSEMBLY_LOCK, /levels from bottom to top.*topper.*number balloons in the same position/);
  // Un patrón en el arco y un armado en el bouquet: los dos candados.
  const patron: FraseDeEstructura = { estructura_id: "EST_01_ARCO", aplicado: true, prompt_gemini: "COLOR PATTERN — x.", prompt_lora: "wrapped in a spiral of gold and black stripes winding from the left base over the top to the right base" };
  const ambos = captionCanonico(escenaBouquet(BOUQUET_80), [patron, ...frasesSinteticas("numeros-centro")]).clauses;
  assert.deepEqual(candadosDeComposicion(ambos), [true, true]);
  assert.equal(hardLockComposicionGemini(true, true), `${GEMINI_COMPOSITION_HARD_LOCK} ${GEMINI_COMPOSITION_PATTERN_LOCK} ${GEMINI_COMPOSITION_ASSEMBLY_LOCK}`);
  console.log("[PASS] híbrido: el hard lock de la etapa 2 añade el candado del armado solo cuando el caption lo llevó");
}

/**
 * Hallazgo 17 de la revisión: el candado del armado nombraba siempre "the same
 * topper, the number balloons in the same position", también para un bouquet
 * sin remate ni números (el del vector 15: diez látex negros), e invitaba a la
 * etapa 2 a añadirlos. Solo nombra lo que el armado de Python tiene.
 */
function hibridoSoloLoQueHay(): void {
  const candadoDe = (nombre: string): string => {
    const clauses = captionCanonico(escenaBouquet(BOUQUET_80), frasesSinteticas(nombre)).clauses;
    return hardLockComposicionGemini(...candadosDeComposicion(clauses), conArmadoGuirnaldaEnCaption(clauses), piezasDeLosArmados(clauses));
  };
  const sinNada = armado("vector-15");
  assert.deepEqual([sinNada.remate, sinNada.numero], [[], null]);
  const vector15 = candadoDe("vector-15");
  assert.ok(vector15.startsWith(`${GEMINI_COMPOSITION_HARD_LOCK} Keep each balloon bouquet exactly as assembled in the LoRA image: the same levels from bottom to top and the same number of bouquets;`), vector15);
  assert.doesNotMatch(vector15, /topper|number balloons/, vector15);
  const centro = armado("numeros-centro");
  assert.deepEqual(centro.remate, []);
  const conNumeros = candadoDe("numeros-centro");
  assert.match(conNumeros, /the number balloons in the same position/, conNumeros);
  assert.doesNotMatch(conNumeros, /topper/, conNumeros);
  // Con remate y números, el candado completo de siempre.
  assert.equal(hardLockComposicionGemini(false, true, false, { bouquet: { remate: true, numeros: true }, guirnalda: { relleno: false, remates: false } }), `${GEMINI_COMPOSITION_HARD_LOCK} ${GEMINI_COMPOSITION_ASSEMBLY_LOCK}`);
  console.log("[PASS] híbrido: el candado del bouquet solo nombra el remate y los números que el armado tiene");
}

// ---------------------------------------------------------------------------
// 5. Bloque de tamaños.
// ---------------------------------------------------------------------------

function tamanosConArmado(): void {
  const centro = armado("numeros-centro");
  const mezcla = [
    { diam_pulg: 12, forma: "redondo", unidades: 3 },
    { diam_pulg: 32, forma: null, unidades: 2 },
  ];
  const bloque = (armadoDeLaPieza?: ArmadoBouquetResuelto) => bloqueMezclaPorEstructura([{ nombre: "Bouquet de globos", total_unidades: 5, mezcla_real: mezclaRealConArmado(mezcla, armadoDeLaPieza) }])!;
  // Antes (y sin armado): un número metalizado de 32" se pedía como globo de látex.
  assert.match(bloque(), /- 2 balloons \(40%\): 32-inch \(81\.3 cm\) latex balloon$/m);
  const conArmado = bloque(centro);
  assert.match(conArmado, /- 2 balloons \(40%\): 32-inch \(81\.3 cm\) foil number balloon$/m);
  assert.match(conArmado, /- 3 balloons \(60%\): 12-inch \(30\.5 cm\) round latex balloon — about the size of a human head or a basketball$/m);
  // Dos tipos distintos del mismo diámetro se nombran los dos.
  const corazon = { ...centro.leyenda[2]!, codigo: 9, tipo_globo: "metalizado" as const, tamano_pulg: 18, digito: null };
  const burbuja = { ...centro.leyenda[2]!, codigo: 10, tipo_globo: "burbuja" as const, tamano_pulg: 18, digito: null };
  assert.deepEqual(mezclaRealConArmado([{ diam_pulg: 18, forma: null, unidades: 2 }], { leyenda: [corazon, burbuja] }), [{ diamPulg: 18, forma: "foil or bubble", unidades: 2 }]);
  console.log("[PASS] tamaños: con armado un número metalizado o una burbuja se nombran por su tipo, no como globo de látex");
}

function main(): void {
  sinArmadoByteAByte();
  frasesYContratoDeColor();
  geminiConArmadoDelPlan();
  geminiNumerosYGrupos();
  loraCanonicoConArmado();
  loraGruposEInstancias();
  loraLegacyDelPlan();
  hibridoConArmado();
  hibridoSoloLoQueHay();
  tamanosConArmado();
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error: unknown) {
    console.error(error);
    process.exit(1);
  }
}
