/**
 * La lectura medida con los globos detectados (`medir-con-detecciones.ts`) y el mosaico de la detección. Sin coste ni red: las
 * detecciones son cajas sintéticas.
 * - tamaños: los escalones salen de las cajas (diámetros y formatos), la escala de la foto de los globos, el grosor por tramo
 *   (un lado más grueso que el otro), las esquinas del eje que leyó el modelo se conservan;
 * - colores: cada palabra del detector se casa con el color de la pieza más cercano en CIELAB (plateado ≠ plata por el comienzo
 *   del nombre, azul ≠ azul marino), el confeti y lo transparente por acabado; los pesos quedan en una sola escala;
 * - anclas: los grandes y gigantes uno por uno, con su diámetro, con tope de 80 y el resultado cumple el esquema;
 * - con menos de 15 globos la pieza queda igual; los globos de columnas y otras piezas no ensucian la guirnalda; el montón de
 *   piso se mide aparte; los fondos van a su caja detectada;
 * - mosaico: trozos con solape, cajas repetidas fundidas y los medios globos cortados por el borde de un trozo descartados.
 *
 * Run: npx tsx --conditions=react-server scripts/test/test-medir-detecciones.ts
 */
import assert from "node:assert/strict";
import { crearAzar } from "../../src/lib/globos3d/organico";
import { LecturaFotoSchema, type ColorLeido, type LecturaFoto, type PiezaLeida } from "../../src/lib/globos3d/lectura-foto";
import { coloresDe, coloresPorEscalonDe, dominantesPorTramo, indiceDeDetectado } from "../../src/lib/globos3d/medir-colores";
import { medirConDetecciones, type GloboDetectado } from "../../src/lib/globos3d/medir-con-detecciones";
import { ejeMedido, globosDe, type Globo } from "../../src/lib/globos3d/medir-geometria";
import { medirFondos } from "../../src/lib/globos3d/medir-fondos";
import { fundirRepetidas, tocaBordeDeTrozo, trozosDelMosaico } from "../../src/lib/globos3d/mosaico-deteccion";

let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };

/** Un globo ya medido (las cuentas de color solo miran su diámetro y su color). */
const unGlobo = (d: number, color: string): Globo => ({ x: 0, y: 0, d, w: d, h: d, color, entero: true });

type Guirnalda = Extract<PiezaLeida, { tipo: "guirnalda_organica" }>;
type Monton = Extract<PiezaLeida, { tipo: "racimo_piso" }>;

const ASPECTO = 1;
const ESCALA_REAL = 300;
/** Diámetro de cada formato como se ve atado en una guirnalda (los de `INFLADOS_TRAZO`), en fracción del alto de la foto a 300 cm. */
const D = { gigante: 75 / ESCALA_REAL, grande: 34 / ESCALA_REAL, mediano: 25 / ESCALA_REAL, chico: 12 / ESCALA_REAL };

const DORADO: ColorLeido = { nombre: "dorado", hex: "#D4AF37", peso: 60, acabado: "cromado" };
const BLANCO: ColorLeido = { nombre: "blanco", hex: "#F5F5F5", peso: 40, acabado: "mate" };

const guirnalda = (puntos: Guirnalda["puntos"], extra: Partial<Guirnalda> = {}): Guirnalda => ({
  tipo: "guirnalda_organica", puntos, tamanos: {}, racimos: 0.4, colores: [DORADO, BLANCO],
  mezcla: { gigantes: 5, grandes: 25, medianos: 50, chicos: 20, diametroGigante: 0.3, diametroGrande: 0.13, diametroMediano: 0.09, diametroChico: 0.05, formatoGigante: "R-36", formatoGrande: "R-18", formatoMediano: "R-12", formatoChico: "R-5" },
  ...extra,
});
const lectura = (piezas: PiezaLeida[], extra: Partial<LecturaFoto> = {}): LecturaFoto => ({
  resumen: "arco de prueba", aspecto: ASPECTO, escala: { altoImagenCm: ESCALA_REAL, referencia: "prueba" }, pisoY: 0.9, sala: { pared: "#f0f0f0", piso: "#dddddd" }, piezas, ...extra,
});

/** Una caja de la detección (ymin, xmin, ymax, xmax en 0-1000) de un globo con su centro y diámetro en unidades de alto. */
const caja = (cx: number, cy: number, d: number, color: string): GloboDetectado => ({
  box_2d: [Math.round((cy - d / 2) * 1000), Math.round(((cx - d / 2) / ASPECTO) * 1000), Math.round((cy + d / 2) * 1000), Math.round(((cx + d / 2) / ASPECTO) * 1000)], color,
});

const EJE_FESTON = [{ x: 0.12, y: 0.55, grosor: 0.14 }, { x: 0.3, y: 0.32, grosor: 0.14 }, { x: 0.5, y: 0.24, grosor: 0.14 }, { x: 0.7, y: 0.32, grosor: 0.14 }, { x: 0.88, y: 0.55, grosor: 0.14 }];

/**
 * Globos repartidos a lo largo de un eje, de a `capas` filas desplazadas lateralmente: la mezcla de diámetros dada (`d` y cuántos),
 * los colores en el orden dado.
 */
