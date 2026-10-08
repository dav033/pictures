/**
 * Generador de figuras de globos y tubitos (`figuras-tubito.ts`) y las ideas de sempertex.com digitalizadas con él
 * (`ideas-figuras.ts`). Sin coste: no llama a ninguna IA.
 * - cada plantilla y cada idea arma; globos y tubitos con colores que existen en su formato e inflado dentro de rango;
 * - las ideas llevan número, slug, enlace a la tienda, productos (los de la idea) y nota honesta; nada de rutas ni fotos;
 * - simetría izquierda/derecha cuando aplica (y no cuando una pose la rompe);
 * - partes unidas: cada burbuja toca la anterior (±1 cm), cada extremidad nace en la superficie del cuerpo, el
 *   cuerpo, el cuello y la cabeza se tocan; la figura se apoya en el piso;
 * - medidas razonables, determinismo, grupo «Figuras» con miniatura y de pie en el piso de la escena.
 */
import assert from "node:assert/strict";
import { DECORACIONES_PREDEFINIDAS, armarDecoracion, decoracionEnIngles } from "../../src/lib/globos3d/figuras";
import { PLANTILLAS_FIGURA, armarFiguraTubito, capasCara, type FiguraArmada, type PropiedadesFigura } from "../../src/lib/globos3d/figuras-tubito";
import { FIGURAS_PREDEFINIDAS, IDEAS_FIGURAS, decoracionDeIdea } from "../../src/lib/globos3d/ideas-figuras";
import { esDePie } from "../../src/lib/globos3d/halloween";
import { coloresDelFormato, formatoPorId } from "../../src/lib/globos3d/formatos";
import { centroCuerpo } from "../../src/lib/globos3d/geometria";
import { agregarDecoracion, decoracionesPorGrupo, miniaturaDecoracion } from "../../src/lib/globos3d/decoraciones-escena";
import { armarEscena, SALA_INICIAL, type Escena } from "../../src/lib/globos3d/escena";
import { armarPieza } from "../../src/lib/globos3d/piezas";
import type { Vec3 } from "../../src/lib/globos3d/modulos";

const existe = (formatoId: string, codigo: string) => coloresDelFormato(formatoId).some((c) => c.codigo === codigo);
const finito = (v: Vec3) => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
const dist = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const esLink = (id: string) => formatoPorId(id)?.tipo === "link";

const todas: Array<{ id: string; propiedades: PropiedadesFigura }> = [
  ...PLANTILLAS_FIGURA.map((p) => ({ id: p.id, propiedades: p.decoracion.propiedades })),
  ...IDEAS_FIGURAS.map((i) => ({ id: i.id, propiedades: decoracionDeIdea(i).propiedades })),
];

// 1. Registro: plantillas e ideas en DECORACIONES_PREDEFINIDAS una vez, en el grupo «Figuras», en su orden.
assert.ok(PLANTILLAS_FIGURA.length >= 7, "las 7 plantillas");
assert.ok(IDEAS_FIGURAS.length >= 8 && IDEAS_FIGURAS.length <= 12, `8 a 12 ideas (${IDEAS_FIGURAS.length})`);
const ids = FIGURAS_PREDEFINIDAS.map((d) => d.id);
assert.equal(new Set(ids).size, ids.length, "ids únicos");
for (const id of ids) assert.equal(DECORACIONES_PREDEFINIDAS.filter((d) => d.id === id).length, 1, `${id}: está una vez en DECORACIONES_PREDEFINIDAS`);
const grupo = decoracionesPorGrupo().find((g) => g.id === "figuras");
assert.ok(grupo, "hay grupo Figuras");
assert.equal(grupo.nombre, "Figuras");
assert.deepEqual(grupo.decoraciones.map((d) => d.id), ids, "el grupo lleva plantillas e ideas, en su orden");
for (const d of grupo.decoraciones) assert.ok(d.globos > 0 && !d.noEsGlobo, `${d.id}: cuenta globos`);
// Las plantillas cubren lo pedido: de pie, sentado/saludando, cuatro patas, ave, insecto, vehículo y la base.
const plantilla = (id: string) => PLANTILLAS_FIGURA.find((p) => p.id === id)!.decoracion.propiedades;
assert.equal(plantilla("figura_de_pie").postura, "de_pie");
assert.equal(plantilla("figura_saludando").postura, "sentado");
assert.ok(plantilla("figura_saludando").brazos?.otroLado, "la que saluda tiene un brazo distinto");
assert.equal(plantilla("figura_perrito").postura, "horizontal");
assert.equal(plantilla("figura_perrito").patasPorLado, 2);
assert.ok(plantilla("figura_pajaro").accesorios.some((a) => a.forma.tipo === "alas") && plantilla("figura_pajaro").accesorios.some((a) => a.forma.tipo === "pico"), "el pájaro lleva alas y pico");
assert.equal(plantilla("figura_abeja").patasPorLado, 3);
assert.ok(plantilla("figura_abeja").accesorios.some((a) => a.forma.tipo === "antenas"), "la abeja lleva antenas");
assert.ok(plantilla("figura_auto").ruedas, "el auto lleva ruedas");
assert.ok(plantilla("figura_base").base.length >= 1 && plantilla("figura_base").cuerpo.length === 0, "la base sola");

