/**
 * Texto que acompaña la captura del taller 3D a FLUX (`promptRender3d`, `promptRender3dFiel`, `descripcionRender3d`,
 * `escenaEnIngles`). Sin coste: no llama a FLUX.
 * - pide conservar forma, cantidades y colores; el lugar solo trae luz, paredes y piso (nada que FLUX «amueble») y
 *   por defecto es la sala del propio visor;
 * - la descripción va en inglés y es un inventario cerrado: cuántas piezas y de qué clase, cada una de izquierda a
 *   derecha con sus colores (en los árboles por partes), y siempre termina en «Nothing else is in the room…»;
 * - nunca pasa de MAX_DESCRIPCION y, si recorta, recorta los colores globales antes que el inventario;
 * - lo orgánico lleva su silueta: la media guirnalda de la araña es medio arco de una pata (FLUX la completaba).
 */
import assert from "node:assert/strict";
import {
  AMBIENTES_RENDER, AMBIENTE_POR_DEFECTO, MAX_DESCRIPCION, NADA_MAS, NADA_MAS_CON_UTILERIA, PREFIJO_SALA, coloresEnIngles, descripcionRender3d, formatoEnIngles, promptRender3d,
  promptRender3dFiel, tonoEnIngles, colorDeGloboEnIngles,
} from "../../src/lib/globos3d/render-ia";
import { ESCENAS_HALLOWEEN, ESCENAS_PREDEFINIDAS } from "../../src/lib/globos3d/escenas-presets";
import { armarEscena, escenaEnIngles } from "../../src/lib/globos3d/escena";
import { referenciaPorCodigo } from "../../src/lib/plan/referencia-sempertex";
import { ESCENA_RENDER_FIEL } from "../exp/escena-render-fiel";

assert.equal(formatoEnIngles("R-12"), "12-inch round");
assert.equal(formatoEnIngles("LOL-6"), "6-inch Link-O-Loon");
assert.equal(formatoEnIngles("T-260"), "260 twisting tube");
assert.equal(formatoEnIngles("C-12"), "12-inch heart");

// Colores de la sala y de una pieza.
assert.equal(tonoEnIngles("#f1ece6"), "off-white (#F1ECE6)");
assert.equal(tonoEnIngles("#d8cbbb"), "light beige (#D8CBBB)");
assert.equal(tonoEnIngles("#fbfaf8"), "white (#FBFAF8)");
assert.equal(tonoEnIngles("#1f3fbf"), "blue (#1F3FBF)");
// Color de globo: nombre corregido y hex oficial (FLUX volvía verde el «turquoise» de Azul Caribe).
assert.equal(colorDeGloboEnIngles({ nombreEn: "turquoise", hexGlobo: "#4bbbcf" }), "light aqua blue (#4BBBCF)");
assert.equal(colorDeGloboEnIngles({ nombreEn: "matte lime green", hexGlobo: "#8ac85b" }), "matte lime green (#8AC85B)");
assert.equal(colorDeGloboEnIngles({ nombreEn: "turquoise", hexGlobo: "#00b5a0" }), "turquoise (#00B5A0)");
assert.equal(coloresEnIngles([{ nombre: "turquoise", cantidad: 60 }, { nombre: "lime green", cantidad: 25 }, { nombre: "red", cantidad: 6 }, { nombre: "white", cantidad: 1 }]), "turquoise and lime green with red accents");
assert.equal(coloresEnIngles([]), "");

// La descripción: estructura, colores, tamaños y el cierre del inventario.
const descripcion = descripcionRender3d("A balloon column 1.8 m tall", [
  { cantidad: 8, formatoId: "R-12", colorEn: "Pastel Matte Pink" },
  { cantidad: 40, formatoId: "R-12", colorEn: "Fashion White" },
]);
assert.equal(descripcion, `A balloon column 1.8 m tall. Colors: about 83% Fashion White, 17% Pastel Matte Pink. Sizes: 12-inch round balloons. ${NADA_MAS}`);
const mezcla = descripcionRender3d("An organic column", [
  { cantidad: 30, formatoId: "R-5", colorEn: "Pastel Matte Blue" }, { cantidad: 2, formatoId: "R-24", colorEn: "Pastel Matte Blue" },
  { cantidad: 10, formatoId: "R-12", colorEn: "Reflex Silver" }, { cantidad: 6, formatoId: "T-260", colorEn: "Fashion Pink" }, { cantidad: 4, formatoId: "LOL-12", colorEn: "Fashion Pink" },
]);
assert.equal(mezcla, `An organic column. Colors: about 62% Pastel Matte Blue, 19% Reflex Silver, 19% Fashion Pink. Sizes: round balloons from 5 to 24 inches, twisting balloons, Link-O-Loon balloons. ${NADA_MAS}`);

// Larga: no pasa del tope, el inventario va primero (recortado con «…»), los colores no caben y el cierre sigue.
const larga = descripcionRender3d(`A wall ${"with many small details ".repeat(80)}`, Array.from({ length: 80 }, (_, i) => ({ cantidad: i + 1, formatoId: "R-5", colorEn: `Color number ${i}` })));
assert.ok(larga.length <= MAX_DESCRIPCION, `descripción de ${larga.length} caracteres`);
assert.ok(larga.endsWith(NADA_MAS));
assert.ok(larga.includes("…"));
assert.ok(!larga.includes("Colors:"), "los colores globales ceden antes que la estructura");

