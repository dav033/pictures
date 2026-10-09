/**
 * Sillas por mesa (REQ-008, pedido del dueño: «mesas de 4 personas»): `sillas_por_mesa` en armar_salon, ajustar_salon y planificar_evento.
 * Sin coste: ninguna IA ni red.
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-sillas-por-mesa.ts
 * - el número de sillas es el real de la pieza (se cuentan sus elementos), repartidas parejo por la circunferencia y sin tocarse;
 * - la mesa crece con las sillas y los invitados ÷ sillas dan el número de mesas (40 ÷ 4 = 10; 41 → 11);
 * - redonda 2–12, imperial par de 4 a 20: lo demás se rechaza claro; las sillas de siempre no se guardan;
 * - ajustar_salon cambia las sillas de las mesas del salón sin tocar lo del usuario, con sus centros de mesa apoyados en la tapa nueva;
 * - el resumen dice cuántas sillas lleva cada mesa.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { armarEscena, escenaEnIngles, SALA_INICIAL, type Escena } from "../../src/lib/globos3d/escena";
import { centrosDe, mesasDeEscena, padreDeCentro } from "../../src/lib/globos3d/centros-mesa";
import { EscenaSchema } from "../../src/lib/globos3d/esquema-escena";
import { aplicarHerramienta, DECLARACIONES_ESCENA } from "../../src/lib/globos3d/herramientas-escena";
import { puestosAlrededor } from "../../src/lib/globos3d/mobiliario-disposicion";
import { muebleDe } from "../../src/lib/globos3d/mobiliario-catalogo";
import { elementosDeEscenografia, nombreDeMueble, sillasDeMueble } from "../../src/lib/globos3d/mobiliario-pieza";
import { medidasDeMesa } from "../../src/lib/globos3d/salon-evento";
import { mesasVivas } from "../../src/lib/globos3d/salon-registro";
import { zonasDeEscena } from "../../src/lib/globos3d/salon-zonas";

let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };
const vacia = (): Escena => ({ sala: { ...SALA_INICIAL }, nodos: [] });
const herramienta = (escena: Escena, nombre: string, args: Record<string, unknown>) => {
  const r = aplicarHerramienta(escena, nombre, args);
  if (!r.ok) assert.fail(`${nombre} ${JSON.stringify(args)}: ${r.error}`);
  return r;
};
const falla = (escena: Escena, nombre: string, args: Record<string, unknown>) => {
  const r = aplicarHerramienta(escena, nombre, args);
  assert.ok(!r.ok, `${nombre} ${JSON.stringify(args)} debía fallar`);
  return r.ok ? "" : r.error;
};
const ingles = (e: Escena) => escenaEnIngles(e, armarEscena(e));
const mesas = (e: Escena) => mesasVivas(e).map((v) => v.nodo);
const opcionesDe = (n: { pieza: Escena["nodos"][number]["pieza"] }) => (n.pieza.tipo === "escenografia" ? n.pieza.mueble?.opciones : undefined);
/** Los elementos de una mesa del catálogo con N sillas, armada como la arma el salón (con el ancho que le toca). */
function elementosDeMesa(tipo: "redonda8" | "imperial", sillas: number): number {
  const m = medidasDeMesa(tipo, sillas);
  assert.ok(m.puestos > 0);
  const nodo = herramienta(vacia(), "armar_salon", { invitados: sillas, mesa: tipo, sillas_por_mesa: sillas, zonas: ["fondo_fotos"] }).escena.nodos.find((n) => n.id === "salon-mesa-01")!;
  return nodo.pieza.tipo === "escenografia" ? elementosDeEscenografia(nodo.pieza).length : -1;
}
/** Cuántas sillas lleva de verdad una mesa: lo que suma cada silla a los elementos de la mesa (se mide con la propia pieza). */
function sillasReales(tipo: "redonda8" | "imperial", sillas: number): number {
  const paso = tipo === "imperial" ? 2 : 1;
  const base = tipo === "imperial" ? 4 : 2;
  const porSilla = (elementosDeMesa(tipo, base + 2 * paso) - elementosDeMesa(tipo, base)) / (2 * paso);
  return base + (elementosDeMesa(tipo, sillas) - elementosDeMesa(tipo, base)) / porSilla;
}

