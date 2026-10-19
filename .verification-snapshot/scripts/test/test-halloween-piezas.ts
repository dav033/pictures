/**
 * Piezas de Halloween (las 5 fotos del dueño) del taller 3D. Sin coste: no llama a ninguna IA.
 * - cada predefinida arma; sus globos y tubitos usan colores que existen en su formato; el papel no cuenta en los
 *   materiales y el fantasma y la telaraña no llevan globos;
 * - medidas razonables (un ojo de un R-9, una calabaza R-24 de ~55 cm, un árbol de ~1,9 m…) y todo numérico;
 * - lo impreso: los ojos llevan iris/pupila (y venas), la calabaza su cara; todo dentro del globo;
 * - determinismo: armar dos veces da lo mismo; quedan en el grupo «Halloween» con miniatura; las de pie quedan
 *   derechas en el piso de la escena y la de la pared, de frente.
 */
import assert from "node:assert/strict";
import { DECORACIONES_PREDEFINIDAS, armarDecoracion, decoracionEnIngles, decoracionPredefinida } from "../../src/lib/globos3d/figuras";
import { HALLOWEEN_PREDEFINIDAS, esDePie, esHalloween, armarArana, armarMano, armarTelarana } from "../../src/lib/globos3d/halloween";
import { coloresDelFormato, formatoPorId } from "../../src/lib/globos3d/formatos";
import { agregarDecoracion, decoracionesPorGrupo, miniaturaDecoracion } from "../../src/lib/globos3d/decoraciones-escena";
import { armarEscena, SALA_INICIAL, type Escena } from "../../src/lib/globos3d/escena";

const existe = (formatoId: string, codigo: string) => coloresDelFormato(formatoId).some((c) => c.codigo === codigo);
const finito = (v: { x: number; y: number; z: number }) => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);

// 1. Todas registradas como predefinidas, una vez, y en el grupo «Halloween».
const ids = HALLOWEEN_PREDEFINIDAS.map((d) => d.id);
assert.ok(ids.length >= 13, `13 piezas (${ids.length})`);
for (const id of ids) assert.equal(DECORACIONES_PREDEFINIDAS.filter((d) => d.id === id).length, 1, `${id}: está en DECORACIONES_PREDEFINIDAS una vez`);
const grupo = decoracionesPorGrupo().find((g) => g.id === "halloween");
assert.ok(grupo, "hay grupo Halloween");
assert.equal(grupo.nombre, "Halloween");
assert.deepEqual(grupo.decoraciones.map((d) => d.id), ids, "el grupo lleva todas, en su orden");
for (const tipo of ["ojo", "racimo_ojos", "arana", "calabaza", "calabaza_bruja", "mano", "ramo_helio", "arbol_trenzado", "fantasma", "telarana"]) {
  assert.ok(HALLOWEEN_PREDEFINIDAS.some((d) => d.decoracion.tipo === tipo), `hay una predefinida de ${tipo}`);
}

