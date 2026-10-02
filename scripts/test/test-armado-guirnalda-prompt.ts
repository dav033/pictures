import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import type { SceneSpec } from "@/lib/ia/escena/scene-spec";
import { LORA_JSON_PROMPT_MAX_LENGTH, LORA_PROMPT_MAX_LENGTH, translateLoraColor, type LoraVisualClause } from "@/lib/ia/kagutsuchi/lora-caption-compiler";
import { findLoraPromptLanguageLeaks, preflightLoraPrompt } from "@/lib/ia/kagutsuchi/lora-prompt-preflight";
import { buildLoraEditPrompt, ensureLoraTriggers } from "@/lib/ia/kagutsuchi/sempertex-lora";
import { CARDINALIDAD_CON_GUIRNALDA_ABRAZADA, fraseInstanciaConArmadoGuirnalda } from "@/lib/ia/uzume/armado-en-prompt";
import { candadosDeComposicion, conArmadoGuirnaldaEnCaption, GEMINI_COMPOSITION_GARLAND_LOCK, GEMINI_COMPOSITION_HARD_LOCK, GEMINI_COMPOSITION_PATTERN_LOCK, hardLockComposicionGemini, LORA_PRESENTATION_INSTRUCTION, piezasDeLosArmados, promptPresentacionLora } from "@/lib/ia/uzume/lora-gemini-composition";
import { armadoDeElemento, armadoGuirnaldaDeElemento, frasesDeEstructuras, type FraseDeEstructura } from "@/lib/ia/uzume/mezcla-color-escena";
import { PRODUCT_VOCABULARY } from "@/lib/lora/product-vocabulary-data";
import type { ArmadoGuirnaldaResuelto } from "@/lib/plan/armado-guirnalda";
import { verificarCoherenciaPrompt, verificarColoresCaptionLora } from "@/lib/plan/coherencia";
import type { PatronColorResuelto } from "@/lib/plan/patron-color";
import type { PlanResuelto } from "@/lib/plan/resuelto";
import { captionLegacyDePlan, escenaDePlan, escenaParaCoherencia, promptGeminiDePlan } from "../lib/escenas-armado-bouquet";
import {
  captionCanonicoGuirnalda,
  casosSinArmado,
  escenaGuirnalda,
  GUIRNALDA_PLAN,
  GUIRNALDA_SINTETICA,
  planGuirnalda,
  promptGeminiGuirnalda,
} from "../lib/escenas-armado-guirnalda";

/**
 * El armado de una guirnalda (ADR-0032, entrega E5) en la generación: Gemini
 * (Uzume), el caption del LoRA (Kagutsuchi, dialectos v007 y v004) y la etapa
 * 2 del híbrido.
 *
 * TypeScript no redacta ni cuenta un armado: inserta tal cual las frases que
 * Python escribe en `plan_resuelto.armados_guirnalda` (unidas a la del patrón
 * cuando la guirnalda también lo lleva) y solo elige sus propias frases fijas
 * (soporte y forma en el INSTANCE CONTRACT, la excepción de cardinalidad de
 * una guirnalda abrazada, la mesa como soporte, el candado del híbrido) según
 * lo que Python decidió: `soporte`, `forma`, `puntos_de_anclaje` y la pieza
 * anfitriona. Lo que fija este test:
 *
 * - sin armado (sin `armados_guirnalda` o con la lista vacía) cada prompt de
 *   una escena con guirnaldas es byte a byte el de antes, contra
 *   `scripts/fixtures/armado-guirnalda-prompt/prompts-sin-armado.json`,
 *   capturada una sola vez con los constructores anteriores a E5;
 * - con armado, cada soporte y forma lleva su frase en Gemini, la guirnalda
 *   conserva el reparto orgánico si no tiene patrón y lo reemplaza si lo
 *   tiene, y coherencia pasa;
 * - en el caption LoRA la frase sigue a los materiales una sola vez, sin un
 *   segundo "organic balloon garland", y pasa el control de idioma, el largo y
 *   el preflight en los dos dialectos, también en el presupuesto del híbrido;
 * - la etapa 2 del híbrido añade el candado de la guirnalda solo cuando lo hay.
 *
 * Las frases son salidas reales de Python
 * (`scripts/fixtures/armado-guirnalda-prompt/planes.json`). Determinista y sin red.
 * Run: npx tsx --conditions=react-server scripts/test/test-armado-guirnalda-prompt.ts
 */

const DIRECTORIO_FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "armado-guirnalda-prompt");
const INSTANTANEA = z.record(z.string(), z.string()).parse(JSON.parse(readFileSync(join(DIRECTORIO_FIXTURES, "prompts-sin-armado.json"), "utf8")) as unknown);

const ORGANICO = "Distribute them through intentional organic clusters and transitions; avoid flat stripes, random speckles, or one color replacing another.";
const PARED_DE_SIEMPRE = " Support: mounted flat against the wall along its whole length with visible anchoring; it never floats away from the wall.";

function vecesEn(texto: string, fragmento: string): number {
  return texto.split(fragmento).length - 1;
}

function armadoDelPlan(plan: PlanResuelto): ArmadoGuirnaldaResuelto {
  const armado = plan.armados_guirnalda?.[0];
  assert.ok(armado, "el plan no trae armados_guirnalda");
  return armado;
}

function patronDelPlan(plan: PlanResuelto): PatronColorResuelto {
  const patron = plan.patrones_color?.[0];
  assert.ok(patron, "el plan no trae patrones_color");
  return patron;
}

function lineaQueEmpieza(prompt: string, inicio: string): string {
  const linea = prompt.split("\n").find((candidata) => candidata.startsWith(inicio));
  assert.ok(linea, `el prompt no tiene una línea que empiece por ${JSON.stringify(inicio)}`);
  return linea;
}

function lineaDeInstancia(prompt: string, nombre: string): string {
  const linea = prompt.split("\n").find((candidata) => candidata.includes(`described by “${nombre}”`));
  assert.ok(linea, `el prompt no tiene la línea de instancia de ${nombre}`);
  return linea;
}