prueba("sin pedir sillas todo queda como siempre: las sillas de siempre no se guardan", () => {
  const e = herramienta(vacia(), "armar_salon", { invitados: 40 }).escena;
  assert.equal(e.salon?.sillas, undefined);
  assert.equal(opcionesDe(mesas(e)[0]!)?.sillas, undefined);
  const ocho = herramienta(vacia(), "armar_salon", { invitados: 40, sillas_por_mesa: 8 }).escena;
  assert.equal(ocho.salon?.sillas, undefined, "8 es lo de siempre de la redonda8");
  assert.deepEqual(ocho.nodos.map((n) => n.pieza), e.nodos.map((n) => n.pieza));
});

prueba("mesas de 4 personas: 40 invitados son 10 mesas de 4 sillas, y 41 son 11; el resumen dice las sillas", () => {
  const r = herramienta(vacia(), "armar_salon", { invitados: 40, sillas_por_mesa: 4 });
  assert.equal(mesas(r.escena).length, 10);
  assert.match(r.resumen, /10 mesas de 4/);
  assert.equal(r.escena.salon?.sillas, 4);
  for (const n of mesas(r.escena)) assert.equal(opcionesDe(n)?.sillas, 4);
  assert.equal(mesas(herramienta(vacia(), "armar_salon", { invitados: 41, sillas_por_mesa: 4 }).escena).length, 11);
  assert.equal(mesas(herramienta(vacia(), "armar_salon", { invitados: 100, sillas_por_mesa: 6 }).escena).length, 17);
  assert.ok(EscenaSchema.safeParse(r.escena).success, "la escena con sillas pasa el esquema de la ruta");
});

prueba("la pieza lleva de verdad las sillas pedidas (redonda 2 a 12, imperial 4 a 20) y la mesa crece con ellas", () => {
  for (const n of [2, 4, 5, 7, 12]) assert.equal(sillasReales("redonda8", n), n, `redonda ${n}`);
  for (const n of [4, 6, 12, 20]) assert.equal(sillasReales("imperial", n), n, `imperial ${n}`);
  const diametros = [2, 4, 8, 10, 12].map((n) => medidasDeMesa("redonda8", n).anchoCm);
  assert.deepEqual(diametros, [...diametros].sort((a, b) => a - b));
  assert.equal(medidasDeMesa("redonda8", 8).anchoCm, 270);
  assert.equal(medidasDeMesa("redonda10", 10).anchoCm, 300);
  assert.equal(medidasDeMesa("imperial", 10).anchoCm, 360);
  assert.ok(medidasDeMesa("imperial", 20).anchoCm > medidasDeMesa("imperial", 6).anchoCm);
});

prueba("las sillas se reparten parejo por la circunferencia de la mesa y no se tocan", () => {
  for (const n of [2, 3, 4, 5, 7, 12]) {
    const m = medidasDeMesa("redonda8", n);
    const d = m.anchoCm - 120;
    const puestos = puestosAlrededor({ cx: 0, cz: 0, anchoCm: d + 14, fondoCm: d + 14, cantidad: n, holguraCm: 45 / 2 + 8, frenteCm: 45 });
    assert.equal(puestos.length, n, `caben las ${n}`);
    const angulos = puestos.map((p) => Math.atan2(p.x, p.z)).sort((a, b) => a - b);
    const huecos = angulos.map((a, i) => (i === n - 1 ? angulos[0]! + 2 * Math.PI - a : angulos[i + 1]! - a));
    for (const h of huecos) assert.ok(Math.abs(h - (2 * Math.PI) / n) < 0.02, `${n} sillas: hueco ${h.toFixed(3)} rad`);
    const radio = Math.hypot(puestos[0]!.x, puestos[0]!.z);
    assert.ok(radio > d / 2, "las sillas quedan fuera del mantel");
    if (n > 1) assert.ok(2 * radio * Math.sin(Math.PI / n) >= 45, `${n} sillas: se tocan`);
  }
});

