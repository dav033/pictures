/**
 * Techo por zona (`techo-zona.ts`, `herramientas-escena-techo-zona.ts`). Sin coste: ninguna IA ni red.
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-techo-zona.ts
 * - festones, red, helio y tiras sobre un rectángulo en cm, sobre una pieza (una mesa) o en toda la sala: la pieza queda DENTRO de la
 *   sala y dentro del rectángulo, centrada en él, y con su hilo si cuelga;
 * - la densidad llena más o menos; el tamaño va de un grupito sobre una mesa a todo un salón;
 * - cuelga según el alto de la sala (pegada si es baja, al 72 % si es alta) o a la altura libre pedida;
 * - `reemplazar` rehace una ya puesta con el mismo id; errores claros (fuera de la sala, sin zona, zona de dos formas, muy chica, tope);
 * - los materiales salen de globos reales con los colores pedidos; el esquema cabe en Gemini y la escena pasa el esquema de la ruta.
 */
import assert from "node:assert/strict";
import { armarEscena, SALA_INICIAL, type Escena, type NodoEscena } from "../../src/lib/globos3d/escena";
import { aplicarHerramienta, DECLARACIONES_ESCENA, MAX_NODOS, type ResultadoHerramienta } from "../../src/lib/globos3d/herramientas-escena";
import { EscenaSchema } from "../../src/lib/globos3d/esquema-escena";
import { muebleDe } from "../../src/lib/globos3d/mobiliario-catalogo";
import { piezaDeMueble } from "../../src/lib/globos3d/mobiliario-pieza";
import { TIPOS_TECHO_ZONA } from "../../src/lib/globos3d/techo-zona";

let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };
const ok = (r: ResultadoHerramienta): Extract<ResultadoHerramienta, { ok: true }> => { if (!r.ok) assert.fail(`se esperaba éxito y vino error: ${r.error}`); return r; };
const error = (r: ResultadoHerramienta, contiene: RegExp): string => { if (r.ok) assert.fail(`se esperaba error y vino: ${r.resumen}`); assert.match(r.error, contiene); return r.error; };
const cerca = (real: number, esperado: number, tol: number, que: string) => assert.ok(Math.abs(real - esperado) <= tol, `${que}: ${real.toFixed(1)} (esperado ${esperado} ±${tol})`);

const salon = (alto = 600): Escena => ({ sala: { ...SALA_INICIAL, anchoCm: 1500, fondoCm: 1200, altoCm: alto }, nodos: [] });
const techo = (e: Escena, args: Record<string, unknown>) => aplicarHerramienta(e, "techo_por_zona", args);
const ultimo = (e: Escena): NodoEscena => e.nodos.at(-1)!;
const armado = (e: Escena, id: string) => armarEscena(e).porNodo.find((n) => n.id === id)!;
const globos = (e: Escena, id: string) => armado(e, id).materiales.reduce((s, m) => s + m.cantidad, 0);
const PISTA = { x_cm: 100, z_cm: -50, ancho_cm: 600, fondo_cm: 400 };
const mesaRedonda = (id: string, x: number, z: number): NodoEscena => ({ id, nombre: id, pieza: piezaDeMueble(muebleDe("mesa_redonda_mantel")!), colocacion: { en: "piso", xCm: x, zCm: z, giroGrados: 0 } });

prueba("cada tipo sobre la pista de baile: dentro de la zona, centrado y dentro de la sala", () => {
  for (const tipo of TIPOS_TECHO_ZONA) {
    const e = ok(techo(salon(), { tipo, zona: PISTA })).escena;
    const n = ultimo(e), c = armado(e, n.id).caja, s = e.sala;
    assert.equal(n.pieza.tipo, "techo");
    assert.ok(c.min.x >= PISTA.x_cm - PISTA.ancho_cm / 2 - 1 && c.max.x <= PISTA.x_cm + PISTA.ancho_cm / 2 + 1, `${tipo}: en x ${c.min.x.toFixed(0)}…${c.max.x.toFixed(0)}`);
    assert.ok(c.min.z >= PISTA.z_cm - PISTA.fondo_cm / 2 - 1 && c.max.z <= PISTA.z_cm + PISTA.fondo_cm / 2 + 1, `${tipo}: en z ${c.min.z.toFixed(0)}…${c.max.z.toFixed(0)}`);
    cerca((c.min.x + c.max.x) / 2, PISTA.x_cm, 0.12 * PISTA.ancho_cm, `${tipo}: centrado en x`);
    cerca((c.min.z + c.max.z) / 2, PISTA.z_cm, 0.12 * PISTA.fondo_cm, `${tipo}: centrado en z`);
    assert.ok(c.min.x >= -s.anchoCm / 2 && c.max.x <= s.anchoCm / 2 && c.min.z >= -s.fondoCm / 2 && c.max.z <= s.fondoCm / 2, `${tipo}: dentro de la sala`);
    assert.ok(c.min.y >= 0 && c.max.y <= s.altoCm + 0.5, `${tipo}: bajo el techo (${c.max.y.toFixed(0)} de ${s.altoCm})`);
    assert.ok(globos(e, n.id) > 0, `${tipo}: lleva globos`);
  }
});

