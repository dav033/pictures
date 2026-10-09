/**
 * Dictado por voz (REQ-009), sin red ni coste (el VPS se simula):
 *   npx tsx --conditions=react-server scripts/test/test-voz-dictado.ts
 * - ruta: bandera apagada → 404, sesión y origen, tipo y tamaño (con y sin Content-Length), cupo por IP, errores sin filtrar el secreto;
 * - cliente del VPS: firma exacta del contrato, ventana de repetición, un solo reintento acotado ante 503, tiempo máximo;
 * - ruta real: auditoría «whisper-vps» con coste 0 y sin audio ni texto en el registro;
 * - cliente: elegir el formato de grabación, insertar en el cursor, máquina de estados, mensajes en español.
 * (El botón dibujado va aparte, en test-voz-boton.ts: react-dom/server no corre con --conditions=react-server.)
 */
process.env.REGISTRO_ACTIVO = "1";

import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ESTADO_INICIAL, formatearTiempo, reducirDictado, type EstadoDictado, type EventoDictado } from "../../src/components/voz/estado-dictado";
import { insertarEnCursor } from "../../src/components/voz/insertar-texto";
import { MENSAJES_ERROR_DICTADO, codigoDeErrorMicrofono, codigoDeEstadoHttp } from "../../src/components/voz/mensajes-voz";
import { MIMES_GRABACION, elegirMimeGrabacion } from "../../src/components/voz/mime";
import { ErrorVoz, ESPERA_MAXIMA_REINTENTO_MS, PRESUPUESTO_TOTAL_MS, esperaDeReintento, transcribirEnVps, type DependenciasVps } from "../../src/lib/voz/cliente-vps";
import { leerConfigVoz, type ConfigVoz } from "../../src/lib/voz/config";
import { CABECERA_FIRMA, CABECERA_TIMESTAMP, firmarPedido } from "../../src/lib/voz/firma";
import { MAX_BYTES_AUDIO, esTipoAudioAceptado, tipoAudioAceptado } from "../../src/lib/voz/limites";
import { TOPE_POR_MINUTO, reiniciarLimiteVoz, tomarCupoVoz } from "../../src/lib/voz/limite";
import { atenderEstadoVoz, atenderTranscripcion, leerConTope, type DependenciasTranscripcion } from "../../src/lib/voz/transcribir";
import { fijarConfiguracionParaPruebas } from "../../src/lib/registro/configuracion";
import { esperarRegistros, reiniciarEscritorParaPruebas } from "../../src/lib/registro/escritor";

let pruebas = 0;
async function prueba(nombre: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  pruebas += 1;
  console.log(`  ✓ ${nombre}`);
}

const SECRETO = ["valor", "compartido", "para", "firmar", "pruebas"].join(" ");
const URL_VPS = "https://voz-prueba.example.test";
const CONFIG: ConfigVoz = { habilitada: true, url: URL_VPS, secreto: SECRETO };
const AUDIO = new Uint8Array([79, 103, 103, 83, 0, 2, 1, 2, 3, 4, 5, 6, 7, 8]);

/* ---------- Ruta: validación, sesión, cupo, errores ---------- */

type Llamada = { audio: Uint8Array; contentType: string };
function dependencias(extra: Partial<DependenciasTranscripcion> = {}): { deps: DependenciasTranscripcion; llamadas: Llamada[] } {
  const llamadas: Llamada[] = [];
  return {
    llamadas,
    deps: {
      autenticado: () => true,
      mismoOrigen: () => true,
      config: () => CONFIG,
      cupo: () => ({ permitido: true }),
      transcribir: async (audio, contentType) => { llamadas.push({ audio, contentType }); return { texto: "  pon la columna a dos metros  ", duracion_s: 2.1, ms: 1800 }; },
      ...extra,
    },
  };
}
function pedido(opciones: { cuerpo?: BodyInit | null; tipo?: string; cabeceras?: Record<string, string> } = {}): Request {
  const cabeceras: Record<string, string> = { "content-type": opciones.tipo ?? "audio/webm;codecs=opus", ...opciones.cabeceras };
  return new Request("http://localhost/api/voz/transcribir", { method: "POST", headers: cabeceras, body: opciones.cuerpo === undefined ? AUDIO : opciones.cuerpo });
}
const cuerpoDe = async (r: Response) => (await r.json()) as Record<string, unknown>;

