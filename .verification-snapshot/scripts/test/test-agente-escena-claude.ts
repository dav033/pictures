/**
 * W5 (T33): /api/escena-ia con Claude (solo local), recorrido completo de la ruta con un transporte simulado
 * (`fetch` para api.anthropic.com; cualquier otra salida hace fallar). Sin red ni coste:
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-agente-escena-claude.ts
 * - bucle de herramientas: tool_use → se aplica a la escena → tool_result con la verificación → texto final; las
 *   declaraciones salen con los mismos nombres que DECLARACIONES_ESCENA y el coste usa los precios de Haiku;
 * - NDJSON (Accept: application/x-ndjson): fase, paso por herramienta y un único evento final con la misma respuesta;
 * - parar: cortar la petición a mitad devuelve lo ya aplicado (no lo deshace) y no pide otra vuelta;
 * - foto con la sala ocupada: el primer paso es FORZADO (solo modelar_desde_foto y preguntar_usuario, tool_choice any,
 *   sin razonamiento), la foto se lee con Claude (imagen + esquema forzado) y el segundo paso ya no es forzado;
 * - fuera de local la ruta no toca Claude (Gemini en producción, sin cambios).
 * Con Gemini la ruta sigue idéntica: lo prueban test-agente-escena y test-modelo-escena.
 */
import assert from "node:assert/strict";
import sharp from "sharp";
import { configurarPersistenciaTelemetria } from "@sempertex/agente-core";
import type { CuerpoMensajes } from "../../src/lib/ia/claude/tipos";

Object.assign(process.env, { NODE_ENV: "development", IA_PROVEEDOR: "claude", ANTHROPIC_API_KEY: "sk-ant-prueba-no-real", GEMINI_API_KEY: "clave-gemini-de-prueba" });
for (const variable of ["VERCEL", "IA_LOCAL_ESFUERZO", "IA_LOCAL_PENSAMIENTO", "ANTHROPIC_CHAT_MODEL", "IA_CLAUDE_TRANSPORTE"]) Reflect.deleteProperty(process.env, variable);

