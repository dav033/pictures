/**
 * Pruebas sin coste (ni red ni proveedores) de src/lib/registro:
 *   npx tsx --conditions=react-server scripts/test/test-registro.ts
 * Redacción, recorte, circulares, niveles, contexto concurrente, archivos por conversación con id saneado,
 * rotación/retención, degradación cuando el disco no se puede escribir, topes y los envoltorios de IA.
 */
// Antes de cualquier import del registro: la lista de secretos del entorno se lee la primera vez.
const SECRETO_ENTORNO = "valor-super-secreto-del-entorno-9137";
process.env.PRUEBA_REGISTRO_API_KEY = SECRETO_ENTORNO;

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ChatPort, FragmentoChat, PeticionChat, TurnoChat } from "@sempertex/agente-core";
import { fijarConfiguracionParaPruebas } from "../../src/lib/registro/configuracion";
import { actualizarContexto, cabecerasCorrelacion, conContexto, contextoActual, contextoDesdeRequest, sanearIdConversacion } from "../../src/lib/registro/contexto";
import {
  auditarGeneracionImagen,
  crearFetchAuditado,
  envolverChatPort,
  envolverClienteGemini,
  envolverRegistroHerramientas,
} from "../../src/lib/registro/envoltorios";
import { diagnosticoEscritor, esperarRegistros, fechaUtc, limpiarAntiguos, reiniciarEscritorParaPruebas, rutaGeneral } from "../../src/lib/registro/escritor";
import { esClaveSecreta, MARCA_OCULTO, redactar, resumirDatos, sanearTexto, serializarError } from "../../src/lib/registro/redaccion";
import { auditar, registrar } from "../../src/lib/registro/registro";
import { conRegistro } from "../../src/lib/registro/ruta";

const BASE = mkdtempSync(path.join(tmpdir(), "prueba-registro-"));
let pruebas = 0;

function ok(nombre: string): void {
  pruebas += 1;
  console.log(`[PASS] ${nombre}`);
}

function nuevaRaiz(nombre: string, cambios: Parameters<typeof fijarConfiguracionParaPruebas>[0] = {}): string {
  const raiz = path.join(BASE, nombre);
  reiniciarEscritorParaPruebas();
  fijarConfiguracionParaPruebas({ raiz, raizAlterna: path.join(BASE, `${nombre}-alterna`), archivosActivos: true, nivelArchivo: "debug", nivelStdout: "error", auditoriaEnStdout: false, ...cambios });
  return raiz;
}

function leerJsonl(archivo: string): Record<string, unknown>[] {
  return readFileSync(archivo, "utf8").split("\n").filter((linea) => linea.trim()).map((linea) => JSON.parse(linea) as Record<string, unknown>);
}

function archivoConversacion(raiz: string, id: string): string {
  return path.join(raiz, "conversaciones", fechaUtc(), `${id}.jsonl`);
}

function todosLosArchivos(carpeta: string): string[] {
  if (!existsSync(carpeta)) return [];
  return readdirSync(carpeta, { recursive: true, withFileTypes: true }).filter((entrada) => entrada.isFile()).map((entrada) => path.join(entrada.parentPath, entrada.name));
}

function silenciar<T>(fn: () => Promise<T>): Promise<{ resultado: T; salida: string[] }> {
  const salida: string[] = [];
  const originales = { log: console.log, warn: console.warn, error: console.error };
  console.log = (...args: unknown[]) => salida.push(`log:${args.join(" ")}`);
  console.warn = (...args: unknown[]) => salida.push(`warn:${args.join(" ")}`);
  console.error = (...args: unknown[]) => salida.push(`error:${args.join(" ")}`);
  return fn().then(
    (resultado) => ({ resultado, salida }),
    (error: unknown) => {
      throw error;
    },
  ).finally(() => Object.assign(console, originales));
}