function globosAlLargo(eje: ReadonlyArray<{ x: number; y: number }>, cuantos: Array<[number, number]>, colores: readonly string[], opciones: { semilla?: number; lateral?: number; desde?: number; hasta?: number; ruido?: number } = {}): GloboDetectado[] {
  const azar = crearAzar(opciones.semilla ?? 3);
  const largos = [0];
  for (let i = 1; i < eje.length; i++) largos.push(largos[i - 1]! + Math.hypot(eje[i]!.x - eje[i - 1]!.x, eje[i]!.y - eje[i - 1]!.y));
  const total = largos[largos.length - 1]!;
  const lista = cuantos.flatMap(([d, n]) => Array.from({ length: n }, () => d));
  // Barajada determinista.
  for (let i = lista.length - 1; i > 0; i--) { const j = Math.floor(azar() * (i + 1)); [lista[i], lista[j]] = [lista[j]!, lista[i]!]; }
  const salida: GloboDetectado[] = [];
  lista.forEach((d, k) => {
    const t = (opciones.desde ?? 0) + ((k + azar()) / lista.length) * ((opciones.hasta ?? 1) - (opciones.desde ?? 0));
    const meta = t * total;
    let i = 1;
    while (i < eje.length - 1 && largos[i]! < meta) i++;
    const a = eje[i - 1]!, b = eje[i]!, u = (meta - largos[i - 1]!) / ((largos[i]! - largos[i - 1]!) || 1);
    const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const normal = { x: -(b.y - a.y) / l, y: (b.x - a.x) / l };
    const lado = (azar() * 2 - 1) * (opciones.lateral ?? 0.03);
    const real = d * (1 + (azar() * 2 - 1) * (opciones.ruido ?? 0));
    salida.push(caja(a.x + (b.x - a.x) * u + normal.x * lado, a.y + (b.y - a.y) * u + normal.y * lado, real, colores[k % colores.length]!));
  });
  return salida;
}

const MEZCLA_COMUN: Array<[number, number]> = [[D.gigante, 3], [D.grande, 14], [D.mediano, 40], [D.chico, 14]];
const garlandaDe = (l: LecturaFoto) => l.piezas.find((p): p is Guirnalda => p.tipo === "guirnalda_organica")!;

console.log("Tamaños, escala y tramos");
const base = lectura([guirnalda(EJE_FESTON)]);
const deteccionBase = globosAlLargo(EJE_FESTON, MEZCLA_COMUN, ["dorado", "blanco", "dorado"]);

prueba("los diámetros y formatos de cada escalón salen de las cajas, y la escala de la foto de los globos", () => {
  const sinEscala = { ...base, escala: { altoImagenCm: 200, referencia: "a ojo" } };
  const r = medirConDetecciones(sinEscala, deteccionBase);
  const g = garlandaDe(r.lectura);
  assert.ok(Math.abs(g.mezcla!.diametroMediano! - D.mediano) < 0.012, `mediano ${g.mezcla!.diametroMediano}`);
  assert.ok(Math.abs(g.mezcla!.diametroGrande! - D.grande) < 0.02, `grande ${g.mezcla!.diametroGrande}`);
  assert.equal(g.mezcla!.formatoMediano, "R-12");
  assert.equal(g.mezcla!.formatoGrande, "R-18");
  assert.equal(g.mezcla!.formatoChico, "R-5");
  assert.equal(g.mezcla!.formatoGigante, "R-36");
  // 25 cm de un R-12 entre 0,0833 del alto: 300 cm.
  assert.ok(Math.abs(r.lectura.escala.altoImagenCm - ESCALA_REAL) < 25, `escala ${r.lectura.escala.altoImagenCm}`);
  assert.match(r.notas.join(" "), /Escala por los globos/);
  const suma = g.mezcla!.gigantes! + g.mezcla!.grandes + g.mezcla!.medianos + g.mezcla!.chicos;
  assert.ok(Math.abs(suma - 100) <= 3, `el reparto suma ${suma}`);
  assert.ok(g.mezcla!.medianos > g.mezcla!.grandes && g.mezcla!.grandes > g.mezcla!.gigantes!, JSON.stringify(g.mezcla));
});

prueba("si la escala leída ya es la de los globos (±10 %), no se toca", () => {
  const r = medirConDetecciones({ ...base, escala: { altoImagenCm: 310, referencia: "mesa" } }, deteccionBase);
  assert.equal(r.lectura.escala.altoImagenCm, 310);
  assert.equal(r.lectura.escala.referencia, "mesa");
});

