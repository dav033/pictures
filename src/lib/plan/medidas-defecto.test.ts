import assert from "node:assert/strict";
import test from "node:test";
import { PistaGeometriaSchema } from "./geometria-referencia";
import { estructurasMedidasPorCliente } from "./medidas-defecto";

test("asocia medida explícita a la pieza nombrada, no a todas las estructuras", () => {
  const piezas = [
    { estructura_id: "EST_01_ARCO", tipo: "arco", nombre: "Arco" },
    { estructura_id: "EST_02_COLUMNA", tipo: "columna", nombre: "Columna" },
  ] as const;

  assert.deepEqual(estructurasMedidasPorCliente(piezas, "El arco mide 3 m de ancho."), ["EST_01_ARCO"]);
});

test("asocia medidas distintas a las piezas nombradas en una misma oración", () => {
  const piezas = [
    { estructura_id: "EST_01_ARCO", tipo: "arco", nombre: "Arco" },
    { estructura_id: "EST_02_COLUMNA", tipo: "columna", nombre: "Columna orgánica" },
  ] as const;

  assert.deepEqual(estructurasMedidasPorCliente(piezas, "El arco mide 3 m y la columna orgánica 2 m."), ["EST_01_ARCO", "EST_02_COLUMNA"]);
});

test("no trata medida del espacio como medida de una pieza", () => {
  const piezas = [{ estructura_id: "EST_01_ARCO", tipo: "arco", nombre: "Arco" }] as const;

  assert.deepEqual(estructurasMedidasPorCliente(piezas, "El salón mide 3 metros."), []);
});

test("desambigua columnas repetidas por el lado que nombró el cliente", () => {
  const piezas = [
    { estructura_id: "EST_01_COLUMNA", tipo: "columna", nombre: "Columna orgánica izquierda" },
    { estructura_id: "EST_02_COLUMNA", tipo: "columna", nombre: "Columna orgánica derecha" },
  ] as const;

  assert.deepEqual(estructurasMedidasPorCliente(piezas, "La columna derecha mide 2 m."), ["EST_02_COLUMNA"]);
});

test("no asigna una medida ambigua de una pieza a todas las piezas del mismo tipo", () => {
  const estructuras = [
    { estructura_id: "izq", tipo: "columna", nombre: "Columna izquierda" },
    { estructura_id: "der", tipo: "columna", nombre: "Columna derecha" },
  ] as const;

  assert.deepEqual(estructurasMedidasPorCliente(estructuras, "La columna mide 2 m"), []);
});

test("pista geométrica requiere origen de foto para separar escalas", () => {
  const pista = { referencia_element_id: "REF_01_E01", source_image_id: "REF_01", caja: { x: 0.1, y: 0.1, width: 0.4, height: 0.6 }, confianza: 0.9 };

  assert.equal(PistaGeometriaSchema.safeParse(pista).success, true);
  const sinOrigen = { referencia_element_id: pista.referencia_element_id, caja: pista.caja, confianza: pista.confianza };
  assert.equal(PistaGeometriaSchema.safeParse(sinOrigen).success, false);
});