async function principal(): Promise<void> {
  /* ---------- Redacción ---------- */
  {
    const datos = redactar({
      apiKey: "abc",
      approval_token: "tok-1",
      "x-fal-key": "fal-1",
      authorization: "Bearer xyz",
      cookie: "session=1",
      password: "p",
      INTERNAL_HMAC_SECRET: "s",
      tokens: { entrada: 5, salida: 7 },
      maxTokens: 10,
      prompt_token_count: 3,
      idempotencyKey: "idem-1",
      nested: { headers: { Authorization: "Key 1234" } },
    }, { limiteCadena: 20_000 }) as Record<string, unknown>;
    for (const clave of ["apiKey", "approval_token", "x-fal-key", "authorization", "cookie", "password", "INTERNAL_HMAC_SECRET"]) assert.equal(datos[clave], MARCA_OCULTO, clave);
    assert.deepEqual(datos.tokens, { entrada: 5, salida: 7 }, "los conteos de tokens no son secretos");
    assert.equal(datos.maxTokens, 10);
    assert.equal(datos.prompt_token_count, 3);
    assert.equal(datos.idempotencyKey, "idem-1", "una llave de idempotencia no es un secreto");
    assert.equal((datos.nested as { headers: Record<string, unknown> }).headers.Authorization, MARCA_OCULTO);
    assert.equal(esClaveSecreta("thinkingBudgetTokens"), false);
    assert.equal(esClaveSecreta("planToken"), true);
    ok("redacción: claves tipo secreto ocultas, conteos de tokens intactos");
  }
  {
    const llaveFal = "0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b:0123456789abcdef0123456789abcdef";
    const texto = `uso ${SECRETO_ENTORNO} y Key ${llaveFal} y Bearer abc123def456ghi789jkl; Key features of the design; AIza${"A".repeat(35)}`;
    const saneado = sanearTexto(texto);
    assert.ok(!saneado.includes(SECRETO_ENTORNO), "valor de secreto del entorno");
    assert.ok(!saneado.includes(llaveFal), "llave de fal");
    assert.ok(!saneado.includes("abc123def456ghi789jkl"), "bearer");
    assert.ok(saneado.includes("Key features of the design"), "texto normal intacto");
    assert.ok(!saneado.includes(`AIza${"A".repeat(35)}`), "llave de Google");
    const url = sanearTexto("https://api.example.com/v1?key=AIzaXYZ&model=x&token=t0k&sig=abc postgres://usuario:clave-db@host:5432/db");
    assert.ok(url.includes("key=[oculto]") && url.includes("token=[oculto]") && url.includes("sig=[oculto]") && url.includes("model=x"), url);
    assert.ok(url.includes("usuario:[oculto]@host") && !url.includes("clave-db"), url);
    ok("redacción: secretos del entorno, cabeceras pegadas, llaves conocidas, URLs con key/token y usuario:clave@");
  }
  {
    const bytes = Buffer.from("imagen-de-prueba-".repeat(100));
    const base64 = bytes.toString("base64");
    const esperado = createHash("sha256").update(bytes).digest("hex");
    const datos = redactar({ foto: `data:image/png;base64,${base64}`, imagenes: [{ base64, mime: "image/jpeg" }], suelto: base64, corto: { base64: Buffer.from("x".repeat(60)).toString("base64") } }, { limiteCadena: 20_000 }) as Record<string, unknown>;
    assert.deepEqual(datos.foto, { imagen: esperado, bytes: bytes.length, mime: "image/png" });
    assert.deepEqual((datos.imagenes as Array<Record<string, unknown>>)[0]!.base64, { imagen: esperado, bytes: bytes.length });
    assert.deepEqual(datos.suelto, { imagen: esperado, bytes: bytes.length }, "base64 largo sin clave también se convierte en hash");
    assert.equal(typeof (datos.corto as Record<string, unknown>).base64, "object", "clave base64 con valor corto también");
    const enTexto = sanearTexto(`mira data:image/png;base64,${base64} ahí`);
    assert.ok(enTexto.includes(`sha256=${esperado.slice(0, 16)}`) && !enTexto.includes(base64.slice(0, 80)), "data URL dentro de un texto");
    ok("redacción: data URLs y base64 → {imagen: sha256 de los bytes, bytes, mime}");
  }
  {
    const largo = "a b ".repeat(7_000);
    const auditoria = redactar({ largo }, { limiteCadena: 20_000 }) as Record<string, string>;
    assert.ok(auditoria.largo!.length < 20_100 && auditoria.largo!.endsWith(`[recortado: ${largo.length - 20_000} caracteres más]`));
    const dosVeces = redactar(auditoria, { limiteCadena: 20_000 }) as Record<string, string>;
    assert.equal(dosVeces.largo, auditoria.largo, "recortar dos veces con el mismo límite no apila marcas");
    const general = redactar({ largo }, { limiteCadena: 2_000 }) as Record<string, string>;
    assert.ok(general.largo!.length < 2_100);
    const circular: Record<string, unknown> = { nombre: "a" };
    circular.yo = circular;
    const compartido = { x: 1 };
    const conCircular = redactar({ circular, a: compartido, b: compartido }, { limiteCadena: 100 }) as Record<string, Record<string, unknown>>;
    assert.equal(conCircular.circular!.yo, "[circular]");
    assert.deepEqual(conCircular.b, { x: 1 }, "una referencia compartida no circular se conserva");
    let profundo: Record<string, unknown> = { fondo: true };
    for (let nivel = 0; nivel < 30; nivel += 1) profundo = { dentro: profundo };
    assert.ok(JSON.stringify(redactar(profundo, { limiteCadena: 100 })).includes("[profundidad máxima]"));
    assert.equal(redactar({ entorno: process.env }, { limiteCadena: 100 }) instanceof Object && (redactar({ entorno: process.env }, { limiteCadena: 100 }) as Record<string, unknown>).entorno, "[process.env omitido]");
    const muchos = redactar(Array.from({ length: 1_000 }, (_, indice) => indice), { limiteCadena: 100 }) as unknown[];
    assert.equal(muchos.length, 501);
    const error = serializarError(new Error(`falló con ${SECRETO_ENTORNO}`, { cause: new TypeError("causa") }));
    assert.ok(!error.mensaje.includes(SECRETO_ENTORNO) && error.pila && typeof error.causa === "object");
    const resumen = resumirDatos({ texto: "x".repeat(500), n: 3, lista: [1, 2], foto: { imagen: "f".repeat(64), bytes: 9 } }) as Record<string, unknown>;
    assert.ok((resumen.texto as string).length < 200 && resumen.lista_n === 2 && (resumen.foto as Record<string, unknown>).bytes === 9);
    ok("redacción: recorte con marca (20 000/2 000), circulares, profundidad, process.env, listas, errores con causa y resumen");
  }

  /* ---------- Niveles y salida ---------- */
  {
    const raiz = nuevaRaiz("niveles", { nivelArchivo: "info", nivelStdout: "warn" });
    const { salida } = await silenciar(async () => {
      registrar("debug", "prueba.depurar", { x: 1 });
      registrar("info", "prueba.informar", { x: 2 });
      registrar("warn", "prueba.avisar", { x: 3 });
      registrar("error", "prueba.error", { x: 4 }, { error: new Error("boom") });
      await esperarRegistros();
    });
    const lineas = leerJsonl(path.join(raiz, rutaGeneral()));
    const eventos = lineas.map((linea) => linea.evento);
    assert.deepEqual(eventos, ["prueba.informar", "prueba.avisar", "prueba.error"], "debug no llega al archivo con nivel info");
    assert.ok(salida.some((linea) => linea.startsWith("warn:") && linea.includes("prueba.avisar")));
    assert.ok(salida.some((linea) => linea.startsWith("error:") && linea.includes("prueba.error")));
    assert.ok(!salida.some((linea) => linea.includes("prueba.informar")), "info no sale por stdout con nivel warn");
    const linea = lineas[2]!;
    for (const campo of ["ts", "nivel", "servicio", "entorno", "evento", "datos", "error"]) assert.ok(campo in linea, campo);
    assert.equal((linea.error as Record<string, unknown>).mensaje, "boom");
    ok("niveles: umbrales separados de archivo y stdout; warn/error a stderr; forma de la línea general");
  }

  /* ---------- Contexto AsyncLocalStorage ---------- */
  {
    const raiz = nuevaRaiz("contexto");
    const esperar = (ms: number) => new Promise((resolver) => setTimeout(resolver, ms));
    await Promise.all(Array.from({ length: 8 }, (_, indice) => conContexto({ conversacion: `conv-${indice}`, solicitud: `sol-${indice}`, vista: indice % 2 ? "guiada" : "clasica", ruta: "/api/prueba" }, async () => {
      for (let paso = 0; paso < 5; paso += 1) {
        await esperar(Math.floor(Math.random() * 8));
        registrar("info", "prueba.paso", { indice, paso });
        auditar("decision", { quien: "regla:prueba", que: "paso", resultado: { indice, paso } });
      }
      assert.equal(contextoActual()?.conversacion, `conv-${indice}`);
    })));
    await esperarRegistros();
    const generales = leerJsonl(path.join(raiz, rutaGeneral())).filter((linea) => linea.evento === "prueba.paso");
    assert.equal(generales.length, 40);
    for (const linea of generales) assert.equal(linea.conversacion, `conv-${(linea.datos as { indice: number }).indice}`, "sin mezcla entre peticiones");
    for (let indice = 0; indice < 8; indice += 1) {
      const auditoria = leerJsonl(archivoConversacion(raiz, `conv-${indice}`));
      assert.equal(auditoria.length, 5);
      assert.ok(auditoria.every((linea) => linea.solicitud === `sol-${indice}` && linea.vista === (indice % 2 ? "guiada" : "clasica")));
    }
    conContexto({ solicitud: "s-1" }, () => {
      actualizarContexto({ conversacion: "tardia" });
      assert.deepEqual(cabecerasCorrelacion(), { "x-request-id": "s-1", "x-conversacion-id": "tardia" });
    });
    assert.equal(contextoActual(), undefined, "fuera de conContexto no hay contexto");
    const desdeRequest = contextoDesdeRequest(new Request("http://x/api/chat", { headers: { "x-request-id": "abc", "x-vista": "guiada" } }), { estadoGuiado: { idConversacion: "guiada-1" } });
    assert.equal(desdeRequest.solicitud, "abc");
    assert.equal(desdeRequest.conversacion, "guiada-1");
    assert.equal(desdeRequest.vista, "guiada");
    assert.equal(desdeRequest.ruta, "/api/chat");
    ok("contexto: 8 peticiones concurrentes sin mezclar solicitud/conversación/vista; actualizarContexto; contextoDesdeRequest");
  }

  /* ---------- Archivo por conversación ---------- */
  {
    const raiz = nuevaRaiz("conversaciones");
    assert.equal(sanearIdConversacion("../../etc/passwd x"), "etc-passwd-x");
    assert.equal(sanearIdConversacion("a".repeat(100))!.length, 64);
    assert.equal(sanearIdConversacion("///"), undefined);
    conContexto({ conversacion: "../../etc/passwd x", solicitud: "s1" }, () => auditar("accion_cliente", { evento: "boton" }));
    conContexto({ solicitud: "solicitud-sin-id" }, () => auditar("aviso", { motivo: "prueba" }));
    auditar("aviso", { motivo: "fuera" });
    await esperarRegistros();
    assert.ok(existsSync(archivoConversacion(raiz, "etc-passwd-x")));
    assert.ok(existsSync(archivoConversacion(raiz, "sin-conversacion-solicitud-sin-id")));
    assert.ok(existsSync(archivoConversacion(raiz, "sin-conversacion-fuera-de-peticion")));
    assert.ok(todosLosArchivos(BASE).every((archivo) => archivo.startsWith(BASE)), "nada escrito fuera de la raíz");
    const resumen = leerJsonl(path.join(raiz, rutaGeneral())).find((linea) => linea.evento === "auditoria.accion_cliente");
    assert.equal(resumen?.conversacion, "etc-passwd-x", "el resumen del general lleva la conversación");
    ok("conversación: id saneado como nombre de archivo, sin-conversacion-<solicitud>, resumen en el general");
  }

  /* ---------- Rotación y retención ---------- */
  {
    const raiz = nuevaRaiz("retencion");
    mkdirSync(path.join(raiz, "general"), { recursive: true });
    const ahora = new Date("2026-10-06T12:00:00Z");
    for (const fecha of ["2026-09-01", "2026-09-21", "2026-09-22", "2026-10-06"]) writeFileSync(path.join(raiz, "general", `next-${fecha}.jsonl`), "{}\n");
    for (const fecha of ["2026-08-01", "2026-09-05", "2026-09-06", "2026-10-06"]) {
      mkdirSync(path.join(raiz, "conversaciones", fecha), { recursive: true });
      writeFileSync(path.join(raiz, "conversaciones", fecha, "c.jsonl"), "{}\n");
    }
    writeFileSync(path.join(raiz, "general", "otro.txt"), "no se toca");
    const borrados = await limpiarAntiguos(raiz, { retencionGeneralDias: 14, retencionConversacionesDias: 30 }, ahora);
    assert.deepEqual(readdirSync(path.join(raiz, "general")).sort(), ["next-2026-09-22.jsonl", "next-2026-10-06.jsonl", "otro.txt"]);
    assert.deepEqual(readdirSync(path.join(raiz, "conversaciones")).sort(), ["2026-09-06", "2026-10-06"]);
    assert.equal(borrados.length, 4);
    assert.equal(rutaGeneral(new Date("2026-01-02T23:59:59Z")), path.join("general", "next-2026-01-02.jsonl"), "rotación diaria por nombre (UTC)");
    ok("rotación diaria (UTC) y retención por fecha del nombre: general 14 días, conversaciones 30");
  }

  /* ---------- Disco no escribible ---------- */
  {
    const bloqueo = path.join(BASE, "bloqueo-archivo");
    writeFileSync(bloqueo, "soy un archivo, no una carpeta");
    const alterna = path.join(BASE, "alterna-ok");
    reiniciarEscritorParaPruebas();
    fijarConfiguracionParaPruebas({ raiz: path.join(bloqueo, "registros"), raizAlterna: alterna, archivosActivos: true, nivelArchivo: "debug", nivelStdout: "error", auditoriaEnStdout: false });
    const { salida } = await silenciar(async () => {
      registrar("info", "prueba.degradado", { x: 1 });
      auditar("aviso", { motivo: "degradado" }, { conversacion: "conv-degradada" });
      await esperarRegistros();
    });
    assert.equal(diagnosticoEscritor().modo, "alterna");
    assert.ok(salida.some((linea) => linea.includes("registro.dir_degradado")), "avisa una vez por stdout");
    const generales = leerJsonl(path.join(alterna, rutaGeneral()));
    assert.ok(generales.some((linea) => linea.evento === "prueba.degradado") && generales.some((linea) => linea.evento === "registro.dir_degradado"));
    assert.ok(existsSync(archivoConversacion(alterna, "conv-degradada")));
    reiniciarEscritorParaPruebas();
    fijarConfiguracionParaPruebas({ raiz: path.join(bloqueo, "a"), raizAlterna: path.join(bloqueo, "b"), archivosActivos: true, nivelArchivo: "debug", nivelStdout: "error", auditoriaEnStdout: false });
    const sinDisco = await silenciar(async () => {
      for (let indice = 0; indice < 5; indice += 1) registrar("info", "prueba.sin_disco", { indice });
      await esperarRegistros();
      return diagnosticoEscritor().modo;
    });
    assert.equal(sinDisco.resultado, "desactivado");
    assert.ok(sinDisco.salida.some((linea) => linea.includes("registro.archivos_desactivados")));
    ok("disco no escribible: degrada a la raíz alterna con aviso; sin ninguna, solo stdout; nunca lanza");
  }

  /* ---------- Topes ---------- */
  {
    const raiz = nuevaRaiz("topes", { topeConversacionBytes: 3_000 });
    await silenciar(async () => {
      for (let indice = 0; indice < 40; indice += 1) auditar("decision", { quien: "regla:tope", que: "relleno", resultado: "x".repeat(200) }, { conversacion: "conv-tope" });
      await esperarRegistros();
    });
    const lineas = leerJsonl(archivoConversacion(raiz, "conv-tope"));
    assert.equal(lineas.at(-1)?.tipo, "aviso");
    assert.equal((lineas.at(-1)?.datos as Record<string, unknown>).motivo, "tope_conversacion");
    assert.ok(readFileSync(archivoConversacion(raiz, "conv-tope")).length < 3_000 + 600);
    const resumenes = leerJsonl(path.join(raiz, rutaGeneral())).filter((linea) => linea.evento === "auditoria.decision");
    assert.equal(resumenes.length, 40, "el resumen en el general sigue aunque la conversación esté topada");
    ok("tope por conversación: aviso final y solo resúmenes en el general a partir de ahí");
  }

  /* ---------- Envoltorios de IA ---------- */
  {
    const raiz = nuevaRaiz("envoltorios");
    const turno: TurnoChat = { texto: "Hola, te propongo un arco.", llamadas: [{ id: "l1", nombre: "proponer_composicion", args: { frase: "x" } }], uso: { entrada: 1200, salida: 80, pensamiento: 10 }, modelo: "modelo-falso", finishReason: "STOP" };
    const errorProveedor = new Error("cuota agotada");
    let fallar = false;
    const falso: ChatPort = {
      id: "gemini",
      modelo: "modelo-falso",
      thinkingLevel: "low",
      turno: async () => {
        if (fallar) throw errorProveedor;
        return turno;
      },
      turnoStream: async function* (): AsyncGenerator<FragmentoChat> {
        yield { tipo: "texto", delta: "Hola, " };
        yield { tipo: "texto", delta: "te propongo un arco." };
        yield { tipo: "fin", ...turno };
      },
    };
    const chat = envolverChatPort(falso, { proposito: "chat_guiado", versionSistema: "asistente-guiado.v2" });
    assert.equal(envolverChatPort(chat, { proposito: "otro" }), chat, "idempotente");
    const imagen = Buffer.from("foto".repeat(300)).toString("base64");
    const peticion: PeticionChat = { sistema: `Eres un asistente. ${SECRETO_ENTORNO}`, historial: [{ rol: "usuario", texto: "Quiero algo para un cumpleaños", imagenes: [{ base64: imagen, mime: "image/jpeg", id: "INSPIRACION" }] }], herramientas: [{ nombre: "proponer_composicion", descripcion: "Propone", esquema: { type: "object" } }] };
    await conContexto({ conversacion: "conv-ia", solicitud: "turno-1", vista: "guiada", ruta: "/api/asistente-guiado" }, async () => {
      assert.equal(await chat.turno(peticion), turno, "devuelve exactamente lo mismo");
      const fragmentos: FragmentoChat[] = [];
      for await (const fragmento of chat.turnoStream({ ...peticion, historial: [...peticion.historial, { rol: "asistente", texto: "¿Para cuándo?" }] })) fragmentos.push(fragmento);
      assert.equal(fragmentos.length, 3);
      fallar = true;
      await assert.rejects(chat.turno(peticion), (error) => error === errorProveedor, "relanza el mismo error");
      const herramientas = envolverRegistroHerramientas({
        buscar: async (args: Record<string, unknown>) => ({ ideas: [args.tematica], ok: true }),
        romper: async () => {
          throw new Error("herramienta rota");
        },
      });
      assert.deepEqual(await herramientas.buscar({ tematica: "safari" }), { ideas: ["safari"], ok: true });
      await assert.rejects(herramientas.romper(), /herramienta rota/);
      const respuestaGemini = { candidates: [{ content: { parts: [{ text: "{\"intent\":\"x\"}" }, { text: "pensando", thought: true }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 5 }, modelVersion: "gemini-x" };
      const cliente = envolverClienteGemini({ models: { generateContent: async (parametros: unknown) => ({ ...respuestaGemini, eco: parametros }), embedContent: async () => ({ embeddings: [{ values: [0.1, 0.2, 0.3] }] }) }, otro: 1 }, { proposito: "parser_intencion" });
      const generado = await cliente.models.generateContent({ model: "gemini-x", contents: [{ role: "user", parts: [{ text: "globos rojos" }] }], config: { systemInstruction: "Extrae la intención.", responseMimeType: "application/json" } });
      assert.equal(generado.modelVersion, "gemini-x");
      assert.equal(cliente.otro, 1);
      await cliente.models.embedContent();
      const fetchFalso = (async () => new Response(JSON.stringify({ schema_version: "operational.v1", payload: { ok: true, imagen: `data:image/png;base64,${imagen}` } }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
      const fetchPython = crearFetchAuditado(fetchFalso, { tipo: "python" });
      const respuesta = await fetchPython("http://127.0.0.1:8000/internal/v1/plan/resolve", { method: "POST", headers: { "x-request-id": "req-py", "x-internal-signature": "firma" }, body: JSON.stringify({ context: { request_id: "req-py" }, payload: { plan: 1, api_key: "no" } }) });
      assert.deepEqual(((await respuesta.json()) as { payload: { ok: boolean } }).payload.ok, true, "el llamante sigue pudiendo leer la respuesta");
      const fetchPythonIa = crearFetchAuditado((async () => new Response(JSON.stringify({ schema_version: "operational.v1", payload: { intent: "decorar", model: "gemini-x" } }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch, {
        tipo: "python",
        propositoIa: (ruta) => (ruta.endsWith("/ia/intent-parse") ? "parser_intencion_python" : undefined),
      });
      await (await fetchPythonIa("http://127.0.0.1:8000/internal/v1/ia/intent-parse", { method: "POST", body: JSON.stringify({ context: { request_id: "r" }, payload: { message: "globos rojos", systemInstruction: "Extrae la intención.", model: "gemini-x" } }) })).json();
      const fetchRoto = crearFetchAuditado((async () => {
        throw new TypeError("fetch failed");
      }) as typeof fetch, { tipo: "http", proveedor: "fal" });
      await assert.rejects(fetchRoto(`https://queue.fal.run/fal-ai/flux-2?key=${SECRETO_ENTORNO}`), /fetch failed/);
      const generada = await auditarGeneracionImagen(
        { proveedor: "fal", endpoint: "https://queue.fal.run/fal-ai/flux-2/edit", prompt: "a balloon arch", referencias: [{ base64: imagen, mime: "image/jpeg", rol: "scene_guide" }], parametros: { seed: 7, guidance_scale: 3.5 } },
        async () => ({ base64: imagen, mime: "image/png" }),
        (resultado) => ({ base64: resultado.base64, mime: resultado.mime }),
      );
      assert.equal(generada.mime, "image/png");
    });
    await esperarRegistros();
    await new Promise((resolver) => setTimeout(resolver, 50));
    await esperarRegistros();
    const lineas = leerJsonl(archivoConversacion(raiz, "conv-ia"));
    const tipos = lineas.map((linea) => linea.tipo);
    for (const tipo of ["llamada_ia", "respuesta_ia", "herramienta", "python", "http", "imagen"]) assert.ok(tipos.includes(tipo), `falta ${tipo}`);
    const llamadas = lineas.filter((linea) => linea.tipo === "llamada_ia").map((linea) => linea.datos as Record<string, unknown>);
    const primera = llamadas[0]!;
    assert.equal(primera.proposito, "chat_guiado");
    assert.equal((primera.sistema as Record<string, unknown>).version, "asistente-guiado.v2");
    assert.ok(typeof (primera.sistema as Record<string, unknown>).texto === "string", "prompt de sistema completo la primera vez");
    assert.equal((llamadas[1]!.sistema as Record<string, unknown>).texto, undefined, "y solo una referencia después");
    const mensajesSegunda = llamadas[1]!.mensajes as Array<Record<string, unknown>>;
    assert.ok(mensajesSegunda[0]!.ref && !mensajesSegunda[1]!.ref, "historial repetido como referencia; mensaje nuevo completo");
    const respuestas = lineas.filter((linea) => linea.tipo === "respuesta_ia").map((linea) => linea.datos as Record<string, unknown>);
    assert.equal(respuestas[0]!.motivoFin, "STOP");
    assert.deepEqual((respuestas[0]!.llamadasHerramientas as unknown[]).length, 1);
    assert.equal(respuestas[1]!.texto, "Hola, te propongo un arco.");
    assert.equal((respuestas[2]!.error as Record<string, unknown>).mensaje, "cuota agotada");
    const gemini = respuestas.find((respuesta) => respuesta.proposito === "parser_intencion")!;
    assert.equal(gemini.texto, "{\"intent\":\"x\"}", "texto sin las partes de pensamiento");
    assert.deepEqual(respuestas.find((respuesta) => respuesta.proposito === "embedding")?.crudo, { embeddings: 1, dimensiones: 3 });
    const herramientas = lineas.filter((linea) => linea.tipo === "herramienta").map((linea) => linea.datos as Record<string, unknown>);
    assert.equal(herramientas[0]!.ok, true);
    assert.equal((herramientas[1]!.error as Record<string, unknown>).mensaje, "herramienta rota");
    const python = lineas.find((linea) => linea.tipo === "python")!.datos as Record<string, unknown>;
    assert.equal(python.ruta, "/internal/v1/plan/resolve");
    assert.equal(python.requestId, "req-py");
    assert.equal(((python.cuerpoEnviado as Record<string, unknown>).payload as Record<string, unknown>).api_key, MARCA_OCULTO);
    assert.equal(typeof ((python.cuerpoRecibido as Record<string, unknown>).payload as Record<string, unknown>).imagen, "object", "imagen de la respuesta como hash");
    const llamadaPython = llamadas.find((llamada) => llamada.proposito === "parser_intencion_python")!;
    assert.equal(llamadaPython.proveedor, "python");
    assert.equal(llamadaPython.modelo, "gemini-x");
    assert.equal(((llamadaPython.mensajes as Array<Record<string, unknown>>)[0]!).systemInstruction, "Extrae la intención.");
    const respuestaPython = respuestas.find((respuesta) => respuesta.proposito === "parser_intencion_python")!;
    assert.equal((respuestaPython.crudo as Record<string, unknown>).intent, "decorar");
    const eventoPythonIa = lineas.find((linea) => linea.tipo === "python" && (linea.datos as Record<string, unknown>).ruta === "/internal/v1/ia/intent-parse")!.datos as Record<string, unknown>;
    assert.deepEqual(eventoPythonIa.cuerpoEnviado, { verLlamadaIa: llamadaPython.llamada }, "el evento python apunta a la llamada_ia en vez de repetir el cuerpo");
    const http = lineas.find((linea) => linea.tipo === "http")!.datos as Record<string, unknown>;
    assert.ok(String(http.url).includes("key=[oculto]") && (http.error as Record<string, unknown>).mensaje === "fetch failed");
    const imagenAuditada = lineas.find((linea) => linea.tipo === "imagen")!.datos as Record<string, unknown>;
    assert.equal(((imagenAuditada.referencias as Array<Record<string, unknown>>)[0]!).rol, "scene_guide");
    assert.equal(typeof (imagenAuditada.resultado as Record<string, unknown>).imagen, "string");
    ok("envoltorios: ChatPort (turno, stream, error), Gemini directo (texto sin pensamiento, embedding), herramientas, fetch Python (con y sin IA) y fal, imagen");
  }

  /* ---------- conRegistro (route handler) ---------- */
  {
    const raiz = nuevaRaiz("rutas");
    const sse = conRegistro("/api/prueba-sse", async () => {
      const codificador = new TextEncoder();
      const cuerpo = new ReadableStream<Uint8Array>({
        start(controlador) {
          controlador.enqueue(codificador.encode("event: texto\ndata: {\"type\":\"texto\",\"delta\":\"Hola \"}\n\n"));
          controlador.enqueue(codificador.encode("event: texto\ndata: {\"type\":\"texto\",\"delta\":\"mundo\"}\n\nevent: herramienta\ndata: {\"type\":\"herramienta\",\"nombre\":\"buscar\",\"estado\":\"lista\"}\n\n"));
          controlador.enqueue(codificador.encode("event: fin\ndata: {\"type\":\"fin\",\"reply\":\"Hola mundo\",\"result\":{\"propuesta\":{\"piezas\":2}}}\n\n"));
          controlador.close();
        },
      });
      return new Response(cuerpo, { headers: { "Content-Type": "text/event-stream; charset=utf-8" } });
    }, { vista: "guiada" });
    const foto = Buffer.from("png".repeat(400)).toString("base64");
    const respuesta = await sse(new Request("http://localhost/api/prueba-sse", { method: "POST", headers: { "content-type": "application/json", "x-conversacion-id": "conv-ruta" }, body: JSON.stringify({ messages: [{ role: "user", content: "Hola" }], fotoInspiracion: { base64: foto, mime: "image/jpeg" }, estadoGuiado: { uso: "personal" } }) }));
    assert.equal(await respuesta.text(), "event: texto\ndata: {\"type\":\"texto\",\"delta\":\"Hola \"}\n\nevent: texto\ndata: {\"type\":\"texto\",\"delta\":\"mundo\"}\n\nevent: herramienta\ndata: {\"type\":\"herramienta\",\"nombre\":\"buscar\",\"estado\":\"lista\"}\n\nevent: fin\ndata: {\"type\":\"fin\",\"reply\":\"Hola mundo\",\"result\":{\"propuesta\":{\"piezas\":2}}}\n\n", "el flujo llega intacto");
    assert.equal(respuesta.headers.get("x-conversacion-id"), "conv-ruta");
    assert.ok(respuesta.headers.get("x-request-id"));
    const json = conRegistro("/api/prueba-json", async (request: Request) => Response.json({ eco: ((await request.json()) as { mensaje: string }).mensaje, imagen: `data:image/png;base64,${foto}` }));
    const respuestaJson = await json(new Request("http://localhost/api/prueba-json", { method: "POST", headers: { "content-type": "application/json", "x-conversacion-id": "conv-ruta", "x-request-id": "sol-json" }, body: JSON.stringify({ mensaje: "hola json" }) }));
    assert.equal(((await respuestaJson.json()) as { eco: string }).eco, "hola json", "el handler lee el cuerpo aunque el envoltorio lo haya leído");
    const errorRuta = new Error("se rompió la ruta");
    const rota = conRegistro("/api/prueba-rota", async () => {
      throw errorRuta;
    });
    await silenciar(async () => {
      await assert.rejects(rota(new Request("http://localhost/api/prueba-rota", { method: "POST", headers: { "x-conversacion-id": "conv-ruta" } })), (error) => error === errorRuta);
    });
    await new Promise((resolver) => setTimeout(resolver, 50));
    await esperarRegistros();
    const lineas = leerJsonl(archivoConversacion(raiz, "conv-ruta"));
    const entrada = lineas.find((linea) => linea.tipo === "entrada_usuario")!.datos as Record<string, unknown>;
    assert.equal(entrada.texto, "Hola");
    assert.equal((entrada.adjuntos as Array<Record<string, unknown>>)[0]!.mime, "image/jpeg");
    assert.deepEqual(entrada.estadoCliente, { estadoGuiado: { uso: "personal" } });
    const salidas = lineas.filter((linea) => linea.tipo === "salida").map((linea) => linea.datos as Record<string, unknown>);
    const salidaSse = salidas.find((salida) => salida.tipoContenido === "text/event-stream")!;
    assert.equal(salidaSse.texto, "Hola mundo");
    assert.deepEqual(salidaSse.eventos, { texto: 2, herramienta: 1, fin: 1 });
    assert.deepEqual(((salidaSse.fin as Record<string, unknown>).result as Record<string, unknown>).propuesta, { piezas: 2 });
    const salidaJson = salidas.find((salida) => String(salida.tipoContenido).includes("json"))!;
    assert.equal(typeof (salidaJson.cuerpo as Record<string, unknown>).imagen, "object", "imagen de salida como hash");
    assert.ok(lineas.some((linea) => linea.tipo === "error" && ((linea.datos as Record<string, unknown>).error as Record<string, unknown>).mensaje === "se rompió la ruta"));
    assert.ok(lineas.every((linea) => linea.vista === undefined || linea.vista === "guiada"));
    const generales = leerJsonl(path.join(raiz, rutaGeneral()));
    assert.ok(generales.some((linea) => linea.evento === "peticion.fin" && (linea.datos as Record<string, unknown>).estado === 200 && typeof linea.ms === "number"));
    assert.ok(generales.some((linea) => linea.evento === "peticion.error" && (linea.error as Record<string, unknown>).pila));
    ok("conRegistro: flujo SSE intacto y resumido en `salida`, JSON con imagen como hash, entrada con adjuntos, error con pila relanzado");
  }

  /* ---------- Módulo del navegador (window/sessionStorage/sendBeacon simulados) ---------- */
  {
    const almacen = new Map<string, string>();
    const balizas: Blob[] = [];
    const fetches: string[] = [];
    let balizaAcepta = true;
    const globales = globalThis as unknown as Record<string, unknown>;
    globales.window = { sessionStorage: { getItem: (clave: string) => almacen.get(clave) ?? null, setItem: (clave: string, valor: string) => void almacen.set(clave, valor) }, location: { pathname: "/asistente" } };
    globales.document = {};
    Object.defineProperty(globalThis.navigator, "sendBeacon", { configurable: true, value: (_url: string, cuerpo: Blob) => {
      if (balizaAcepta) balizas.push(cuerpo);
      return balizaAcepta;
    } });
    const fetchOriginal = globalThis.fetch;
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      fetches.push(String(init?.body));
      throw new TypeError("sin red");
    }) as typeof fetch;
    try {
      const cliente = await import("../../src/lib/registro/cliente");
      const id = cliente.obtenerIdConversacion("guiada");
      assert.match(id, /^guiada-\d{8}-\d{6}-[a-z2-9]{6}$/);
      assert.equal(cliente.obtenerIdConversacion("guiada"), id, "estable dentro de la pestaña");
      const nueva = cliente.nuevaConversacion("guiada");
      assert.notEqual(nueva, id);
      assert.equal(cliente.conversacionActiva(), nueva);
      assert.deepEqual(cliente.cabecerasConversacion("guiada"), { "x-conversacion-id": nueva, "x-vista": "guiada" });
      assert.match(cliente.idSesionPestana(), /^pestana-/);
      for (let indice = 0; indice < 40; indice += 1) cliente.registrarEventoCliente("chip_pulsado", { indice }, "activa");
      assert.equal(balizas.length, 30, "máximo 30 eventos por minuto y pestaña");
      const primera = JSON.parse(await balizas[0]!.text()) as Record<string, unknown>;
      assert.equal(primera.idConversacion, nueva);
      assert.equal(primera.ruta, "/asistente");
      const ahora = Date.now;
      Date.now = () => ahora() + 61_000;
      try {
        balizaAcepta = false;
        // Cada cadena se corta a 2 000 caracteres; diez de ellas siguen pasando de 12 kB y la carga entera se recorta.
        cliente.registrarEventoCliente("tras_un_minuto", Object.fromEntries(Array.from({ length: 10 }, (_, indice) => [`campo${indice}`, "x".repeat(30_000)])));
        await new Promise((resolver) => setTimeout(resolver, 10));
      } finally {
        Date.now = ahora;
      }
      assert.equal(fetches.length, 1, "si sendBeacon no acepta, un único fetch keepalive");
      const respaldo = JSON.parse(fetches[0]!) as { suprimidos: number; datos: { recortado: boolean } };
      assert.equal(respaldo.suprimidos, 10, "informa cuántos eventos descartó el límite");
      assert.equal(respaldo.datos.recortado, true, "carga grande recortada");
      assert.ok(fetches[0]!.length <= 12_500);
      assert.equal(fetches.length, 1, "el fallo de red del envío no genera otro evento (sin bucles)");
    } finally {
      globalThis.fetch = fetchOriginal;
      delete globales.window;
      delete globales.document;
    }
    ok("navegador: ids de conversación por vista, límite 30/min con conteo de suprimidos, sendBeacon→fetch, recorte, sin bucles");
  }

  /* ---------- Ningún secreto en disco ---------- */
  {
    for (const archivo of todosLosArchivos(BASE)) {
      const contenido = readFileSync(archivo, "utf8");
      assert.ok(!contenido.includes(SECRETO_ENTORNO), `secreto en ${archivo}`);
      assert.ok(!contenido.includes("firma\""), `firma interna en ${archivo}`);
    }
    ok("ningún archivo escrito contiene el valor del secreto del entorno ni la firma interna");
  }

  rmSync(BASE, { recursive: true, force: true });
  console.log(`\n${pruebas} grupos de pruebas OK`);
}

principal().catch((error: unknown) => {
  console.error(error);
  console.error(`(archivos de la prueba en ${BASE})`);
  process.exit(1);
});
