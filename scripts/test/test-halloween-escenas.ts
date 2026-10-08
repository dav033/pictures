/**
 * Las 5 escenas de Halloween (fotos del dueño, 2026-10-07): estructuras orgánicas nuevas y escenografía. Sin coste:
 * no llama a ninguna IA.
 * - las 5 arman sin avisos y nada atraviesa el piso, las paredes ni el techo (los globos tampoco bajan del piso);
 * - medidas razonables frente a la foto (medidas por el tamaño de los globos): aro ~1,6 m de diámetro, arco
 *   rectangular ~2,6 × 2,6 m con los huecos de las calabazas, árbol ~2,5 m, guirnalda ~1,2 × 1,9 m, marco 2,4 m;
 * - cada globo es de un color que se fabrica en su formato y los colores son los medidos en la foto;
 * - la escenografía no da materiales y sus sólidos quedan donde va su pieza (mesas en el piso, fondo contra la pared);
 * - determinismo (dos armados iguales).
 */
import assert from "node:assert/strict";
import { armarEscena } from "../../src/lib/globos3d/escena";
import { ESCENAS_HALLOWEEN, ESCENAS_PREDEFINIDAS, escenaPredefinida } from "../../src/lib/globos3d/escenas-presets";
import { coloresDelFormato } from "../../src/lib/globos3d/formatos";
import { puntosSolido } from "../../src/lib/globos3d/escenografia";
import { armarPieza } from "../../src/lib/globos3d/piezas";

const EPS = 0.5;
const medida = (c: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } }) => ({ ancho: c.max.x - c.min.x, alto: c.max.y - c.min.y, fondo: c.max.z - c.min.z });
const entre = (v: number, a: number, b: number, que: string) => assert.ok(v >= a && v <= b, `${que}: ${v.toFixed(0)} cm (esperado ${a}–${b})`);

assert.equal(ESCENAS_HALLOWEEN.length, 5);
assert.deepEqual(ESCENAS_HALLOWEEN.map((p) => p.nombre), [
  "Halloween: marco orgánico con mesas", "Halloween: arco con calabazas", "Halloween: aro de ojos y arañas", "Halloween: árbol con fantasmas", "Halloween: guirnalda con araña",
]);
for (const p of ESCENAS_HALLOWEEN) assert.ok(ESCENAS_PREDEFINIDAS.includes(p), `${p.id} se ofrece en las escenas predefinidas`);

const resumen: string[] = [];
for (const p of ESCENAS_HALLOWEEN) {
  const escena = escenaPredefinida(p.id);
  const a = armarEscena(escena);
  assert.deepEqual(a.avisos, [], `${p.id}: sin avisos`);
  const s = escena.sala;
  // 1. Nada atraviesa la sala; ningún globo baja del piso.
  for (const n of a.porNodo) {
    assert.ok(n.copias > 0, `${p.id}/${n.id}: se puso`);
    assert.ok(n.caja.min.y >= -EPS && n.caja.max.y <= s.altoCm + EPS, `${p.id}/${n.id}: entre el piso y el techo (${n.caja.min.y.toFixed(1)}…${n.caja.max.y.toFixed(1)})`);
    assert.ok(n.caja.min.x >= -s.anchoCm / 2 - EPS && n.caja.max.x <= s.anchoCm / 2 + EPS, `${p.id}/${n.id}: entre las paredes laterales`);
    assert.ok(n.caja.min.z >= -s.fondoCm / 2 - EPS && n.caja.max.z <= s.fondoCm / 2 + EPS, `${p.id}/${n.id}: no atraviesa la pared del fondo ni sale por delante`);
  }
  for (const g of a.globos) {
    const y = g.nudo.y + g.direccion.y * (g.infladoCm / 2 + g.cuelloExtraCm);
    assert.ok(y - g.infladoCm / 2 >= -1, `${p.id}: un ${g.formatoId} atraviesa el piso (${(y - g.infladoCm / 2).toFixed(1)})`);
  }
  for (const solido of a.solidos) for (const q of puntosSolido(solido)) assert.ok(q.y >= -EPS && q.z >= -s.fondoCm / 2 - EPS, `${p.id}: la escenografía no atraviesa el piso ni la pared`);
  // 2. Colores: cada globo de un color que se fabrica en su formato.
  for (const g of a.globos) assert.ok(coloresDelFormato(g.formatoId).some((c) => c.codigo === g.codigo), `${p.id}: el ${g.codigo} no se fabrica en ${g.formatoId}`);
  for (const m of a.materiales) assert.ok(m.cantidad > 0);
  // 3. La escenografía no da materiales.
  for (const n of escena.nodos) if (n.pieza.tipo === "escenografia") {
    assert.equal(armarPieza(n.pieza).materiales.length, 0, `${p.id}/${n.id}: la escenografía no cotiza`);
    assert.ok((a.porNodo.find((x) => x.id === n.id)?.solidos.length ?? 0) > 0, `${p.id}/${n.id}: tiene sólidos`);
  }
  // 4. Determinismo.
  assert.equal(JSON.stringify(armarEscena(escenaPredefinida(p.id))), JSON.stringify(a), `${p.id}: determinista`);
  resumen.push(`${p.id} ${a.globos.length} globos`);
}

