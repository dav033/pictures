/**
 * Las 5 escenas de Halloween (fotos del dueño, 2026-10-07): estructuras orgánicas nuevas y escenografía. Sin coste:
 * no llama a ninguna IA.
 * - las 5 arman sin avisos y nada atraviesa el piso, las paredes ni el techo (los globos tampoco bajan del piso);
 * - medidas razonables frente a la foto (medidas por el tamaño de los globos): aro ~1,6 m de diámetro, arco
 *   rectangular ~2,6 × 2,6 m con los huecos de las calabazas, árbol ~2,5 m, guirnalda ~1,2 × 1,9 m, marco 2,4 m;
 * - cada globo es de un color que se fabrica en su formato y los colores son los medidos en la foto;
 * - la escenografía no da materiales y sus sólidos quedan donde va su pieza (mesas en el piso, fondo contra la pared);
 * - determinismo (dos armados iguales);
 * - las piezas pequeñas de cada foto (ojos, arañas, calabazas, manos, ramo, ramas, fantasmas, telarañas, el R-24 de
 *   remate) en su cantidad, apoyadas (≤ 3 cm de un globo, un tramo, la escenografía, el piso o la pared) y sin meterse en
 *   los globos, con colores que existen; y la colocación suelta (`libre`) que las pone.
 */
import assert from "node:assert/strict";
import { armarEscena, desplazamientoEntre, duplicarNodo, escenaEnIngles, moverNodo, type EscenaArmada, type NodoArmado, type Sala } from "../../src/lib/globos3d/escena";
import { ESCENAS_HALLOWEEN, ESCENAS_PREDEFINIDAS, escenaPredefinida } from "../../src/lib/globos3d/escenas-presets";
import { coloresDelFormato } from "../../src/lib/globos3d/formatos";
import { puntosSolido, type SolidoEscenografia } from "../../src/lib/globos3d/escenografia";
import { armarPieza, type Pieza } from "../../src/lib/globos3d/piezas";
import { centroCuerpo } from "../../src/lib/globos3d/geometria";
import type { Vec3 } from "../../src/lib/globos3d/modulos";

const EPS = 0.5;
const medida = (c: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } }) => ({ ancho: c.max.x - c.min.x, alto: c.max.y - c.min.y, fondo: c.max.z - c.min.z });
const entre = (v: number, a: number, b: number, que: string) => assert.ok(v >= a && v <= b, `${que}: ${v.toFixed(0)} cm (esperado ${a}–${b})`);

assert.equal(ESCENAS_HALLOWEEN.length, 5);
assert.deepEqual(ESCENAS_HALLOWEEN.map((p) => p.nombre), [
  "Halloween: marco orgánico con mesas", "Halloween: arco con calabazas", "Halloween: aro de ojos y arañas", "Halloween: árbol con fantasmas", "Halloween: guirnalda con araña",
]);
for (const p of ESCENAS_HALLOWEEN) assert.ok(ESCENAS_PREDEFINIDAS.includes(p), `${p.id} se ofrece en las escenas predefinidas`);

// ----------------------------------------------------------------------------------------------------------
// Contacto: cada globo es una esfera (centrada donde su perfil es más ancho) y cada tramo, segmentos con su grosor.
// ----------------------------------------------------------------------------------------------------------

/** Una esfera (cuerpo de globo) o un punto de un tramo con su radio. */
type Bola = { c: Vec3; r: number };
/** Un tramo (tubito o papel) como segmentos con su radio. */
type Segmento = { a: Vec3; b: Vec3; r: number };
type Soporte = { bolas: Bola[]; segmentos: Segmento[]; solidos: SolidoEscenografia[]; sala: Sala };

const resta = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const punto = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const largo = (a: Vec3) => Math.hypot(a.x, a.y, a.z);

