/**
 * Rizos de tubito (`rizos.ts`) y globo burbuja (`burbujas.ts`), y las ideas del lote 06. Sin coste: no llama a ninguna
 * IA ni a la red.
 * - cada rizo predefinido (y cada forma) arma: tubos con puntos finitos, materiales de tubito, miniatura de frente, y
 *   entra en «Decoraciones pequeñas» en el grupo «Rizos y tubitos» (las burbujas, en «Globos burbuja»);
 * - el tirabuzón y el resorte siguen su espiral: cada punto a su radio (de radioInicial a radioFinal) del eje y la curva
 *   da exactamente las vueltas pedidas; sus espiras no se montan (paso ≥ grosor); la voluta es plana y sus espiras no se
 *   montan;
 * - las burbujas en cadena se tocan: las puntas redondas de dos burbujas vecinas llegan a la misma torcedura (la
 *   distancia entre sus ejes no pasa de un grosor), en recta, en aro (que cierra) y en estrella; el aro de 5 es un
 *   pentágono con lados del largo pedido;
 * - los flecos cuelgan (todo por debajo del amarre) y el penacho abre sus rizos en el cono pedido;
 * - los globos de adentro de una burbuja quedan dentro del exterior sin atravesarlo (todo su perfil torneado, nudo
 *   incluido, medido en 36 giros contra el perfil del exterior) y sin montarse entre ellos más que el apriete; el
 *   confeti y las plumas, dentro también; el doble globo cabe entero;
 * - determinismo: armar dos veces da lo mismo, y otra semilla cambia el reparto pero no cuántos entran;
 * - lote 06: 6–8 ideas, cada una con su foto (CDN de Sempertex), ocasiones de sus etiquetas, productos con nombre y url
 *   de la tienda (los que publica la ficha, tal cual), que dependen de rizos o burbujas y arman sin avisos.
 */
import assert from "node:assert/strict";
import { armarRizo, direccionesPenacho, RIZOS_PREDEFINIDOS, type PropiedadesRizo } from "../../src/lib/globos3d/rizos";
import { APRIETE, armarBurbuja, BURBUJAS_PREDEFINIDAS, cuerpoDeInterior, PARED_BURBUJA_CM, puntoDentro, radioDelPerfil, type PropiedadesBurbuja } from "../../src/lib/globos3d/burbujas";
import { armarDecoracion, DECORACIONES_PREDEFINIDAS, type Decoracion } from "../../src/lib/globos3d/figuras";
import { decoracionesPorGrupo, miniaturaDecoracion } from "../../src/lib/globos3d/decoraciones-escena";
import { perfilRedondo } from "../../src/lib/globos3d/geometria";
import type { Vec3 } from "../../src/lib/globos3d/modulos";
import type { GloboDecoracion, TuboDecoracion } from "../../src/lib/globos3d/decoraciones";
import { IDEAS_SEMPERTEX } from "../../src/lib/globos3d/ideas-sempertex";
import { fuenteIdea } from "../../src/lib/globos3d/ideas-sempertex/fuentes";
import { armarEscena } from "../../src/lib/globos3d/escena";
import { armarPieza } from "../../src/lib/globos3d/piezas";
import { GLOBOS_TIENDA } from "../../src/lib/globos3d/productos-tienda";
import { OCASIONES } from "../../src/lib/globos3d/biblioteca";

const d3 = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const finito = (p: Vec3) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);

// ----------------------------------------------------------------------------------------------------------
// 1. Cada rizo arma
// ----------------------------------------------------------------------------------------------------------

