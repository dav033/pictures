/**
 * El bloque «Colores de tu foto» (`ColoresSempertex`) y la lógica pura que lo decide
 * (`src/lib/plan/presentacion-color.ts`): el cliente lee palabras, no una consola de depuración.
 *
 * Lo que vigila:
 * - la tabla acabado→español (los cuatro de la captura, un acabado desconocido que vuelve tal cual y que la
 *   tabla del catálogo no trae ninguno sin traducir);
 * - los niveles de parecido en los bordes de los umbrales 14 y 26, que son los mismos que usa la vista técnica;
 * - el nombre humano de cada pieza y su numeración;
 * - las frases de los casos especiales;
 * - un render estático (`renderToStaticMarkup`) con una fixture que reproduce la captura: FUERA del plegable
 *   «Ver detalle técnico» no hay croma, tono, px, PMS, hex, croquis, marcas internas ni el id de la pieza, y sí
 *   los nombres comerciales y los porcentajes; DENTRO sigue todo lo técnico (no se pierde auditoría).
 *
 * Sin red ni proveedores. Run: npx tsx scripts/test/test-presentacion-color.ts
 */
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ColoresSempertex } from "@/components/referencia/ColoresSempertex";
import type { AnalisisColorSempertex, CandidataColor, ColorConReferencia, ColorDePieza } from "@/lib/plan/analisis-color";
import { ANALISIS_COLOR_VERSION } from "@/lib/plan/analisis-color";
import {
  ACABADOS_CONOCIDOS,
  acabadoEnEspanol,
  bloqueAbiertoPorDefecto,
  etiquetasDePiezas,
  FRASE_NEUTRO,
  FRASE_SIN_REFERENCIA,
  MAX_COLORES_BLOQUE_ABIERTO,
  nivelDeParecido,
  notasDeColor,
  notasDelBloque,
  porcentajeDeLaPieza,
  resumenDeColores,
  UMBRAL_MUY_PARECIDO,
  UMBRAL_PARECIDO,
  vistaDeColor,
  vistaDeColores,
} from "@/lib/plan/presentacion-color";
import { TABLA_SEMPERTEX } from "@/lib/plan/referencia-sempertex";

let casos = 0;
function caso(nombre: string, prueba: () => void): void {
  try {
    prueba();
  } catch (error) {
    console.error(`[FAIL] ${nombre}`);
    throw error;
  }
  casos += 1;
  console.log(`[PASS] ${nombre}`);
}

// ---------------------------------------------------------------------------
// Fixture: la captura del usuario, con referencias reales de la tabla del catálogo.
// ---------------------------------------------------------------------------

function candidata(codigo: string, distancia: number): CandidataColor {
  const referencia = TABLA_SEMPERTEX.referencias.find((ref) => ref.codigo === codigo);
  assert.ok(referencia, `la tabla del catálogo no trae la referencia ${codigo}`);
  return {
    codigo,
    nombre: referencia.nombre,
    nombreCompleto: referencia.nombreCompleto,
    nombreEn: referencia.nombreEn,
    pms: referencia.pms,
    acabado: referencia.acabado,
    hexGlobo: referencia.hexGlobo,
    deltaE: distancia + 1.5,
    distancia,
    tono: 96.5,
    razonCroma: 1.4,
  };
}

function color(
  hex: string,
  parte: number,
  candidatas: CandidataColor[],
  marcas: Partial<ColorConReferencia["cruce"]> = {},
): ColorConReferencia {
  return {
    hex,
    parte,
    pixeles: Math.round(parte * 45461),
    cruce: { hex, candidatas, porNombre: false, neutro: false, ambigua: false, sinReferencia: false, familias: [], ...marcas },
  };
}

function pieza(elementId: string, tipo: string, colores: ColorConReferencia[], avisos: string[] = []): ColorDePieza {
  return {
    elementId,
    tipo,
    croquis: { forma: "franja vertical", parteDeLaCaja: 0.82 },
    pixeles: { medidos: 45461, deLaCaja: 54791 },
    colores,
    avisos,
  };
}