async function pruebasRuta(): Promise<void> {
  await prueba("bandera apagada → 404 sin tocar el VPS, ni siquiera con sesión", async () => {
    const { deps, llamadas } = dependencias({ config: () => ({ ...CONFIG, habilitada: false }) });
    const r = await atenderTranscripcion(pedido(), deps);
    assert.equal(r.status, 404);
    assert.equal(llamadas.length, 0);
  });
  await prueba("sin sesión o de otro origen → 401", async () => {
    for (const cambio of [{ autenticado: () => false }, { mismoOrigen: () => false }]) {
      const { deps, llamadas } = dependencias(cambio);
      assert.equal((await atenderTranscripcion(pedido(), deps)).status, 401);
      assert.equal(llamadas.length, 0);
    }
  });
  await prueba("solo audio: JSON, texto o sin tipo → 415", async () => {
    for (const tipo of ["application/json", "text/plain", "image/png", ""]) {
      const { deps } = dependencias();
      assert.equal((await atenderTranscripcion(pedido({ tipo }), deps)).status, 415, tipo);
    }
    assert.equal(esTipoAudioAceptado("audio/mp4"), true);
    assert.equal(esTipoAudioAceptado("audio/webm;codecs=opus"), true);
    assert.equal(tipoAudioAceptado("Audio/WebM; codecs=opus"), "audio/webm");
    for (const raro of ["audio/webm;x=json", "audio/webm; codecs=opus; x=1", "application/json;a=audio/webm", "audio/webm,application/json", "audio/flac"]) {
      assert.equal(tipoAudioAceptado(raro), null, raro);
    }
  });
  await prueba("más de 2 MB → 413, con Content-Length declarado y también leyendo el flujo sin declararlo", async () => {
    const { deps, llamadas } = dependencias();
    const declarado = await atenderTranscripcion(pedido({ cabeceras: { "content-length": String(MAX_BYTES_AUDIO + 1) } }), deps);
    assert.equal(declarado.status, 413);
    const grande = new Uint8Array(MAX_BYTES_AUDIO + 10);
    const flujo = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(grande.slice(0, 1_000_000)); c.enqueue(grande.slice(1_000_000, 2_000_000)); c.enqueue(grande.slice(2_000_000)); c.close(); } });
    const sinDeclarar = await atenderTranscripcion(new Request("http://localhost/api/voz/transcribir", { method: "POST", headers: { "content-type": "audio/webm" }, body: flujo, duplex: "half" } as RequestInit), deps);
    assert.equal(sinDeclarar.status, 413);
    assert.equal(llamadas.length, 0);
    assert.equal((await leerConTope(pedido({ cuerpo: new Uint8Array(MAX_BYTES_AUDIO) }), MAX_BYTES_AUDIO))?.byteLength, MAX_BYTES_AUDIO);
  });
  await prueba("audio vacío → 400", async () => {
    const { deps } = dependencias();
    assert.equal((await atenderTranscripcion(pedido({ cuerpo: new Uint8Array(0) }), deps)).status, 400);
  });
  await prueba("cupo agotado → 429 con Retry-After y sin llamar al VPS", async () => {
    const { deps, llamadas } = dependencias({ cupo: () => ({ permitido: false, reintentarEnSeg: 17 }) });
    const r = await atenderTranscripcion(pedido(), deps);
    assert.equal(r.status, 429);
    assert.equal(r.headers.get("retry-after"), "17");
    assert.equal(llamadas.length, 0);
  });
  await prueba("el cupo cuenta por IP: la de X-Forwarded-For", async () => {
    const vistas: string[] = [];
    const { deps } = dependencias({ cupo: (ip) => { vistas.push(ip); return { permitido: true }; } });
    await atenderTranscripcion(pedido({ cabeceras: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" } }), deps);
    assert.deepEqual(vistas, ["203.0.113.9"]);
  });
  await prueba("bien → { texto } recortado; el VPS recibe los bytes y el tipo sin parámetros", async () => {
    const { deps, llamadas } = dependencias();
    const r = await atenderTranscripcion(pedido(), deps);
    assert.equal(r.status, 200);
    assert.deepEqual(await cuerpoDe(r), { texto: "pon la columna a dos metros" });
    assert.equal(r.headers.get("cache-control"), "no-store");
    assert.deepEqual([...llamadas[0].audio], [...AUDIO]);
    assert.equal(llamadas[0].contentType, "audio/webm");
  });
  await prueba("errores del VPS → estado y mensaje propios, nunca el secreto ni la URL del VPS", async () => {
    const casos: Array<[ErrorVoz | Error, number]> = [
      [new ErrorVoz("no_configurada"), 503], [new ErrorVoz("ocupado", 2), 503], [new ErrorVoz("demasiado_largo"), 413],
      [new ErrorVoz("servicio"), 502], [new ErrorVoz("tiempo_agotado"), 504], [new Error(`falló ${URL_VPS} con ${SECRETO}`), 502],
    ];
    for (const [error, estado] of casos) {
      const { deps } = dependencias({ transcribir: async () => { throw error; } });
      const r = await atenderTranscripcion(pedido(), deps);
      const texto = JSON.stringify(await cuerpoDe(r.clone()));
      assert.equal(r.status, estado);
      assert.ok(!texto.includes(SECRETO) && !texto.includes(URL_VPS) && !texto.includes("example.test"), texto);
    }
    const ocupado = await atenderTranscripcion(pedido(), dependencias({ transcribir: async () => { throw new ErrorVoz("ocupado", 2); } }).deps);
    assert.equal(ocupado.headers.get("retry-after"), "2");
  });
  await prueba("GET de estado: solo { habilitada }, con sesión, sin secreto, y el navegador lo guarda 5 minutos", async () => {
    const encendida = atenderEstadoVoz(new Request("http://localhost/api/voz/transcribir"), { autenticado: () => true, config: () => CONFIG });
    assert.equal(encendida.headers.get("cache-control"), "private, max-age=300");
    assert.deepEqual(await cuerpoDe(encendida), { habilitada: true });
    const apagada = atenderEstadoVoz(new Request("http://localhost/api/voz/transcribir"), { autenticado: () => true, config: () => ({ ...CONFIG, habilitada: false }) });
    assert.deepEqual(await cuerpoDe(apagada), { habilitada: false });
    assert.equal(atenderEstadoVoz(new Request("http://localhost/api/voz/transcribir"), { autenticado: () => false, config: () => CONFIG }).status, 401);
  });
  await prueba("configuración: apagada por defecto, URL sin barra final, el secreto solo del entorno del servidor", () => {
    assert.deepEqual(leerConfigVoz({}), { habilitada: false, url: null, secreto: null });
    assert.equal(leerConfigVoz({ VOZ_ENABLED: "true", VOZ_URL: "https://x.test/", VOZ_SECRETO: " s " }).url, "https://x.test");
    assert.equal(leerConfigVoz({ VOZ_ENABLED: "false" }).habilitada, false);
    assert.equal(leerConfigVoz({ VOZ_ENABLED: "TRUE" }).habilitada, true);
  });
  await prueba("límite por IP: tope por minuto, otra IP no se ve afectada, y se libera con el tiempo", () => {
    reiniciarLimiteVoz();
    const t0 = 1_000_000;
    for (let i = 0; i < TOPE_POR_MINUTO; i++) assert.equal(tomarCupoVoz("1.1.1.1", t0 + i).permitido, true);
    const bloqueado = tomarCupoVoz("1.1.1.1", t0 + 100);
    assert.equal(bloqueado.permitido, false);
    assert.ok(!bloqueado.permitido && bloqueado.reintentarEnSeg >= 1 && bloqueado.reintentarEnSeg <= 60);
    assert.equal(tomarCupoVoz("2.2.2.2", t0 + 100).permitido, true);
    assert.equal(tomarCupoVoz("1.1.1.1", t0 + 61_000).permitido, true);
  });
}

/* ---------- Cliente del VPS: firma, reintento, plazo ---------- */

type Pedido = { url: string; cabeceras: Headers; cuerpo: Uint8Array };
function vpsSimulado(respuestas: Array<() => Response | Promise<Response>>, ahora = 1_760_000_000_000): { deps: DependenciasVps; pedidos: Pedido[]; esperas: number[] } {
  const pedidos: Pedido[] = [];
  const esperas: number[] = [];
  let reloj = ahora;
  return {
    pedidos, esperas,
    deps: {
      ahora: () => reloj,
      esperar: async (ms) => { esperas.push(ms); reloj += ms; },
      fetch: (async (entrada: RequestInfo | URL, init?: RequestInit) => {
        const respuesta = respuestas[Math.min(pedidos.length, respuestas.length - 1)];
        pedidos.push({ url: String(entrada), cabeceras: new Headers(init?.headers), cuerpo: new Uint8Array(init?.body as Buffer) });
        return respuesta();
      }) as typeof fetch,
    },
  };
}
const ok = () => Response.json({ texto: "hola", duracion_s: 1.2, ms: 900 });
const status = (codigo: number, cabeceras: Record<string, string> = {}) => () => new Response("{}", { status: codigo, headers: cabeceras });

async function pruebasVps(): Promise<void> {
  await prueba("la firma es exactamente HMAC-SHA256(secreto, `${timestamp}.${sha256hex(cuerpo)}`) en hex", async () => {
    const { deps, pedidos } = vpsSimulado([ok]);
    const r = await transcribirEnVps(AUDIO, "audio/webm", CONFIG, deps);
    assert.deepEqual(r, { texto: "hola", duracion_s: 1.2, ms: 900 });
    const [p] = pedidos;
    assert.equal(p.url, `${URL_VPS}/v1/transcribir`);
    const ts = p.cabeceras.get(CABECERA_TIMESTAMP);
    assert.equal(ts, String(1_760_000_000));
    const esperada = createHmac("sha256", SECRETO).update(`${ts}.${createHash("sha256").update(AUDIO).digest("hex")}`).digest("hex");
    assert.equal(p.cabeceras.get(CABECERA_FIRMA), esperada);
    assert.match(esperada, /^[0-9a-f]{64}$/);
    assert.equal(firmarPedido(SECRETO, 1_760_000_000, AUDIO), esperada);
    assert.equal(p.cabeceras.get("content-type"), "audio/webm");
    assert.deepEqual([...p.cuerpo], [...AUDIO]);
    assert.ok(![...p.cabeceras.values()].some((v) => v.includes(SECRETO)), "el secreto no viaja, solo la firma");
  });
  await prueba("vector de firma conocido (calculado aparte con Python hmac/hashlib): secreto «s», instante 1700000000, cuerpo «abc»", () => {
    assert.equal(firmarPedido("s", 1700000000, new TextEncoder().encode("abc")), "8b45e13ae308b103625e7b23feed05a36b5ae7caa4bafdb14b6d789a69bd29a1");
  });
  await prueba("otro cuerpo, otro instante u otro secreto dan otra firma", () => {
    const base = firmarPedido(SECRETO, 1000, AUDIO);
    assert.notEqual(base, firmarPedido(SECRETO, 1001, AUDIO));
    assert.notEqual(base, firmarPedido(SECRETO, 1000, new Uint8Array([1])));
    assert.notEqual(base, firmarPedido("otro", 1000, AUDIO));
  });
  await prueba("503 con Retry-After: UN reintento tras esperar lo pedido, con firma y hora nuevas", async () => {
    const { deps, pedidos, esperas } = vpsSimulado([status(503, { "Retry-After": "2" }), ok]);
    const r = await transcribirEnVps(AUDIO, "audio/webm", CONFIG, deps);
    assert.equal(r.texto, "hola");
    assert.equal(pedidos.length, 2);
    assert.deepEqual(esperas, [2000]);
    assert.equal(pedidos[1].cabeceras.get(CABECERA_TIMESTAMP), String(1_760_000_002));
    assert.notEqual(pedidos[0].cabeceras.get(CABECERA_FIRMA), pedidos[1].cabeceras.get(CABECERA_FIRMA));
  });
  await prueba("reintento con Retry-After: 0 y reloj quieto: nunca firma dos veces en el mismo segundo", async () => {
    const { deps, pedidos } = vpsSimulado([status(503, { "Retry-After": "0" }), ok]);
    deps.esperar = async () => undefined;
    await transcribirEnVps(AUDIO, "audio/webm", CONFIG, deps);
    assert.equal(pedidos.length, 2);
    assert.equal(Number(pedidos[1].cabeceras.get(CABECERA_TIMESTAMP)), Number(pedidos[0].cabeceras.get(CABECERA_TIMESTAMP)) + 1);
    assert.notEqual(pedidos[0].cabeceras.get(CABECERA_FIRMA), pedidos[1].cabeceras.get(CABECERA_FIRMA));
  });
  await prueba("la espera del Retry-After está acotada", async () => {
    assert.equal(esperaDeReintento("120"), ESPERA_MAXIMA_REINTENTO_MS);
    assert.equal(esperaDeReintento(null), 1000);
    assert.equal(esperaDeReintento("abc"), 1000);
    assert.equal(esperaDeReintento("-4"), 1000);
    const { deps, esperas } = vpsSimulado([status(503, { "Retry-After": "600" }), ok]);
    await transcribirEnVps(AUDIO, "audio/webm", CONFIG, deps);
    assert.deepEqual(esperas, [ESPERA_MAXIMA_REINTENTO_MS]);
  });
  await prueba("dos 503 seguidos → ocupado, y no hay un tercer intento", async () => {
    const { deps, pedidos } = vpsSimulado([status(503, { "Retry-After": "1" })]);
    await assert.rejects(transcribirEnVps(AUDIO, "audio/webm", CONFIG, deps), (e) => e instanceof ErrorVoz && e.codigo === "ocupado" && e.reintentarEnSeg === 1);
    assert.equal(pedidos.length, 2);
  });
  await prueba("413 y 422 → demasiado largo; 401, 415, 500 o JSON raro → servicio; el estado del VPS queda en el error; sin reintento", async () => {
    for (const [codigo, esperado] of [[413, "demasiado_largo"], [422, "demasiado_largo"], [401, "servicio"], [415, "servicio"], [500, "servicio"]] as const) {
      const { deps, pedidos } = vpsSimulado([status(codigo)]);
      await assert.rejects(transcribirEnVps(AUDIO, "audio/webm", CONFIG, deps), (e) => e instanceof ErrorVoz && e.codigo === esperado && e.estadoVps === codigo && e.message.includes(`VPS ${codigo}`), String(codigo));
      assert.equal(pedidos.length, 1);
    }
    const { deps } = vpsSimulado([() => Response.json({ otra: "forma" })]);
    await assert.rejects(transcribirEnVps(AUDIO, "audio/webm", CONFIG, deps), (e) => e instanceof ErrorVoz && e.codigo === "servicio");
  });
  await prueba("sin tiempo para el reintento (el primer intento se comió el presupuesto) → ocupado, sin segundo pedido", async () => {
    let reloj = 1_760_000_000_000;
    const pedidos: number[] = [];
    const deps: DependenciasVps = {
      ahora: () => reloj,
      esperar: async (ms) => { reloj += ms; },
      fetch: (async () => { pedidos.push(reloj); reloj += 19_000; return new Response("{}", { status: 503, headers: { "Retry-After": "5" } }); }) as typeof fetch,
    };
    await assert.rejects(transcribirEnVps(AUDIO, "audio/webm", CONFIG, deps), (e) => e instanceof ErrorVoz && e.codigo === "ocupado" && e.estadoVps === 503);
    assert.equal(pedidos.length, 1);
    assert.ok(PRESUPUESTO_TOTAL_MS <= 30_000);
  });
  await prueba("sin respuesta a tiempo → tiempo_agotado; sin configurar → no_configurada; red caída → servicio", async () => {
    const { deps } = vpsSimulado([() => new Promise<Response>(() => undefined)]);
    const colgado: DependenciasVps = { ...deps, timeoutMs: 30, fetch: ((_: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_res, rechazar) => init?.signal?.addEventListener("abort", () => rechazar(init.signal?.reason)))) as typeof fetch };
    await assert.rejects(transcribirEnVps(AUDIO, "audio/webm", CONFIG, colgado), (e) => e instanceof ErrorVoz && e.codigo === "tiempo_agotado");
    await assert.rejects(transcribirEnVps(AUDIO, "audio/webm", { ...CONFIG, secreto: null }, deps), (e) => e instanceof ErrorVoz && e.codigo === "no_configurada");
    const caido: DependenciasVps = { ...deps, fetch: (async () => { throw new TypeError("fetch failed"); }) as typeof fetch };
    await assert.rejects(transcribirEnVps(AUDIO, "audio/webm", CONFIG, caido), (e) => e instanceof ErrorVoz && e.codigo === "servicio");
  });
}

/* ---------- Ruta real: auditoría sin audio ni texto ---------- */

function archivosDe(carpeta: string): string[] {
  if (!existsSync(carpeta)) return [];
  return readdirSync(carpeta, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => path.join(e.parentPath, e.name));
}

async function pruebaAuditoria(): Promise<void> {
  const raiz = mkdtempSync(path.join(tmpdir(), "prueba-voz-"));
  const entornoAntes = { ...process.env };
  const fetchAntes = globalThis.fetch;
  try {
    reiniciarEscritorParaPruebas();
    fijarConfiguracionParaPruebas({ raiz, raizAlterna: path.join(raiz, "alterna"), archivosActivos: true, nivelArchivo: "debug", nivelStdout: "error", auditoriaEnStdout: false });
    Object.assign(process.env, { VOZ_ENABLED: "true", VOZ_URL: URL_VPS, VOZ_SECRETO: SECRETO });
    delete process.env.APP_PASSWORD;
    reiniciarLimiteVoz();
    const FRASE = "frase-dictada-que-no-debe-quedar-en-el-registro";
    const reenvios: Pedido[] = [];
    globalThis.fetch = (async (entrada: RequestInfo | URL, init?: RequestInit) => {
      reenvios.push({ url: String(entrada), cabeceras: new Headers(init?.headers), cuerpo: new Uint8Array(init?.body as Buffer) });
      return Response.json({ texto: FRASE, duracion_s: 3.4, ms: 2100 });
    }) as typeof fetch;
    const { POST, GET } = await import("../../src/app/api/voz/transcribir/route");
    const r = await POST(new Request("http://localhost/api/voz/transcribir", { method: "POST", headers: { "content-type": "audio/webm", "x-conversacion-id": "conv-voz-1" }, body: AUDIO }));
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { texto: FRASE });
    assert.equal(reenvios.length, 1);
    assert.equal(reenvios[0].url, `${URL_VPS}/v1/transcribir`);
    assert.equal(reenvios[0].cabeceras.get(CABECERA_FIRMA), firmarPedido(SECRETO, Number(reenvios[0].cabeceras.get(CABECERA_TIMESTAMP)), AUDIO));
    assert.deepEqual(await (await GET(new Request("http://localhost/api/voz/transcribir"))).json(), { habilitada: true });
    await esperarRegistros();
    const todo = archivosDe(raiz).map((a) => readFileSync(a, "utf8")).join("\n");
    assert.match(todo, /"whisper-vps"/);
    assert.match(todo, /dictado_voz/);
    assert.ok(!todo.includes(FRASE), "el texto dictado no se guarda en el registro");
    assert.ok(!todo.includes(SECRETO), "el secreto no se guarda en el registro");
    assert.ok(!todo.includes(JSON.stringify([...AUDIO])) && !todo.includes("base64"), "el audio no se guarda");
    const llamada = todo.split("\n").filter((l) => l.includes("respuesta_ia")).map((l) => JSON.parse(l) as Record<string, unknown>);
    assert.ok(llamada.length > 0, "queda la respuesta_ia");
    const datos = (llamada[0].datos ?? llamada[0]) as Record<string, unknown>;
    assert.equal(datos.costeEstimadoUsd, 0);

    globalThis.fetch = (async () => new Response("{}", { status: 401 })) as typeof fetch;
    const rechazada = await POST(new Request("http://localhost/api/voz/transcribir", { method: "POST", headers: { "content-type": "audio/webm", "x-conversacion-id": "conv-voz-1" }, body: AUDIO }));
    assert.equal(rechazada.status, 502);
    assert.ok(!JSON.stringify(await rechazada.json()).includes("401"), "el estado del VPS no sale hacia el navegador");
    await esperarRegistros();
    assert.match(archivosDe(raiz).map((a) => readFileSync(a, "utf8")).join("\n"), /VPS 401/, "pero queda en la auditoría");
    const json = await POST(new Request("http://localhost/api/voz/transcribir", { method: "POST", headers: { "content-type": "audio/webm;x=json" }, body: AUDIO }));
    assert.equal(json.status, 415);

    process.env.VOZ_ENABLED = "false";
    const apagada = await POST(new Request("http://localhost/api/voz/transcribir", { method: "POST", headers: { "content-type": "audio/webm" }, body: AUDIO }));
    assert.equal(apagada.status, 404);
    pruebas += 1;
    console.log("  ✓ ruta real: audita «whisper-vps» (coste 0) sin audio ni texto, y apagada responde 404");
  } finally {
    globalThis.fetch = fetchAntes;
    for (const clave of ["VOZ_ENABLED", "VOZ_URL", "VOZ_SECRETO", "APP_PASSWORD"]) {
      if (entornoAntes[clave] === undefined) delete process.env[clave]; else process.env[clave] = entornoAntes[clave];
    }
    await esperarRegistros();
    rmSync(raiz, { recursive: true, force: true });
  }
}

