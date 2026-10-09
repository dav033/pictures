/**
 * Centros de mesa (`centros-mesa*.ts`, `herramientas-escena-centros.ts`). Sin coste: ninguna IA ni red.
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-centros-de-mesa.ts
 * - un centro por mesa, ENCIMA (su base en la cubierta, medida de la geometría de la mesa y no una constante) y centrado, en mesas
 *   redondas, imperiales, de cóctel y de postres, con mantel, con sillas o sin ellas, y con una altura de mesa distinta;
 * - lo de pie queda de pie (el ramo de helio, la burbuja de la biblioteca): sin la orientación de `sobre` quedaría acostado;
 * - mover o girar la mesa lleva su centro; los materiales cuentan N veces porque son N piezas reales;
 * - a todas, a unas (ids, grupo, principal, invitados), alternando dos diseños, cambiando todos a la vez (colores, alto, escala,
 *   diseño, ranura), quitando algunos o todos y completando solo las mesas nuevas;
 * - el tope de piezas (MAX_NODOS) se avisa antes de cambiar nada; se saltan las mesas que llevan algo encima (salvo forzar);
 * - el esquema de las herramientas cabe en lo que acepta Gemini y la escena resultante pasa el esquema de la ruta.
 */
import assert from "node:assert/strict";
import { armarEscena, SALA_INICIAL, type Escena, type NodoEscena } from "../../src/lib/globos3d/escena";
import { deslizarSobre } from "../../src/lib/globos3d/lienzo-escena";
import { centrosDe, esCentro, padreDeCentro, ranuraDe } from "../../src/lib/globos3d/centros-mesa";
import { buscarEnBiblioteca } from "../../src/lib/globos3d/herramientas-escena-biblioteca";
import { aplicarHerramienta, DECLARACIONES_ESCENA, MAX_NODOS, type ResultadoHerramienta } from "../../src/lib/globos3d/herramientas-escena";
import { muebleDe } from "../../src/lib/globos3d/mobiliario-catalogo";
import { piezaDeMueble } from "../../src/lib/globos3d/mobiliario-pieza";
import { EscenaSchema } from "../../src/lib/globos3d/esquema-escena";
import { REGLAS_AGENTE } from "../../src/lib/globos3d/escena-ia-agente";

let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };
const ok = (r: ResultadoHerramienta): Extract<ResultadoHerramienta, { ok: true }> => { if (!r.ok) assert.fail(`se esperaba éxito y vino error: ${r.error}`); return r; };
const error = (r: ResultadoHerramienta, contiene: RegExp): string => { if (r.ok) assert.fail(`se esperaba error y vino: ${r.resumen}`); assert.match(r.error, contiene); return r.error; };
const cerca = (real: number, esperado: number, tol: number, que: string) => assert.ok(Math.abs(real - esperado) <= tol, `${que}: ${real.toFixed(1)} (esperado ${esperado} ±${tol})`);

const SALA = { ...SALA_INICIAL, anchoCm: 1200, fondoCm: 1000, altoCm: 400 };
const vacia = (): Escena => ({ sala: { ...SALA }, nodos: [] });
const mesa = (e: Escena, id: string, x: number, z: number, extra: Record<string, unknown> = {}): Escena => ok(aplicarHerramienta(e, "agregar_mobiliario", { id, x_cm: x, z_cm: z, ...extra })).escena;
/** `diseno` (y `diseno_b`, el que alterna) se escriben como los pide la herramienta: `disenos: [A, B]`. */
const aDisenos = ({ diseno, diseno_b, ...resto }: Record<string, unknown>) => ({ disenos: [diseno, ...(diseno_b ? [diseno_b] : [])], ...resto });
const decorar = (e: Escena, args: Record<string, unknown>) => aplicarHerramienta(e, "decorar_mesas", aDisenos(args));
const nodo = (e: Escena, id: string): NodoEscena => e.nodos.find((n) => n.id === id) ?? assert.fail(`falta ${id}`);
const caja = (e: Escena, id: string) => armarEscena(e).porNodo.find((n) => n.id === id)!.caja;
const centroXZ = (c: ReturnType<typeof caja>) => ({ x: (c.min.x + c.max.x) / 2, z: (c.min.z + c.max.z) / 2 });
const idsCentros = (e: Escena) => centrosDe(e).map((c) => c.id);
const RAMO = { tipo: "ramo_helio", colores: ["blanco", "dorado"] };
const PEQUENO = { tipo: "racimo", colores: ["rosa", "blanco"] };

/** Lo alto de la cubierta de cada mueble con sus medidas de catálogo (cm): lo que dice el catálogo, no el código que lo mide. */
const CUBIERTA_CM: Readonly<Record<string, number>> = {
  mesa_redonda: 75, mesa_redonda_mantel: 75, mesa_redonda_sillas: 75, mesa_imperial: 75, mesa_imperial_mantel: 75, mesa_imperial_sillas: 75,
  mesa_coctel: 110, mesa_coctel_licra: 110, mesa_postres: 90, mesa_postres_mantel: 90,
};

