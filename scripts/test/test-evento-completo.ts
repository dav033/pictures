/**
 * El evento completo (REQ-008 + centros de mesa y techo por zona): planificar_evento de una llamada lo trae todo, y ajustar_salon,
 * mover_zona y quitar_zona lo llevan consistente. Sin coste: ninguna IA ni red.
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-evento-completo.ts
 * - boda: un centro por cada mesa de invitados y por la principal, y festones sobre la pista (anotados en el registro);
 * - rincón: centros y un grupito de globos sobre la mesa de postres; solo_decoracion: ni centros ni techo;
 * - ajustar_salon: las mesas nuevas reciben el centro de las demás, las que se quitan se llevan el suyo, el cambio de tipo de mesa
 *   (redonda de 10, imperial) vuelve a apoyar cada centro en su tapa; sin centros previos no se pone ninguno;
 * - quitar_zona / mover_zona / armar_salon con reemplazar: el techo y los centros van con su zona y nunca queda un centro sin mesa;
 * - la mesa principal la dice el registro del salón, no el nombre ni el sitio;
 * - el peor salón (300 invitados en 30 × 30 m) cabe en MAX_NODOS con centros y techo.
 */
import assert from "node:assert/strict";
import { armarEscena, SALA_INICIAL, type Escena } from "../../src/lib/globos3d/escena";
import { centrosDe, mesasDeEscena, padreDeCentro } from "../../src/lib/globos3d/centros-mesa";
import { EscenaSchema } from "../../src/lib/globos3d/esquema-escena";
import { aplicarHerramienta } from "../../src/lib/globos3d/herramientas-escena";
import { MAX_NODOS } from "../../src/lib/globos3d/limites-escena";
import { anclaDeZona, mesasVivas } from "../../src/lib/globos3d/salon-registro";
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
  assert.ok(!r.ok, `${nombre} debía fallar`);
  return r.ok ? "" : r.error;
};
const techos = (e: Escena) => e.nodos.filter((n) => n.id.startsWith("techo-zona-"));
const padres = (e: Escena) => new Set(centrosDe(e).map((c) => padreDeCentro(c)));
const ordenados = (ids: Iterable<string | null>) => [...ids].sort();
/** Ningún centro apunta a una mesa que ya no está. */
function sinHuerfanos(e: Escena) {
  const ids = new Set(e.nodos.map((n) => n.id));
  for (const c of centrosDe(e)) assert.ok(ids.has(padreDeCentro(c)!), `${c.id} quedó sin su mesa ${padreDeCentro(c)}`);
}
/** Cada centro está en la tapa de su mesa: su base a la altura de la tapa y su centro sobre el de ella. */
function apoyados(e: Escena) {
  const armada = armarEscena(e);
  const mesas = mesasDeEscena(e, armada);
  for (const c of centrosDe(e)) {
    const m = mesas.find((x) => x.nodo.id === padreDeCentro(c))!;
    const caja = armada.porNodo.find((n) => n.id === c.id)!.caja;
    assert.ok(Math.abs(caja.min.y - m.cubierta.centro.y) <= 3, `${c.id}: base a ${caja.min.y.toFixed(1)} cm y la tapa de ${m.nodo.id} está a ${m.cubierta.centro.y.toFixed(1)}`);
    assert.ok(Math.hypot((caja.min.x + caja.max.x) / 2 - m.cubierta.centro.x, (caja.min.z + caja.max.z) / 2 - m.cubierta.centro.z) <= 4, `${c.id}: descentrado en ${m.nodo.id}`);
  }
}
const boda = (extra: Record<string, unknown> = {}) => herramienta(vacia(), "planificar_evento", { tipo_evento: "boda", invitados: 120, colores: ["blanco", "dorado"], ...extra });

prueba("planificar_evento: boda de 120 pone un centro en cada mesa de invitados y en la principal, y festones sobre la pista", () => {
  const r = boda();
  const e = r.escena, z = zonasDeEscena(e);
  assert.equal(z.mesas.length, 15);
  assert.deepEqual(ordenados(padres(e)), ordenados([...z.mesas, z.mesaPrincipal!.id]), "una mesa, un centro");
  assert.equal(centrosDe(e).length, 16);
  assert.ok(centrosDe(e).every((c) => c.pieza.tipo === "decoracion" && c.pieza.decoracion.tipo === "ramo_helio"));
  const techo = techos(e);
  assert.equal(techo.length, 1);
  assert.equal(techo[0]!.pieza.tipo, "techo");
  assert.match(techo[0]!.nombre, /pista/i);
  const pista = z.pista!, c = techo[0]!.colocacion;
  assert.ok(c.en === "techo" && Math.abs(c.xCm - (pista.x0 + pista.x1) / 2) <= 1 && Math.abs(c.zCm - (pista.z0 + pista.z1) / 2) <= 1, "centrado sobre la pista");
  assert.deepEqual(e.salon!.piezas[techo[0]!.id], { zona: "pista", rol: "adorno" }, "el techo es del salón: va y viene con la pista");
  assert.doesNotMatch(r.resumen, /No pude aplicar|No quedaron/);
  apoyados(e); sinHuerfanos(e);
  assert.ok(e.nodos.length <= MAX_NODOS);
  assert.ok(EscenaSchema.safeParse(e).success, "la escena pasa el esquema de la ruta");
});

