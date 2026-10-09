/**
 * Criterio de aceptación de una ronda de refinado (REQ-001 paso 9, P-016). Sin red ni coste (los embeddings y la captura son de mentira):
 * - estructura: una pieza que colgaba de la pared y baja al piso, una pieza que queda tapada por los globos de otra más
 *   cercana a la cámara y un total de globos que cae más de 30 % rechazan la ronda; lo que ya estaba tapado antes y las
 *   escenas de las fotos de referencia sin cambios no;
 * - similitud: se acepta solo si la captura de después se parece a la foto al menos `MARGEN_MEJORA` más que la de antes;
 * - el evaluador (estructura primero, luego captura + embeddings; si algo falla, se rechaza);
 * - el bucle: una ronda rechazada no se aplica (ni `alRonda` ni deshacer) y dice «La comparación no mejoró; dejé la versión anterior»;
 * - la ruta `/api/escena-ia/similitud` con dependencias inyectadas: sesión, formato, tope por hora, coseno, fallo del embedding.
 *
 * Run: npx tsx --conditions=react-server scripts/test/test-aceptacion-refinado.ts
 */
import assert from "node:assert/strict";
import { crearEvaluadorDeRonda, pedirSimilitudHttp } from "@/lib/globos3d/aceptacion-ronda";
import { MARGEN_MEJORA, coseno, decidirAceptacion, piezasOcultas, piezasQueBajaron, revisarEstructura, type Rechazo, type Similitud } from "@/lib/globos3d/aceptacion-refinado";
import { compilarLectura } from "@/lib/globos3d/compilar-lectura";
import { encuadreDeLectura } from "@/lib/globos3d/encuadre-foto";
import type { Escena } from "@/lib/globos3d/escena";
import { camaraNumerica, proyectar } from "@/lib/globos3d/proyeccion-foto";
import { refinarConFoto, resumenDeRefinado, type DependenciasRefinado, type RespuestaRonda } from "@/lib/globos3d/refinar-foto-cliente";
import type { ResultadoRonda } from "@/lib/globos3d/refinado-ronda";
import { REFERENCIAS_DUENO } from "@/lib/globos3d/referencias-dueno";
import { atenderSimilitud, origenCoincideConHost, type DependenciasSimilitud } from "@/lib/globos3d/similitud-refinado";

let pruebas = 0;
const prueba = async (nombre: string, fn: () => void | Promise<void>) => { await fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };

const lectura7 = REFERENCIAS_DUENO.find((r) => r.numero === 7)!.lectura;
const encuadre = encuadreDeLectura(lectura7);
const escena7 = compilarLectura(lectura7).escena;
/** La escena de la foto 07 con el «LOVE» (pieza `libre`) puesto donde se pide. */
const conLove = (e: Escena, x: number, y: number, z: number): Escena => ({
  ...e, nodos: e.nodos.map((n) => (n.id === "metalizado" && n.colocacion.en === "libre" ? { ...n, colocacion: { ...n.colocacion, xCm: x, yCm: y, zCm: z } } : n)),
});