const formas = new Set<string>();
for (const r of RIZOS_PREDEFINIDOS) {
  const a = armarRizo(r.decoracion.propiedades);
  formas.add(r.decoracion.propiedades.forma);
  assert.ok(a.tubos.length > 0, `${r.id}: tiene tubitos`);
  for (const t of a.tubos) {
    assert.ok(t.puntos.length >= 3 && t.puntos.every(finito), `${r.id}: puntos finitos`);
    assert.ok(t.grosorCm > 0 && /^T-/.test(t.formatoId) && !t.papel, `${r.id}: es tubito de látex`);
  }
  assert.ok(a.materiales.length > 0 && a.materiales.every((m) => m.cantidad >= 1 && /^T-/.test(m.formatoId)), `${r.id}: materiales de tubito`);
  const dec = armarDecoracion(r.decoracion);
  assert.deepEqual(dec.materiales, a.materiales, `${r.id}: armarDecoracion cotiza igual`);
  assert.ok(dec.diametroCm > 0, `${r.id}: diámetro`);
  const mini = miniaturaDecoracion(r.decoracion);
  assert.ok(mini.formas.length === a.tubos.length && mini.caja.ancho > 0, `${r.id}: miniatura`);
}
assert.deepEqual([...formas].sort(), ["burbujas", "flecos", "penacho", "resorte", "tirabuzon", "voluta"], "hay una predefinida de cada forma");
// Cada rizo y cada fleco es un tubito aparte.
const flecos = RIZOS_PREDEFINIDOS.find((r) => r.id === "rizo_flecos")!;
assert.equal(armarRizo(flecos.decoracion.propiedades).materiales.reduce((s, m) => s + m.cantidad, 0), 12, "12 flecos = 12 tubitos");
const penacho = RIZOS_PREDEFINIDOS.find((r) => r.id === "rizo_penacho")!;
assert.equal(armarRizo(penacho.decoracion.propiedades).materiales.reduce((s, m) => s + m.cantidad, 0), 7, "penacho de 7 = 7 tubitos");
console.log(`OK rizos: ${RIZOS_PREDEFINIDOS.length} predefinidos arman, con materiales y miniatura`);

// Registro en «Decoraciones pequeñas».
const grupos = decoracionesPorGrupo();
const rizos = grupos.find((g) => g.id === "rizos");
const burbujas = grupos.find((g) => g.id === "burbujas");
assert.ok(rizos && rizos.nombre === "Rizos y tubitos" && rizos.decoraciones.length === RIZOS_PREDEFINIDOS.length, "grupo «Rizos y tubitos»");
assert.ok(burbujas && burbujas.decoraciones.length === BURBUJAS_PREDEFINIDAS.length, "grupo «Globos burbuja»");
assert.ok(DECORACIONES_PREDEFINIDAS.filter((d) => d.decoracion.tipo === "rizo").length === RIZOS_PREDEFINIDOS.length, "en las predefinidas");
const miniBurbuja = miniaturaDecoracion(BURBUJAS_PREDEFINIDAS[0]!.decoracion);
const ultima = miniBurbuja.formas[miniBurbuja.formas.length - 1]!;
assert.ok(ultima.tipo === "globo" && ultima.cristal, "en la miniatura el cristal va encima (transparente)");
console.log("OK registro: «Rizos y tubitos» y «Globos burbuja» en Decoraciones pequeñas, con miniatura");

// ----------------------------------------------------------------------------------------------------------
// 2. La espiral sigue su radio y sus vueltas
// ----------------------------------------------------------------------------------------------------------

/** Ángulo total que recorre una curva alrededor del eje z (desenrollado), y la distancia de cada punto al eje. */
function vueltasYRadios(puntos: readonly Vec3[], eje: "z" | "y") {
  const plano = (p: Vec3): [number, number] => (eje === "z" ? [p.x, p.y] : [p.x, p.z]);
  let total = 0;
  for (let i = 1; i < puntos.length; i++) {
    const [ax, ay] = plano(puntos[i - 1]!), [bx, by] = plano(puntos[i]!);
    let d = Math.atan2(by, bx) - Math.atan2(ay, ax);
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    total += d;
  }
  return { vueltas: Math.abs(total) / (2 * Math.PI), radios: puntos.map((p) => Math.hypot(...plano(p))) };
}

