/**
 * El compilador de la lectura con lo que mide la detección (REQ-001, fidelidad a la foto). Sin coste ni red.
 * - piezaConMezcla: los chicos salen en la proporción pedida, y qué es mediano y qué chico lo dice la mezcla de la pieza (un
 *   R-9 que el lector llama mediano es mediano; sin decirlo, es chico);
 * - profundidadEnElPiso: la profundidad de lo que se apoya en el piso cerca de la cámara, con sus guardas y sin salirse de la sala;
 * - paletaDeLectura y fijosDeAnclas: colores por escalón, el fijo que baja de formato por su color (un R-36 dorado cromado es un
 *   R-24 que sigue contando como gigante, con el diámetro medido) y el color dominante solo en su tramo;
 * - lo que el lector anota (`nota`) llega a las notas del compilador;
 * - lineaDePiezaLeida cuenta cada tipo de pieza (y falla alto si se agrega uno sin contarlo); comparar-lecturas cuenta el montón.
 *
 * Run: npx tsx --conditions=react-server scripts/test/test-lectura-compilador-fidelidad.ts
 */
import assert from "node:assert/strict";
import { compilarLectura } from "../../src/lib/globos3d/compilar-lectura";
import { codigoDeColor, fijosDeAnclas, paletaDeLectura } from "../../src/lib/globos3d/colores-lectura";
import { compararLecturas } from "../../src/lib/globos3d/comparar-lecturas";
import { FONDO_SALA_FOTO_CM, profundidadEnElPiso } from "../../src/lib/globos3d/encuadre-foto";
import { FOV_FOTO_GRADOS, PROFUNDIDAD_DE_LA_FOTO_CM } from "../../src/lib/globos3d/proyeccion-foto";
import type { ColorLeido, LecturaFoto, MezclaLeida, PiezaLeida } from "../../src/lib/globos3d/lectura-foto";
import { armarEscena } from "../../src/lib/globos3d/escena";
import { globosPorFormatoDe } from "../../src/lib/globos3d/mezcla-escena";
import { lineaDePiezaLeida } from "../../src/lib/globos3d/modelar-desde-foto";
import { piezaConMezcla } from "../../src/lib/globos3d/relleno-por-mezcla";
import { puntosDeSilueta, type ParametrosTrazoOrganico } from "../../src/lib/globos3d/trazo-organico";

let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };

const DORADO: ColorLeido = { nombre: "dorado", hex: "#D4AF37", peso: 60, acabado: "cromado" };
const BLANCO: ColorLeido = { nombre: "blanco", hex: "#F5F5F5", peso: 40, acabado: "mate" };
const lectura = (piezas: PiezaLeida[], extra: Partial<LecturaFoto> = {}): LecturaFoto => ({
  resumen: "prueba", aspecto: 1, escala: { altoImagenCm: 260, referencia: "prueba" }, pisoY: 0.85, sala: { pared: "#f0f0f0", piso: "#dddddd" }, piezas, ...extra,
});

console.log("Relleno por mezcla");
const trazo = (): ParametrosTrazoOrganico => ({
  puntos: puntosDeSilueta("feston", { anchoCm: 300, altoCm: 150, grosorCm: 70 }), mezcla: { "R-24": 0.12, "R-12": 0.5, "R-5": 0.38 }, colores: [{ codigo: "032", peso: 50 }, { codigo: "005", peso: 50 }], racimos: 0.3, semilla: 5,
});

prueba("la parte de chicos sale cerca de la pedida y la distancia a la mezcla es corta", () => {
  const objetivo = { "R-24": 0.12, "R-12": 0.5, "R-5": 0.38 };
  const r = piezaConMezcla(trazo(), objetivo, null, 0);
  const cuenta = globosPorFormatoDe(r.pieza);
  const total = Object.values(cuenta).reduce((s, n) => s + n, 0);
  const chicos = ((cuenta["R-5"] ?? 0) + (cuenta["R-9"] ?? 0)) / total;
  assert.ok(Math.abs(chicos - 0.38) < 0.13, `chicos ${(chicos * 100).toFixed(0)} % (pedido 38 %)`);
  assert.ok(r.distancia < 0.18, `distancia ${r.distancia}`);
  assert.match(r.relleno, /chicos en racimitos/);
});

