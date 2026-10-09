/**
 * Integración de mobiliario libre (REQ-012), salón de eventos (REQ-008) y honestidad de la IA de escena, con las frases EXACTAS del dueño en
 * producción, aplicadas directamente con las herramientas (sin IA ni red):
 *
 *   «6 mesas redondas con 4 sillas cada una»  → exactamente 24 sillas; el resumen, ver_escena, la verificación, el inventario en inglés y la
 *                                                lista de compra dicen 4 por mesa (las tres representaciones de sillas cuentan igual);
 *   «pon un centro de mesa en cada mesa»      → cada mesa lleva uno ENCIMA de su tapa (y = alto de la mesa) y se mueve con ella;
 *   «haz el salón más grande»                 → la sala crece y las mesas se quedan;
 *   un intento que falla                      → la respuesta final dice «No pude».
 *
 *   npx tsx scripts/test/test-mobiliario-honestidad-integrado.ts
 */
import assert from "node:assert/strict";
import { armarEscena, escenaEnIngles, moverNodo, SALA_INICIAL, type Escena, type NodoEscena } from "../../src/lib/globos3d/escena";
import { aplicarHerramienta, resumenEscena, type ResultadoHerramienta } from "../../src/lib/globos3d/herramientas-escena";
import { productosDe, itemDeEscena } from "../../src/lib/globos3d/biblioteca";
import { centrosDe, padreDeCentro } from "../../src/lib/globos3d/centros-mesa";
import { conHonestidad, fallosPendientes, objetivoDe, type Intento } from "../../src/lib/globos3d/honestidad-respuesta";
import { esDelSalon } from "../../src/lib/globos3d/salon-registro";
import { pasarAConjunto } from "../../src/lib/globos3d/mobiliario-conjunto-escena";
import { contarMobiliario, esMesa, sillasDeMesaNodo, textoSillasDeMesa } from "../../src/lib/globos3d/mobiliario-asientos-mesa";
import { muebleDe } from "../../src/lib/globos3d/mobiliario-catalogo";
import { nombreSegunEscena } from "../../src/lib/globos3d/nombre-escena";
import { opcionesDeMueble, piezaDeMueble } from "../../src/lib/globos3d/mobiliario-pieza";
import { superficieSuperior } from "../../src/lib/globos3d/mobiliario-superficie";
import { problemasNuevos } from "../../src/lib/globos3d/problemas-escena";
import { verificarCambios } from "../../src/lib/globos3d/verificacion-escena";

let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };
const ok = (r: ResultadoHerramienta): Extract<ResultadoHerramienta, { ok: true }> => { if (!r.ok) assert.fail(`se esperaba éxito y vino error: ${r.error}`); return r; };
const paso = (e: Escena, herramienta: string, args: Record<string, unknown>): Escena => ok(aplicarHerramienta(e, herramienta, args)).escena;
const nodo = (e: Escena, id: string): NodoEscena => e.nodos.find((n) => n.id === id) ?? assert.fail(`falta ${id}`);
const cerca = (real: number, esperado: number, tol: number, que: string) => assert.ok(Math.abs(real - esperado) <= tol, `${que}: ${real.toFixed(1)} (esperado ${esperado} ±${tol})`);

const vacia = (): Escena => ({ sala: { ...SALA_INICIAL, anchoCm: 1600, fondoCm: 1400 }, nodos: [] });
const RAMO = { tipo: "ramo_helio", colores: ["blanco", "dorado"] };
const mesasDe = (e: Escena) => e.nodos.filter(esMesa);

const seisMesas = (): { antes: Escena; despues: Escena; resumen: string } => {
  const antes = vacia();
  const r = ok(aplicarHerramienta(antes, "agregar_mesas", { cantidad: 6, tipo: "redonda", sillas_por_mesa: 4 }));
  return { antes, despues: r.escena, resumen: r.resumen };
};

// ----------------------------------------------------------------------------------------------------------
console.log("1. «6 mesas redondas con 4 sillas cada una»");

prueba("son exactamente 24 sillas y el resumen y la verificación dicen 4 por mesa", () => {
  const { antes, despues, resumen } = seisMesas();
  assert.deepEqual(contarMobiliario(despues), { mesas: 6, sillas: 24 });
  assert.match(resumen, /6 mesas redondas/);
  assert.match(resumen, /4 sillas Tiffany cada una \(24 sillas en total\)/);
  for (const m of mesasDe(despues)) assert.equal(sillasDeMesaNodo(despues, m).total, 4, m.id);
  const v = verificarCambios(antes, despues);
  assert.match(v, /mobiliario \(leído de las piezas\): mesas 0 → 6, sillas 0 → 24/);
  assert.match(v, /24 × Silla Tiffany/);
  assert.match(v, /24 asientos/);
  assert.match(nombreSegunEscena(despues), /^6 mesas con 24 sillas/);
});

