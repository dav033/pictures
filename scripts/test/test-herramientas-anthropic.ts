/**
 * W5: las herramientas de la IA de escena en el formato de Anthropic (Claude solo en local). Sin red ni coste:
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-herramientas-anthropic.ts
 * - TODAS las declaraciones de la escena (y las del refinado) se convierten: mismo nombre, nombre válido para la API,
 *   el mismo esquema de argumentos que ve Gemini (sin `$schema`), `input_schema` de tipo objeto, sin `strict`;
 * - `cache_control` solo en la última herramienta;
 * - ida y vuelta de argumentos: lo que el modelo manda en `tool_use` (JSON por HTTP) llega idéntico a la herramienta y
 *   arma la misma escena que aplicarla directo;
 * - informe de tamaño (bytes y tokens estimados) con un tope para que no crezca sin decidirlo.
 */
import assert from "node:assert/strict";
import { DECLARACIONES_ESCENA, aplicarHerramienta, type ResultadoHerramienta } from "../../src/lib/globos3d/herramientas-escena";
import { declaracionesDeRefinado } from "../../src/lib/globos3d/refinado/ronda-servidor";
import { escenaPredefinida } from "../../src/lib/globos3d/escenas-presets";
import type { Escena } from "../../src/lib/globos3d/escena";
import { crearModeloEscenaClaude } from "../../src/lib/globos3d/modelo-escena/sesion-claude";
import { crearClienteAnthropic } from "../../src/lib/ia/claude/cliente";
import { herramientaDeDeclaracion, herramientasAnthropic, NOMBRE_HERRAMIENTA_VALIDO } from "../../src/lib/ia/claude/herramientas";
import { extraerRespuestaAnthropic } from "../../src/lib/registro/envoltorios-anthropic";

let pruebas = 0;
const prueba = async (nombre: string, fn: () => void | Promise<void>) => { await fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };

/** Tope del bloque de herramientas para Claude; las declaraciones de Gemini tienen el suyo (120 KB) en test-esquema-gemini.ts. */
const MAXIMO_HERRAMIENTAS_BYTES = 125 * 1024;
/** Estimación gruesa (4 bytes por token en JSON); el prompt entero tiene que quedar lejos de la tarifa larga (100 000). */
const MAXIMO_TOKENS_ESTIMADOS = 40_000;

const herramientas = herramientasAnthropic(DECLARACIONES_ESCENA.map(herramientaDeDeclaracion));
const bytes = Buffer.byteLength(JSON.stringify(herramientas));
const tokensEstimados = Math.ceil(bytes / 4);
console.log(`herramientas para Claude: ${herramientas.length}, ${bytes} B (~${tokensEstimados} tokens estimados, sin medir con count_tokens)`);
const masGrandes = [...herramientas].sort((a, b) => Buffer.byteLength(JSON.stringify(b)) - Buffer.byteLength(JSON.stringify(a))).slice(0, 5);
console.log(`  las más grandes: ${masGrandes.map((h) => `${h.name} ${Buffer.byteLength(JSON.stringify(h))} B`).join(", ")}`);

