/**
 * Formas rellenas, volúmenes y letras de globos (`formas.ts`, `letras.ts`, `ideas-formas.ts`). Sin coste: no llama a
 * ninguna IA.
 * - cada contorno predefinido (y uno libre con hueco) arma con cada técnica (celdas cuadradas y al tresbolillo, malla
 *   Link-O-Loon, capa orgánica): el relleno cubre ≥ 90 % del área vista de frente, ningún globo tiene el centro fuera
 *   del contorno ni se sale más de medio globo, y ninguno se aplasta más del 12 % con su vecino (celdas);
 * - con marco (y en el aro) el hueco queda vacío;
 * - las letras: cada carácter tiene los trazos esperados, sus esqueletos se distinguen todos entre sí, y armadas con
 *   hilera, cuartetos y tubito los globos van sobre el esqueleto y el esqueleto queda cubierto;
 * - volúmenes: esfera (radio parejo, sin aplastarse, diámetro cerca del pedido), cono (se achica hacia arriba),
 *   árbol (copa encima del tronco) y globo aerostático (canasta abajo, cuerdas que no cotizan);
 * - las ideas de sempertex.com: 8–12, con su url, productos de la ficha, nota, sin rutas ni imágenes; cada color
 *   existe en su formato; deterministas; se añaden a una escena y los materiales suben exactamente lo de la pieza;
 * - y `test-organico3d` sigue pasando (el motor orgánico no cambió).
 */
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { coloresDelFormato, formatoPorId } from "../../src/lib/globos3d/formatos";
import { centroCuerpo } from "../../src/lib/globos3d/geometria";
import { armarPieza, type Pieza, type PiezaArmada } from "../../src/lib/globos3d/piezas";
import { armarEscena, SALA_INICIAL, type Escena } from "../../src/lib/globos3d/escena";
import {
  CONTORNOS_PREDEFINIDOS, areaRegion, armarForma, regionDeContorno, regionDeRellena, type ContornoForma, type OpcionesRellena, type Region, type TecnicaRelleno,
} from "../../src/lib/globos3d/formas";
import { ESQUELETOS, armarLetras, componerTexto, distanciaATrazo, repartirEnPolilinea, type Trazo } from "../../src/lib/globos3d/letras";
import { FORMAS_BASICAS, IDEAS_FORMAS, agregarIdeaForma, formasConMiniatura } from "../../src/lib/globos3d/ideas-formas";

type Globo = PiezaArmada["globos"][number];

const centro = (g: Globo) => {
  const tipo = formatoPorId(g.formatoId)?.tipo === "link" ? "link" : "redondo";
  const l = centroCuerpo(tipo, g.infladoCm) + g.cuelloExtraCm;
  return { x: g.nudo.x + g.direccion.x * l, y: g.nudo.y + g.direccion.y * l, z: g.nudo.z + g.direccion.z * l };
};

/**
 * ¿El punto (x, y) queda tapado por el cuerpo de algún globo visto de frente? `holgura`: cuánto más se ve cada globo
 * (el látex se aplasta contra el vecino y tapa la rendija: `superficieFrontal` de la pared de trenzas usa un 12 %; aquí
 * se admite la mitad, un 6 % del radio).
 */
function tapado(globos: readonly Globo[], holgura = 1.06) {
  const cuerpos = globos.map((g) => {
    const c = centro(g);
    const link = formatoPorId(g.formatoId)?.tipo === "link";
    const plano = Math.hypot(g.direccion.x, g.direccion.y);
    // Un Link-O-Loon acostado en la pared se ve como un óvalo (1,35 de largo); un redondo, como un círculo.
    const largo = (g.infladoCm / 2) * (link ? 1.35 * plano + (1 - plano) : 1) * holgura;
    const ux = plano > 1e-6 ? g.direccion.x / plano : 1, uy = plano > 1e-6 ? g.direccion.y / plano : 0;
    return { c, r: (g.infladoCm / 2) * holgura, largo, ux, uy };
  });
  return (x: number, y: number) => cuerpos.some((b) => {
    const dx = x - b.c.x, dy = y - b.c.y;
    const a = dx * b.ux + dy * b.uy, n = -dx * b.uy + dy * b.ux;
    return (a / b.largo) ** 2 + (n / b.r) ** 2 <= 1;
  });
}