prueba("un centro por mesa, encima y centrado, en cada tipo de mesa del catálogo (redonda, imperial, cóctel, postres; con mantel, con sillas o sin ellas)", () => {
  for (const [id, tope] of Object.entries(CUBIERTA_CM)) {
    let e = mesa(vacia(), id, -150, 0);
    e = mesa(e, id, 150, 0);
    const r = ok(decorar(e, { diseno: { tipo: "columna", alto_cm: 40, colores: ["rosa"] } }));
    assert.equal(centrosDe(r.escena).length, 2, id);
    for (const c of centrosDe(r.escena)) {
      const padre = padreDeCentro(c)!;
      const cc = caja(r.escena, c.id), mm = caja(r.escena, padre);
      cerca(cc.min.y, tope, 1.2, `${id}: la base del centro está en la cubierta`);
      assert.ok(cc.max.y > tope + 10, `${id}: el centro sube sobre la mesa`);
      cerca(centroXZ(cc).x, centroXZ(mm).x, 1.5, `${id}: centrado en x`);
      cerca(centroXZ(cc).z, centroXZ(mm).z, 1.5, `${id}: centrado en z`);
    }
  }
});

prueba("la altura sale de la geometría: una mesa con otra altura (cambiar_pieza) da otra cubierta", () => {
  let e = mesa(vacia(), "mesa_redonda_mantel", 0, 0, { alto_cm: 90 });
  e = ok(decorar(e, { diseno: PEQUENO })).escena;
  cerca(caja(e, "centro-mesa-redonda-mantel").min.y, 90, 1.2, "cubierta a 90 cm");
  const baja = ok(aplicarHerramienta(mesa(vacia(), "mesa_redonda", 0, 0, { alto_cm: 60 }), "decorar_mesas", { disenos: [PEQUENO] })).escena;
  cerca(caja(baja, "centro-mesa-redonda").min.y, 60, 1.2, "cubierta a 60 cm");
});

prueba("lo de pie queda de pie: el ramo de helio mide casi lo pedido de alto, la columna y la burbuja de la biblioteca también", () => {
  const e = mesa(vacia(), "mesa_redonda_mantel", 0, 0);
  const ramo = ok(decorar(e, { diseno: { tipo: "ramo_helio", alto_cm: 100 } })).escena;
  const a = caja(ramo, "centro-mesa-redonda-mantel");
  assert.ok(a.max.y - a.min.y >= 85, `ramo de ${(a.max.y - a.min.y).toFixed(0)} cm de alto (pedido 100)`);
  assert.ok(a.max.x - a.min.x < a.max.y - a.min.y, "más alto que ancho");
  const col = ok(decorar(e, { diseno: { tipo: "columna", alto_cm: 90 } })).escena;
  const c = caja(col, "centro-mesa-redonda-mantel");
  cerca(c.max.y - c.min.y, 90, 14, "columna de 90 cm");
  const item = buscarEnBiblioteca({ texto: "burbuja", tipo: "decoracion", limite: 8 }).find((i) => i.contenido.tipo === "pieza" && i.contenido.pieza.tipo === "decoracion" && i.contenido.pieza.decoracion.tipo === "burbuja");
  assert.ok(item, "hay una burbuja en la biblioteca");
  const bur = ok(decorar(e, { diseno: { tipo: "biblioteca", biblioteca_id: item!.id } })).escena;
  const b = caja(bur, "centro-mesa-redonda-mantel");
  cerca(b.min.y, 75, 1.5, "la burbuja apoya en la mesa");
  assert.ok(b.max.y - b.min.y > 20, "la burbuja se ve entera de pie");
  const flor = ok(decorar(e, { diseno: { tipo: "flores", colores: ["rosa", "blanco", "dorado"] } })).escena;
  assert.ok(armarEscena(flor).porNodo.find((n) => n.id === "centro-mesa-redonda-mantel")!.globos.length > 8);
});

prueba("el alto de cada diseño se respeta (ramo, racimo, columna)", () => {
  const e = mesa(vacia(), "mesa_redonda_mantel", 0, 0);
  for (const [tipo, alto] of [["ramo_helio", 110], ["columna", 120], ["racimo", 45]] as const) {
    const r = ok(decorar(e, { diseno: { tipo, alto_cm: alto } })).escena;
    const c = caja(r, "centro-mesa-redonda-mantel");
    cerca(c.max.y - c.min.y, alto, alto * 0.3, `${tipo} de ${alto} cm`);
  }
});

