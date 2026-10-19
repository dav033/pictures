import assert from "node:assert/strict";
import test from "node:test";
import { armarEscena, type Escena, type EscenaArmada } from "./escena";
import { BIBLIOTECA_FABRICA, escenaDeItem } from "./biblioteca";
import { ESCENAS_PREDEFINIDAS } from "./escenas-presets";
import { marcasDeLinea, type FilaCompacta } from "./hoja-armado-compacta";
import { estructuraDeNodo } from "./hoja-armado-estructura";
import { hojaDeEscena, type HojaArmado } from "./hoja-armado";

/**
 * Lo que el motor ya sabe de cada globo y la hoja tiene que imprimir: si es de helio, si va impreso, si es un cristal con
 * confeti, de qué parte de la pieza es, las flores metidas entre los globos y el relleno de una burbuja. Y lo que no puede
 * juntar: dos piezas que se arman distinto.
 */

type Idea = { escena: Escena; armada: EscenaArmada; hoja: HojaArmado };

function idea(id: string): Idea {
  const item = BIBLIOTECA_FABRICA.find((i) => i.id === id);
  assert.ok(item, `no está ${id}`);
  const escena = escenaDeItem(item);
  const armada = armarEscena(escena);
  return { escena, armada, hoja: hojaDeEscena(item.nombre ?? id, escena, armada) };
}

const filaCon = (hoja: HojaArmado, nombre: string): FilaCompacta => {
  const fila = hoja.compactas.find((f) => f.nombres.some((n) => n.includes(nombre)));
  assert.ok(fila, `no hay fila de «${nombre}»`);
  return fila;
};

test("idea:olla-embrujada: la olla de aire y el globo negro de helio no se juntan, y la fila de helio lo dice", () => {
  const { hoja } = idea("idea:olla-embrujada");
  const olla = filaCon(hoja, "Olla: R-12 negro");
  const helio = filaCon(hoja, "R-12 negro con helio");
  assert.notEqual(olla, helio);
  assert.deepEqual(olla.contenido.map(marcasDeLinea), [["(globo)"]]);
  assert.deepEqual(helio.contenido.map(marcasDeLinea), [["de helio", "(globo)"]]);
  // La araña lleva dos R-5 del mismo color de tamaños distintos: cada línea dice de qué parte es.
  assert.deepEqual(filaCon(hoja, "Araña").contenido.filter((l) => l.formatoId === "R-5").map((l) => l.parte), ["cuerpo", "cabeza"]);
});

test("idea:bouquet-te-amo: dos impresos distintos del mismo globo no se juntan y cada fila nombra su producto", () => {
  const { hoja } = idea("idea:bouquet-te-amo");
  const teAmo = filaCon(hoja, "«te amo»");
  const corazon = filaCon(hoja, "corazón blanco");
  assert.notEqual(teAmo, corazon);
  const [lineaTeAmo] = teAmo.contenido, [lineaCorazon] = corazon.contenido;
  assert.equal(lineaTeAmo!.codigo, lineaCorazon!.codigo, "son el mismo R-12 del mismo color");
  assert.match(lineaTeAmo!.impreso?.texto ?? "", /I LOVE YOU MODERNO/);
  assert.match(lineaCorazon!.impreso?.texto ?? "", /LOVE FASHION SURTIDO/);
  assert.ok(marcasDeLinea(lineaTeAmo!).includes("de helio"));
  // Las burbujas de cristal con confeti dicen su relleno.
  assert.match(filaCon(hoja, "Cristal con confeti").relleno ?? "", /^Relleno: confeti de papel, \d+ papelitos/);
});

test("los dibujos pegados se juntan por lo que llevan, no por sus polígonos (que se calculan globo a globo)", () => {
  const aranas = idea("idea:aro-de-aranas").hoja;
  assert.equal(aranas.compactas.length, 4, aranas.compactas.map((f) => f.nombres.join("; ")).join(" | "));
  const preset = ESCENAS_PREDEFINIDAS.find((p) => p.id === "halloween_aro_ojos")!;
  const ojos = hojaDeEscena(preset.nombre, preset.escena, armarEscena(preset.escena));
  assert.equal(ojos.compactas.length, 4, ojos.compactas.map((f) => f.nombres.join("; ")).join(" | "));
  const pegados = [...aranas.compactas, ...ojos.compactas].flatMap((f) => f.contenido).filter((l) => l.impreso);
  assert.ok(pegados.length > 0 && pegados.every((l) => l.impreso!.texto === "dibujo pegado"), "un dibujo pegado se nombra sin suponer qué es");
});

test("idea:arco-primera-comunion: las burbujas con los mismos globos y otro reparto por dentro no se juntan", () => {
  const { escena, armada, hoja } = idea("idea:arco-primera-comunion");
  const piezas = new Map(escena.nodos.map((n) => [n.id, n.pieza] as const));
  const cristales = armada.porNodo.filter((n) => n.id.startsWith("cristal"));
  const firmas = new Set(cristales.map((n) => estructuraDeNodo(n, piezas.get(n.id), {}).firma));
  assert.ok(cristales.length === 4 && firmas.size > 1, "las cuatro burbujas no tienen el mismo reparto");
  const enLaHoja = hoja.estructuras.filter((e) => e.nombre.startsWith("Globo cristal"));
  assert.equal(enLaHoja.length, firmas.size, "una estructura por reparto distinto");
  assert.equal(enLaHoja.reduce((s, e) => s + e.unidades, 0), cristales.length);
});

test("idea:columna-organica: las flores de una pieza con globos salen en su resumen", () => {
  const { armada, hoja } = idea("idea:columna-organica");
  const nodo = armada.porNodo.find((n) => n.id === "columna")!;
  const columna = hoja.estructuras.find((e) => e.id === "columna")!;
  assert.ok(nodo.flores.length > 0);
  assert.equal(columna.flores.reduce((s, f) => s + f.cantidad, 0) * columna.unidades, nodo.flores.length);
});

test("idea:arco-primera-comunion: los Graffiti impresos de cada capa se nombran en la capa", () => {
  const { hoja } = idea("idea:arco-primera-comunion");
  const graffiti = hoja.estructuras.find((e) => e.nombre.includes("Graffiti Rosa"))!;
  assert.ok(graffiti.capas.length > 0);
  for (const capa of graffiti.capas) assert.ok(capa.marcas.some((m) => /^4 con impreso/.test(m)), `capa ${capa.numero}: ${capa.marcas.join(" · ")}`);
});