prueba("planificar_evento en estilo clásico pone racimos, no ramos de helio", () => {
  const e = boda({ estilo: "clasico" }).escena;
  assert.equal(centrosDe(e).length, 16);
  assert.ok(centrosDe(e).every((c) => c.pieza.tipo === "decoracion" && c.pieza.decoracion.tipo === "flor"));
});

prueba("un color que no se fabrica no tumba el evento", () => {
  const r = boda({ colores: ["terracota", "vino"] });
  assert.equal(zonasDeEscena(r.escena).mesas.length, 15);
  assert.ok(centrosDe(r.escena).length > 0);
});

prueba("rincón de cumpleaños para 20: centros en sus mesas y un grupito de globos sobre la mesa de postres, sin pista", () => {
  const e = herramienta(vacia(), "planificar_evento", { tipo_evento: "cumpleanos", alcance: "rincon", invitados: 20, tematica: "unicornio", colores: ["rosa", "blanco"] }).escena;
  const z = zonasDeEscena(e);
  assert.equal(z.mesas.length, 3);
  assert.equal(z.mesaPrincipal, null);
  assert.deepEqual(ordenados(padres(e)), ordenados(z.mesas));
  const t = techos(e);
  assert.equal(t.length, 1);
  assert.equal(t[0]!.nombre, "Techo del rincón");
  assert.deepEqual(e.salon!.piezas[t[0]!.id], { zona: "mesa_postres", rol: "adorno" });
  const postres = anclaDeZona(e, "mesa_postres")!.nodo.colocacion, c = t[0]!.colocacion;
  assert.ok(c.en === "techo" && postres.en === "piso" && Math.hypot(c.xCm - postres.xCm, c.zCm - postres.zCm) < 60, "sobre los postres");
  apoyados(e); sinHuerfanos(e);
});

prueba("solo_decoracion no lleva centros ni techo; el salón corporativo, con centros pero sin pista, no lleva techo de pista", () => {
  const solo = herramienta(vacia(), "planificar_evento", { tipo_evento: "cumpleanos", alcance: "solo_decoracion", tematica: "unicornio", colores: ["rosa"] }).escena;
  assert.equal(centrosDe(solo).length, 0);
  assert.equal(techos(solo).length, 0);
  const corp = herramienta(vacia(), "planificar_evento", { tipo_evento: "corporativo", invitados: 80 }).escena;
  assert.ok(centrosDe(corp).length > 0);
  assert.ok(techos(corp).every((n) => !/pista/i.test(n.nombre)), "sin pista no hay techo de pista");
});

prueba("ajustar_salon con más invitados: las mesas nuevas reciben el mismo centro, solas, y el resumen lo dice", () => {
  const r = herramienta(boda().escena, "ajustar_salon", { invitados: 180 });
  const e = r.escena, z = zonasDeEscena(e);
  assert.ok(z.mesas.length > 15);
  assert.deepEqual(ordenados(padres(e)), ordenados([...z.mesas, z.mesaPrincipal!.id]), "ninguna mesa se queda sin centro");
  assert.match(r.resumen, /nueva\(s\) recibieron el mismo centro/);
  const pieza = (id: string) => JSON.stringify(centrosDe(e).find((c) => padreDeCentro(c) === id)!.pieza);
  assert.ok(z.mesas.every((id) => pieza(id) === pieza(z.mesas[0]!)), "todos iguales");
  apoyados(e); sinHuerfanos(e);
});

prueba("ajustar_salon con menos invitados: las mesas que se quitan se llevan su centro; ninguno queda sin mesa", () => {
  const e = herramienta(boda().escena, "ajustar_salon", { invitados: 40 }).escena;
  const z = zonasDeEscena(e);
  assert.equal(z.mesas.length, 5);
  assert.equal(centrosDe(e).length, 6);
  assert.deepEqual(ordenados(padres(e)), ordenados([...z.mesas, z.mesaPrincipal!.id]));
  sinHuerfanos(e);
});

