import assert from "node:assert/strict";
import test from "node:test";
import { fallar } from "./herramientas-escena-colores";
import { buscar, confirmar, crearCuota, type Cuota, type Probada } from "./herramientas-escena-tamanos-busqueda";
import type { Organico, PiezaOrganica } from "./organico-ajustes";
import { EMPAQUES } from "./organico-empaques";
import type { OpcionesOrganico } from "./organico";

/** Una pieza falsa: solo importa para `buscar`, que no la mira. */
const falsa = (k: number): Organico => ({ tipo: "organico", opciones: { k } as unknown as OpcionesOrganico, flores: null });
const valorDe = (p: Organico) => (p.opciones as unknown as { k: number }).k;

test("buscar salta un peso que no se puede probar en vez de tirar la herramienta entera, y sigue con los demás", () => {
  // «Más»: el peso 1,7 no se puede probar (como quitar todos los R-5 de un tramo que solo los lleva); con 3 ya se llega.
  const aplicar = (k: number) => (k === 1.7 ? fallar("Sin R-5 una parte de «Tronco» se quedaría sin globos") : falsa(k));
  const elegida = buscar(aplicar, (p) => 10 * valorDe(p), 10, 25, "al_menos", 2);
  assert.ok(elegida.valor >= 25, `valor ${elegida.valor}`);
});

test("si ningún peso se puede probar, queda la pieza como está (peso 1)", () => {
  const aplicar = (k: number) => (k === 1 ? falsa(1) : fallar("no se puede"));
  const elegida = buscar(aplicar, (p) => 10 * valorDe(p), 10, 2, "a_lo_mas", 1);
  assert.equal(elegida.k, 1);
});

test("si ni el peso 1 se puede probar, el error es claro y no un fallo de la búsqueda", () => {
  assert.throws(() => buscar(() => fallar("no se puede"), () => 0, 0, 5, "al_menos", 1), /No se pudo probar ningún peso/);
});

const piezaDe = (grosorCm: number): PiezaOrganica => {
  const tramo = { id: "t", nombre: "t", recorrido: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 400, z: 0 }], grosor: [{ t: 0, radioCm: grosorCm / 2 }, { t: 1, radioCm: grosorCm / 2 }], mezcla: [{ t: 0, pesos: { "R-12": 1 } }, { t: 1, pesos: { "R-12": 1 } }], irregularidad: 0 };
  const opciones: OpcionesOrganico = { semilla: 1, tramos: [tramo], variacionInflado: 0, relleno: [], colores: [{ codigo: "609", peso: 1 }], suelo: true, huecosFlores: 0 };
  return { tipo: "organico", opciones, flores: null };
};

/** Un empaque que acaba de pasar, anotado como lo anota `organico.ts`. */
const empaqueDe = (ms: number, globos: number) => { EMPAQUES.hechos += 1; EMPAQUES.ms += ms; EMPAQUES.registro.push({ ms, globos }); };
const conEmpaquesRestaurados = (prueba: () => void) => {
  const antes = { hechos: EMPAQUES.hechos, ms: EMPAQUES.ms, registro: [...EMPAQUES.registro] };
  try { prueba(); } finally { Object.assign(EMPAQUES, antes); }
};

test("la cuota cuenta solo los empaques de esta herramienta: lo que otro pedido armó antes no cambia lo que decide", () => {
  conEmpaquesRestaurados(() => {
    for (let i = 0; i < 40; i++) empaqueDe(10_000, 400);
    const cuota = crearCuota(piezaDe(40));
    assert.ok(cuota.alcanzaOtro(), "una pieza fina sigue pudiendo armar otra");
  });
});

test("la carga del equipo no la cierra: nunca se predice más de lo que dice la fórmula, aunque lo medido sea muy lento", () => {
  conEmpaquesRestaurados(() => {
    const cuota = crearCuota(piezaDe(40));
    empaqueDe(1, 30);
    const rapida = cuota.alcanzaOtro();
    empaqueDe(120_000, 30);
    assert.equal(cuota.alcanzaOtro(), rapida, "un armado de dos minutos (el equipo cargado) no cambia la decisión");
  });
});

test("lo medido más rápido que la fórmula la acerca a la realidad (un cuerpo delgado casi no lleva relleno)", () => {
  conEmpaquesRestaurados(() => {
    const cuota = crearCuota(piezaDe(160));
    for (let i = 0; i < 4; i++) empaqueDe(20, 400);
    assert.ok(cuota.alcanzaOtro(), "tras armados rápidos de una pieza que la fórmula daría por pesada, otro cabe");
  });
});

