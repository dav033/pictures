import assert from "node:assert/strict";
import test from "node:test";
import { diferenciaEscenas, hayCambios } from "./diferencia-escena";

test("escenas del taller: piezas agregadas, quitadas y modificadas con sus campos", () => {
  const antes = { sala: { ancho: 5, alto: 3 }, nodos: [{ id: "a", pos: { x: 1, y: 0 }, color: "rojo" }, { id: "b", color: "azul" }] };
  const despues = { sala: { ancho: 6, alto: 3 }, nodos: [{ id: "a", pos: { x: 2, y: 0 }, color: "rojo" }, { id: "c", color: "verde" }] };
  assert.deepEqual(diferenciaEscenas(antes, despues), {
    agregados: ["c"],
    quitados: ["b"],
    modificados: [{ id: "a", campos: ["pos.x"] }],
    otros: ["sala.ancho"],
  });
});

test("escenas idénticas no tienen cambios", () => {
  const escena = { nodos: [{ id: "a", x: 1 }], sala: { ancho: 5 } };
  const diferencia = diferenciaEscenas(escena, structuredClone(escena));
  assert.equal(hayCambios(diferencia), false);
});

test("el plan del cliente (sin nodos) se compara por rutas de campo", () => {
  const diferencia = diferenciaEscenas({ evento: "boda", piezas: [{ estructura: "arco", cantidad: 1 }], colores: ["rojo"] }, { evento: "boda", piezas: [{ estructura: "arco", cantidad: 2 }], colores: ["rojo"] });
  assert.deepEqual(diferencia, { agregados: [], quitados: [], modificados: [], otros: ["piezas"] });
});

test("nodos sin id string se tratan como forma desconocida y no fallan", () => {
  const diferencia = diferenciaEscenas({ nodos: [1, 2] }, { nodos: [1, 3] });
  assert.deepEqual(diferencia.otros, ["nodos"]);
});

test("limita la cantidad de piezas reportadas", () => {
  const muchos = Array.from({ length: 500 }, (_, i) => ({ id: `n${i}` }));
  assert.equal(diferenciaEscenas({ nodos: [] }, { nodos: muchos }).agregados.length, 200);
});