prueba("por defecto son festones; el borde cubre la zona y cada tramo cuelga entre remates", () => {
  const e = ok(techo(salon(), { zona: PISTA })).escena;
  const n = ultimo(e);
  assert.equal(n.id, "techo-zona-festones");
  assert.ok(n.pieza.tipo === "techo" && n.pieza.techo.elementos.every((x) => x.tipo === "festones"));
  const c = armado(e, n.id).caja;
  assert.ok(c.max.x - c.min.x > 0.85 * PISTA.ancho_cm && c.max.z - c.min.z > 0.85 * PISTA.fondo_cm, "casi toda la zona");
});

prueba("sobre una pieza: cubre la mesa más su margen, en cualquier sitio de la sala", () => {
  const e0: Escena = { ...salon(320), nodos: [mesaRedonda("mesa-principal", -300, 200)] };
  const m = armado(e0, "mesa-principal").caja;
  for (const tipo of ["red", "festones", "helio"] as const) {
    const e = ok(techo(e0, { tipo, sobre_pieza: "mesa-principal", margen_cm: 60 })).escena;
    const c = armado(e, ultimo(e).id).caja;
    cerca((c.min.x + c.max.x) / 2, (m.min.x + m.max.x) / 2, 25, `${tipo}: centrado sobre la mesa en x`);
    cerca((c.min.z + c.max.z) / 2, (m.min.z + m.max.z) / 2, 25, `${tipo}: centrado sobre la mesa en z`);
    assert.ok(c.max.x - c.min.x >= (m.max.x - m.min.x) * 0.6, `${tipo}: del tamaño de la mesa`);
    assert.ok(c.max.x - c.min.x <= m.max.x - m.min.x + 125, `${tipo}: sin pasarse de mesa + margen`);
  }
  error(techo(e0, { sobre_pieza: "no-hay" }), /No hay ninguna pieza con id «no-hay»/);
});

prueba("de un grupito sobre una sola mesa a todo el salón: la misma herramienta", () => {
  const sala = salon();
  const grupito = ok(techo(sala, { tipo: "red", zona: { x_cm: 0, z_cm: 0, ancho_cm: 120, fondo_cm: 120 } })).escena;
  const todo = ok(techo(sala, { tipo: "red", toda_la_sala: true })).escena;
  assert.ok(globos(grupito, ultimo(grupito).id) < 40, `grupito de ${globos(grupito, ultimo(grupito).id)} globos`);
  assert.ok(globos(todo, ultimo(todo).id) > 1000);
  const c = armado(todo, ultimo(todo).id).caja;
  assert.ok(c.min.x >= -sala.sala.anchoCm / 2 + 20 && c.max.x <= sala.sala.anchoCm / 2 - 20, "toda la sala deja una holgura de las paredes");
  assert.ok(c.max.x - c.min.x > 0.85 * (sala.sala.anchoCm - 120), "y la cubre");
  const festones = ok(techo(sala, { toda_la_sala: true, margen_cm: 100 })).escena;
  const f = armado(festones, ultimo(festones).id).caja;
  assert.ok(f.min.x >= -sala.sala.anchoCm / 2 + 100 - 1 && f.max.z <= sala.sala.fondoCm / 2 - 100 + 1, "el margen se respeta");
  // un rincón de una sala chica (sala de estar de 5 × 4 m)
  const casa: Escena = { sala: { ...SALA_INICIAL, anchoCm: 500, fondoCm: 400, altoCm: 260 }, nodos: [] };
  const rincon = ok(techo(casa, { tipo: "helio", zona: { x_cm: 150, z_cm: -100, ancho_cm: 120, fondo_cm: 100 } })).escena;
  assert.ok(globos(rincon, ultimo(rincon).id) >= 2);
});

