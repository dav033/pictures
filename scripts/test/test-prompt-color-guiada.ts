/**
 * El color de cada globo en el texto de «Ver cómo quedaría» (guiada) y de «Igual al visor» (Taller). Sin red y sin coste:
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-prompt-color-guiada.ts
 *   ... test-prompt-color-guiada.ts --regenerar     (reescribe los dorados cuando el cambio del texto es a propósito)
 *
 * Experimento de color de Kontext max (2026-10-09, `scripts/exp/kontext-color.ts`; datos en la bitácora: research/kontext-color/puntuacion.json
 * y hoja-comparativa.png): las leyendas por columna y las restricciones «no plata» no mejoraron el color con claridad y trajeron costuras y
 * objetos inventados; lo que sí funcionó fue la frase de los metálicos: el oro cromado dejó de salir plateado. Esta prueba fija lo que el
 * texto de producción promete, para que cambiarlo sea una decisión y no un accidente:
 *  - cada color de la escena va con su nombre oficial en inglés (con el acabado cuando el nombre lo dice) y su hex de globo;
 *  - los metálicos conservan su tinte y la frase nombra SOLO los metales de la escena: el oro no recibe «never silver» en una escena de
 *    plata, la plata no se vuelve oro y una escena sin metales no lleva la frase;
 *  - la guiada y el Taller cuentan los colores con las mismas frases (comparten `promptFotoDeLayout`);
 *  - el resto del texto (cámara, materiales, inventario, cierre) es el dorado de `contracts/domain/v1/golden/prompt-imagen-guiada/`.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { descripcionImagenDeEspec } from "../../src/lib/globos3d/motor/v1";
import { promptFotoDeLayout } from "../../src/lib/globos3d/render-ia";
import { fraseMetalicos, promptImagenGuiada } from "../../src/lib/guiada-motor/render-ia-guiada";
import { especDeIdea, especIdea07, paletaDe } from "../lib/paleta-guiada";

const DORADOS = path.resolve(__dirname, "..", "..", "contracts", "domain", "v1", "golden", "prompt-imagen-guiada");

/** Lo que dice el nombre de cada color de la idea 07: la frase exacta que FLUX lee y el acabado que ese nombre lleva. */
const ESPERADO = [
  { hex: "#B6B8DC", frase: "pale lilac (#B6B8DC)", acabado: null },
  { hex: "#F2B6C8", frase: "matte light pink (#F2B6C8)", acabado: /^matte /i },
  { hex: "#A08344", frase: "chrome gold (#A08344)", acabado: /^chrome /i },
] as const;

const FRASE_ORO = "metallic balloons whose reflections keep their own colour (chrome gold reflects gold, never silver)";
const FRASE_PLATA = "metallic balloons whose reflections keep their own colour (chrome silver reflects silver)";

const espec = especIdea07();
const descripcion = descripcionImagenDeEspec(espec).descripcion;
const paleta = paletaDe(espec);
const guiada = promptImagenGuiada(descripcion, "igual_visor");
const taller = promptFotoDeLayout(descripcion, "igual_visor");

const plata = descripcionImagenDeEspec(especDeIdea("idea-deco-real-10-")).descripcion;
const sinMetales = descripcionImagenDeEspec(especDeIdea("idea-deco-real-01-")).descripcion;
const variosMetales = descripcionImagenDeEspec(especDeIdea("idea-deco-real-12-")).descripcion;

function prueba(nombre: string, cuerpo: () => void): void {
  cuerpo();
  console.log(`  ✓ ${nombre}`);
}

prueba("la escena de la idea 07 tiene exactamente los tres colores oficiales, cada uno con su hex de globo", () => {
  assert.deepEqual(paleta.map((c) => c.hex).sort(), ESPERADO.map((e) => e.hex).sort());
});

prueba("cada color va en el texto con su nombre, su acabado y su hex, en las dos piezas que lo usan", () => {
  for (const esperado of ESPERADO) {
    const color = paleta.find((c) => c.hex === esperado.hex)!;
    assert.equal(`${color.nombre} (${color.hex})`, esperado.frase, `el nombre oficial de ${esperado.hex} cambió`);
    if (esperado.acabado) assert.match(color.nombre, esperado.acabado, `el nombre de ${esperado.hex} ya no dice su acabado`);
    const veces = guiada.split(esperado.frase).length - 1;
    assert.ok(veces >= 2, `${esperado.frase} debe salir en cada una de las 2 piezas (sale ${veces})`);
  }
});

prueba("los metálicos conservan su tinte: el oro cromado refleja oro, no plata", () => {
  assert.equal(fraseMetalicos(descripcion), FRASE_ORO, "la frase del experimento (variante d) no cambia sin una nueva medición");
  assert.ok(guiada.includes(FRASE_ORO));
  assert.doesNotMatch(guiada, /chrome balloons with mirror reflections/, "la frase vieja pintaba el dorado de plata");
});

prueba("la frase nombra solo los metales de la escena: una escena de plata no recibe la regla del oro, y viceversa", () => {
  assert.equal(fraseMetalicos(plata), FRASE_PLATA);
  const deLaPlata = promptImagenGuiada(plata, "igual_visor");
  assert.ok(deLaPlata.includes(FRASE_PLATA));
  assert.doesNotMatch(deLaPlata, /never silver|chrome gold/, "en una escena de plata no se dice «never silver» ni se nombra el oro");
  assert.doesNotMatch(guiada, /chrome silver/, "en una escena de oro no se nombra la plata");
  const varios = fraseMetalicos(variosMetales);
  assert.match(varios, /\(chrome purple reflects purple, never silver; chrome silver reflects silver\)$/, "varios metales: cada uno con su regla, en el orden de la tabla oficial");
});

prueba("una escena sin metales no lleva la frase y la oración de materiales queda bien formada", () => {
  assert.equal(fraseMetalicos(sinMetales), "");
  const p = promptImagenGuiada(sinMetales, "igual_visor");
  assert.doesNotMatch(p, /metallic balloons|chrome balloons|mirror reflections/);
  assert.match(p, /knots hidden, a real floor and real painted walls/);
});

prueba("la guiada y el Taller dicen los colores con las mismas frases", () => {
  for (const esperado of ESPERADO) {
    assert.equal(guiada.split(esperado.frase).length, taller.split(esperado.frase).length, `${esperado.frase}: la guiada y el Taller lo cuentan distinto`);
  }
});

prueba("la regla de fidelidad de color sigue al final del inventario, con el hex dado como referencia", () => {
  assert.match(guiada, /Color fidelity: every balloon keeps exactly the color it has in the input image and the hex code given for it; do not darken, desaturate or tint the balloons\./);
});

prueba("el texto completo coincide con el dorado de cada escena (cámara, materiales, inventario, cierre)", () => {
  const escenas: Array<[string, string]> = [["idea-07.txt", guiada], ["idea-10-plata.txt", promptImagenGuiada(plata, "igual_visor")]];
  for (const [archivo, texto] of escenas) {
    const ruta = path.join(DORADOS, archivo);
    if (process.argv.includes("--regenerar")) writeFileSync(ruta, `${texto}\n`);
    assert.ok(existsSync(ruta), `falta el dorado ${archivo}: corre con --regenerar`);
    const dorado = readFileSync(ruta, "utf8").replace(/\r\n/g, "\n");
    assert.equal(`${texto}\n`, dorado, `${archivo}: el texto de «Ver cómo quedaría» cambió: si es a propósito, regenera el dorado con --regenerar`);
  }
});

console.log("\n8 pruebas ok");