const COLUMNA = pieza("REF_01_E02", "columna", [
  color("#dfe6e8", 0.37, [candidata("390", 8.5), candidata("981", 17)], { neutro: true }),
  color("#9fa1a6", 0.26, [candidata("981", 11), candidata("390", 12.8)], { neutro: true, ambigua: true }),
  color("#eba3bb", 0.17, [candidata("409", 19.6), candidata("450", 24.1)], { porNombre: true }),
  color("#b393c9", 0.12, [candidata("450", 30.2), candidata("409", 33)]),
  color("#a97d9a", 0.08, [candidata("150", 22), candidata("450", 31)]),
], ["Un color era el mismo globo visto con otra luz y se juntó con el suyo."]);

const ARCO = pieza("REF_01_E03", "arco", [
  color("#4a4038", 0.64, [candidata("981", 41), candidata("450", 44)], { sinReferencia: true }),
  color("#eba3bb", 0.36, [candidata("409", 12), candidata("450", 20)]),
]);

const PARED_VACIA = pieza("REF_01_E04", "pared", []);

const ANALISIS: AnalisisColorSempertex = { version: ANALISIS_COLOR_VERSION, piezas: [COLUMNA, ARCO, PARED_VACIA] };

// ---------------------------------------------------------------------------
// Lógica pura
// ---------------------------------------------------------------------------

caso("acabado en español: los cuatro de la captura", () => {
  assert.equal(acabadoEnEspanol("glossy chrome"), "cromado brillante");
  assert.equal(acabadoEnEspanol("pastel dusk matte"), "pastel mate");
  assert.equal(acabadoEnEspanol("translucent"), "translúcido");
  assert.equal(acabadoEnEspanol("pearlescent satin"), "satinado perlado");
});

caso("acabado en español: el resto de la tabla, mayúsculas y espacios", () => {
  assert.equal(acabadoEnEspanol("matte"), "mate");
  assert.equal(acabadoEnEspanol("satin"), "satinado");
  assert.equal(acabadoEnEspanol("metallic sheen"), "metalizado");
  assert.equal(acabadoEnEspanol("bright matte"), "mate neón");
  assert.equal(acabadoEnEspanol("  Glossy Chrome "), "cromado brillante");
});

caso("acabado desconocido: vuelve el texto original, sin inventar", () => {
  assert.equal(acabadoEnEspanol("holographic foil"), "holographic foil");
  assert.equal(acabadoEnEspanol(""), "");
});

caso("la tabla del catálogo no trae ningún acabado sin traducir", () => {
  const delCatalogo = new Set(TABLA_SEMPERTEX.referencias.map((ref) => ref.acabado));
  for (const acabado of delCatalogo) {
    assert.ok(ACABADOS_CONOCIDOS.includes(acabado), `«${acabado}» está en tabla-color.json y no en la tabla de acabados: añádelo`);
    assert.notEqual(acabadoEnEspanol(acabado), acabado, `«${acabado}» sigue en inglés`);
  }
  for (const conocido of ACABADOS_CONOCIDOS) assert.ok(delCatalogo.has(conocido), `«${conocido}» ya no existe en el catálogo`);
});

caso("parecido: los umbrales son 14 y 26 y sus bordes pertenecen al nivel de abajo", () => {
  assert.equal(UMBRAL_MUY_PARECIDO, 14);
  assert.equal(UMBRAL_PARECIDO, 26);
  assert.equal(nivelDeParecido(0), "muy_parecido");
  assert.equal(nivelDeParecido(14), "muy_parecido");
  assert.equal(nivelDeParecido(14.01), "parecido");
  assert.equal(nivelDeParecido(26), "parecido");
  assert.equal(nivelDeParecido(26.01), "aproximado");
  assert.equal(nivelDeParecido(120), "aproximado");
});

