import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LORA_PROMPT_MAX_LENGTH } from "@/lib/ia/kagutsuchi/lora-caption-compiler";
import { findLoraPromptLanguageLeaks } from "@/lib/ia/kagutsuchi/lora-prompt-preflight";
import { frasesDeEstructuras, type FraseDeEstructura } from "@/lib/ia/uzume/mezcla-color-escena";
import type { ArcoResuelto } from "@/lib/plan/armado-arco";
import type { PatronColorResuelto } from "@/lib/plan/patron-color";
import { verificarCoherenciaPrompt } from "@/lib/plan/coherencia";
import { escenaDePlan, escenaParaCoherencia, promptGeminiDePlan } from "../lib/escenas-armado-bouquet";
import { ARCO_PLAN, captionCanonicoGuirnalda, escenaGuirnalda, planGuirnalda, promptGeminiGuirnalda } from "../lib/escenas-armado-guirnalda";

/**
 * El armado de un arco (ADR-0035) en la generación: Gemini (Uzume) y el caption del LoRA (Kagutsuchi).
 *
 * TypeScript no redacta ni cuenta un armado: inserta tal cual las frases que Python escribe en
 * `plan_resuelto.armados_arco[]` (`prompt_gemini`, `prompt_lora`), por la misma puerta que el patrón, el bouquet y la
 * guirnalda (`frasesDeEstructuras`). Lo que fija este test:
 *
 * - sin armado de arco —sin `armados_arco`, con la lista vacía o con arcos que no traen frase (un plan resuelto antes
 *   de ADR-0035)— `frasesDeEstructuras` da exactamente lo de antes y, con ello, cada prompt es byte a byte el de siempre;
 * - con armado, la frase de Python entra una sola vez en la línea de color del arco de Gemini y en su cláusula del
 *   caption LoRA, y reemplaza a la de su patrón si lo traía; las demás piezas no cambian;
 * - el caption cabe en su largo, pasa el control de idioma (ASCII, sin español) y coherencia sigue pasando.
 *
 * Las frases son salida real de Python (`scripts/fixtures/armado-arco-prompt/frases-arco.json`, escrita con
 * `app/armado_arco_prompt.frases_arco` sobre el armado de `arco-ui`). Determinista y sin red.
 * Run: npx tsx --conditions=react-server scripts/test/test-armado-arco-prompt.ts
 */

const FRASES = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "armado-arco-prompt", "frases-arco.json"), "utf8")) as {
  estructura_id: string;
  prompt_gemini: string;
  prompt_lora: string;
};

let casos = 0;
function caso(nombre: string, prueba: () => void): void {
  prueba();
  casos += 1;
  console.log(`[PASS] ${nombre}`);
}

/** Un arco resuelto mínimo: solo importa lo que lee `frasesDeEstructuras`. */
function arcoResuelto(sobre: Partial<ArcoResuelto> = {}): ArcoResuelto {
  return {
    version: "armado-arco.v1",
    globos: [],
    filas: 0,
    columnas: 0,
    secciones: 0,
    ancho_m: 3.2,
    alto_m: 2.3,
    grosor_m: 0.9,
    largo_m: 5,
    diametro_m: 0.27,
    globos_por_metro: 17,
    formula_clasica: 89,
    conteo: [],
    compra: [],
    total_comprar: 0,
    avisos: [],
    ...sobre,
  };
}

const CON_FRASE = arcoResuelto({ estructura_id: FRASES.estructura_id, prompt_gemini: FRASES.prompt_gemini, prompt_lora: FRASES.prompt_lora });
const veces = (texto: string, fragmento: string): number => texto.split(fragmento).length - 1;

caso("sin armado de arco, las frases son exactamente las de antes (y un plan vacío sigue siendo undefined)", () => {
  assert.equal(frasesDeEstructuras({}), undefined);
  assert.equal(frasesDeEstructuras({ armados_arco: [] }), undefined, "la lista vacía no inventa frases");
  // Un plan resuelto antes de ADR-0035: el arco no trae ni estructura ni frases.
  assert.equal(frasesDeEstructuras({ armados_arco: [arcoResuelto()] }), undefined);
  assert.equal(frasesDeEstructuras({ armados_arco: [arcoResuelto({ estructura_id: FRASES.estructura_id, prompt_gemini: " ", prompt_lora: "" })] }), undefined);
  // Con otras frases en el plan, un arco sin frase no añade nada.
  const patron = { estructura_id: "EST_09_PARED", aplicado: true, prompt_gemini: "g", prompt_lora: "l" } as unknown as PatronColorResuelto;
  assert.deepEqual(frasesDeEstructuras({ patrones_color: [patron] }), frasesDeEstructuras({ patrones_color: [patron], armados_arco: [arcoResuelto()] }));
  // Los prompts de una escena con el arco salen byte a byte iguales con o sin la lista sin frases.
  const escena = escenaGuirnalda();
  assert.equal(promptGeminiGuirnalda(escena, frasesDeEstructuras({ armados_arco: [arcoResuelto()] })), promptGeminiGuirnalda(escena, undefined));
  assert.equal(captionCanonicoGuirnalda(escena, frasesDeEstructuras({ armados_arco: [arcoResuelto()] })).prompt, captionCanonicoGuirnalda(escena, undefined).prompt);
});