prueba("el grosor se mide por tramo: el lado con dos filas sale más grueso que el de una sola fila", () => {
  const mitadIzquierda = globosAlLargo(EJE_FESTON, [[D.mediano, 24], [D.grande, 6], [D.chico, 8], [D.mediano, 24]], ["dorado", "blanco"], { desde: 0, hasta: 0.5, lateral: 0.075, semilla: 5 });
  const mitadDerecha = globosAlLargo(EJE_FESTON, [[D.mediano, 24], [D.grande, 4], [D.chico, 4]], ["dorado", "blanco"], { desde: 0.5, hasta: 1, lateral: 0.0, semilla: 6 });
  const g = garlandaDe(medirConDetecciones(base, [...mitadIzquierda, ...mitadDerecha]).lectura);
  const izq = g.puntos.filter((q) => q.x < 0.4), der = g.puntos.filter((q) => q.x > 0.6);
  const media = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
  assert.ok(media(izq.map((q) => q.grosor)) > media(der.map((q) => q.grosor)) + 0.025, `izq ${media(izq.map((q) => q.grosor)).toFixed(3)} der ${media(der.map((q) => q.grosor)).toFixed(3)}`);
});

prueba("cada punto lleva su mezcla: los gigantes de un solo lado quedan en los puntos de ese lado", () => {
  const izq = globosAlLargo(EJE_FESTON, [[D.gigante, 5], [D.mediano, 25], [D.chico, 6]], ["dorado", "blanco"], { desde: 0, hasta: 0.5, semilla: 8 });
  const der = globosAlLargo(EJE_FESTON, [[D.mediano, 30], [D.grande, 4], [D.chico, 6]], ["dorado", "blanco"], { desde: 0.5, hasta: 1, semilla: 9 });
  const g = garlandaDe(medirConDetecciones(base, [...izq, ...der]).lectura);
  const gigantes = (q: Guirnalda["puntos"][number]) => q.mezcla?.gigantes ?? 0;
  const mediaIzq = g.puntos.filter((q) => q.x < 0.4).reduce((s, q) => s + gigantes(q), 0), mediaDer = g.puntos.filter((q) => q.x > 0.6).reduce((s, q) => s + gigantes(q), 0);
  assert.ok(mediaIzq > mediaDer, `gigantes izq ${mediaIzq} der ${mediaDer}`);
});

prueba("las esquinas del eje que leyó el modelo se conservan (no se remuestrea a puntos parejos)", () => {
  const v = [{ x: 0.1, y: 0.3, grosor: 0.12 }, { x: 0.5, y: 0.8, grosor: 0.12 }, { x: 0.9, y: 0.3, grosor: 0.12 }];
  const eje = ejeMedido(v, ASPECTO);
  assert.ok(eje.length > 3 && eje.length <= 24, `${eje.length} puntos`);
  for (const q of v) assert.ok(eje.some((e) => e.origen !== null && Math.hypot(e.x - q.x, e.y - q.y) < 1e-9), "cada punto leído sigue en el eje");
  assert.equal(eje.filter((e) => e.origen !== null).length, 3);
  const r = medirConDetecciones(lectura([guirnalda(v)], { pisoY: 0.95 }), globosAlLargo(v, MEZCLA_COMUN, ["dorado", "blanco"], { lateral: 0.03 }));
  const g = garlandaDe(r.lectura);
  const esquina = g.puntos.reduce((m, q) => (q.y > m.y ? q : m));
  assert.ok(esquina.y > 0.72 && Math.abs(esquina.x - 0.5) < 0.08, `la esquina quedó en (${esquina.x}, ${esquina.y})`);
  assert.ok(g.puntos.length > 3);
});

prueba("un extremo que llega al piso no se sube; uno en el aire sí se corre hacia sus globos", () => {
  const alPiso = [{ x: 0.2, y: 0.88, grosor: 0.16 }, { x: 0.4, y: 0.4, grosor: 0.16 }, { x: 0.7, y: 0.3, grosor: 0.16 }];
  const enElAire = alPiso.map((q, i) => (i === 0 ? { ...q, y: 0.5 } : q));
  const globos = (eje: typeof alPiso) => globosAlLargo(eje, MEZCLA_COMUN, ["dorado", "blanco"], { lateral: 0.0, semilla: 4 }).map((g) => ({ ...g, box_2d: g.box_2d.map((n, i) => (i % 2 === 0 ? n + 40 : n)) as unknown as GloboDetectado["box_2d"] }));
  const primero = (l: LecturaFoto) => garlandaDe(l).puntos[0]!;
  const piso = medirConDetecciones(lectura([guirnalda(alPiso)], { pisoY: 0.95 }), globos(alPiso));
  const aire = medirConDetecciones(lectura([guirnalda(enElAire)], { pisoY: 0.95 }), globos(enElAire));
  assert.equal(primero(piso.lectura).y, 0.88, "el pie en el piso queda donde estaba");
  assert.notEqual(primero(aire.lectura).y, 0.5, "el extremo en el aire se corre hacia los globos (los desplazamos 4 % abajo)");
});