function cuerpoDe(g: { nudo: Vec3; direccion: Vec3; infladoCm: number; cuelloExtraCm: number }): Bola {
  // El cuerpo es casi una esfera de radio d/2 centrada donde el perfil es más ancho (no a d/2 del nudo).
  const l = centroCuerpo("redondo", g.infladoCm) + g.cuelloExtraCm;
  return { c: { x: g.nudo.x + g.direccion.x * l, y: g.nudo.y + g.direccion.y * l, z: g.nudo.z + g.direccion.z * l }, r: g.infladoCm / 2 };
}

function segmentosDe(n: Pick<NodoArmado, "tubos">): Segmento[] {
  const salida: Segmento[] = [];
  for (const t of n.tubos) {
    const pts = t.cerrado ? [...t.puntos, t.puntos[0]!] : t.puntos;
    for (let i = 0; i + 1 < pts.length; i++) salida.push({ a: pts[i]!, b: pts[i + 1]!, r: t.grosorCm / 2 });
  }
  return salida;
}

/** Puntos de muestra de una pieza: el cuerpo de cada globo y puntos cada ~2 cm a lo largo de sus tramos. */
function muestrasDe(n: Pick<NodoArmado, "globos" | "tubos">): { bolas: Bola[]; puntos: Bola[] } {
  const puntos: Bola[] = [];
  for (const s of segmentosDe(n)) {
    const d = resta(s.b, s.a), pasos = Math.max(1, Math.ceil(largo(d) / 2));
    for (let i = 0; i <= pasos; i++) puntos.push({ c: { x: s.a.x + (d.x * i) / pasos, y: s.a.y + (d.y * i) / pasos, z: s.a.z + (d.z * i) / pasos }, r: s.r });
  }
  return { bolas: n.globos.map(cuerpoDe), puntos };
}

function aSegmento(p: Vec3, s: Segmento): number {
  const d = resta(s.b, s.a), l2 = punto(d, d);
  const t = l2 > 0 ? Math.max(0, Math.min(1, punto(resta(p, s.a), d) / l2)) : 0;
  return largo(resta(p, { x: s.a.x + d.x * t, y: s.a.y + d.y * t, z: s.a.z + d.z * t }));
}

function aPoligono(x: number, y: number, contorno: ReadonlyArray<{ x: number; y: number }>): { dentro: boolean; borde: number } {
  let dentro = false, borde = Infinity;
  for (let i = 0, j = contorno.length - 1; i < contorno.length; j = i++) {
    const a = contorno[i]!, b = contorno[j]!;
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) dentro = !dentro;
    const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / l2)) : 0;
    borde = Math.min(borde, Math.hypot(x - a.x - dx * t, y - a.y - dy * t));
  }
  return { dentro, borde };
}

/** Distancia con signo de un punto a un sólido de escenografía (negativa dentro). */
function aSolido(p: Vec3, s: SolidoEscenografia): number {
  const q = resta(p, s.origen);
  const l = { x: punto(q, s.ejeX), y: punto(q, s.ejeY), z: punto(q, s.ejeZ) };
  const combinar = (a: number, b: number) => (a <= 0 && b <= 0 ? Math.max(a, b) : Math.hypot(Math.max(a, 0), Math.max(b, 0)));
  if (s.forma === "caja") {
    const d = { x: Math.abs(l.x) - s.tamano.x / 2, y: Math.abs(l.y) - s.tamano.y / 2, z: Math.abs(l.z) - s.tamano.z / 2 };
    const fuera = Math.hypot(Math.max(d.x, 0), Math.max(d.y, 0), Math.max(d.z, 0));
    return fuera > 0 ? fuera : Math.max(d.x, d.y, d.z);
  }
  if (s.forma === "cilindro") {
    const t = Math.max(0, Math.min(1, l.y / s.altoCm));
    const radio = s.radioCm + (s.radioArribaCm - s.radioCm) * t;
    return combinar(Math.hypot(l.x, l.z) - radio, Math.max(-l.y, l.y - s.altoCm));
  }
  const c = aPoligono(l.x, l.y, s.contorno);
  let dentro = c.dentro, borde = c.borde;
  for (const h of s.huecos) { const e = aPoligono(l.x, l.y, h); if (e.dentro) dentro = false; borde = Math.min(borde, e.borde); }
  return combinar(dentro ? -borde : borde, Math.max(-l.z, l.z - s.grosorCm));
}

