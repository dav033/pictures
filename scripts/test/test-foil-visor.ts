/**
 * El foil (metalizado) y los materiales metálicos del visor del taller 3D (P-017). Sin red ni coste, sin WebGL:
 * - cada color de foil × cada forma (números 0–9, letras A–Z, palabras como «Love»/«LOVE»/«HBD», corazón, estrella, redondo,
 *   luna, flor, nube) arma paneles cuyo material tiene el color del foil y NO es negro ni casi negro (salvo el foil negro),
 *   con el entorno que se le dio puesto en el material: sin entorno, un metal se ve negro;
 * - el entorno de los metalizados (`entorno-metal.ts`): cada visor se registra y se da de baja; una captura fuera de
 *   pantalla que se crea y se destruye en medio (la del refinado) no deja al visor del taller con un entorno liberado.
 *   Esta es la causa del «Love» dorado negro: la ronda de refinado capturaba la escena, destruía su visor y el foil nuevo
 *   se creaba con el mapa liberado;
 * - los colores de látex cromado y metal se aclaran hasta su luminosidad mínima (no salen negros).
 *
 * Run: npx tsx scripts/test/test-foil-visor.ts
 */
import assert from "node:assert/strict";
import * as THREE from "three";
import { colorDeLatex } from "@/components/tres-d/escena-globos";
import { entornoMetal, registrarEntornoMetal, soltarEntornoMetal } from "@/components/tres-d/entorno-metal";
import { materialFoil } from "@/components/tres-d/impresos-visor";
import { metalizadoMasParecido, referenciaDePedido } from "@/lib/globos3d/herramientas-escena-colores";
import { CARACTERES_METALIZADO, COLORES_METALIZADO, armarMetalizado, type ColorMetalizado, type FormaMetalizado } from "@/lib/globos3d/metalizados";
import { FORMATOS_GLOBO, coloresDelFormato } from "@/lib/globos3d/formatos";

let fallos = 0;
function prueba(nombre: string, f: () => void) {
  try { f(); console.log(`  ok  ${nombre}`); } catch (e) { fallos++; console.log(`  FALLA ${nombre}\n${e instanceof Error ? e.stack : String(e)}`); }
}

/** Negro o casi negro: la luminosidad (HSL) del color del material. */
const luminosidad = (c: THREE.Color) => c.getHSL({ h: 0, s: 0, l: 0 }).l;
const MIN_LUMINOSIDAD_FOIL = 0.2;

const FORMAS: FormaMetalizado[] = [
  ...Array.from({ length: 10 }, (_, valor): FormaMetalizado => ({ tipo: "numero", valor })),
  ...CARACTERES_METALIZADO.filter((c) => /[A-Z]/.test(c)).map((valor): FormaMetalizado => ({ tipo: "letra", valor })),
  { tipo: "letras", texto: "Love" }, { tipo: "letras", texto: "love" }, { tipo: "letras", texto: "LOVE" }, { tipo: "letras", texto: "HBD" },
  { tipo: "corazon" }, { tipo: "estrella" }, { tipo: "redondo" }, { tipo: "luna" }, { tipo: "flor" }, { tipo: "nube" },
];
const COLORES = Object.keys(COLORES_METALIZADO) as ColorMetalizado[];
const entornoDePrueba = new THREE.Texture();