// 2. Cada figura arma con colores reales, inflados en rango y números finitos; lo impreso cabe en su globo.
const armadas = new Map<string, FiguraArmada>();
for (const { id, propiedades } of todas) {
  const a = armarFiguraTubito(propiedades);
  armadas.set(id, a);
  assert.ok(a.globos.length > 0, `${id}: lleva globos`);
  for (const g of a.globos) {
    const f = formatoPorId(g.formatoId);
    assert.ok(f && f.tipo !== "tubito", `${id}: ${g.formatoId} es un globo`);
    assert.ok(existe(g.formatoId, g.codigo), `${id}: ${g.codigo} no existe en ${g.formatoId}`);
    assert.ok(g.infladoCm <= f!.diametroMaxCm + 1e-9 && g.infladoCm >= f!.diametroMaxCm * 0.4, `${id}: inflado de ${g.formatoId} en rango (${g.infladoCm})`);
    assert.ok(finito(g.nudo) && finito(g.direccion), `${id}: globo con números`);
    assert.ok(Math.abs(Math.hypot(g.direccion.x, g.direccion.y, g.direccion.z) - 1) < 1e-6, `${id}: dirección unitaria`);
    if (g.estampado) {
      assert.ok(g.frente, `${id}: lo impreso necesita frente`);
      assert.ok(!esLink(g.formatoId), `${id}: un Link-O-Loon no lleva impreso`);
      for (const c of g.estampado.capas) {
        assert.match(c.hex, /^#[0-9a-f]{6}$/i);
        assert.ok(c.puntos.length >= 3, `${id}: polígono`);
        for (const [u, v] of c.puntos) assert.ok(Math.hypot(u, v) < (g.infladoCm / 2) * 1.9, `${id}: lo impreso queda sobre el globo`);
      }
    }
  }
  for (const t of a.tubos) {
    const f = formatoPorId(t.formatoId);
    assert.equal(f?.tipo, "tubito", `${id}: los tramos son de tubito (${t.formatoId})`);
    assert.ok(existe(t.formatoId, t.codigo), `${id}: ${t.codigo} no existe en ${t.formatoId}`);
    assert.ok(t.grosorCm <= f!.diametroMaxCm + 1e-9 && t.grosorCm >= f!.diametroMaxCm * 0.4, `${id}: grosor de ${t.formatoId} en rango (${t.grosorCm})`);
    assert.ok(t.puntos.length >= 2 && t.puntos.every(finito), `${id}: tramo con puntos`);
    assert.ok(!t.papel, `${id}: nada de papel`);
  }
  const { materiales } = armarDecoracion({ tipo: "figura", propiedades });
  for (const m of materiales) assert.ok(existe(m.formatoId, m.codigo) && m.cantidad >= 1, `${id}: material ${m.formatoId} ${m.codigo}`);
}

// 3. Las ideas: de dónde salen, sus productos y una nota honesta; nada de imágenes ni rutas absolutas.
for (const idea of IDEAS_FIGURAS) {
  assert.ok(Number.isInteger(idea.numero) && idea.numero >= 1 && idea.numero <= 987, `${idea.id}: número de idea`);
  assert.match(idea.slug, /^[a-z0-9-]+$/, `${idea.id}: slug`);
  assert.equal(idea.url, `https://sempertex.com/blogs/idea-de-fiesta/${idea.slug}`, `${idea.id}: enlace a la idea`);
  assert.equal(idea.pieza.tipo, "decoracion");
  assert.ok(idea.pieza.tipo === "decoracion" && idea.pieza.deFrente, `${idea.id}: de frente`);
  assert.ok(idea.nota.length > 120 && /Se parece/.test(idea.nota) && /No:/.test(idea.nota), `${idea.id}: la nota dice qué se parece y qué no`);
  const { materiales } = armarDecoracion(decoracionDeIdea(idea));
  for (const p of idea.productos) {
    if (!p.formato || !p.codigo) continue;
    assert.ok(existe(p.formato, p.codigo), `${idea.id}: producto ${p.formato} ${p.codigo} existe`);
    // Cada color de la idea se usa, o la nota explica por qué no.
    assert.ok(materiales.some((m) => m.codigo === p.codigo) || idea.nota.includes(p.codigo), `${idea.id}: usa ${p.codigo} o dice por qué no`);
  }
  if (!idea.productos.length) assert.ok(/no lista productos/.test(idea.nota), `${idea.id}: dice que la idea no lista productos`);
}
const texto = JSON.stringify(IDEAS_FIGURAS);
assert.ok(!/"[A-Za-z]:[\\/]|\.(jpe?g|png|webp)\b|\/Users\//i.test(texto), "sin rutas absolutas ni imágenes");
for (const n of [8, 9, 21, 83]) assert.ok(IDEAS_FIGURAS.some((i) => i.numero === n), `la idea #${n} está`);

// 4. Simetría: sin pose que la rompa, lo de la izquierda es el espejo de lo de la derecha.
const espejo = (v: Vec3): Vec3 => ({ x: -v.x, y: v.y, z: v.z });
function simetrica(a: FiguraArmada): boolean {
  const centros = a.globos.map((g) => ({ ...g, c: { x: g.nudo.x + g.direccion.x * 10, y: g.nudo.y + g.direccion.y * 10, z: g.nudo.z + g.direccion.z * 10 } }));
  return centros.every((g) => centros.some((h) => h.codigo === g.codigo && h.infladoCm === g.infladoCm && dist(espejo(g.nudo), h.nudo) < 0.3 && dist(espejo(g.c), h.c) < 0.3))
    && a.tubos.every((t) => a.tubos.some((u) => u.codigo === t.codigo && u.puntos.length === t.puntos.length && t.puntos.every((p) => u.puntos.some((q) => dist(espejo(p), q) < 0.3))));
}
for (const id of ["figura_de_pie", "figura_espantapajaros", "figura_forky", "figura_amigos_felices"]) {
  const a = armadas.get(id)!;
  for (const [der, izq] of [["brazo derecho", "brazo izquierdo"], ["pierna derecha", "pierna izquierda"]] as const) {
    const d = a.extremidades.find((e) => e.nombre === der.replace("derecha", "derecho")), i = a.extremidades.find((e) => e.nombre === izq.replace("izquierda", "izquierdo"));
    if (!d || !i) continue;
    assert.ok(dist(espejo(d.raiz), i.raiz) < 0.05, `${id}: ${der} y ${izq} nacen en espejo`);
    d.tramos.forEach(([p, q], k) => assert.ok(dist(espejo(p), i.tramos[k]![0]) < 0.05 && dist(espejo(q), i.tramos[k]![1]) < 0.05, `${id}: burbuja ${k} en espejo`));
  }
}
assert.ok(simetrica(armadas.get("figura_base")!), "la base es simétrica entera");
// El muñeco de pie lo es entero con el sombrero derecho (con el sombrero ladeado, no).
const derecho = structuredClone(plantilla("figura_de_pie"));
for (const acc of derecho.accesorios) if (acc.forma.tipo === "sombrero") acc.forma.inclinacionGrados = 0;
assert.ok(simetrica(armarFiguraTubito(derecho)), "el muñeco de pie con el sombrero derecho es simétrico entero");
assert.ok(!simetrica(armadas.get("figura_de_pie")!), "con el sombrero ladeado ya no");
// Con un brazo saludando (o un sombrero ladeado), ya no.
for (const id of ["figura_saludando", "figura_amiguitos"]) {
  const a = armadas.get(id)!;
  const d = a.extremidades.find((e) => e.nombre === "brazo derecho")!, i = a.extremidades.find((e) => e.nombre === "brazo izquierdo")!;
  assert.ok(dist(espejo(d.tramos[d.tramos.length - 1]![1]), i.tramos[i.tramos.length - 1]![1]) > 5, `${id}: un brazo distinto del otro`);
}
// La cara impresa también es simétrica (ojos, mejillas, bigote).
const cara = capasCara(12, { ojos: { estilo: "ovalos", hex: "#111111" }, boca: { estilo: "sonrisa", hex: "#111111" }, mejillas: { hex: "#ff9999" }, bigote: { estilo: "mostacho", hex: "#111111" }, nariz: { estilo: "punto", hex: "#111111" }, cejas: { hex: "#111111", bravas: true } });
const puntosCara = cara.flatMap((c) => c.puntos);
for (const [u, v] of puntosCara) assert.ok(puntosCara.some(([x, y]) => Math.abs(x + u) < 0.3 && Math.abs(y - v) < 0.3), "la cara es simétrica");

// 5. Partes unidas.
/** Distancia (aprox., cm) de un punto a la superficie del cuerpo de un globo: 0 encima, > 0 fuera. */
function aSuperficie(p: Vec3, g: FiguraArmada["globos"][number]): number {
  const c = { x: g.nudo.x + g.direccion.x * centroCuerpo(esLink(g.formatoId) ? "link" : "redondo", g.infladoCm), y: g.nudo.y + g.direccion.y * centroCuerpo(esLink(g.formatoId) ? "link" : "redondo", g.infladoCm), z: g.nudo.z + g.direccion.z * centroCuerpo(esLink(g.formatoId) ? "link" : "redondo", g.infladoCm) };
  const r = g.infladoCm / 2, h = r * (esLink(g.formatoId) ? 1.35 : 1.08);
  const d = { x: p.x - c.x, y: p.y - c.y, z: p.z - c.z };
  const a = d.x * g.direccion.x + d.y * g.direccion.y + d.z * g.direccion.z;
  const b = Math.hypot(d.x - a * g.direccion.x, d.y - a * g.direccion.y, d.z - a * g.direccion.z);
  return (Math.hypot(a / h, b / r) - 1) * r;
}
function aTubo(p: Vec3, t: FiguraArmada["tubos"][number]): number {
  let mejor = Infinity;
  for (let i = 1; i < t.puntos.length; i++) {
    const a = t.puntos[i - 1]!, b = t.puntos[i]!;
    const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z }, l2 = ab.x ** 2 + ab.y ** 2 + ab.z ** 2 || 1;
    const k = Math.max(0, Math.min(1, ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y + (p.z - a.z) * ab.z) / l2));
    mejor = Math.min(mejor, dist(p, { x: a.x + ab.x * k, y: a.y + ab.y * k, z: a.z + ab.z * k }) - t.grosorCm / 2);
  }
  return mejor;
}
for (const [id, a] of armadas) {
  for (const e of a.extremidades) {
    assert.ok(e.tramos.length >= 1, `${id} ${e.nombre}: tiene burbujas`);
    assert.ok(dist(e.raiz, e.tramos[0]![0]) <= 1, `${id} ${e.nombre}: la primera burbuja nace en la raíz`);
    for (let k = 1; k < e.tramos.length; k++) assert.ok(dist(e.tramos[k - 1]![1], e.tramos[k]![0]) <= 1, `${id} ${e.nombre}: la burbuja ${k} toca la anterior`);
    // La raíz está sobre el cuerpo: la superficie de algún globo (o de un tubito, si el cuerpo es un tubito largo).
    const alCuerpo = Math.min(...a.globos.map((g) => Math.abs(aSuperficie(e.raiz, g))), ...a.tubos.filter((t) => t.puntos.length === 2 && dist(t.puntos[0]!, t.puntos[1]!) > 30).map((t) => Math.abs(aTubo(e.raiz, t))));
    assert.ok(alCuerpo <= 1, `${id} ${e.nombre}: nace en la superficie del cuerpo (${alCuerpo.toFixed(2)} cm)`);
    // Y cada articulación dibujada: algún tubito pasa por ella (el pellizco de la torcedura no la separa).
    for (const [p, q] of e.tramos) for (const punto of [p, q]) assert.ok(a.tubos.some((t) => aTubo(punto, t) <= 1), `${id} ${e.nombre}: hay tubito en la articulación`);
  }
  for (const u of a.uniones) {
    assert.ok(u.holguraCm <= 1, `${id}: ${u.nombre} se toca (holgura ${u.holguraCm} cm)`);
    assert.ok(u.holguraCm >= -16, `${id}: ${u.nombre} no se mete demasiado (${u.holguraCm} cm)`);
  }
}