prueba("ver_escena, el inventario en inglés y la lista de compra cuentan las mismas 24 sillas", () => {
  const { despues } = seisMesas();
  const ver = resumenEscena(despues);
  assert.equal(ver.split("\n").filter((l) => /4 sillas Tiffany en el grupo/.test(l)).length, 6, ver);
  const ingles = escenaEnIngles(despues, armarEscena(despues));
  assert.match(ingles, /24 × .*chair/);
  assert.match(ingles, /Each table has 4 chairs evenly spaced around it/);
  assert.doesNotMatch(ingles, /party props/);
  const lista = productosDe(itemDeEscena({ id: "x", nombre: "Seis mesas", ocasiones: [], escena: despues })).escenografia;
  assert.equal(lista.find((l) => l.nombre === "Silla Tiffany")?.cantidad, 24);
  assert.equal(lista.reduce((s, l) => s + (/^Mesa/.test(l.nombre) ? l.cantidad : 0), 0), 6);
});

prueba("las tres representaciones de sillas cuentan igual en una misma escena (grupo paramétrico, salón con 6 y conjunto fijo de siempre)", () => {
  let e = paso(vacia(), "agregar_mesas", { cantidad: 2, tipo: "redonda", sillas_por_mesa: 5, x_cm: -400, z_cm: 0 });
  const m = muebleDe("mesa_redonda_sillas")!;
  const delSalon: NodoEscena = { id: "mesa-salon", nombre: "Mesa 7", pieza: piezaDeMueble(m, opcionesDeMueble(m, { sillas: 6 })), colocacion: { en: "piso", xCm: 300, zCm: 0, giroGrados: 0 } };
  const deSiempre: NodoEscena = { id: "mesa-fija", nombre: "Mesa de siempre", pieza: piezaDeMueble(m), colocacion: { en: "piso", xCm: 550, zCm: -300, giroGrados: 0 } };
  e = { ...e, nodos: [...e.nodos, delSalon, deSiempre] };
  assert.deepEqual(contarMobiliario(e), { mesas: 4, sillas: 10 + 6 + 8 });
  assert.equal(sillasDeMesaNodo(e, delSalon).total, 6);
  assert.equal(sillasDeMesaNodo(e, deSiempre).total, 8);
  assert.equal(textoSillasDeMesa(sillasDeMesaNodo(e, nodo(e, "mesa-redonda"))), "5 sillas Tiffany");
  // ver_escena: la del salón dice 6 (no las 8 del catálogo) y los grupos dicen 5.
  const ver = resumenEscena(e);
  assert.match(ver, /«Mesa 7».*Mesa redonda con 6 sillas/);
  assert.match(ver, /«Mesa de siempre».*Mesa redonda con 8 sillas/);
  assert.equal(ver.split("\n").filter((l) => /5 sillas Tiffany en el grupo/.test(l)).length, 2);
  // La verificación: 24 asientos, y el inventario en inglés con las sillas de cada mesa.
  assert.match(verificarCambios(vacia(), e), /sillas 0 → 24/);
  assert.match(verificarCambios(vacia(), e), /24 asientos/);
  const ingles = escenaEnIngles(e, armarEscena(e));
  assert.match(ingles, /5 chairs evenly spaced around it/);
  assert.match(ingles, /6 chairs evenly spaced around it/);
  assert.match(ingles, /8 chairs evenly spaced around it/);
  // La lista de compra dice las sillas reales de cada conjunto fijo.
  const lista = productosDe(itemDeEscena({ id: "y", nombre: "Mezcla", ocasiones: [], escena: e })).escenografia.map((l) => `${l.cantidad} ${l.nombre}`);
  assert.ok(lista.includes("10 Silla Tiffany"), lista.join(" | "));
  assert.ok(lista.includes("1 Mesa redonda con 6 sillas") && lista.includes("1 Mesa redonda con 8 sillas"), lista.join(" | "));
});

// ----------------------------------------------------------------------------------------------------------
console.log("2. «pon un centro de mesa en cada mesa»");