prueba("mover o girar la mesa lleva su centro (es una pieza sobre la mesa)", () => {
  let e = mesa(vacia(), "mesa_imperial_mantel", -200, -100);
  e = ok(decorar(e, { diseno: RAMO })).escena;
  const antes = centroXZ(caja(e, "centro-mesa-imperial-mantel"));
  e = ok(aplicarHerramienta(e, "mover_pieza", { id: "mesa-imperial-mantel", donde: { en: "piso", x_cm: 250, z_cm: 120 } })).escena;
  const despues = centroXZ(caja(e, "centro-mesa-imperial-mantel"));
  cerca(despues.x - antes.x, 450, 1.5, "se corrió 450 en x");
  cerca(despues.z - antes.z, 220, 1.5, "se corrió 220 en z");
  cerca(caja(e, "centro-mesa-imperial-mantel").min.y, 75, 1.2, "sigue en la cubierta");
  for (const giro of [90, 45, -30]) {
    const g = ok(aplicarHerramienta(e, "girar_pieza", { id: "mesa-imperial-mantel", grados: giro })).escena;
    const c = centroXZ(caja(g, "centro-mesa-imperial-mantel")), m = centroXZ(caja(g, "mesa-imperial-mantel"));
    cerca(c.x, m.x, 1.5, `girada ${giro}°: centrado en x`);
    cerca(c.z, m.z, 1.5, `girada ${giro}°: centrado en z`);
  }
});

prueba("una mesa girada 45° al decorar también queda centrada y apoyada", () => {
  const e = mesa(vacia(), "mesa_imperial_sillas", 100, 50, { giro_grados: 45 });
  const r = ok(decorar(e, { diseno: RAMO })).escena;
  const c = centroXZ(caja(r, "centro-mesa-imperial-sillas")), m = centroXZ(caja(r, "mesa-imperial-sillas"));
  cerca(c.x, m.x, 1.5, "x"); cerca(c.z, m.z, 1.5, "z");
  cerca(caja(r, "centro-mesa-imperial-sillas").min.y, 75, 1.2, "apoyado");
});

prueba("los materiales cuentan N veces: son N piezas reales, no una copia dibujada", () => {
  let e = vacia();
  for (let i = 0; i < 5; i++) e = mesa(e, "mesa_redonda_mantel", -400 + i * 200, 0);
  const uno = armarEscena(ok(decorar(mesa(vacia(), "mesa_redonda_mantel", 0, 0), { diseno: PEQUENO })).escena);
  const cinco = armarEscena(ok(decorar(e, { diseno: PEQUENO })).escena);
  const globos = (a: typeof uno) => a.materiales.reduce((s, m) => s + m.cantidad, 0);
  assert.ok(globos(uno) > 0);
  assert.equal(globos(cinco), 5 * globos(uno));
  for (const m of uno.materiales) assert.equal(cinco.materiales.find((x) => x.codigo === m.codigo && x.formatoId === m.formatoId)?.cantidad, 5 * m.cantidad, `${m.formatoId} ${m.codigo}`);
});

/** Una sala con una mesa principal al fondo, cuatro redondas de invitados, dos de cóctel y una de postres. */
function salon(): Escena {
  let e = vacia();
  e = mesa(e, "mesa_imperial_mantel", 0, -400);
  [-300, -100, 100, 300].forEach((x, i) => { e = mesa(e, "mesa_redonda_sillas", x, i < 2 ? -100 : 150); });
  e = mesa(e, "mesa_coctel", -450, 350); e = mesa(e, "mesa_coctel", 450, 350);
  e = mesa(e, "mesa_postres", 0, 430);
  return e;
}

prueba("grupos: principal, invitados, redondas, imperiales, coctel, postres; ids; y ids con grupo", () => {
  const e = salon();
  const quedan = (args: Record<string, unknown>) => idsCentros(ok(decorar(e, { diseno: { tipo: "columna", alto_cm: 30 }, ...args })).escena).map((c) => c.replace(/^centro-/, ""));
  assert.deepEqual(quedan({ grupo: "principal" }), ["mesa-imperial-mantel"]);
  assert.equal(quedan({ grupo: "invitados" }).length, 4);
  assert.ok(quedan({ grupo: "invitados" }).every((id) => id.startsWith("mesa-redonda-sillas")));
  assert.equal(quedan({ grupo: "redondas" }).length, 4);
  assert.equal(quedan({ grupo: "imperiales" }).length, 1);
  assert.equal(quedan({ grupo: "coctel" }).length, 2);
  assert.deepEqual(quedan({ grupo: "postres" }), ["mesa-postres"]);
  assert.equal(quedan({}).length, 8);
  assert.deepEqual(quedan({ mesas: ["mesa-redonda-sillas", "mesa-coctel"] }), ["mesa-redonda-sillas", "mesa-coctel"]);
  assert.deepEqual(quedan({ mesas: ["mesa-redonda-sillas", "mesa-coctel"], grupo: "coctel" }), ["mesa-coctel"]);
  error(decorar(e, { diseno: RAMO, mesas: ["no-existe"] }), /No son mesas de la escena: no-existe/);
  error(decorar(vacia(), { diseno: RAMO }), /No hay mesas en la escena/);
  error(decorar(mesa(vacia(), "mesa_redonda_mantel", 0, 0), { diseno: RAMO, grupo: "postres" }), /Ninguna mesa cumple/);
});

