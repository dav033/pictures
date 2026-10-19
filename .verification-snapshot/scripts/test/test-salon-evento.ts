/**
 * Salón de eventos (REQ-008): distribución, herramientas y ajustes. Sin coste: ninguna IA ni red.
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-salon-evento.ts
 * - distribuirSalon: mesas >= ceil(invitados / puestos), dentro de la sala, sin encimarse, pasillos >= 90 cm, pista libre, zonas
 *   presentes, determinista; la sala se calcula chica pero cabe (y falla claro si no cabe);
 * - armar_salon sobre una escena con decoración: no pierde ni cambia ninguna pieza del usuario (la corre al fondo de fotos);
 * - escalas: solo la decoración (sin mesas), un rincón (2 a 6 mesas o solo postres), un salón mediano y uno grande;
 * - ajustar_salon: 120 → 60 quita las últimas mesas sin mover las demás; 60 → 120 las agrega; otro tipo de mesa; sala más grande o
 *   más chica; una zona que falta; mover_zona y quitar_zona; lo del usuario siempre queda;
 * - planificar_evento: arma el evento de una llamada, con los colores pedidos (los centros de mesa y el techo, en test-evento-completo.ts);
 * - los esquemas de las herramientas son chicos (cabrían en Gemini): sin enumeraciones largas.
 */
import assert from "node:assert/strict";
import { armarEscena, SALA_INICIAL, type Escena, type NodoEscena } from "../../src/lib/globos3d/escena";
import { aplicarHerramienta, DECLARACIONES_ESCENA } from "../../src/lib/globos3d/herramientas-escena";
import { MAX_NODOS } from "../../src/lib/globos3d/limites-escena";
import { distribuirSalon, ENTRADA_RETIRO_CM, MESAS_SALON, PASILLO_CM, TIPOS_MESA_SALON, type ElementoSalon } from "../../src/lib/globos3d/salon-evento";
import { esDelSalon, mesasVivas } from "../../src/lib/globos3d/salon-registro";
import { rectDe, seCruzan, ZONAS_SALON, zonasDeEscena, zonasPresentes, type RectCm } from "../../src/lib/globos3d/salon-zonas";

let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };
const vacia = (): Escena => ({ sala: { ...SALA_INICIAL }, nodos: [] });
const herramienta = (escena: Escena, nombre: string, args: Record<string, unknown>) => {
  const r = aplicarHerramienta(escena, nombre, args);
  if (!r.ok) assert.fail(`${nombre}: ${r.error}`);
  return r;
};
const falla = (escena: Escena, nombre: string, args: Record<string, unknown>) => {
  const r = aplicarHerramienta(escena, nombre, args);
  assert.ok(!r.ok, `${nombre} debía fallar`);
  return r.ok ? "" : r.error;
};
const cajas = (escena: Escena): Map<string, RectCm> => new Map(armarEscena(escena).porNodo.filter((n) => n.copias > 0).map((n) => [n.id, { x0: n.caja.min.x, x1: n.caja.max.x, z0: n.caja.min.z, z1: n.caja.max.z }]));
const mesas = (escena: Escena) => mesasVivas(escena).map((v) => v.nodo);
const hayZona = (escena: Escena, zona: (typeof ZONAS_SALON)[number]) => zonasPresentes(escena).includes(zona);
const delSalon = (escena: Escena) => escena.nodos.filter((n) => esDelSalon(escena, n.id));
const dentro = (r: RectCm, s: Pick<Escena["sala"], "anchoCm" | "fondoCm">, tol = 1) => r.x0 >= -s.anchoCm / 2 - tol && r.x1 <= s.anchoCm / 2 + tol && r.z0 >= -s.fondoCm / 2 - tol && r.z1 <= s.fondoCm / 2 + tol;
const hueco = (a: RectCm, b: RectCm) => Math.max(Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1), Math.max(a.z0, b.z0) - Math.min(a.z1, b.z1));
const TODAS = [...ZONAS_SALON];
/** Ninguna pieza de una zona se encima con una pieza de otra (las de una misma zona sí se tocan: sillas con su mesa, arco con su panel). */
function sinEncimar(escena: Escena) {
  const c = cajas(escena);
  const zonaDe = (id: string) => { const i = escena.salon!.piezas[id]!; return i.zona === "mesas" ? id : i.zona; };
  const ids = [...c.keys()].filter((id) => escena.salon?.piezas[id] !== undefined);
  ids.forEach((a, i) => { for (const b of ids.slice(i + 1)) if (zonaDe(a) !== zonaDe(b)) assert.ok(!seCruzan(c.get(a)!, c.get(b)!), `${a} se encima con ${b}`); });
}