// Los lugares: el de por defecto es el del visor y ninguno trae muebles ni objetos que FLUX pueda copiar.
assert.equal(AMBIENTE_POR_DEFECTO, "igual_visor");
assert.equal(AMBIENTES_RENDER[0]!.id, "igual_visor");
for (const ambiente of AMBIENTES_RENDER) {
  assert.ok(!/table|dessert|guest|string light|furniture|cake|chair|gift|people/i.test(ambiente.frase), `${ambiente.id}: «${ambiente.frase}»`);
  const prompt = promptRender3d(descripcion, ambiente.id);
  assert.ok(/same number, size, position and color of every balloon/.test(prompt));
  assert.ok(prompt.includes(`The decoration: ${descripcion}.`), ambiente.id);
  assert.ok(/Add nothing that is not in the input/.test(prompt));
  assert.ok(!/Sempertex/i.test(prompt), "sin marcas en el texto");
  assert.match(prompt, /Color fidelity: every balloon keeps exactly the color/);
  if (ambiente.id === "igual_visor") { assert.match(prompt, /Keep the room exactly as shown/); assert.match(prompt, /Neutral daylight white balance/); }
  else assert.ok(prompt.includes(ambiente.frase), ambiente.id);
}
assert.ok(!promptRender3d("", "estudio").includes("The decoration:"));

// El inventario cerrado de la escena del caso del dueño (4 árboles + perro + calabaza; FLUX inventaba más).
const armada = armarEscena(ESCENA_RENDER_FIEL);
const inventario = escenaEnIngles(ESCENA_RENDER_FIEL, armada);
assert.match(inventario, /Exactly 6 separate pieces: 3 × balloon tree, 1 × balloon palm tree, 1 × four-legged balloon puppy, 1 × big orange jack-o'-lantern balloon/, inventario);
assert.match(inventario, /From left to right: \(1\) a balloon tree .*\(2\) a balloon palm tree .*\(3\) the same as \(1\); \(4\) the same as \(1\); \(5\) a four-legged balloon puppy .*\(6\) a big orange jack-o'-lantern/);
assert.match(inventario, /dark brown \(#684C41\) trunk with small brown \(#835836\) accents, light aqua blue \(#4BBBCF\) and matte lime green \(#8AC85B\) canopy and matte red \(#E01B2B\) balloon fruits/, inventario);
assert.match(inventario, /brown \(#835836\) trunk, matte dark green \(#007B45\) and bright matte green \(#02AE26\) fronds and dark brown \(#684C41\) coconuts/);
assert.match(inventario, /puppy[^;]*in matte nude beige \(#CA9E5D\)/, "el perrito no es plateado");
assert.match(inventario, /jack-o'-lantern[^;]*in matte orange \(#E75D1D\) and matte lime green \(#8AC85B\)/, "lo que se ve pesa más que los tubitos");
assert.ok(/off-white \(#[0-9A-F]{6}\) back and side walls, a light beige \(#[0-9A-F]{6}\) floor and a white \(#[0-9A-F]{6}\) ceiling, all plain and empty/.test(inventario), inventario);
assert.ok(!/\bwarm\b/.test(inventario), "la sala no se pide cálida");
const completa = descripcionRender3d(inventario, armada.materiales.map((m) => ({ cantidad: m.cantidad, formatoId: m.formatoId, colorEn: referenciaPorCodigo(m.codigo)?.nombreEn ?? m.codigo })));
assert.ok(completa.length <= MAX_DESCRIPCION, `${completa.length}`);
assert.ok(completa.startsWith(inventario.replace(/\.$/, "")), "el inventario entra entero");
assert.ok(completa.endsWith(NADA_MAS));
// La sala del visor solo viaja con «Igual al visor»; con otro lugar se quita (si no, FLUX recibe dos salas).
assert.ok(promptRender3d(completa, "igual_visor").includes(PREFIJO_SALA));
assert.ok(!promptRender3d(completa, "boda_jardin").includes(PREFIJO_SALA));
// El texto de FLUX.1 describe (no da órdenes) y cabe en su codificador (512 tokens ≈ 2000 caracteres).
const fiel = promptRender3dFiel(completa, "igual_visor");
assert.ok(fiel.length < 2000, `${fiel.length}`);
assert.ok(!/\bKeep\b|do not/i.test(fiel));
assert.ok(fiel.includes("Exactly 6 separate pieces"));

// La silueta de lo orgánico, vista de frente.
const enIngles = (id: string) => {
  const p = [...ESCENAS_HALLOWEEN, ...ESCENAS_PREDEFINIDAS].find((x) => x.id === id)!;
  return escenaEnIngles(p.escena, armarEscena(p.escena));
};

// Escena grande con escenografía: los paneles y mesas no se numeran como piezas, el cierre no los contradice
// («no other furniture») y, si no cabe, se corta entre piezas (en un «;»), nunca a media palabra.
const mesas = enIngles("halloween_marco_mesas");
assert.match(mesas, /Exactly 14 separate pieces: 1 × bouquet of helium balloons, 4 × cluster of balloon eyeballs/, mesas);
assert.ok(!/\(\d+\) party props/.test(mesas), "la escenografía no va numerada");
const mesasDescripcion = descripcionRender3d(mesas, []);
assert.ok(mesasDescripcion.length <= MAX_DESCRIPCION, `${mesasDescripcion.length}`);
assert.ok(mesasDescripcion.endsWith(NADA_MAS_CON_UTILERIA), mesasDescripcion.slice(-120));
assert.ok(!mesasDescripcion.includes("…") || /\) [^;]+…\. Nothing else/.test(mesasDescripcion), "si corta, corta en el último «;»");
const media = enIngles("halloween_guirnalda_arana");
assert.match(media, /HALF arch: it rises from the bottom left/, media);
assert.match(media, /only one leg/);
assert.match(enIngles("arco_organico_columnas_guirnalda"), /complete arch: two legs/);
assert.ok(!/HALF arch/.test(enIngles("arco_organico_columnas_guirnalda")));
assert.match(promptRender3d("x", "estudio"), /never complete, mirror or close them/);

console.log("test-render-ia: ok");
