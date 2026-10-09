/**
 * La disposición de las piezas del plan 3D de la vista guiada (REQ-007). Sin coste, sin red.
 * - dos columnas de un plan (izquierda y derecha) quedan separadas por el claro de una entrada, no pegadas en un arco;
 * - ninguna caja de pieza cruza a otra en las 28 ideas ni en las 18 estructuras oficiales, salvo lo que se tiende
 *   a propósito sobre otras (una guirnalda, una pared, el techo);
 * - las ideas con varias columnas las tienen separadas.
 */
import assert from "node:assert/strict";
import { todosLosCasos, type CajaCm } from "../lib/casos-motor-guiada";
import { distribuir, type ItemDeLayout } from "../../src/lib/globos3d/motor/layout";
import { armarDesdeEspec, type PiezaEspec } from "../../src/lib/globos3d/motor/v1";

const CLARO_MINIMO_CM = 200;
const SE_TIENDEN_SOBRE_OTRAS = new Set<PiezaEspec["oficial"]>(["guirnalda", "pared_densa", "pared_no_densa", "pared_organica", "racimo_pared", "techo_globos"]);
const esColumna = (p: PiezaEspec) => p.oficial.startsWith("columna");

const seCruzan = (a: CajaCm, b: CajaCm) => [0, 1, 2].every((k) => a[k]! < b[k + 3]! && b[k]! < a[k + 3]!);

// 1. El reparto, sin motor: lo que mide cada pieza decide dónde va.
const columna = (id: string, lugar: ItemDeLayout["lugar"], anchoCm = 75): ItemDeLayout => ({ id, lugar, apoyo: "piso", anchoCm, alturaPared: 0 });
const xDe = (items: ItemDeLayout[], id: string): number => {
  const c = distribuir(items).colocaciones.get(id);
  assert.ok(c && c.en === "piso", `${id} va en el piso`);
  return c.xCm;
};
{
  const [i, d] = [xDe([columna("a", "izquierda"), columna("b", "derecha")], "a"), xDe([columna("a", "izquierda"), columna("b", "derecha")], "b")];
  assert.ok(i < 0 && d > 0 && i === -d, `una columna a cada lado del centro (${i}, ${d})`);
  assert.ok(d - i - 75 >= 240, `entre las orillas de adentro queda el claro de una entrada: ${d - i - 75} cm`);
  const sola = xDe([columna("a", "izquierda")], "a");
  assert.equal(sola, -38, "una columna sola a un lado no se corre: el claro solo existe entre dos lados");
  const ancha = [columna("a", "izquierda"), columna("m", "centro", 500), columna("b", "derecha")];
  assert.equal(xDe(ancha, "b"), 250 + 40 + 38, "con algo ancho al centro, los lados salen de su orilla, no del claro mínimo");
  const dos = [columna("a", "izquierda"), columna("a2", "izquierda"), columna("b", "derecha"), columna("b2", "derecha")];
  assert.ok(xDe(dos, "a2") < xDe(dos, "a") && xDe(dos, "b2") > xDe(dos, "b"), "los segundos de cada lado salen hacia afuera");
}

// 2 y 3. Las 46 casos del motor.
let pares = 0, conColumnas = 0;
for (const caso of todosLosCasos()) {
  const { armada } = armarDesdeEspec(caso.espec);
  const piezas = armada.piezas;
  const de = new Map(caso.espec.piezas.map((p) => [p.id, p]));
  for (let i = 0; i < piezas.length; i++) {
    for (let j = i + 1; j < piezas.length; j++) {
      const [a, b] = [piezas[i]!, piezas[j]!];
      if (SE_TIENDEN_SOBRE_OTRAS.has(de.get(a.id)!.oficial) || SE_TIENDEN_SOBRE_OTRAS.has(de.get(b.id)!.oficial)) continue;
      pares += 1;
      assert.ok(!seCruzan(a.caja as CajaCm, b.caja as CajaCm), `${caso.id}: ${a.id} y ${b.id} se cruzan (cajas ${JSON.stringify(a.caja)} y ${JSON.stringify(b.caja)})`);
    }
  }
  const columnas = piezas.filter((p) => esColumna(de.get(p.id)!)).sort((a, b) => a.caja[0] - b.caja[0]);
  if (columnas.length < 2) continue;
  conColumnas += 1;
  for (let k = 1; k < columnas.length; k++) {
    const claro = columnas[k]!.caja[0] - columnas[k - 1]!.caja[3];
    assert.ok(claro >= CLARO_MINIMO_CM, `${caso.id}: ${columnas[k - 1]!.id} y ${columnas[k]!.id} quedan a ${claro} cm: se leen como un arco, no como dos columnas`);
  }
}
assert.ok(pares >= 5 && conColumnas >= 3, `la prueba de cajas vio ${pares} pares y ${conColumnas} ideas con columnas: debe mirar las de las ideas`);

console.log(`test-motor-guiada-disposicion: ok (${pares} pares sin cruzarse, ${conColumnas} ideas con columnas separadas)`);