test("si la pieza cambió de mezcla y el armado que sale es mucho más pesado que la de partida, la cuota lo ve y deja de pedir armados", () => {
  conEmpaquesRestaurados(() => {
    // Una pieza de partida liviana (la fórmula dice milésimas), pero el primer armado de esta herramienta colocó 430 globos de estructura y tardó 6 s.
    const cuota = crearCuota(piezaDe(40));
    assert.ok(cuota.alcanzaOtro(), "antes de armar nada cabe");
    empaqueDe(6_000, 430);
    assert.ok(!cuota.alcanzaOtro(), "6 s gastados y el siguiente igual de pesado: otro no cabe");
    assert.ok(cuota.alcanzaOtro(true), "pero armar la pieza elegida, que ya es la última, sí: solo cuenta uno");
  });
});

// ----------------------------------------------------------------------------------------------------------
// confirmar: lo medido manda, también cuando se pasa de largo, y lo que se arma nunca pasa del tope
// ----------------------------------------------------------------------------------------------------------

const cuotaSiempre: Cuota = { alcanzaOtro: () => true };
/** Una pieza que al armarla da `6 + k` globos del formato, y la cuenta sin armar que se queda 3 cortos (el empaque deja fuera algunos). */
const real = (p: Organico) => 6 + valorDe(p);
const estimado = (p: Organico) => 3 + valorDe(p);
const elegidaCon = (k: number): Probada => ({ pieza: falsa(k), valor: estimado(falsa(k)), k, aplicar: falsa, actual: estimado(falsa(1)) });

test("si lo armado se pasa de largo de la meta (36 R-18 contra 29), confirmar prueba pesos más bajos y se queda con el que cae cerca", () => {
  const armados: number[] = [];
  const medido = (p: Organico) => { armados.push(valorDe(p)); return real(p); };
  const r = confirmar(elegidaCon(30), { real: medido, estimado, meta: 29, modo: "al_menos", tolerancia: 2, cuota: cuotaSiempre });
  assert.ok(r.valor >= 29 && r.valor <= 33, `quedó en ${r.valor}`);
  assert.ok(r.k < 30, `peso ${r.k}`);
  assert.ok(armados.length >= 2 && armados.length <= 3, `armados: ${armados.join(", ")}`);
});

test("si lo armado cae cerca de la meta, no se arma nada más", () => {
  const armados: number[] = [];
  const r = confirmar(elegidaCon(24), { real: (p) => { armados.push(valorDe(p)); return real(p); }, estimado, meta: 29, modo: "al_menos", tolerancia: 2, cuota: cuotaSiempre });
  assert.deepEqual(armados, [24]);
  assert.equal(r.valor, 30);
});

test("nunca arma un peso que el tope de globos rechaza: ni la corrección lo salta", () => {
  const armados: number[] = [];
  const sinSegundaBusqueda = (e: Probada) => (e.k === 30 ? e : null);
  const r = confirmar(elegidaCon(30), { real: (p) => { armados.push(valorDe(p)); return real(p); }, estimado, meta: 29, modo: "al_menos", tolerancia: 2, cuota: cuotaSiempre, acotar: sinSegundaBusqueda });
  assert.deepEqual(armados, [30], "solo la elegida");
  assert.equal(r.k, 30);
});

test("lo que se arma en la corrección es lo que el tope deja: el peso acotado, no el que buscó la cuenta", () => {
  const armados: number[] = [];
  const acotarA = (e: Probada): Probada => ({ ...e, k: 20, pieza: falsa(20), valor: estimado(falsa(20)) });
  confirmar(elegidaCon(30), { real: (p) => { armados.push(valorDe(p)); return real(p); }, estimado, meta: 29, modo: "al_menos", tolerancia: 2, cuota: cuotaSiempre, acotar: acotarA });
  assert.deepEqual(armados, [30, 20]);
});

test("sin cuota para otro armado, se queda con lo medido aunque se pase de largo", () => {
  const armados: number[] = [];
  const r = confirmar(elegidaCon(30), { real: (p) => { armados.push(valorDe(p)); return real(p); }, estimado, meta: 29, modo: "al_menos", tolerancia: 2, cuota: { alcanzaOtro: () => false } });
  assert.deepEqual(armados, [30]);
  assert.equal(r.valor, 36);
});