prueba("la mesa principal se reconoce por su nombre antes que por su sitio", () => {
  let e = salon();
  e = ok(aplicarHerramienta(e, "cambiar_pieza", { id: "mesa-redonda-sillas-2", nombre: "Mesa de honor" })).escena;
  const r = ok(decorar(e, { diseno: { tipo: "columna", alto_cm: 30 }, grupo: "principal" }));
  assert.deepEqual(idsCentros(r.escena), ["centro-mesa-redonda-sillas-2"]);
});

prueba("sirve para una sola mesa, para tres de una sala y para treinta y cinco", () => {
  const una = ok(decorar(mesa(vacia(), "mesa_postres_mantel", 0, 0), { diseno: { tipo: "columna", alto_cm: 30 } }));
  assert.equal(centrosDe(una.escena).length, 1);
  let tres = vacia();
  tres = mesa(tres, "mesa_centro", -150, 0); tres = mesa(tres, "mesa_redonda", 100, 0); tres = mesa(tres, "mesa_imperial", 0, 200);
  assert.equal(centrosDe(ok(decorar(tres, { diseno: { tipo: "flores" } })).escena).length, 3);
  let sala: Escena = { sala: { ...SALA, anchoCm: 2600, fondoCm: 2400 }, nodos: [] };
  for (let i = 0; i < 35; i++) sala = { ...sala, nodos: [...sala.nodos, { id: `mesa-${i + 1}`, nombre: `Mesa ${i + 1}`, pieza: piezaDeMueble(muebleDe("mesa_redonda_mantel")!), colocacion: { en: "piso", xCm: -1100 + (i % 7) * 360, zCm: -900 + Math.floor(i / 7) * 330, giroGrados: 0 } }] };
  const grande = ok(decorar(sala, { diseno: RAMO }));
  assert.equal(centrosDe(grande.escena).length, 35);
  assert.equal(grande.escena.nodos.length, 70);
});

prueba("alternar dos diseños: en una fila A, B, A, B; en una cuadrícula, como un tablero (ninguna igual a su vecina)", () => {
  let fila = vacia();
  for (let i = 0; i < 4; i++) fila = mesa(fila, "mesa_redonda_mantel", -330 + i * 220, 0);
  const r = ok(decorar(fila, { diseno: RAMO, diseno_b: { tipo: "columna", alto_cm: 50, colores: ["rosa"] } })).escena;
  const porX = centrosDe(r).sort((a, b) => centroXZ(caja(r, a.id)).x - centroXZ(caja(r, b.id)).x);
  assert.deepEqual(porX.map(ranuraDe), [0, 1, 0, 1]);
  assert.notDeepEqual(porX[0]!.pieza, porX[1]!.pieza);
  assert.deepEqual(porX[0]!.pieza, porX[2]!.pieza, "las A son iguales entre sí");
  assert.deepEqual(porX[1]!.pieza, porX[3]!.pieza, "las B son iguales entre sí");
  assert.ok(porX[1]!.id.startsWith("centro2-"));
  let cuadricula = vacia();
  for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) cuadricula = mesa(cuadricula, "mesa_redonda_mantel", -300 + i * 300, -300 + j * 300);
  const c = ok(decorar(cuadricula, { diseno: RAMO, diseno_b: PEQUENO })).escena;
  const rejilla = new Map(centrosDe(c).map((n) => { const p = centroXZ(caja(c, n.id)); return [`${Math.round((p.x + 300) / 300)},${Math.round((p.z + 300) / 300)}`, ranuraDe(n)]; }));
  for (const [clave, ranura] of rejilla) {
    const [i, j] = clave.split(",").map(Number) as [number, number];
    for (const vecino of [`${i + 1},${j}`, `${i},${j + 1}`]) if (rejilla.has(vecino)) assert.notEqual(rejilla.get(vecino), ranura, `${clave} y ${vecino}`);
  }
});