console.log("Una caja suelta no se lleva un escalón");
prueba("una sola caja de 0,25 entre 86 globos no hace de gigante: los grandes reales siguen siendo grandes", () => {
  // El lector no vio gigantes (tres escalones): la detección tampoco debe inventarlos con una caja suelta.
  const sinGigantes = lectura([guirnalda(EJE_FESTON, { mezcla: { grandes: 25, medianos: 55, chicos: 20, diametroGrande: 0.13, diametroMediano: 0.09, diametroChico: 0.05, formatoGrande: "R-18", formatoMediano: "R-12", formatoChico: "R-5" } })]);
  const globos = globosAlLargo(EJE_FESTON, [[D.mediano, 60], [D.chico, 20], [D.grande, 6]], ["dorado", "blanco"], { semilla: 41 });
  const intruso = caja(0.5, 0.26, 0.25, "blanco");
  const con = garlandaDe(medirConDetecciones(sinGigantes, [...globos, intruso]).lectura);
  const sin = garlandaDe(medirConDetecciones(sinGigantes, globos).lectura);
  assert.equal(con.mezcla!.gigantes ?? 0, 0, "no hay gigantes: era una caja suelta");
  assert.ok(Math.abs(con.mezcla!.diametroGrande - D.grande) < 0.02, `diametroGrande ${con.mezcla!.diametroGrande}`);
  assert.equal(con.mezcla!.formatoGrande, "R-18");
  assert.ok(!con.anclas?.some((a) => (a.diametro ?? 0) > 0.2), "la caja de 0,25 no queda anclada");
  assert.deepEqual(con.mezcla, sin.mezcla, "con la caja suelta sale lo mismo que sin ella");
  assert.ok(con.anclas!.length >= 5, "los seis grandes reales sí son anclas");
  // Si el lector sí había visto gigantes (cuatro escalones) y la detección solo trae esa caja, el escalón de gigantes queda en 0.
  const cuatro = garlandaDe(medirConDetecciones(base, [...globos, intruso]).lectura);
  assert.equal(cuatro.mezcla!.gigantes, 0);
  assert.equal(cuatro.mezcla!.formatoGrande, "R-18");
  assert.ok(!cuatro.anclas?.some((a) => a.escalon === "gigantes"));
});

prueba("lo mismo con los diámetros medidos con un 6 % de ruido, como en una foto de verdad", () => {
  const lector = lectura([guirnalda(EJE_FESTON, { mezcla: { grandes: 25, medianos: 55, chicos: 20, diametroGrande: 0.13, diametroMediano: 0.09, diametroChico: 0.05, formatoGrande: "R-18", formatoMediano: "R-12", formatoChico: "R-5" } })]);
  const globos = globosAlLargo(EJE_FESTON, [[D.mediano, 60], [D.chico, 20], [D.grande, 6]], ["dorado", "blanco"], { semilla: 43, ruido: 0.06 });
  const g = garlandaDe(medirConDetecciones(lector, [...globos, caja(0.5, 0.26, 0.25, "blanco")]).lectura);
  assert.equal(g.mezcla!.gigantes ?? 0, 0);
  assert.equal(g.mezcla!.formatoGrande, "R-18");
  assert.ok(g.mezcla!.grandes >= 4 && g.mezcla!.grandes <= 12, `grandes ${g.mezcla!.grandes} %`);
  assert.ok(!g.anclas?.some((a) => (a.diametro ?? 0) > 0.2));
});

prueba("el resultado no depende del orden en que llegan las cajas", () => {
  const globos = [...deteccionBase, caja(0.5, 0.26, 0.25, "blanco")];
  const referencia = medirConDetecciones(base, globos);
  const azar = crearAzar(77);
  for (let k = 0; k < 5; k++) {
    const barajada = [...globos];
    for (let i = barajada.length - 1; i > 0; i--) { const j = Math.floor(azar() * (i + 1)); [barajada[i], barajada[j]] = [barajada[j]!, barajada[i]!]; }
    const r = medirConDetecciones(base, barajada);
    assert.deepEqual(r.lectura, referencia.lectura, `permutación ${k}`);
    assert.deepEqual(r.notas, referencia.notas);
  }
});

prueba("el panel de fondo tomado por un globo, y lo que hay sobre una mesa, no cuentan en la guirnalda", () => {
  const panel: PiezaLeida = { tipo: "fondo", id: "panel_redondo", x: 0.5, yBase: 0.85, ancho: 0.5, alto: 0.5, colores: [DORADO] };
  const mesa: PiezaLeida = { tipo: "fondo", id: "mesa_mantel", x: 0.82, yBase: 0.9, ancho: 0.3, alto: 0.2, colores: [BLANCO] };
  const l = lectura([guirnalda(EJE_FESTON), panel, mesa]);
  // Las cajas: el panel entero (un globo gigante para el detector) y cuatro globos sobre la mesa.
  const elPanel: GloboDetectado = { box_2d: [350, 250, 850, 750], color: "dorado" };
  const sobreLaMesa = [0.76, 0.8, 0.84, 0.88].map((x) => caja(x, 0.76, D.mediano, "blanco"));
  const solo = medirConDetecciones(lectura([guirnalda(EJE_FESTON), panel, mesa]), deteccionBase);
  const con = medirConDetecciones(l, [...deteccionBase, elPanel, ...sobreLaMesa]);
  assert.deepEqual(garlandaDe(con.lectura), garlandaDe(solo.lectura));
  assert.match(con.notas.join(" "), /5 cajas detectadas son de un fondo o de un mueble/);
  // Los globos de la guirnalda que pasan por delante del panel (dentro de su caja) siguen contando.
  assert.ok(garlandaDe(con.lectura).mezcla!.medianos > 30);
});