caso("piezas: nombre humano, numerado solo si se repite, por orden y sin depender del id", () => {
  const tipos = ["columna", "arco", "columna", "semiarco", "guirnalda", "centro_mesa", "pared", "kit", "", "columna", "raro"];
  assert.deepEqual(etiquetasDePiezas(tipos.map((tipo) => ({ tipo }))), [
    "Columna 1",
    "Arco",
    "Columna 2",
    "Semiarco",
    "Guirnalda",
    "Centro de mesa con globos",
    "Pared de globos",
    "Arreglo de globos",
    "Pieza 1",
    "Columna 3",
    "Pieza 2",
  ]);
  assert.deepEqual(etiquetasDePiezas([{ tipo: "columna" }]), ["Columna"]);
  assert.deepEqual(etiquetasDePiezas([]), []);
  const dos = vistaDeColores({
    version: ANALISIS_COLOR_VERSION,
    piezas: [pieza("REF_02_E09", "arco", []), pieza("REF_01_E01", "arco", [])],
  });
  assert.deepEqual(
    dos.map((vista) => vista.nombre),
    ["Arco 1", "Arco 2"],
  );
});

caso("casos especiales: frases de persona, nada de marcas internas", () => {
  const [neutro, ambigua, nombrada] = COLUMNA.colores;
  assert.deepEqual(notasDeColor(neutro!), [FRASE_NEUTRO]);
  assert.equal(FRASE_NEUTRO, "Color neutro (blanco, gris o negro)");
  assert.deepEqual(notasDeColor(ambigua!), [FRASE_NEUTRO, "Podría ser también Cristal Transparente"]);
  assert.deepEqual(notasDeColor(nombrada!), [], "porNombre es una marca interna: no se dice");
  const nombradaYAmbigua = color("#eba3bb", 0.2, [candidata("409", 3), candidata("450", 5)], { porNombre: true, ambigua: true });
  assert.deepEqual(notasDeColor(nombradaYAmbigua), []);
  const lejano = ARCO.colores[0]!;
  assert.deepEqual(notasDeColor(lejano), [FRASE_SIN_REFERENCIA]);
  assert.equal(FRASE_SIN_REFERENCIA, "No encontramos un globo igual: puede ser sombra, fondo o un adorno");
  const lejanoNeutro = color("#222222", 0.3, [candidata("981", 50)], { sinReferencia: true, neutro: true });
  assert.deepEqual(notasDeColor(lejanoNeutro), [FRASE_SIN_REFERENCIA], "sin referencia no se matiza");
});

caso("porcentaje: «37 % de la pieza», redondeado y acotado", () => {
  assert.equal(porcentajeDeLaPieza(0.37).texto, "37 % de la pieza");
  assert.equal(porcentajeDeLaPieza(0.374).valor, 37);
  assert.equal(porcentajeDeLaPieza(1).texto, "100 % de la pieza");
  assert.equal(porcentajeDeLaPieza(0.002).texto, "Menos del 1 % de la pieza");
});

caso("vista de un color: globo, parecido y otras opciones solo con nombre", () => {
  const vista = vistaDeColor(COLUMNA.colores[0]!);
  assert.equal(vista.globo?.nombre, "Cristal Transparente");
  assert.equal(vista.globo?.codigo, "390");
  assert.equal(vista.globo?.acabado, "translúcido");
  assert.equal(vista.parecido?.texto, "Muy parecido");
  assert.deepEqual(
    vista.otras.map((otra) => otra.nombre),
    ["Reflex Plata"],
  );
  assert.equal(vista.etiquetaOtras, "Para Cristal Transparente");
  assert.equal(vista.porcentajeCorto, "37 %");
  const lejos = vistaDeColor(ARCO.colores[0]!);
  assert.equal(lejos.globo, null, "sin referencia no se sugiere un globo");
  assert.equal(lejos.parecido, null);
  assert.equal(lejos.etiquetaOtras, "Lo más cercano del catálogo");
  assert.equal(lejos.otras.length, 2);
  assert.equal(vistaDeColores(null).length, 0);
});

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