prueba("cada mesa lleva un centro ENCIMA de su tapa (y = alto de la mesa) y las sillas no cuentan como algo encima", () => {
  const { despues } = seisMesas();
  const r = ok(aplicarHerramienta(despues, "decorar_mesas", { disenos: [RAMO] }));
  const centros = centrosDe(r.escena);
  assert.equal(centros.length, 6, r.resumen);
  const armada = armarEscena(r.escena);
  for (const mesa of mesasDe(r.escena)) {
    const centro = centros.find((c) => padreDeCentro(c) === mesa.id);
    assert.ok(centro, `la mesa ${mesa.id} no tiene centro`);
    const sup = superficieSuperior(mesa, armada)!;
    const caja = armada.porNodo.find((n) => n.id === centro!.id)!.caja;
    cerca(caja.min.y, sup.altoCm, 1.5, `${mesa.id}: la base del centro está en la tapa`);
    assert.ok(caja.max.y > sup.altoCm + 10, "y sube sobre la tapa");
    cerca((caja.min.x + caja.max.x) / 2, sup.centro.x, 1.5, "centrado en x");
    cerca((caja.min.z + caja.max.z) / 2, sup.centro.z, 1.5, "centrado en z");
    assert.equal(sillasDeMesaNodo(r.escena, mesa).total, 4, "las sillas siguen siendo 4");
  }
  assert.equal(armada.avisos.length, 0, armada.avisos.join(" | "));
  assert.deepEqual(contarMobiliario(r.escena), { mesas: 6, sillas: 24 });
});

prueba("el centro se mueve y gira con su mesa", () => {
  const { despues } = seisMesas();
  const con = ok(aplicarHerramienta(despues, "decorar_mesas", { disenos: [RAMO] })).escena;
  const mesa = mesasDe(con)[2]!;
  const centro = centrosDe(con).find((c) => padreDeCentro(c) === mesa.id)!;
  const antes = armarEscena(con).porNodo.find((n) => n.id === centro.id)!.caja;
  const movida = moverNodo(con, mesa.id, { x: 120, y: 0, z: -80 });
  const despuesCaja = armarEscena(movida).porNodo.find((n) => n.id === centro.id)!.caja;
  // El imán de la mesa redondea a 5 cm: lo que importa es que el centro se movió lo mismo que la mesa.
  const c0 = mesa.colocacion, c1 = nodo(movida, mesa.id).colocacion;
  assert.ok(c0.en === "piso" && c1.en === "piso");
  const [dx, dz] = c0.en === "piso" && c1.en === "piso" ? [c1.xCm - c0.xCm, c1.zCm - c0.zCm] : [0, 0];
  assert.ok(Math.abs(dx) > 100 && Math.abs(dz) > 60, "la mesa sí se movió");
  cerca((despuesCaja.min.x + despuesCaja.max.x) / 2 - (antes.min.x + antes.max.x) / 2, dx, 1.5, "el centro se movió lo mismo que la mesa en x");
  cerca((despuesCaja.min.z + despuesCaja.max.z) / 2 - (antes.min.z + antes.max.z) / 2, dz, 1.5, "y en z");
  cerca(despuesCaja.min.y, antes.min.y, 0.5, "y a la misma altura");
  const girada = armarEscena(paso(con, "girar_pieza", { id: mesa.id, grados: 90 }));
  assert.equal(girada.avisos.length, 0);
  const sup = superficieSuperior(nodo(paso(con, "girar_pieza", { id: mesa.id, grados: 90 }), mesa.id), girada)!;
  const cg = girada.porNodo.find((n) => n.id === centro.id)!.caja;
  cerca((cg.min.x + cg.max.x) / 2, sup.centro.x, 1.5, "girada, el centro sigue en la tapa");
});

prueba("el centro va sobre cualquier tipo de mesa: del salón (opciones.sillas), conjunto fijo y paramétrica larga", () => {
  const m = muebleDe("mesa_redonda_sillas")!;
  let e = paso(vacia(), "agregar_mesas", { cantidad: 1, tipo: "rectangular", ancho_cm: 240, sillas_por_mesa: 10, x_cm: -400, z_cm: 0 });
  e = { ...e, nodos: [...e.nodos, { id: "mesa-salon", nombre: "Mesa 1", pieza: piezaDeMueble(m, opcionesDeMueble(m, { sillas: 6 })), colocacion: { en: "piso", xCm: 300, zCm: 0, giroGrados: 0 } }] };
  const r = ok(aplicarHerramienta(e, "decorar_mesas", { disenos: [RAMO] }));
  assert.equal(centrosDe(r.escena).length, 2, r.resumen);
  const armada = armarEscena(r.escena);
  for (const mesa of mesasDe(r.escena)) {
    const c = centrosDe(r.escena).find((x) => padreDeCentro(x) === mesa.id)!;
    cerca(armada.porNodo.find((n) => n.id === c.id)!.caja.min.y, superficieSuperior(mesa, armada)!.altoCm, 1.5, mesa.id);
  }
});

