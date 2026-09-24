/**
 * Creativity on the standard (Gemini) image path, rules fixed by the
 * 2026-09-15 calibration (README, Iteración 5). Deterministic, no network: the
 * prompts are built from the calibration plans with the same chain as
 * /api/generate.
 * Run: npx tsx --conditions=react-server scripts/test-creatividad-imagen.ts
 */
import assert from "node:assert/strict";
import { AMBIENTACION_IMAGEN, esAmbientacionPermitida, NIVELES_CREATIVIDAD, perfilCreatividad, type NivelCreatividad } from "../src/lib/ia/escena/creatividad";
import { FINAL_OUTPUT_REMINDER, promptElementName } from "../src/lib/ia/uzume/build-image-prompt";
import { buildVisualContext } from "../src/lib/ia/escena/visual-context";
import { ESCENARIOS, promptParaNivel, resolverEscenario } from "./lib/calibracion-creatividad";

let casos = 0;
function ok(nombre: string): void {
  casos += 1;
  console.log(`ok ${casos} - ${nombre}`);
}

/** A section of the prompt from its heading to the next blank line. */
function seccion(prompt: string, encabezado: string): string {
  const inicio = prompt.indexOf(encabezado);
  assert.ok(inicio >= 0, `missing section ${encabezado}`);
  const fin = prompt.indexOf("\n\n", inicio);
  return prompt.slice(inicio, fin < 0 ? undefined : fin);
}