const html = renderToStaticMarkup(React.createElement(ColoresSempertex, { analisis: ANALISIS }));
const INICIO_TECNICO = html.indexOf("<details data-detalle-tecnico");
const FIN_TECNICO = html.indexOf("</details>", INICIO_TECNICO) + "</details>".length;
const tecnico = html.slice(INICIO_TECNICO, FIN_TECNICO);
const fueraDelTecnico = html.slice(0, INICIO_TECNICO) + html.slice(FIN_TECNICO);

/** Lo que lee la persona: sin etiquetas ni atributos (`px-4` es una clase, no un «px»). */
function textoVisible(marcado: string): string {
  return marcado
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

const visible = textoVisible(fueraDelTecnico);
const visibleTecnico = textoVisible(tecnico);

caso("render: el plegable técnico existe, está cerrado y no lleva otro plegable dentro", () => {
  assert.ok(INICIO_TECNICO > 0, "falta el <details> técnico");
  assert.ok(INICIO_TECNICO > html.indexOf("Colores de tu foto"), "va después de las piezas");
  assert.equal(html.slice(INICIO_TECNICO).split("<details").length - 1, 1, "el técnico es el último plegable");
  assert.ok(!/<details[^>]*data-detalle-tecnico[^>]*\sopen(?:=""|[\s>])/.test(html), "cerrado por defecto");
  assert.equal(tecnico.split("<details").length - 1, 1);
  assert.ok(visibleTecnico.startsWith("Ver detalle técnico"));
});

caso("render: fuera del plegable técnico no hay jerga de depuración", () => {
  const prohibido: Array<[string, RegExp]> = [
    ["croma", /\bcroma\b/i],
    ["tono", /\btono\b/i],
    ["px", /\bpx\b|píxel/i],
    ["PMS", /\bPMS\b|Pantone/i],
    ["# de hex", /#/],
    ["croquis", /croquis/i],
    ["marca interna", /lo nombró|ambigua\b/i],
    ["id de la pieza", /REF_\d+_E\d+/],
    ["distancia", /ΔE|delta/i],
    ["«zona(s)»", /\(s\)/],
    ["acabado en inglés", /\b(translucent|glossy|chrome|pearlescent|matte|satin|metallic)\b/i],
    ["tipo crudo", /\b(columna|arco|pared)\b(?! de)/],
  ];
  for (const [nombre, patron] of prohibido) {
    assert.ok(!patron.test(visible), `se ve «${nombre}» fuera del detalle técnico: ${patron.exec(visible)?.[0]}`);
  }
  assert.ok(!/#[0-9a-f]{6}/i.test(visible));
});

caso("render: sí están los nombres comerciales, los porcentajes y las frases en llano", () => {
  for (const nombre of ["Cristal Transparente", "Reflex Plata", "Satín Rosado", "Satín Lila", "Pastel Dusk Lavanda"]) {
    assert.ok(visible.includes(nombre), `falta «${nombre}»`);
  }
  for (const referencia of ["Ref. 390", "Ref. 981", "Ref. 409", "Ref. 450", "Ref. 150"]) {
    assert.ok(visible.includes(referencia), `falta «${referencia}»`);
  }
  for (const porcentaje of ["37 % de la pieza", "26 % de la pieza", "17 % de la pieza", "12 % de la pieza", "8 % de la pieza", "64 % de la pieza"]) {
    assert.ok(visible.includes(porcentaje), `falta «${porcentaje}»`);
  }
  for (const frase of [
    "Colores de tu foto",
    "Globos del catálogo que más se parecen a tu foto. Es solo una guía: no cambia lo que se compra.",
    "Columna",
    "Arco",
    "Pared de globos",
    "En cada fila: tu foto, y a su lado el globo sugerido.",
    "5 colores",
    "Muy parecido",
    "Parecido",
    "Aproximado",
    "translúcido",
    "cromado brillante",
    "satinado",
    "pastel mate",
    FRASE_NEUTRO,
    "Podría ser también Cristal Transparente",
    FRASE_SIN_REFERENCIA,
    "Otras opciones parecidas",
    "Lo más cercano del catálogo",
    "No pudimos medir colores en esta pieza",
    "Un color era el mismo globo visto con otra luz y se juntó con el suyo.",
  ]) {
    assert.ok(visible.includes(frase), `falta «${frase}»`);
  }
  assert.ok(!visible.includes("— Un color"), "el aviso es una nota discreta, no una línea con guion");
});

caso("render: el color sin referencia no sugiere un globo", () => {
  const desde = fueraDelTecnico.indexOf(">Arco<");
  assert.ok(desde > 0, "un arco solo se llama «Arco»");
  const arco = fueraDelTecnico.slice(desde, fueraDelTecnico.indexOf(">Pared de globos<"));
  assert.equal(arco.split("globo sugerido:").length - 1, 1, "de los dos colores del arco, solo uno tiene globo sugerido");
  assert.equal(arco.split("En tu foto:").length - 1, 1, "el otro solo enseña su color de la foto");
});

caso("render: «Otras opciones parecidas» es un único plegable con teclado y sin distancias", () => {
  assert.equal((html.match(/<details data-plegable="otras"/g) ?? []).length, 1);
  assert.ok(/<summary[^>]*>Otras opciones parecidas/.test(fueraDelTecnico));
  assert.ok(!/\(\d+(\.\d+)?\)/.test(visible), "ninguna distancia entre paréntesis");
  assert.ok(visible.includes("Para Cristal Transparente: "), "cada grupo dice a qué color se refiere");
});

/** El marcado sin los plegables de abajo (otras opciones, notas y detalle técnico): lo que se ve sin pulsar nada. */
function sinPlegables(marcado: string): string {
  let resto = marcado;
  for (const apertura of ['<details data-plegable="otras"', '<details data-plegable="notas"', "<details data-detalle-tecnico"]) {
    const inicio = resto.indexOf(apertura);
    if (inicio < 0) continue;
    resto = resto.slice(0, inicio) + resto.slice(resto.indexOf("</details>", inicio) + "</details>".length);
  }
  return resto;
}

caso("render compacto: una fila por color, frases cortas y todo lo demás plegado", () => {
  const visibleSinPulsar = sinPlegables(html);
  const colores = ANALISIS.piezas.reduce((total, p) => total + p.colores.length, 0);
  assert.equal(colores, 7);
  assert.equal((visibleSinPulsar.match(/<li data-color/g) ?? []).length, colores, "una fila por color");
  assert.equal((visibleSinPulsar.match(/<h3/g) ?? []).length, 1);
  assert.equal((visibleSinPulsar.match(/<details/g) ?? []).length, 1, "solo el bloque: lo demás es plegable y se quita");
  const parrafos = Array.from(visibleSinPulsar.matchAll(/<p[ >][\s\S]*?<\/p>/g), (m) => textoVisible(m[0]));
  assert.ok(parrafos.length >= 3, "hay frases que medir");
  for (const contenido of parrafos) {
    assert.ok(contenido.length <= 100, `frase de ${contenido.length} caracteres fuera de los plegables: «${contenido}»`);
  }
  // Lo que se oculta tras un plegable no está a la vista: ni las notas ni las alternativas ni lo técnico.
  const sinPulsar = textoVisible(visibleSinPulsar);
  assert.ok(!sinPulsar.includes("Un color era el mismo globo"));
  assert.ok(!sinPulsar.includes("Para Cristal Transparente:"));
  assert.ok(!/\bcroma\b/i.test(sinPulsar));
  assert.ok(sinPulsar.includes("Otras opciones parecidas") === false, "el plegable entero se quita, con su título");
});

caso("render compacto: cerrado con muchos colores (resumen de una línea), abierto con pocos", () => {
  assert.ok(!/<details data-bloque-colores=""[^>]*\sopen(?:=""|[\s>])/.test(html), "con 7 colores llega cerrado");
  assert.ok(visible.includes("Colores de tu foto 5 colores"), "el resumen dice cuántos globos se sugieren");
  const pocos = renderToStaticMarkup(
    React.createElement(ColoresSempertex, { analisis: { version: ANALISIS_COLOR_VERSION, piezas: [pieza("REF_01_E03", "arco", ARCO.colores)] } }),
  );
  assert.ok(/<details data-bloque-colores=""[^>]*\sopen(?:=""|[\s>])/.test(pocos), "con 2 colores llega abierto");
  assert.ok(!/<details[^>]*data-detalle-tecnico[^>]*\sopen(?:=""|[\s>])/.test(pocos), "el detalle técnico sigue cerrado");
  assert.ok(!/<details data-plegable[^>]*\sopen(?:=""|[\s>])/.test(pocos), "las alternativas siguen cerradas");
  assert.equal(bloqueAbiertoPorDefecto(vistaDeColores(ANALISIS)), false);
  assert.equal(MAX_COLORES_BLOQUE_ABIERTO, 4);
});

caso("render compacto: una muestra de la foto y una del globo por fila, con título accesible", () => {
  assert.ok(html.includes('title="Cristal Transparente · Ref. 390 · translúcido"'), "el nombre completo, con su referencia y acabado, también está en el title");
  assert.ok(html.includes("En tu foto, y globo sugerido:"));
  assert.ok(html.includes("<summary"), "los plegables usan <summary>, que se maneja con teclado");
  assert.ok(/min-h-11/.test(html), "el control del resumen mide al menos 44 px");
});

caso("resumen: globos distintos, de más a menos; un globo repetido cuenta una vez", () => {
  const resumen = resumenDeColores(vistaDeColores(ANALISIS));
  assert.equal(resumen.total, 5);
  assert.equal(resumen.texto, "5 colores");
  assert.deepEqual(
    resumen.muestras.map((globo) => globo.codigo),
    ["390", "409", "981", "450", "150"],
  );
  assert.equal(resumenDeColores([]).texto, null);
});

caso("notas del bloque: con el nombre de la pieza solo si hay varias", () => {
  const varias = notasDelBloque(vistaDeColores(ANALISIS));
  assert.deepEqual(varias, [{ pieza: "Columna", aviso: "Un color era el mismo globo visto con otra luz y se juntó con el suyo." }]);
  const unica = notasDelBloque(vistaDeColores({ version: ANALISIS_COLOR_VERSION, piezas: [COLUMNA] }));
  assert.equal(unica[0]?.pieza, null);
});

caso("render: todo lo técnico sigue dentro del plegable (no se pierde auditoría)", () => {
  for (const [nombre, patron] of [
    ["id de la pieza", /REF_01_E02/],
    ["id de la otra pieza", /REF_01_E03/],
    ["tipo crudo", /\bcolumna\b/],
    ["croquis", /croquis: franja vertical \(82 % de la caja\)/],
    ["píxeles", /45\.461 px medidos de 54\.791|45,461 px medidos de 54,791/],
    ["hex", /#dfe6e8/],
    ["PMS", /PMS 877/],
    ["acabado en inglés", /glossy chrome/],
    ["tono y croma", /tono 96\.5° · croma ×1\.4/],
    ["distancias", /Reflex Plata \(17\)/],
    ["marca interna", /lo nombró el análisis/],
    ["marca ambigua", /ambigua/],
    ["aviso", /Un color era el mismo globo visto con otra luz/],
  ] as Array<[string, RegExp]>) {
    assert.ok(patron.test(visibleTecnico), `el detalle técnico perdió «${nombre}»`);
  }
});

caso("render: el color del número técnico usa los mismos umbrales que el parecido", () => {
  // 8,5 y 12 (≤ 14) verde; 17 y 19,6 (≤ 26) ámbar; 30,2 rojo.
  assert.ok(tecnico.includes("text-emerald-600"));
  assert.ok(tecnico.includes("text-amber-600"));
  assert.ok(tecnico.includes("text-rose-600"));
});

caso("render: sin análisis o sin piezas no hay nada", () => {
  assert.equal(renderToStaticMarkup(React.createElement(ColoresSempertex, { analisis: null })), "");
  assert.equal(renderToStaticMarkup(React.createElement(ColoresSempertex, { analisis: { version: ANALISIS_COLOR_VERSION, piezas: [] } })), "");
});

console.log(`\n${casos} casos OK`);