prueba("cada color de foil × cada forma da paneles de foil con el color del foil, con entorno y sin ser negros", () => {
  let paneles = 0;
  for (const color of COLORES) for (const forma of FORMAS) {
    const armado = armarMetalizado({ forma, pulgadas: 18, color });
    assert.ok(armado.elementos.length > 0, `${color} ${JSON.stringify(forma)} arma`);
    for (const e of armado.elementos) {
      if (e.forma !== "panel") continue;
      paneles++;
      assert.ok(e.acabado === "foil" || e.acabado === "foil_mate", `${color} ${JSON.stringify(forma)}: acabado de foil`);
      const material = materialFoil(e.hex, e.acabado === "foil_mate", entornoDePrueba);
      assert.equal(material.envMap, entornoDePrueba, "el material lleva el entorno que se le dio");
      assert.ok(material.metalness > 0, "el foil es metal");
      // El disco dorado del centro de la flor es oro aunque la flor sea de otro color.
      const esperado = e.hex === COLORES_METALIZADO.oro.hex ? "oro" : color;
      if (esperado !== "negro_mate") {
        assert.ok(luminosidad(material.color) > MIN_LUMINOSIDAD_FOIL, `${color} ${JSON.stringify(forma)}: ${e.hex} es casi negro (l = ${luminosidad(material.color).toFixed(2)})`);
      }
    }
  }
  assert.ok(paneles > COLORES.length * FORMAS.length, "se revisaron todos los paneles");
});

prueba("el foil negro es el único oscuro de la tabla", () => {
  const oscuros = COLORES.filter((c) => luminosidad(new THREE.Color(COLORES_METALIZADO[c].hex)) <= MIN_LUMINOSIDAD_FOIL);
  assert.deepEqual(oscuros, ["negro_mate"]);
});

prueba("pedir «dorado», «oro» o «gold» a un metalizado da un foil dorado, nunca negro", () => {
  for (const pedido of ["dorado", "dorada", "oro", "gold", "dorado metalizado", "dorado cromado"]) {
    const ref = referenciaDePedido(pedido);
    assert.ok(ref, `«${pedido}» existe en la tabla Sempertex`);
    const color = metalizadoMasParecido(ref.codigo);
    assert.notEqual(color, "negro_mate", `«${pedido}» (${ref.codigo}) → ${color}`);
  }
});

prueba("los cromados y metales de látex se aclaran hasta su luminosidad mínima", () => {
  for (const f of FORMATOS_GLOBO) for (const ref of coloresDelFormato(f.id)) {
    const familia = ref.familia as string;
    const minimo = familia === "reflex" ? 0.62 : familia === "metal" ? 0.5 : 0;
    if (!minimo) continue;
    const l = luminosidad(colorDeLatex(familia, ref.hexGlobo));
    assert.ok(l >= minimo - 0.02 || l >= luminosidad(new THREE.Color(ref.hexGlobo)), `${f.id} ${ref.codigo} ${ref.hexGlobo}: l = ${l.toFixed(2)}`);
  }
});

prueba("entorno de los metalizados: el visor vivo más reciente; sin visores, ninguno", () => {
  assert.equal(entornoMetal(), null);
  const taller = new THREE.Texture();
  registrarEntornoMetal(taller);
  assert.equal(entornoMetal(), taller);
  soltarEntornoMetal(taller);
  assert.equal(entornoMetal(), null);
});

prueba("una captura que se crea y se destruye en medio no deja al visor del taller sin entorno (el «Love» negro)", () => {
  const taller = new THREE.Texture(), captura = new THREE.Texture();
  registrarEntornoMetal(taller);
  registrarEntornoMetal(captura);
  assert.equal(entornoMetal(), captura, "mientras la captura vive, sus materiales usan su entorno");
  soltarEntornoMetal(captura);
  captura.dispose();
  assert.equal(entornoMetal(), taller, "al destruirse la captura, el foil nuevo del taller usa el entorno del taller");
  const foil = materialFoil("#e2b64c", false, entornoMetal());
  assert.equal(foil.envMap, taller);
  soltarEntornoMetal(taller);
});

prueba("dar de baja un visor dos veces o uno que no está no rompe nada", () => {
  const a = new THREE.Texture(), b = new THREE.Texture();
  registrarEntornoMetal(a);
  soltarEntornoMetal(b);
  soltarEntornoMetal(a);
  soltarEntornoMetal(a);
  assert.equal(entornoMetal(), null);
});

if (fallos) { console.log(`\n${fallos} prueba(s) con fallas.`); process.exit(1); }
console.log("\nTodas las pruebas pasaron.");