const nodoDe = (id: string, nodo: string) => {
  const a = armarEscena(escenaPredefinida(id));
  const n = a.porNodo.find((x) => x.id === nodo);
  assert.ok(n, `falta ${id}/${nodo}`);
  return { a, n, escena: escenaPredefinida(id) };
};
const codigos = (globos: ReadonlyArray<{ codigo: string }>) => new Set(globos.map((g) => g.codigo));

// 5. Foto 1: marco de 2,4 m contra la pared, racimos por encima del marco y a sus pies, mesas en el piso delante.
{
  const { a, n: racimos, escena } = nodoDe("halloween_marco_mesas", "racimos");
  const fondo = a.porNodo.find((x) => x.id === "fondo-marco")!;
  const m = medida(fondo.caja);
  entre(m.ancho, 225, 260, "ancho del marco");
  entre(m.alto, 235, 255, "alto del marco");
  assert.ok(fondo.caja.min.z >= -escena.sala.fondoCm / 2 - EPS && fondo.caja.min.z < -escena.sala.fondoCm / 2 + 10, "el marco va contra la pared del fondo");
  const r = medida(racimos.caja);
  entre(r.ancho, 320, 390, "ancho de los racimos");
  entre(racimos.caja.max.y, 270, 310, "alto de los racimos de arriba");
  assert.ok(racimos.caja.min.z > fondo.caja.min.z, "los racimos van delante del fondo");
  assert.deepEqual([...codigos(racimos.globos)].sort(), ["023", "031", "060", "061", "850"], "los colores medidos en la foto 1");
  for (const id of ["mesa-baja", "mesa-alta"]) {
    const mesa = a.porNodo.find((x) => x.id === id)!;
    assert.ok(Math.abs(mesa.caja.min.y) < EPS, `${id} apoyada en el piso`);
    assert.ok(mesa.caja.min.z > fondo.caja.max.z, `${id} delante del fondo`);
  }
  entre(medida(a.porNodo.find((x) => x.id === "mesa-alta")!.caja).alto, 80, 90, "alto de la mesa alta");
  entre(medida(a.porNodo.find((x) => x.id === "tapete")!.caja).alto, 0.5, 2, "grosor del tapete");
}

// 6. Foto 2: arco rectangular ~2,6 × 2,6 m, con los huecos de las calabazas a 66–118 cm, y la mesa delante.
{
  const { a, n: arco } = nodoDe("halloween_arco_calabazas", "arco");
  const m = medida(arco.caja);
  entre(m.ancho, 240, 290, "ancho del arco");
  entre(m.alto, 245, 285, "alto del arco");
  for (const lado of [-1, 1]) {
    const enHueco = arco.globos.filter((g) => {
      const c = { x: g.nudo.x + g.direccion.x * (g.infladoCm / 2 + g.cuelloExtraCm), y: g.nudo.y + g.direccion.y * (g.infladoCm / 2 + g.cuelloExtraCm) };
      return Math.sign(c.x) === lado && Math.abs(Math.abs(c.x) - 97.5) < 15 && c.y > 80 && c.y < 105;
    });
    assert.equal(enHueco.length, 0, `queda el hueco de la calabaza ${lado < 0 ? "izquierda" : "derecha"} (${enHueco.length} globos dentro)`);
  }
  assert.deepEqual([...codigos(arco.globos)].sort(), ["061", "080", "806"], "naranja, negro y gris");
  const mesa = a.porNodo.find((x) => x.id === "mesa")!;
  const mm = medida(mesa.caja);
  entre(mm.ancho, 120, 140, "ancho de la mesa con su mantel");
  entre(mm.alto, 75, 90, "alto de la mesa con las tarimas");
  assert.ok(mesa.caja.max.x < arco.caja.max.x && mesa.caja.min.x > arco.caja.min.x, "la mesa va entre las patas");
}