prueba("cambiar_centros: colores, alto, escala, ranura y diseño nuevo, todos a la vez e iguales", () => {
  let e = vacia();
  for (let i = 0; i < 4; i++) e = mesa(e, "mesa_redonda_mantel", -330 + i * 220, 0);
  e = ok(decorar(e, { diseno: { tipo: "ramo_helio", alto_cm: 60 } })).escena;
  const recoloreado = ok(aplicarHerramienta(e, "cambiar_centros", { colores: ["azul", "plata"] })).escena;
  const antesCodigos = JSON.stringify(centrosDe(e)[0]!.pieza), despuesCodigos = JSON.stringify(centrosDe(recoloreado)[0]!.pieza);
  assert.notEqual(antesCodigos, despuesCodigos, "cambiaron los colores");
  for (const c of centrosDe(recoloreado)) assert.deepEqual(c.pieza, centrosDe(recoloreado)[0]!.pieza, "todos iguales");
  const mat = (en: Escena) => armarEscena(en).porNodo.find((n) => n.id === "centro-mesa-redonda-mantel")!.materiales.map((m) => m.codigo).sort().join();
  assert.notEqual(mat(e), mat(recoloreado));
  const alto = ok(aplicarHerramienta(e, "cambiar_centros", { alto_cm: 120 })).escena;
  for (const c of centrosDe(alto)) { const cc = caja(alto, c.id); cerca(cc.max.y - cc.min.y, 120, 20, "alto 120"); cerca(cc.min.y, 75, 1.2, "sigue apoyado"); }
  const doble = ok(aplicarHerramienta(e, "cambiar_centros", { escala: 1.5 })).escena;
  const a0 = caja(e, "centro-mesa-redonda-mantel"), a1 = caja(doble, "centro-mesa-redonda-mantel");
  cerca((a1.max.y - a1.min.y) / (a0.max.y - a0.min.y), 1.5, 0.2, "1,5 veces más alto");
  const otro = ok(aplicarHerramienta(e, "cambiar_centros", { diseno: { tipo: "columna", alto_cm: 70, colores: ["rosa"] } })).escena;
  assert.ok(centrosDe(otro).every((c) => c.pieza.tipo === "columna"));
  assert.deepEqual(centrosDe(otro).map((c) => c.id), centrosDe(e).map((c) => c.id), "mismos ids");
  error(aplicarHerramienta(e, "cambiar_centros", { alto_cm: 80, escala: 2 }), /alto_cm o escala/);
  error(aplicarHerramienta(vacia(), "cambiar_centros", { escala: 1.2 }), /No hay mesas/);
});

prueba("cambiar_centros por mesas, por grupo y por ranura; con dos diseños pide la ranura si cambia el diseño", () => {
  let e = salon();
  e = ok(decorar(e, { diseno: RAMO, diseno_b: PEQUENO, grupo: "invitados" })).escena;
  const soloA = ok(aplicarHerramienta(e, "cambiar_centros", { ranura: "a", colores: ["verde", "blanco"] })).escena;
  for (const c of centrosDe(soloA)) {
    const antes = nodo(e, c.id);
    if (ranuraDe(c) === 0) assert.notDeepEqual(c.pieza, antes.pieza); else assert.deepEqual(c.pieza, antes.pieza);
  }
  const unaMesa = ok(aplicarHerramienta(e, "cambiar_centros", { mesas: ["mesa-redonda-sillas"], escala: 1.3 })).escena;
  const cambiados = centrosDe(unaMesa).filter((c) => JSON.stringify(c.pieza) !== JSON.stringify(nodo(e, c.id).pieza));
  assert.deepEqual(cambiados.map((c) => c.id), ["centro-mesa-redonda-sillas"]);
  error(aplicarHerramienta(e, "cambiar_centros", { diseno: { tipo: "columna" } }), /indica ranura a o b/);
  assert.ok(ok(aplicarHerramienta(e, "cambiar_centros", { ranura: "b", diseno: { tipo: "columna", alto_cm: 40 } })).escena.nodos.some((n) => esCentro(n) && ranuraDe(n) === 1 && n.pieza.tipo === "columna"));
  error(aplicarHerramienta(mesa(vacia(), "mesa_redonda_mantel", 0, 0), "cambiar_centros", { escala: 1.2 }), /No hay centros de mesa que cambiar/);
});

prueba("una flor no cambia de alto: error claro; sin cambios, vuelve a apoyar los centros tras cambiar la mesa", () => {
  let e = ok(decorar(mesa(vacia(), "mesa_redonda_mantel", 0, 0), { diseno: { tipo: "flores" } })).escena;
  error(aplicarHerramienta(e, "cambiar_centros", { alto_cm: 80 }), /no cambia de alto/);
  e = ok(decorar(mesa(vacia(), "mesa_redonda_mantel", 0, 0), { diseno: RAMO })).escena;
  e = ok(aplicarHerramienta(e, "cambiar_pieza", { id: "mesa-redonda-mantel", alto_cm: 95, ancho_cm: 250 })).escena;
  const r = ok(aplicarHerramienta(e, "cambiar_centros", {}));
  const c = caja(r.escena, "centro-mesa-redonda-mantel"), m = caja(r.escena, "mesa-redonda-mantel");
  cerca(c.min.y, 95, 1.2, "en la cubierta nueva");
  cerca(centroXZ(c).x, centroXZ(m).x, 1.5, "centrado");
});

prueba("quitar_centros: todos, de unas mesas, de un grupo o de una ranura; las mesas no se tocan", () => {
  let e = salon();
  const mesas = e.nodos.length;
  e = ok(decorar(e, { diseno: { tipo: "columna", alto_cm: 40 }, diseno_b: PEQUENO })).escena;
  assert.equal(centrosDe(e).length, 8);
  const sinB = ok(aplicarHerramienta(e, "quitar_centros", { ranura: "b" })).escena;
  assert.ok(centrosDe(sinB).length > 0 && centrosDe(sinB).every((c) => ranuraDe(c) === 0));
  const sinCoctel = ok(aplicarHerramienta(e, "quitar_centros", { grupo: "coctel" })).escena;
  assert.equal(centrosDe(sinCoctel).length, centrosDe(e).length - 2);
  const sinUna = ok(aplicarHerramienta(e, "quitar_centros", { mesas: ["mesa-postres"] })).escena;
  assert.ok(!centrosDe(sinUna).some((c) => padreDeCentro(c) === "mesa-postres"));
  assert.equal(centrosDe(sinUna).length, 7);
  const nada = ok(aplicarHerramienta(e, "quitar_centros", {})).escena;
  assert.equal(nada.nodos.length, mesas);
  assert.deepEqual(nada.nodos, e.nodos.filter((n) => !esCentro(n)), "las mesas quedan intactas");
  error(aplicarHerramienta(nada, "quitar_centros", {}), /No hay centros de mesa que quitar/);
});