prueba("el tope de chicos no se pasa aunque cada racimito traiga tres", () => {
  const objetivo = { "R-24": 0.1, "R-12": 0.82, "R-5": 0.08 };
  const r = piezaConMezcla({ ...trazo(), mezcla: objetivo }, objetivo, null, 0);
  const cuenta = globosPorFormatoDe(r.pieza);
  const total = Object.values(cuenta).reduce((s, n) => s + n, 0);
  assert.ok((cuenta["R-5"] ?? 0) / total < 0.2, `R-5 ${(cuenta["R-5"] ?? 0)} de ${total}`);
});

prueba("el R-9 que la mezcla llama mediano es mediano; sin decirlo, es chico y el relleno va con R-12", () => {
  const objetivo = { "R-24": 0.2, "R-9": 0.6, "R-5": 0.2 };
  const mezcla: MezclaLeida = { grandes: 20, medianos: 60, chicos: 20, diametroGrande: 0.2, formatoGrande: "R-24", formatoMediano: "R-9", formatoChico: "R-5" };
  const t = { ...trazo(), mezcla: objetivo };
  const nombrado = globosPorFormatoDe(piezaConMezcla(t, objetivo, null, 0, mezcla).pieza);
  assert.equal(nombrado["R-12"] ?? 0, 0, "con el R-9 mediano, el relleno de medianos es R-9 y no entra un R-12");
  assert.ok((nombrado["R-9"] ?? 0) > (nombrado["R-5"] ?? 0));
  const sinDecirlo = globosPorFormatoDe(piezaConMezcla(t, objetivo, null, 0).pieza);
  assert.ok((sinDecirlo["R-12"] ?? 0) > 0, "sin la mezcla, el R-9 es un chico y el relleno de medianos es el R-12 de siempre");
});

console.log("Profundidad en el piso");
prueba("numéricamente: lo que se apoya más abajo que el piso está más cerca y se ve más grande", () => {
  const l = lectura([], { escala: { altoImagenCm: 260, referencia: "x" }, pisoY: 0.8 });
  // La cámara a 140 cm (la mano) mira inclinada al centro de la imagen, a 78 cm del piso; cada fila de la foto es un rayo
  // que baja `inclinación + α` y toca el piso a H / tan(ángulo) de la cámara, a H·cos α / sen(ángulo) de profundidad.
  const t = Math.tan(((FOV_FOTO_GRADOS / 2) * Math.PI) / 180), distancia = 260 / 2 / t, H = 140, centro = 0.3 * 260;
  const inclinacion = Math.asin((H - centro) / distancia);
  const rayo = (y: number) => { const a = Math.atan((y - 0.5) * 2 * t), b = inclinacion + a; return { lejos: H / Math.tan(b), prof: (H * Math.cos(a)) / Math.sin(b) }; };
  const linea = rayo(0.8), pie = rayo(0.9);
  const r = profundidadEnElPiso(l, 0.9);
  assert.equal(r.delanteCm, Math.round(linea.lejos - pie.lejos));
  assert.ok(Math.abs(r.factor - pie.prof / linea.prof) < 0.002, `${r.factor} vs ${pie.prof / linea.prof}`);
  assert.ok(r.delanteCm > 40 && r.delanteCm < 130 && r.factor < 1 && r.factor > 0.6, JSON.stringify(r));
  assert.ok(profundidadEnElPiso(l, 0.95).delanteCm > r.delanteCm, "más abajo, más cerca");
});

prueba("guardas: sobre la línea del piso, sin piso visible o con datos rotos no hay corrimiento", () => {
  const l = lectura([], { pisoY: 0.8 });
  assert.deepEqual(profundidadEnElPiso(l, 0.8), { delanteCm: 0, factor: 1 });
  assert.deepEqual(profundidadEnElPiso(l, 0.5), { delanteCm: 0, factor: 1 });
  assert.deepEqual(profundidadEnElPiso(l, Number.NaN), { delanteCm: 0, factor: 1 });
  assert.deepEqual(profundidadEnElPiso(lectura([], { pisoY: 0.4 }), 0.9), { delanteCm: 0, factor: 1 }, "un piso por encima del centro de la foto no da perspectiva");
});

