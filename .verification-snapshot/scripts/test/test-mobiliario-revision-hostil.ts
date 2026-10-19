/**
 * Lo que dejó la revisión hostil de la integración (mobiliario libre + salón + honestidad), con las herramientas directas y sin red:
 *
 *  1. un grupo de sillas sobre una mesa del salón se cuenta tal cual (lo dibujado) y `ajustar_salon` lo quita: exactamente N sillas por mesa;
 *  2. una columna en el hueco de una U o en la esquina vacía de una mesa a 45° no está «dentro de la mesa»;
 *  3. los avisos de una herramienta que funcionó viajan como dato y llegan a la respuesta;
 *  4. el objetivo de un intento incluye los ids; el salón apunta a su zona;
 *  5. mesa_redonda10_sillas se convierte a mesa editable;
 *  6. al cambiar la mesa, el centro se vuelve a poner en su tapa o se quita con aviso;
 *  7. el inventario en inglés dice cómo están las sillas.
 *
 *   npx tsx scripts/test/test-mobiliario-revision-hostil.ts
 */
import assert from "node:assert/strict";
import { armarEscena, escenaEnIngles, SALA_INICIAL, type Escena, type NodoEscena } from "../../src/lib/globos3d/escena";
import { aplicarHerramienta, type ResultadoHerramienta } from "../../src/lib/globos3d/herramientas-escena";
import { centrosDe } from "../../src/lib/globos3d/centros-mesa";
import { conHonestidad, fallosPendientes, objetivoDe } from "../../src/lib/globos3d/honestidad-respuesta";
import { contarMobiliario, esMesa, sillasDeMesaNodo } from "../../src/lib/globos3d/mobiliario-asientos-mesa";
import { muebleDe } from "../../src/lib/globos3d/mobiliario-catalogo";
import { armarConjuntoMesa, colocacionDeSillas, esGrupoDeSillas } from "../../src/lib/globos3d/mobiliario-conjunto";
import { piezaDeMueble } from "../../src/lib/globos3d/mobiliario-pieza";
import { puntoEnSuperficie, superficieSuperior } from "../../src/lib/globos3d/mobiliario-superficie";
import { problemasDeEscena } from "../../src/lib/globos3d/problemas-escena";
import { resumenDeSalon } from "../../src/lib/globos3d/salon-resumen";

let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };
const ok = (r: ResultadoHerramienta): Extract<ResultadoHerramienta, { ok: true }> => { if (!r.ok) assert.fail(`se esperaba éxito y vino error: ${r.error}`); return r; };
const paso = (e: Escena, herramienta: string, args: Record<string, unknown>): Escena => ok(aplicarHerramienta(e, herramienta, args)).escena;
const nodo = (e: Escena, id: string): NodoEscena => e.nodos.find((n) => n.id === id) ?? assert.fail(`falta ${id}`);
const cerca = (real: number, esperado: number, tol: number, que: string) => assert.ok(Math.abs(real - esperado) <= tol, `${que}: ${real.toFixed(1)} (esperado ${esperado} ±${tol})`);

const vacia = (): Escena => ({ sala: { ...SALA_INICIAL, anchoCm: 1600, fondoCm: 1400 }, nodos: [] });
const RAMO = { tipo: "ramo_helio", colores: ["blanco", "dorado"] };
const mesasDe = (e: Escena) => e.nodos.filter(esMesa);
const flor = (e: Escena, x: number, z: number) => paso(e, "agregar_pieza", { tipo: "decoracion", decoracion_id: "flor_grande", donde: { en: "piso", x_cm: x, z_cm: z } });

console.log("1. Sillas del salón: se cuentan una vez");

prueba("salón con 8: cambiar_sillas 6 se rechaza; una escena vieja con un grupo encima se cuenta tal cual y ajustar_salon deja exactamente 6 por mesa", () => {
  const salon = ok(aplicarHerramienta(vacia(), "armar_salon", { mesas: 4, mesa: "redonda8", ancho_cm: 1600, fondo_cm: 1400 })).escena;
  const delSalon = salon.nodos.filter((n) => /^Mesa \d+$/.test(n.nombre));
  assert.ok(delSalon.length >= 4);
  for (const m of delSalon) assert.equal(sillasDeMesaNodo(salon, m).total, 8);
  assert.equal(aplicarHerramienta(salon, "cambiar_sillas", { ids: [delSalon[0]!.id], cantidad: 6 }).ok, false);
  // Una escena guardada antes de la guarda: un grupo de 6 sillas encima de una mesa del salón (se dibujarían las 8 y las 6).
  const grupo = armarConjuntoMesa({ ids: { mesa: "x", sillas: "sillas-vieja" }, mesa: { tipo: "redonda" }, sillas: { cantidad: 6 }, colocacion: { en: "piso", xCm: 0, zCm: 0, giroGrados: 0 } }).sillas!;
  const vieja: Escena = { ...salon, nodos: [...salon.nodos, { ...grupo, colocacion: colocacionDeSillas(delSalon[0]!.id) }] };
  assert.equal(sillasDeMesaNodo(vieja, delSalon[0]!).total, 14, "cuenta lo dibujado: 8 + 6");
  assert.equal(contarMobiliario(vieja).sillas, contarMobiliario(salon).sillas + 6, "contarMobiliario y sillasDeMesaNodo coinciden");
  assert.match(resumenDeSalon(vieja), /con \d+ sillas en total \(de 8 a 14 por mesa\)/, "el resumen sale de la escena, no de lo pedido");
  const r = ok(aplicarHerramienta(vieja, "ajustar_salon", { sillas_por_mesa: 6 }));
  assert.match(r.resumen, /Quité 1 grupo\(s\) de sillas/);
  assert.ok(!r.escena.nodos.some((n) => esGrupoDeSillas(n.pieza)), "ya no queda ningún grupo sobre las mesas del salón");
  const ahora = r.escena.nodos.filter((n) => /^Mesa \d+$/.test(n.nombre));
  assert.ok(ahora.length >= delSalon.length, "con menos sillas por mesa el aforo pide las mismas mesas o más");
  for (const m of ahora) assert.equal(sillasDeMesaNodo(r.escena, m).total, 6, m.id);
  assert.match(resumenDeSalon(r.escena), new RegExp(`${ahora.length} mesas de 6`));
  assert.ok((r.avisos ?? []).some((a) => /Quité 1 grupo/.test(a.texto)));
});

