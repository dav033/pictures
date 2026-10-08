/**
 * Murales pixelados, decoraciones de techo y palmeras/árboles de globos (`murales.ts`, `techo.ts`, `arboles-globos.ts`).
 * Sin coste: no llama a ninguna IA ni a la red.
 * - el mural reproduce su matriz celda a celda: cada celda con color lleva un globo de ese color en su sitio (y del
 *   papel que le toca: grande, chico, unión o eslabón), las de hueco no llevan, y no hay globos de más; el paso sale de
 *   los globos y los globos de la retícula no se pisan más de lo que se aplastan;
 * - el convertidor «imagen → matriz» cuantiza a la paleta oficial del formato, respeta el máximo de colores, los códigos
 *   pedidos, el fondo y los huecos de la disposición;
 * - todos los colores existen en su formato; uno que no se fabrica es un error;
 * - lo de techo cuelga bajo el techo (y ≤ 0, lo más alto en y = 0) y, puesto en una sala, queda entre el techo y el
 *   piso; las catenarias de los festones son catenarias (extremos a la misma altura, caída pedida) y no atraviesan
 *   globos que no son los suyos;
 * - la palmera y el árbol se apoyan en el piso (lo más bajo en y = 0), el tronco sube y la palmera se curva;
 * - todo es determinista (dos veces lo mismo) y lo predefinido de «Decoraciones pequeñas» arma con su miniatura.
 */
import assert from "node:assert/strict";
import { armarPieza, type Pieza } from "../../src/lib/globos3d/piezas";
import { coloresDelFormato, formatoPorId, infladoValido } from "../../src/lib/globos3d/formatos";
import { centroDe } from "../../src/lib/globos3d/letras";
import { armarEscena, SALA_INICIAL } from "../../src/lib/globos3d/escena";
import { armarMural, celdasMural, codigoDeCelda, matrizDesdeImagen, MURALES_PREDEFINIDOS, pasoMural, rolDeCelda, SIMBOLOS_MURAL, tamanoMatriz, type OpcionesMural } from "../../src/lib/globos3d/murales";
import { armarTecho, parametroCatenaria, puntosCatenaria, TECHOS_PREDEFINIDOS, type OpcionesTecho } from "../../src/lib/globos3d/techo";
import { armarArbolGlobos, ARBOLES_PREDEFINIDOS, type OpcionesArbolGlobos } from "../../src/lib/globos3d/arboles-globos";
import { colocacionDe, GRUPOS_MURAL_TECHO_ARBOL, muralesTechoArbolesConMiniatura } from "../../src/lib/globos3d/catalogo-murales-techo-arboles";
import type { GloboDecoracion } from "../../src/lib/globos3d/decoraciones";

const existe = (formatoId: string, codigo: string) => coloresDelFormato(formatoId).some((c) => c.codigo === codigo);
const dist = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

function coloresValidos(globos: readonly GloboDecoracion[], tubos: ReadonlyArray<{ formatoId: string; codigo: string; papel?: unknown }>, que: string) {
  for (const g of globos) {
    assert.ok(existe(g.formatoId, g.codigo), `${que}: ${g.codigo} se fabrica en ${g.formatoId}`);
    const f = formatoPorId(g.formatoId)!;
    assert.ok(Math.abs(infladoValido(f, g.infladoCm) - g.infladoCm) < 0.05, `${que}: inflado ${g.infladoCm} cabe en ${g.formatoId}`);
  }
  for (const t of tubos) if (!t.papel) assert.ok(existe(t.formatoId, t.codigo), `${que}: tubito ${t.codigo} se fabrica en ${t.formatoId}`);
}

// ----------------------------------------------------------------------------------------------------------
// 1. El mural reproduce la matriz celda a celda
// ----------------------------------------------------------------------------------------------------------