prueba("completar_centros: solo las mesas nuevas reciben el mismo centro y no se toca lo que ya había", () => {
  let e = vacia();
  for (let i = 0; i < 3; i++) e = mesa(e, "mesa_redonda_mantel", -300 + i * 300, 0);
  e = ok(decorar(e, { diseno: RAMO })).escena;
  error(aplicarHerramienta(mesa(vacia(), "mesa_redonda_mantel", 0, 0), "completar_centros", {}), /Todavía no hay centros/);
  assert.match(ok(aplicarHerramienta(e, "completar_centros", {})).resumen, /ya tienen su centro/);
  const antes = centrosDe(e);
  e = mesa(e, "mesa_redonda_mantel", 300, 300); e = mesa(e, "mesa_imperial_mantel", -300, 300);
  const r = ok(aplicarHerramienta(e, "completar_centros", {}));
  assert.equal(centrosDe(r.escena).length, 5);
  for (const c of antes) assert.deepEqual(nodo(r.escena, c.id), c, "los viejos no cambian");
  assert.deepEqual(centrosDe(r.escena).slice(3).map((c) => c.pieza), [antes[0]!.pieza, antes[0]!.pieza]);
  const nueva = nodo(r.escena, "centro-mesa-redonda-mantel-4");
  cerca(caja(r.escena, nueva.id).min.y, 75, 1.2, "apoyada");
  assert.match(r.resumen, /mesa-redonda-mantel-4/);
});

prueba("completar_centros con dos diseños sigue el tablero y se puede limitar a unas mesas", () => {
  let e = vacia();
  for (let i = 0; i < 2; i++) e = mesa(e, "mesa_redonda_mantel", -330 + i * 220, 0);
  e = ok(decorar(e, { diseno: RAMO, diseno_b: PEQUENO })).escena;
  e = mesa(e, "mesa_redonda_mantel", 110, 0); e = mesa(e, "mesa_redonda_mantel", 330, 0);
  const r = ok(aplicarHerramienta(e, "completar_centros", {})).escena;
  const porX = centrosDe(r).sort((a, b) => centroXZ(caja(r, a.id)).x - centroXZ(caja(r, b.id)).x);
  assert.deepEqual(porX.map(ranuraDe), [0, 1, 0, 1]);
  const una = ok(aplicarHerramienta(e, "completar_centros", { mesas: ["mesa-redonda-mantel-3"] })).escena;
  assert.equal(centrosDe(una).length, 3);
});

prueba("el tope de piezas se avisa ANTES de cambiar nada, con cuántas caben", () => {
  const nodosDe = (n: number): NodoEscena[] => Array.from({ length: n }, (_, i) => ({ id: `mesa-${i + 1}`, nombre: `Mesa ${i + 1}`, pieza: piezaDeMueble(muebleDe("mesa_redonda_mantel")!), colocacion: { en: "piso" as const, xCm: -1400 + (i % 10) * 300, zCm: -1000 + Math.floor(i / 10) * 300, giroGrados: 0 } }));
  const grande: Escena = { sala: { ...SALA, anchoCm: 3200, fondoCm: 3200 }, nodos: nodosDe(80) };
  const msg = error(decorar(grande, { diseno: RAMO }), /necesita 80 piezas más/);
  assert.match(msg, new RegExp(`máximo ${MAX_NODOS}`));
  assert.match(msg, /caben 70, faltan 10/);
  assert.match(msg, /menos mesas/);
  const justo = ok(decorar(grande, { diseno: PEQUENO, mesas: grande.nodos.slice(0, 70).map((n) => n.id) }));
  assert.equal(justo.escena.nodos.length, MAX_NODOS);
  error(aplicarHerramienta(justo.escena, "completar_centros", {}), /necesita 10 piezas más/);
  // Reemplazar los centros que ya hay no suma piezas: con la escena llena sigue funcionando.
  assert.equal(ok(decorar(justo.escena, { diseno: RAMO, mesas: grande.nodos.slice(0, 70).map((n) => n.id) })).escena.nodos.length, MAX_NODOS);
});