// 6. Medidas razonables y apoyadas en el piso.
const medidas: Record<string, [number, number]> = {
  figura_de_pie: [100, 150], figura_saludando: [60, 110], figura_perrito: [35, 75], figura_pajaro: [40, 80], figura_abeja: [35, 75], figura_auto: [35, 70], figura_base: [25, 45],
  figura_amigos_felices: [95, 140], figura_amiguitos: [75, 115], figura_angry_bird: [55, 90], figura_ranita: [40, 75], figura_cerdito: [35, 60], figura_espantapajaros: [115, 165],
  figura_forky: [95, 140], figura_gallina: [40, 75], figura_gatito_negro: [75, 115], figura_mariquita: [50, 90], figura_muneco_nieve: [60, 100], figura_pollito: [45, 80],
};
for (const [id, a] of armadas) {
  const rango = medidas[id];
  assert.ok(rango, `${id}: tiene rango de medidas en la prueba`);
  assert.ok(a.altoCm >= rango[0] && a.altoCm <= rango[1], `${id}: alto ${a.altoCm} cm en [${rango}]`);
  assert.ok(a.anchoCm > 15 && a.anchoCm < 110, `${id}: ancho ${a.anchoCm} cm`);
  let minZ = Infinity;
  for (const g of a.globos) minZ = Math.min(minZ, g.nudo.z + g.direccion.z * centroCuerpo(esLink(g.formatoId) ? "link" : "redondo", g.infladoCm) - g.infladoCm / 2 * (Math.abs(g.direccion.z) > 0.9 ? 1.08 : 1));
  for (const t of a.tubos) for (const p of t.puntos) minZ = Math.min(minZ, p.z - t.grosorCm / 2);
  assert.ok(minZ > -1.5 && minZ < 1.5, `${id}: apoyada en el piso (${minZ.toFixed(2)})`);
}
// Proporciones de las que se pueden medir: la cabeza del muñeco de pie es un R-12, el gato es más alto que ancho, el auto más largo que alto.
assert.ok(armadas.get("figura_auto")!.anchoCm > armadas.get("figura_auto")!.altoCm, "el auto es más largo que alto");
assert.ok(armadas.get("figura_espantapajaros")!.altoCm > armadas.get("figura_amiguitos")!.altoCm, "el espantapájaros es más alto que el amiguito");