/* ---------- Navegador: partes puras ---------- */

async function pruebasCliente(): Promise<void> {
  await prueba("formato de grabación: webm/opus primero, mp4 en Safari, ogg al final, null si ninguno", () => {
    assert.equal(elegirMimeGrabacion(() => true), "audio/webm;codecs=opus");
    assert.equal(elegirMimeGrabacion((m) => m === "audio/mp4"), "audio/mp4");
    assert.equal(elegirMimeGrabacion((m) => m.startsWith("audio/ogg")), "audio/ogg;codecs=opus");
    assert.equal(elegirMimeGrabacion((m) => m === "audio/ogg"), "audio/ogg");
    assert.equal(elegirMimeGrabacion(() => false), null);
    assert.ok(MIMES_GRABACION.indexOf("audio/webm;codecs=opus") < MIMES_GRABACION.indexOf("audio/mp4"));
    assert.ok(MIMES_GRABACION.indexOf("audio/mp4") < MIMES_GRABACION.indexOf("audio/ogg"));
    for (const m of MIMES_GRABACION) assert.equal(esTipoAudioAceptado(m), true, `${m} lo acepta el servidor`);
  });
  await prueba("insertar: en el cursor, reemplazando la selección, al final sin foco, con los espacios justos", () => {
    assert.deepEqual(insertarEnCursor("", "hola mundo", null), { valor: "hola mundo", cursor: 10 });
    assert.deepEqual(insertarEnCursor("pon", "la columna", null), { valor: "pon la columna", cursor: 14 });
    assert.deepEqual(insertarEnCursor("pon ", "la columna", { inicio: 4, fin: 4 }), { valor: "pon la columna", cursor: 14 });
    assert.deepEqual(insertarEnCursor("pon azul", "la columna", { inicio: 3, fin: 3 }), { valor: "pon la columna azul", cursor: 14 });
    assert.deepEqual(insertarEnCursor("hazla ROJA ahora", "azul", { inicio: 6, fin: 10 }), { valor: "hazla azul ahora", cursor: 10 });
    assert.deepEqual(insertarEnCursor("a, b", "uno", { inicio: 1, fin: 1 }), { valor: "a uno, b", cursor: 5 });
    assert.deepEqual(insertarEnCursor("¿", "cuánto cuesta", { inicio: 1, fin: 1 }), { valor: "¿cuánto cuesta", cursor: 14 });
    assert.equal(insertarEnCursor("x", "  mucho \n  espacio  ", null).valor, "x mucho espacio");
    assert.deepEqual(insertarEnCursor("igual", "   ", { inicio: 2, fin: 2 }), { valor: "igual", cursor: 2 });
    assert.deepEqual(insertarEnCursor("abc", "def", { inicio: 99, fin: 99 }), { valor: "abc def", cursor: 7 });
    assert.deepEqual(insertarEnCursor("abc", "def", { inicio: 3, fin: 0 }), { valor: "def", cursor: 3 });
  });
  await prueba("insertar respeta maxLength recortando el dictado, no lo escrito", () => {
    const r = insertarEnCursor("12345", "abcdefghij", null, 12);
    assert.equal(r.valor, "12345 abcdef");
    assert.equal(r.valor.length, 12);
    assert.equal(r.cursor, 12);
    const medio = insertarEnCursor("ab cd", "XXXXXXXX", { inicio: 3, fin: 3 }, 9);
    assert.ok(medio.valor.length <= 9 && medio.valor.startsWith("ab ") && medio.valor.endsWith("cd"), medio.valor);
  });
  await prueba("máquina de estados: reposo → permiso → grabando → transcribiendo → reposo; lo fuera de turno no cambia nada", () => {
    const paso = (e: EstadoDictado, ev: EventoDictado) => reducirDictado(e, ev);
    let e: EstadoDictado = ESTADO_INICIAL;
    e = paso(e, { tipo: "pedir" }); assert.equal(e.fase, "permiso");
    assert.equal(paso(e, { tipo: "pedir" }), e);
    assert.equal(paso(e, { tipo: "detener" }), e);
    e = paso(e, { tipo: "grabando" }); assert.equal(e.fase, "grabando");
    e = paso(e, { tipo: "detener" }); assert.equal(e.fase, "transcribiendo");
    assert.equal(paso(e, { tipo: "grabando" }), e);
    e = paso(e, { tipo: "terminado" }); assert.deepEqual(e, { fase: "reposo", error: null });
    for (const desde of [{ fase: "permiso" }, { fase: "grabando" }, { fase: "transcribiendo" }] as EstadoDictado[]) {
      assert.deepEqual(paso(desde, { tipo: "cancelar" }), { fase: "reposo", error: null });
      assert.deepEqual(paso(desde, { tipo: "fallo", codigo: "sin_permiso" }), { fase: "reposo", error: "sin_permiso" });
    }
    const conError = paso(ESTADO_INICIAL, { tipo: "fallo", codigo: "ocupado" });
    assert.deepEqual(paso(conError, { tipo: "descartar_error" }), ESTADO_INICIAL);
    assert.equal(paso({ fase: "grabando" }, { tipo: "descartar_error" }).fase, "grabando");
    assert.equal(paso(ESTADO_INICIAL, { tipo: "cancelar" }), ESTADO_INICIAL);
  });
  await prueba("tiempo 0:07 / 1:00 y errores en español para cada caso", () => {
    assert.equal(formatearTiempo(0), "0:00");
    assert.equal(formatearTiempo(7.9), "0:07");
    assert.equal(formatearTiempo(60), "1:00");
    assert.equal(formatearTiempo(-3), "0:00");
    assert.equal(codigoDeEstadoHttp(401), "sesion");
    assert.equal(codigoDeEstadoHttp(404), "no_disponible");
    assert.equal(codigoDeEstadoHttp(413), "demasiado_largo");
    assert.equal(codigoDeEstadoHttp(429), "demasiados");
    assert.equal(codigoDeEstadoHttp(503), "ocupado");
    assert.equal(codigoDeEstadoHttp(503, "no_configurada"), "no_disponible");
    assert.equal(codigoDeEstadoHttp(502), "fallo");
    assert.equal(codigoDeErrorMicrofono(new DOMException("x", "NotAllowedError")), "sin_permiso");
    assert.equal(codigoDeErrorMicrofono(new DOMException("x", "NotFoundError")), "sin_microfono");
    assert.equal(codigoDeErrorMicrofono(new Error("raro")), "fallo");
    for (const [codigo, mensaje] of Object.entries(MENSAJES_ERROR_DICTADO)) assert.ok(mensaje.length > 10 && /[a-záéíóúñ]/i.test(mensaje) && !/[{}]/.test(mensaje), codigo);
    assert.match(MENSAJES_ERROR_DICTADO.sin_permiso, /micrófono/);
    assert.match(MENSAJES_ERROR_DICTADO.demasiado_largo, /60 segundos/);
    assert.match(MENSAJES_ERROR_DICTADO.sin_conexion, /conexión/);
    assert.match(MENSAJES_ERROR_DICTADO.ocupado, /ocupado/);
  });
}

async function principal(): Promise<void> {
  console.log("Ruta /api/voz/transcribir");
  await pruebasRuta();
  console.log("Cliente del VPS");
  await pruebasVps();
  console.log("Auditoría");
  await pruebaAuditoria();
  console.log("Navegador");
  await pruebasCliente();
  console.log(`\n[PASS] ${pruebas} pruebas del dictado por voz`);
}

principal().catch((error) => {
  console.error(error);
  process.exit(1);
});