prueba("se saltan las mesas que llevan algo encima (un pastel, regalos) salvo con forzar, y las que el centro no cabe", () => {
  let e = mesa(vacia(), "mesa_redonda_mantel", -300, 0);
  e = mesa(e, "base_pastel", 0, 0);
  const pastel = e.nodos.find((n) => n.id.startsWith("base-pastel"))!;
  assert.equal(pastel.colocacion.en, "libre", "el pastel quedó sobre la mesa");
  e = mesa(e, "mesa_imperial_mantel", 300, 0);
  e = mesa(e, "mesa_regalos", 0, 300);
  e = mesa(e, "mesa_coctel", -300, 300);
  const r = ok(decorar(e, { diseno: RAMO }));
  assert.deepEqual(idsCentros(r.escena), ["centro-mesa-imperial-mantel"]);
  assert.match(r.resumen, /mesa-redonda-mantel: lleva «[^»]*pastel/i);
  assert.match(r.resumen, /mesa-regalos: ya trae cosas encima/);
  assert.match(r.resumen, /mesa-coctel: no cabe/);
  const forzada = ok(decorar(e, { diseno: PEQUENO, forzar: true })).escena;
  assert.ok(idsCentros(forzada).includes("centro-mesa-redonda-mantel") && idsCentros(forzada).includes("centro-mesa-regalos"));
  error(decorar(mesa(mesa(vacia(), "mesa_regalos", 0, 0), "mesa_regalos", 300, 0), { diseno: RAMO }), /llevan algo encima/);
  error(decorar(mesa(vacia(), "mesa_coctel", 0, 0), { diseno: RAMO }), /No se pudo poner ningún centro: .*no cabe/);
});

prueba("decorar otra vez reemplaza los centros (mismo número de piezas) y la cuenta de piezas sube solo por las mesas que no tenían", () => {
  let e = vacia();
  for (let i = 0; i < 3; i++) e = mesa(e, "mesa_redonda_mantel", -300 + i * 300, 0);
  const a = ok(decorar(e, { diseno: RAMO })).escena;
  const b = ok(decorar(a, { diseno: { tipo: "columna", alto_cm: 50 } }));
  assert.equal(b.escena.nodos.length, a.nodos.length);
  assert.ok(centrosDe(b.escena).every((c) => c.pieza.tipo === "columna"));
  assert.match(b.resumen, /Reemplacé 3 centros/);
});

prueba("diseños: la biblioteca (pieza), un conjunto (solo su base) y una escena entera (error); colores en la biblioteca", () => {
  const e = mesa(vacia(), "mesa_redonda_mantel", 0, 0);
  const escena = buscarEnBiblioteca({ tipo: "escena", limite: 1 })[0];
  assert.ok(escena);
  error(decorar(e, { diseno: { tipo: "biblioteca", biblioteca_id: escena!.id } }), /escena entera/);
  error(decorar(e, { diseno: { tipo: "biblioteca", biblioteca_id: "no-existe" } }), /No hay ningún item/);
  error(decorar(e, { diseno: { tipo: "biblioteca" } }), /necesita biblioteca_id/);
  error(decorar(e, { diseno: { tipo: "ramo_helio", alto_cm: 20 } as never }), /fuera de rango/);
  const item = buscarEnBiblioteca({ texto: "burbuja", tipo: "decoracion", limite: 8 }).find((i) => i.contenido.tipo === "pieza");
  const conjuntos = buscarEnBiblioteca({ tipo: "conjunto", limite: 8 }).map((i) => decorar(e, { diseno: { tipo: "biblioteca", biblioteca_id: i.id } }));
  assert.ok(conjuntos.some((r) => r.ok && /es un conjunto: tomé solo su pieza principal/.test(r.resumen)), "un conjunto chico entra con su pieza principal y lo dice");
  assert.ok(conjuntos.some((r) => !r.ok && /no cabe: mide \d+ cm/.test(r.error)), "un conjunto grande (un par de columnas) no cabe y lo dice");
  const conColor = ok(decorar(e, { diseno: { tipo: "biblioteca", biblioteca_id: item!.id, colores: ["rosa"] } }));
  assert.ok(centrosDe(conColor.escena).length === 1);
});

prueba("las herramientas están registradas, su esquema cabe en Gemini (pequeño, enumeraciones cortas) y la escena resultante pasa el esquema de la ruta", () => {
  const nombres = ["decorar_mesas", "completar_centros", "cambiar_centros", "quitar_centros"];
  let total = 0;
  for (const n of nombres) {
    const d = DECLARACIONES_ESCENA.find((x) => x.name === n);
    assert.ok(d, `falta ${n}`);
    const texto = JSON.stringify(d!.parametersJsonSchema);
    total += Buffer.byteLength(texto) + Buffer.byteLength(d!.description);
    assert.ok(Buffer.byteLength(texto) <= 5 * 1024, `${n}: ${Buffer.byteLength(texto)} B`);
    const visitar = (x: unknown): void => {
      if (Array.isArray(x)) { x.forEach(visitar); return; }
      if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) { if (k === "enum") assert.ok((v as unknown[]).length <= 20, `${n}: enum de ${(v as unknown[]).length}`); visitar(v); }
    };
    visitar(d!.parametersJsonSchema);
  }
  assert.ok(total <= 9 * 1024, `las 4 pesan ${total} B`);
  for (const n of [...nombres, "techo_por_zona"]) assert.ok(REGLAS_AGENTE.includes(n), `las reglas de la IA mencionan ${n}`);
  let e = ok(decorar(salon(), { diseno: RAMO, diseno_b: PEQUENO })).escena;
  e = ok(aplicarHerramienta(e, "cambiar_centros", { escala: 1.1 })).escena;
  assert.ok(EscenaSchema.safeParse(JSON.parse(JSON.stringify(e))).success, "la escena con centros es válida para la ruta");
  assert.ok(armarEscena(e).avisos.length === 0, "nada se arma con aviso");
});

