import assert from "node:assert/strict";
import test from "node:test";
import { DESVIACION_MINIMA, desviacionesProporcion, participacionPorColor } from "./proporcion-referencia";

test("las participaciones del mismo color se suman en vez de contarse dos veces", () => {
  assert.deepEqual(
    participacionPorColor([
      { color: "rojo", participacion: 0.3 },
      { color: "Rojo", participacion: 0.2 },
      { color: "dorado", participacion: 0.5 },
    ]),
    [
      { color: "dorado", participacion: 0.5 },
      { color: "rojo", participacion: 0.5 },
    ],
  );
});

test("un plan que respeta la proporcion de la foto no avisa de nada", () => {
  const desviaciones = desviacionesProporcion(
    "E1",
    [
      { color: "rojo", share: 0.7 },
      { color: "dorado", share: 0.3 },
    ],
    [
      { color: "rojo", participacion: 0.7 },
      { color: "dorado", participacion: 0.3 },
    ],
  );
  assert.deepEqual(desviaciones, []);
});

test("un plan que invierte la proporcion de la foto avisa, con el delta", () => {
  const desviaciones = desviacionesProporcion(
    "E1",
    [
      { color: "rojo", share: 0.7 },
      { color: "dorado", share: 0.3 },
    ],
    [
      { color: "dorado", participacion: 0.7 },
      { color: "rojo", participacion: 0.3 },
    ],
  );
  assert.equal(desviaciones.length, 2);
  const rojo = desviaciones.find((entrada) => entrada.color === "rojo");
  assert.equal(rojo?.medida, 0.7);
  assert.equal(rojo?.declarada, 0.3);
  assert.ok((rojo?.delta ?? 0) < 0, "el plan lleva menos rojo del que la foto tiene");
});

test("los pixeles sin catalogo no hacen que todo plan parezca excesivo", () => {
  // La caja es 40 % rojo, 20 % dorado y 40 % madera. Sobre los globos eso es
  // dos tercios rojo y un tercio dorado, que es justo lo que el plan declara.
  // Sin renormalizar, el 0,67 declarado contra el 0,40 medido dispararia un
  // aviso en cada plan que existe.
  const desviaciones = desviacionesProporcion(
    "E1",
    [
      { color: "rojo", share: 0.4 },
      { color: "dorado", share: 0.2 },
    ],
    [
      { color: "rojo", participacion: 0.667 },
      { color: "dorado", participacion: 0.333 },
    ],
  );
  assert.deepEqual(desviaciones, []);
});

test("un color de la foto que el plan no compra sale con declarada 0", () => {
  const desviaciones = desviacionesProporcion("E1", [{ color: "rojo", share: 1 }], [{ color: "azul", participacion: 1 }]);
  assert.equal(desviaciones.length, 1);
  assert.equal(desviaciones[0]?.color, "rojo");
  assert.equal(desviaciones[0]?.declarada, 0);
  assert.equal(desviaciones[0]?.delta, -1);
});

test("una diferencia por debajo del minimo es redondeo, no un aviso", () => {
  const desviaciones = desviacionesProporcion(
    "E1",
    [
      { color: "rojo", share: 0.5 },
      { color: "dorado", share: 0.5 },
    ],
    [
      { color: "rojo", participacion: 0.5 + DESVIACION_MINIMA / 2 },
      { color: "dorado", participacion: 0.5 - DESVIACION_MINIMA / 2 },
    ],
  );
  assert.deepEqual(desviaciones, []);
});

test("sin medida no se inventa una comparacion", () => {
  assert.deepEqual(desviacionesProporcion("E1", [], [{ color: "rojo", participacion: 1 }]), []);
});