console.log("2. «Dentro de la mesa» se mide contra la tapa de verdad");

prueba("una flor en el hueco de una U, o en la esquina vacía de una mesa a 45°, no es un problema; sobre la tapa sí", () => {
  const u = paso(vacia(), "agregar_mesas", { tipo: "u", ancho_cm: 500, fondo_cm: 400, x_cm: 0, z_cm: 0 });
  const supU = superficieSuperior(mesasDe(u)[0]!, armarEscena(u))!;
  const xs = supU.contorno.map((p) => p.x), zs = supU.contorno.map((p) => p.y);
  const hueco = { x: (Math.min(...xs) + Math.max(...xs)) / 2, z: (Math.min(...zs) + Math.max(...zs)) / 2 };
  assert.equal(puntoEnSuperficie(supU, hueco.x, hueco.z), false, "el centro de la caja de una U está en su hueco");
  assert.deepEqual(problemasDeEscena(flor(u, hueco.x, hueco.z)), [], "en el hueco de la U no hay problema");
  assert.equal(problemasDeEscena(flor(u, supU.centro.x, supU.centro.z)).length, 1, "sobre la tapa de la U sí");

  const larga = paso(vacia(), "agregar_mesas", { tipo: "rectangular", ancho_cm: 320, fondo_cm: 90, giro_grados: 45, x_cm: 0, z_cm: 0 });
  const supL = superficieSuperior(mesasDe(larga)[0]!, armarEscena(larga))!;
  const lx = supL.contorno.map((p) => p.x), lz = supL.contorno.map((p) => p.y);
  const esquina = { x: Math.max(...lx) - 18, z: Math.min(...lz) + 18 };
  assert.equal(puntoEnSuperficie(supL, esquina.x, esquina.z), false);
  assert.deepEqual(problemasDeEscena(flor(larga, esquina.x, esquina.z)), [], "en la esquina vacía de la mesa girada no hay problema");
  assert.equal(problemasDeEscena(flor(larga, supL.centro.x, supL.centro.z)).length, 1);
  // Y una pieza en esa esquina tampoco hace que el centro de la mesa se salte por «lleva algo encima».
  const conFlor = flor(larga, esquina.x, esquina.z);
  assert.equal(centrosDe(ok(aplicarHerramienta(conFlor, "decorar_mesas", { disenos: [RAMO] })).escena).length, 1);
});

console.log("3. Avisos de lo que funcionó");

prueba("mesas que no caben, mesas del salón saltadas y centro quitado llegan a la respuesta como «Aviso»", () => {
  const llena = paso(vacia(), "agregar_mesas", { cantidad: 60, sillas_por_mesa: 4 });
  const demasiadas = ok(aplicarHerramienta(llena, "agregar_mesas", { cantidad: 30, sillas_por_mesa: 4 }));
  assert.ok((demasiadas.avisos ?? []).some((a) => /Pediste 30 mesas pero solo caben 15/.test(a.texto)), "la herramienta devuelve el aviso como dato");
  assert.match(conHonestidad("Listo, puse las 30 mesas.", [], [], demasiadas.avisos), /\n\nAviso: .*Pediste 30 mesas pero solo caben 15/);
  assert.equal(conHonestidad("Solo caben 15 mesas, puse esas.", [], [], demasiadas.avisos), "Solo caben 15 mesas, puse esas.");

  const salon = ok(aplicarHerramienta(vacia(), "armar_salon", { mesas: 4, sillas_por_mesa: 6, mesa: "redonda8", ancho_cm: 1600, fondo_cm: 1400 })).escena;
  const mixta = paso(salon, "agregar_mesas", { cantidad: 2, tipo: "redonda", sillas_por_mesa: 4, x_cm: 0, z_cm: 520 });
  const saltadas = ok(aplicarHerramienta(mixta, "cambiar_sillas", { cantidad: 2 }));
  assert.ok((saltadas.avisos ?? []).some((a) => /No toqué \d+ mesas del salón armado/.test(a.texto)));
  assert.match(conHonestidad("Cambié las sillas.", [], [], saltadas.avisos), /Aviso: No toqué/);

  const con = paso(paso(vacia(), "agregar_mesas", { cantidad: 1, tipo: "redonda", ancho_cm: 150 }), "decorar_mesas", { disenos: [RAMO] });
  assert.equal(centrosDe(con).length, 1);
  const chica = ok(aplicarHerramienta(con, "cambiar_mesas", { ancho_cm: 45 }));
  assert.equal(centrosDe(chica.escena).length, 0, "el centro que no cabe se quita");
  assert.ok((chica.avisos ?? []).some((a) => /ya no cabe.*lo quité/.test(a.texto)));
  assert.match(conHonestidad("Achiqué la mesa.", [], [], chica.avisos), /Aviso: El centro .* ya no cabe/);
});