function cobertura(region: Region, globos: readonly Globo[], holgura = 1.06): number {
  const tapa = tapado(globos, holgura);
  let dentro = 0, cubiertos = 0;
  for (let y = region.caja.minY + 1; y < region.caja.maxY; y += 2) for (let x = region.caja.minX + 1; x < region.caja.maxX; x += 2) {
    if (region.distancia(x, y) <= 0) continue;
    dentro++;
    if (tapa(x, y)) cubiertos++;
  }
  return cubiertos / Math.max(1, dentro);
}

function coloresExisten(armada: PiezaArmada, contexto: string) {
  for (const g of armada.globos) assert.ok(coloresDelFormato(g.formatoId).some((r) => r.codigo === g.codigo), `${contexto}: el ${g.codigo} se fabrica en ${g.formatoId}`);
  for (const t of armada.tubos) if (!t.papel) assert.ok(coloresDelFormato(t.formatoId).some((r) => r.codigo === t.codigo), `${contexto}: el tubito ${t.codigo} se fabrica en ${t.formatoId}`);
  for (const m of armada.materiales) assert.ok(coloresDelFormato(m.formatoId).some((r) => r.codigo === m.codigo), `${contexto}: material ${m.formatoId} ${m.codigo}`);
}

/** Lo peor que se aplastan dos globos de la lista (fracción del diámetro del menor). */
function peorAplastamiento(globos: readonly Globo[]): number {
  let peor = 0;
  const cs = globos.map((g) => ({ c: centro(g), d: g.infladoCm }));
  for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
    const a = cs[i]!, b = cs[j]!;
    const dist = Math.hypot(a.c.x - b.c.x, a.c.y - b.c.y, a.c.z - b.c.z);
    peor = Math.max(peor, ((a.d + b.d) / 2 - dist) / Math.min(a.d, b.d));
  }
  return peor;
}

const t0 = Date.now();
const informe: string[] = [];

// ----------------------------------------------------------------------------------------------------------
// 1. Contornos × técnicas
// ----------------------------------------------------------------------------------------------------------

const TECNICAS: ReadonlyArray<{ nombre: string; tecnica: TecnicaRelleno; colores: string[] }> = [
  { nombre: "celdas al tresbolillo R-9", tecnica: { tipo: "celdas", formatoId: "R-9", infladoCm: 17, celda: "tresbolillo" }, colores: ["015", "005"] },
  { nombre: "celdas cuadradas R-12", tecnica: { tipo: "celdas", formatoId: "R-12", infladoCm: 22, celda: "cuadrada" }, colores: ["040"] },
  { nombre: "malla LOL-12", tecnica: { tipo: "malla", formatoId: "LOL-12", infladoCm: 22, union: { infladoCm: 10, codigo: "005" } }, colores: ["609", "012"] },
];
const CONTORNOS: ContornoForma[] = [
  ...CONTORNOS_PREDEFINIDOS.map((c): ContornoForma => ({ tipo: "predefinido", id: c.id, anchoCm: 130, altoCm: 120 })),
  { tipo: "libre", puntos: [{ x: 0, y: 0 }, { x: 140, y: 0 }, { x: 140, y: 100 }, { x: 0, y: 100 }], huecos: [[{ x: 45, y: 30 }, { x: 95, y: 30 }, { x: 95, y: 70 }, { x: 45, y: 70 }]] },
  { tipo: "texto", texto: "7", altoCm: 120, grosorCm: 34 },
];
let peorCobertura = 1, peorCoberturaEstricta = 1, totalFormas = 0;
for (const contorno of CONTORNOS) {
  const region = regionDeContorno(contorno);
  const nombreContorno = contorno.tipo === "predefinido" ? contorno.id : contorno.tipo === "texto" ? `texto «${contorno.texto}»` : "libre con hueco";
  assert.ok(Math.abs((region.caja.minX + region.caja.maxX) / 2) < 0.5 && Math.abs(region.caja.minY) < 0.5, `${nombreContorno}: centrado y apoyado en y = 0`);
  assert.ok(areaRegion(region) > 1500, `${nombreContorno}: tiene área`);
  for (const { nombre, tecnica, colores } of TECNICAS) {
    const opciones: OpcionesRellena = { clase: "rellena", contorno, tecnica, colores: { codigos: colores, patron: colores.length > 1 ? "degradado" : "un_color", anguloGrados: 90 } };
    const pieza: Pieza = { tipo: "forma", forma: opciones };
    const armada = armarPieza(pieza);
    const contexto = `${nombreContorno} · ${nombre}`;
    assert.ok(armada.globos.length >= 6, `${contexto}: arma (${armada.globos.length} globos)`);
    coloresExisten(armada, contexto);
    const principales = armada.globos.filter((g) => "formatoId" in tecnica && g.formatoId === tecnica.formatoId);
    for (const g of principales) {
      const c = centro(g);
      assert.ok(region.distancia(c.x, c.y) >= -0.5, `${contexto}: un globo tiene el centro fuera del contorno (${c.x.toFixed(1)}, ${c.y.toFixed(1)})`);
      assert.ok(region.distancia(c.x, c.y) >= -0.5 - g.infladoCm / 2, `${contexto}: un globo se sale más de medio globo`);
    }
    const cubre = cobertura(region, armada.globos);
    peorCobertura = Math.min(peorCobertura, cubre);
    peorCoberturaEstricta = Math.min(peorCoberturaEstricta, cobertura(region, armada.globos, 1));
    assert.ok(cubre >= 0.9, `${contexto}: cubre el ${(cubre * 100).toFixed(1)} % del área (mínimo 90 %)`);
    if (tecnica.tipo === "celdas") assert.ok(peorAplastamiento(armada.globos) <= 0.12 + 1e-6, `${contexto}: ningún par se aplasta más del 12 % (${(peorAplastamiento(armada.globos) * 100).toFixed(1)} %)`);
    // Determinismo.
    assert.equal(JSON.stringify(armarPieza(structuredClone(pieza))), JSON.stringify(armada), `${contexto}: determinista`);
    totalFormas++;
  }
}
informe.push(`${totalFormas} formas rellenas (cobertura mínima ${(peorCobertura * 100).toFixed(1)} %; sin contar el aplastamiento, ${(peorCoberturaEstricta * 100).toFixed(1)} %)`);