function escenaJson(prompt: string): { elements: Array<{ name: string; color_pattern?: string }> } {
  return JSON.parse(/<AUTOMATIC_SCENE_SPEC>\n(.+)\n<\/AUTOMATIC_SCENE_SPEC>/.exec(prompt)![1]!) as { elements: Array<{ name: string; color_pattern?: string }> };
}

function clausulaDe(clauses: readonly LoraVisualClause[], elementId: string): LoraVisualClause {
  const clausula = clauses.find((clause) => clause.elementIds.includes(elementId));
  assert.ok(clausula, `ninguna cláusula representa ${elementId}`);
  return clausula;
}

function preflight(sceneSpec: SceneSpec, resultado: { clauses: LoraVisualClause[]; prompt: string }, prompt = resultado.prompt, maxLength?: number, trigger = "eventdecor_style_v2") {
  return preflightLoraPrompt({ sceneSpec, clauses: resultado.clauses, prompt, triggers: [trigger], vocabulary: PRODUCT_VOCABULARY, maxLength });
}

/** Las frases de Python de un plan, pasadas a la guirnalda de la escena sintética. */
function frasesSinteticas(nombre: string): FraseDeEstructura[] {
  const { plan } = planGuirnalda(nombre);
  return frasesDeEstructuras({
    ...(plan.patrones_color ? { patrones_color: plan.patrones_color.map((patron) => ({ ...patron, estructura_id: GUIRNALDA_SINTETICA })) } : {}),
    armados_guirnalda: plan.armados_guirnalda!.map((armado) => ({ ...armado, estructura_id: GUIRNALDA_SINTETICA })),
  })!;
}

/** El cierre del candado del híbrido para una guirnalda en la pared o colgada (decisión 28). */
const EXTREMOS_LIBRES = "A garland on the wall or hanging from its anchor points keeps both ends free in the air: drop any stand, leg, pole, base or frame the LoRA image shows under it, and never add one.";

/** La escena sintética sin el arco: la guirnalda sola en la pared, como en la foto del usuario. */
function escenaSoloGuirnalda(): SceneSpec {
  const escena = escenaGuirnalda();
  return { ...escena, elements: escena.elements.filter((element) => element.visual_semantics?.structure_type === "guirnalda") };
}

// ---------------------------------------------------------------------------
// 1. Sin armado, byte a byte lo de antes.
// ---------------------------------------------------------------------------

function sinArmadoByteAByte(): void {
  const casos = casosSinArmado((plan) => frasesDeEstructuras(plan));
  for (const caso of casos) {
    const esperado = INSTANTANEA[caso.nombre];
    assert.ok(esperado !== undefined, `la instantánea no tiene ${caso.nombre}`);
    assert.equal(caso.generar(), esperado, `${caso.nombre} cambió respecto al prompt anterior a E5`);
  }
  // Un plan con la lista vacía (Python no armó ninguna guirnalda) tampoco cambia nada.
  const vacio = planGuirnalda("pared-sin-armado");
  const conListaVacia = { ...vacio, plan: { ...vacio.plan, armados_guirnalda: [] } };
  assert.deepEqual(frasesDeEstructuras(conListaVacia.plan), []);
  assert.equal(promptGeminiDePlan(conListaVacia, frasesDeEstructuras(conListaVacia.plan)), INSTANTANEA["gemini/pared"]);
  assert.equal(frasesDeEstructuras({}), undefined);
  // El candado de la etapa 2 y las cláusulas no cambian sin armado.
  const canonico = captionCanonicoGuirnalda(escenaGuirnalda());
  assert.deepEqual(candadosDeComposicion(canonico.clauses), [false, false]);
  assert.equal(conArmadoGuirnaldaEnCaption(canonico.clauses), false);
  assert.equal(hardLockComposicionGemini(...candadosDeComposicion(canonico.clauses), conArmadoGuirnaldaEnCaption(canonico.clauses)), GEMINI_COMPOSITION_HARD_LOCK);
  assert.ok(canonico.clauses.every((clause) => !("armadoGuirnalda" in clause)));
  console.log(`[PASS] sin armado (ausente o vacío) los ${casos.length} prompts con guirnaldas son byte a byte los de antes`);
}

// ---------------------------------------------------------------------------
// 2. Las frases de Python y la de su patrón.
// ---------------------------------------------------------------------------

function frasesDeLaGuirnalda(): void {
  const pared = planGuirnalda("pared").plan;
  const armado = armadoDelPlan(pared);
  assert.deepEqual(frasesDeEstructuras(pared), [{
    estructura_id: GUIRNALDA_PLAN,
    aplicado: true,
    prompt_gemini: armado.prompt_gemini,
    prompt_lora: armado.prompt_lora,
    guirnalda: { soporte: "pared", forma: "recta", conPatron: false, conRelleno: true, conRemates: true },
  }]);
  // Con patrón, una sola frase por guirnalda: la del armado y detrás la del patrón.
  const conPatron = planGuirnalda("pared-patron-por-racimo").plan;
  const armadoConPatron = armadoDelPlan(conPatron);
  const patron = patronDelPlan(conPatron);
  assert.equal(patron.patron.globos_por_racimo, 4, "el preset va por los racimos del armado");
  assert.equal(patron.patron.base.modo, "espiral");
  const unidas = frasesDeEstructuras(conPatron)!;
  assert.equal(unidas.length, 1);
  assert.equal(unidas[0]!.prompt_gemini, `${armadoConPatron.prompt_gemini} ${patron.prompt_gemini}`);
  assert.equal(unidas[0]!.prompt_lora, `${armadoConPatron.prompt_lora}, ${patron.prompt_lora}`);
  assert.deepEqual(unidas[0]!.guirnalda, { soporte: "pared", forma: "recta", conPatron: true, conRelleno: true, conRemates: false });
  // Un patrón con las dos frases vacías no es un patrón en el prompt: queda el
  // armado solo. Era el caso del confeti hasta ADR-0035; hoy el confeti redacta
  // sus dos frases y se une al armado como cualquier otro modo.
  const sinFrases = { ...patron, prompt_gemini: "", prompt_lora: "" };
  const conSinFrases = frasesDeEstructuras({ patrones_color: [sinFrases], armados_guirnalda: [armadoConPatron] })!;
  assert.equal(conSinFrases[0]!.prompt_gemini, armadoConPatron.prompt_gemini);
  assert.equal(conSinFrases[0]!.guirnalda?.conPatron, false);
  // Colgada de tres puntos y abrazada al arco: lo que Python decidió, sin ids en el texto.
  assert.deepEqual(frasesDeEstructuras(planGuirnalda("colgada").plan)![0]!.guirnalda, { soporte: "colgada", forma: "arco_caido", puntos_de_anclaje: 3, conPatron: false, conRelleno: true, conRemates: false });
  assert.deepEqual(frasesDeEstructuras(planGuirnalda("sobre-arco").plan)![0]!.guirnalda, { soporte: "sobre_estructura", forma: "curva", anfitriona: "EST_02_ARCO", conPatron: false, conRelleno: true, conRemates: false });
  // Un armado de guirnalda no es un armado de bouquet.
  const escena = escenaDePlan(planGuirnalda("pared"));
  const elemento = escena.elements.find((element) => element.element_id === GUIRNALDA_PLAN)!;
  assert.equal(armadoDeElemento(frasesDeEstructuras(pared), elemento), undefined);
  assert.deepEqual(armadoGuirnaldaDeElemento(frasesDeEstructuras(pared), elemento), { soporte: "pared", forma: "recta", conPatron: false, conRelleno: true, conRemates: true });
  console.log("[PASS] frases: el armado de la guirnalda entra por la misma puerta que el patrón y se une a él cuando lo lleva");
}