const casos: Array<{ p: PropiedadesRizo; vueltas: number; r0: number; r1: number; largo: number; eje: "z" | "y" }> = [
  { p: { forma: "tirabuzon", tubito: { formatoId: "T-260", grosorCm: 3, codigo: "012" }, vueltas: 4, radioInicialCm: 2.5, radioFinalCm: 6, largoCm: 40 }, vueltas: 4, r0: 2.5, r1: 6, largo: 40, eje: "z" },
  { p: { forma: "tirabuzon", tubito: { formatoId: "T-160", grosorCm: 2, codigo: "970" }, vueltas: 7.5, radioInicialCm: 6, radioFinalCm: 2, largoCm: 30 }, vueltas: 7.5, r0: 6, r1: 2, largo: 30, eje: "z" },
  { p: { forma: "resorte", tubito: { formatoId: "T-260", grosorCm: 3.5, codigo: "040" }, vueltas: 3, radioCm: 4, largoCm: 15, eje: "frente" }, vueltas: 3, r0: 4, r1: 4, largo: 15, eje: "y" },
];
for (const c of casos) {
  const t = armarRizo(c.p).tubos[0]!;
  const { vueltas, radios } = vueltasYRadios(t.puntos, c.eje);
  assert.ok(Math.abs(vueltas - c.vueltas) < 1e-2, `${c.p.forma}: ${vueltas.toFixed(3)} vueltas (pedidas ${c.vueltas})`);
  radios.forEach((r, i) => {
    const esperado = c.r0 + ((c.r1 - c.r0) * i) / (radios.length - 1);
    assert.ok(Math.abs(r - esperado) < 0.01, `${c.p.forma}: punto ${i} a ${r.toFixed(3)} cm del eje (esperado ${esperado.toFixed(3)})`);
  });
  // A lo largo del eje: del amarre (medio grosor) a medio grosor + largo; cuelga (z baja) o sale de frente (y sube).
  const a = c.eje === "z" ? -t.puntos[0]!.z : t.puntos[0]!.y, b = c.eje === "z" ? -t.puntos[t.puntos.length - 1]!.z : t.puntos[t.puntos.length - 1]!.y;
  assert.ok(Math.abs(a - t.grosorCm / 2) < 0.01 && Math.abs(b - a - c.largo) < 0.01, `${c.p.forma}: largo ${b - a}`);
}
// Las espiras no se montan: con un largo imposible, el paso se abre hasta el grosor.
const apretado = armarRizo({ forma: "resorte", tubito: { formatoId: "T-260", grosorCm: 4, codigo: "012" }, vueltas: 5, radioCm: 3, largoCm: 2 }).tubos[0]!;
const altoApretado = Math.abs(apretado.puntos[apretado.puntos.length - 1]!.z - apretado.puntos[0]!.z);
assert.ok(altoApretado / 5 >= 4, `paso por vuelta ${altoApretado / 5} ≥ grosor`);
// Voluta: plana (y = 0) y con las espiras separadas al menos un grosor.
const voluta = RIZOS_PREDEFINIDOS.find((r) => r.id === "rizo_voluta")!;
const vt = armarRizo(voluta.decoracion.propiedades).tubos[0]!;
assert.ok(vt.puntos.every((p) => Math.abs(p.y) < 1e-9), "la voluta es plana");
const vr = vueltasYRadios(vt.puntos, "y");
const porVuelta = (vr.radios[vr.radios.length - 1]! - vr.radios[0]!) / vr.vueltas;
assert.ok(Math.abs(vr.vueltas - 2.5) < 1e-2 && porVuelta >= vt.grosorCm, `voluta: ${vr.vueltas.toFixed(2)} vueltas, ${porVuelta.toFixed(2)} cm por vuelta`);
console.log("OK espiral: tirabuzón, resorte y voluta siguen su radio y sus vueltas; las espiras no se montan");

// Penacho: cada rizo arranca en el amarre y su eje queda en el cono pedido.
const pp = { forma: "penacho" as const, formatoId: "T-260", grosorCm: 3, codigos: ["212"], rizos: 9, vueltas: 2, radioInicialCm: 2, radioFinalCm: 3, largoCm: 20, inclinacionGrados: 0, aperturaGrados: 40 };
const dirs = direccionesPenacho(9, 0, 40);
assert.ok(dirs.every((d) => Math.acos(d.z) <= (40 * Math.PI) / 180 + 1e-9), "las direcciones caen en el cono");
for (const t of armarRizo(pp).tubos) assert.ok(d3(t.puntos[0]!, { x: 0, y: 0, z: 0 }) <= 2 + 1.5 + 1e-6, "cada rizo arranca junto al amarre");
// Flecos: todo cuelga por debajo del amarre.
for (const t of armarRizo(flecos.decoracion.propiedades).tubos) assert.ok(t.puntos.every((p) => p.z <= 0), "los flecos cuelgan");
console.log("OK penacho y flecos: rizos en el cono, flecos colgando");

// ----------------------------------------------------------------------------------------------------------
// 3. Burbujas encadenadas se tocan
// ----------------------------------------------------------------------------------------------------------