/** Un lienzo ya decorado por el usuario: un arco orgánico y dos columnas (lo que Gemini pone a mano). */
function conDecoracion(): Escena {
  let e = vacia();
  e = herramienta(e, "agregar_pieza", { tipo: "arco_organico", colores: ["rosado", "blanco"] }).escena;
  e = herramienta(e, "agregar_pieza", { tipo: "columna_organica", colores: ["rosado"], donde: { en: "piso", x_cm: -230, z_cm: -100 } }).escena;
  e = herramienta(e, "agregar_pieza", { tipo: "columna_organica", colores: ["rosado"], donde: { en: "piso", x_cm: 230, z_cm: -100 } }).escena;
  return e;
}

// ---------------------------------------------------------------------------------------------------------------------
// Distribución pura
// ---------------------------------------------------------------------------------------------------------------------

prueba("distribuirSalon: mesas suficientes, dentro de la sala, sin encimarse y con pasillos de 90 cm o más (3 tipos de mesa, 24 a 200 invitados)", () => {
  for (const mesa of TIPOS_MESA_SALON) for (const invitados of [24, 60, 120, 200]) {
    const d = distribuirSalon({ invitados, mesa, zonas: TODAS });
    const { puestos, anchoCm, fondoCm } = MESAS_SALON[mesa];
    const m = d.elementos.filter((e) => e.zona === null);
    assert.equal(d.faltan, 0, `${mesa} ${invitados}`);
    assert.ok(m.length >= Math.ceil(invitados / puestos), `${mesa} ${invitados}: ${m.length} mesas`);
    assert.equal(d.mesasNecesarias, Math.ceil(invitados / puestos));
    assert.deepEqual(d.sinLugar, [], `${mesa} ${invitados}: zonas sin lugar`);
    const sala = { anchoCm: d.sala.anchoCm, fondoCm: d.sala.fondoCm, altoCm: 450 };
    const rects = m.map((e) => rectDe(e.xCm, e.zCm, anchoCm, fondoCm));
    rects.forEach((r, i) => {
      assert.ok(dentro(r, sala), `${mesa} ${invitados}: la mesa ${i + 1} sale de la sala`);
      for (let j = i + 1; j < rects.length; j++) assert.ok(hueco(r, rects[j]!) >= 90, `${mesa} ${invitados}: pasillo entre ${i + 1} y ${j + 1} = ${hueco(r, rects[j]!)}`);
    });
    const pista = d.elementos.find((e) => e.zona === "pista")!;
    const rp = rectDe(pista.xCm, pista.zCm, pista.anchoCm, pista.fondoCm);
    for (const r of rects) assert.ok(hueco(r, rp) >= 90, `${mesa} ${invitados}: una mesa invade la pista`);
    assert.ok(d.sala.anchoCm <= 3000 && d.sala.fondoCm <= 3000);
  }
});

prueba("distribuirSalon: todas las zonas presentes, dentro de la sala y la mesa principal mira al salón (sillas detrás)", () => {
  const d = distribuirSalon({ invitados: 120, mesa: "redonda8", zonas: TODAS });
  for (const z of ZONAS_SALON) assert.ok(d.elementos.some((e) => e.zona === z), `falta ${z}`);
  const principal = d.elementos.find((e) => e.id === "salon-principal")!;
  const sillas = d.elementos.filter((e) => e.id.startsWith("salon-principal-silla-"));
  assert.ok(sillas.length >= 4);
  for (const s of sillas) { assert.ok(s.zCm < principal.zCm, "las sillas van detrás de la mesa, hacia la pared del fondo"); assert.equal(s.giroGrados, 0, "de frente al salón"); }
  const fondo = d.elementos.find((e) => e.zona === "fondo_fotos")!;
  assert.ok(fondo.zCm < principal.zCm && fondo.zCm < -d.sala.fondoCm / 2 + 60, "el panel está contra la pared del fondo");
  const entrada = d.elementos.find((e) => e.zona === "entrada")!;
  assert.ok(entrada.zCm > d.sala.fondoCm / 2 - 300, "la entrada está al frente");
  const postres = d.elementos.find((e) => e.zona === "mesa_postres")!;
  assert.ok(postres.xCm < -d.sala.anchoCm / 2 + 120, "los postres están contra una pared");
});