prueba("la densidad llena más: baja < media < alta en cada tipo", () => {
  for (const tipo of TIPOS_TECHO_ZONA) {
    const cuantos = (densidad: string) => { const e = ok(techo(salon(), { tipo, zona: PISTA, densidad })).escena; return globos(e, ultimo(e).id); };
    const [b, m, a] = [cuantos("baja"), cuantos("media"), cuantos("alta")];
    assert.ok(b < m && m < a, `${tipo}: ${b} < ${m} < ${a}`);
  }
});

prueba("cuelga según el alto de la sala: pegada si es baja, al 72 % si es alta, o a la altura libre pedida", () => {
  const baja = ok(techo(salon(320), { tipo: "helio", zona: PISTA })).escena;
  assert.equal((ultimo(baja).colocacion as { cuelgaCm: number }).cuelgaCm, 0);
  cerca(armado(baja, ultimo(baja).id).caja.max.y, 320, 1.5, "toca el techo de 3,2 m");
  for (const alto of [600, 900]) {
    const alta = ok(techo(salon(alto), { tipo: "festones", zona: PISTA })).escena;
    const c = armado(alta, ultimo(alta).id).caja;
    cerca(c.min.y, alto * 0.72, 2, `en una sala de ${alto} cm, el punto más bajo al 72 %`);
    assert.ok((ultimo(alta).colocacion as { cuelgaCm: number }).cuelgaCm > 0);
    assert.ok(armarEscena(alta).cilindros.length > 0, "con su hilo hasta el techo");
  }
  const libre = ok(techo(salon(600), { tipo: "red", zona: PISTA, altura_libre_cm: 300 })).escena;
  cerca(armado(libre, ultimo(libre).id).caja.min.y, 300, 2, "altura libre de 300 cm");
  const casa: Escena = { sala: { ...SALA_INICIAL, anchoCm: 500, fondoCm: 400, altoCm: 260 }, nodos: [] };
  assert.match(ok(techo(casa, { tipo: "festones", zona: { x_cm: 0, z_cm: 0, ancho_cm: 300, fondo_cm: 250 } })).resumen, /es bajo para pasar por debajo|punto más bajo a \d+ cm/);
});

prueba("los colores pedidos llegan a los globos y los materiales cuentan globos reales", () => {
  const e = ok(techo(salon(), { tipo: "red", zona: PISTA, colores: ["rosa", "azul"] })).escena;
  const codigos = new Set(armado(e, ultimo(e).id).materiales.map((m) => m.codigo));
  assert.equal(codigos.size, 2);
  assert.equal(armarEscena(e).materiales.reduce((s, m) => s + m.cantidad, 0), globos(e, ultimo(e).id));
  const cuatro = ok(techo(salon(), { tipo: "festones", zona: PISTA, colores: ["rosa", "azul", "blanco"] })).escena;
  assert.ok(new Set(armado(cuatro, ultimo(cuatro).id).materiales.map((m) => m.codigo)).size >= 3);
});

prueba("reemplazar rehace el techo con el mismo id (otra zona, tipo, densidad o colores) sin sumar piezas", () => {
  const a = ok(techo(salon(), { tipo: "red", zona: PISTA })).escena;
  const id = ultimo(a).id;
  const b = ok(techo(a, { reemplazar: id, tipo: "helio", zona: { x_cm: -300, z_cm: 200, ancho_cm: 200, fondo_cm: 200 }, densidad: "alta" })).escena;
  assert.equal(b.nodos.length, 1);
  assert.equal(b.nodos[0]!.id, id);
  assert.equal(b.nodos[0]!.pieza.tipo, "techo");
  assert.notDeepEqual(b.nodos[0]!.pieza, a.nodos[0]!.pieza);
  cerca((armado(b, id).caja.min.x + armado(b, id).caja.max.x) / 2, -300, 40, "en la zona nueva");
  error(techo(a, { reemplazar: "no-hay", zona: PISTA }), /no es un techo puesto con techo_por_zona/);
  const otra = { ...a, nodos: [...a.nodos, mesaRedonda("mesa", 0, 0)] };
  error(techo(otra, { reemplazar: "mesa", zona: PISTA }), /no es un techo puesto con techo_por_zona/);
});