// ---------------------------------------------------------------------------
// 3. Gemini (Uzume).
// ---------------------------------------------------------------------------

const SOPORTES_GEMINI: ReadonlyArray<{ plan: string; soporte: string; forma?: string }> = [
  { plan: "pared", soporte: "Support: mounted flat against the wall along its whole length with visible anchoring; it never floats away from the wall.", forma: "Shape: it runs straight along its length." },
  { plan: "piso", soporte: "Support: resting on the floor along the front of the installation, grounded along its whole length; it never floats or climbs a wall.", forma: "Shape: it runs straight along its length." },
  { plan: "mesa", soporte: "Support: running along the table edge, resting on the tabletop along its whole length; it never floats above the table or hangs down to the floor.", forma: "Shape: it runs straight along its length." },
  { plan: "colgada", soporte: "Support: draped across three anchor points, hanging from visible hooks or cords at each point; it never rests on the floor or leans on a wall.", forma: "Shape: it dips in swags between its anchor points." },
  { plan: "u-invertida-espejo", soporte: "Support: draped between two anchor points, hanging from visible hooks or cords at each point; it never rests on the floor or leans on a wall.", forma: "Shape: it is shaped as an inverted U, a top run with both sides dropping down symmetrically." },
  { plan: "mesa-decorador", soporte: "Support: running along the table edge, resting on the tabletop along its whole length; it never floats above the table or hangs down to the floor.", forma: "Shape: it rises and falls in a soft wave along its length." },
  { plan: "sobre-arco", soporte: "Support: wrapped around the approved structure described by “Arco”, following that structure's shape and tied to it along its whole length; it never stands apart as a separate piece." },
];

function geminiPorSoporte(): void {
  for (const caso of SOPORTES_GEMINI) {
    const fijado = planGuirnalda(caso.plan);
    const frases = frasesDeEstructuras(fijado.plan)!;
    const prompt = promptGeminiDePlan(fijado, frases);
    const instancia = lineaDeInstancia(prompt, "Guirnalda");
    const esperado = ` ${caso.soporte}${caso.forma ? ` ${caso.forma}` : ""}${fraseInstanciaConArmadoGuirnalda(frases[0]!.guirnalda!)} Quantity means`;
    assert.ok(instancia.includes(esperado), `${caso.plan}: ${instancia}`);
    if (!caso.forma) assert.doesNotMatch(instancia, /Shape:/, `${caso.plan}: sobre otra pieza sigue su forma`);
    // La frase de Python va en la línea de color y en su color_pattern.
    const frase = frases[0]!.prompt_gemini;
    const linea = lineaQueEmpieza(prompt, "- Guirnalda: ");
    assert.ok(linea.includes(frase), `${caso.plan}: ${linea}`);
    assert.equal(escenaJson(prompt).elements.find((element) => element.name === "Guirnalda")?.color_pattern, frase);
    // Coherencia (la puerta antes de la llamada pagada), con las mismas frases.
    const coherencia = verificarCoherenciaPrompt(prompt, fijado.plan, escenaParaCoherencia(escenaDePlan(fijado), frases));
    assert.equal(coherencia.ok, true, `${caso.plan}: ${coherencia.errores.join("; ")}`);
    // Abrazada a otra pieza: la cardinalidad deja que se toquen; en el resto, no.
    assert.equal(prompt.includes(CARDINALIDAD_CON_GUIRNALDA_ABRAZADA), caso.plan === "sobre-arco", caso.plan);
    // Sobre la mesa hay mesa, aunque la ubicación sea la pared.
    assert.equal(/TABLE SUPPORT EXCEPTION: 1 approved table-top structure\(s\)/.test(prompt), caso.plan === "mesa" || caso.plan === "mesa-decorador", caso.plan);
  }
  console.log(`[PASS] Gemini: los ${SOPORTES_GEMINI.length} soportes y formas llevan su frase en el INSTANCE CONTRACT, la frase de Python en su línea de color y coherencia pasa`);
}