prueba("nunca pasa de lo que cabe en la sala, sea cual sea la escala", () => {
  const grande = lectura([], { escala: { altoImagenCm: 1500, referencia: "x" }, pisoY: 0.8 });
  const r = profundidadEnElPiso(grande, 1.1);
  assert.ok(r.delanteCm <= FONDO_SALA_FOTO_CM - PROFUNDIDAD_DE_LA_FOTO_CM - 30, `delante ${r.delanteCm}`);
  assert.ok(r.factor > 0 && r.factor < 1);
  const estrecha = profundidadEnElPiso(grande, 1.1, 200);
  assert.ok(estrecha.delanteCm <= 200 - PROFUNDIDAD_DE_LA_FOTO_CM - 30, `delante ${estrecha.delanteCm}`);
  assert.ok(estrecha.delanteCm < r.delanteCm);
});

console.log("Colores por escalón, fijos y tramos");
const MEZCLA_GIGANTES: MezclaLeida = { gigantes: 10, grandes: 20, medianos: 50, chicos: 20, diametroGigante: 0.29, diametroGrande: 0.13, diametroMediano: 0.1, diametroChico: 0.05, formatoGigante: "R-36", formatoGrande: "R-24", formatoMediano: "R-12", formatoChico: "R-5" };
const BLANCO_Y_VERDE: ColorLeido[] = [BLANCO, { nombre: "verde esmeralda", hex: "#046307", peso: 30, acabado: "mate" }];

prueba("cada escalón con colores propios lleva su paleta en SUS formatos; los demás, la de la pieza", () => {
  const notas: string[] = [];
  const paleta = paletaDeLectura({ colores: BLANCO_Y_VERDE, mezcla: MEZCLA_GIGANTES, coloresPorEscalon: [{ escalon: "gigantes", pesos: [100, 0] }, { escalon: "chicos", pesos: [0, 100] }] }, 260, notas);
  const deGigantes = paleta.filter((c) => c.formatos?.length === 1 && c.formatos[0] === "R-36");
  assert.equal(deGigantes.length, 1, "solo el blanco va en los R-36");
  assert.equal(deGigantes[0]!.porFormato, true);
  const deChicos = paleta.filter((c) => c.formatos?.length === 1 && c.formatos[0] === "R-5");
  assert.equal(deChicos.length, 1, "solo el verde va en los R-5");
  const resto = paleta.filter((c) => c.formatos && !c.formatos.includes("R-36") && !c.formatos.includes("R-5"));
  assert.equal(resto.length, 2, "blanco y verde, con los pesos de la pieza, en los formatos de los otros escalones");
  assert.ok(resto.every((c) => c.formatos!.includes("R-12") && c.formatos!.includes("R-24")));
});

prueba("los gigantes de un color que no viene en R-36 (Reflex Dorado) van en R-24 del MISMO color, nunca en un R-36 Latte", () => {
  const notas: string[] = [];
  const DORADO: ColorLeido = { nombre: "Reflex Dorado", hex: "#c9a24e", peso: 70, acabado: "cromado" };
  const paleta = paletaDeLectura({ colores: [DORADO, BLANCO], mezcla: MEZCLA_GIGANTES, coloresPorEscalon: [{ escalon: "gigantes", pesos: [80, 20] }] }, 260, notas);
  const enGigantes = paleta.filter((c) => c.formatos?.length === 1 && (c.formatos[0] === "R-36" || c.formatos[0] === "R-24"));
  const codigos = new Set(paleta.map((c) => c.codigo));
  assert.equal(codigos.size, 2, `solo el dorado y el blanco leídos: ${[...codigos].join(", ")} · ${notas.join(" | ")}`);
  const dorado = enGigantes.find((c) => c.formatos![0] === "R-24");
  assert.ok(dorado && dorado.peso === 80, "el dorado de los gigantes va en R-24 con su peso");
  assert.ok(enGigantes.some((c) => c.formatos![0] === "R-36" && c.codigo !== dorado.codigo), "el blanco sí va en R-36");
  assert.ok(notas.some((n) => /no viene en R-36: sus gigantes van en R-24, del mismo color/.test(n)), notas.join(" | "));
});