async function main() {
  console.log("Conversión");
  await prueba(`las ${DECLARACIONES_ESCENA.length} herramientas de la escena se convierten con el mismo nombre y los mismos argumentos`, () => {
    assert.equal(herramientas.length, DECLARACIONES_ESCENA.length);
    DECLARACIONES_ESCENA.forEach((declaracion, indice) => {
      const herramienta = herramientas[indice]!;
      assert.equal(herramienta.name, declaracion.name);
      assert.match(herramienta.name, NOMBRE_HERRAMIENTA_VALIDO);
      assert.equal(herramienta.description, declaracion.description);
      assert.ok(herramienta.description.length > 0, `${declaracion.name} sin descripción`);
      assert.equal(herramienta.input_schema.type, "object", `${declaracion.name}: input_schema debe ser un objeto`);
      const esperado: Record<string, unknown> = { ...declaracion.parametersJsonSchema };
      delete esperado.$schema;
      assert.deepEqual(herramienta.input_schema, esperado, `${declaracion.name}: el esquema de argumentos cambió`);
      assert.equal("strict" in herramienta, false);
    });
    assert.equal(new Set(herramientas.map((h) => h.name)).size, herramientas.length, "nombres repetidos");
  });

  await prueba("cache_control solo en la última (cachea toda la lista)", () => {
    assert.deepEqual(herramientas.at(-1)!.cache_control, { type: "ephemeral" });
    assert.equal(herramientas.slice(0, -1).filter((h) => h.cache_control).length, 0);
  });

  await prueba("también las del refinado (con reportar_comparacion) y el subconjunto del paso forzado", () => {
    const refinado = herramientasAnthropic(declaracionesDeRefinado(DECLARACIONES_ESCENA).map(herramientaDeDeclaracion));
    assert.ok(refinado.some((h) => h.name === "reportar_comparacion"));
    for (const h of refinado) assert.equal(h.input_schema.type, "object");
    const forzado = herramientasAnthropic(DECLARACIONES_ESCENA.filter((d) => ["modelar_desde_foto", "preguntar_usuario"].includes(d.name)).map(herramientaDeDeclaracion));
    assert.deepEqual(forzado.map((h) => h.name).sort(), ["modelar_desde_foto", "preguntar_usuario"]);
  });

  await prueba("un nombre que la API no admite o un esquema que no es objeto fallan al convertir, no en la API", () => {
    assert.throws(() => herramientasAnthropic([{ nombre: "con espacio", descripcion: "x", esquema: { type: "object" } }]), /no válido/);
    assert.throws(() => herramientasAnthropic([{ nombre: "lista", descripcion: "x", esquema: { type: "array" } }]), /no recibe un objeto/);
    assert.deepEqual(herramientasAnthropic([{ nombre: "vacia", descripcion: "x", esquema: {} }])[0]!.input_schema, { type: "object", properties: {} });
  });

  await prueba(`tamaño: a lo más ${MAXIMO_HERRAMIENTAS_BYTES / 1024} KB y ~${MAXIMO_TOKENS_ESTIMADOS} tokens estimados`, () => {
    assert.ok(bytes <= MAXIMO_HERRAMIENTAS_BYTES, `${bytes} B`);
    assert.ok(tokensEstimados <= MAXIMO_TOKENS_ESTIMADOS, `${tokensEstimados} tokens`);
  });

  console.log("Ida y vuelta de argumentos (tool_use → herramienta)");
  const base = escenaPredefinida("arco_organico_columnas_guirnalda");
  const llamadas: Array<{ nombre: string; args: Record<string, unknown> }> = [
    { nombre: "agregar_pieza", args: { tipo: "columna", colores: ["rojo metal", "verde reflex"] } },
    { nombre: "ajustar_tamanos", args: { id: "arco", cambios: [{ formato: "R-24", accion: "mas" }] } },
    { nombre: "poner_sobre", args: { decoracion_id: "flor5", padre_id: "columna-izq", altura_cm: 150 } },
    { nombre: "recolorear_escena", args: { colores: ["rosado pastel", "dorado"] } },
    { nombre: "preguntar_usuario", args: { pregunta: "¿Cuál columna?", opciones: ["la izquierda", "la derecha"] } },
  ];
  for (const { nombre } of llamadas) assert.ok(DECLARACIONES_ESCENA.some((d) => d.name === nombre), `${nombre} no está declarada`);

  const respuestaApi = {
    id: "msg_1", type: "message", role: "assistant", model: "claude-haiku-5-5", stop_reason: "tool_use",
    usage: { input_tokens: 10, output_tokens: 10 },
    content: [{ type: "thinking", thinking: "", signature: "firma" }, ...llamadas.map((l, i) => ({ type: "tool_use", id: `toolu_${i}`, name: l.nombre, input: l.args }))],
  };
  const fetchFalso = (async () => new Response(JSON.stringify(respuestaApi), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
  const cliente = crearClienteAnthropic({ apiKey: "clave-de-prueba", fetch: fetchFalso });
  const modelo = crearModeloEscenaClaude(cliente, { apiKey: "clave-de-prueba", modelo: "claude-haiku-5-5", esfuerzo: "medium", pensamiento: true, maxTokens: 16_000 }, { registrar: () => undefined });
  const sesion = modelo.iniciar({ sistema: "s", declaraciones: DECLARACIONES_ESCENA, historial: [], partesUsuario: [{ text: "arma algo" }], signal: new AbortController().signal });
  const paso = await sesion.pedir();

  await prueba("los argumentos llegan idénticos (después de JSON por HTTP), con el id de cada tool_use", () => {
    assert.deepEqual(paso.llamadas.map((l) => ({ nombre: l.nombre, args: l.args })), llamadas);
    assert.deepEqual(paso.llamadas.map((l) => l.id), llamadas.map((_l, i) => `toolu_${i}`));
  });

  await prueba("y aplicados arman exactamente la misma escena que aplicarlos directo", () => {
    const aplicar = (escena: Escena, lista: Array<{ nombre: string; args?: Record<string, unknown> }>): Escena => lista.reduce((actual, l) => {
      const r: ResultadoHerramienta = aplicarHerramienta(actual, l.nombre, l.args ?? {});
      if (!r.ok) assert.fail(`${l.nombre}: ${r.error}`);
      return r.escena;
    }, escena);
    assert.deepEqual(aplicar(base, paso.llamadas), aplicar(base, llamadas));
  });

  console.log("Auditoría");
  await prueba("respuesta_ia de Claude: texto, llamadas, motivo, tokens con lectura y escritura de caché, y coste estimado", () => {
    const resultado = extraerRespuestaAnthropic({
      id: "msg_2", model: "claude-haiku-5-5", stop_reason: "end_turn",
      content: [{ type: "thinking", thinking: "", signature: "x" }, { type: "text", text: "Listo." }],
      usage: { input_tokens: 1_000, output_tokens: 400, cache_read_input_tokens: 30_000, cache_creation_input_tokens: 5_000, output_tokens_details: { thinking_tokens: 300 } },
    });
    assert.equal(resultado.texto, "Listo.");
    assert.equal(resultado.motivoFin, "end_turn");
    assert.deepEqual(resultado.tokens, { entrada: 36_000, salida: 100, pensamiento: 300, cacheados: 30_000, cacheEscritos: 5_000 });
    assert.ok(Math.abs(resultado.costeEstimadoUsd! - (1_000 * 0.10 + 5_000 * 0.125 + 30_000 * 0.01 + 400 * 0.50) / 1e6) < 1e-15);
  });

  console.log(`\ntest-herramientas-anthropic: ${pruebas} pruebas ok`);
}

void main().catch((error: unknown) => { console.error(error); process.exit(1); });