function cadenaSeToca(tubos: readonly TuboDecoracion[], cerrada: boolean, que: string) {
  const n = tubos.length;
  for (let i = 0; i < (cerrada ? n : n - 1); i++) {
    const a = tubos[i]!, b = tubos[(i + 1) % n]!;
    const fin = a.puntos[a.puntos.length - 1]!, ini = b.puntos[0]!;
    const g = Math.max(a.grosorCm, b.grosorCm);
    // Las dos puntas redondas (radio g/2) llegan a la torcedura: se tocan o se aprietan, sin hueco entre ellas.
    assert.ok(d3(fin, ini) <= g + 1e-6, `${que}: burbujas ${i} y ${i + 1} separadas ${d3(fin, ini).toFixed(3)} > ${g}`);
    // Y no son la misma burbuja: cada una tiene su largo.
    assert.ok(d3(a.puntos[0]!, fin) > 0, `${que}: burbuja ${i} con largo`);
  }
}
const recta = armarRizo({ forma: "burbujas", formatoId: "T-260", grosorCm: 4, codigos: ["009"], largosCm: [7], recorrido: "recta", cantidad: 10 });
cadenaSeToca(recta.tubos, false, "recta");
assert.equal(recta.tubos.length, 10);
for (const t of recta.tubos) assert.ok(Math.abs(d3(t.puntos[0]!, t.puntos[2]!) + t.grosorCm - 7) < 1e-6, "cada burbuja mide lo pedido de torcedura a torcedura");
const aro = armarRizo({ forma: "burbujas", formatoId: "T-260", grosorCm: 3.5, codigos: ["032"], largosCm: [11], recorrido: "aro", cantidad: 5 });
cadenaSeToca(aro.tubos, true, "aro");
assert.equal(aro.tubos.length, 5, "aro de 5 burbujas");
for (const t of aro.tubos) assert.ok(Math.abs(d3(t.puntos[0]!, t.puntos[2]!) + t.grosorCm - 11) < 0.01, "pentágono de lados de 11 cm");
const estrella = RIZOS_PREDEFINIDOS.find((r) => r.id === "rizo_estrella_burbujas")!;
const est = armarRizo(estrella.decoracion.propiedades);
cadenaSeToca(est.tubos, true, "estrella");
assert.ok(est.tubos.length >= 30, "la estrella lleva su cadena");
// Una cadena es un tubito retorcido: se cotiza por largo (10 burbujas de 7 cm = 70 cm → 1 T-260).
assert.deepEqual(recta.materiales, [{ formatoId: "T-260", codigo: "009", cantidad: 1 }]);
console.log(`OK burbujas en cadena: recta (10), aro (5, pentágono) y estrella (${est.tubos.length}) se tocan en cada torcedura`);

// ----------------------------------------------------------------------------------------------------------
// 4. Los interiores quedan dentro del globo exterior sin atravesarlo
// ----------------------------------------------------------------------------------------------------------

/** El perfil torneado entero de un globo (36 giros), en el espacio de la burbuja. */
function puntosDelGlobo(g: GloboDecoracion, desde = 0): Vec3[] {
  const e = (() => { const n = Math.hypot(g.direccion.x, g.direccion.y, g.direccion.z); return { x: g.direccion.x / n, y: g.direccion.y / n, z: g.direccion.z / n }; })();
  const aux = Math.abs(e.z) < 0.9 ? { x: 0, y: 0, z: 1 } : { x: 1, y: 0, z: 0 };
  const u0 = { x: aux.y * e.z - aux.z * e.y, y: aux.z * e.x - aux.x * e.z, z: aux.x * e.y - aux.y * e.x };
  const nu = Math.hypot(u0.x, u0.y, u0.z);
  const u = { x: u0.x / nu, y: u0.y / nu, z: u0.z / nu };
  const v = { x: e.y * u.z - e.z * u.y, y: e.z * u.x - e.x * u.z, z: e.x * u.y - e.y * u.x };
  const salida: Vec3[] = [];
  for (const q of perfilRedondo(g.infladoCm, g.cuelloExtraCm).slice(desde)) {
    for (let k = 0; k < 36; k++) {
      const a = (2 * Math.PI * k) / 36;
      salida.push({
        x: g.nudo.x + e.x * q.y + (u.x * Math.cos(a) + v.x * Math.sin(a)) * q.r,
        y: g.nudo.y + e.y * q.y + (u.y * Math.cos(a) + v.y * Math.sin(a)) * q.r,
        z: g.nudo.z + e.z * q.y + (u.z * Math.cos(a) + v.z * Math.sin(a)) * q.r,
      });
    }
  }
  return salida;
}