/** Lo que sostiene: los globos, tramos y sólidos de los nodos dados, más el piso y la pared del fondo. */
function soporteDe(a: EscenaArmada, ids: ReadonlySet<string>): Soporte {
  const nodos = a.porNodo.filter((n) => ids.has(n.id));
  return { bolas: nodos.flatMap((n) => n.globos.map(cuerpoDe)), segmentos: nodos.flatMap(segmentosDe), solidos: nodos.flatMap((n) => n.solidos), sala: a.sala };
}

/** Holgura (cm) de una esfera de la pieza a lo que sostiene: > 0 separada, < 0 metida. */
function holgura(b: Bola, s: Soporte): number {
  let h = Math.min(b.c.y - b.r, b.c.z - b.r + s.sala.fondoCm / 2);
  for (const o of s.bolas) h = Math.min(h, largo(resta(b.c, o.c)) - b.r - o.r);
  for (const g of s.segmentos) h = Math.min(h, aSegmento(b.c, g) - b.r - g.r);
  for (const x of s.solidos) h = Math.min(h, aSolido(b.c, x) - b.r);
  return h;
}

/** Cuánto le falta a la pieza para tocar (la menor holgura) y cuánto se mete (lo peor de sus globos y de sus tramos). */
function contacto(n: Pick<NodoArmado, "globos" | "tubos">, s: Soporte) {
  const m = muestrasDe(n);
  const hb = m.bolas.map((b) => ({ b, h: holgura(b, s) }));
  const hp = m.puntos.map((b) => ({ b, h: holgura(b, s) }));
  const todas = [...hb, ...hp].map((x) => x.h);
  const minimo = Math.min(...todas);
  // Globo de la pieza metido: más de un tercio de su radio dentro de otro globo o de una superficie.
  const globoMetido = Math.max(0, ...hb.map(({ b, h }) => -h / b.r));
  // Tramos metidos: fracción de los puntos con el eje del tramo dentro de algo (más que su propio radio).
  const puntosDentro = hp.length ? hp.filter(({ b, h }) => h < -2 * b.r).length / hp.length : 0;
  return { minimo, globoMetido, puntosDentro };
}

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