// Capa orgánica sobre contornos con esqueleto y sin él.
for (const contorno of [
  { tipo: "predefinido", id: "estrella", anchoCm: 110, altoCm: 105 },
  { tipo: "predefinido", id: "corazon", anchoCm: 110, altoCm: 100 },
  { tipo: "texto", texto: "1", altoCm: 140, grosorCm: 34 },
] as ContornoForma[]) {
  const region = regionDeContorno(contorno);
  const pieza: Pieza = { tipo: "forma", forma: { clase: "rellena", contorno, tecnica: { tipo: "organico", radioCm: 16, mezcla: { "R-12": 1, "R-5": 0.6 }, semilla: 3 }, colores: { codigos: ["015", "005"], patron: "mezcla" } } };
  const armada = armarPieza(pieza);
  const contexto = `orgánico ${contorno.tipo === "predefinido" ? contorno.id : "texto"}`;
  coloresExisten(armada, contexto);
  for (const g of armada.globos) { const c = centro(g); assert.ok(region.distancia(c.x, c.y) >= -0.01, `${contexto}: centro dentro del contorno`); }
  const cubre = cobertura(region, armada.globos);
  assert.ok(cubre >= 0.9, `${contexto}: cubre el ${(cubre * 100).toFixed(1)} %`);
  assert.equal(JSON.stringify(armarPieza(structuredClone(pieza))), JSON.stringify(armada), `${contexto}: determinista`);
  informe.push(`${contexto} ${armada.globos.length} globos, ${(cubre * 100).toFixed(0)} %`);
}

// ----------------------------------------------------------------------------------------------------------
// 2. Huecos: marco y aro
// ----------------------------------------------------------------------------------------------------------

