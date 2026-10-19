/**
 * P-017: las letras de foil dorado de una palabra («Love», «LOVE») no se ven negras. Sin red ni coste, sin WebGL: arma el
 * metalizado con la forma `letras` en oro y en dorado mate, resuelve el material de cada panel con la misma fábrica que usa
 * el visor (`materialFoil`) y comprueba el color, el metal y que el entorno puesto llega al material (sin entorno, un metal
 * se ve negro). Complementa `test-foil-visor.ts` (todos los colores × formas) fijando el caso dorado de las letras.
 *
 * Run: npx tsx --conditions=react-server scripts/test/test-foil-script-dorado.ts
 */
import assert from "node:assert/strict";
import * as THREE from "three";
import { materialFoil } from "@/components/tres-d/impresos-visor";
import { materialEscenografia } from "@/components/tres-d/materiales-visor";
import type { SolidoEscenografia } from "@/lib/globos3d/escenografia";
import { COLORES_METALIZADO, armarMetalizado, type ColorMetalizado } from "@/lib/globos3d/metalizados";

let fallos = 0;
function prueba(nombre: string, f: () => void) {
  try { f(); console.log(`  ok  ${nombre}`); } catch (e) { fallos++; console.log(`  FALLA ${nombre}\n${e instanceof Error ? e.stack : String(e)}`); }
}

const DORADOS: ColorMetalizado[] = ["oro", "dorado_mate"];
const PALABRAS = ["Love", "LOVE", "love"];
const luminosidad = (c: THREE.Color) => c.getHSL({ h: 0, s: 0, l: 0 }).l;
const entorno = new THREE.Texture();

function panelesDe(texto: string, color: ColorMetalizado) {
  const armado = armarMetalizado({ forma: { tipo: "letras", texto }, pulgadas: 16, color });
  return armado.elementos.filter((e) => e.forma === "panel");
}

prueba("las letras de «Love»/«LOVE» en dorado arman un panel de foil por letra", () => {
  for (const color of DORADOS) for (const texto of PALABRAS) {
    const paneles = panelesDe(texto, color);
    assert.ok(paneles.length >= texto.length, `${color} «${texto}»: ${paneles.length} paneles`);
    for (const p of paneles) assert.equal(p.hex, COLORES_METALIZADO[color].hex, `${color} «${texto}»: el panel lleva el hex del foil`);
  }
});

prueba("el material resuelto de las letras doradas es dorado, metálico, no negro y lleva el entorno", () => {
  for (const color of DORADOS) for (const texto of PALABRAS) for (const p of panelesDe(texto, color)) {
    const material = materialFoil(p.hex, p.acabado === "foil_mate", entorno);
    const esperado = new THREE.Color(COLORES_METALIZADO[color].hex);
    assert.equal(material.color.getHexString(), esperado.getHexString(), `${color} «${texto}»: color del material`);
    assert.ok(luminosidad(material.color) > 0.3, `${color} «${texto}»: no es negro (l = ${luminosidad(material.color).toFixed(2)})`);
    assert.ok(material.metalness >= 0.7, `${color} «${texto}»: metalness ${material.metalness}`);
    assert.equal(material.envMap, entorno, `${color} «${texto}»: el entorno llega al material`);
  }
});

prueba("materialFoil con entorno null da envMap null (control negativo de la prueba anterior)", () => {
  const p = panelesDe("Love", "oro")[0]!;
  const sinEntorno = materialFoil(p.hex, false, null);
  assert.notEqual(sinEntorno.envMap, entorno, "un material creado sin entorno no lleva el entorno del visor");
  assert.equal(sinEntorno.envMap, null);
});

// El visor resuelve el foil por `materialEscenografia` (materiales-visor.ts), que debe pasar su `entorno` a `materialFoil`.
// No hace falta WebGL: solo construye materiales. Falla si ese `entorno` se descarta en la llamada.
prueba("el visor (materialEscenografia) pasa el entorno a materialFoil en foil y foil_mate", () => {
  const p = panelesDe("Love", "oro")[0]!;
  for (const acabado of ["foil", "foil_mate"] as const) {
    const solido = { hex: p.hex, acabado } as unknown as SolidoEscenografia;
    const material = materialEscenografia(solido, entorno) as THREE.MeshPhysicalMaterial;
    assert.equal(material.envMap, entorno, `${acabado}: el entorno del visor llega al material`);
  }
});

if (fallos) { console.log(`\n${fallos} prueba(s) con fallas.`); process.exit(1); }
console.log("\nTodas las pruebas pasaron.");