// 7. Determinismo y datos puros (JSON ida y vuelta da lo mismo).
for (const { id, propiedades } of todas) {
  assert.deepEqual(armarFiguraTubito(propiedades), armadas.get(id), `${id}: armar dos veces da lo mismo`);
  assert.deepEqual(armarFiguraTubito(JSON.parse(JSON.stringify(propiedades)) as PropiedadesFigura), armadas.get(id), `${id}: sobrevive a JSON`);
}

// 8. En la escena: de pie en el piso, de frente en la pared; miniatura y descripción en inglés.
let escena: Escena = { sala: SALA_INICIAL, nodos: [] };
for (const f of FIGURAS_PREDEFINIDAS) {
  assert.ok(esDePie(f.decoracion), `${f.id}: va de pie`);
  assert.ok(decoracionEnIngles(f.decoracion).length > 10, `${f.id}: dice qué es en inglés`);
  const m = miniaturaDecoracion(f.decoracion);
  assert.ok(m.formas.length > 0 && Number.isFinite(m.caja.ancho) && m.caja.ancho > 0, `${f.id}: miniatura`);
}
const enPiso = agregarDecoracion(escena, FIGURAS_PREDEFINIDAS[0]!.decoracion, { en: "piso" }, { nombre: "Muñeco" });
escena = enPiso.escena;
const nodo = escena.nodos.find((n) => n.id === enPiso.id)!;
assert.ok(nodo.pieza.tipo === "decoracion" && nodo.pieza.deFrente, "en el piso queda de frente (derecha)");
const pieza = armarPieza(nodo.pieza);
assert.ok(pieza.caja.min.y > -1.5 && pieza.caja.max.y > 100, `de pie: crece hacia arriba (${pieza.caja.min.y.toFixed(1)}..${pieza.caja.max.y.toFixed(1)})`);
escena = agregarDecoracion(escena, IDEAS_FIGURAS[0]!.pieza.tipo === "decoracion" ? IDEAS_FIGURAS[0]!.pieza.decoracion : FIGURAS_PREDEFINIDAS[0]!.decoracion, { en: "pared" }).escena;
const armada = armarEscena(escena);
assert.equal(armada.porNodo.length, 2, "la escena arma las dos figuras");
assert.ok(armada.porNodo.every((n) => n.globos.length > 0), "con sus globos");

console.log(`OK figuras de tubito: ${PLANTILLAS_FIGURA.length} plantillas y ${IDEAS_FIGURAS.length} ideas (${IDEAS_FIGURAS.map((i) => `#${i.numero}`).join(", ")}).`);