function geminiNadaMasCambia(): void {
  // La receta al confirmar no cambia la compra: sin las inserciones, el prompt de antes.
  const fijado = planGuirnalda("pared");
  const frases = frasesDeEstructuras(fijado.plan)!;
  const prompt = promptGeminiDePlan(fijado, frases);
  const frase = armadoDelPlan(fijado.plan).prompt_gemini;
  // Sin patrón, el reparto orgánico se queda y el armado va detrás.
  assert.ok(lineaQueEmpieza(prompt, "- Guirnalda: ").includes(`${ORGANICO} ${frase} Do not invent`));
  const deshecho = prompt
    .replace(`${ORGANICO} ${frase}`, ORGANICO)
    .replace(`,"color_pattern":${JSON.stringify(frase)}`, "")
    .replace(`${PARED_DE_SIEMPRE} Shape: it runs straight along its length.`, PARED_DE_SIEMPRE)
    .replace(fraseInstanciaConArmadoGuirnalda(frases[0]!.guirnalda!), "");
  assert.equal(deshecho, INSTANTANEA["gemini/pared"]);
  console.log("[PASS] Gemini: con la receta, fuera de sus cuatro inserciones el prompt es el de antes");
}

function geminiConPatron(): void {
  for (const nombre of ["pared-patron-por-racimo", "u-invertida-espejo"]) {
    const fijado = planGuirnalda(nombre);
    const frases = frasesDeEstructuras(fijado.plan)!;
    const prompt = promptGeminiDePlan(fijado, frases);
    const linea = lineaQueEmpieza(prompt, "- Guirnalda: ");
    const armado = armadoDelPlan(fijado.plan);
    const patron = patronDelPlan(fijado.plan);
    assert.ok(linea.includes(`${armado.prompt_gemini} ${patron.prompt_gemini} Do not invent`), `${nombre}: ${linea}`);
    // Con patrón, la frase del patrón reemplaza el reparto orgánico, como sin armado.
    assert.ok(!linea.includes(ORGANICO), `${nombre}: ${linea}`);
    const coherencia = verificarCoherenciaPrompt(prompt, fijado.plan, escenaParaCoherencia(escenaDePlan(fijado), frases));
    assert.equal(coherencia.ok, true, `${nombre}: ${coherencia.errores.join("; ")}`);
  }
  const espejo = patronDelPlan(planGuirnalda("u-invertida-espejo").plan);
  assert.equal(espejo.patron.simetria, "espejo");
  assert.match(espejo.prompt_gemini, /from both ends up to the center, mirrored on each side/);
  console.log("[PASS] Gemini: armado y patrón juntos (también el espejo en U invertida) en la línea de color, sin el reparto orgánico");
}

function geminiRepetida(): void {
  const fijado = planGuirnalda("repetida");
  const frases = frasesDeEstructuras(fijado.plan)!;
  const prompt = promptGeminiDePlan(fijado, frases);
  for (const numero of [1, 2]) {
    const nombre = `Guirnalda #${numero} de 2`;
    assert.ok(lineaDeInstancia(prompt, nombre).includes(`${PARED_DE_SIEMPRE} Shape: it runs straight along its length.${fraseInstanciaConArmadoGuirnalda(frases[0]!.guirnalda!)}`), nombre);
    assert.ok(lineaQueEmpieza(prompt, `- ${nombre}: `).includes(frases[0]!.prompt_gemini), nombre);
  }
  const coherencia = verificarCoherenciaPrompt(prompt, fijado.plan, escenaParaCoherencia(escenaDePlan(fijado), frases));
  assert.equal(coherencia.ok, true, coherencia.errores.join("; "));
  console.log("[PASS] Gemini: cada instancia de una guirnalda repetida lleva el armado de su estructura");
}

// ---------------------------------------------------------------------------
// 4. Caption LoRA (Kagutsuchi).
// ---------------------------------------------------------------------------

const CASOS_LORA = ["pared", "piso", "mesa", "colgada", "sobre-arco", "u-invertida-espejo", "pared-patron-por-racimo", "pared-espiral-tres-colores"] as const;
const PLACEMENT_DE: Readonly<Record<string, "fondo_pared" | "piso_frontal" | "sobre_mesa_principal">> = { piso: "piso_frontal", mesa: "sobre_mesa_principal" };

function loraCanonico(): void {
  for (const nombre of CASOS_LORA) {
    const frases = frasesSinteticas(nombre);
    const frase = frases[0]!.prompt_lora;
    const escena = escenaGuirnalda({ placement: PLACEMENT_DE[nombre] });
    for (const [trigger, dialecto] of [["eventdecor_style_v3", "product_v007"], ["eventdecor_style_v2", "scene_v004"]] as const) {
      // En el híbrido el caption comparte presupuesto con la cláusula de presentación.
      for (const maxLength of [undefined, LORA_PROMPT_MAX_LENGTH - LORA_PRESENTATION_INSTRUCTION.length]) {
        const resultado = captionCanonicoGuirnalda(escena, frases, trigger, maxLength);
        const caso = `${nombre} ${dialecto}${maxLength ? " híbrido" : ""}: ${resultado.prompt}`;
        assert.equal(resultado.legacy, false, caso);
        assert.deepEqual(resultado.unresolved_products, [], caso);
        const clausula = clausulaDe(resultado.clauses, GUIRNALDA_SINTETICA);
        assert.equal(clausula.colorPattern, frase, caso);
        assert.deepEqual(clausula.armadoGuirnalda, frases[0]!.guirnalda, caso);
        assert.equal(vecesEn(resultado.prompt, frase), 1, caso);
        // Un modificador, no otra guirnalda: nada entre "garland" y la frase nombra otra.
        assert.doesNotMatch(resultado.prompt, /garland[^,.]*organic balloon garland/, caso);
        assert.doesNotMatch(frase, /\d|garland/, caso);
        assert.doesNotMatch(clausula.colorPattern ?? "", /mixed organically/, caso);
        const limite = maxLength ?? LORA_PROMPT_MAX_LENGTH;
        assert.ok(resultado.prompt.length <= limite, `${caso} (${resultado.prompt.length} > ${limite})`);
        const texto = ensureLoraTriggers(maxLength ? promptPresentacionLora(resultado.prompt) : resultado.prompt, [{ path: "armado", trigger, scale: 1 }]);
        const reporte = preflight(escena, resultado, texto, undefined, trigger);
        assert.equal(reporte.ok, true, `${caso}: ${reporte.errors.join("; ")}`);
        assert.deepEqual(findLoraPromptLanguageLeaks(texto), [], caso);
        if (!maxLength) {
          const json = ensureLoraTriggers(resultado.jsonPrompt, [{ path: "armado", trigger, scale: 1 }]);
          const reporteJson = preflight(escena, resultado, json, LORA_JSON_PROMPT_MAX_LENGTH, trigger);
          assert.equal(reporteJson.ok, true, `${caso} JSON: ${reporteJson.errors.join("; ")}`);
          assert.deepEqual(findLoraPromptLanguageLeaks(json), [], `${caso} JSON`);
        }
      }
    }
    // La compactación nunca toca la frase del armado: alterarla falla cerrado.
    const resultado = captionCanonicoGuirnalda(escena, frases);
    const alterado = preflight(escena, resultado, resultado.prompt.replace(" in clusters of ", " in groups of "));
    assert.equal(alterado.ok, false, nombre);
    assert.match(alterado.errors.join("; "), /patrón de color ausente o alterado: EST_02_GUIRNALDA/);
  }
  console.log(`[PASS] LoRA canónico: ${CASOS_LORA.length} armados siguen a los materiales una vez, sin otra guirnalda, dentro del largo (también en el híbrido) y pasan idioma y preflight en v007 y v004`);
}