// 2. Cada pieza arma, con colores reales, números finitos y medidas razonables.
const medidas: Record<string, [number, number]> = {
  ojo_venas: [15, 22], ojo_salton: [15, 22], ojos_saltones: [35, 75], ojos_venas: [30, 70],
  arana_articulada: [50, 110], arana_lazos: [50, 110], calabaza_grande: [55, 110], calabaza_bruja: [70, 130],
  mano_verde: [40, 90], ramo_helio: [150, 210], arbol_trenzado: [170, 240], fantasma: [50, 100], telarana: [65, 90],
};
for (const p of HALLOWEEN_PREDEFINIDAS) {
  const a = armarDecoracion(p.decoracion);
  assert.ok(esHalloween(p.decoracion));
  for (const g of a.globos) {
    assert.ok(existe(g.formatoId, g.codigo), `${p.id}: ${g.codigo} no existe en ${g.formatoId}`);
    assert.ok(g.infladoCm <= formatoPorId(g.formatoId)!.diametroMaxCm && g.infladoCm >= formatoPorId(g.formatoId)!.diametroMaxCm * 0.4, `${p.id}: inflado de ${g.formatoId} dentro de su rango (${g.infladoCm})`);
    assert.ok(finito(g.nudo) && finito(g.direccion), `${p.id}: globo con números`);
    assert.ok(Math.abs(Math.hypot(g.direccion.x, g.direccion.y, g.direccion.z) - 1) < 1e-6, `${p.id}: dirección unitaria`);
    if (g.estampado) {
      assert.ok(g.frente, `${p.id}: lo impreso necesita frente`);
      const r = g.infladoCm / 2;
      for (const c of g.estampado.capas) {
        assert.match(c.hex, /^#[0-9a-f]{6}$/i);
        assert.ok(c.puntos.length >= 3, `${p.id}: polígono`);
        // Lo impreso cabe en la media esfera que se ve (medido sobre la superficie: menos de ~0,6·π·r).
        for (const [u, v] of c.puntos) assert.ok(Math.hypot(u, v) < r * 1.9, `${p.id}: lo impreso queda sobre el globo`);
      }
    }
  }
  for (const t of a.tubos) {
    assert.ok(t.puntos.length >= 2 && t.puntos.every(finito), `${p.id}: tramo con puntos`);
    if (t.papel) { assert.match(t.papel.hex, /^#[0-9a-f]{6}$/i); continue; }
    assert.equal(formatoPorId(t.formatoId)?.tipo, "tubito", `${p.id}: los tramos de globo son de tubito`);
    assert.ok(existe(t.formatoId, t.codigo), `${p.id}: ${t.codigo} no existe en ${t.formatoId}`);
    assert.ok(t.grosorCm <= formatoPorId(t.formatoId)!.diametroMaxCm, `${p.id}: tubito más grueso que su máximo`);
  }
  // El papel no se cotiza: los materiales son solo globos y tubitos, con colores reales.
  for (const m of a.materiales) {
    assert.notEqual(m.formatoId, "papel", `${p.id}: el papel no es material`);
    assert.ok(existe(m.formatoId, m.codigo), `${p.id}: material ${m.formatoId} ${m.codigo}`);
    assert.ok(m.cantidad > 0 && Number.isInteger(m.cantidad));
  }
  const [min, max] = medidas[p.id] ?? [5, 300];
  assert.ok(a.diametroCm >= min && a.diametroCm <= max, `${p.id}: diámetro de frente ${a.diametroCm} cm (esperado ${min}–${max})`);
  assert.ok(a.fondoCm >= 0 && Number.isFinite(a.fondoCm));
  // Determinista: dos veces lo mismo.
  assert.deepEqual(armarDecoracion(structuredClone(p.decoracion)), a, `${p.id}: determinista`);
  assert.match(decoracionEnIngles(p.decoracion), /^an? /, `${p.id}: en inglés para la foto`);
  // Miniatura: dibuja algo, con lo impreso de frente donde lo hay.
  const mini = miniaturaDecoracion(p.decoracion);
  assert.ok(mini.formas.length > 0 && mini.caja.ancho > 0, `${p.id}: miniatura`);
}

// 3. Cada una, en lo suyo.
const cuenta = (id: string) => armarDecoracion(decoracionPredefinida(id));
// Ojos: el de venas lleva venas + iris + pupila + brillo; el saltón pupila + brillo; todos R-9 Blanco.
const venas = cuenta("ojo_venas");
assert.equal(venas.globos.length, 1);
assert.equal(venas.globos[0]!.codigo, "005");
assert.equal(venas.globos[0]!.estampado!.capas.length, 7 + 3);
assert.equal(venas.globos[0]!.estampado!.en, "punta", "el ojo mira hacia quien ve: lo impreso va en la punta");
assert.ok(venas.globos[0]!.direccion.y > 0.99, "el globo del ojo apunta al frente (nudo detrás)");
assert.equal(cuenta("ojo_salton").globos[0]!.estampado!.capas.length, 2);
// Racimos: 4 y 5 ojos de tamaños mezclados, que no se montan.
for (const [id, n] of [["ojos_saltones", 4], ["ojos_venas", 5]] as const) {
  const r = cuenta(id);
  assert.equal(r.globos.length, n, `${id}: ${n} ojos`);
  assert.ok(new Set(r.globos.map((g) => g.formatoId)).size >= 2, `${id}: tamaños mezclados`);
  assert.ok(r.globos.every((g) => g.estampado), `${id}: todos con ojo impreso`);
}
// Arañas: cuerpo y cabeza negros; 8 patas (3 burbujas por pata articulada, 1 lazo por pata en la de lazos).
const articulada = cuenta("arana_articulada");
assert.equal(articulada.globos.length, 2);
assert.ok(articulada.globos.every((g) => g.codigo === "080"));
assert.equal(articulada.tubos.length, 24);
assert.equal(cuenta("arana_lazos").tubos.length, 8);
const izquierda = (t: { puntos: Array<{ x: number }> }) => t.puntos.reduce((s, q) => s + q.x, 0) > 0;
assert.equal(articulada.tubos.filter(izquierda).length, 12, "4 patas por lado");
assert.ok(articulada.materiales.some((m) => m.formatoId === "T-260" && m.codigo === "080"));
const sinOjos = armarArana({ cuerpo: { formatoId: "R-12", infladoCm: 24, codigo: "080" }, cabeza: { formatoId: "R-9", infladoCm: 15, codigo: "080" }, ojos: null, patas: { formatoId: "T-260", grosorCm: 3.5, codigo: "080", largoCm: 30, estilo: "articuladas" }, giroGrados: 90 });
assert.ok(!sinOjos.globos.some((g) => g.estampado), "sin ojos: cabeza lisa");
// Calabaza: R-24 Naranja con cara (4 polígonos) y tallo de T-260 Verde Lima + zarcillos de T-160.
const calabaza = cuenta("calabaza_grande");
assert.equal(calabaza.globos.length, 1);
assert.deepEqual([calabaza.globos[0]!.formatoId, calabaza.globos[0]!.codigo], ["R-24", "061"]);
assert.equal(calabaza.globos[0]!.estampado!.en, "cara");
assert.equal(calabaza.globos[0]!.estampado!.capas.length, 4);
assert.ok(calabaza.tubos.some((t) => t.formatoId === "T-160") && calabaza.tubos.filter((t) => t.formatoId === "T-260").length === 7, "tallo + 6 lazos + zarcillos");
const topeCalabaza = Math.max(...calabaza.globos.map((g) => g.nudo.z + g.direccion.z * 60));
assert.ok(calabaza.tubos.every((t) => t.puntos.every((q) => q.z > topeCalabaza - 70)), "el tallo va arriba");
// Calabaza bruja: cabeza naranja arriba del cuerpo negro, cuello de 6 R-5 Gris, sombrero de papel arriba de todo.
const bruja = cuenta("calabaza_bruja");
assert.equal(bruja.globos.filter((g) => g.formatoId === "R-5" && g.codigo === "081").length, 6);
const cabeza = bruja.globos.find((g) => g.codigo === "061")!, cuerpo = bruja.globos.find((g) => g.codigo === "080")!;
assert.ok(cabeza.nudo.z > cuerpo.nudo.z + 20, "la cabeza va encima del cuerpo");
const papelBruja = bruja.tubos.filter((t) => t.papel);
assert.ok(papelBruja.length >= 10 && Math.min(...papelBruja.flatMap((t) => t.puntos.map((q) => q.z))) > cabeza.nudo.z + 15, "sombrero de papel sobre la cabeza");
assert.ok(!bruja.materiales.some((m) => m.formatoId === "papel"));
// Mano: 4 dedos + pulgar en 2 burbujas, palma de 3 y muñeca; con giro se gira sin cambiar materiales.
const mano = cuenta("mano_verde");
assert.equal(mano.tubos.length, 3 + 1 + 5 * 2);
assert.ok(mano.tubos.every((t) => t.codigo === "031"));
const manoGirada = armarMano({ formatoId: "T-260", grosorCm: 4.5, codigo: "031", dedos: 4, largoDedoCm: 24, aberturaGrados: 6, garra: false, giroGrados: 90 });
assert.equal(manoGirada.tubos.length, 3 + 1 + 4 * 2);
// Ramo de helio: 9 R-12, una cinta (papel) por globo que baja al peso y el peso; globos arriba, peso en el piso.
const ramo = cuenta("ramo_helio");
assert.equal(ramo.globos.length, 9);
assert.equal(ramo.tubos.filter((t) => t.papel).length, 10);
assert.equal(ramo.materiales.reduce((s, m) => s + m.cantidad, 0), 9, "solo cotizan los 9 globos");
assert.ok(ramo.globos.every((g) => g.nudo.z > 40), "los globos flotan arriba de las cintas");
assert.ok(Math.min(...ramo.tubos.flatMap((t) => t.puntos.map((q) => q.z))) < 5, "el peso queda en el piso");
// Árbol: base de R-12 Chocolate, tronco de 5 T-260 Chocolate, cintas Reflex Dorado/Champaña, ramas trenzadas, ojos.
const arbol = cuenta("arbol_trenzado");
const altoArbol = Math.max(...arbol.globos.map((g) => g.nudo.z + g.infladoCm), ...arbol.tubos.flatMap((t) => t.puntos.map((q) => q.z)));
assert.ok(altoArbol > 175 && altoArbol < 215, `árbol de ~1,9 m (${altoArbol.toFixed(0)} cm)`);
assert.ok(arbol.materiales.some((m) => m.formatoId === "T-260" && m.codigo === "076" && m.cantidad >= 5));
assert.ok(arbol.materiales.some((m) => m.codigo === "970") && arbol.materiales.some((m) => m.codigo === "971"));
assert.ok(arbol.materiales.some((m) => m.formatoId === "R-12" && m.codigo === "076"));
assert.equal(arbol.globos.filter((g) => g.estampado).length, 2, "dos ojos bravos");
// Papel: fantasma y telaraña no llevan globos ni materiales.
for (const id of ["fantasma", "telarana"]) {
  const a = cuenta(id);
  assert.equal(a.globos.length, 0, `${id}: no es globo`);
  assert.equal(a.materiales.length, 0, `${id}: no se cotiza`);
  assert.ok(a.tubos.every((t) => t.papel), `${id}: todo de papel`);
}
assert.ok(cuenta("fantasma").tubos.some((t) => t.papel?.relleno && t.cerrado), "la silueta del fantasma va rellena");
const tela = armarTelarana({ radioCm: 40, radios: 8, anillos: 4, hex: "#111111", grosorCm: 0.4 });
assert.equal(tela.tubos.length, 8 + 4);
assert.ok(tela.tubos.every((t) => t.puntos.every((q) => Math.abs(q.y) < 1e-9)), "telaraña plana");
assert.ok(Math.max(...tela.tubos.flatMap((t) => t.puntos.map((q) => Math.hypot(q.x, q.z)))) <= 40 + 1e-6, "dentro de su radio");

// 4. En la escena: las de pie quedan derechas en el piso (más altas que anchas de fondo), la mano en la pared de frente.
const vacia: Escena = { sala: SALA_INICIAL, nodos: [] };
assert.ok(esDePie(decoracionPredefinida("arbol_trenzado")) && !esDePie(decoracionPredefinida("mano_verde")));
const conArbol = agregarDecoracion(vacia, decoracionPredefinida("arbol_trenzado"), { en: "piso" });
const nodoArbol = armarEscena(conArbol.escena).porNodo[0]!;
const altoEnSala = nodoArbol.caja.max.y - nodoArbol.caja.min.y, fondoEnSala = nodoArbol.caja.max.z - nodoArbol.caja.min.z;
assert.ok(Math.abs(nodoArbol.caja.min.y) < 0.5 && altoEnSala > 170 && fondoEnSala < altoEnSala * 0.7, `el árbol queda de pie en el piso (${altoEnSala.toFixed(0)} de alto, ${fondoEnSala.toFixed(0)} de fondo)`);
const conCalabaza = agregarDecoracion(vacia, decoracionPredefinida("calabaza_bruja"), { en: "techo" });
assert.equal(conCalabaza.escena.nodos[0]!.colocacion.en === "techo" && conCalabaza.escena.nodos[0]!.colocacion.volteada, false, "colgada del techo, derecha");
const conMano = agregarDecoracion(vacia, decoracionPredefinida("mano_verde"), { en: "pared" });
const nodoMano = armarEscena(conMano.escena).porNodo[0]!;
assert.ok(nodoMano.caja.min.z >= -SALA_INICIAL.fondoCm / 2 - 0.5 && nodoMano.caja.max.y - nodoMano.caja.min.y > 40, "la mano queda pegada a la pared, de frente");
// Lo impreso viaja con el globo a la escena (el visor lo pinta) y la cara mira al salón.
const conOjo = agregarDecoracion(vacia, decoracionPredefinida("ojo_venas"), { en: "pared" });
const ojo = armarEscena(conOjo.escena).globos[0]!;
assert.ok(ojo.estampado && ojo.direccion.z > 0.99, "en la pared el ojo mira al salón");

console.log(`OK test-halloween-piezas: ${ids.length} piezas de Halloween (${[...new Set(HALLOWEEN_PREDEFINIDAS.map((d) => d.decoracion.tipo))].join(", ")}) con colores reales, papel fuera de los materiales, medidas razonables, deterministas y en el grupo Halloween`);