// 10. Las piezas pequeñas de cada foto, en su cantidad, apoyadas (a ≤ 3 cm de un globo, un tramo, la escenografía, el
// piso o la pared) y sin meterse (ningún globo suyo con más de un tercio del radio dentro de algo, y casi ningún
// punto de sus tramos con el eje dentro de algo); colores que existen en su formato.
type Conteo = Record<string, number>;
const PEQUENAS: Record<string, Conteo> = {
  halloween_marco_mesas: { ramo_helio: 1, racimo_ojos: 4, mano: 2, arana: 2, telarana: 1, fantasma: 3 },
  halloween_arco_calabazas: { calabaza: 2, globo: 1, calabaza_bruja: 1 },
  halloween_aro_ojos: { ojo: 14, arana: 2 },
  halloween_arbol_fantasmas: { arbol_trenzado: 1, ojo: 2, fantasma: 4 },
  halloween_guirnalda_arana: { arana: 1, telarana: 1 },
};
const esPequena = (pieza: Pieza) => pieza.tipo === "decoracion" || pieza.tipo === "globo";
const tipoPequena = (pieza: Pieza) => (pieza.tipo === "decoracion" ? pieza.decoracion.tipo : pieza.tipo);
const tiposVistos = new Set<string>();
const apoyos: string[] = [];
for (const p of ESCENAS_HALLOWEEN) {
  const escena = escenaPredefinida(p.id);
  const a = armarEscena(escena);
  const pequenas = escena.nodos.filter((n) => esPequena(n.pieza));
  const conteo: Conteo = {};
  for (const n of pequenas) { const t = tipoPequena(n.pieza); conteo[t] = (conteo[t] ?? 0) + 1; tiposVistos.add(t); }
  assert.deepEqual(conteo, PEQUENAS[p.id], `${p.id}: piezas pequeñas de la foto`);
  let peor = { minimo: -Infinity, id: "" };
  for (const n of pequenas) {
    const hecho = a.porNodo.find((x) => x.id === n.id)!;
    assert.equal(hecho.copias, 1, `${p.id}/${n.id}: se puso una vez`);
    const c = contacto(hecho, soporteDe(a, new Set(a.porNodo.filter((x) => x.id !== n.id).map((x) => x.id))));
    assert.ok(c.minimo <= 3, `${p.id}/${n.id}: flota (${c.minimo.toFixed(1)} cm de lo más cercano)`);
    assert.ok(c.globoMetido <= 0.34, `${p.id}/${n.id}: un globo se mete ${(c.globoMetido * 100).toFixed(0)} % de su radio`);
    assert.ok(c.puntosDentro <= 0.15, `${p.id}/${n.id}: ${(c.puntosDentro * 100).toFixed(0)} % de sus tramos quedan dentro de algo`);
    if (c.minimo > peor.minimo) peor = { minimo: c.minimo, id: n.id };
    for (const g of hecho.globos) assert.ok(coloresDelFormato(g.formatoId).some((x) => x.codigo === g.codigo), `${p.id}/${n.id}: el ${g.codigo} no se fabrica en ${g.formatoId}`);
    for (const t of hecho.tubos) if (!t.papel) assert.ok(coloresDelFormato(t.formatoId).some((x) => x.codigo === t.codigo), `${p.id}/${n.id}: el ${t.codigo} no se fabrica en ${t.formatoId}`);
    for (const m of hecho.materiales) assert.ok(m.formatoId !== "papel" && coloresDelFormato(m.formatoId).some((x) => x.codigo === m.codigo), `${p.id}/${n.id}: material ${m.formatoId} ${m.codigo}`);
  }
  apoyos.push(`${p.id.replace("halloween_", "")} ${pequenas.length} piezas (la más suelta a ${peor.minimo.toFixed(1)} cm: ${peor.id})`);
}
assert.deepEqual([...tiposVistos].sort(), ["arana", "arbol_trenzado", "calabaza", "calabaza_bruja", "fantasma", "globo", "mano", "ojo", "racimo_ojos", "ramo_helio", "telarana"], "todas las piezas de Halloween salen en alguna escena");