function loraSoportes(): void {
  const soportes: ReadonlyArray<[string, RegExp]> = [
    // ADR-0032, decisión 28: en la parte alta de la pared, con los extremos libres.
    ["pared", /mounted flat high on the wall, both ends free, in clusters of four/],
    ["piso", /resting on the floor along the front in clusters of four/],
    ["mesa", /running along the table edge in clusters of four/],
    ["colgada", /draped across three anchor points dipping in swags in clusters of three/],
    // Decisión 28: sin "inverted U", que la LoRA dibujaba como un arco de pie.
    ["u-invertida-espejo", /draped between two anchor points, running along the top with both sides curving down, in clusters of four/],
    ["sobre-arco", /wrapped around the balloon arch in clusters of four/],
  ];
  for (const [nombre, soporte] of soportes) {
    const frases = frasesSinteticas(nombre);
    const prompt = captionCanonicoGuirnalda(escenaGuirnalda({ placement: PLACEMENT_DE[nombre] }), frases, "eventdecor_style_v2").prompt;
    assert.match(prompt, new RegExp(`an organic balloon garland of [^,]* balloons ${soporte.source}`), `${nombre}: ${prompt}`);
  }
  console.log("[PASS] LoRA v004: el descriptor de la guirnalda se especializa por soporte justo detrás de sus materiales");
}

function loraRepetida(): void {
  const frases = frasesSinteticas("repetida");
  const escena = escenaGuirnalda({ repeticiones: 2 });
  const resultado = captionCanonicoGuirnalda(escena, frases);
  assert.deepEqual(clausulaDe(resultado.clauses, `${GUIRNALDA_SINTETICA}#1`).elementIds, [`${GUIRNALDA_SINTETICA}#1`, `${GUIRNALDA_SINTETICA}#2`]);
  assert.match(resultado.prompt, /two organic balloon garlands/);
  assert.equal(vecesEn(resultado.prompt, frases[0]!.prompt_lora), 1);
  assert.equal(preflight(escena, resultado).ok, true);
  console.log("[PASS] LoRA: las instancias repetidas comparten una cláusula con la frase una vez");
}

function loraLegacyDelPlan(): void {
  for (const nombre of ["pared", "colgada", "pared-patron-por-racimo"]) {
    const fijado = planGuirnalda(nombre);
    const frases = frasesDeEstructuras(fijado.plan)!;
    const escena = escenaDePlan(fijado);
    for (const dialect of ["product_v007", "scene_v004"] as const) {
      const caption = captionLegacyDePlan(fijado, dialect, frases);
      const clausula = clausulaDe(caption.clauses, GUIRNALDA_PLAN);
      assert.equal(clausula.colorPattern, frases[0]!.prompt_lora);
      assert.equal(vecesEn(caption.prompt, frases[0]!.prompt_lora), 1, caption.prompt);
      assert.ok(caption.prompt.length <= LORA_PROMPT_MAX_LENGTH);
      const reporte = preflight(escena, caption);
      assert.equal(reporte.ok, true, `${nombre} ${dialect}: ${reporte.errors.join("; ")}`);
      assert.deepEqual(findLoraPromptLanguageLeaks(caption.prompt), []);
      const colores = verificarColoresCaptionLora(fijado.plan, escenaParaCoherencia(escena, frases), { clausulas: caption.clauses, traducirColor: translateLoraColor });
      assert.equal(colores.ok, true, colores.errores.join("; "));
    }
  }
  console.log("[PASS] LoRA legacy: el armado del plan entra en la cláusula de la guirnalda con coherencia de colores y preflight");
}

// ---------------------------------------------------------------------------
// 5. Etapa 2 del híbrido.
// ---------------------------------------------------------------------------

function hibridoConArmado(): void {
  const soloArmado = captionCanonicoGuirnalda(escenaGuirnalda(), frasesSinteticas("pared")).clauses;
  assert.deepEqual(candadosDeComposicion(soloArmado), [false, false], "un armado sin patrón no pide el candado del patrón");
  assert.equal(conArmadoGuirnaldaEnCaption(soloArmado), true);
  assert.equal(hardLockComposicionGemini(...candadosDeComposicion(soloArmado), conArmadoGuirnaldaEnCaption(soloArmado)), `${GEMINI_COMPOSITION_HARD_LOCK} ${GEMINI_COMPOSITION_GARLAND_LOCK}`);
  const conPatron = captionCanonicoGuirnalda(escenaGuirnalda(), frasesSinteticas("pared-patron-por-racimo")).clauses;
  assert.deepEqual(candadosDeComposicion(conPatron), [true, false]);
  assert.equal(hardLockComposicionGemini(...candadosDeComposicion(conPatron), conArmadoGuirnaldaEnCaption(conPatron)), `${GEMINI_COMPOSITION_HARD_LOCK} ${GEMINI_COMPOSITION_PATTERN_LOCK} ${GEMINI_COMPOSITION_GARLAND_LOCK}`);
  assert.match(GEMINI_COMPOSITION_GARLAND_LOCK, /same clusters, filler and accent balloons and the same shape.*support its assembly names/);
  // Sin armado ni patrón, la constante de siempre (y el candado del bouquet no se toca).
  assert.equal(hardLockComposicionGemini(false, false, false), GEMINI_COMPOSITION_HARD_LOCK);
  console.log("[PASS] híbrido: el hard lock de la etapa 2 añade el candado de la guirnalda solo cuando el caption la llevó armada");
}