console.log("4. Objetivo de un intento");

prueba("incluye los ids (un éxito en otras mesas no cancela el fallo) y el salón apunta a su zona", () => {
  assert.equal(objetivoDe({ ids: ["b", "a"] }), "a,b");
  assert.equal(objetivoDe({ ids: [] }), undefined);
  assert.equal(objetivoDe({}, "armar_salon"), "salon");
  assert.equal(objetivoDe({ zona: "pista" }, "mover_zona"), "salon:pista");
  const fallos = fallosPendientes([
    { herramienta: "cambiar_sillas", ok: false, error: "x no es una mesa.", objetivo: objetivoDe({ ids: ["a"] }) },
    { herramienta: "cambiar_sillas", ok: true, objetivo: objetivoDe({ ids: ["b"] }) },
  ]);
  assert.equal(fallos.length, 1, "el éxito sobre b no cancela el fallo sobre a");
  assert.equal(fallosPendientes([
    { herramienta: "mover_zona", ok: false, error: "no cabe.", objetivo: objetivoDe({ zona: "pista" }, "mover_zona") },
    { herramienta: "mover_zona", ok: true, objetivo: objetivoDe({ zona: "mesa_postres" }, "mover_zona") },
  ]).length, 1);
});

console.log("5. mesa_redonda10_sillas");

prueba("también pasa a mesa editable y conserva sus 10 sillas", () => {
  const m = muebleDe("mesa_redonda10_sillas")!;
  const e: Escena = { ...vacia(), nodos: [{ id: "r10", nombre: "Mesa de 10", pieza: piezaDeMueble(m), colocacion: { en: "piso", xCm: 0, zCm: 0, giroGrados: 0 } }] };
  assert.equal(contarMobiliario(e).sillas, 10);
  const r = ok(aplicarHerramienta(e, "cambiar_mesas", { mantel: "corto" }));
  assert.match(r.resumen, /era un conjunto fijo/);
  assert.equal(sillasDeMesaNodo(r.escena, nodo(r.escena, "r10")).total, 10);
  assert.equal(contarMobiliario(r.escena).sillas, 10);
});

console.log("6. El centro sigue a la mesa que cambia");

prueba("si cabe se vuelve a poner centrado y a la altura nueva", () => {
  const con = paso(paso(vacia(), "agregar_mesas", { cantidad: 1, tipo: "redonda", ancho_cm: 150 }), "decorar_mesas", { disenos: [RAMO] });
  const alta = paso(con, "cambiar_mesas", { ancho_cm: 220, alto_cm: 90 });
  const armada = armarEscena(alta);
  const sup = superficieSuperior(mesasDe(alta)[0]!, armada)!;
  const caja = armada.porNodo.find((n) => n.id === centrosDe(alta)[0]!.id)!.caja;
  cerca(caja.min.y, 90, 1.5, "el centro sube con la tapa");
  cerca((caja.min.x + caja.max.x) / 2, sup.centro.x, 1.5, "y sigue centrado en x");
  cerca((caja.min.z + caja.max.z) / 2, sup.centro.z, 1.5, "y en z");
});

console.log("7. Inventario en inglés");

prueba("dice cómo están las sillas: alrededor, un lado, dos lados, cabeceras, frente", () => {
  const casos: Array<[string, number, RegExp]> = [
    ["alrededor", 6, /6 chairs evenly spaced around it/], ["un_lado", 6, /[0-9] chairs all lined up along ONE side/], ["dos_lados", 6, /two rows, one along each long side/],
    ["cabeceras", 2, /2 chairs only at the two short ends/], ["frente", 6, /only along the side that faces the stage/],
  ];
  for (const [disposicion, sillas, patron] of casos) {
    const e = paso(vacia(), "agregar_mesas", { tipo: "rectangular", ancho_cm: 300, fondo_cm: 90, sillas_por_mesa: sillas, disposicion });
    assert.match(escenaEnIngles(e, armarEscena(e)), patron, disposicion);
  }
});

console.log(`test-mobiliario-revision-hostil: ${pruebas} pruebas ok`);
