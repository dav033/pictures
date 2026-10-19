import assert from "node:assert/strict";
import test from "node:test";
import { BASES_ORGANICAS, descripcionBase } from "./bases-organicas";
import { descripcionParaCliente } from "./descripcion-ficha";
import { IDEAS_SEMPERTEX } from "./ideas-sempertex";
import { REFERENCIAS_DUENO } from "./referencias-dueno";

/** Lo que solo sirve a quien armó la pieza: tonos medidos, píxeles, ΔE y avisos de lo que publica la página de la idea. */
const DE_QUIEN_LA_ARMO = /#[0-9a-f]{6}|ΔE|\bpx\b|no (?:publica|lista|trae) productos|sin productos publicados|escala (?:por|sale)|\bla escala\b|se modelan?\b|\bel motor\b/i;

test("la nota de una idea queda en «Lleva» y «Respecto a la foto», sin los tonos medidos ni la escala en píxeles", () => {
  const nota = "Igual: la columna de 18 cuartetos R-5 (8,5 cm) en espiral. Colores medidos: rayas Metal Dorado 570 y Reflex Plata 981. Distinto: la idea no publica productos; el dorado de la foto (#bb7009) está sobresaturado; la foto no trae nada de tamaño conocido: la escala sale de casar el ancho (~70–75 px) con el de la columna; en la foto el travesaño cruza por delante.";
  assert.equal(
    descripcionParaCliente(nota),
    "Lleva: la columna de 18 cuartetos R-5 (8,5 cm) en espiral. Colores: rayas Metal Dorado 570 y Reflex Plata 981.\nRespecto a la foto: el dorado de la foto está sobresaturado; en la foto el travesaño cruza por delante.",
  );
});

test("«Se parece» y «No» de las notas de figuras dicen lo mismo con las mismas palabras", () => {
  assert.equal(
    descripcionParaCliente("Se parece: el muñeco del bigote. No: es solo él. La ficha no trae productos: colores de la foto."),
    "Lleva: el muñeco del bigote.\nRespecto a la foto: es solo él.",
  );
});

test("un color medido pasa a ser el color de la tienda: «rojo #cf010e → Fashion Rojo 015» queda «rojo: Fashion Rojo 015»", () => {
  assert.equal(descripcionParaCliente("Igual: un arco. Colores medidos (no publica productos): rojo #cf010e → Fashion Rojo 015; azul #02869f → Fashion Azul Caribe 038."), "Lleva: un arco. Colores: rojo: Fashion Rojo 015; azul: Fashion Azul Caribe 038.");
});

test("un texto sin notas de pieza (una descripción de catálogo) pasa igual", () => {
  const catalogo = "Cinco R-5 en quinteto con un centro dorado: la flor clásica de las paredes de cuartetos.";
  assert.equal(descripcionParaCliente(catalogo), catalogo);
});

test("ninguna ficha de la biblioteca (ideas, referencias y bases) muestra lo que solo sirve a quien la armó", () => {
  const notas = [
    ...IDEAS_SEMPERTEX.map((i) => ({ id: i.id, texto: i.nota })),
    ...REFERENCIAS_DUENO.map((r) => ({ id: r.id, texto: `${r.nota} Fidelidad a la foto: ${r.fidelidad}/5.` })),
    ...BASES_ORGANICAS.map((b) => ({ id: b.id, texto: descripcionBase(b) })),
  ];
  assert.ok(notas.length > 400, `${notas.length} notas`);
  let conTexto = 0;
  for (const { id, texto } of notas) {
    const ficha = descripcionParaCliente(texto);
    assert.ok(!DE_QUIEN_LA_ARMO.test(ficha), `${id}: ${ficha.match(DE_QUIEN_LA_ARMO)?.[0]}`);
    assert.ok(!/\(\s*\)|\s{2}/.test(ficha), `${id}: quedó un paréntesis vacío o un doble espacio`);
    assert.ok(ficha.includes("Lleva: ") || (!texto.includes("Igual:") && !texto.includes("Se parece:")), `${id}: no dice lo que lleva`);
    if (ficha.length > 40) conTexto += 1;
  }
  assert.ok(conTexto > 400, "casi todas las fichas conservan su descripción");
});