function gemniSinteticoSinPlan(): void {
  // Sin estimado ni plan: la guirnalda sintética también recibe su soporte y su frase.
  const frases = frasesSinteticas("piso");
  const prompt = promptGeminiGuirnalda(escenaGuirnalda({ placement: "piso_frontal" }), frases);
  assert.ok(lineaDeInstancia(prompt, "Guirnalda orgánica").includes("Support: resting on the floor along the front"));
  // La anfitriona de la escena sintética no existe: nunca se escribe un id.
  const abrazada = promptGeminiGuirnalda(escenaGuirnalda(), frasesSinteticas("sobre-arco"));
  assert.ok(lineaDeInstancia(abrazada, "Guirnalda orgánica").includes("Support: wrapped around its host structure"));
  assert.doesNotMatch(abrazada, /EST_02_ARCO/);
  console.log("[PASS] Gemini sin plan: el soporte llega y una anfitriona desconocida no deja ids en el prompt");
}

// ---------------------------------------------------------------------------
// 6. Revisión adversaria de feat/guirnaldas (hallazgos 15, 16 y 17).
// ---------------------------------------------------------------------------

/** Hallazgo 15: cada instancia de una guirnalda abraza a su instancia de la anfitriona repetida. */
function anfitrionaRepetida(): void {
  // Python acepta dos guirnaldas abrazadas a un par de columnas (plan real).
  const fijado = planGuirnalda("sobre-columnas-repetidas");
  const frases = frasesDeEstructuras(fijado.plan)!;
  const prompt = promptGeminiDePlan(fijado, frases);
  for (const numero of [1, 2]) {
    const linea = lineaDeInstancia(prompt, `Guirnalda #${numero} de 2`);
    assert.ok(linea.includes(`Support: wrapped around the approved structure described by “Columna #${numero} de 2”`), linea);
  }
  const coherencia = verificarCoherenciaPrompt(prompt, fijado.plan, escenaParaCoherencia(escenaDePlan(fijado), frases));
  assert.equal(coherencia.ok, true, coherencia.errores.join("; "));
  // Con distinto número de instancias no hay pareja: la anfitriona se nombra sin su número.
  const base = escenaGuirnalda();
  const arco = base.elements.find((element) => element.element_id === "EST_01_ARCO")!;
  const arcos = [1, 2].map((numero) => ({ ...arco, element_id: `EST_01_ARCO#${numero}`, name: `Arco orgánico #${numero} de 2`, visual_semantics: { ...arco.visual_semantics!, repetition_group: "EST_01_ARCO" } }));
  const escena = { ...base, elements: [...arcos, ...base.elements.filter((element) => element !== arco)] };
  const sobreArco = armadoDelPlan(planGuirnalda("sobre-arco").plan);
  const frasesArco = frasesDeEstructuras({ armados_guirnalda: [{ ...sobreArco, estructura_id: GUIRNALDA_SINTETICA, armado: { ...sobreArco.armado, estructura_id: "EST_01_ARCO" } }] })!;
  const linea = lineaDeInstancia(promptGeminiGuirnalda(escena, frasesArco), "Guirnalda orgánica");
  assert.ok(linea.includes("Support: wrapped around one of the approved structures described by “Arco orgánico”"), linea);
  assert.doesNotMatch(linea, /Arco orgánico #\d/, linea);
  console.log("[PASS] hallazgo 15: con la anfitriona repetida, la guirnalda #n abraza a su pieza #n (o a una de ellas si no hay pareja)");
}

/** Hallazgo 16: el soporte del armado manda sobre la ubicación para la excepción de mesa. */
function mesaSegunElSoporte(): void {
  const base = planGuirnalda("mesa");
  const armado = armadoDelPlan(base.plan);
  assert.match(promptGeminiDePlan(base, frasesDeEstructuras(base.plan)), /TABLE SUPPORT EXCEPTION: 1 approved table-top structure\(s\)/, "sobre la mesa y con soporte mesa");
  const otros: ReadonlyArray<Partial<ArmadoGuirnaldaResuelto["armado"]>> = [
    { soporte: "colgada", puntos_de_anclaje: 2 },
    { soporte: "pared" },
    { soporte: "piso" },
    { soporte: "sobre_estructura", estructura_id: "EST_02_ARCO" },
  ];
  for (const cambio of otros) {
    const plan = { ...base.plan, armados_guirnalda: [{ ...armado, armado: { ...armado.armado, ...cambio } }] };
    const prompt = promptGeminiDePlan({ ...base, plan }, frasesDeEstructuras(plan));
    assert.doesNotMatch(prompt, /TABLE SUPPORT EXCEPTION/, `${cambio.soporte}: la guirnalda ubicada en la mesa ya no se apoya en ella`);
  }
  // Sin armado la ubicación decide, como siempre (la instantánea lo fija byte a byte).
  assert.match(INSTANTANEA["gemini/mesa"]!, /TABLE SUPPORT EXCEPTION: 1 approved table-top structure\(s\)/);
  console.log("[PASS] hallazgo 16: una guirnalda ubicada en la mesa con otro soporte no recibe la excepción de mesa");
}

/** Hallazgo 17: la frase fija y el candado solo nombran el relleno y los remates que el armado tiene. */
function piezasQueElArmadoTiene(): void {
  const casos: ReadonlyArray<[plan: string, relleno: boolean, remates: boolean]> = [
    ["pared", true, true],
    ["colgada", true, false],
    ["clasica-sin-relleno", false, false],
  ];
  for (const [nombre, relleno, remates] of casos) {
    const fijado = planGuirnalda(nombre);
    const armado = armadoDelPlan(fijado.plan);
    assert.equal(armado.relleno !== null, relleno, nombre);
    assert.equal(armado.remates.length > 0, remates, nombre);
    const instancia = lineaDeInstancia(promptGeminiDePlan(fijado, frasesDeEstructuras(fijado.plan)), "Guirnalda");
    assert.ok(instancia.includes("Build it exactly as its GARLAND ASSEMBLY in COLOR VARIETY says: one continuous garland of the listed clusters"), instancia);
    assert.equal(/filler/.test(instancia), relleno, `${nombre}: ${instancia}`);
    assert.equal(/accent/.test(instancia), remates, `${nombre}: ${instancia}`);
    const clauses = captionCanonicoGuirnalda(escenaGuirnalda(), frasesSinteticas(nombre)).clauses;
    const candado = hardLockComposicionGemini(...candadosDeComposicion(clauses), conArmadoGuirnaldaEnCaption(clauses), piezasDeLosArmados(clauses));
    assert.ok(candado.startsWith(`${GEMINI_COMPOSITION_HARD_LOCK} Keep each balloon garland exactly as assembled`), candado);
    assert.equal(/filler/.test(candado), relleno, `${nombre}: ${candado}`);
    assert.equal(/accent/.test(candado), remates, `${nombre}: ${candado}`);
  }
  // Con relleno y remates, la frase y el candado completos de siempre; en la pared,
  // además, los extremos libres (decisión 28).
  const pared = captionCanonicoGuirnalda(escenaGuirnalda(), frasesSinteticas("pared")).clauses;
  assert.equal(hardLockComposicionGemini(...candadosDeComposicion(pared), conArmadoGuirnaldaEnCaption(pared), piezasDeLosArmados(pared)), `${GEMINI_COMPOSITION_HARD_LOCK} ${GEMINI_COMPOSITION_GARLAND_LOCK} ${EXTREMOS_LIBRES}`);
  console.log("[PASS] hallazgo 17: sin relleno o sin remates, ni la línea de instancia ni el candado del híbrido los nombran");
}

// ---------------------------------------------------------------------------
// 7. La espiral se dibujaba como cintas (2026-09-28).
// ---------------------------------------------------------------------------

/**
 * Una guirnalda en pared con espiral de cuartetos rosado, naranja, rosado y
 * dorado salió en fal.ai (LoRA v007, "Generada con LoRA Sempertex") con cintas
 * retorcidas cruzando la pieza. El armado sí llegaba al caption; lo que llegaba
 * era "wrapped in a spiral of pink, orange and gold stripes winding along its
 * length". Este test sigue la cadena de `/api/generate` en los tres modos con
 * el plan real de Python del mismo caso (tres colores, uno repetido) y fija que
 * ninguna palabra que el modelo dibuje como cinta llega al texto.
 */
const CINTAS = /spiral|stripe|bands?|ribbon|streamer|wrapped|winding|twist/i;

function sinCintasEnLaImagen(): void {
  const fijado = planGuirnalda("pared-espiral-tres-colores");
  const armado = armadoDelPlan(fijado.plan);
  const patron = patronDelPlan(fijado.plan);
  assert.deepEqual(patron.patron.base, { modo: "espiral", racimo: [0, 1, 0, 2], trazo: "espiral" });
  const frases = frasesDeEstructuras(fijado.plan)!;
  // Kagutsuchi: el armado y, detrás, los racimos del patrón; ni una cinta.
  const lora = frases[0]!.prompt_lora;
  // Decisión 28: en la parte alta de la pared y con los extremos libres.
  assert.equal(lora, "mounted flat high on the wall, both ends free, in clusters of four with small pink, white and gold filler balloons, every cluster holding two pink, one white and one gold balloon");
  assert.doesNotMatch(lora, CINTAS, lora);
  // Uzume (Gemini, `proveedor_base`): la línea de color lleva las dos frases de Python.
  const prompt = promptGeminiDePlan(fijado, frases);
  const linea = lineaQueEmpieza(prompt, "- Guirnalda: ");
  assert.ok(linea.includes(`${armado.prompt_gemini} ${patron.prompt_gemini} Do not invent`), linea);
  assert.ok(linea.includes("made only of round latex balloons: no ribbons, streamers, twisted bands or fabric."), linea);
  assert.ok(linea.includes("every four-balloon cluster is the same: two pink, one white and one gold round latex balloons"), linea);
  assert.doesNotMatch(linea, /stripes|wrapped|winding|twisted against|diagonal/, linea);
  const coherencia = verificarCoherenciaPrompt(prompt, fijado.plan, escenaParaCoherencia(escenaDePlan(fijado), frases));
  assert.equal(coherencia.ok, true, coherencia.errores.join("; "));
  // LoRA canónico en los dos dialectos, solo texto y en el presupuesto del híbrido,
  // hasta el prompt que recibe fal (`buildLoraEditPrompt` sin referencias).
  const sinteticas = frasesSinteticas("pared-espiral-tres-colores");
  const escena = escenaGuirnalda();
  for (const trigger of ["eventdecor_style_v3", "eventdecor_style_v2"]) {
    for (const hibrido of [false, true]) {
      const resultado = captionCanonicoGuirnalda(escena, sinteticas, trigger, hibrido ? LORA_PROMPT_MAX_LENGTH - LORA_PRESENTATION_INSTRUCTION.length : undefined);
      const texto = ensureLoraTriggers(hibrido ? promptPresentacionLora(resultado.prompt) : resultado.prompt, [{ path: "armado", trigger, scale: 1 }]);
      const aFal = buildLoraEditPrompt(texto, []);
      const caso = `${trigger}${hibrido ? " híbrido" : ""}: ${aFal}`;
      assert.equal(vecesEn(aFal, sinteticas[0]!.prompt_lora), 1, caso);
      assert.doesNotMatch(aFal, CINTAS, caso);
      assert.ok(aFal.length <= LORA_PROMPT_MAX_LENGTH, caso);
      assert.equal(preflight(escena, resultado, texto, undefined, trigger).ok, true, caso);
      if (hibrido) {
        const candado = hardLockComposicionGemini(...candadosDeComposicion(resultado.clauses), conArmadoGuirnaldaEnCaption(resultado.clauses), piezasDeLosArmados(resultado.clauses));
        // En la pared, tras el de las cintas, el de los extremos libres (decisión 28).
        assert.ok(candado.endsWith(`It is made only of round latex balloons: drop any ribbon, streamer, twisted band or fabric the LoRA image shows, and never add one. ${EXTREMOS_LIBRES}`), candado);
      }
    }
  }
  // Sin armado nada cambia: una guirnalda clásica con espiral conserva su frase de siempre.
  assert.match(frasesDeEstructuras(planGuirnalda("clasica-patron-sin-armado").plan)![0]!.prompt_lora, /^wrapped in a spiral of /);
  console.log("[PASS] 2026-09-28: la espiral de una guirnalda armada llega como racimos de globos, sin cintas, a Gemini, al caption LoRA (v007 y v004, texto e híbrido) y al candado de la etapa 2");
}

/**
 * ADR-0032, decisión 28. La guirnalda de la foto del usuario (sola en la pared, alta
 * a la izquierda, arqueada por arriba y cayendo a la derecha) salió de la LoRA como
 * un arco rectangular con patas y soportes metálicos. El caption dice su forma en
 * positivo y deja de pedir "grounded supports" cuando todas sus piezas van en alto;
 * el candado del híbrido descarta patas y soportes. Sin armado, lo de siempre.
 */
function enAltoNuncaUnArcoDePie(): void {
  const frases = frasesSinteticas("pared-arqueada-desnivel");
  const escena = escenaSoloGuirnalda();
  assert.equal(escena.elements.length, 1);
  const forma = "mounted flat high on the wall, higher on the left, curving along the top and dropping lower at the right end, both ends free, in clusters of four";
  for (const [dialecto, trigger] of [["v007", undefined], ["v004", "eventdecor_style_v2"]] as const) {
    const resultado = captionCanonicoGuirnalda(escena, frases, trigger);
    assert.ok(resultado.prompt.includes(forma), `${dialecto}: ${resultado.prompt}`);
    assert.doesNotMatch(resultado.prompt, /\barch(es)?\b|\bstands?\b|\blegs?\b|grounded supports|floor contact/i, `${dialecto}: ${resultado.prompt}`);
    assert.ok(resultado.prompt.endsWith("natural depth."), `${dialecto}: ${resultado.prompt}`);
    assert.ok(resultado.prompt.length <= LORA_PROMPT_MAX_LENGTH, dialecto);
    const reporte = preflight(escena, resultado, resultado.prompt, undefined, trigger ?? "eventdecor_style_v2");
    assert.equal(reporte.ok, true, `${dialecto}: ${reporte.errors.join("; ")}`);
    assert.doesNotMatch(resultado.jsonPrompt, /grounded supports/, `${dialecto} JSON`);
    // La misma escena sin armado: el caption de siempre, con sus soportes.
    const sinArmado = captionCanonicoGuirnalda(escena, undefined, trigger);
    assert.match(sinArmado.prompt, /natural depth, grounded supports\.$/, `${dialecto}: ${sinArmado.prompt}`);
    assert.match(sinArmado.jsonPrompt, /grounded supports/);
    // Híbrido: el candado descarta patas y soportes de la imagen LoRA.
    const piezas = piezasDeLosArmados(resultado.clauses);
    assert.equal(piezas.guirnalda.enAlto, true);
    assert.ok(hardLockComposicionGemini(...candadosDeComposicion(resultado.clauses), conArmadoGuirnaldaEnCaption(resultado.clauses), piezas).endsWith(EXTREMOS_LIBRES));
  }
  // Con otra pieza en la escena (el arco), "grounded supports" sigue: la del arco los necesita.
  assert.match(captionCanonicoGuirnalda(escenaGuirnalda(), frases).prompt, /natural depth, grounded supports\.$/);
  // En el piso no hay extremos en alto: ni el candado ni la cola cambian.
  const piso = captionCanonicoGuirnalda(escenaGuirnalda({ placement: PLACEMENT_DE.piso }), frasesSinteticas("piso")).clauses;
  assert.equal(piezasDeLosArmados(piso).guirnalda.enAlto, undefined);
  assert.ok(!hardLockComposicionGemini(...candadosDeComposicion(piso), conArmadoGuirnaldaEnCaption(piso), piezasDeLosArmados(piso)).includes(EXTREMOS_LIBRES));
  // Gemini: la línea de los extremos libres llega con el armado, tras el desnivel.
  const gemini = promptGeminiGuirnalda(escena, frases);
  assert.ok(gemini.includes("bowing gently upward along the top, its middle about 0.25 m above the straight line between its ends"), gemini);
  assert.ok(gemini.includes("Its right end hangs about 0.63 m lower than its left end, so the garland slopes down toward the right. Both ends hang free in the air, well above the floor: no stands, no legs, no poles and no frame reaching the floor."), gemini);
  console.log("[PASS] decisión 28: una guirnalda en la pared se describe arqueada y con los extremos libres, sin \"grounded supports\" ni arco de pie, en v007, v004, JSON e híbrido; sin armado, lo de siempre");
}

function main(): void {
  sinArmadoByteAByte();
  frasesDeLaGuirnalda();
  geminiPorSoporte();
  geminiNadaMasCambia();
  geminiConPatron();
  geminiRepetida();
  gemniSinteticoSinPlan();
  loraCanonico();
  loraSoportes();
  loraRepetida();
  loraLegacyDelPlan();
  hibridoConArmado();
  anfitrionaRepetida();
  mesaSegunElSoporte();
  piezasQueElArmadoTiene();
  sinCintasEnLaImagen();
  enAltoNuncaUnArcoDePie();
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error: unknown) {
    console.error(error);
    process.exit(1);
  }
}