prueba("lo que no vale se rechaza claro: redonda de 2 a 12, imperial par de 4 a 20", () => {
  assert.match(falla(vacia(), "armar_salon", { invitados: 40, sillas_por_mesa: 13 }), /de 2 a 12/);
  assert.match(falla(vacia(), "armar_salon", { invitados: 40, sillas_por_mesa: 1 }), /de 2 a 12/);
  assert.match(falla(vacia(), "armar_salon", { invitados: 40, mesa: "imperial", sillas_por_mesa: 7 }), /número par/);
  assert.match(falla(vacia(), "armar_salon", { invitados: 40, mesa: "imperial", sillas_por_mesa: 2 }), /4 a 20/);
  assert.match(falla(vacia(), "armar_salon", { invitados: 40, mesa: "imperial", sillas_por_mesa: 22 }), /Parámetros no válidos|4 a 20/);
  const sala = herramienta(vacia(), "armar_salon", { invitados: 40 }).escena;
  assert.match(falla(sala, "ajustar_salon", { sillas_por_mesa: 13 }), /de 2 a 12/);
});

prueba("planificar_evento también acepta sillas_por_mesa", () => {
  const e = herramienta(vacia(), "planificar_evento", { tipo_evento: "boda", invitados: 60, sillas_por_mesa: 6 }).escena;
  assert.equal(zonasDeEscena(e).mesas.length, 10);
  assert.equal(e.salon?.sillas, 6);
});

prueba("ajustar_salon cambia las sillas de las mesas del salón: se recalculan las mesas, lo del usuario no se toca y los centros siguen en su mesa", () => {
  let antes = herramienta(vacia(), "agregar_pieza", { tipo: "columna_organica", colores: ["rosado"], donde: { en: "piso", x_cm: -250, z_cm: -100 } }).escena;
  antes = herramienta(antes, "planificar_evento", { tipo_evento: "boda", invitados: 80, colores: ["blanco", "dorado"] }).escena;
  const suyas = antes.nodos.filter((n) => !antes.salon?.piezas[n.id]);
  assert.equal(zonasDeEscena(antes).mesas.length, 10);
  const r = herramienta(antes, "ajustar_salon", { sillas_por_mesa: 4 });
  const e = r.escena, z = zonasDeEscena(e);
  assert.equal(z.mesas.length, 20, "80 ÷ 4");
  assert.match(r.resumen, /20 mesas de 4/);
  assert.equal(e.salon?.sillas, 4);
  for (const n of mesas(e)) assert.equal(opcionesDe(n)?.sillas, 4);
  for (const n of suyas) assert.deepEqual(e.nodos.find((x) => x.id === n.id), n, `${n.id} del usuario cambió`);
  assert.deepEqual(z.mesas.slice(0, 10), zonasDeEscena(antes).mesas, "las mesas de antes siguen siendo las mismas piezas");
  assert.deepEqual([...new Set(centrosDe(e).map((c) => padreDeCentro(c)))].sort(), [...z.mesas, z.mesaPrincipal!.id].sort(), "cada mesa, un centro, también las 10 nuevas");
  const armada = armarEscena(e), tapas = mesasDeEscena(e, armada);
  for (const c of centrosDe(e)) {
    const caja = armada.porNodo.find((n) => n.id === c.id)!.caja, m = tapas.find((x) => x.nodo.id === padreDeCentro(c))!;
    assert.ok(Math.abs(caja.min.y - m.cubierta.centro.y) <= 3 && Math.hypot((caja.min.x + caja.max.x) / 2 - m.cubierta.centro.x, (caja.min.z + caja.max.z) / 2 - m.cubierta.centro.z) <= 4, `${c.id} fuera de la tapa de ${m.nodo.id}`);
  }
  // Volver a las de siempre no deja rastro; con otro número vuelve a recalcular.
  const ocho = herramienta(e, "ajustar_salon", { sillas_por_mesa: 8 }).escena;
  assert.equal(ocho.salon?.sillas, undefined);
  assert.equal(zonasDeEscena(ocho).mesas.length, 10);
  assert.ok(mesas(ocho).every((n) => opcionesDe(n)?.sillas === undefined));
  assert.equal(zonasDeEscena(herramienta(e, "ajustar_salon", { invitados: 120 }).escena).mesas.length, 30, "las sillas se conservan al cambiar invitados: 120 ÷ 4");
});