async function main(): Promise<void> {
  // 1. Every level yields a different prompt; the quoted structures are locked.
  for (const escenario of ESCENARIOS) {
    const escena = resolverEscenario(escenario);
    const prompts = new Map(NIVELES_CREATIVIDAD.map((nivel) => [nivel, promptParaNivel(escenario, escena, nivel).prompt]));
    assert.equal(new Set(prompts.values()).size, NIVELES_CREATIVIDAD.length, `${escenario.id}: before the calibration levels 0, 1, 3, 4 and 5 sent the same prompt`);
    const bloqueados = (prompt: string) => [
      seccion(prompt, "CARDINALITY CONTRACT"),
      seccion(prompt, "COLOR VARIETY / MATERIAL MIX"),
      seccion(prompt, "BALLOON SIZE MIX"),
      prompt.slice(prompt.indexOf("<AUTOMATIC_SCENE_SPEC>"), prompt.indexOf("</AUTOMATIC_SCENE_SPEC>")),
    ];
    const referencia = bloqueados(prompts.get(2)!);
    for (const [nivel, prompt] of prompts) {
      assert.deepEqual(bloqueados(prompt), referencia, `${escenario.id} n${nivel}: count, colors, sizes and scene spec do not depend on the level`);
      const perfil = perfilCreatividad(nivel);
      if (nivel === 2) {
        assert.doesNotMatch(prompt, /CREATIVITY LEVEL/, "the default level keeps the pre-calibration prompt");
      } else {
        const bloque = seccion(prompt, `CREATIVITY LEVEL ${nivel} OF 5`);
        assert.match(bloque, /Fidelity lock at every level/);
        for (const clave of perfil.imagen.ambientacion) assert.ok(bloque.includes(AMBIENTACION_IMAGEN[clave].cue), `${escenario.id} n${nivel}: ${clave}`);
        if (perfil.imagen.ambientacion.length === 0) assert.match(bloque, /bans on flowers, plants, candles, furniture, props, and people elsewhere in this prompt apply fully/);
      }
      assert.equal(/except the non-catalog styling allowed in CREATIVITY LEVEL/.test(prompt), perfil.imagen.ambientacion.length > 0, `${escenario.id} n${nivel}: bans relaxed only where styling is allowed`);
      assert.ok(prompt.endsWith(FINAL_OUTPUT_REMINDER), `${escenario.id} n${nivel}: the prompt ends on the photograph-only rule, not on the scene JSON`);
      // Measurements in names were drawn as dimension callouts.
      assert.doesNotMatch(seccion(prompt, "INSTANCE CONTRACT"), /\d(?:\.\d+)?\s*m\b/, `${escenario.id} n${nivel}: no meters in the instance contract`);
      assert.doesNotMatch(prompt, /"name":"[^"]*\d\s*m\b/, `${escenario.id} n${nivel}: no meters in scene spec names`);
      // Centerpieces stand on tables even though generic tables are banned.
      const conCentros = escena.sceneSpec.elements.some((element) => element.visual_semantics?.structure_type === "centro_mesa");
      assert.equal(prompt.includes("TABLE SUPPORT EXCEPTION"), conCentros, `${escenario.id} n${nivel}: table support only for table-top structures`);
    }
  }
  ok("cada nivel cambia el prompt de Gemini sin tocar cantidad, colores, tamaños ni escena aprobada");

  // 2. The styling scale is monotonic and only creative levels add styling.
  for (const nivel of NIVELES_CREATIVIDAD.slice(1)) {
    const anterior = perfilCreatividad((nivel - 1) as NivelCreatividad).imagen.ambientacion;
    for (const clave of anterior) assert.ok(perfilCreatividad(nivel).imagen.ambientacion.includes(clave), `level ${nivel} keeps ${clave}`);
  }
  for (const nivel of [0, 1, 2] as const) assert.deepEqual(perfilCreatividad(nivel).imagen.ambientacion, []);
  assert.equal(perfilCreatividad(2).imagen.direccion, "");
  for (const nivel of NIVELES_CREATIVIDAD) assert.doesNotMatch(perfilCreatividad(nivel).imagen.direccion, /[áéíóúñ]/i, "art direction is English");
  // "editorial" (level 3) drew caption cards in 2 of 2 images and "documentary" (level 0) in 1 of 3: no layout words.
  for (const nivel of NIVELES_CREATIVIDAD) assert.doesNotMatch(perfilCreatividad(nivel).imagen.direccion, /\b(?:editorial|documentary|magazine|catalog|brochure|poster|diagram|infographic|annotated|layout)\b/i, `level ${nivel}: no layout words in the art direction`);
  ok("la ambientación permitida crece con el nivel y 0-2 no añaden nada");

  // 3. Venue: only a real place phrase of the request is a MANDATORY VENUE.
  assert.equal(buildVisualContext({ userRequest: "Decoración de XV años en blanco y dorado con un arco orgánico y dos columnas" }).venue, undefined);
  assert.equal(buildVisualContext({ userRequest: "Baby shower con una guirnalda de globos azules en la pared" }).venue, undefined);
  assert.equal(buildVisualContext({ userRequest: "Boda con columnas en la entrada y centros de mesa" }).venue, undefined);
  assert.equal(buildVisualContext({ userRequest: "Cumpleaños en tonos pastel de noche" }).venue, undefined);
  assert.equal(buildVisualContext({ userRequest: "Cumpleaños en el club campestre de noche" }).venue, "club campestre");
  assert.equal(buildVisualContext({ userRequest: "Boda en un jardín" }).venue, "jardín");
  ok("colores, piezas o lugares de la pieza ya no se convierten en MANDATORY VENUE");

  assert.equal(promptElementName("Pared de globos (2.4 m × 2.2 m)"), "Pared de globos");
  assert.equal(promptElementName("Columna de entrada (1.8 m) #1 de 2"), "Columna de entrada #1 de 2");
  assert.equal(promptElementName("Arco (lado derecho)"), "Arco (lado derecho)", "a parenthetical without numbers is kept");
  ok("los nombres llegan al modelo sin medidas");

  // Form: an approved arch is an inverted U unless the plan declares a hoop; a wall garland is anchored.
  {
    const xv = ESCENARIOS.find((item) => item.id === "xv-arco-columnas")!;
    const escenaXv = resolverEscenario(xv);
    const instancias = (prompt: string) => seccion(prompt, "INSTANCE CONTRACT");
    assert.match(instancias(promptParaNivel(xv, escenaXv, 0).prompt), /Arco orgánico[^\n]*inverted-U arch[^\n]*never a round hoop/);
    assert.doesNotMatch(instancias(promptParaNivel(xv, escenaXv, 0).prompt), /Columna izquierda[^\n]*inverted-U/, "columns get no arch form");
    const aro = { ...escenaXv, officialStructures: new Map([["EST_01_ARCO", "aro_circular"]]) };
    assert.doesNotMatch(promptParaNivel(xv, aro, 0).prompt, /inverted-U arch/, "a declared circular hoop keeps its form");
    const baby = ESCENARIOS.find((item) => item.id === "baby-guirnalda-mono")!;
    assert.match(instancias(promptParaNivel(baby, resolverEscenario(baby), 3).prompt), /mounted flat against the wall[^\n]*never floats/);
  }
  ok("forma: el arco es una U invertida salvo aro declarado y la guirnalda de pared va anclada");

  // 4. La ambientación permitida por nivel sigue siendo una regla del perfil de creatividad,
  // aunque el observador visual que la consumía para juzgar la imagen ya no existe.
  assert.equal(esAmbientacionPermitida(4, "fresh flower arrangement on the floor"), true);
  assert.equal(esAmbientacionPermitida(4, "a few guests in the background"), true);
  assert.equal(esAmbientacionPermitida(4, "flower_arrangements_on_floor"), true, "snake_case observer answers");
  assert.equal(esAmbientacionPermitida(3, "lit candles"), false, "candles start at level 4");
  assert.equal(esAmbientacionPermitida(0, "flower arrangement"), false);
  assert.equal(esAmbientacionPermitida(5, "loose balloons tied to the dessert table"), false);
  assert.equal(esAmbientacionPermitida(5, "floral backdrop"), false);
  assert.equal(esAmbientacionPermitida(5, "happy birthday sign on the cake table"), false);
  ok("la ambientación permitida por nivel sigue clasificando estilo esperado vs. extra inventado");

  console.log(`${casos} casos`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
