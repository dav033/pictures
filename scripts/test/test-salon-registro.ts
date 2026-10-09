/**
 * Salón de eventos (REQ-008), segunda ronda: el registro del salón en la escena, lo que el usuario toca a mano, lo que el salón no
 * debe tocar y la capacidad real de las salas. Sin coste: ninguna IA ni red.
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-salon-registro.ts
 * - las piezas del techo y del aire no se esquivan ni se mueven; solo cuenta lo que está en el piso;
 * - la decoración del usuario que el salón conservó sigue al fondo de fotos cuando la sala crece (no acaba sobre la mesa principal);
 * - una mesa quitada a mano no se vuelve a poner, una movida a mano se queda, una copia hecha con duplicar_pieza es del usuario,
 *   una zona movida no vuelve a su sitio al agrandar la sala, y volver a agregar una zona no deja ids ni sillas repetidas;
 * - la escena con ids repetidos no pasa la validación del servidor; el registro sí, y sobrevive al viaje de ida y vuelta;
 * - las salas: pista con mesas a los lados, metros cuadrados por invitado, capacidad de una sala dada, tope de invitados que cabe;
 * - arcos de la entrada y del fondo de fotos a 4 m o más (o la entrada no se arma); los invitados pedidos se guardan.
 */
import assert from "node:assert/strict";
import { armarEscena, SALA_INICIAL, type Escena } from "../../src/lib/globos3d/escena";
import { EscenaSchema } from "../../src/lib/globos3d/esquema-escena";
import { aplicarHerramienta } from "../../src/lib/globos3d/herramientas-escena";
import { distribuirSalon, MAX_INVITADOS_SALON, MESAS_SALON, TIPOS_MESA_SALON } from "../../src/lib/globos3d/salon-evento";
import { esDelSalon, mesasVivas, vivas } from "../../src/lib/globos3d/salon-registro";
import { seCruzan, ZONAS_SALON, zonasDeEscena, type RectCm } from "../../src/lib/globos3d/salon-zonas";

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
  assert.ok(!r.ok, `${nombre} debía fallar`);
  return r.ok ? "" : r.error;
};
const cajas = (escena: Escena): Map<string, RectCm> => new Map(armarEscena(escena).porNodo.filter((n) => n.copias > 0).map((n) => [n.id, { x0: n.caja.min.x, x1: n.caja.max.x, z0: n.caja.min.z, z1: n.caja.max.z }]));
const posiciones = (e: Escena, ids: readonly string[]) => ids.map((id) => JSON.stringify(e.nodos.find((n) => n.id === id)?.colocacion));
const idsMesas = (e: Escena) => mesasVivas(e).map((v) => v.nodo.id);
const TODAS = [...ZONAS_SALON];

/** Nada de un grupo (mesa, zona o decoración adoptada del fondo) se encima con otro grupo. */
function sinEncimar(e: Escena) {
  const c = cajas(e);
  const grupo = (id: string) => { const i = e.salon?.piezas[id]; return !i ? `usuario:${id}` : i.zona === "mesas" ? id : i.zona; };
  const ids = [...c.keys()].filter((id) => e.salon?.piezas[id]);
  ids.forEach((a, i) => { for (const b of ids.slice(i + 1)) if (grupo(a) !== grupo(b)) assert.ok(!seCruzan(c.get(a)!, c.get(b)!), `${a} se encima con ${b}`); });
}

function conDecoracion(): Escena {
  let e = vacia();
  e = herramienta(e, "agregar_pieza", { tipo: "arco_organico", colores: ["rosado", "blanco"] }).escena;
  e = herramienta(e, "agregar_pieza", { tipo: "columna_organica", colores: ["rosado"], donde: { en: "piso", x_cm: -230, z_cm: -100 } }).escena;
  e = herramienta(e, "agregar_pieza", { tipo: "columna_organica", colores: ["rosado"], donde: { en: "piso", x_cm: 230, z_cm: -100 } }).escena;
  return e;
}
const boda = herramienta(vacia(), "planificar_evento", { tipo_evento: "boda", invitados: 120, colores: ["blanco", "dorado"] }).escena;

// ---------------------------------------------------------------------------------------------------------------------
// Techo y aire no cuentan
// ---------------------------------------------------------------------------------------------------------------------