function comprobarBurbuja(p: PropiedadesBurbuja, que: string) {
  const a = armarBurbuja(p);
  const ext = a.globos[0]!;
  assert.equal(ext.codigo, p.exterior.codigo, `${que}: el exterior primero`);
  assert.ok(ext.nudo.x === 0 && ext.nudo.y === 0 && ext.nudo.z === 0 && ext.direccion.z === 1, `${que}: el exterior con el nudo en el origen y el cuerpo hacia arriba`);
  const perfil = perfilRedondo(ext.infladoCm);
  const interiores = a.globos.slice(1);
  assert.equal(interiores.length, a.colocados);
  const doble = a.pedidos === 1 && interiores.length === 1 && interiores[0]!.infladoCm > ext.infladoCm * 0.5;
  for (const [i, g] of interiores.entries()) {
    // Todo su perfil (en el doble globo, sin el nudo, que sale por la boca junto al de fuera) dentro, sin tocar la pared.
    for (const q of puntosDelGlobo(g, doble ? 5 : 0)) {
      assert.ok(puntoDentro(perfil, q, PARED_BURBUJA_CM * 0.9), `${que}: el interior ${i} atraviesa el exterior en (${q.x.toFixed(1)}, ${q.y.toFixed(1)}, ${q.z.toFixed(1)}) — radio ahí ${radioDelPerfil(perfil, q.z).toFixed(2)}`);
    }
    for (const [j, h] of interiores.entries()) {
      if (j <= i) continue;
      const ci = cuerpoDeInterior(g), cj = cuerpoDeInterior(h);
      assert.ok(d3(ci.centro, cj.centro) >= (ci.radio + cj.radio) * APRIETE - 1e-3, `${que}: los interiores ${i} y ${j} se montan`);
    }
  }
  for (const t of a.tubos) {
    assert.ok(t.papel && t.cerrado, `${que}: el relleno es papel`);
    for (const q of t.puntos) assert.ok(puntoDentro(perfil, q, PARED_BURBUJA_CM), `${que}: el relleno se sale`);
  }
  return a;
}

for (const b of BURBUJAS_PREDEFINIDAS) {
  const a = comprobarBurbuja(b.decoracion.propiedades, b.id);
  assert.equal(a.colocados, a.pedidos, `${b.id}: entran todos los pedidos`);
  const dec = armarDecoracion(b.decoracion);
  const pedidos = b.decoracion.propiedades.interiores.reduce((s, i) => s + i.cantidad, 0);
  assert.equal(dec.materiales.reduce((s, m) => s + m.cantidad, 0), 1 + pedidos, `${b.id}: cotiza el exterior y los de adentro (no el papel)`);
}
// Las burbujas de las ideas del lote 06 (más llenas) y una que pide más de lo que cabe.
const burbujasLote: PropiedadesBurbuja[] = [];
const sinCaber = comprobarBurbuja({ exterior: { formatoId: "R-18", infladoCm: 36, codigo: "390" }, interiores: [{ formatoId: "R-9", infladoCm: 20, codigos: ["015"], cantidad: 30 }], relleno: null, semilla: 9 }, "sin caber");
assert.ok(sinCaber.colocados < 30 && sinCaber.colocados > 0, `si no caben, entran los que caben (${sinCaber.colocados} de 30)`);
const plumas = comprobarBurbuja({ exterior: { formatoId: "R-24", infladoCm: 50, codigo: "390" }, interiores: [], relleno: { tipo: "plumas", colores: ["#ffffff"], cantidad: 15, largoCm: 9 }, semilla: 2 }, "plumas");
assert.ok(plumas.tubos.length >= 12, "las plumas entran");
console.log(`OK burbuja: ${BURBUJAS_PREDEFINIDAS.length} predefinidas y 2 de prueba, cada interior (perfil entero, 36 giros) dentro del exterior sin atravesarlo`);

// ----------------------------------------------------------------------------------------------------------
// 5. Determinismo
// ----------------------------------------------------------------------------------------------------------

for (const r of RIZOS_PREDEFINIDOS) assert.deepEqual(armarRizo(r.decoracion.propiedades), armarRizo(structuredClone(r.decoracion.propiedades)), `${r.id}: determinista`);
for (const b of BURBUJAS_PREDEFINIDAS) assert.deepEqual(armarBurbuja(b.decoracion.propiedades), armarBurbuja(structuredClone(b.decoracion.propiedades)), `${b.id}: determinista`);
const p0 = BURBUJAS_PREDEFINIDAS[0]!.decoracion.propiedades;
const otra = armarBurbuja({ ...p0, semilla: p0.semilla + 11 });
assert.equal(otra.colocados, armarBurbuja(p0).colocados, "otra semilla: entran los mismos");
assert.notDeepEqual(otra.globos.map((g) => g.nudo), armarBurbuja(p0).globos.map((g) => g.nudo), "otra semilla: otro reparto");
console.log("OK determinismo: mismas propiedades, mismos puntos");

