/**
 * La ruta `/api/escena-ia/similitud` (REQ-001 paso 9, P-016) con dependencias inyectadas, sin red ni coste:
 * - el servidor DECIDE (estructura con la lectura de la foto, luego coseno de los embeddings) y devuelve el veredicto;
 * - cada decisión queda en el registro (`regla:aceptacion_refinado`) con aceptada, motivo, antes, después, margen y detalle;
 * - la estructura rechaza sin pedir embeddings; una ronda no puede abrir la puerta a quitar piezas con un campo suyo;
 * - los tres embeddings llevan el flujo «evaluacion», la superficie propia y los ids de la petición;
 * - sesión 401, formato 400, cuerpo grande 413 (por la cabecera, sin leerlo), cupo propio 429, embedding caído 502;
 * - el cupo de las revisiones es aparte del de los pedidos.
 *
 * Run: npx tsx --conditions=react-server scripts/test/test-similitud-refinado.ts
 */
import assert from "node:assert/strict";
import { compilarLectura } from "@/lib/globos3d/compilar-lectura";
import type { Escena } from "@/lib/globos3d/escena";
import { reiniciarCupoEscenaIA, tomarCupoEscenaIA, tomarCupoSimilitud, TOPE_POR_HORA, TOPE_SIMILITUD_POR_HORA } from "@/lib/globos3d/cupo-escena-ia";
import { MARGEN_MEJORA } from "@/lib/globos3d/refinado/aceptacion";
import { LIMITE_CUERPO_SIMILITUD_BYTES, atenderSimilitud, type DependenciasSimilitud } from "@/lib/globos3d/refinado/similitud-servidor";
import { REFERENCIAS_DUENO } from "@/lib/globos3d/referencias-dueno";

let pruebas = 0;
const prueba = async (nombre: string, fn: () => void | Promise<void>) => { await fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };

const lectura = REFERENCIAS_DUENO.find((r) => r.numero === 7)!.lectura;
const escena: Escena = compilarLectura(lectura).escena;
const sinLove: Escena = { ...escena, nodos: escena.nodos.filter((n) => n.id !== "metalizado") };
const alPiso: Escena = { ...escena, nodos: escena.nodos.map((n) => (n.id === "metalizado" ? { ...n, colocacion: { en: "piso" as const, xCm: -30, zCm: -190, giroGrados: 0 } } : n)) };
const imagen = (n: number) => ({ mime: "image/jpeg", base64: Buffer.alloc(200, n).toString("base64") });
const cuerpoBueno = (extra: Record<string, unknown> = {}) => ({ foto: imagen(1), antes: imagen(2), despues: imagen(3), escenaAntes: escena, escenaDespues: escena, lectura, ronda: 1, ...extra });
const vectores = new Map<number, number[]>([[1, [1, 0, 0]], [2, [0.6, 0.8, 0]], [3, [0.8, 0.6, 0]]]);

type Registro = { quien: string; que: string; resultado: Record<string, unknown>; entrada: unknown };
function deps(extra: Partial<DependenciasSimilitud> = {}) {
  const registros: Registro[] = [];
  const embeddings: Array<{ telemetria: unknown; flujo: unknown }> = [];
  const d: DependenciasSimilitud = {
    autenticado: () => true, mismoOrigen: () => true, cupo: () => true,
    normalizar: async (b) => b,
    embeber: async (bytes, _mime, telemetria, flujo) => { embeddings.push({ telemetria, flujo }); return vectores.get(bytes[0]!)!; },
    contexto: () => ({ requestId: "solicitud-1", correlationId: "3d-conversacion-1" }),
    registrar: (quien, que, resultado, extra) => { registros.push({ quien, que, resultado: resultado as Record<string, unknown>, entrada: extra?.entrada }); },
    ...extra,
  };
  return { d, registros, embeddings };
}
const pedido = (cuerpo: unknown, cabeceras: Record<string, string> = {}) =>
  new Request("http://localhost/api/escena-ia/similitud", { method: "POST", headers: { "Content-Type": "application/json", ...cabeceras }, body: typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo) });