const PRUEBA: Record<string, OpcionesMural> = {
  simple: { disposicion: "simple", grande: { formatoId: "R-5", infladoCm: 12 }, chico: null, matriz: { colores: ["041", "020", "015"], filas: ["abca.", "bbbbb", ".cacb"] } },
  tablero: { disposicion: "tablero", grande: { formatoId: "R-12", infladoCm: 25 }, chico: { formatoId: "R-5", infladoCm: 12 }, matriz: { colores: ["005", "015"], filas: ["ababa", "babab", "aab.a", "bbbbb"] } },
  rejilla: { disposicion: "rejilla", grande: { formatoId: "R-9", infladoCm: 16 }, chico: { formatoId: "R-5", infladoCm: 8 }, matriz: { colores: ["061", "009", "005"], filas: ["aaaaa", "a.b.c", "abcab", "c.c.c", "bbbbb"] } },
  malla: { disposicion: "malla", grande: { formatoId: "LOL-12", infladoCm: 22 }, chico: { formatoId: "R-5", infladoCm: 10 }, matriz: { colores: ["032", "021", "041"], filas: ["aaaaaaa", "a.b.c.a", "abbbcca", "a.a.a.a", "aaaaaaa"] } },
};

for (const [nombre, o] of Object.entries(PRUEBA)) {
  const armado = armarMural(o);
  const { filas, columnas } = tamanoMatriz(o.matriz);
  const { celdas, pasoCm } = celdasMural(o);
  assert.equal(celdas.length, filas * columnas, `${nombre}: una celda por carácter`);
  assert.equal(pasoCm, pasoMural(o), `${nombre}: el paso de las celdas`);
  // Cada globo de la retícula, con su celda: la más cercana a su centro (la unión son dos globos en el mismo nudo).
  const usados = new Map<string, GloboDecoracion[]>();
  for (const g of armado.globos) {
    const c = centroDe(g);
    let mejor = celdas[0]!, d = Infinity;
    for (const x of celdas) { const e = Math.hypot(x.centro.x - c.x, x.centro.y - c.y); if (e < d) { d = e; mejor = x; } }
    assert.ok(d <= (o.disposicion === "malla" ? pasoCm * 0.05 + 0.2 : 0.2), `${nombre}: el globo ${g.formatoId} ${g.codigo} cae en el centro de una celda (a ${d.toFixed(2)} cm)`);
    const clave = `${mejor.fila},${mejor.columna}`;
    usados.set(clave, [...(usados.get(clave) ?? []), g]);
  }
  for (const c of celdas) {
    const esperado = c.rol === "hueco" ? null : codigoDeCelda(o.matriz, c.fila, c.columna);
    const globos = usados.get(`${c.fila},${c.columna}`) ?? [];
    if (esperado === null) { assert.equal(globos.length, 0, `${nombre}: la celda ${c.fila},${c.columna} va sin globo`); continue; }
    assert.equal(globos.length, c.rol === "union" ? 2 : 1, `${nombre}: la celda ${c.fila},${c.columna} (${c.rol}) lleva ${c.rol === "union" ? "su pareja" : "un globo"}`);
    for (const g of globos) {
      assert.equal(g.codigo, esperado, `${nombre}: la celda ${c.fila},${c.columna} es ${esperado}`);
      const formato = c.rol === "chico" || c.rol === "union" ? o.chico!.formatoId : o.grande.formatoId;
      assert.equal(g.formatoId, formato, `${nombre}: la celda ${c.fila},${c.columna} (${c.rol}) es de ${formato}`);
    }
    assert.equal(c.rol, rolDeCelda(o.disposicion, c.fila, c.columna), `${nombre}: papel de la celda`);
  }
  // La retícula no se pisa: dos globos redondos distintos, a no menos del 88 % de la suma de radios (12 % de aplaste).
  if (o.disposicion !== "malla") {
    for (let i = 0; i < armado.globos.length; i++) for (let j = i + 1; j < armado.globos.length; j++) {
      const a = armado.globos[i]!, b = armado.globos[j]!;
      assert.ok(dist(centroDe(a), centroDe(b)) >= 0.88 * (a.infladoCm + b.infladoCm) / 2 - 0.05, `${nombre}: los globos ${i} y ${j} no se pisan`);
    }
  }
  coloresValidos(armado.globos, armado.tubos, `mural ${nombre}`);
  assert.ok(Math.abs(armarPieza({ tipo: "mural", mural: o }).caja.min.y) < 0.6, `${nombre}: el mural se apoya en y = 0`);
}
// Los huecos de la disposición que traen color se avisan (y no llevan globo).
assert.equal(armarMural({ ...PRUEBA.malla!, matriz: { colores: ["032"], filas: ["aaa", "aaa", "aaa"] } }).avisos.length, 1, "malla: la celda (1,1) con color se avisa");
// Un color que no se fabrica en ese formato es un error, no se cambia a escondidas.
assert.throws(() => armarMural({ ...PRUEBA.malla!, matriz: { colores: ["016"], filas: ["aaa"] } }), /no se fabrica en LOL-12/, "Rojo Imperial no viene en Link-O-Loon 12");
assert.throws(() => armarMural({ ...PRUEBA.simple!, matriz: { colores: ["041"], filas: ["ab"] } }), /no tiene color/, "un símbolo sin color es un error");
assert.throws(() => armarMural({ ...PRUEBA.simple!, matriz: { colores: ["041"], filas: ["aa", "a"] } }), /fila 2/, "las filas van del mismo largo");
console.log("OK mural: cada celda de la matriz, un globo de su color y su papel en su sitio; huecos sin globo; nada se pisa");