// ----------------------------------------------------------------------------------------------------------
// Cajas reales (fotos de prueba v3 y v4 del dueño; solo las cajas y su color, sin imágenes)
// ----------------------------------------------------------------------------------------------------------

type CajaReal = readonly [number, number, number, number, string];
const aDetecciones = (l: readonly CajaReal[]): GloboDetectado[] => l.map(([y0, x0, y1, x1, color]) => ({ box_2d: [y0, x0, y1, x1], color }));
/** v3: las cajas del montón de la derecha; la primera es el único gigante blanco (d = 0,174, casi cuadrado, sin otros globos dentro). */
const MONTON_V3: readonly CajaReal[] = [[599,780,762,954,"blanco"], [755,877,849,976,"dorado"], [757,750,830,824,"dorado"], [719,930,795,1000,"dorado"], [756,818,830,882,"dorado"], [695,731,760,800,"dorado"], [740,701,816,756,"dorado"], [670,712,732,776,"dorado"], [621,737,677,791,"dorado"], [628,935,683,988,"dorado"], [674,950,729,1000,"dorado"], [702,684,759,725,"blanco"], [676,709,739,742,"dorado"], [634,670,678,717,"dorado"], [733,786,776,832,"dorado"], [623,715,676,752,"blanco"], [592,791,625,845,"dorado"], [595,756,628,799,"blanco"], [802,967,846,996,"dorado"], [722,679,759,706,"blanco"], [599,719,628,745,"dorado"], [668,694,694,721,"blanco"]];
/** v4: las cajas del montón de la izquierda; la primera es una caja suelta de 0,36 × 0,30 que el detector puso sobre medio montón. */
const MONTON_V4: readonly CajaReal[] = [[592,69,952,365,"dorado"], [663,172,742,279,"dorado"], [614,67,694,151,"blanco"], [625,140,704,225,"blanco"], [558,133,634,216,"blanco"], [602,234,662,314,"dorado"], [679,275,741,345,"blanco"], [711,295,786,352,"blanco"], [742,258,809,314,"blanco"], [699,97,742,176,"dorado"], [592,298,629,374,"dorado"], [627,310,682,355,"dorado"], [808,258,869,289,"dorado"], [635,258,680,295,"blanco"], [664,270,704,309,"blanco"], [698,1,742,93,"dorado"], [674,0,733,58,"dorado"]];
const MEZCLA_REAL = { gigantes: 15, grandes: 15, medianos: 50, chicos: 20, diametroGigante: 0.26, diametroGrande: 0.15, diametroMediano: 0.085, diametroChico: 0.04, formatoGigante: "R-36" as const, formatoGrande: "R-18" as const, formatoMediano: "R-12" as const, formatoChico: "R-5" as const };
const montonDe = (x: number, yPie: number, yArriba: number, ancho: number): PiezaLeida => ({ tipo: "racimo_piso", x, yPie, yArriba, ancho, tamanos: {}, racimos: 0.5, colores: [DORADO, BLANCO], mezcla: MEZCLA_REAL });

console.log("Un gigante de verdad no es una caja suelta");
prueba("v3: el gigante del montón (d = 0,174, entero) se queda como escalón de gigantes y queda anclado", () => {
  const det = aDetecciones(MONTON_V3);
  const globos = globosDe(det, 1);
  assert.ok(globos[0]!.entero && Math.abs(globos[0]!.d - 0.174) < 0.001, `entero ${globos[0]!.entero}, d ${globos[0]!.d}`);
  const r = medirConDetecciones(lectura([montonDe(0.85, 0.85, 0.6, 0.32)], { aspecto: 1 }), det);
  const m = r.lectura.piezas[0] as Monton;
  assert.ok((m.mezcla!.gigantes ?? 0) > 0, JSON.stringify(m.mezcla));
  assert.ok(m.anclas?.some((a) => a.escalon === "gigantes" && Math.abs((a.diametro ?? 0) - 0.174) < 0.001 && a.color === "blanco"), JSON.stringify(m.anclas));
});

prueba("v4: la caja de 0,36 que junta 12 globos (dorada, del color del montón) no es un globo: se rechaza y no se ancla", () => {
  const det = aDetecciones(MONTON_V4);
  const globos = globosDe(det, 1);
  const suelta = globos[0]!;
  assert.ok(Math.abs(suelta.d - 0.36) < 0.001 && suelta.w / suelta.h > 0.75 && suelta.w / suelta.h < 1.33, "es casi cuadrada: lo que la delata son los globos que contiene");
  assert.ok(!suelta.entero, "contiene el centro de otros 12 globos");
  assert.ok(globos.slice(1).filter((g) => g.entero).length >= 8, "la mayoría de los globos de verdad sí son enteros");
  const r = medirConDetecciones(lectura([montonDe(0.12, 0.96, 0.55, 0.6)], { aspecto: 1 }), det);
  const m = r.lectura.piezas[0] as Monton;
  assert.equal(m.mezcla!.gigantes ?? 0, 0);
  assert.ok(!m.anclas?.some((a) => (a.diametro ?? 0) > 0.3), JSON.stringify(m.anclas));
});