// ----------------------------------------------------------------------------------------------------------
console.log("3. «haz el salón más grande»");

prueba("la sala crece y las mesas, sus sillas y sus centros se quedan donde estaban", () => {
  const { despues } = seisMesas();
  const con = ok(aplicarHerramienta(despues, "decorar_mesas", { disenos: [RAMO] })).escena;
  const r = ok(aplicarHerramienta(con, "cambiar_sala", { ancho_cm: 2200, fondo_cm: 1900 }));
  assert.equal(r.escena.sala.anchoCm, 2200);
  assert.equal(r.escena.sala.fondoCm, 1900);
  assert.deepEqual(r.escena.nodos.map((n) => [n.id, n.colocacion]), con.nodos.map((n) => [n.id, n.colocacion]), "ninguna pieza se movió ni se perdió");
  assert.deepEqual(contarMobiliario(r.escena), { mesas: 6, sillas: 24 });
  assert.equal(centrosDe(r.escena).length, 6);
  assert.equal(armarEscena(r.escena).avisos.length, 0);
});

prueba("con un salón armado, ajustar_salon agranda la sala y conserva las mesas con sus sillas reales", () => {
  const armado = ok(aplicarHerramienta(vacia(), "armar_salon", { mesas: 6, sillas_por_mesa: 4, mesa: "redonda8", ancho_cm: 1600, fondo_cm: 1400 }));
  const antes = contarMobiliario(armado.escena);
  const r = ok(aplicarHerramienta(armado.escena, "ajustar_salon", { ancho_cm: 2200, fondo_cm: 1900 }));
  assert.equal(r.escena.sala.anchoCm, 2200);
  const despues = contarMobiliario(r.escena);
  assert.equal(despues.mesas, antes.mesas, "las mesas se quedan");
  assert.equal(despues.sillas, antes.sillas, "las sillas se quedan");
  for (const m of r.escena.nodos.filter((n) => esMesa(n) && /^Mesa \d+$/.test(n.nombre))) assert.equal(sillasDeMesaNodo(r.escena, m).total, 4, m.id);
});

// ----------------------------------------------------------------------------------------------------------
console.log("4. Un intento que falla: la respuesta dice «No pude»");

prueba("poner un centro sobre algo que no es una mesa falla y el texto final lo admite aunque el modelo diga «Confirmado»", () => {
  const { despues } = seisMesas();
  const sillas = despues.nodos.find((n) => n.id.startsWith("sillas-"))!;
  const args = { decoracion_id: "flor_grande", padre_id: sillas.id };
  const intento = aplicarHerramienta(despues, "poner_sobre", args);
  assert.equal(intento.ok, false);
  const intentos: Intento[] = [{ herramienta: "poner_sobre", ok: intento.ok, objetivo: objetivoDe(args), ...(intento.ok ? {} : { error: intento.error }) }];
  const final = conHonestidad("Coloqué un centro de mesa sobre cada una de las mesas. Confirmado.", fallosPendientes(intentos), []);
  assert.match(final, /No pude: poner algo sobre una pieza/);
  assert.match(final, /^Coloqué un centro de mesa/);
});

prueba("un nombre que miente sobre las sillas se rechaza, y una decoración metida bajo el mantel de una mesa paramétrica se marca", () => {
  const { despues } = seisMesas();
  const falso = aplicarHerramienta(despues, "cambiar_pieza", { id: mesasDe(despues)[0]!.id, nombre: "Mesa con 8 sillas" });
  assert.equal(falso.ok, false);
  assert.match(falso.ok ? "" : falso.error, /dice 8 sillas, pero la mesa lleva 4/);
  const rechazado = aplicarHerramienta(vacia(), "agregar_mesas", { cantidad: 1, sillas_por_mesa: 8, nombre: "Mesa redonda 1 con 4 sillas" });
  assert.equal(rechazado.ok, false);
  const m = mesasDe(despues)[0]!;
  const c = m.colocacion.en === "piso" ? m.colocacion : null;
  const mal = paso(despues, "agregar_pieza", { tipo: "decoracion", decoracion_id: "flor_grande", donde: { en: "piso", x_cm: c!.xCm, z_cm: c!.zCm } });
  const problemas = problemasNuevos(despues, mal);
  assert.equal(problemas.length, 1, "la flor en el piso, bajo el mantel de la mesa paramétrica, es un PROBLEMA");
  assert.match(verificarCambios(despues, mal), /PROBLEMA/);
});