// ----------------------------------------------------------------------------------------------------------
// 2. Imagen de referencia → matriz
// ----------------------------------------------------------------------------------------------------------

{
  // Una imagen de 40 × 30: fondo blanco, un rectángulo rojo y uno azul rey; con ruido de brillo determinista.
  const ancho = 40, alto = 30;
  const datos = new Uint8ClampedArray(ancho * alto * 4);
  for (let y = 0; y < alto; y++) for (let x = 0; x < ancho; x++) {
    const k = (y * ancho + x) * 4;
    const ruido = ((x * 7 + y * 13) % 11) - 5;
    const [r, g, b] = x >= 4 && x < 20 && y >= 4 && y < 26 ? [224, 27, 43] : x >= 20 && x < 36 && y >= 4 && y < 26 ? [45, 79, 156] : [255, 255, 255];
    datos[k] = r + ruido; datos[k + 1] = g + ruido; datos[k + 2] = b + ruido; datos[k + 3] = 255;
  }
  const img = { ancho, alto, datos };
  const m = matrizDesdeImagen(img, { columnas: 10, filas: 6, formatoId: "R-12", maxColores: 4, fondo: { hex: "#ffffff" } });
  assert.deepEqual(m.colores, ["015", "041"], "los dos colores oficiales más cercanos (Rojo y Azul Rey), en orden de aparición");
  assert.equal(m.filas.length, 6);
  assert.ok(m.filas.every((f) => f.length === 10));
  assert.equal(m.filas[0], "..........", "el fondo queda sin globo");
  assert.equal(m.filas[2], ".aaaabbbb.", "rojo a la izquierda, azul a la derecha");
  for (const c of m.colores) assert.ok(existe("R-12", c), `${c} se fabrica en R-12`);
  // Solo con un color: todo lo que no es fondo, a ese color.
  const uno = matrizDesdeImagen(img, { columnas: 10, filas: 6, formatoId: "R-12", maxColores: 1, fondo: { hex: "#ffffff" } });
  assert.equal(uno.colores.length, 1, "máximo de colores");
  assert.equal(uno.filas[2], ".aaaaaaaa.");
  // Los códigos pedidos mandan; sin fondo, el blanco también es globo.
  const pedidos = matrizDesdeImagen(img, { columnas: 10, filas: 6, formatoId: "LOL-12", maxColores: 3, codigos: ["015", "005", "041"] });
  assert.ok(pedidos.colores.every((c) => ["015", "005", "041"].includes(c)) && pedidos.colores.includes("005"), "solo los códigos pedidos (y el blanco es globo)");
  assert.ok(!pedidos.filas.join("").includes("."), "sin fondo no hay huecos");
  const conMalla = matrizDesdeImagen(img, { columnas: 9, filas: 5, formatoId: "LOL-12", maxColores: 3, codigos: ["015", "005", "041"], disposicion: "malla" });
  assert.equal(conMalla.filas[1]![1], ".", "los huecos de la malla salen «.»");
  assert.deepEqual(matrizDesdeImagen(img, { columnas: 10, filas: 6, formatoId: "R-12", maxColores: 4, fondo: { hex: "#ffffff" } }), m, "determinista");
  // Lo que sale se puede armar tal cual.
  armarMural({ disposicion: "tablero", grande: { formatoId: "R-12", infladoCm: 25 }, chico: { formatoId: "R-5", infladoCm: 12 }, matriz: m });
}
assert.equal(SIMBOLOS_MURAL[0], "a");
console.log("OK convertidor: paleta oficial del formato, máximo de colores, códigos pedidos, fondo y huecos de la disposición");