prueba("nueve guirnaldas de techo no agrandan la sala ni mueven mesas al ajustar invitados", () => {
  const pista = zonasDeEscena(boda).pista!;
  let conTecho = boda;
  for (const dx of [-500, 0, 500]) for (const dz of [-300, 300, 900]) conTecho = herramienta(conTecho, "agregar_pieza", { tipo: "guirnalda_organica", ancho_cm: 400, colores: ["blanco"], donde: { en: "techo", x_cm: (pista.x0 + pista.x1) / 2 + dx, z_cm: (pista.z0 + pista.z1) / 2 + dz } }).escena;
  const sin = herramienta(boda, "ajustar_salon", { invitados: 128 }).escena;
  const con = herramienta(conTecho, "ajustar_salon", { invitados: 128 }).escena;
  assert.deepEqual(con.sala, sin.sala, "el techo no cambia la sala");
  assert.deepEqual(posiciones(con, idsMesas(boda)), posiciones(sin, idsMesas(boda)), "ninguna de las 15 mesas se movió");
  assert.equal(idsMesas(con).length, 16);
});

prueba("armar_salon no mueve ni adopta lo que está en el techo ni en el aire", () => {
  let e = herramienta(conDecoracion(), "agregar_pieza", { tipo: "guirnalda_organica", colores: ["blanco"], donde: { en: "techo", x_cm: 0, z_cm: 150 } }).escena;
  const techo = e.nodos.at(-1)!;
  const libre = { ...e.nodos[1]!, id: "flotante", colocacion: { en: "libre" as const, xCm: 100, yCm: 120, zCm: 100, giroGrados: 0 } };
  e = { ...e, nodos: [...e.nodos, libre] };
  const r = herramienta(e, "armar_salon", { invitados: 60 }).escena;
  assert.deepEqual(r.nodos.find((n) => n.id === techo.id)?.colocacion, techo.colocacion);
  assert.deepEqual(r.nodos.find((n) => n.id === libre.id)?.colocacion, libre.colocacion);
  assert.equal(r.salon!.piezas[techo.id], undefined);
  assert.equal(r.salon!.piezas[libre.id], undefined);
  assert.equal(Object.values(r.salon!.piezas).filter((i) => i.rol === "adoptada").length, 3, "solo las tres del piso");
});

// ---------------------------------------------------------------------------------------------------------------------
// La decoración del usuario sigue a su zona
// ---------------------------------------------------------------------------------------------------------------------