prueba("distribuirSalon es determinista, y quitar invitados quita las últimas mesas sin mover las demás", () => {
  const a = distribuirSalon({ invitados: 120, mesa: "redonda8", zonas: TODAS });
  assert.deepEqual(distribuirSalon({ invitados: 120, mesa: "redonda8", zonas: TODAS }), a);
  const menos = distribuirSalon({ invitados: 60, mesa: "redonda8", zonas: TODAS, sala: a.sala, pistaCm: a.elementos.find((e) => e.zona === "pista")!.anchoCm });
  const mesasA = a.elementos.filter((e) => e.zona === null), mesasB = menos.elementos.filter((e) => e.zona === null);
  assert.equal(mesasB.length, 8);
  assert.deepEqual(mesasB, mesasA.slice(0, 8), "las 8 primeras no se mueven");
});

prueba("una sala fija que no alcanza falla claro (faltan mesas) y no se desborda", () => {
  const d = distribuirSalon({ invitados: 200, mesa: "redonda8", zonas: TODAS, sala: { anchoCm: 800, fondoCm: 1000 } });
  assert.ok(d.faltan > 0 && d.capacidad < d.mesasNecesarias);
  assert.equal(d.elementos.filter((e) => e.zona === null).length, d.capacidad);
  const tope = distribuirSalon({ invitados: 1000, mesa: "redonda8", zonas: TODAS });
  assert.deepEqual(tope.sala, { anchoCm: 3000, fondoCm: 3000 }, "si ninguna sala alcanza, la máxima");
});

prueba("las zonas que no caben se avisan en vez de salirse de la sala", () => {
  const d = distribuirSalon({ invitados: 0, mesa: "redonda8", zonas: TODAS, sala: { anchoCm: 400, fondoCm: 450 } });
  assert.ok(d.sinLugar.length > 0);
  for (const e of d.elementos) assert.ok(dentro(rectDe(e.xCm, e.zCm, e.anchoCm, e.fondoCm), { anchoCm: 400, fondoCm: 450 }, 90), `${e.id} fuera`);
});

// ---------------------------------------------------------------------------------------------------------------------
// armar_salon sobre una escena
// ---------------------------------------------------------------------------------------------------------------------

prueba("armar_salon: piezas reales dentro de la sala, sin encimarse (cajas armadas), una pieza por mesa con sus sillas", () => {
  const r = herramienta(vacia(), "armar_salon", { invitados: 120, colores: ["blanco", "dorado"] });
  const e = r.escena;
  assert.equal(mesas(e).length, 15);
  assert.ok(e.nodos.length < MAX_NODOS);
  for (const m of mesas(e)) assert.equal(m.pieza.tipo === "escenografia" && m.pieza.mueble?.id, "mesa_redonda_sillas");
  const c = cajas(e);
  const ids = [...c.keys()];
  ids.forEach((a, i) => {
    assert.ok(dentro(c.get(a)!, e.sala, 1), `${a} sale de la sala`);
    for (const b of ids.slice(i + 1)) {
      const propios = (a.startsWith("salon-principal") && b.startsWith("salon-principal"));
      if (!propios) assert.ok(!seCruzan(c.get(a)!, c.get(b)!, ), `${a} se encima con ${b}`);
    }
  });
  const principal = e.nodos.find((n) => n.id === "salon-principal")!;
  assert.equal(principal.pieza.tipo === "escenografia" && principal.pieza.mueble?.opciones?.colores[0], "#f7f6f2", "mantel blanco");
  const sillas = e.nodos.find((n) => n.id === "salon-principal-silla-1")!;
  assert.equal(sillas.pieza.tipo === "escenografia" && sillas.pieza.mueble?.opciones?.colores[0], "#d6b25a", "sillas doradas");
  assert.ok(e.sala.anchoCm >= 1000 && e.sala.altoCm >= 450, "la sala creció a salón");
});