// ----------------------------------------------------------------------------------------------------------
// 6. Lote 06
// ----------------------------------------------------------------------------------------------------------

const SLUGS_06 = ["rizos-alegres", "colgante-para-papa", "estrella-navidena", "topiario-reflex", "columna-romana", "encanto-navideno", "fantasia-neon"];
const lote = IDEAS_SEMPERTEX.filter((i) => SLUGS_06.includes(i.slug));
assert.ok(lote.length >= 6 && lote.length <= 8, `${lote.length} ideas`);
assert.equal(new Set(IDEAS_SEMPERTEX.map((i) => i.id)).size, IDEAS_SEMPERTEX.length, "sin ids repetidos en todas las ideas");
const tiendaPorUrl = new Map(GLOBOS_TIENDA.map((p) => [p.url, p]));
let conRizos = 0, conBurbuja = 0;
for (const i of lote) {
  const fuente = fuenteIdea(i.slug)!;
  assert.ok(fuente, `${i.slug}: está en las 987`);
  assert.equal(i.numero, fuente.numero);
  assert.equal(i.fotoUrl, fuente.fotoUrl);
  assert.ok(i.fotoUrl.startsWith("https://sempertex.com/cdn/"), `${i.slug}: foto pública`);
  assert.ok(i.ocasiones.length > 0 && i.ocasiones.every((o) => OCASIONES.includes(o)), `${i.slug}: ocasiones ${i.ocasiones}`);
  assert.ok(i.nota.length > 80, `${i.slug}: nota honesta`);
  const armada = i.contenido.tipo === "escena" ? armarEscena(i.contenido.escena) : null;
  if (armada) assert.deepEqual(armada.avisos, [], `${i.slug}: arma sin avisos`);
  const piezas = i.contenido.tipo === "escena" ? i.contenido.escena.nodos.map((n) => n.pieza) : [i.contenido.pieza];
  const decos = piezas.flatMap((p) => (p.tipo === "decoracion" ? [p.decoracion] : [])) as Decoracion[];
  if (decos.some((d) => d.tipo === "rizo")) conRizos++;
  const burb = decos.filter((d): d is Extract<Decoracion, { tipo: "burbuja" }> => d.tipo === "burbuja");
  if (burb.length) conBurbuja++;
  for (const b of burb) {
    burbujasLote.push(b.propiedades);
    const a = comprobarBurbuja(b.propiedades, i.slug);
    assert.equal(a.colocados, a.pedidos, `${i.slug}: entran todos los globos de adentro`);
  }
  assert.ok(decos.some((d) => d.tipo === "rizo" || d.tipo === "burbuja"), `${i.slug}: depende de rizos o burbujas`);
  // Productos: cada uno con nombre y url de la tienda; los publicados por la ficha, tal cual.
  assert.ok(i.productos.length > 0, `${i.slug}: productos`);
  for (const p of i.productos) {
    assert.ok(p.nombre && p.url.startsWith("/products/") && p.cantidad && p.cantidad > 0 && p.contada, `${i.slug}: producto ${p.nombre}`);
    const fila = tiendaPorUrl.get(p.url);
    assert.ok(fila && fila.codigo === p.codigo, `${i.slug}: ${p.nombre} es el producto liso de su código`);
  }
  for (const pub of fuente.productos) assert.ok(i.productos.some((p) => p.url === pub.url && p.nombre === pub.nombre), `${i.slug}: usa el producto publicado ${pub.nombre}`);
  // Los productos cuadran con lo que arma.
  const materiales = armada ? armada.materiales : armarPieza((i.contenido as { pieza: Parameters<typeof armarPieza>[0] }).pieza).materiales;
  assert.equal(i.productos.reduce((s, p) => s + (p.cantidad ?? 0), 0), materiales.reduce((s, m) => s + Math.ceil(m.cantidad - 1e-9), 0), `${i.slug}: productos = materiales`);
}
assert.ok(conRizos >= 3 && conBurbuja >= 3, `rizos en ${conRizos} ideas, burbuja en ${conBurbuja}`);
console.log(`OK lote 06: ${lote.length} ideas (${conRizos} con rizos, ${conBurbuja} con burbuja; ${burbujasLote.length} burbujas con todo dentro), productos con url de la tienda`);