// ----------------------------------------------------------------------------------------------------------
// 3. Techo: cuelga bajo el techo; catenarias que no atraviesan globos
// ----------------------------------------------------------------------------------------------------------

{
  // La catenaria: extremos a la misma altura y la caída pedida en el medio.
  const curva = puntosCatenaria(240, 80);
  assert.ok(Math.abs(curva[0]!.y) < 1e-6 && Math.abs(curva[curva.length - 1]!.y) < 1e-6, "extremos a la altura del techo");
  assert.ok(Math.abs(Math.min(...curva.map((p) => p.y)) + 80) < 0.5, "cae 80 cm en el medio");
  const a = parametroCatenaria(240, 80);
  assert.ok(Math.abs(a * (Math.cosh(120 / a) - 1) - 80) < 0.01, "y = a·(cosh(x/a) − 1)");
}

const TECHO_PRUEBA: OpcionesTecho = {
  elementos: [
    { tipo: "festones", puntos: [{ xCm: -250, zCm: -60 }, { xCm: 0, zCm: 0 }, { xCm: 250, zCm: -60 }], caidaCm: 80, guirnalda: { formatoId: "R-9", infladoCm: 18, patron: "dos_colores", colores: ["023", "080"] }, remate: { formatoId: "R-24", infladoCm: 55, codigo: "080" } },
    { tipo: "red", tecnica: "racimos", anchoCm: 120, fondoCm: 80, globo: { formatoId: "R-12", infladoCm: 25 }, colores: ["009", "005"], patron: "damero", centro: { xCm: 0, zCm: 150 } },
    { tipo: "tira", punto: { xCm: -150, zCm: 150 }, hiloCm: 40, globos: [{ formatoId: "R-9", infladoCm: 20, codigo: "061", cantidad: 1 }, { formatoId: "R-5", infladoCm: 11, codigo: "031", cantidad: 2 }], flecos: { formatoId: "T-260", codigo: "061", cantidad: 3, largoCm: 60, aperturaCm: 15, racimo: { formatoId: "R-5", infladoCm: 11, codigos: ["020", "051"], globos: 4 } } },
    { tipo: "helio", puntos: [{ xCm: 150, zCm: 150 }, { xCm: 190, zCm: 170 }], globo: { formatoId: "R-12", infladoCm: 28 }, codigos: ["011"], cintaCm: 100, cintaHex: "#ffffff" },
  ],
};