async function main() {
console.log("Cámara de la foto sin three.js");
await prueba("el centro de la imagen cae en el centro del cuadro y la altura de la foto llena el alto", () => {
  const camara = camaraNumerica(encuadre, escena7.sala);
  const plano = -escena7.sala.fondoCm / 2 + 40;
  const centro = proyectar(camara, { x: 0, y: encuadre.centroYCm, z: plano })!;
  assert.ok(Math.abs(centro.x) < 1e-9 && Math.abs(centro.y) < 1e-9);
  const arriba = proyectar(camara, { x: 0, y: encuadre.centroYCm + encuadre.altoCm / 2, z: plano })!;
  assert.ok(Math.abs(arriba.y - 1) < 1e-9, `el borde de arriba cae en y = ${arriba.y}`);
  assert.equal(proyectar(camara, { x: 0, y: 0, z: camara.z + 10 }), null, "detrás de la cámara no se ve");
});

console.log("Estructura");
await prueba("las escenas de las fotos de referencia, sin cambios, no tienen nada que reprochar", () => {
  for (const n of [4, 7, 9, 12, 13]) {
    const l = REFERENCIAS_DUENO.find((r) => r.numero === n)!.lectura;
    const e = compilarLectura(l).escena;
    assert.equal(piezasOcultas(e, encuadreDeLectura(l)).size, 0, `foto ${n}: nada tapado de entrada`);
    assert.equal(revisarEstructura(e, e, encuadreDeLectura(l)), null, `foto ${n}`);
  }
});
await prueba("el «LOVE» que colgaba a 114 cm y baja a 5 cm rechaza la ronda; subirlo o bajarlo poco no", () => {
  assert.equal(piezasQueBajaron(escena7, conLove(escena7, -30, 5, -190)).length, 1);
  const r = revisarEstructura(escena7, conLove(escena7, -30, 5, -190), encuadre);
  assert.equal(r?.motivo, "pieza_baja");
  assert.match(r?.detalle ?? "", /114 cm a 5 cm/);
  assert.equal(revisarEstructura(escena7, conLove(escena7, -30, 150, -190), encuadre), null, "subirlo está bien");
  assert.equal(revisarEstructura(escena7, conLove(escena7, -30, 60, -190), encuadre), null, "bajarlo a 60 cm no es caerse al piso");
});
await prueba("una pieza que ya estaba a menos de 40 cm no cuenta como caída", () => {
  const baja = conLove(escena7, -30, 30, -190);
  assert.equal(revisarEstructura(baja, conLove(escena7, -30, 5, -190), encuadre), null);
});
await prueba("el «LOVE» detrás de los globos de la guirnalda queda tapado y rechaza la ronda", () => {
  const tapado = conLove(escena7, -20, 200, -245);
  assert.deepEqual([...piezasOcultas(tapado, encuadre)], ["metalizado"]);
  const r = revisarEstructura(escena7, tapado, encuadre);
  assert.equal(r?.motivo, "pieza_oculta");
  assert.match(r?.detalle ?? "", /LOVE/);
});
await prueba("lo que ya estaba tapado antes de la ronda no se le reprocha a la ronda", () => {
  const tapado = conLove(escena7, -20, 200, -245);
  assert.equal(revisarEstructura(tapado, tapado, encuadre), null);
});
await prueba("el «LOVE» delante de la guirnalda (más cerca de la cámara) se ve", () => {
  assert.equal(piezasOcultas(conLove(escena7, -20, 200, -100), encuadre).size, 0);
});
await prueba("quitar la guirnalda baja los globos más de 30 %: rechaza, salvo que la ronda reporte piezas sobrantes", () => {
  const sinGuirnalda: Escena = { ...escena7, nodos: escena7.nodos.filter((n) => n.id !== "guirnalda-organica") };
  assert.equal(revisarEstructura(escena7, sinGuirnalda, encuadre)?.motivo, "menos_globos");
  assert.equal(revisarEstructura(escena7, sinGuirnalda, encuadre, { permiteReducir: true }), null);
});

console.log("Decisión");
await prueba("se acepta solo si la captura de después se parece a la foto al menos el margen más que la de antes", () => {
  const s = (antes: number, despues: number): Similitud => ({ antes, despues });
  assert.equal(decidirAceptacion(s(0.6, 0.6 + MARGEN_MEJORA + 0.001), null).aceptada, true);
  const igual = decidirAceptacion(s(0.6, 0.6), null);
  assert.ok(!igual.aceptada && igual.rechazo.motivo === "no_mejora");
  const peor = decidirAceptacion(s(0.6, 0.55), null);
  assert.ok(!peor.aceptada && peor.rechazo.motivo === "no_mejora" && /menos/.test(peor.rechazo.detalle));
  const apenas = decidirAceptacion(s(0.6, 0.6 + MARGEN_MEJORA / 2), null);
  assert.ok(!apenas.aceptada && apenas.rechazo.motivo === "no_mejora", "una mejora dentro del ruido no basta");
});
await prueba("la estructura manda sobre la similitud, y sin similitud no se acepta", () => {
  const rechazo: Rechazo = { motivo: "pieza_baja", detalle: "bajó algo" };
  const v = decidirAceptacion({ antes: 0.5, despues: 0.9 }, rechazo);
  assert.ok(!v.aceptada && v.rechazo.motivo === "pieza_baja");
  const sin = decidirAceptacion(null, null);
  assert.ok(!sin.aceptada && sin.rechazo.motivo === "sin_comparacion");
});
await prueba("coseno: vectores iguales 1, ortogonales 0, vacío 0", () => {
  assert.ok(Math.abs(coseno([1, 2, 3], [1, 2, 3]) - 1) < 1e-12);
  assert.equal(coseno([1, 0], [0, 1]), 0);
  assert.equal(coseno([0, 0], [1, 1]), 0);
});

console.log("Evaluador y bucle");
const foto = { mime: "image/jpeg", base64: "Zm90bw==" };
const captura = (t: string) => ({ mime: "image/jpeg", base64: Buffer.from(t).toString("base64") });
const evaluar = (similitud: Similitud | null | "falla", capturar?: (e: Escena) => Promise<{ mime: string; base64: string }>) => {
  const capturadas: Escena[] = [];
  const pedidos: unknown[] = [];
  const f = crearEvaluadorDeRonda({
    capturar: capturar ?? (async (e) => { capturadas.push(e); return captura("despues"); }),
    similitud: async (cuerpo) => { pedidos.push(cuerpo); if (similitud === "falla") throw new Error("red"); return similitud; },
  });
  return { f, capturadas, pedidos };
};
const contexto = (despues: Escena, antes: Escena = escena7) => ({ antes, despues, capturaAntes: captura("antes"), foto, encuadre, permiteReducir: false, signal: new AbortController().signal });
await prueba("el evaluador captura la escena de después y compara foto, antes y después", async () => {
  const { f, capturadas, pedidos } = evaluar({ antes: 0.5, despues: 0.6 });
  const v = await f(contexto(escena7));
  assert.ok(v.aceptada);
  assert.equal(capturadas.length, 1);
  assert.deepEqual(pedidos[0], { foto, antes: captura("antes"), despues: captura("despues") });
});
await prueba("si la estructura falla no captura ni pide embeddings (no cuesta nada)", async () => {
  const { f, capturadas, pedidos } = evaluar({ antes: 0.5, despues: 0.9 });
  const v = await f(contexto(conLove(escena7, -30, 5, -190)));
  assert.ok(!v.aceptada && v.rechazo.motivo === "pieza_baja");
  assert.equal(capturadas.length + pedidos.length, 0);
});
await prueba("si la captura o el servidor fallan, la ronda se rechaza (no se queda sin comparar)", async () => {
  const fallas = [evaluar("falla"), evaluar(null), evaluar({ antes: 0.5, despues: 0.9 }, async () => { throw new Error("WebGL"); })];
  for (const e of fallas) {
    const v = await e.f(contexto(escena7));
    assert.ok(!v.aceptada && v.rechazo.motivo === "sin_comparacion");
  }
});

const cambio = { herramienta: "ajustar_tamanos", resumen: "R-24: 1 → 13", consulta: false };
const resultado = (diferencias: ResultadoRonda["diferencias"] = []): ResultadoRonda => ({ ronda: 1, diferencias, significativas: 1, cambios: 1, terminar: true, motivo: "ultima_ronda" });
const escenaRonda: Escena = { ...escena7, sala: { ...escena7.sala, anchoCm: 777 } };
const respuesta = (diferencias?: ResultadoRonda["diferencias"]): RespuestaRonda => ({ escena: escenaRonda, respuesta: "subí los R-24", acciones: [cambio], refinar: resultado(diferencias) });
const entrada = { escena: escena7, foto, lectura: lectura7, encuadre };
function bucle(similitud: Similitud | null, estructura: Rechazo | null, extra: Partial<DependenciasRefinado> = {}) {
  const aplicadas: number[] = [], progreso: string[] = [], contextos: Array<{ permiteReducir: boolean }> = [];
  const deps: DependenciasRefinado = {
    capturar: async () => captura("antes"),
    pedir: async () => ({ ok: true, datos: respuesta() }),
    alProgreso: (p) => progreso.push(p.fase ?? "comparando"),
    alRonda: (h) => aplicadas.push(h.ronda),
    evaluar: async (c) => { contextos.push(c); return decidirAceptacion(similitud, estructura); },
    signal: new AbortController().signal,
    maxRondas: 1,
    ...extra,
  };
  return { deps, aplicadas, progreso, contextos };
}
await prueba("una ronda que mejora se aplica, con su deshacer, y la barra pasa por «revisando»", async () => {
  const { deps, aplicadas, progreso } = bucle({ antes: 0.5, despues: 0.6 }, null);
  const r = await refinarConFoto(entrada, deps);
  assert.deepEqual(aplicadas, [1]);
  assert.equal(r.rondas.length, 1);
  assert.equal(r.rondas[0]!.antes, escena7, "deshacer vuelve a la escena de antes");
  assert.equal(r.escena.sala.anchoCm, 777);
  assert.deepEqual(progreso, ["comparando", "revisando"]);
});
await prueba("una ronda que no mejora NO se aplica: la escena anterior sigue y el deshacer no recibe nada", async () => {
  const { deps, aplicadas } = bucle({ antes: 0.6, despues: 0.58 }, null);
  const r = await refinarConFoto(entrada, deps);
  assert.equal(r.motivo, "rechazada");
  assert.deepEqual(aplicadas, []);
  assert.equal(r.rondas.length, 0);
  assert.equal(r.escena, escena7, "es la misma escena de antes de la ronda");
  assert.equal(r.rechazo?.motivo, "no_mejora");
  assert.match(resumenDeRefinado(r), /^La comparación no mejoró; dejé la versión anterior/);
});
await prueba("una ronda que rompe la estructura tampoco se aplica, y el mensaje dice por qué", async () => {
  const { deps, aplicadas } = bucle({ antes: 0.5, despues: 0.9 }, { motivo: "pieza_baja", detalle: "bajó al piso Metalizado LOVE" });
  const r = await refinarConFoto(entrada, deps);
  assert.equal(r.motivo, "rechazada");
  assert.deepEqual(aplicadas, []);
  assert.equal(resumenDeRefinado(r), "La comparación no mejoró; dejé la versión anterior (bajó al piso Metalizado LOVE).");
});
await prueba("la ronda que reporta piezas sobrantes permite bajar el total de globos; sin ese reporte no", async () => {
  const sobrante = [{ aspecto: "piezas_sobrantes" as const, descripcion: "sobran globos al lado", significativa: true }];
  const con = bucle({ antes: 0.5, despues: 0.6 }, null, { pedir: async () => ({ ok: true, datos: respuesta(sobrante) }) });
  await refinarConFoto(entrada, con.deps);
  assert.equal(con.contextos[0]!.permiteReducir, true);
  const sin = bucle({ antes: 0.5, despues: 0.6 }, null);
  await refinarConFoto(entrada, sin.deps);
  assert.equal(sin.contextos[0]!.permiteReducir, false);
});
await prueba("detener durante la revisión no aplica la ronda", async () => {
  const control = new AbortController();
  const { deps, aplicadas } = bucle({ antes: 0.5, despues: 0.6 }, null, { signal: control.signal, evaluar: async () => { control.abort(); return decidirAceptacion({ antes: 0.5, despues: 0.6 }, null); } });
  const r = await refinarConFoto(entrada, deps);
  assert.equal(r.motivo, "detenido");
  assert.deepEqual(aplicadas, []);
});
await prueba("sin criterio (la evaluación sin cabeza) las rondas se aplican como siempre", async () => {
  const { deps, aplicadas } = bucle(null, null, { evaluar: undefined });
  await refinarConFoto(entrada, deps);
  assert.deepEqual(aplicadas, [1]);
});

console.log("Pedido HTTP");
await prueba("pedirSimilitudHttp: devuelve la similitud o null si el servidor o la red fallan", async () => {
  const original = globalThis.fetch;
  const cuerpo = { foto, antes: foto, despues: foto };
  try {
    globalThis.fetch = (async () => Response.json({ antes: 0.4, despues: 0.5, costeEstimadoUsd: 0.0003 })) as typeof fetch;
    assert.deepEqual(await pedirSimilitudHttp({})(cuerpo, new AbortController().signal), { antes: 0.4, despues: 0.5 });
    globalThis.fetch = (async () => Response.json({ error: "x" }, { status: 502 })) as typeof fetch;
    assert.equal(await pedirSimilitudHttp({})(cuerpo, new AbortController().signal), null);
    globalThis.fetch = (async () => { throw new Error("red"); }) as typeof fetch;
    assert.equal(await pedirSimilitudHttp({})(cuerpo, new AbortController().signal), null);
  } finally { globalThis.fetch = original; }
});

console.log("Ruta /api/escena-ia/similitud");
const imagen = (n: number) => ({ mime: "image/jpeg", base64: Buffer.alloc(200, n).toString("base64") });
const vectores = new Map<number, number[]>([[1, [1, 0, 0]], [2, [0.6, 0.8, 0]], [3, [0.8, 0.6, 0]]]);
function depsRuta(extra: Partial<DependenciasSimilitud> = {}): DependenciasSimilitud {
  return {
    autenticado: () => true, mismoOrigen: () => true, cupo: () => true,
    normalizar: async (b) => b,
    embeber: async (bytes) => vectores.get(bytes[0]!)!,
    ...extra,
  };
}
const pedido = (cuerpo: unknown) => new Request("http://localhost/api/escena-ia/similitud", { method: "POST", headers: { "Content-Type": "application/json" }, body: typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo) });
await prueba("devuelve el coseno de cada captura con la foto", async () => {
  const r = await atenderSimilitud(pedido({ foto: imagen(1), antes: imagen(2), despues: imagen(3) }), depsRuta());
  assert.equal(r.status, 200);
  const d = await r.json() as { antes: number; despues: number; costeEstimadoUsd: number };
  assert.ok(Math.abs(d.antes - 0.6) < 1e-9 && Math.abs(d.despues - 0.8) < 1e-9);
  assert.ok(d.costeEstimadoUsd > 0 && d.costeEstimadoUsd < 0.001);
});
await prueba("sin sesión 401, cuerpo roto o incompleto 400, sin cupo 429, embedding caído 502", async () => {
  const bueno = { foto: imagen(1), antes: imagen(2), despues: imagen(3) };
  assert.equal((await atenderSimilitud(pedido(bueno), depsRuta({ autenticado: () => false }))).status, 401);
  assert.equal((await atenderSimilitud(pedido(bueno), depsRuta({ mismoOrigen: () => false }))).status, 401);
  assert.equal((await atenderSimilitud(pedido("no es json"), depsRuta())).status, 400);
  assert.equal((await atenderSimilitud(pedido({ foto: imagen(1), antes: imagen(2) }), depsRuta())).status, 400);
  assert.equal((await atenderSimilitud(pedido(bueno), depsRuta({ cupo: () => false }))).status, 429);
  assert.equal((await atenderSimilitud(pedido(bueno), depsRuta({ embeber: async () => { throw new Error("429"); } }))).status, 502);
});
await prueba("el origen del navegador vale si es el host al que llegó el pedido (en desarrollo Next arma la URL con localhost)", () => {
  const con = (origin: string | null, host: string | null) => new Request("http://localhost:3015/api/escena-ia/similitud", { method: "POST", headers: { ...(origin ? { origin } : {}), ...(host ? { host } : {}) } });
  assert.equal(origenCoincideConHost(con("http://127.0.0.1:3015", "127.0.0.1:3015")), true);
  assert.equal(origenCoincideConHost(con("https://sitio-ajeno.example", "127.0.0.1:3015")), false, "un sitio ajeno no coincide");
  assert.equal(origenCoincideConHost(con(null, "127.0.0.1:3015")), false);
  assert.equal(origenCoincideConHost(con("no es una url", "127.0.0.1:3015")), false);
});
await prueba("no gasta cupo ni embeddings con un pedido inválido", async () => {
  let cupos = 0, embeddings = 0;
  await atenderSimilitud(pedido({ foto: imagen(1) }), depsRuta({ cupo: () => { cupos++; return true; }, embeber: async () => { embeddings++; return [1]; } }));
  assert.equal(cupos + embeddings, 0);
});

console.log(`\n${pruebas} pruebas pasaron.`);
}
main().catch((e) => { console.error(e); process.exit(1); });