prueba("un gigante dorado cromado baja a R-24 pero sigue contando como gigante, con el diámetro medido", () => {
  const notas: string[] = [];
  const fijos = fijosDeAnclas({ colores: [DORADO, BLANCO], mezcla: MEZCLA_GIGANTES, anclas: [
    { x: 0.3, y: 0.4, escalon: "gigantes", color: "dorado", diametro: 0.29 }, { x: 0.5, y: 0.3, escalon: "grandes", color: "blanco", diametro: 0.13 },
  ] }, 260, notas);
  assert.equal(fijos.length, 2);
  const [dorado, blanco] = fijos as [typeof fijos[number], typeof fijos[number]];
  assert.equal(dorado.formatoPedidoId, "R-36", "el escalón pedía un R-36");
  assert.equal(dorado.formatoId, "R-24", "el Reflex Dorado no se fabrica en R-36");
  assert.equal(dorado.infladoCm, Math.round(0.29 * 260));
  assert.equal(blanco.formatoId, "R-24");
  assert.equal(blanco.formatoPedidoId, undefined, "el blanco no baja de formato");
  assert.equal(blanco.infladoCm, Math.round(0.13 * 260));
  assert.deepEqual(fijosDeAnclas({ colores: [DORADO], anclas: [{ x: 0.1, y: 0.1, escalon: "grandes", color: "turquesa" }] }, 260, []), [], "un ancla de un color que la pieza no tiene no se pone");
});

prueba("el color dominante de un punto va solo en su tramo del recorrido", () => {
  const puntos = [{ x: 0.1, y: 0.7 }, { x: 0.25, y: 0.4 }, { x: 0.5, y: 0.25 }, { x: 0.75, y: 0.4 }, { x: 0.9, y: 0.7 }].map((q, i) => (i === 3 ? { ...q, dominante: "verde esmeralda" } : q));
  const paleta = paletaDeLectura({ colores: BLANCO_Y_VERDE, puntos }, 260, []);
  const conFranja = paleta.filter((c) => c.franjas?.length);
  assert.equal(conFranja.length, 1);
  const f = conFranja[0]!.franjas![0]!;
  assert.ok(f.desde > 0.4 && f.desde < 0.75 && f.hasta > 0.75 && f.hasta <= 1, `franja ${f.desde}–${f.hasta} del punto 3 de 5`);
  assert.ok(paleta.filter((c) => !c.franjas?.length).length >= 2, "la paleta de la pieza sigue entera");
});

const colorMate = (nombre: string, hex: string, acabado: ColorLeido["acabado"] = "mate"): ColorLeido => ({ nombre, hex, peso: 20, acabado });
const CUATRO_ZONAS = [colorMate("blanco", "#F5F5F5"), colorMate("nude", "#d9b8a0"), colorMate("azul marino", "#1d2b5c"), colorMate("verde salvia", "#9caf88")];
const PLATEADO = colorMate("plateado", "#c0c0c0", "cromado");
/** Una guirnalda recta de punta a punta en cuatro zonas casi puras (dos puntos por zona), con o sin los chicos todos plateados. */
const guirnaldaEnZonas = (conChicosPlateados: boolean) => {
  const dominantes = CUATRO_ZONAS.flatMap((c) => [c.nombre, c.nombre]);
  const puntos = dominantes.map((dominante, i) => ({ x: 0.1 + (i * 0.8) / 7, y: 0.3, grosor: 0.18, dominante }));
  const mezcla: MezclaLeida = { gigantes: 5, grandes: 25, medianos: 50, chicos: 20, diametroGigante: 0.25, diametroGrande: 0.13, diametroMediano: 0.09, diametroChico: 0.05, formatoGigante: "R-36", formatoGrande: "R-18", formatoMediano: "R-12", formatoChico: "R-5" };
  const colores = conChicosPlateados ? [...CUATRO_ZONAS, PLATEADO] : CUATRO_ZONAS;
  return lectura([{ tipo: "guirnalda_organica", puntos, tamanos: {}, racimos: 0.3, colores, mezcla, ...(conChicosPlateados ? { coloresPorEscalon: [{ escalon: "chicos" as const, pesos: [0, 0, 0, 0, 100] }] } : {}) }], { aspecto: 2.2, escala: { altoImagenCm: 400, referencia: "prueba" } });
};
/** Los globos del trecho central (70 %) de cada cuarta parte del largo, con el código del color de esa zona. */
function globosPorZona(globos: ReadonlyArray<{ nudo: { x: number }; formatoId: string; codigo: string }>) {
  const xs = globos.map((b) => b.nudo.x), minimo = Math.min(...xs), maximo = Math.max(...xs);
  return CUATRO_ZONAS.map((c, z) => {
    const desde = z / 4 + 0.075, hasta = (z + 1) / 4 - 0.075;
    return { esperado: codigoDeColor(c, ["R-12"], []), globos: globos.filter((b) => { const f = (b.nudo.x - minimo) / (maximo - minimo); return f >= desde && f <= hasta; }) };
  });
}

