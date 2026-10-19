import assert from "node:assert/strict";
import test from "node:test";
import { MS_PARA_REAJUSTAR_ALTO, altoQueCabe, decidirAlto } from "./alto-nueva-organica";

test("una pieza que cae a menos de 4 cm del alto pedido se deja como está, tarde lo que tarde", () => {
  for (const costoMs of [100, 20_000]) assert.deepEqual(decidirAlto({ medidoCm: 323, pedidoCm: 320, costoMs }), { accion: "dejar" });
});

test("pasada de 4 cm, se vuelve a armar estirada si la primera armada fue rápida (como siempre)", () => {
  assert.deepEqual(decidirAlto({ medidoCm: 326, pedidoCm: 320, costoMs: MS_PARA_REAJUSTAR_ALTO }), { accion: "reajustar" });
  assert.deepEqual(decidirAlto({ medidoCm: 300, pedidoCm: 320, costoMs: 500, techoCm: 320 }), { accion: "reajustar" });
});

test("si la primera armada tardó más de ~6 s no se vuelve a armar para afinar el alto, y se dice cuánto quedó y por qué", () => {
  const d = decidirAlto({ medidoCm: 305, pedidoCm: 320, costoMs: 10_000, techoCm: 600 });
  assert.equal(d.accion, "dejar");
  assert.match(d.nota ?? "", /quedó de 305 cm de alto y no de los 320 pedidos/);
  assert.match(d.nota ?? "", /tardaría demasiado/);
});

test("si además no cabe bajo el techo, se estira una vez (el error que antes se devolvía sin más)", () => {
  assert.deepEqual(decidirAlto({ medidoCm: 326, pedidoCm: 320, costoMs: 10_000, techoCm: 320 }), { accion: "al_techo" });
  assert.equal(decidirAlto({ medidoCm: 326, pedidoCm: 320, costoMs: 10_000, techoCm: 400 }).accion, "dejar", "con el techo más alto no hay error que evitar");
  assert.equal(decidirAlto({ medidoCm: 323, pedidoCm: 320, costoMs: 10_000, techoCm: 320 }).accion, "dejar", "dentro de la tolerancia queda lo de siempre");
});

test("el alto_cm que se dice es el más alto que, con la misma diferencia entre lo pedido y lo armado, cabe bajo el techo", () => {
  assert.equal(altoQueCabe(318, 326, 320), 311);
  assert.ok(altoQueCabe(318, 326, 320) - (326 - 318) < 320, "armada con ese alto queda bajo el techo");
});