prueba("`encima` se guarda en la colocación y pasa el esquema de la ruta sin perderse (la orientación de lo demás no cambia)", () => {
  let e = mesa(vacia(), "mesa_redonda_mantel", 0, 0);
  e = ok(decorar(e, { diseno: RAMO })).escena;
  const centro = nodo(e, "centro-mesa-redonda-mantel");
  assert.ok(centro.colocacion.en === "sobre" && centro.colocacion.encima === true);
  const vuelta = EscenaSchema.parse(JSON.parse(JSON.stringify(e)));
  assert.deepEqual(vuelta.nodos.map((n) => n.colocacion), e.nodos.map((n) => n.colocacion), "ningún campo se pierde al validar");
  // Sin `encima` el mismo ramo se arma como siempre (acostado en su espacio): la regla nueva no es global.
  const sin: Escena = { ...e, nodos: e.nodos.map((n) => (n.id === centro.id && n.colocacion.en === "sobre" ? { ...n, colocacion: { ...n.colocacion, encima: undefined } } : n)) };
  const a = caja(e, centro.id), b = caja(sin, centro.id);
  assert.ok(a.max.y - a.min.y > b.max.y - b.min.y + 10, `con encima ${(a.max.y - a.min.y).toFixed(0)} cm de alto, sin él ${(b.max.y - b.min.y).toFixed(0)}`);
});

prueba("las flechas (deslizarSobre) no sacan el centro de su mesa: se queda en la cubierta, a la altura de siempre", () => {
  let e = mesa(vacia(), "mesa_redonda_mantel", 0, 0);
  e = ok(decorar(e, { diseno: { tipo: "columna", alto_cm: 40 } })).escena;
  const id = "centro-mesa-redonda-mantel";
  const tope = caja(e, "mesa-redonda-mantel");
  for (const delta of [{ x: 10, y: 0, z: 0 }, { x: 0, y: 0, z: -10 }, { x: -10, y: 0, z: 10 }]) {
    let actual = e;
    for (let i = 0; i < 30; i++) actual = deslizarSobre(actual, armarEscena(actual), id, delta);
    const c = caja(actual, id);
    assert.ok(c.min.x >= tope.min.x - 0.5 && c.max.x <= tope.max.x + 0.5 && c.min.z >= tope.min.z - 0.5 && c.max.z <= tope.max.z + 0.5, `dentro de la mesa tras 30 pasos de ${JSON.stringify(delta)}`);
    cerca(c.min.y, 75, 1.2, "sigue apoyado en la cubierta");
    assert.notDeepEqual(nodo(actual, id).colocacion, nodo(e, id).colocacion, "sí se movió");
  }
  const girada = ok(aplicarHerramienta(e, "girar_pieza", { id: "mesa-redonda-mantel", grados: 90 })).escena;
  let actual = girada;
  for (let i = 0; i < 30; i++) actual = deslizarSobre(actual, armarEscena(actual), id, { x: 10, y: 0, z: 0 });
  const c = caja(actual, id), t = caja(actual, "mesa-redonda-mantel");
  assert.ok(c.max.x <= t.max.x + 0.5, "también con la mesa girada");
});

prueba("principal e invitados: si la principal se supone por su sitio, el resultado lo dice; si se llama así, no", () => {
  const supuesta = ok(decorar(salon(), { diseno: { tipo: "columna", alto_cm: 30 }, grupo: "principal" }));
  assert.match(supuesta.resumen, /Ninguna mesa se llama «principal»: tomé como principal «[^»]+» \(mesa-imperial-mantel\)/);
  assert.match(ok(decorar(salon(), { diseno: { tipo: "columna", alto_cm: 30 }, grupo: "invitados" })).resumen, /tomé como principal/);
  assert.match(ok(aplicarHerramienta(ok(decorar(salon(), { diseno: { tipo: "columna", alto_cm: 30 } })).escena, "quitar_centros", { grupo: "principal" })).resumen, /tomé como principal/);
  const nombrada = ok(aplicarHerramienta(salon(), "cambiar_pieza", { id: "mesa-imperial-mantel", nombre: "Mesa de los novios" })).escena;
  assert.doesNotMatch(ok(decorar(nombrada, { diseno: { tipo: "columna", alto_cm: 30 }, grupo: "principal" })).resumen, /tomé como principal/);
});

console.log(`${pruebas} pruebas ok`);