prueba("en un tramo con color dominante, al menos el 75 % de sus globos llevan ese color (la guirnalda compilada en cuatro zonas)", () => {
  const globos = armarEscena(compilarLectura(guirnaldaEnZonas(false)).escena).porNodo[0]!.globos;
  assert.ok(globos.length >= 50, `${globos.length} globos`);
  for (const { esperado, globos: deZona } of globosPorZona(globos)) {
    assert.ok(deZona.length >= 12, `${deZona.length} globos en la zona`);
    const con = deZona.filter((b) => b.codigo === esperado).length / deZona.length;
    assert.ok(con >= 0.75, `zona ${esperado}: ${(con * 100).toFixed(0)} %`);
  }
});

prueba("precedencia: los chicos con color propio por escalón lo conservan y el color del tramo manda en el resto", () => {
  const globos = armarEscena(compilarLectura(guirnaldaEnZonas(true)).escena).porNodo[0]!.globos;
  const chicos = globos.filter((b) => b.formatoId === "R-5");
  assert.ok(chicos.length >= 8, `${chicos.length} chicos`);
  assert.equal(new Set(chicos.map((b) => b.codigo)).size, 1, "todos los chicos del mismo color");
  assert.equal(chicos[0]!.codigo, codigoDeColor(PLATEADO, ["R-5"], []));
  for (const { esperado, globos: deZona } of globosPorZona(globos)) {
    const resto = deZona.filter((b) => b.formatoId !== "R-5");
    const con = resto.filter((b) => b.codigo === esperado).length / resto.length;
    assert.ok(con >= 0.75, `zona ${esperado}: ${(con * 100).toFixed(0)} % del resto`);
  }
  const paleta = paletaDeLectura({ colores: [...CUATRO_ZONAS, PLATEADO], mezcla: { gigantes: 5, grandes: 25, medianos: 50, chicos: 20, diametroGigante: 0.25, diametroGrande: 0.13, diametroMediano: 0.09, diametroChico: 0.05, formatoGigante: "R-36", formatoGrande: "R-18", formatoMediano: "R-12", formatoChico: "R-5" }, coloresPorEscalon: [{ escalon: "chicos", pesos: [0, 0, 0, 0, 100] }], puntos: [{ x: 0.1, y: 0.3, dominante: "nude" }, { x: 0.9, y: 0.3 }] }, 300, []);
  const franja = paleta.find((c) => c.franjas?.length)!;
  assert.ok(franja.formatos && !franja.formatos.includes("R-5") && franja.formatos.includes("R-12"), JSON.stringify(franja.formatos));
});

console.log("Notas del lector");
prueba("lo que el lector anota de una pieza llega a las notas del compilador", () => {
  const l = lectura([{ tipo: "globo", x: 0.5, y: 0.5, diametro: 0.1, en: "aire", colores: [BLANCO], nota: "el color podría ser marfil" }]);
  const c = compilarLectura(l);
  assert.ok(c.notas.some((n) => /Pieza 1 \(globo\): el color podría ser marfil/.test(n)), c.notas.join(" | "));
});