for (const tecnica of TECNICAS.map((t) => t.tecnica)) {
  const contorno: ContornoForma = { tipo: "predefinido", id: "corazon", anchoCm: 130, altoCm: 120 };
  const base = regionDeContorno(contorno);
  const marcoCm = 30;
  const opciones: OpcionesRellena = { clase: "rellena", contorno, tecnica, colores: { codigos: tecnica.tipo === "malla" ? ["020"] : ["015"], patron: "un_color" }, marcoCm, borde: { codigo: "005" } };
  const armada = armarPieza({ tipo: "forma", forma: opciones });
  const marco = regionDeRellena(opciones);
  for (const g of armada.globos) {
    const c = centro(g);
    assert.ok(base.distancia(c.x, c.y) <= marcoCm + 0.5, `marco ${tecnica.tipo}: un globo quedó en el hueco (${c.x.toFixed(1)}, ${c.y.toFixed(1)})`);
  }
  const cubre = cobertura(marco, armada.globos);
  assert.ok(cubre >= 0.9, `marco ${tecnica.tipo}: cubre el ${(cubre * 100).toFixed(1)} % del marco`);
  assert.ok(armada.globos.some((g) => g.codigo === "005"), `marco ${tecnica.tipo}: lleva el borde de otro color`);
}
{
  const armada = armarPieza({ tipo: "forma", forma: { clase: "rellena", contorno: { tipo: "predefinido", id: "aro", anchoCm: 150, altoCm: 150 }, tecnica: TECNICAS[0]!.tecnica, colores: { codigos: ["015"], patron: "un_color" } } });
  for (const g of armada.globos) { const c = centro(g); assert.ok(Math.hypot(c.x, c.y - 75) >= 150 * 0.3 - 0.5, "aro: el centro queda vacío"); }
}
informe.push("huecos vacíos (marco en celdas, malla y aro)");

// ----------------------------------------------------------------------------------------------------------
// 3. Letras
// ----------------------------------------------------------------------------------------------------------

const TRAZOS_ESPERADOS: Readonly<Record<string, number>> = {
  "0": 1, "1": 2, "2": 1, "3": 1, "4": 1, "5": 1, "6": 2, "7": 1, "8": 2, "9": 2,
  A: 2, B: 3, C: 1, D: 1, E: 2, F: 2, G: 1, H: 3, I: 3, J: 1, K: 3, L: 1, M: 1, N: 1, "Ñ": 2, O: 1, P: 1, Q: 2, R: 2, S: 1, T: 2, U: 1, V: 1, W: 1, X: 2, Y: 2, Z: 1,
};
for (const [c, n] of Object.entries(TRAZOS_ESPERADOS)) assert.equal(ESQUELETOS[c]?.trazos.length, n, `«${c}» tiene ${n} trazos`);
assert.equal(Object.keys(ESQUELETOS).filter((c) => c !== " ").length, Object.keys(TRAZOS_ESPERADOS).length, "todos los caracteres tienen sus trazos esperados");
// Cerrados donde debe: 0, 8 (dos), O, la panza del 6 y del 9.
for (const [c, cerrados] of Object.entries({ "0": 1, "8": 2, O: 1, "6": 1, "9": 1, Q: 1, "1": 0, L: 0 })) assert.equal(ESQUELETOS[c]!.trazos.filter((t) => t.cerrado).length, cerrados, `«${c}» tiene ${cerrados} trazo(s) cerrado(s)`);
// Rasgos: la T y la H tienen una barra horizontal, la L acaba abajo a la derecha, la I es vertical con remates.
const horizontal = (t: Trazo) => t.puntos.length === 2 && Math.abs(t.puntos[0]!.y - t.puntos[1]!.y) < 1e-9;
assert.ok(ESQUELETOS.T!.trazos.some(horizontal) && ESQUELETOS.H!.trazos.some(horizontal) && ESQUELETOS.E!.trazos.some(horizontal), "T, H y E llevan barra horizontal");
assert.ok(ESQUELETOS.X!.trazos.every((t) => !horizontal(t)), "la X no tiene barras horizontales");
// Firma: el esqueleto rasterizado en celdas de 1 × 1 (sobre 10 de alto): todos distintos entre sí.
const firma = (c: string) => {
  const e = ESQUELETOS[c]!;
  const celdas: string[] = [];
  for (let y = -1; y < 13; y++) for (let x = -1; x < Math.ceil(e.ancho) + 1; x++) celdas.push(e.trazos.some((t) => distanciaATrazo(x + 0.5, y + 0.5, t) < 0.75) ? "#" : ".");
  return `${Math.ceil(e.ancho)}|${celdas.join("")}`;
};
const firmas = new Map<string, string>();
for (const c of Object.keys(TRAZOS_ESPERADOS)) {
  const f = firma(c);
  assert.ok(!firmas.has(f), `«${c}» se confunde con «${firmas.get(f)}»`);
  firmas.set(f, c);
}
// Composición: «FELIZ» en fila (centrada, apoyada), «2012» en columna (el 2 de arriba primero).
const feliz = componerTexto("feliz", { altoCm: 50, separacionCm: 10, disposicion: "fila" });
assert.deepEqual(feliz.caracteres, ["F", "E", "L", "I", "Z"], "mayúsculas");
assert.ok(Math.abs(Math.min(...feliz.trazos.flatMap((t) => t.puntos.map((q) => q.x))) + Math.max(...feliz.trazos.flatMap((t) => t.puntos.map((q) => q.x)))) < 0.5, "FELIZ centrado");
const anio = componerTexto("2012", { altoCm: 30, separacionCm: 5, disposicion: "columna" });
const yDe = (i: number) => Math.min(...anio.trazos.filter((t) => t.caracter === i).flatMap((t) => t.puntos.map((q) => q.y)));
assert.ok(yDe(0) > yDe(1) && yDe(1) > yDe(2) && yDe(2) > yDe(3), "2012 en columna: el primer carácter arriba");
assert.deepEqual(componerTexto("Ñandú", { altoCm: 30, separacionCm: 5, disposicion: "fila" }).caracteres, ["Ñ", "A", "N", "D", "U"], "la Ñ se queda y las tildes se van");