prueba("las tiras del borde de un trozo (aspecto 0,3 a 0,4) no son globos enteros", () => {
  const tira = globosDe([{ box_2d: [100, 300, 220, 345], color: "dorado" }], 1)[0]!;
  assert.ok(!tira.entero, `aspecto ${(tira.w / tira.h).toFixed(2)}`);
});

prueba("el resultado con las cajas reales no depende de su orden", () => {
  const l = lectura([montonDe(0.85, 0.85, 0.6, 0.32)], { aspecto: 1 });
  const referencia = medirConDetecciones(l, aDetecciones(MONTON_V3));
  const azar = crearAzar(5);
  for (let k = 0; k < 4; k++) {
    const barajada = [...aDetecciones(MONTON_V3)];
    for (let i = barajada.length - 1; i > 0; i--) { const j = Math.floor(azar() * (i + 1)); [barajada[i], barajada[j]] = [barajada[j]!, barajada[i]!]; }
    assert.deepEqual(medirConDetecciones(l, barajada).lectura, referencia.lectura, `permutación ${k}`);
  }
});

console.log("Colores");
prueba("cada palabra del detector se casa por color y no por el comienzo del nombre", () => {
  const colores: ColorLeido[] = [
    { nombre: "plata", hex: "#C8C8C8", peso: 20, acabado: "cromado" }, { nombre: "azul", hex: "#2F6DB5", peso: 20, acabado: "mate" },
    { nombre: "azul marino", hex: "#1B2A5C", peso: 20, acabado: "mate" }, { nombre: "blanco perla", hex: "#F2EFE6", peso: 20, acabado: "perla" },
    { nombre: "confeti dorado", hex: "#E8D7A0", peso: 10, acabado: "confeti" }, { nombre: "cristal", hex: "#DDEEEE", peso: 10, acabado: "cristal" },
  ];
  const indice = indiceDeDetectado(colores);
  assert.equal(indice("plateado"), 0, "plateado no empieza igual que plata y es plata");
  assert.equal(indice("azul"), 1);
  assert.equal(indice("azul marino"), 2, "azul marino no cae en el primer «azul»");
  assert.equal(indice("blanco"), 3);
  assert.equal(indice("confeti"), 4);
  assert.equal(indice("transparente"), 5);
  assert.equal(indice("verde"), -1, "un verde que la pieza no tiene no cuenta");
  assert.equal(indice("otro"), -1);
});

prueba("sin un color parecido en la pieza el globo no cuenta (en vez de caer en el primero que se le parezca en el nombre)", () => {
  const soloDorados: ColorLeido[] = [{ nombre: "dorado", hex: "#D4AF37", peso: 100, acabado: "cromado" }];
  const indice = indiceDeDetectado(soloDorados);
  assert.equal(indice("dorado"), 0);
  assert.equal(indice("azul"), -1);
  assert.equal(indice("negro"), -1);
});

prueba("los pesos de los colores quedan en una sola escala: los que no aparecen conservan su parte", () => {
  const colores: ColorLeido[] = [{ ...DORADO, peso: 50 }, { ...BLANCO, peso: 30 }, { nombre: "verde", hex: "#3A9D5D", peso: 20, acabado: "mate" }];
  const globos = [...Array.from({ length: 30 }, () => unGlobo(0.1, "dorado")), ...Array.from({ length: 10 }, () => unGlobo(0.1, "blanco"))];
  const salida = coloresDe(colores, globos);
  const total = salida.reduce((s, c) => s + c.peso, 0);
  assert.ok(Math.abs(total - 100) <= 2, `suman ${total}`);
  assert.equal(salida[2]!.peso, 20, "el verde, que no se vio, queda con su 20 %");
  assert.ok(salida[0]!.peso > 55 && salida[0]!.peso < 65 && salida[1]!.peso > 15 && salida[1]!.peso < 25, JSON.stringify(salida.map((c) => c.peso)));
  assert.deepEqual(coloresDe(colores, globos.slice(0, 10)).map((c) => c.peso), [50, 30, 20], "con menos de 15 globos casados no se toca");
});

prueba("los colores de un escalón y el dominante de un tramo salen de la cuenta, con la escala de la pieza", () => {
  const colores: ColorLeido[] = [DORADO, BLANCO];
  const doradosChicos = Array.from({ length: 12 }, () => unGlobo(0.05, "dorado"));
  const porEscalon = new Map([["chicos" as const, doradosChicos], ["medianos" as const, [...doradosChicos.slice(0, 6).map((g) => unGlobo(0.09, g.color)), ...Array.from({ length: 6 }, () => unGlobo(0.09, "blanco"))]]]);
  const r = coloresPorEscalonDe(porEscalon, colores);
  assert.deepEqual(r.map((e) => e.escalon), ["chicos"], "los medianos están en 50/50 y la pieza en 60/40: no se aparta");
  assert.deepEqual(r[0]!.pesos, [100, 0]);
  assert.deepEqual(dominantesPorTramo([doradosChicos, doradosChicos], colores, indiceDeDetectado(colores), [0.6, 0.4]), ["dorado", "dorado"]);
  assert.deepEqual(dominantesPorTramo([doradosChicos.slice(0, 3), doradosChicos.slice(0, 3)], colores, indiceDeDetectado(colores), [0.6, 0.4]), [undefined, undefined], "con menos de 12 globos entre los dos no hay dominante");
});