prueba("al pasar a imperial con un número de sillas que no le vale, vuelve a las de siempre y lo dice", () => {
  const redonda = herramienta(vacia(), "armar_salon", { invitados: 35, sillas_por_mesa: 5 }).escena;
  const r = herramienta(redonda, "ajustar_salon", { mesa: "imperial" });
  assert.equal(r.escena.salon?.sillas, undefined);
  assert.match(r.resumen, /5 sillas por mesa no valen para mesas imperial/);
  assert.equal(zonasDeEscena(r.escena).mesas.length, 4, "35 ÷ 10");
});

prueba("la declaración de armar_salon y ajustar_salon trae sillas_por_mesa y el prompt lo explica", () => {
  for (const nombre of ["armar_salon", "ajustar_salon", "planificar_evento"]) {
    const d = DECLARACIONES_ESCENA.find((x) => x.name === nombre)!;
    assert.match(JSON.stringify(d.parametersJsonSchema), /sillas_por_mesa/, nombre);
  }
  assert.match(readFileSync(new URL("../../src/app/api/escena-ia/route.ts", import.meta.url), "utf8"), /«mesas de N personas» a secas = sillas_por_mesa N/);
});

prueba("A2: ver_escena, el editor y la descripción para la imagen dicen las sillas REALES de la mesa, no las del catálogo", () => {
  const r4 = herramienta(vacia(), "armar_salon", { invitados: 16, sillas_por_mesa: 4, zonas: ["fondo_fotos"] });
  const vista = herramienta(r4.escena, "ver_escena", {}).resumen;
  assert.match(vista, /Mesa redonda con 4 sillas/);
  assert.doesNotMatch(vista, /Mesa redonda con 8 sillas/);
  const imperial = herramienta(vacia(), "armar_salon", { invitados: 12, mesa: "imperial", sillas_por_mesa: 6, zonas: ["fondo_fotos"] });
  assert.match(herramienta(imperial.escena, "ver_escena", {}).resumen, /Mesa imperial con 6 sillas/);
  const normal = herramienta(vacia(), "armar_salon", { invitados: 16, zonas: ["fondo_fotos"] });
  assert.match(herramienta(normal.escena, "ver_escena", {}).resumen, /Mesa redonda con 8 sillas/, "sin pedir sillas dice las de siempre");
  assert.match(ingles(r4.escena), /four Tiffany chairs/);
  assert.doesNotMatch(ingles(r4.escena), /eight Tiffany chairs/);
  assert.match(ingles(imperial.escena), /six Tiffany chairs/);
  const m = muebleDe("mesa_redonda_sillas")!;
  assert.equal(nombreDeMueble(m, { sillas: 3 }), "Mesa redonda con 3 sillas");
  assert.equal(nombreDeMueble(m), m.nombre);
  assert.equal(sillasDeMueble(m, {}), 8);
  assert.equal(sillasDeMueble(muebleDe("silla_tiffany")!), null);
});