console.log("La línea de cada pieza y la comparación");
const UNA_DE_CADA: PiezaLeida[] = [
  { tipo: "guirnalda_organica", puntos: [{ x: 0.1, y: 0.6, grosor: 0.1 }, { x: 0.9, y: 0.6, grosor: 0.1 }], tamanos: {}, racimos: 0.3, colores: [BLANCO] },
  { tipo: "columna_organica", forma: "recta", x: 0.5, yBase: 0.9, yArriba: 0.3, ancho: 0.1, grosor: 0.1, tamanos: {}, racimos: 0.3, colores: [BLANCO] },
  { tipo: "racimo_piso", x: 0.5, yPie: 0.95, yArriba: 0.8, ancho: 0.2, tamanos: {}, racimos: 0.5, colores: [DORADO, BLANCO] },
  { tipo: "columna_clasica", x: 0.2, yBase: 0.9, yArriba: 0.4, colores: [BLANCO] },
  { tipo: "guirnalda_clasica", x1: 0.2, x2: 0.8, y: 0.3, colores: [BLANCO] },
  { tipo: "globo", x: 0.5, y: 0.5, diametro: 0.1, en: "piso", colores: [BLANCO] },
  { tipo: "ramo_helio", x: 0.4, yBase: 0.9, yArriba: 0.5, cantidad: 5, colores: [BLANCO] },
  { tipo: "decoracion", id: "orbe_flecos_dorado", x: 0.5, y: 0.5, cantidad: 2, colores: [DORADO] },
  { tipo: "metalizado", texto: "LOVE", cursiva: false, x: 0.5, y: 0.5, alto: 0.2, colores: [DORADO] },
  { tipo: "fondo", id: "lentejuelas", x: 0.5, yBase: 0.9, ancho: 0.4, alto: 0.5, colores: [DORADO] },
  { tipo: "otro", descripcion: "una torta" },
];

prueba("cada tipo de pieza leída tiene su línea para el agente", () => {
  assert.equal(new Set(UNA_DE_CADA.map((p) => p.tipo)).size, 11);
  UNA_DE_CADA.forEach((p, i) => {
    const linea = lineaDePiezaLeida(p, i, 260);
    assert.ok(linea.startsWith(`${i + 1}) ${p.tipo}: `), linea);
    assert.ok(linea.length > `${i + 1}) ${p.tipo}: `.length + 2, `${p.tipo}: sin detalle`);
  });
  assert.match(lineaDePiezaLeida(UNA_DE_CADA[2]!, 2, 260), /montón de piso de 52 cm de ancho y 39 cm de alto · dorado cromado 60%, blanco 40%/);
  const fila: PiezaLeida = { tipo: "fondo", id: "silla_tiffany", x: 0.5, yBase: 0.9, ancho: 0.4, alto: 0.2, cantidad: 6, colores: [DORADO] };
  assert.match(lineaDePiezaLeida(fila, 0, 260), /silla_tiffany ×6/);
  const nombre: PiezaLeida = { tipo: "fondo", id: "panel_redondo", x: 0.5, yBase: 0.9, ancho: 0.4, alto: 0.4, texto: "Asher", colorTexto: "negro", acabadoTexto: "cromado", colores: [DORADO] };
  assert.match(lineaDePiezaLeida(nombre, 0, 260), /panel_redondo «Asher» en negro \((cromado)\)/);
  assert.throws(() => lineaDePiezaLeida({ tipo: "pieza_nueva" } as unknown as PiezaLeida, 0, 260), /sin línea para el agente/);
});

prueba("comparar lecturas cuenta el montón de piso como pieza y en los colores", () => {
  const con = lectura([UNA_DE_CADA[2]!]);
  const sin = lectura([UNA_DE_CADA[5]!]);
  const igual = compararLecturas(con, con);
  assert.equal(igual.tipos.f1, 1);
  assert.equal(igual.colores.familia, 1);
  const distinto = compararLecturas(con, sin);
  assert.deepEqual(distinto.tipos.inventadas, ["racimo_piso"]);
  assert.deepEqual(distinto.tipos.faltantes, ["globo"]);
  assert.ok(distinto.colores.familia < 1, "el dorado del montón se ve en los colores");
});

console.log(`test-lectura-compilador-fidelidad: ${pruebas} pruebas ok`);