console.log("Anclas, esquema y casos de borde");
prueba("las anclas llevan el diámetro y, con más de 80, quedan los 80 mayores; el resultado cumple el esquema", () => {
  const grandes = globosAlLargo(EJE_FESTON, [[0.12, 60], [0.14, 40]], ["dorado", "blanco"], { semilla: 11 });
  const gigantes = globosAlLargo(EJE_FESTON, [[D.gigante, 8]], ["dorado", "blanco"], { semilla: 12 });
  const medianos = globosAlLargo(EJE_FESTON, [[D.mediano, 60], [D.chico, 20]], ["dorado", "blanco"], { semilla: 13 });
  const r = medirConDetecciones(base, [...grandes, ...gigantes, ...medianos]);
  const g = garlandaDe(r.lectura);
  assert.ok(g.anclas && g.anclas.length === 80, `anclas ${g.anclas?.length}`);
  assert.ok(g.anclas.every((a) => a.diametro !== undefined && a.diametro > 0));
  assert.ok(g.anclas.filter((a) => a.escalon === "gigantes").length >= 6, "los gigantes (los mayores) no se pierden");
  const parseada = LecturaFotoSchema.parse(r.lectura);
  assert.deepEqual(parseada, r.lectura);
});

prueba("con menos de 15 globos en la pieza, la lectura queda igual", () => {
  const pocos = globosAlLargo(EJE_FESTON, [[D.mediano, 8], [D.grande, 3]], ["dorado", "blanco"]);
  const r = medirConDetecciones(base, pocos);
  assert.deepEqual(r.lectura, base);
  assert.deepEqual(medirConDetecciones(base, []).lectura, base);
});

prueba("los globos de una columna orgánica no entran en la guirnalda", () => {
  const columna: PiezaLeida = { tipo: "columna_organica", forma: "recta", x: 0.5, yBase: 0.9, yArriba: 0.5, ancho: 0.16, grosor: 0.16, tamanos: {}, racimos: 0.3, colores: [DORADO, BLANCO] };
  const conColumna = lectura([guirnalda(EJE_FESTON), columna]);
  const deLaColumna = globosAlLargo([{ x: 0.5, y: 0.86 }, { x: 0.5, y: 0.56 }], [[D.gigante, 10], [D.grande, 10]], ["blanco"], { lateral: 0.02, semilla: 21 });
  const solo = medirConDetecciones(lectura([guirnalda(EJE_FESTON)]), deteccionBase);
  const con = medirConDetecciones(conColumna, [...deteccionBase, ...deLaColumna]);
  assert.deepEqual(garlandaDe(con.lectura), garlandaDe(solo.lectura), "los 20 globos blancos de la columna no cambian la guirnalda");
  assert.match(con.notas.join(" "), /20 globos detectados son de otras piezas/);
});

prueba("el montón de piso se mide aparte: reparto de tamaños y colores propios, sin tocar la escala", () => {
  const monton: Monton = { tipo: "racimo_piso", x: 0.5, yPie: 0.95, yArriba: 0.72, ancho: 0.3, tamanos: {}, racimos: 0.5, colores: [DORADO, BLANCO], mezcla: { grandes: 30, medianos: 40, chicos: 30, diametroGrande: 0.1, formatoGrande: "R-18", formatoMediano: "R-12", formatoChico: "R-5" } };
  const l = lectura([guirnalda(EJE_FESTON), monton]);
  const delMonton = globosAlLargo([{ x: 0.36, y: 0.9 }, { x: 0.64, y: 0.9 }], [[0.12, 6], [0.1, 10], [0.06, 14]], ["dorado"], { lateral: 0.04, semilla: 31 });
  const r = medirConDetecciones(l, [...deteccionBase, ...delMonton]);
  const m = r.lectura.piezas.find((p): p is Monton => p.tipo === "racimo_piso")!;
  assert.ok(m.coloresPorEscalon && m.coloresPorEscalon.length > 0, "todos los globos del montón son dorados: algún escalón lleva sus colores");
  assert.ok(m.colores[0]!.peso > m.colores[1]!.peso, "los pesos del montón salen de sus globos");
  assert.equal(m.mezcla!.formatoMediano, "R-12", "sus formatos quedan como los leyó el lector (el montón se ve más cerca de la cámara)");
  assert.ok(m.mezcla!.chicos >= 25, JSON.stringify(m.mezcla));
  assert.match(r.notas.join(" "), /Montón de piso medido con 30 globos/);
  // La guirnalda no se contaminó con sus globos.
  assert.deepEqual(garlandaDe(r.lectura), garlandaDe(medirConDetecciones(lectura([guirnalda(EJE_FESTON)]), deteccionBase).lectura));
});