// 7. Foto 3: aro de ~1,6 m en la pared, anillo de fuera solo R-12 Eucalipto y de dentro R-9/R-5 mezclados.
{
  const { n: aro, escena } = nodoDe("halloween_aro_ojos", "aro");
  const m = medida(aro.caja);
  entre(m.ancho, 150, 180, "diámetro del aro (ancho)");
  entre(m.alto, 150, 180, "diámetro del aro (alto)");
  assert.ok(Math.abs(aro.caja.min.z + escena.sala.fondoCm / 2) < EPS, "el aro va pegado a la pared");
  const centro = { x: (aro.caja.min.x + aro.caja.max.x) / 2, y: (aro.caja.min.y + aro.caja.max.y) / 2 };
  const cuerpo = (g: (typeof aro.globos)[number]) => ({ x: g.nudo.x + g.direccion.x * (g.infladoCm / 2 + g.cuelloExtraCm), y: g.nudo.y + g.direccion.y * (g.infladoCm / 2 + g.cuelloExtraCm) });
  const radio = (g: (typeof aro.globos)[number]) => { const c = cuerpo(g); return Math.hypot(c.x - centro.x, c.y - centro.y); };
  const r12 = aro.globos.filter((g) => g.formatoId === "R-12");
  assert.ok(r12.length >= 18, `fila de R-12 por fuera (${r12.length})`);
  assert.ok(r12.every((g) => g.codigo === "027"), "los R-12 son Eucalipto");
  const medio = (l: typeof r12) => l.reduce((s, g) => s + radio(g), 0) / l.length;
  assert.ok(medio(r12) > medio(aro.globos.filter((g) => g.formatoId === "R-9")) + 10, "los R-12 van por fuera de los R-9");
  // El hueco del centro queda abierto (ahí van la araña chica y se ve la pared).
  const hueco = Math.min(...aro.globos.map((g) => radio(g) - g.infladoCm / 2));
  entre(hueco * 2, 35, 80, "hueco del centro (diámetro libre)");
}

// 8. Foto 4: árbol de ~2,5 m con montículo ancho y tronco fino.
{
  const { n: arbol } = nodoDe("halloween_arbol_fantasmas", "arbol");
  const m = medida(arbol.caja);
  entre(m.alto, 235, 260, "alto del árbol");
  entre(m.ancho, 125, 150, "ancho del montículo");
  const cuerpoX = (g: (typeof arbol.globos)[number]) => g.nudo.x + g.direccion.x * (g.infladoCm / 2 + g.cuelloExtraCm);
  const cx = (arbol.caja.min.x + arbol.caja.max.x) / 2;
  const arriba = arbol.globos.filter((g) => g.nudo.y > 120);
  const anchoTronco = Math.max(...arriba.map((g) => Math.abs(cuerpoX(g) - cx) + g.infladoCm / 2)) * 2;
  entre(anchoTronco, 35, 75, "ancho del tronco");
  assert.ok(arbol.globos.filter((g) => g.formatoId === "R-18").length >= 10, "el montículo lleva R-18");
}

// 9. Foto 5: media guirnalda en la pared, ~1,2 m de ancho y ~1,9 m de alto, con los tríos dorados en R-5.
{
  const { n: g, escena } = nodoDe("halloween_guirnalda_arana", "guirnalda");
  const m = medida(g.caja);
  entre(m.ancho, 105, 190, "ancho de la guirnalda");
  entre(m.alto, 180, 230, "alto de la guirnalda");
  assert.ok(Math.abs(g.caja.min.z + escena.sala.fondoCm / 2) < EPS, "pegada a la pared");
  assert.ok(g.globos.filter((x) => x.formatoId === "R-5").every((x) => x.codigo === "971"), "los R-5 son los dorados (Reflex Champaña)");
  assert.deepEqual([...codigos(g.globos)].sort(), ["062", "073", "880", "971"]);
}

console.log(`OK Halloween: ${resumen.join("; ")}`);