async function main() {
console.log("Veredicto del servidor");
await prueba("acepta la ronda que mejora: coseno de cada captura con la foto, sin tocar la estructura", async () => {
  const { d, registros } = deps();
  const r = await atenderSimilitud(pedido(cuerpoBueno()), d);
  assert.equal(r.status, 200);
  const v = await r.json() as { aceptada: boolean; motivo: unknown; similitud: { antes: number; despues: number }; costeEstimadoUsd: number };
  assert.equal(v.aceptada, true);
  assert.equal(v.motivo, null);
  assert.ok(Math.abs(v.similitud.antes - 0.6) < 1e-9 && Math.abs(v.similitud.despues - 0.8) < 1e-9);
  assert.ok(v.costeEstimadoUsd > 0 && v.costeEstimadoUsd < 0.001);
  assert.equal(registros.length, 1);
});
await prueba("rechaza la ronda que no mejora el margen, con el motivo y sin el detalle numérico en la respuesta", async () => {
  const vectoresPeores = new Map(vectores); vectoresPeores.set(3, [0.6, 0.8, 0]);
  const { d } = deps({ embeber: async (bytes) => vectoresPeores.get(bytes[0]!)! });
  const v = await (await atenderSimilitud(pedido(cuerpoBueno()), d)).json() as Record<string, unknown>;
  assert.equal(v.aceptada, false);
  assert.equal(v.motivo, "no_mejora");
  assert.ok(!("detalle" in v) && !("rechazo" in v));
});
await prueba("la estructura rechaza sin pedir embeddings (no cuesta nada) y sin importar lo que se parezca", async () => {
  const { d, embeddings, registros } = deps();
  const v = await (await atenderSimilitud(pedido(cuerpoBueno({ escenaDespues: alPiso })), d)).json() as { aceptada: boolean; motivo: string; similitud: unknown; costeEstimadoUsd: number };
  assert.deepEqual({ aceptada: v.aceptada, motivo: v.motivo, similitud: v.similitud, costeEstimadoUsd: v.costeEstimadoUsd }, { aceptada: false, motivo: "pieza_baja", similitud: null, costeEstimadoUsd: 0 });
  assert.equal(embeddings.length, 0);
  assert.equal(registros[0]!.resultado.motivo, "pieza_baja");
});
await prueba("quitar una pieza visible rechaza (pieza_quitada); el cuerpo no tiene dónde decir «sobran piezas»", async () => {
  const { d } = deps();
  const v = await (await atenderSimilitud(pedido(cuerpoBueno({ escenaDespues: sinLove })), d)).json() as { motivo: string };
  assert.equal(v.motivo, "pieza_quitada");
  const intento = await atenderSimilitud(pedido(cuerpoBueno({ escenaDespues: sinLove, permiteReducir: true })), d);
  assert.equal(intento.status, 400, "un campo del navegador no abre la puerta");
});

console.log("Registro de la decisión");
await prueba("la decisión queda con aceptada, motivo, antes, después, margen, detalle y la ronda", async () => {
  const { d, registros } = deps();
  await atenderSimilitud(pedido(cuerpoBueno({ ronda: 2 })), d);
  const [r] = registros;
  assert.equal(r!.quien, "regla:aceptacion_refinado");
  assert.deepEqual(
    { aceptada: r!.resultado.aceptada, motivo: r!.resultado.motivo, antes: r!.resultado.antes, margen: r!.resultado.margen, detalle: r!.resultado.detalle },
    { aceptada: true, motivo: null, antes: 0.6, margen: MARGEN_MEJORA, detalle: null },
  );
  assert.ok(Math.abs((r!.resultado.despues as number) - 0.8) < 1e-9 && Math.abs((r!.resultado.mejora as number) - 0.2) < 1e-9);
  assert.equal((r!.entrada as { ronda: number }).ronda, 2);
});
await prueba("un rechazo lleva el detalle con los números en el registro", async () => {
  const { d, registros } = deps();
  await atenderSimilitud(pedido(cuerpoBueno({ escenaDespues: alPiso })), d);
  assert.match(String(registros[0]!.resultado.detalle), /114 cm a 0 cm/);
});
await prueba("un embedding caído también deja su decisión (sin_comparacion) en el registro", async () => {
  const { d, registros } = deps({ embeber: async () => { throw new Error("429"); } });
  assert.equal((await atenderSimilitud(pedido(cuerpoBueno()), d)).status, 502);
  assert.equal(registros[0]!.resultado.motivo, "sin_comparacion");
});

console.log("Telemetría de los embeddings");
await prueba("las tres llamadas llevan el flujo evaluacion, la superficie propia y los ids de la petición", async () => {
  const { d, embeddings } = deps();
  await atenderSimilitud(pedido(cuerpoBueno()), d);
  assert.equal(embeddings.length, 3);
  for (const e of embeddings) {
    assert.equal(e.flujo, "evaluacion");
    assert.deepEqual(e.telemetria, { requestId: "solicitud-1", correlationId: "3d-conversacion-1", superficie: "escena_ia_similitud" });
  }
});
await prueba("vectores de distinta dimensión no se comparan: 502, no un coseno inventado", async () => {
  const { d } = deps({ embeber: async (bytes) => (bytes[0] === 1 ? [1, 0, 0] : [1, 0]) });
  assert.equal((await atenderSimilitud(pedido(cuerpoBueno()), d)).status, 502);
});

console.log("Guardas de la ruta");
await prueba("sin sesión o con otro origen 401; cuerpo roto, incompleto o con extras 400", async () => {
  assert.equal((await atenderSimilitud(pedido(cuerpoBueno()), deps({ autenticado: () => false }).d)).status, 401);
  assert.equal((await atenderSimilitud(pedido(cuerpoBueno()), deps({ mismoOrigen: () => false }).d)).status, 401);
  const { d } = deps();
  assert.equal((await atenderSimilitud(pedido("no es json"), d)).status, 400);
  const { escenaDespues: _quitada, ...incompleto } = cuerpoBueno();
  assert.equal((await atenderSimilitud(pedido(incompleto), d)).status, 400);
  assert.equal((await atenderSimilitud(pedido(cuerpoBueno({ ronda: 9 })), d)).status, 400);
  assert.equal((await atenderSimilitud(pedido(cuerpoBueno({ foto: { mime: "image/png", base64: imagen(1).base64 } })), d)).status, 400, "solo JPEG de 1024 px");
});
await prueba("una imagen más grande que una captura de 1024 px se rechaza con 400", async () => {
  const grande = { mime: "image/jpeg", base64: Buffer.alloc(2.2 * 1024 * 1024, 7).toString("base64") };
  assert.equal((await atenderSimilitud(pedido(cuerpoBueno({ foto: grande })), deps().d)).status, 400);
});
await prueba("un cuerpo que declara más del límite se rechaza con 413 por la cabecera, sin leerlo", async () => {
  let leido = false;
  const peticion = new Request("http://localhost/api/escena-ia/similitud", { method: "POST", headers: { "content-length": String(LIMITE_CUERPO_SIMILITUD_BYTES + 1) }, body: "{}" });
  peticion.text = async () => { leido = true; return "{}"; };
  const { d, embeddings } = deps();
  assert.equal((await atenderSimilitud(peticion, d)).status, 413);
  assert.equal(leido, false);
  assert.equal(embeddings.length, 0);
});
await prueba("el límite del cuerpo queda por debajo de los 10 MiB que entrega el proxy de Next", () => {
  assert.ok(LIMITE_CUERPO_SIMILITUD_BYTES < 10 * 1024 * 1024, String(LIMITE_CUERPO_SIMILITUD_BYTES));
});
await prueba("un cuerpo sin cabecera de tamaño pero demasiado grande también se rechaza con 413", async () => {
  const enorme = JSON.stringify({ relleno: "x".repeat(LIMITE_CUERPO_SIMILITUD_BYTES + 10) });
  assert.equal((await atenderSimilitud(pedido(enorme), deps().d)).status, 413);
});
await prueba("no gasta cupo ni embeddings con un pedido inválido; sin cupo 429 y sin embeddings", async () => {
  let cupos = 0;
  const { d, embeddings } = deps({ cupo: () => { cupos++; return true; } });
  await atenderSimilitud(pedido({ foto: imagen(1) }), d);
  assert.equal(cupos + embeddings.length, 0);
  const sinCupo = deps({ cupo: () => false });
  assert.equal((await atenderSimilitud(pedido(cuerpoBueno()), sinCupo.d)).status, 429);
  assert.equal(sinCupo.embeddings.length, 0);
});

console.log("Cupo propio de las revisiones");
await prueba("las revisiones tienen su cupo aparte: agotar los pedidos no las deja sin revisar una ronda ya pagada", () => {
  reiniciarCupoEscenaIA();
  for (let i = 0; i < TOPE_POR_HORA; i++) assert.equal(tomarCupoEscenaIA(), true);
  assert.equal(tomarCupoEscenaIA(), false, "el cupo de pedidos se acabó");
  assert.equal(tomarCupoSimilitud(), true, "la revisión de la ronda ya pagada pasa");
  reiniciarCupoEscenaIA();
});
await prueba("el cupo de revisiones es mayor que el de pedidos: cada revisión sigue a una ronda, así que no se acaba antes", () => {
  assert.ok(TOPE_SIMILITUD_POR_HORA >= TOPE_POR_HORA * 2);
  reiniciarCupoEscenaIA();
  for (let i = 0; i < TOPE_SIMILITUD_POR_HORA; i++) assert.equal(tomarCupoSimilitud(), true);
  assert.equal(tomarCupoSimilitud(), false);
  reiniciarCupoEscenaIA();
});

console.log(`\n${pruebas} pruebas pasaron.`);
}
main().catch((e) => { console.error(e); process.exit(1); });