prueba("ajustar_salon sin centros previos no los inventa: lo que nadie decoró queda sin decorar", () => {
  const sala = herramienta(vacia(), "armar_salon", { invitados: 40 }).escena;
  assert.equal(centrosDe(herramienta(sala, "ajustar_salon", { invitados: 100 }).escena).length, 0);
});

prueba("ajustar_salon cambia el tipo de mesa (redonda de 10, imperial): cada centro vuelve a apoyarse en la tapa nueva", () => {
  let e = herramienta(vacia(), "planificar_evento", { tipo_evento: "boda", invitados: 80, colores: ["blanco", "dorado"] }).escena;
  for (const mesa of ["redonda10", "imperial", "redonda8"]) {
    const r = herramienta(e, "ajustar_salon", { mesa });
    e = r.escena;
    assert.equal(centrosDe(e).length, zonasDeEscena(e).mesas.length + 1, `${mesa}: una mesa, un centro (${r.resumen})`);
    assert.deepEqual(ordenados(padres(e)), ordenados([...zonasDeEscena(e).mesas, zonasDeEscena(e).mesaPrincipal!.id]), mesa);
    apoyados(e); sinHuerfanos(e);
  }
  const muebles = mesasVivas(e).map((v) => (v.nodo.pieza.tipo === "escenografia" ? v.nodo.pieza.mueble?.id : ""));
  assert.ok(muebles.every((m) => m === "mesa_redonda_sillas"));
});

prueba("un centro que no cabe en la mesa nueva se quita y se avisa: nunca queda flotando ni metido en la mesa", () => {
  const sala = herramienta(vacia(), "armar_salon", { invitados: 40, zonas: ["mesa_postres"] }).escena;
  const grande = herramienta(sala, "decorar_mesas", { disenos: [{ tipo: "racimo", alto_cm: 80 }], grupo: "invitados" }).escena;
  assert.equal(centrosDe(grande).length, 5);
  const r = herramienta(grande, "ajustar_salon", { mesa: "imperial" });
  assert.equal(centrosDe(r.escena).length, 0, "el racimo de 1 m no cabe en la tapa de 92 cm de la imperial");
  assert.match(r.resumen, /ya no cabe en la mesa nueva/);
  apoyados(r.escena); sinHuerfanos(r.escena);
});

prueba("quitar_zona: pista se lleva su techo; mesas se llevan sus centros pero no el de la principal; mesa_principal se lleva el suyo", () => {
  const e = boda().escena;
  const sinPista = herramienta(e, "quitar_zona", { zona: "pista" }).escena;
  assert.equal(techos(sinPista).length, 0);
  assert.equal(Object.keys(sinPista.salon!.piezas).filter((id) => !sinPista.nodos.some((n) => n.id === id)).length, 0, "el registro no guarda piezas que ya no están");
  const sinMesas = herramienta(e, "quitar_zona", { zona: "mesas" }).escena;
  assert.deepEqual([...padres(sinMesas)], [zonasDeEscena(sinMesas).mesaPrincipal!.id]);
  sinHuerfanos(sinMesas);
  const sinPrincipal = herramienta(e, "quitar_zona", { zona: "mesa_principal" }).escena;
  assert.equal(centrosDe(sinPrincipal).length, 15);
  sinHuerfanos(sinPrincipal);
});

prueba("mover_zona de la pista lleva su techo con ella", () => {
  const e = boda().escena;
  const t0 = techos(e)[0]!.colocacion, p0 = anclaDeZona(e, "pista")!.nodo.colocacion;
  const r = herramienta(e, "mover_zona", { zona: "pista", x_cm: 200 });
  const t1 = techos(r.escena)[0]!.colocacion, p1 = anclaDeZona(r.escena, "pista")!.nodo.colocacion;
  assert.ok(t0.en === "techo" && t1.en === "techo" && p0.en === "piso" && p1.en === "piso");
  if (t0.en === "techo" && t1.en === "techo" && p0.en === "piso" && p1.en === "piso") {
    assert.notEqual(p1.xCm, p0.xCm);
    assert.equal(t1.xCm - t0.xCm, p1.xCm - p0.xCm);
  }
});

prueba("armar_salon con reemplazar quita los centros y el techo del salón anterior y lo avisa; no queda nada huérfano", () => {
  const r = herramienta(boda().escena, "armar_salon", { invitados: 60, reemplazar: true });
  assert.equal(centrosDe(r.escena).length, 0);
  assert.equal(techos(r.escena).length, 0);
  assert.match(r.resumen, /16 centro\(s\) de mesa del salón anterior se fueron/);
  sinHuerfanos(r.escena);
});