prueba("A3: «6 mesas de 4» tiene camino: mesas = M manda sobre invitados y el aforo es mesas × sillas", () => {
  const armar = herramienta(vacia(), "armar_salon", { mesas: 6, sillas_por_mesa: 4, invitados: 100 });
  assert.equal(mesas(armar.escena).length, 6);
  assert.equal(armar.escena.salon?.invitados, 24);
  assert.match(armar.resumen, /6 mesas de 4 dan un aforo de 24 invitados \(no usé invitados = 100/);
  assert.match(armar.resumen, /6 mesas de 4/);
  // «6 mesas redondas con 4 sillas cada una» + «un centro en cada mesa», de una llamada (sin mesa principal: es un rincón).
  const evento = herramienta(vacia(), "planificar_evento", { tipo_evento: "cumpleanos", alcance: "rincon", mesas: 6, sillas_por_mesa: 4, colores: ["rosa", "blanco"] }).escena;
  assert.equal(zonasDeEscena(evento).mesas.length, 6);
  assert.equal(evento.salon?.invitados, 24);
  assert.deepEqual(new Set(centrosDe(evento).map((c) => padreDeCentro(c))), new Set(zonasDeEscena(evento).mesas), "un centro en cada mesa");
  // «cada mesa con 4 sillas» sobre un salón de 6 mesas de 8, sin tocar cuántas mesas: se mantienen las 6.
  const de8 = herramienta(vacia(), "planificar_evento", { tipo_evento: "cumpleanos", alcance: "rincon", mesas: 6 }).escena;
  assert.equal(zonasDeEscena(de8).mesas.length, 6);
  assert.equal(de8.salon?.invitados, 48);
  const sinMesas = herramienta(de8, "ajustar_salon", { sillas_por_mesa: 4 });
  assert.equal(zonasDeEscena(sinMesas.escena).mesas.length, 12, "sin decir cuántas mesas, los 48 invitados necesitan 12 de 4");
  const exacto = herramienta(de8, "ajustar_salon", { sillas_por_mesa: 4, mesas: 6 });
  assert.equal(zonasDeEscena(exacto.escena).mesas.length, 6);
  assert.equal(exacto.escena.salon?.invitados, 24);
  assert.match(exacto.resumen, /6 mesas de 4 dan un aforo de 24 invitados/);
  assert.equal(zonasDeEscena(herramienta(exacto.escena, "ajustar_salon", { mesas: 8 }).escena).mesas.length, 8, "y se puede cambiar solo cuántas mesas");
  assert.match(falla(vacia(), "armar_salon", { mesas: 0 }), /mesas = 0 está fuera de rango/);
  assert.match(falla(vacia(), "armar_salon", { mesas: 151 }), /de 1 a 150/);
  for (const nombre of ["armar_salon", "ajustar_salon", "planificar_evento"]) assert.match(JSON.stringify(DECLARACIONES_ESCENA.find((x) => x.name === nombre)!.parametersJsonSchema), /"mesas"/, nombre);
  assert.match(readFileSync(new URL("../../src/app/api/escena-ia/route.ts", import.meta.url), "utf8"), /«M mesas de N» = mesas M \+ sillas_por_mesa N/);
});

prueba("A7: el error de capacidad no recomienda «mesas de 10» cuando ya piden 12: sugiere algo que existe", () => {
  const con12 = falla(vacia(), "armar_salon", { invitados: 300, sillas_por_mesa: 12, ancho_cm: 800, fondo_cm: 800 });
  assert.doesNotMatch(con12, /usa mesas de 10/);
  assert.match(con12, /ya llevan las sillas máximas \(12\)/);
  const con8 = falla(vacia(), "armar_salon", { invitados: 300, ancho_cm: 800, fondo_cm: 800 });
  assert.match(con8, /sillas_por_mesa hasta 12/);
});

console.log(`\n${pruebas} pruebas pasaron`);