function revisarTecho(o: OpcionesTecho, que: string) {
  const t = armarTecho(o);
  const pieza: Pieza = { tipo: "techo", techo: o };
  const armada = armarPieza(pieza);
  assert.ok(armada.globos.length > 0, `${que}: tiene globos`);
  assert.ok(Math.abs(armada.caja.max.y) < 0.6, `${que}: lo más alto toca el techo (y = 0; ${armada.caja.max.y.toFixed(2)})`);
  for (const g of t.globos) assert.ok(centroDe(g).y < 0, `${que}: cada globo cuelga bajo el techo`);
  for (const x of t.tubos) for (const p of x.puntos) assert.ok(p.y <= 0.01, `${que}: los tubitos bajo el techo`);
  coloresValidos(t.globos, t.tubos, que);
  // Las catenarias no atraviesan globos ajenos (los del festón rodean su propio eje).
  for (const c of t.catenarias) {
    for (const p of c.puntos) {
      t.globos.forEach((g, k) => {
        if (k >= c.desde && k < c.hasta) return;
        assert.ok(dist(p, centroDe(g)) > g.infladoCm / 2 - 0.5, `${que}: la catenaria no atraviesa el globo ${k} (${g.formatoId} ${g.codigo})`);
      });
    }
    // Y su eje no sube del techo ni pasa de la caída pedida más lo que la separa del techo.
    assert.ok(c.puntos.every((p) => p.y < 0), `${que}: la catenaria va bajo el techo`);
  }
  // Puesta en una sala con la colocación «techo»: entre el techo y el piso, pegada al techo.
  const escena = armarEscena({ sala: SALA_INICIAL, nodos: [{ id: "t", nombre: "Techo", pieza, colocacion: { en: "techo", xCm: 0, zCm: 0, cuelgaCm: 0, giroGrados: 0, volteada: false } }] });
  assert.deepEqual(escena.avisos, [], `${que}: arma sin avisos`);
  const caja = escena.porNodo[0]!.caja;
  assert.ok(Math.abs(caja.max.y - SALA_INICIAL.altoCm) < 0.6 && caja.min.y > 0, `${que}: en la sala, bajo el techo y sobre el piso (${caja.min.y.toFixed(0)}–${caja.max.y.toFixed(0)})`);
  assert.deepEqual(armarTecho(o), t, `${que}: determinista`);
  return t;
}
const techo = revisarTecho(TECHO_PRUEBA, "techo de prueba");
assert.equal(techo.catenarias.length, 2, "dos festones entre tres puntos");
assert.equal(techo.globos.filter((g) => g.formatoId === "R-24").length, 3, "un remate en cada punto");
assert.equal(techo.escenografia.length, 3, "un hilo de la tira y dos cintas de helio");
for (const t of TECHOS_PREDEFINIDOS) revisarTecho(t.techo, t.id);
assert.throws(() => armarTecho({ elementos: [{ tipo: "helio", puntos: [{ xCm: 0, zCm: 0 }], globo: { formatoId: "R-12", infladoCm: 28 }, codigos: ["999"], cintaCm: 50, cintaHex: "#fff" }] }), /no se fabrica/);
assert.throws(() => armarTecho({ elementos: [{ ...(TECHO_PRUEBA.elementos[0] as Extract<OpcionesTecho["elementos"][number], { tipo: "festones" }>), puntos: [{ xCm: 0, zCm: 0 }, { xCm: 60, zCm: 0 }] }] }), /demasiado juntos/);
console.log("OK techo: red, festones en catenaria, tiras y helio cuelgan bajo el techo; las catenarias no atraviesan globos");

// ----------------------------------------------------------------------------------------------------------
// 4. Palmera y árbol: se apoyan en el piso
// ----------------------------------------------------------------------------------------------------------