for (const caso of [
  { texto: "2012", tecnica: "hilera", formatoId: "R-5", infladoCm: 8, grosorCm: 14, colores: ["051", "015", "020"], patron: "alternado" },
  { texto: "FELIZ", tecnica: "cuartetos", formatoId: "R-5", infladoCm: 11, grosorCm: 26, colores: ["012", "040"], patron: "por_letra" },
  { texto: "ANA", tecnica: "tubito", formatoId: "T-260", infladoCm: 5, grosorCm: 10, colores: ["570"], patron: "un_color" },
  { texto: "OK 8", tecnica: "hilera", formatoId: "R-9", infladoCm: 14, grosorCm: 14, colores: ["009"], patron: "un_color" },
] as const) {
  const pieza: Pieza = { tipo: "letras", letras: { texto: caso.texto, altoCm: 60, grosorCm: caso.grosorCm, disposicion: "fila", tecnica: caso.tecnica, formatoId: caso.formatoId, infladoCm: caso.infladoCm, colores: [...caso.colores], patron: caso.patron } };
  const armada = armarPieza(pieza);
  const contexto = `letras «${caso.texto}» ${caso.tecnica}`;
  coloresExisten(armada, contexto);
  const armadas = armarLetras(pieza.tipo === "letras" ? pieza.letras : (null as never));
  const trazos = armadas.texto.trazos;
  const d = caso.tecnica === "tubito" ? 5 : caso.infladoCm;
  const alcance = caso.tecnica === "cuartetos" ? d * 0.62 + d * 0.2 : caso.tecnica === "hilera" ? caso.grosorCm / 2 + d * 0.3 : caso.grosorCm;
  // Cada globo (o cada punto de tubito) va sobre el esqueleto…
  const puntos = caso.tecnica === "tubito" ? armada.tubos.flatMap((t) => t.puntos) : armada.globos.map(centro);
  assert.ok(puntos.length > 0, `${contexto}: arma`);
  for (const q of puntos) assert.ok(trazos.some((t) => distanciaATrazo(q.x, q.y, t) <= alcance + 0.5), `${contexto}: un globo se fue del esqueleto (${q.x.toFixed(1)}, ${q.y.toFixed(1)})`);
  // …y el esqueleto queda cubierto: cada trazo, punto a punto, tiene un globo encima (se reconoce la letra).
  for (const t of trazos) {
    const largo = t.puntos.reduce((s, q, i) => (i ? s + Math.hypot(q.x - t.puntos[i - 1]!.x, q.y - t.puntos[i - 1]!.y) : 0), 0);
    for (const m of repartirEnPolilinea(t.puntos, t.cerrado, Math.max(3, Math.round(largo / 3)))) {
      const cerca = puntos.some((q) => Math.hypot(q.x - m.punto.x, q.y - m.punto.y) <= (caso.tecnica === "tubito" ? caso.grosorCm / 2 + 2 : d * 0.95));
      assert.ok(cerca, `${contexto}: el trazo de «${armadas.texto.caracteres[t.caracter]}» queda sin cubrir en (${m.punto.x.toFixed(1)}, ${m.punto.y.toFixed(1)})`);
    }
  }
  if (caso.tecnica !== "tubito") assert.ok(peorAplastamiento(armada.globos) <= 0.2, `${contexto}: no se montan (${(peorAplastamiento(armada.globos) * 100).toFixed(1)} %)`);
  if (caso.patron === "por_letra") assert.equal(new Set(armada.globos.map((g) => g.codigo)).size, 2, `${contexto}: un color por letra`);
  assert.equal(JSON.stringify(armarPieza(structuredClone(pieza))), JSON.stringify(armada), `${contexto}: determinista`);
  informe.push(`${contexto} ${armada.globos.length + armada.tubos.length} piezas`);
}
assert.throws(() => armarPieza({ tipo: "letras", letras: { texto: "A", altoCm: 40, grosorCm: 10, disposicion: "fila", tecnica: "hilera", formatoId: "R-5", infladoCm: 10, colores: ["999"], patron: "un_color" } }), /no se fabrica/, "un color que no existe es un error");