prueba("una zona que se sale de la sala se recorta y se dice; una que cae fuera, error", () => {
  const e = salon();
  const r = ok(techo(e, { tipo: "red", zona: { x_cm: 700, z_cm: 0, ancho_cm: 400, fondo_cm: 300 } }));
  const c = armado(r.escena, ultimo(r.escena).id).caja;
  assert.ok(c.max.x <= e.sala.anchoCm / 2, "dentro de la sala");
  assert.match(r.resumen, /recorté la zona/);
  error(techo(e, { tipo: "red", zona: { x_cm: 2000, z_cm: 0, ancho_cm: 400, fondo_cm: 300 } }), /fuera de la sala/);
});

prueba("errores claros: sin zona, zona de dos formas, zona muy chica para festones, parámetros inválidos y tope de piezas", () => {
  error(techo(salon(), { tipo: "red" }), /UNA de estas formas/);
  error(techo(salon(), { zona: PISTA, toda_la_sala: true }), /UNA de estas formas/);
  error(techo(salon(), { tipo: "festones", zona: { x_cm: 0, z_cm: 0, ancho_cm: 80, fondo_cm: 300 } }), /al menos 100 cm/);
  error(techo(salon(), { tipo: "alfombra", zona: PISTA }), /Parámetros no válidos/);
  error(techo(salon(), { tipo: "helio", zona: { x_cm: 0, z_cm: 0, ancho_cm: 20, fondo_cm: 300 } }), /Parámetros no válidos/);
  const llena: Escena = { ...salon(), nodos: Array.from({ length: MAX_NODOS }, (_, i) => mesaRedonda(`m-${i}`, -700 + (i % 15) * 100, -500 + Math.floor(i / 15) * 100)) };
  error(techo(llena, { zona: PISTA }), new RegExp(`máximo ${MAX_NODOS}`));
  assert.equal(ok(techo(salon(240), { tipo: "red", zona: { x_cm: 0, z_cm: 0, ancho_cm: 200, fondo_cm: 200 }, altura_libre_cm: 1200 })).escena.nodos.length, 1);
});

prueba("el techo convive con los centros de mesa y con otro techo; ids distintos", () => {
  let e: Escena = { ...salon(), nodos: [mesaRedonda("mesa-1", -200, 0), mesaRedonda("mesa-2", 200, 0)] };
  e = ok(aplicarHerramienta(e, "decorar_mesas", { diseno: { tipo: "ramo_helio" } })).escena;
  e = ok(techo(e, { tipo: "festones", sobre_pieza: "mesa-1" })).escena;
  e = ok(techo(e, { tipo: "helio", sobre_pieza: "mesa-2" })).escena;
  assert.deepEqual(e.nodos.filter((n) => n.id.startsWith("techo-zona-")).map((n) => n.id), ["techo-zona-festones", "techo-zona-helio"]);
  assert.equal(armarEscena(e).avisos.length, 0);
});

prueba("el esquema de techo_por_zona cabe en Gemini y la escena resultante pasa el esquema de la ruta", () => {
  const d = DECLARACIONES_ESCENA.find((x) => x.name === "techo_por_zona");
  assert.ok(d, "falta techo_por_zona");
  const texto = JSON.stringify(d!.parametersJsonSchema);
  assert.ok(Buffer.byteLength(texto) <= 5 * 1024, `${Buffer.byteLength(texto)} B`);
  const visitar = (x: unknown): void => {
    if (Array.isArray(x)) { x.forEach(visitar); return; }
    if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) { if (k === "enum") assert.ok((v as unknown[]).length <= 20); visitar(v); }
  };
  visitar(d!.parametersJsonSchema);
  for (const tipo of TIPOS_TECHO_ZONA) {
    const e = ok(techo(salon(), { tipo, zona: PISTA })).escena;
    assert.ok(EscenaSchema.safeParse(JSON.parse(JSON.stringify(e))).success, `${tipo}: válida para la ruta`);
  }
});

console.log(`${pruebas} pruebas ok`);