caso("con armado, la frase de Python entra tal cual como la de la estructura del arco", () => {
  assert.deepEqual(frasesDeEstructuras({ armados_arco: [CON_FRASE] }), [{ estructura_id: FRASES.estructura_id, aplicado: true, prompt_gemini: FRASES.prompt_gemini, prompt_lora: FRASES.prompt_lora }]);
});

caso("reemplaza a la frase del patrón de esa pieza y no toca la de las demás", () => {
  const patronDelArco = { estructura_id: FRASES.estructura_id, aplicado: true, prompt_gemini: "PATRON VIEJO", prompt_lora: "old pattern" } as unknown as PatronColorResuelto;
  const patronDeOtra = { estructura_id: "EST_09_PARED", aplicado: true, prompt_gemini: "PATRON PARED", prompt_lora: "wall pattern" } as unknown as PatronColorResuelto;
  const frases = frasesDeEstructuras({ patrones_color: [patronDelArco, patronDeOtra], armados_arco: [CON_FRASE] })!;
  assert.equal(frases.length, 2);
  assert.equal(frases.find((f) => f.estructura_id === FRASES.estructura_id)!.prompt_gemini, FRASES.prompt_gemini);
  assert.equal(frases.find((f) => f.estructura_id === "EST_09_PARED")!.prompt_gemini, "PATRON PARED");
});

caso("Gemini: la frase del armado va en la línea de color del arco, y la escena sin ella no la lleva", () => {
  const frases = frasesDeEstructuras({ armados_arco: [CON_FRASE] }) as readonly FraseDeEstructura[];
  const escena = escenaGuirnalda();
  const con = promptGeminiGuirnalda(escena, frases);
  const sin = promptGeminiGuirnalda(escena, undefined);
  assert.ok(veces(con, FRASES.prompt_gemini) >= 1, "la frase del armado está en el prompt");
  assert.ok(con.includes(FRASES.prompt_gemini), "el armado del arco llega a Gemini");
  assert.ok(!sin.includes("ARCH ASSEMBLY"), "sin armado no hay frase de armado");
  assert.notEqual(con, sin);
  // La guirnalda de la misma escena no recibe la frase del arco.
  const lineaGuirnalda = con.split("\n").filter((linea) => /garland/i.test(linea) && linea.includes("APPROVED COLOR VARIETY"));
  assert.ok(lineaGuirnalda.every((linea) => !linea.includes("ARCH ASSEMBLY")), "la frase del arco no se pega a otra pieza");
});

caso("Gemini sobre un plan real: la frase del armado entra en la línea del arco y coherencia sigue pasando", () => {
  const fijado = planGuirnalda("pared");
  const arco = arcoResuelto({ estructura_id: ARCO_PLAN, prompt_gemini: FRASES.prompt_gemini, prompt_lora: FRASES.prompt_lora });
  const frases = frasesDeEstructuras({ ...fijado.plan, armados_arco: [arco] }) as readonly FraseDeEstructura[];
  const prompt = promptGeminiDePlan(fijado, frases);
  assert.ok(prompt.includes(FRASES.prompt_gemini), "el armado del arco llega a Gemini");
  const lineaArco = prompt.split("\n").find((linea) => (linea.includes("APPROVED COLOR VARIETY") || linea.includes("MONOCHROME LOCK")) && linea.includes(FRASES.prompt_gemini));
  assert.ok(lineaArco, "va en la línea de color del arco");
  const coherencia = verificarCoherenciaPrompt(prompt, fijado.plan, escenaParaCoherencia(escenaDePlan(fijado), frases));
  assert.deepEqual(coherencia.errores, [], JSON.stringify(coherencia));
  // Sin la frase el prompt es el de siempre y no habla de armado.
  assert.ok(!promptGeminiDePlan(fijado, frasesDeEstructuras(fijado.plan)).includes("ARCH ASSEMBLY"));
});

caso("LoRA: la frase entra una vez en el caption, cabe, es ASCII y sin español", () => {
  const frases = frasesDeEstructuras({ armados_arco: [CON_FRASE] }) as readonly FraseDeEstructura[];
  const escena = escenaGuirnalda();
  const con = captionCanonicoGuirnalda(escena, frases);
  const sin = captionCanonicoGuirnalda(escena, undefined);
  assert.equal(veces(con.prompt, FRASES.prompt_lora), 1, "una sola vez");
  assert.ok(!sin.prompt.includes(FRASES.prompt_lora));
  assert.ok(con.prompt.length <= LORA_PROMPT_MAX_LENGTH, `${con.prompt.length} > ${LORA_PROMPT_MAX_LENGTH}`);
  assert.deepEqual(findLoraPromptLanguageLeaks(con.prompt), []);
  assert.ok(/^[\x20-\x7E]*$/.test(FRASES.prompt_lora) && !/\d/.test(FRASES.prompt_lora), "la frase del LoRA es ASCII y sin cifras");
});

console.log(`\n${casos} casos en verde`);