// ----------------------------------------------------------------------------------------------------------
// 4. Volúmenes
// ----------------------------------------------------------------------------------------------------------

{
  const esfera = armarForma({ clase: "esfera", diametroCm: 70, globo: { formatoId: "R-12", infladoCm: 20 }, colores: { codigos: ["005"], patron: "un_color" }, acento: { formatoId: "R-5", infladoCm: 9, codigos: ["015", "970"] } });
  const grandes = esfera.globos.filter((g) => g.formatoId === "R-12");
  const cs = grandes.map(centro);
  const cy = cs.reduce((s, c) => s + c.y, 0) / cs.length;
  const radios = cs.map((c) => Math.hypot(c.x, c.y - cy, c.z));
  assert.ok(Math.max(...radios) - Math.min(...radios) < 0.5, "esfera: todos los globos a la misma distancia del centro");
  const diametro = 2 * (Math.max(...radios) + 10);
  assert.ok(Math.abs(diametro - 70) <= 70 * 0.2, `esfera: ${diametro.toFixed(0)} cm cerca de 70`);
  assert.ok(peorAplastamiento(grandes) <= 0.12 + 1e-6, "esfera: los grandes no se aplastan más del 12 %");
  assert.ok(Math.abs(Math.min(...cs.map((c) => c.y - 10))) < 1, "esfera: apoyada en el piso");
  assert.ok(esfera.globos.some((g) => g.codigo === "015") && esfera.globos.some((g) => g.codigo === "970"), "esfera: acentos de los dos colores");
  for (const g of esfera.globos.filter((x) => x.formatoId === "R-5")) { const c = centro(g); assert.ok(Math.hypot(c.x, c.y - cy, c.z) > Math.min(...radios), "esfera: los acentos van por fuera, en los huecos"); }
}
{
  const cono = armarForma({ clase: "cono", altoCm: 150, tecnica: "anillos", formatoId: "R-12", infladoBaseCm: 25, infladoPuntaCm: 14, globosBase: 6, globosPunta: 4, colores: { codigos: ["405", "570"], patron: "franjas", franjaNiveles: 1 }, acento: { formatoId: "R-5", infladoCm: 9, codigos: ["970"] }, remate: { formatoId: "R-12", infladoCm: 18, codigo: "570" } });
  const anillos = cono.globos.filter((g) => g.formatoId === "R-12").map(centro);
  const abajo = anillos.filter((c) => c.y < 40), arriba = anillos.filter((c) => c.y > 100 && Math.hypot(c.x, c.z) > 1);
  const radio = (cs: typeof anillos) => cs.reduce((s, c) => s + Math.hypot(c.x, c.z), 0) / cs.length;
  assert.ok(radio(abajo) > radio(arriba) * 1.3, "cono: se achica hacia arriba");
  const alto = Math.max(...cono.globos.map((g) => centro(g).y + g.infladoCm / 2));
  assert.ok(Math.abs(alto - 150) <= 20, `cono: ${alto.toFixed(0)} cm cerca de 150`);
  assert.equal(new Set(cono.globos.filter((g) => g.formatoId === "R-12" && centro(g).y < 120).map((g) => g.codigo)).size, 2, "cono: franjas de dos colores");
  coloresExisten({ ...cono, flores: [], caja: { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } } }, "cono");
  const organico = armarForma({ clase: "cono", altoCm: 140, tecnica: "organico", formatoId: "R-12", infladoBaseCm: 25, infladoPuntaCm: 14, globosBase: 6, globosPunta: 3, colores: { codigos: ["032", "030"], patron: "mezcla" }, mezcla: { "R-12": 1, "R-9": 0.5 }, semilla: 4 });
  const co = organico.globos.map(centro);
  assert.ok(radio(co.filter((c) => c.y < 40)) > radio(co.filter((c) => c.y > 100)) * 1.2, "cono orgánico: se achica hacia arriba");
}
{
  const arbol = armarForma({ clase: "arbol", tronco: { altoCm: 60, formatoId: "R-12", infladoCm: 25, codigo: "074" }, copa: { diametroCm: 80, globo: { formatoId: "R-9", infladoCm: 18 }, colores: { codigos: ["032", "030"], patron: "degradado" }, achatado: 0.8, acento: { formatoId: "C-12", infladoCm: 14, codigos: ["015"], cada: 2 } } });
  const tronco = arbol.globos.filter((g) => g.codigo === "074").map(centro), copa = arbol.globos.filter((g) => g.formatoId === "R-9").map(centro);
  assert.ok(Math.min(...copa.map((c) => c.y)) > Math.max(...tronco.map((c) => c.y)) - 25, "árbol: la copa va encima del tronco");
  assert.ok(Math.max(...tronco.map((c) => Math.hypot(c.x, c.z))) < Math.max(...copa.map((c) => Math.hypot(c.x, c.z))), "árbol: la copa es más ancha que el tronco");
  const corazones = arbol.globos.filter((g) => g.formatoId === "C-12");
  assert.ok(corazones.length > 0 && corazones.every((g) => g.frente), "árbol: los corazones llevan su cara (frente)");
  const copaAlto = Math.max(...copa.map((c) => c.y)) - Math.min(...copa.map((c) => c.y)), copaAncho = Math.max(...copa.map((c) => c.x)) - Math.min(...copa.map((c) => c.x));
  assert.ok(copaAlto < copaAncho * 0.92, "árbol: copa achatada");
}
{
  const aero = armarPieza({ tipo: "forma", forma: { clase: "aerostatico", globo: { diametroCm: 78, globo: { formatoId: "R-12", infladoCm: 22 }, colores: { codigos: ["873"], patron: "un_color" } }, canasta: { formatoId: "R-12", infladoCm: 18, codigo: "873", porAnillo: 6, anillos: 2 }, cuerdasCm: 45 } });
  const ys = aero.globos.map((g) => centro(g).y);
  assert.ok(Math.min(...ys) < 15 && Math.max(...ys) > 120, "aerostático: canasta abajo y globo arriba");
  assert.equal(aero.tubos.length, 4, "aerostático: cuatro cuerdas");
  assert.ok(aero.tubos.every((t) => t.papel), "aerostático: las cuerdas no son globo");
  assert.equal(aero.materiales.reduce((s, m) => s + m.cantidad, 0), aero.globos.length, "aerostático: solo cotizan los globos");
}
informe.push("volúmenes (esfera, cono de anillos y orgánico, árbol, aerostático)");