// 11. Lo particular de cada una.
{
  // Foto 2: el remate es un R-24 Naranja suelto y cotiza como uno; las calabazas quedan en los huecos, asomadas.
  const { a } = nodoDe("halloween_arco_calabazas", "arco");
  const remate = a.porNodo.find((x) => x.id === "globo-remate")!;
  assert.deepEqual(remate.materiales.map((m) => [m.formatoId, m.codigo, m.cantidad]), [["R-24", "061", 1]], "el remate es un R-24 Naranja");
  const arco = a.porNodo.find((x) => x.id === "arco")!;
  assert.ok(cuerpoDe(remate.globos[0]!).c.y > arco.caja.max.y - 10, "el remate va encima del travesaño");
  for (const id of ["calabaza-izq", "calabaza-der"]) {
    const c = cuerpoDe(a.porNodo.find((x) => x.id === id)!.globos[0]!).c;
    entre(c.y, 80, 100, `altura de la ${id}`);
    entre(Math.abs(c.x), 90, 105, `${id} en el eje de la pata`);
  }
  const bruja = a.porNodo.find((x) => x.id === "bruja")!;
  entre(bruja.caja.min.y, 70, 80, "la bruja de pie sobre la mesa");
}
{
  // Foto 3: los ojos van en la cara del aro, por el arco de arriba de dentro, y miran al frente.
  const { a } = nodoDe("halloween_aro_ojos", "aro");
  const ojos = a.porNodo.filter((x) => x.id.startsWith("ojo-")).map((x) => x.globos[0]!);
  for (const g of ojos) {
    const c = cuerpoDe(g).c;
    const radio = Math.hypot(c.x, c.y - 149.6), angulo = (Math.atan2(c.y - 149.6, c.x) * 180) / Math.PI;
    entre(radio, 35, 58, "radio del ojo en el aro");
    entre(angulo, 10, 172, "ángulo del ojo (arco de arriba)");
    assert.ok(g.direccion.z > 0.99 && g.estampado?.capas.some((k) => k.hex === "#c3262e"), "ojo de frente con iris rojo");
  }
}
{
  // Foto 4: solo ramas (4, trenzadas de a dos, sin base ni copa) que nacen en la cara del tronco; ojos con ceja.
  const { a } = nodoDe("halloween_arbol_fantasmas", "arbol");
  const ramas = a.porNodo.find((x) => x.id === "ramas")!;
  assert.equal(ramas.globos.length, 0, "las ramas no traen base ni copa");
  assert.equal(ramas.tubos.length, 4 * 2 + 4 * 3, "4 ramas trenzadas de a dos con 3 ramitas");
  assert.deepEqual(ramas.materiales.map((m) => [m.formatoId, m.codigo]), [["T-260", "076"]], "las ramas son de T-260 Chocolate");
  entre(ramas.materiales[0]!.cantidad, 6, 20, "T-260 de las ramas (se cuentan por largo)");
  for (const t of ramas.tubos.filter((x) => x.puntos.length > 2)) {
    const inicio = t.puntos[0]!;
    entre(Math.hypot(inicio.x - 1, inicio.z + 61), 12, 22, "la rama nace en la cara del tronco");
  }
  const alturas = ramas.tubos.filter((x) => x.puntos.length > 2).map((t) => t.puntos[0]!.y);
  assert.ok(alturas.some((y) => Math.abs(y - 172) < 4) && alturas.some((y) => Math.abs(y - 106) < 4), "ramas a 1,72 y 1,06 m");
  for (const id of ["ojo-izq", "ojo-der"]) assert.equal(a.porNodo.find((x) => x.id === id)!.globos[0]!.estampado!.capas.length, 3, `${id}: pupila, brillo y ceja`);
}

// 12. La colocación suelta: el origen va al punto pedido, se mueve en x, y, z sin salir de la sala y se duplica al lado.
{
  const escena = escenaPredefinida("halloween_aro_ojos");
  const a = armarEscena(escena);
  const antes = escena.nodos.find((n) => n.id === "arana-grande")!.colocacion;
  const movida = moverNodo(escena, "arana-grande", { x: 7, y: -12, z: 4 }, { armada: a });
  const despues = movida.nodos.find((n) => n.id === "arana-grande")!.colocacion;
  assert.ok(antes.en === "libre" && despues.en === "libre");
  // El imán deja el origen en múltiplos de 5 cm: (43, 108, −107,5) + (7, −12, 4) → (50, 95, −105).
  assert.deepEqual([despues.xCm, despues.yCm, despues.zCm], [50, 95, -105], "con imán de 5 cm");
  assert.deepEqual(desplazamientoEntre(escena.sala, antes, despues), { x: 7, y: -13, z: 2.5 }, "lo dibujado se corre lo mismo");
  const alTecho = moverNodo(escena, "arana-grande", { x: 0, y: 900, z: 0 }, { armada: a });
  const nodoAlTecho = armarEscena(alTecho).porNodo.find((n) => n.id === "arana-grande")!;
  assert.ok(nodoAlTecho.caja.max.y <= escena.sala.altoCm + EPS, "no se sale por el techo");
  const ids = new Set(escena.nodos.map((n) => n.id));
  const copia = duplicarNodo(escena, "ojo-1").nodos.find((n) => !ids.has(n.id))!;
  assert.ok(copia.colocacion.en === "libre" && copia.pieza.tipo === "decoracion");
  assert.match(escenaEnIngles(escena, a), /set on the arrangement/);
}

console.log(`OK Halloween: ${resumen.join("; ")}. Piezas pequeñas apoyadas: ${apoyos.join("; ")}`);