prueba("armar_salon conserva la decoración que ya había (mismas piezas, mismos datos) y la deja en el fondo de fotos", () => {
  const antes = conDecoracion();
  const r = herramienta(antes, "armar_salon", { invitados: 100 });
  for (const original of antes.nodos) {
    const ahora = r.escena.nodos.find((n) => n.id === original.id);
    assert.ok(ahora, `se perdió ${original.id}`);
    assert.deepEqual(ahora.pieza, original.pieza, `${original.id} cambió de pieza`);
  }
  const c = cajas(r.escena);
  const fondo = zonasDeEscena(r.escena).fondo!;
  for (const original of antes.nodos) {
    const caja = c.get(original.id)!;
    assert.ok(caja.z0 > fondo.zCm, `${original.id} quedó detrás del panel`);
    assert.ok(caja.z1 < fondo.zCm + 260, `${original.id} quedó lejos del fondo de fotos`);
    assert.ok(dentro(caja, r.escena.sala));
    for (const m of mesas(r.escena)) assert.ok(!seCruzan(caja, c.get(m.id)!), `${original.id} se encima con ${m.id}`);
  }
  assert.match(r.resumen, /conservó/);
});

prueba("armar_salon dos veces falla (no pisa) y con reemplazar rehace igual sin tocar lo del usuario", () => {
  const primero = herramienta(conDecoracion(), "armar_salon", { invitados: 80 });
  assert.match(falla(primero.escena, "armar_salon", { invitados: 80 }), /ajustar_salon/);
  const otra = herramienta(primero.escena, "armar_salon", { invitados: 80, reemplazar: true });
  assert.deepEqual(otra.escena, primero.escena, "los mismos parámetros dan la misma escena");
});

prueba("armar_salon valida: sin invitados ni zonas, medidas fuera de rango, sala que no alcanza", () => {
  assert.match(falla(vacia(), "armar_salon", {}), /invitados o qué zonas/);
  assert.match(falla(vacia(), "armar_salon", { invitados: 50, ancho_cm: 5000 }), /fuera de rango/);
  assert.match(falla(vacia(), "armar_salon", { invitados: 200, ancho_cm: 800, fondo_cm: 900 }), /caben/);
});

prueba("armar_salon no pasa del tope de piezas de la escena", () => {
  let e = vacia();
  for (let i = 0; i < 135; i++) e = { ...e, nodos: [...e.nodos, { id: `x-${i}`, nombre: "x", pieza: e.nodos[0]?.pieza ?? conDecoracion().nodos[0]!.pieza, colocacion: { en: "piso", xCm: 0, zCm: 0, giroGrados: 0 } }] };
  assert.match(falla(e, "armar_salon", { invitados: 120 }), /máximo/);
});

// ---------------------------------------------------------------------------------------------------------------------
// Escalas
// ---------------------------------------------------------------------------------------------------------------------

prueba("escala solo decoración: sin mesas de invitados y sin agrandar la sala", () => {
  const r = herramienta(vacia(), "planificar_evento", { tipo_evento: "boda", colores: ["blanco", "dorado"] });
  assert.equal(mesas(r.escena).length, 0);
  assert.deepEqual([r.escena.sala.anchoCm, r.escena.sala.fondoCm], [SALA_INICIAL.anchoCm, SALA_INICIAL.fondoCm]);
  const z = zonasDeEscena(r.escena);
  assert.ok(z.fondo && !z.entrada && !z.pista && !z.mesaPrincipal, "en 6 × 5 m el arco de la entrada taparía el del fondo: no se arma");
  assert.match(r.resumen, /entrada no cabe/);
  for (const id of ["salon-fondo-arco", "salon-fondo-columna"]) assert.ok(r.escena.nodos.some((n) => n.id === id), id);
  for (const [id, caja] of cajas(r.escena)) assert.ok(dentro(caja, r.escena.sala, 5), `${id} fuera de la sala`);
  const grande = herramienta(vacia(), "planificar_evento", { tipo_evento: "boda", alcance: "solo_decoracion", ancho_cm: 900, fondo_cm: 1000 });
  assert.ok(zonasDeEscena(grande.escena).entrada && grande.escena.nodos.some((n) => n.id === "salon-entrada-arco"));
  for (const [id, caja] of cajas(grande.escena)) assert.ok(dentro(caja, grande.escena.sala, 5), `${id} fuera de la sala`);
});