// ----------------------------------------------------------------------------------------------------------
// 5. Ideas de sempertex.com
// ----------------------------------------------------------------------------------------------------------

assert.ok(IDEAS_FORMAS.length >= 8 && IDEAS_FORMAS.length <= 12, `entre 8 y 12 ideas (${IDEAS_FORMAS.length})`);
assert.equal(new Set(IDEAS_FORMAS.map((i) => i.id)).size, IDEAS_FORMAS.length, "una vez cada idea");
const texto = JSON.stringify([IDEAS_FORMAS, FORMAS_BASICAS]);
assert.ok(!/[A-Za-z]:\\\\|\/Users\/|\.jpe?g|\.png|\.webp/i.test(texto), "sin rutas absolutas ni imágenes");
for (const idea of IDEAS_FORMAS) {
  const contexto = `idea #${idea.id} ${idea.slug}`;
  assert.equal(idea.url, `https://sempertex.com/blogs/idea-de-fiesta/${idea.slug}`, `${contexto}: url`);
  assert.ok(idea.nota.length > 40 && /No:/.test(idea.nota) && /Se parece:/.test(idea.nota), `${contexto}: nota honesta (qué se parece y qué no)`);
  assert.ok(idea.productos.length > 0, `${contexto}: productos`);
  for (const p of idea.productos) assert.ok(coloresDelFormato(p.formatoId).some((r) => r.codigo === p.codigo), `${contexto}: ${p.formatoId} ${p.codigo} existe`);
  const armada = armarPieza(idea.pieza);
  assert.ok(armada.globos.length + armada.tubos.length > 10, `${contexto}: arma`);
  coloresExisten(armada, contexto);
  // Los colores salen de los productos de la idea (de la ficha o, si no trae, de los leídos de la foto).
  const codigos = new Set(idea.productos.map((p) => p.codigo));
  for (const m of armada.materiales) assert.ok(codigos.has(m.codigo), `${contexto}: el color ${m.codigo} (${m.formatoId}) está en sus productos`);
  assert.equal(JSON.stringify(armarPieza(structuredClone(idea.pieza))), JSON.stringify(armada), `${contexto}: determinista`);
}
const conMiniatura = formasConMiniatura();
assert.equal(conMiniatura.length, IDEAS_FORMAS.length + FORMAS_BASICAS.length, "todas con miniatura");
for (const f of conMiniatura) {
  const armada = armarPieza(f.pieza);
  assert.equal(f.miniatura.formas.length, armada.globos.length + armada.tubos.length, `${f.nombre}: una forma de la miniatura por globo o tubito`);
  assert.ok(f.miniatura.caja.ancho > 0 && f.miniatura.formas.every((x) => /^#[0-9a-f]{6}$/i.test(x.hex)), `${f.nombre}: miniatura con caja y colores`);
}

// A una escena: en el piso y en la pared; los materiales suben exactamente lo de la pieza.
let escena: Escena = { sala: structuredClone(SALA_INICIAL), nodos: [] };
const vacia = armarEscena(escena);
assert.equal(vacia.materiales.length, 0, "escena vacía");
const idea = IDEAS_FORMAS.find((i) => i.id === 46)!;
const puesta = agregarIdeaForma(escena, idea, { en: "piso" });
escena = puesta.escena;
const armadaEscena = armarEscena(escena);
const nodo = armadaEscena.porNodo.find((n) => n.id === puesta.id)!;
assert.ok(nodo && nodo.avisos.length === 0, "la idea se arma en la escena");
assert.ok(Math.abs(nodo.caja.min.y) < 1, "apoyada en el piso");
const materialesPieza = armarPieza(idea.pieza).materiales;
assert.equal(armadaEscena.materiales.reduce((s, m) => s + m.cantidad, 0), materialesPieza.reduce((s, m) => s + m.cantidad, 0), "los materiales de la escena son los de la pieza");
const enPared = agregarIdeaForma(escena, IDEAS_FORMAS.find((i) => i.id === 425)!, { en: "pared" });
const conPared = armarEscena(enPared.escena).porNodo.find((n) => n.id === enPared.id)!;
assert.ok(conPared.caja.min.z <= -SALA_INICIAL.fondoCm / 2 + 1 && Math.abs(conPared.caja.min.y - 60) < 1, "en la pared del fondo, a 60 cm");
assert.notEqual(enPared.id, puesta.id, "ids distintos");
informe.push(`${IDEAS_FORMAS.length} ideas + ${FORMAS_BASICAS.length} básicas`);

// ----------------------------------------------------------------------------------------------------------
// 6. El motor orgánico no cambió
// ----------------------------------------------------------------------------------------------------------

const organico = execSync("npx tsx scripts/test/test-organico3d.ts", { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
assert.match(organico, /OK test-organico3d/, "test-organico3d sigue pasando");

console.log(`OK test-formas-letras: ${informe.join("; ")}; ${Date.now() - t0} ms`);