type Bloque = Record<string, unknown>;
const peticiones: CuerpoMensajes[] = [];
const aOtroHost: string[] = [];
let decidirRespuesta: (cuerpo: CuerpoMensajes, n: number, signal: AbortSignal | null | undefined) => Bloque[] = () => [{ type: "text", text: "" }];
const fetchOriginal = globalThis.fetch;
globalThis.fetch = (async (entrada: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const url = typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
  if (!url.startsWith("https://api.anthropic.com/")) {
    aOtroHost.push(url);
    throw new Error(`no debía salir de Claude: ${url}`);
  }
  if (init?.signal?.aborted) throw new DOMException("This operation was aborted", "AbortError");
  const cuerpo = JSON.parse(String(init?.body)) as CuerpoMensajes;
  peticiones.push(cuerpo);
  const content = decidirRespuesta(cuerpo, peticiones.length, init?.signal);
  // Como un fetch real: si el corte llega mientras la petición vuela, la respuesta no se entrega.
  if (init?.signal?.aborted) throw new DOMException("This operation was aborted", "AbortError");
  const mensaje = { id: `msg_${peticiones.length}`, type: "message", role: "assistant", model: "claude-haiku-5-5", content, stop_reason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn", usage: { input_tokens: 2000, output_tokens: 300 } };
  return new Response(JSON.stringify(mensaje), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;

let pruebas = 0;
const prueba = async (nombre: string, fn: () => Promise<void>) => {
  peticiones.length = 0;
  aOtroHost.length = 0;
  reiniciarCupo();
  await fn();
  pruebas += 1;
  console.log(`  ✓ ${nombre}`);
};
let reiniciarCupo: () => void = () => undefined;

const uso = (id: string, name: string, input: Record<string, unknown>): Bloque => ({ type: "tool_use", id, name, input });
const texto = (text: string): Bloque => ({ type: "text", text });
const herramientasDe = (cuerpo: CuerpoMensajes) => (cuerpo.tools ?? []).map((t) => t.name);

async function main() {
  configurarPersistenciaTelemetria(undefined);
  const { POST } = await import("../../src/app/api/escena-ia/route");
  const { reiniciarCupoEscenaIA } = await import("../../src/lib/globos3d/cupo-escena-ia");
  const { DECLARACIONES_ESCENA } = await import("../../src/lib/globos3d/herramientas-escena");
  const { escenaPredefinida } = await import("../../src/lib/globos3d/escenas-presets");
  const { REFERENCIAS_DUENO } = await import("../../src/lib/globos3d/referencias-dueno");
  const { TIPO_NDJSON } = await import("../../src/lib/globos3d/flujo-escena-ia");
  const { costeClaudeUsd } = await import("../../src/lib/ia/claude/precios");
  reiniciarCupo = reiniciarCupoEscenaIA;

  const escena = escenaPredefinida("arco_organico_columnas_guirnalda");
  const pedir = (extra: Record<string, unknown> = {}, cabeceras: Record<string, string> = {}, signal?: AbortSignal) =>
    POST(new Request("http://localhost/api/escena-ia", { method: "POST", headers: { "Content-Type": "application/json", ...cabeceras }, body: JSON.stringify({ escena, mensaje: "ponlo todo en rojo y negro", historial: [], seleccion: null, ...extra }), signal }));
  const recolorear = (n: number) => uso(`toolu_${n}`, "recolorear_escena", { colores: ["rojo", "negro"] });
  type Respuesta = { escena: { nodos: unknown[] }; respuesta: string; acciones: Array<{ herramienta: string; consulta: boolean }>; uso: { pasos: number; llamadas: number; costeEstimadoUsd: number } };

  await prueba("bucle de herramientas: tool_use → se aplica → tool_result con la verificación → texto final; mismas herramientas que con Gemini; coste de Haiku", async () => {
    decidirRespuesta = (_c, n) => (n === 1 ? [texto("Recoloreo."), recolorear(1)] : [texto("Listo: todo en rojo y negro.")]);
    const r = await pedir();
    assert.equal(r.status, 200);
    const datos = await r.json() as Respuesta;
    assert.equal(peticiones.length, 2);
    const declaradas = DECLARACIONES_ESCENA.map((d) => d.name);
    assert.ok(herramientasDe(peticiones[0]!).every((n) => declaradas.includes(n)), "ninguna herramienta que no esté declarada");
    assert.ok(herramientasDe(peticiones[0]!).length >= declaradas.length - 5, "salen las declaraciones de escena (menos las de la foto)");
    assert.ok(herramientasDe(peticiones[0]!).includes("recolorear_escena") && !herramientasDe(peticiones[0]!).includes("modelar_desde_foto"));
    assert.deepEqual(peticiones[0]!.thinking, { type: "adaptive" });
    assert.equal(peticiones[0]!.tool_choice, undefined, "sin foto, ninguna herramienta forzada");
    assert.ok(peticiones[0]!.system?.[0]?.text.includes("taller 3D"));
    // La segunda vuelta reenvía el turno del modelo y el resultado de la herramienta por id.
    const [pregunta, turnoModelo, resultado] = peticiones[1]!.messages;
    assert.equal(pregunta!.role, "user");
    assert.equal(turnoModelo!.role, "assistant");
    assert.equal(resultado!.role, "user");
    const bloque = resultado!.content[0] as { type: string; tool_use_id: string; content: string };
    assert.equal(bloque.type, "tool_result");
    assert.equal(bloque.tool_use_id, "toolu_1");
    assert.match(bloque.content, /verificacion/);
    assert.match(datos.respuesta, /rojo y negro/);
    assert.deepEqual(datos.acciones.map((a) => [a.herramienta, a.consulta]), [["recolorear_escena", false]]);
    assert.deepEqual([datos.uso.pasos, datos.uso.llamadas], [1, 1]);
    const porVuelta = costeClaudeUsd("claude-haiku-5-5", { input_tokens: 2000, output_tokens: 300 })!;
    assert.ok(Math.abs(datos.uso.costeEstimadoUsd - Math.round(porVuelta * 2 * 1e5) / 1e5) < 2e-5, `coste ${datos.uso.costeEstimadoUsd}`);
    assert.notDeepEqual(datos.escena, escena, "la escena cambió");
  });

  await prueba("una herramienta con error vuelve como tool_result con el error para que el modelo corrija", async () => {
    decidirRespuesta = (_c, n) => (n === 1 ? [uso("toolu_x", "recolorear_escena", { colores: 5 })] : [texto("No pude.")]);
    const datos = await (await pedir()).json() as Respuesta;
    const resultado = peticiones[1]!.messages.at(-1)!.content[0] as { content: string };
    assert.match(resultado.content, /error/);
    assert.match(datos.respuesta, /No pude/);
    assert.deepEqual(datos.escena, escena, "sin cambios si la herramienta falló");
  });

  await prueba("NDJSON: fase pensando, un paso por herramienta y un único evento final con la misma respuesta", async () => {
    decidirRespuesta = (_c, n) => (n === 1 ? [recolorear(1)] : [texto("Listo.")]);
    const r = await pedir({}, { Accept: TIPO_NDJSON });
    assert.match(r.headers.get("content-type") ?? "", /ndjson/);
    const eventos = (await r.text()).split("\n").filter(Boolean).map((l) => JSON.parse(l) as { tipo: string; [clave: string]: unknown });
    const tipos = eventos.map((e) => e.tipo).filter((t) => t !== "latido");
    assert.equal(tipos[0], "fase");
    assert.equal(eventos.filter((e) => e.tipo === "final").length, 1);
    assert.equal(tipos.at(-1), "final");
    const paso = eventos.find((e) => e.tipo === "paso");
    assert.equal(paso?.herramienta, "recolorear_escena");
    assert.equal(paso?.ok, true);
    const final = eventos.find((e) => e.tipo === "final") as unknown as { estado: number; cuerpo: Respuesta };
    assert.equal(final.estado, 200);
    assert.equal(final.cuerpo.respuesta, "Listo.");
  });

  await prueba("parar: cortar la petición en la 2.ª vuelta devuelve lo ya aplicado y no pide otra", async () => {
    const control = new AbortController();
    decidirRespuesta = (_c, n) => {
      if (n === 1) return [recolorear(1)];
      control.abort();
      return [texto("no debería leerse")];
    };
    const r = await pedir({}, {}, control.signal);
    assert.equal(peticiones.length, 2, "la vuelta cortada fue la última");
    assert.equal(r.status, 200, "lo ya aplicado se devuelve");
    const datos = await r.json() as Respuesta;
    assert.ok(datos.acciones.some((a) => a.herramienta === "recolorear_escena" && !a.consulta));
    assert.notDeepEqual(datos.escena, escena);
    assert.match(datos.respuesta, /se cortó/);
  });

  await prueba("parar antes de la primera vuelta: ninguna petición sale a Claude", async () => {
    const control = new AbortController();
    control.abort();
    decidirRespuesta = () => [texto("no debería llamarse")];
    const r = await pedir({}, {}, control.signal);
    assert.equal(peticiones.length, 0);
    assert.ok(r.status >= 400);
  });

  await prueba("foto con la sala ocupada: 1.er paso forzado (solo modelar_desde_foto y preguntar_usuario, any, sin razonamiento), la foto se lee con Claude y el 2.º paso ya no es forzado", async () => {
    const lectura = REFERENCIAS_DUENO.find((x) => x.numero === 7)!.lectura;
    const foto = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#c0a080" } }).jpeg().toBuffer();
    decidirRespuesta = (cuerpo) => {
      if (cuerpo.tool_choice?.type === "tool") return [uso("toolu_lectura", cuerpo.tool_choice.name, lectura as unknown as Record<string, unknown>)];
      if (cuerpo.tool_choice?.type === "any") return [uso("toolu_foto", "modelar_desde_foto", { modo: "reemplazar" })];
      return [texto("Listo, armé la foto.")];
    };
    const r = await pedir({ mensaje: "arma esta decoración de la foto", foto: { mime: "image/jpeg", base64: foto.toString("base64") } });
    assert.equal(r.status, 200);
    const datos = await r.json() as Respuesta & { foto: { aplicada: boolean } };
    const lecturaPeticion = peticiones.find((p) => p.tool_choice?.type === "tool")!;
    assert.deepEqual(lecturaPeticion.messages[0]!.content.map((b) => b.type), ["image", "text"], "la lectura manda la foto como imagen");
    const forzada = peticiones.find((p) => p.tool_choice?.type === "any")!;
    assert.deepEqual(herramientasDe(forzada).sort(), ["modelar_desde_foto", "preguntar_usuario"]);
    assert.deepEqual(forzada.thinking, { type: "disabled" });
    assert.ok(forzada.messages[0]!.content.some((b) => b.type === "image"), "la foto va en el mensaje del paso forzado");
    const ultima = peticiones.at(-1)!;
    assert.equal(ultima.tool_choice, undefined, "solo el primer paso es forzado");
    assert.ok(herramientasDe(ultima).length > 2);
    assert.equal(datos.foto.aplicada, true);
    assert.ok(datos.acciones.some((a) => a.herramienta === "modelar_desde_foto"));
    assert.deepEqual(aOtroHost, []);
  });

  await prueba("fuera de local (NODE_ENV=production) la ruta usa Gemini y no toca Claude", async () => {
    Object.assign(process.env, { NODE_ENV: "production" });
    try {
      decidirRespuesta = () => [texto("no debería llamarse")];
      const r = await pedir();
      assert.ok(r.status >= 400, "Gemini no está disponible en la prueba (sin red)");
    } finally {
      Object.assign(process.env, { NODE_ENV: "development" });
    }
    assert.equal(peticiones.length, 0);
    assert.ok(aOtroHost.length > 0 && aOtroHost.every((u) => u.includes("generativelanguage.googleapis.com")), aOtroHost.join(", "));
  });

  console.log(`\ntest-agente-escena-claude: ${pruebas} pruebas ok`);
}

void main()
  .catch((error: unknown) => { console.error(error); process.exitCode = 1; })
  .finally(() => { globalThis.fetch = fetchOriginal; });
