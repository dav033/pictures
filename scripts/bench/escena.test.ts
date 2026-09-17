import assert from "node:assert/strict";
import test from "node:test";
import { coloresDeEscena, construirEscena, estructurasDeEscena, PRODUCTO_POR_COLOR, repartirColores } from "./escena";

/**
 * D10: el benchmark no podía ver la clase de defecto que llegó al usuario.
 *
 * La plantilla usa tres colores en el arco y dos en cada columna, así que un
 * cuarto color renderizable no llega a ninguna pieza — y el informe lo contaba
 * en `renderizables` como si se hubiera usado. Esto es exactamente D7 visto
 * desde el arnés: un color detectado, plegado al catálogo, con concepto de
 * producto, y que aun así no compra nada.
 *
 * Las pruebas usan colores reales de `PRODUCTO_POR_COLOR` en vez de inventados:
 * una lista escrita aquí mediría esta lista y no el sistema.
 */

const ASPECTO = "3:2" as const;

test("un cuarto color renderizable no llega a ninguna línea, y la aserción lo dice", () => {
  const cuatro = ["rosado", "azul", "morado", "blanco"];
  for (const color of cuatro) assert.ok(PRODUCTO_POR_COLOR[color], `${color} debería tener concepto de producto`);

  const escena = construirEscena(cuatro, ASPECTO);
  const cotizados = coloresDeEscena(escena);
  const sinLinea = cuatro.filter((color) => !cotizados.includes(color));

  assert.deepEqual(cotizados, ["rosado", "azul", "morado"]);
  assert.deepEqual(sinLinea, ["blanco"], "el cuarto color de la paleta no compra nada");
});

test("con tres colores o menos no se pierde ninguno", () => {
  const tres = ["rosado", "azul", "morado"];
  const cotizados = coloresDeEscena(construirEscena(tres, ASPECTO));
  assert.deepEqual(tres.filter((color) => !cotizados.includes(color)), []);
});

test("la columna solo lleva dos colores, pero el arco rescata el tercero", () => {
  const escena = construirEscena(["rosado", "azul", "morado"], ASPECTO);
  const arco = escena.elements.find((el) => el.element_id === "EST_01_ARCO");
  const columna = escena.elements.find((el) => el.element_id === "EST_02_COL_IZQ");
  assert.deepEqual(arco?.resolved_colors, ["rosado", "azul", "morado"]);
  assert.deepEqual(columna?.resolved_colors, ["rosado", "azul"]);
});

test("la plantilla solo levanta un arco y columnas: cualquier otra forma de la referencia queda ausente", () => {
  const escena = construirEscena(["rosado", "azul"], ASPECTO);
  const clases = estructurasDeEscena(escena);
  assert.deepEqual(clases, ["arco", "columna"]);

  // Una referencia que es una pared de globos y un centro de mesa: la plantilla
  // no construye ninguna de las dos y hasta D10 el informe no lo decía.
  const referencia = ["pared", "centro_mesa"];
  assert.deepEqual(referencia.filter((clase) => !clases.includes(clase)), ["pared", "centro_mesa"]);
});

test("un color sin concepto de producto no llega a la escena y se separa del que sí lo tiene", () => {
  // `gris` está fuera de la paleta del catálogo a propósito (ADR-0024), así que
  // el vocabulario no lo dibuja; la aserción de cotización no debe confundir ese
  // caso con el de un color que sí es dibujable y aun así se pierde.
  const reparto = repartirColores(["rosado", "gris", "azul"]);
  assert.deepEqual(reparto.sinConcepto, ["gris"]);
  const cotizados = coloresDeEscena(construirEscena(reparto.renderizables, ASPECTO));
  assert.deepEqual(reparto.renderizables.filter((color) => !cotizados.includes(color)), []);
});