// ----------------------------------------------------------------------------------------------------------
console.log("5. Las mesas del salón armado no se convierten: se cambian con ajustar_salon");

const salonYMesasSueltas = (): Escena => {
  const salon = ok(aplicarHerramienta(vacia(), "armar_salon", { mesas: 4, sillas_por_mesa: 6, mesa: "redonda8", ancho_cm: 1600, fondo_cm: 1400 })).escena;
  return paso(salon, "agregar_mesas", { cantidad: 2, tipo: "redonda", sillas_por_mesa: 4, x_cm: 0, z_cm: 520 });
};
const delSalon = (e: Escena) => e.nodos.filter((n) => esDelSalon(e, n.id) && esMesa(n));
const foto = (e: Escena, ids: string[]) => JSON.stringify(ids.map((id) => nodo(e, id)));

prueba("con ids de una mesa del salón, cambiar_sillas y cambiar_mesas dan error y mandan a ajustar_salon", () => {
  const e = salonYMesasSueltas();
  const suya = delSalon(e).find((n) => /^Mesa \d+$/.test(n.nombre))!;
  for (const [herramienta, args] of [["cambiar_sillas", { ids: [suya.id], cantidad: 3 }], ["cambiar_mesas", { ids: [suya.id], tipo: "cuadrada" }]] as const) {
    const r = aplicarHerramienta(e, herramienta, args);
    assert.equal(r.ok, false, herramienta);
    assert.match(r.ok ? "" : r.error, /mesa del salón armado.*ajustar_salon \(sillas_por_mesa, mesas/, herramienta);
  }
});

prueba("sin ids solo cambian las mesas que no son del salón, y el resumen dice cuáles se saltó y por qué", () => {
  const e = salonYMesasSueltas();
  const delSalonAntes = delSalon(e).map((n) => n.id);
  assert.ok(delSalonAntes.length >= 4);
  const sueltas = mesasDe(e).filter((n) => !esDelSalon(e, n.id)).map((n) => n.id);
  assert.equal(sueltas.length, 2);
  const r = ok(aplicarHerramienta(e, "cambiar_sillas", { cantidad: 2 }));
  assert.match(r.resumen, /No toqué \d+ mesas del salón armado/);
  assert.match(r.resumen, /ajustar_salon \(sillas_por_mesa, mesas/);
  assert.equal(foto(r.escena, delSalonAntes), foto(e, delSalonAntes), "las mesas del salón quedan idénticas");
  for (const id of sueltas) assert.equal(sillasDeMesaNodo(r.escena, nodo(r.escena, id)).total, 2, id);
  const m = ok(aplicarHerramienta(e, "cambiar_mesas", { mantel: "corto" }));
  assert.match(m.resumen, /No toqué \d+ mesas del salón armado/);
  assert.equal(foto(m.escena, delSalonAntes), foto(e, delSalonAntes));
});

prueba("si todas las mesas son del salón, sin ids también es un error que apunta a ajustar_salon; sin salón nada cambia", () => {
  const soloSalon = ok(aplicarHerramienta(vacia(), "armar_salon", { mesas: 4, sillas_por_mesa: 6, mesa: "redonda8", ancho_cm: 1600, fondo_cm: 1400 })).escena;
  const r = aplicarHerramienta(soloSalon, "cambiar_sillas", { cantidad: 2 });
  assert.equal(r.ok, false);
  assert.match(r.ok ? "" : r.error, /son del salón armado.*ajustar_salon/);
  // El camino bueno: ajustar_salon recalcula las mesas y las sillas.
  const bien = ok(aplicarHerramienta(soloSalon, "ajustar_salon", { sillas_por_mesa: 4 })).escena;
  for (const m of delSalon(bien).filter((n) => /^Mesa \d+$/.test(n.nombre))) assert.equal(sillasDeMesaNodo(bien, m).total, 4);
  // Sin salón, el conjunto fijo de siempre sigue pasando a editable.
  const fija = { ...vacia(), nodos: [{ id: "f", nombre: "Mesa fija", pieza: piezaDeMueble(muebleDe("mesa_redonda_sillas")!), colocacion: { en: "piso" as const, xCm: 0, zCm: 0, giroGrados: 0 } }] };
  assert.equal(contarMobiliario(ok(aplicarHerramienta(fija, "cambiar_sillas", { cantidad: 3 })).escena).sillas, 3);
  assert.equal(pasarAConjunto(soloSalon, delSalon(soloSalon)[0]!.id), null, "la función que convierte también se niega");
});

console.log(`test-mobiliario-honestidad-integrado: ${pruebas} pruebas ok`);