prueba("la mesa principal la dice el registro del salón: aunque se llame distinto o las de invitados sean imperiales", () => {
  const e = herramienta(vacia(), "planificar_evento", { tipo_evento: "boda", invitados: 60, mesa: "imperial" }).escena;
  const z = zonasDeEscena(e);
  const renombrada: Escena = { ...e, nodos: e.nodos.map((n) => (n.id === z.mesaPrincipal!.id ? { ...n, nombre: "Mesa 99" } : n.id === z.mesas[0] ? { ...n, nombre: "Mesa de honor" } : n)) };
  const solo = herramienta(renombrada, "quitar_centros", {}).escena;
  const conPrincipal = herramienta(solo, "decorar_mesas", { disenos: [{ tipo: "columna" }], grupo: "principal" }).escena;
  assert.deepEqual([...padres(conPrincipal)], [z.mesaPrincipal!.id], "no la adivina por el nombre «honor»");
  const invitados = herramienta(solo, "decorar_mesas", { disenos: [{ tipo: "columna" }], grupo: "invitados" }).escena;
  assert.ok(!padres(invitados).has(z.mesaPrincipal!.id));
  assert.equal(padres(invitados).size, z.mesas.length, "las de invitados, todas (también la llamada «de honor»)");
  const sinPrincipal = herramienta(solo, "quitar_zona", { zona: "mesa_principal" }).escena;
  assert.match(falla(sinPrincipal, "decorar_mesas", { disenos: [{ tipo: "columna" }], grupo: "principal" }), /No identifico la mesa principal/);
  assert.equal(padres(herramienta(sinPrincipal, "decorar_mesas", { disenos: [{ tipo: "columna" }], grupo: "invitados" }).escena).size, z.mesas.length);
});

prueba("el peor salón (300 invitados en 30 × 30 m, con centros y techo) cabe en MAX_NODOS", () => {
  for (const mesa of ["redonda8", "redonda10", "imperial"]) {
    const r = herramienta(vacia(), "planificar_evento", { tipo_evento: "boda", invitados: 300, mesa, ancho_cm: 3000, fondo_cm: 3000, colores: ["blanco", "dorado"] });
    const n = r.escena.nodos.length, mesas = zonasDeEscena(r.escena).mesas.length;
    console.log(`    ${mesa}: ${mesas} mesas, ${centrosDe(r.escena).length} centros, ${n} piezas de ${MAX_NODOS}`);
    assert.ok(n <= MAX_NODOS);
    assert.equal(centrosDe(r.escena).length, mesas + 1, `${mesa}: todas con centro`);
    assert.doesNotMatch(r.resumen, /No pude aplicar/);
  }
});

prueba("A7: un centro que el usuario puso a mano en una mesa suya ni decide ni sirve de modelo al ajustar el salón", () => {
  const conMesaSuya = herramienta(herramienta(vacia(), "agregar_mobiliario", { id: "mesa_redonda_mantel", x_cm: 0, z_cm: 0 }).escena, "decorar_mesas", { disenos: [{ tipo: "columna", colores: ["rojo"] }] }).escena;
  const suyo = centrosDe(conMesaSuya)[0]!;
  const sala = herramienta(conMesaSuya, "planificar_evento", { tipo_evento: "boda", invitados: 60, colores: ["blanco", "dorado"] }).escena;
  assert.equal(centrosDe(sala)[0]!.id, suyo.id, "el del usuario va primero: el que copiaría completar_centros");
  const mas = herramienta(sala, "ajustar_salon", { invitados: 140 }).escena;
  const nuevas = zonasDeEscena(mas).mesas.filter((id) => !zonasDeEscena(sala).mesas.includes(id));
  assert.ok(nuevas.length > 0);
  for (const id of nuevas) {
    const pieza = centrosDe(mas).find((c) => padreDeCentro(c) === id)?.pieza;
    assert.ok(pieza?.tipo === "decoracion" && pieza.decoracion.tipo === "ramo_helio", `${id} copió el centro del usuario`);
  }
  assert.deepEqual(mas.nodos.find((n) => n.id === suyo.id), sala.nodos.find((n) => n.id === suyo.id), "el del usuario no se toca");
  // Si el salón no llevaba centros, uno del usuario no hace que se pongan en las mesas nuevas.
  const sinCentros = herramienta(conMesaSuya, "armar_salon", { invitados: 60 }).escena;
  const crece = herramienta(sinCentros, "ajustar_salon", { invitados: 140 }).escena;
  assert.deepEqual(centrosDe(crece).map((c) => c.id), [suyo.id]);
});

console.log(`\n${pruebas} pruebas pasaron`);