prueba("escala rincón: un rincón de postres suelto y un cumpleaños de 20 con 3 mesas", () => {
  const postres = herramienta(vacia(), "armar_salon", { invitados: 0, zonas: ["mesa_postres"] });
  assert.deepEqual(postres.escena.nodos.map((n) => n.id), ["salon-postres"]);
  assert.deepEqual([postres.escena.sala.anchoCm, postres.escena.sala.fondoCm], [SALA_INICIAL.anchoCm, SALA_INICIAL.fondoCm]);
  const cumple = herramienta(vacia(), "planificar_evento", { tipo_evento: "cumpleanos", invitados: 20, colores: ["rosa"] });
  assert.equal(mesas(cumple.escena).length, 3);
  const z = zonasDeEscena(cumple.escena);
  assert.ok(z.fondo && hayZona(cumple.escena, "mesa_postres") && !z.pista && !z.mesaPrincipal);
});

prueba("escala salón: 60 invitados (mediano) y 180 con mesas imperiales (grande) caben y se arman completos", () => {
  const mediano = herramienta(vacia(), "planificar_evento", { tipo_evento: "quince", invitados: 60 });
  assert.equal(mesas(mediano.escena).length, 8);
  const grande = herramienta(vacia(), "planificar_evento", { tipo_evento: "boda", invitados: 180, mesa: "imperial", colores: ["azul marino", "dorado"] });
  assert.equal(mesas(grande.escena).length, 18);
  for (const e of [mediano.escena, grande.escena]) {
    const z = zonasDeEscena(e);
    assert.ok(z.mesaPrincipal && z.pista && hayZona(e, "mesa_postres") && z.fondo && z.entrada);
    assert.ok(e.nodos.length <= MAX_NODOS);
    sinEncimar(e);
    for (const [id, caja] of cajas(e)) assert.ok(dentro(caja, e.sala, 5), `${id} fuera de la sala`);
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// Ajustar
// ---------------------------------------------------------------------------------------------------------------------

prueba("ajustar_salon 120 → 60 quita las últimas mesas sin mover las demás ni tocar lo del usuario", () => {
  const base = herramienta(conDecoracion(), "armar_salon", { invitados: 120 }).escena;
  const r = herramienta(base, "ajustar_salon", { invitados: 60 });
  assert.equal(mesas(r.escena).length, 8);
  const antes = mesas(base).slice(0, 8);
  assert.deepEqual(mesas(r.escena), antes, "las 8 de adelante quedan idénticas");
  for (const n of base.nodos.filter((x) => !esDelSalon(base, x.id))) assert.deepEqual(r.escena.nodos.find((x) => x.id === n.id), n, `${n.id} cambió`);
  for (const n of delSalon(base).filter((x) => !mesas(base).includes(x))) assert.deepEqual(r.escena.nodos.find((x) => x.id === n.id), n, `${n.id} cambió`);
  assert.deepEqual(r.escena.sala, base.sala, "la sala no cambia");
  assert.match(r.resumen, /Quité 7 mesa/);
});

prueba("ajustar_salon 60 → 120 agrega las mesas del final y cambiar el tipo conserva los colores", () => {
  const chico = herramienta(vacia(), "armar_salon", { invitados: 60, ancho_cm: 1800, fondo_cm: 2600, colores: ["blanco", "dorado"] }).escena;
  const grande = herramienta(chico, "ajustar_salon", { invitados: 120 });
  assert.equal(mesas(grande.escena).length, 15);
  assert.deepEqual(mesas(grande.escena).slice(0, 8), mesas(chico), "las que ya estaban siguen donde estaban");
  assert.deepEqual(grande.escena.sala, chico.sala, "cabían sin agrandar");
  const imperial = herramienta(grande.escena, "ajustar_salon", { mesa: "imperial" });
  const ms = mesas(imperial.escena);
  assert.ok(ms.length >= Math.ceil(120 / 10));
  assert.ok(ms.every((m) => m.pieza.tipo === "escenografia" && m.pieza.mueble?.id === "mesa_imperial_sillas" && m.pieza.mueble.opciones?.colores[1] === "#d6b25a"));
  for (const [id, caja] of cajas(imperial.escena)) assert.ok(dentro(caja, imperial.escena.sala, 5), `${id} fuera`);
});

prueba("ajustar_salon agranda la sala si las mesas no caben, y con una sala más chica o grande corre cada zona con su pared", () => {
  const base = herramienta(vacia(), "armar_salon", { invitados: 40, zonas: TODAS }).escena;
  const mas = herramienta(base, "ajustar_salon", { invitados: 160 });
  assert.ok(mesas(mas.escena).length === 20 && mas.escena.sala.anchoCm * mas.escena.sala.fondoCm > base.sala.anchoCm * base.sala.fondoCm);
  const ancha = herramienta(mas.escena, "ajustar_salon", { ancho_cm: mas.escena.sala.anchoCm + 400, fondo_cm: mas.escena.sala.fondoCm + 300 });
  assert.equal(ancha.escena.sala.anchoCm, mas.escena.sala.anchoCm + 400);
  const z = zonasDeEscena(ancha.escena);
  assert.ok(Math.abs(z.fondo!.zCm - (-ancha.escena.sala.fondoCm / 2 + 30)) < 2, "el panel sigue pegado a la pared del fondo");
  assert.ok(Math.abs(z.entrada!.zCm - (ancha.escena.sala.fondoCm / 2 - ENTRADA_RETIRO_CM)) < 2, "la entrada sigue al frente");
  for (const [id, caja] of cajas(ancha.escena)) assert.ok(dentro(caja, ancha.escena.sala, 5), `${id} fuera`);
  assert.match(falla(mas.escena, "ajustar_salon", { ancho_cm: 800, fondo_cm: 900 }), /caben/);
});

prueba("armar_salon informa las mesas colocadas, no la cuadrícula entera", () => {
  const armada = herramienta(vacia(), "armar_salon", { invitados: 40, ancho_cm: 1200, fondo_cm: 1800 });
  assert.equal(mesas(armada.escena).length, 5);
  assert.match(armada.resumen, /\(40 invitados: 40 puestos en 5 mesas \(la sala admite hasta \d+\)\)/);
  assert.ok(!/caben/.test(armada.resumen));
});

prueba("ajustar_salon informa lo que cabe de verdad: las mesas colocadas × sillas, no la cuadrícula entera", () => {
  const base = herramienta(vacia(), "armar_salon", { invitados: 40 }).escena;
  const ajustada = herramienta(base, "ajustar_salon", { invitados: 40, ancho_cm: 1200, fondo_cm: 1800 });
  assert.equal(mesas(ajustada.escena).length, 5);
  assert.match(ajustada.resumen, /\(40 invitados: 40 puestos en 5 mesas \(la sala admite hasta \d+\); sala/);
});

prueba("ajustar_salon agrega una zona que falta; mover_zona y quitar_zona sin rehacer nada", () => {
  const completo = herramienta(vacia(), "armar_salon", { invitados: 100 }).escena;
  const sinPista = herramienta(completo, "quitar_zona", { zona: "pista" });
  assert.ok(!sinPista.escena.nodos.some((n) => n.id === "salon-pista"));
  assert.equal(sinPista.escena.nodos.length, completo.nodos.length - 1);
  assert.deepEqual(mesas(sinPista.escena), mesas(completo), "quitar la pista no mueve las mesas");
  assert.match(falla(sinPista.escena, "quitar_zona", { zona: "pista" }), /No hay la pista/);
  const conPista = herramienta(sinPista.escena, "ajustar_salon", { agregar_zonas: ["pista"] });
  assert.ok(zonasDeEscena(conPista.escena).pista);

  const movida = herramienta(completo, "mover_zona", { zona: "mesa_postres", z_cm: 300 });
  const p = movida.escena.nodos.find((n) => n.id === "salon-postres")!.colocacion;
  assert.ok(p.en === "piso" && Math.abs(p.zCm - 300) < 1);
  assert.match(falla(completo, "mover_zona", { zona: "pista", x_cm: 99999 }), /se saldría/);
  assert.match(falla(completo, "mover_zona", { zona: "pista" }), /Dime a dónde/);
  // El ajuste siguiente respeta dónde quedó lo que el usuario movió.
  const ajustada = herramienta(movida.escena, "ajustar_salon", { invitados: 90 });
  assert.deepEqual(ajustada.escena.nodos.find((n) => n.id === "salon-postres"), movida.escena.nodos.find((n) => n.id === "salon-postres"));
  const quitaMesas = herramienta(completo, "quitar_zona", { zona: "mesas" });
  assert.equal(mesas(quitaMesas.escena).length, 0);
  assert.ok(quitaMesas.escena.nodos.some((n) => n.id === "salon-pista"));
});

prueba("lo que está sobre una mesa que se quita se va con ella; lo demás del usuario se queda", () => {
  const base = herramienta(conDecoracion(), "armar_salon", { invitados: 40 }).escena;
  const ultima = mesas(base).at(-1)!;
  const centro: NodoEscena = { id: "centro-x", nombre: "Centro", pieza: base.nodos.find((n) => n.id === "salon-postres")!.pieza, colocacion: { en: "sobre", padreId: ultima.id, puntoCm: { x: 0, y: 75, z: 0 }, normal: { x: 0, y: 1, z: 0 }, giroGrados: 0 } };
  const r = herramienta({ ...base, nodos: [...base.nodos, centro] }, "ajustar_salon", { invitados: 8 });
  assert.ok(!r.escena.nodos.some((n) => n.id === "centro-x"));
  assert.match(r.resumen, /1 pieza\(s\) que estaban sobre ellas/);
  assert.equal(r.escena.nodos.filter((n) => !esDelSalon(r.escena, n.id)).length, 3);
});

prueba("sin salón armado, ajustar / mover / quitar fallan claro", () => {
  assert.match(falla(vacia(), "ajustar_salon", { invitados: 50 }), /armar_salon/);
  assert.match(falla(vacia(), "mover_zona", { zona: "pista", x_cm: 0 }), /No hay/);
  assert.match(falla(vacia(), "quitar_zona", { zona: "mesas" }), /No hay/);
  assert.match(falla(herramienta(vacia(), "armar_salon", { invitados: 40 }).escena, "ajustar_salon", {}), /Dime qué cambiar/);
});

// ---------------------------------------------------------------------------------------------------------------------
// planificar_evento
// ---------------------------------------------------------------------------------------------------------------------

prueba("planificar_evento: boda de 120 en blanco y dorado, de una llamada, con arco, fondo de fotos y colores del pedido", () => {
  const r = herramienta(vacia(), "planificar_evento", { tipo_evento: "boda", invitados: 120, colores: ["blanco", "dorado"] });
  const e = r.escena;
  assert.equal(mesas(e).length, 15);
  const z = zonasDeEscena(e);
  assert.ok(z.mesaPrincipal && z.pista && hayZona(e, "mesa_postres") && z.fondo && z.entrada);
  for (const id of ["salon-fondo-arco", "salon-fondo-columna", "salon-fondo-columna-2", "salon-entrada-arco"]) assert.ok(e.nodos.some((n) => n.id === id), `falta ${id}`);
  const arco = e.nodos.find((n) => n.id === "salon-entrada-arco")!.pieza;
  assert.equal(arco.tipo, "arco_organico");
  if (arco.tipo === "arco_organico") assert.deepEqual(arco.arco.colores.map((c) => c.codigo), ["005", "570"], "blanco y dorado del resolvedor de colores");
  const mesa = e.nodos.find((n) => n.id === "salon-mesa-01")!.pieza;
  assert.equal(mesa.tipo === "escenografia" && mesa.mueble?.opciones?.colores[0], "#f7f6f2");
  assert.ok(armarEscena(e).globos.length > 300, "hay globos de verdad");
  sinEncimar(e);
  for (const [id, caja] of cajas(e)) assert.ok(dentro(caja, e.sala, 5), `${id} fuera`);
});

prueba("planificar_evento en estilo clásico arma arco y columnas de cuartetos", () => {
  const r = herramienta(vacia(), "planificar_evento", { tipo_evento: "boda", alcance: "solo_decoracion", estilo: "clasico", colores: ["rosa", "blanco"], ancho_cm: 900, fondo_cm: 1000 });
  assert.equal(r.escena.nodos.find((n) => n.id === "salon-entrada-arco")!.pieza.tipo, "arco");
  assert.equal(r.escena.nodos.find((n) => n.id === "salon-fondo-columna")!.pieza.tipo, "columna");
});

prueba("planificar_evento sobre una decoración existente la conserva y no le suma otro arco encima", () => {
  const antes = conDecoracion();
  const r = herramienta(antes, "planificar_evento", { tipo_evento: "boda", invitados: 100, colores: ["blanco"] });
  for (const n of antes.nodos) assert.deepEqual(r.escena.nodos.find((x) => x.id === n.id)?.pieza, n.pieza);
  assert.ok(!r.escena.nodos.some((n) => n.id === "salon-fondo-arco"), "su decoración es el fondo de fotos");
  assert.ok(r.escena.nodos.some((n) => n.id === "salon-entrada-arco"));
});

prueba("planificar_evento sobre un salón ya armado no lo pisa", () => {
  const primero = herramienta(vacia(), "planificar_evento", { tipo_evento: "boda", invitados: 60 });
  assert.match(falla(primero.escena, "planificar_evento", { tipo_evento: "boda", invitados: 60 }), /ajustar_salon/);
});

// ---------------------------------------------------------------------------------------------------------------------
// Esquemas
// ---------------------------------------------------------------------------------------------------------------------

prueba("las 5 herramientas están declaradas para Gemini con esquemas chicos y sin enumeraciones largas", () => {
  const nombres = ["armar_salon", "ajustar_salon", "mover_zona", "quitar_zona", "planificar_evento"];
  for (const nombre of nombres) {
    const d = DECLARACIONES_ESCENA.find((x) => x.name === nombre);
    assert.ok(d, `${nombre} no está declarada`);
    const json = JSON.stringify(d.parametersJsonSchema);
    assert.ok(Buffer.byteLength(json) < 4500, `${nombre}: ${Buffer.byteLength(json)} B`);
    const enums: number[] = [];
    const recorrer = (n: unknown): void => {
      if (Array.isArray(n)) n.forEach(recorrer);
      else if (n && typeof n === "object") { const o = n as Record<string, unknown>; if (Array.isArray(o.enum)) enums.push(o.enum.length); Object.values(o).forEach(recorrer); }
    };
    recorrer(d.parametersJsonSchema);
    assert.ok(Math.max(0, ...enums) <= 20, `${nombre}: enumeración de ${Math.max(...enums)} valores`);
    assert.ok(d.description.length < 1200, `${nombre}: descripción de ${d.description.length}`);
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// Tipos de elemento
// ---------------------------------------------------------------------------------------------------------------------

prueba("cada elemento de la distribución usa un mueble real del catálogo, con ids únicos", () => {
  const d = distribuirSalon({ invitados: 120, mesa: "redonda10", zonas: TODAS });
  const ids = new Set<string>();
  d.elementos.forEach((e: ElementoSalon) => { assert.ok(!ids.has(e.id), `id repetido ${e.id}`); ids.add(e.id); assert.ok(e.id.startsWith("salon-")); });
  assert.ok(PASILLO_CM >= 90);
});

console.log(`\n${pruebas} pruebas pasaron`);