prueba("la decoración conservada sigue al fondo de fotos cuando el fondo de la sala crece o llegan más invitados (no acaba sobre la mesa principal)", () => {
  const base = herramienta(conDecoracion(), "armar_salon", { invitados: 100, zonas: TODAS }).escena;
  sinEncimar(base);
  const adoptadas = vivas(base).filter((v) => v.info.rol === "adoptada").map((v) => v.nodo.id);
  assert.equal(adoptadas.length, 3);
  for (const e of [herramienta(base, "ajustar_salon", { fondo_cm: base.sala.fondoCm + 400 }).escena, herramienta(base, "ajustar_salon", { invitados: 200 }).escena, herramienta(base, "ajustar_salon", { ancho_cm: base.sala.anchoCm + 300 }).escena]) {
    sinEncimar(e);
    const panel = zonasDeEscena(e).fondo!;
    const c = cajas(e);
    for (const id of adoptadas) { const caja = c.get(id)!; assert.ok(caja.z0 < panel.zCm + 160 && caja.z0 > -e.sala.fondoCm / 2, `${id} quedó lejos del fondo de fotos`); }
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// Lo que el usuario toca a mano
// ---------------------------------------------------------------------------------------------------------------------

prueba("una mesa quitada a mano no se vuelve a poner; con más invitados las nuevas llenan el hueco", () => {
  const sin3 = herramienta(boda, "quitar_pieza", { id: "salon-mesa-03" }).escena;
  assert.equal(idsMesas(sin3).length, 14);
  const igual = herramienta(sin3, "ajustar_salon", { invitados: 120 }).escena;
  assert.equal(idsMesas(igual).length, 14, "se respeta que la quitó");
  assert.ok(!igual.nodos.some((n) => n.id === "salon-mesa-03"));
  const mas = herramienta(sin3, "ajustar_salon", { invitados: 128 }).escena;
  assert.equal(idsMesas(mas).length, 15, "una mesa nueva (8 invitados más), en el primer sitio libre");
  assert.deepEqual(posiciones(mas, idsMesas(sin3)), posiciones(sin3, idsMesas(sin3)), "las demás no se movieron");
});

prueba("una mesa movida a mano se queda donde la pusieron al ajustar invitados y medidas, y las nuevas la esquivan", () => {
  const m5 = boda.nodos.find((n) => n.id === "salon-mesa-05")!.colocacion;
  assert.equal(m5.en, "piso");
  if (m5.en !== "piso") return;
  const movida = herramienta(boda, "mover_pieza", { id: "salon-mesa-05", donde: { en: "piso", x_cm: m5.xCm + 25, z_cm: m5.zCm + 15 } }).escena;
  const quedo = posiciones(movida, ["salon-mesa-05"]);
  for (const e of [herramienta(movida, "ajustar_salon", { invitados: 128 }).escena, herramienta(movida, "ajustar_salon", { ancho_cm: boda.sala.anchoCm + 400 }).escena, herramienta(movida, "ajustar_salon", { mesa: "redonda10" }).escena]) {
    assert.deepEqual(posiciones(e, ["salon-mesa-05"]), quedo, "se quedó donde la dejó el usuario");
    const c = cajas(e);
    for (const id of idsMesas(e)) if (id !== "salon-mesa-05") assert.ok(!seCruzan(c.get(id)!, c.get("salon-mesa-05")!), `${id} se encima con la movida`);
  }
  assert.match(herramienta(movida, "ajustar_salon", { invitados: 128 }).resumen, /1 mesa\(s\) que moviste a mano/);
});

prueba("una copia hecha con duplicar_pieza es del usuario: ni cuenta como mesa ni la quita ajustar_salon ni quitar_zona", () => {
  const dup = herramienta(boda, "duplicar_pieza", { id: "salon-mesa-03" }).escena;
  const copia = dup.nodos.find((n) => n.id !== "salon-mesa-03" && n.nombre.includes("copia"))!;
  assert.ok(copia && !esDelSalon(dup, copia.id));
  assert.equal(idsMesas(dup).length, 15);
  for (const e of [herramienta(dup, "ajustar_salon", { invitados: 120 }).escena, herramienta(dup, "ajustar_salon", { invitados: 64 }).escena, herramienta(dup, "quitar_zona", { zona: "mesas" }).escena]) {
    assert.ok(e.nodos.some((n) => n.id === copia.id), "la copia sigue");
  }
});

prueba("una zona movida con mover_zona (o a mano) no vuelve a su sitio cuando la sala crece", () => {
  const movida = herramienta(boda, "mover_zona", { zona: "pista", x_cm: 300 }).escena;
  const pistaAntes = posiciones(movida, ["salon-pista"]);
  const crece = herramienta(movida, "ajustar_salon", { ancho_cm: movida.sala.anchoCm + 400, fondo_cm: movida.sala.fondoCm + 300 }).escena;
  assert.deepEqual(posiciones(crece, ["salon-pista"]), pistaAntes);
  const fondo = zonasDeEscena(crece).fondo!;
  assert.ok(Math.abs(fondo.zCm - (-crece.sala.fondoCm / 2 + 30)) < 2, "las demás zonas sí siguieron su pared");
  const mas = herramienta(movida, "ajustar_salon", { invitados: 140 }).escena;
  assert.deepEqual(posiciones(mas, ["salon-pista"]), pistaAntes);
  const c = cajas(mas);
  for (const id of idsMesas(mas)) assert.ok(!seCruzan(c.get(id)!, c.get("salon-pista")!), `${id} se encima con la pista movida`);
});

prueba("quitar la mesa principal a mano y volver a agregarla no deja ids ni sillas repetidas", () => {
  const sin = herramienta(boda, "quitar_pieza", { id: "salon-principal" }).escena;
  assert.equal(zonasDeEscena(sin).mesaPrincipal, null, "sin la mesa no hay zona");
  const otra = herramienta(sin, "ajustar_salon", { agregar_zonas: ["mesa_principal"] }).escena;
  const ids = otra.nodos.map((n) => n.id);
  assert.equal(new Set(ids).size, ids.length, "ids únicos");
  const z = zonasDeEscena(otra).mesaPrincipal!;
  assert.equal(z.sillas.length, 6);
  assert.equal(vivas(otra).filter((v) => v.info.zona === "mesa_principal").length, 7);
  assert.ok(EscenaSchema.safeParse(otra).success);
});

prueba("quitar_zona del fondo de fotos saca lo del salón y deja la decoración del usuario", () => {
  const base = herramienta(conDecoracion(), "planificar_evento", { tipo_evento: "boda", invitados: 100 }).escena;
  const antes = conDecoracion().nodos;
  const r = herramienta(base, "quitar_zona", { zona: "fondo_fotos" });
  for (const n of antes) assert.ok(r.escena.nodos.some((x) => x.id === n.id), `${n.id} se quitó`);
  assert.ok(!r.escena.nodos.some((n) => n.id === "salon-fondo"));
  assert.equal(Object.values(r.escena.salon!.piezas).filter((i) => i.rol === "adoptada").length, 0, "ya no sigue a una zona que no existe");
});

// ---------------------------------------------------------------------------------------------------------------------
// Validación de la escena
// ---------------------------------------------------------------------------------------------------------------------

prueba("el servidor rechaza una escena con ids repetidos y acepta el registro del salón, que sobrevive al viaje", () => {
  assert.ok(EscenaSchema.safeParse(boda).success);
  const ida = EscenaSchema.parse(JSON.parse(JSON.stringify(boda)));
  assert.deepEqual(ida.salon, boda.salon, "el registro no se pierde");
  assert.deepEqual(zonasDeEscena(ida), zonasDeEscena(boda));
  const repetida = { ...boda, nodos: [...boda.nodos, boda.nodos[0]!] };
  assert.ok(!EscenaSchema.safeParse(repetida).success);
  assert.ok(!EscenaSchema.safeParse({ ...boda, salon: { ...boda.salon!, mesa: "cuadrada" } }).success);
});

// ---------------------------------------------------------------------------------------------------------------------
// Salas: capacidad y tamaño
// ---------------------------------------------------------------------------------------------------------------------

prueba("la pista queda con mesas a sus dos lados y más filas detrás", () => {
  const e = boda, z = zonasDeEscena(e), pista = z.pista!, c = cajas(e);
  const aLosLados = (lado: 1 | -1) => z.mesas.filter((id) => { const r = c.get(id)!; return r.z0 < pista.z1 && r.z1 > pista.z0 && (lado > 0 ? r.x0 >= pista.x1 : r.x1 <= pista.x0); });
  assert.ok(aLosLados(1).length >= 1 && aLosLados(-1).length >= 1, "mesas a la derecha e izquierda de la pista");
  assert.ok(z.mesas.some((id) => c.get(id)!.z0 >= pista.z1), "y mesas detrás de ella");
});

prueba("la sala que se calcula no es un hangar: metros cuadrados por invitado acotados", () => {
  const m2 = (invitados: number, mesa: (typeof TIPOS_MESA_SALON)[number]) => { const d = distribuirSalon({ invitados, mesa, zonas: TODAS }); return (d.sala.anchoCm * d.sala.fondoCm) / 1e4 / invitados; };
  assert.ok(m2(120, "redonda8") <= 3.4, `120 redonda8: ${m2(120, "redonda8")}`);
  assert.ok(m2(120, "imperial") <= 3, `120 imperial: ${m2(120, "imperial")}`);
  assert.ok(m2(200, "redonda8") <= 2.8, `200 redonda8: ${m2(200, "redonda8")}`);
  assert.ok(m2(200, "imperial") <= 2.5, `200 imperial: ${m2(200, "imperial")}`);
});

prueba("una sala dada rinde: 80 invitados en 15 × 20 m y 14 × 18 m caben mesas (antes casi ninguna)", () => {
  const caben = (a: number, f: number) => distribuirSalon({ invitados: 80, mesa: "redonda8", zonas: TODAS, sala: { anchoCm: a, fondoCm: f } }).capacidad;
  assert.ok(caben(1500, 2000) >= 8, `15 × 20: ${caben(1500, 2000)}`);
  assert.ok(caben(1400, 1800) >= 5, `14 × 18: ${caben(1400, 1800)}`);
  const error = falla(vacia(), "armar_salon", { invitados: 80, ancho_cm: 1200, fondo_cm: 1400 });
  assert.match(error, /caben \d+ mesas de 8 \(\d+ invitados\)/);
  assert.match(error, /pide hasta \d+ invitados|agranda la sala/);
});

prueba("el tope de invitados es lo que cabe de verdad en 30 × 30 m en cada tipo de mesa, y la IA no pide más", () => {
  for (const mesa of TIPOS_MESA_SALON) {
    const d = distribuirSalon({ invitados: MAX_INVITADOS_SALON, mesa, zonas: TODAS });
    assert.equal(d.faltan, 0, `${mesa}: ${MAX_INVITADOS_SALON} invitados no caben`);
    assert.ok(d.capacidad * MESAS_SALON[mesa].puestos >= MAX_INVITADOS_SALON);
  }
  assert.match(falla(vacia(), "armar_salon", { invitados: MAX_INVITADOS_SALON + 1 }), /Parámetros no válidos|admite hasta/);
  assert.match(falla(vacia(), "planificar_evento", { tipo_evento: "boda", invitados: MAX_INVITADOS_SALON + 1 }), /Parámetros no válidos|admite hasta/);
  const grande = herramienta(vacia(), "planificar_evento", { tipo_evento: "boda", invitados: MAX_INVITADOS_SALON, mesa: "redonda10" }).escena;
  assert.ok(grande.sala.anchoCm <= 3000 && grande.sala.fondoCm <= 3000 && idsMesas(grande).length === MAX_INVITADOS_SALON / 10);
});

// ---------------------------------------------------------------------------------------------------------------------
// Arcos y datos pedidos
// ---------------------------------------------------------------------------------------------------------------------

prueba("el arco de la entrada nunca queda a menos de 4 m del arco del fondo de fotos (o no se arma)", () => {
  for (const [a, f] of [[600, 500], [600, 600], [700, 650], [800, 800], [900, 1000], [1200, 1400]] as const) {
    const e = herramienta(vacia(), "planificar_evento", { tipo_evento: "boda", alcance: "solo_decoracion", ancho_cm: a, fondo_cm: f }).escena;
    const fondo = e.nodos.find((n) => n.id === "salon-fondo-arco")?.colocacion, entrada = e.nodos.find((n) => n.id === "salon-entrada-arco")?.colocacion;
    assert.ok(fondo?.en === "piso", `${a}x${f}: falta el arco del fondo`);
    if (entrada?.en === "piso" && fondo.en === "piso") assert.ok(entrada.zCm - fondo.zCm >= 400, `${a}x${f}: arcos a ${entrada.zCm - fondo.zCm} cm`);
    else assert.ok(a * f <= 600 * 600, `${a}x${f}: una sala de ese tamaño sí debía llevar el arco de la entrada`);
  }
});

prueba("los invitados pedidos se guardan: ajustar el tipo de mesa no los cambia y el resumen los dice tal cual", () => {
  const cien = herramienta(vacia(), "planificar_evento", { tipo_evento: "boda", invitados: 100 });
  assert.equal(cien.escena.salon!.invitados, 100);
  assert.match(cien.resumen, /100 invitados/);
  const imperial = herramienta(cien.escena, "ajustar_salon", { mesa: "imperial" });
  assert.equal(imperial.escena.salon!.invitados, 100);
  assert.match(imperial.resumen, /100 invitados/);
  assert.doesNotMatch(imperial.resumen, /para 1\d\d invitados(?<!100 invitados)/);
  assert.equal(herramienta(cien.escena, "ajustar_salon", { invitados: 104 }).escena.salon!.invitados, 104);
});

prueba("la decoración del usuario en el techo o la pared no impide el arco del fondo; la del piso sí lo reemplaza", () => {
  const conTecho = herramienta(vacia(), "agregar_pieza", { tipo: "guirnalda_organica", colores: ["blanco"], donde: { en: "techo", x_cm: 0, z_cm: 0 } }).escena;
  const a = herramienta(conTecho, "planificar_evento", { tipo_evento: "boda", invitados: 60 }).escena;
  assert.ok(a.nodos.some((n) => n.id === "salon-fondo-arco"), "el arco del fondo se arma");
  const b = herramienta(conDecoracion(), "planificar_evento", { tipo_evento: "boda", invitados: 60 }).escena;
  assert.ok(!b.nodos.some((n) => n.id === "salon-fondo-arco"), "su decoración del piso es el fondo");
});

prueba("zonasDeEscena entrega lo que las otras herramientas consumen (mesas en orden, mesa principal con sus sillas, pista)", () => {
  const z = zonasDeEscena(boda);
  assert.equal(z.mesas.length, 15);
  assert.deepEqual(z.mesas, [...z.mesas].sort());
  assert.equal(z.mesaPrincipal!.sillas.length, 6);
  assert.ok(z.pista && z.pista.x1 - z.pista.x0 >= 300);
  assert.ok(z.mesas.every((id) => esDelSalon(boda, id)));
});

console.log(`\n${pruebas} pruebas pasaron`);