function revisarArbol(o: OpcionesArbolGlobos, que: string) {
  const a = armarArbolGlobos(o);
  const armada = armarPieza({ tipo: "arbol_globos", arbol: o });
  assert.ok(Math.abs(armada.caja.min.y) < 0.6, `${que}: se apoya en el piso (y = ${armada.caja.min.y.toFixed(2)})`);
  for (const g of a.globos) assert.ok(centroDe(g).y > 0, `${que}: ningún globo bajo el piso`);
  coloresValidos(a.globos, a.tubos, que);
  // El eje del tronco sube, y con curva su punta se corre a +x.
  for (let i = 1; i < a.eje.length; i++) assert.ok(a.eje[i]!.y > a.eje[i - 1]!.y, `${que}: el tronco sube`);
  const punta = a.eje[a.eje.length - 1]!, pie = a.eje[0]!;
  if (o.tronco.curvaCm > 0) assert.ok(punta.x - pie.x > o.tronco.curvaCm * 0.7, `${que}: la punta se corre ${o.tronco.curvaCm} cm (${(punta.x - pie.x).toFixed(1)})`);
  else assert.ok(Math.abs(punta.x - pie.x) < 0.5, `${que}: tronco recto`);
  assert.ok(punta.y - pie.y > o.tronco.altoCm * 0.85, `${que}: el tronco mide lo pedido`);
  if (o.copa.tipo === "palmera") {
    assert.equal(a.tubos.length, o.copa.hojas.cantidad, `${que}: una hoja por tubito`);
    for (const h of a.tubos) {
      assert.ok(dist(h.puntos[0]!, punta) < 30, `${que}: la hoja nace en la punta del tronco`);
      assert.ok(Math.max(...h.puntos.map((p) => p.y)) > h.puntos[0]!.y, `${que}: la hoja sube`);
      assert.ok(h.puntos[h.puntos.length - 1]!.y < Math.max(...h.puntos.map((p) => p.y)) - 5, `${que}: y se dobla hacia abajo`);
    }
  } else {
    const racimos = o.copa;
    const copa = a.globos.filter((g) => g.formatoId === racimos.globo.formatoId && racimos.colores.includes(g.codigo));
    assert.ok(copa.length >= 24 && copa.length % 4 === 0, `${que}: racimos de cuatro (${copa.length})`);
    assert.ok(Math.min(...copa.map((g) => centroDe(g).y)) > pie.y + o.tronco.altoCm * 0.5, `${que}: la copa va arriba`);
  }
  assert.deepEqual(armarArbolGlobos(o), a, `${que}: determinista`);
}
for (const x of ARBOLES_PREDEFINIDOS) revisarArbol(x.arbol, x.id);
revisarArbol({ tronco: { formatoId: "R-5", infladoBaseCm: 10, infladoPuntaCm: 9, altoCm: 70, colores: ["074", "076"], curvaCm: 25, base: { formatoId: "R-9", infladoCm: 14, codigo: "074", cantidad: 4 } }, copa: { tipo: "palmera", hojas: { formatoId: "LOL-660", codigos: ["032"], cantidad: 6, largoCm: 60 }, cocos: { formatoId: "R-5", infladoCm: 11, codigo: "074", cantidad: 3 } } }, "palmera de LOL-660");
assert.throws(() => armarArbolGlobos({ tronco: { formatoId: "R-9", infladoBaseCm: 18, infladoPuntaCm: 16, altoCm: 80, colores: ["076"], curvaCm: 0 }, copa: ARBOLES_PREDEFINIDOS[1]!.arbol.copa }), /no se fabrica en R-9/, "Chocolate no viene en R-9");
console.log("OK palmeras y árboles: apoyados en el piso, tronco que sube (y se curva), hojas que se arquean, copa de racimos arriba");

// ----------------------------------------------------------------------------------------------------------
// 5. Determinismo, murales predefinidos y «Decoraciones pequeñas»
// ----------------------------------------------------------------------------------------------------------

for (const m of MURALES_PREDEFINIDOS) {
  const a = armarMural(m.mural);
  assert.deepEqual(a.avisos, [], `${m.id}: sin avisos`);
  coloresValidos(a.globos, a.tubos, m.id);
  assert.deepEqual(armarMural(m.mural), a, `${m.id}: determinista`);
}
const catalogo = muralesTechoArbolesConMiniatura();
assert.deepEqual(GRUPOS_MURAL_TECHO_ARBOL.map((g) => g.nombre), ["Murales", "Techo", "Árboles y palmeras"], "los tres grupos");
for (const g of GRUPOS_MURAL_TECHO_ARBOL) assert.ok(catalogo.filter((p) => p.grupo === g.id).length >= 2, `${g.nombre}: al menos dos`);
for (const p of catalogo) {
  assert.ok(p.miniatura.formas.length > 0 && p.miniatura.caja.ancho > 0, `${p.id}: miniatura con formas`);
  assert.ok(p.globos > 0, `${p.id}: cuenta globos`);
}
assert.equal(new Set(catalogo.map((p) => p.id)).size, catalogo.length, "ids sin repetir");
assert.equal(colocacionDe({ sala: SALA_INICIAL, nodos: [] }, "murales").en, "pared");
assert.equal(colocacionDe({ sala: SALA_INICIAL, nodos: [] }, "techo").en, "techo");
assert.equal(colocacionDe({ sala: SALA_INICIAL, nodos: [] }, "arboles").en, "piso");
console.log(`OK «Decoraciones pequeñas»: ${catalogo.length} piezas en Murales, Techo y Árboles y palmeras, con miniatura; todo determinista`);