prueba("los fondos del catálogo se ponen en su caja detectada; los que no se parecen a ninguna quedan como se leyeron", () => {
  const fondo: PiezaLeida = { tipo: "fondo", id: "lentejuelas", x: 0.5, yBase: 0.8, ancho: 0.55, alto: 0.5, colores: [DORADO] };
  const otro: PiezaLeida = { tipo: "fondo", id: "mesa_mantel", x: 0.1, yBase: 0.9, ancho: 0.2, alto: 0.15, colores: [BLANCO] };
  // La pared de lentejuelas está en x de 0,29 a 0,71 y y de 0,3 a 0,85.
  const r = medirFondos([fondo, otro], [{ id: "lentejuelas", box_2d: [300, 290, 850, 710] }, { id: "pedestales", box_2d: [100, 100, 200, 200] }], ASPECTO);
  const f = r.piezas[0] as Extract<PiezaLeida, { tipo: "fondo" }>;
  assert.ok(Math.abs(f.ancho - 0.42) < 0.001 && Math.abs(f.alto - 0.55) < 0.001 && Math.abs(f.yBase - 0.85) < 0.001 && Math.abs(f.x - 0.5) < 0.001, JSON.stringify(f));
  assert.deepEqual(r.piezas[1], otro);
  assert.equal(r.notas.length, 1);
  const completo = medirConDetecciones(lectura([fondo, guirnalda(EJE_FESTON)]), deteccionBase, [{ id: "lentejuelas", box_2d: [300, 290, 850, 710] }]);
  assert.equal((completo.lectura.piezas[0] as Extract<PiezaLeida, { tipo: "fondo" }>).ancho, 0.42);
});

console.log("Mosaico de la detección");
prueba("nueve trozos con solape que cubren la foto", () => {
  const t = trozosDelMosaico();
  assert.equal(t.length, 9);
  assert.equal(t[0]!.x0, 0);
  assert.equal(t[8]!.x1, 1);
  assert.ok(t[1]!.x0 < t[0]!.x1, "dos trozos vecinos se solapan");
  assert.ok(Math.abs((t[0]!.x1 - t[1]!.x0) - 0.15) < 1e-9);
  assert.equal(trozosDelMosaico(2, 0).length, 4);
});

prueba("las cajas repetidas del solape se funden", () => {
  const a: GloboDetectado = { box_2d: [400, 400, 500, 500], color: "dorado" };
  const casi: GloboDetectado = { box_2d: [403, 402, 502, 503], color: "dorado" };
  const otra: GloboDetectado = { box_2d: [600, 600, 700, 700], color: "blanco" };
  assert.equal(fundirRepetidas([a, casi, otra]).length, 2);
  assert.equal(fundirRepetidas([a, otra]).length, 2);
});

prueba("el medio globo cortado por el borde de un trozo se descarta si hay uno más completo", () => {
  const trozos = trozosDelMosaico();
  // El borde derecho del primer trozo está en x = 0,4083 (408,3).
  const borde = trozos[0]!.x1 * 1000;
  const completo: GloboDetectado = { box_2d: [100, Math.round(borde - 50), 200, Math.round(borde + 50)], color: "dorado" };
  // Un trozo de globo de 20 milésimas de ancho: su IoU con el entero (0,2) no basta para fundirlo como «repetido».
  const mitad: GloboDetectado = { box_2d: [100, Math.round(borde - 20), 200, Math.round(borde)], color: "dorado" };
  assert.ok(Math.abs(Math.round(borde) - Math.round(borde - 20) - 20) <= 1);
  assert.ok(tocaBordeDeTrozo(mitad.box_2d, trozos));
  assert.ok(!tocaBordeDeTrozo([100, 100, 150, 150], trozos));
  const fundidas = fundirRepetidas([mitad, completo]);
  assert.equal(fundidas.length, 1);
  assert.deepEqual(fundidas[0]!.box_2d, completo.box_2d);
  // Sin uno más completo, se conserva (no hay otro de dónde sacarlo).
  assert.equal(fundirRepetidas([mitad]).length, 1);
  // Una caja pequeña dentro de otra mayor pero lejos de todo borde interno de trozo es otro globo: se queda.
  const grande: GloboDetectado = { box_2d: [450, 600, 560, 710], color: "blanco" };
  const chico: GloboDetectado = { box_2d: [490, 640, 520, 670], color: "dorado" };
  assert.ok(!tocaBordeDeTrozo(chico.box_2d, trozos));
  assert.equal(fundirRepetidas([grande, chico]).length, 2);
});

prueba("una detección sintética con globos cortados en el borde cuenta cada globo una vez", () => {
  const trozos = trozosDelMosaico();
  const bordes = [trozos[0]!.x1 * 1000, trozos[1]!.x1 * 1000];
  const globos: GloboDetectado[] = [];
  bordes.forEach((b, i) => {
    for (let k = 0; k < 5; k++) {
      const y = 80 + k * 120 + i * 20;
      globos.push({ box_2d: [y, Math.round(b - 45), y + 90, Math.round(b + 45)], color: "dorado" });
      globos.push({ box_2d: [y, Math.round(b - 25), y + 90, Math.round(b)], color: "dorado" });
    }
  });
  assert.equal(fundirRepetidas(globos).length, 10);
});

console.log(`test-medir-detecciones: ${pruebas} pruebas ok`);
