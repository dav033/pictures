import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";
import nextConfig from "../next.config";
import {
  cuerpoExito,
  LIMITE_CUERPO_ANALISIS_BYTES,
  leerCuerpo,
  referenciasEtiquetadas,
  respuestaError,
  validarCuerpo,
} from "../src/app/api/references/analyze/analisis-http";
import { ApiError } from "@google/genai";
import { categorizarError } from "@sempertex/agente-core/gemini";
import { ErrorIA } from "../src/lib/ia/tipos";
import { UiErrorV1Schema } from "../src/lib/ia/contracts/ui-error-v1";
import type { AnalisisV2Resultado } from "../src/lib/ia/analizar-referencias-v2";

/**
 * Transport of /api/references/analyze without server or provider: body size
 * against the proxy limit (#6), byte validation (#17, #18), precise 400s
 * (#21), provider image rejection (#5), no raw provider text (#20) and
 * request_id on success (#22).
 */

let casos = 0;
async function caso(nombre: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  casos += 1;
  console.log(`ok - ${nombre}`);
}

function fallar(fn: () => unknown): Error {
  try {
    fn();
  } catch (error) {
    return error as Error;
  }
  throw new Error("se esperaba un error");
}

async function fallarAsync(fn: () => Promise<unknown>): Promise<Error> {
  try {
    await fn();
  } catch (error) {
    return error as Error;
  }
  throw new Error("se esperaba un error");
}

function adjunto(error: unknown, patron: RegExp, status = 400): void {
  const { status: real, body, uiError } = respuestaError(error, crypto.randomUUID(), true);
  UiErrorV1Schema.parse(uiError);
  assert.equal(uiError.code, "ADJUNTO_INVALIDO", String(error));
  assert.equal(uiError.retryable, false);
  assert.match(uiError.mensaje_usuario, patron);
  assert.doesNotMatch(uiError.mensaje_usuario, /Recarga la página|\berror\b/i);
  assert.equal(body.error, uiError.mensaje_usuario, "el campo error no lleva texto técnico");
  assert.equal(real, status);
}

async function run(): Promise<void> {
  const jpeg = (await sharp({ create: { width: 200, height: 160, channels: 3, background: "#cba6f7" } }).jpeg().toBuffer()).toString("base64");
  const png = (await sharp({ create: { width: 200, height: 160, channels: 4, background: "#b4befe" } }).png().toBuffer()).toString("base64");
  const webp = (await sharp({ create: { width: 200, height: 160, channels: 3, background: "#b4befe" } }).webp().toBuffer()).toString("base64");
  const gif = (await sharp({ create: { width: 200, height: 160, channels: 3, background: "#000" } }).gif().toBuffer()).toString("base64");
  const exifOrientacion6 = readFileSync(resolve(process.cwd(), "eval/fixtures/exif/orientacion-6.jpg"));
  const truncadoJpeg =Buffer.from(jpeg, "base64").subarray(0, Math.floor(Buffer.from(jpeg, "base64").length / 2)).toString("base64");

  await caso("#6 el límite de la ruta es el del proxy de next.config", () => {
    assert.equal(nextConfig.experimental?.proxyClientMaxBodySize, LIMITE_CUERPO_ANALISIS_BYTES);
  });

  await caso("#6 un cuerpo mayor que el límite del proxy es 'foto demasiado grande' (413), no 'Recarga la página'", async () => {
    const porCabecera = await fallarAsync(() => leerCuerpo(new Request("https://x.test/api/references/analyze", { method: "POST", headers: { "content-length": String(LIMITE_CUERPO_ANALISIS_BYTES + 1) }, body: "{}" })));
    adjunto(porCabecera, /demasiado grande/, 413);
    // Sin content-length el proxy entrega el cuerpo cortado justo en el límite.
    const cortado = `{"images":[{"mime":"image/jpeg","base64":"${"A".repeat(LIMITE_CUERPO_ANALISIS_BYTES)}`.slice(0, LIMITE_CUERPO_ANALISIS_BYTES);
    const truncado = await fallarAsync(() => leerCuerpo(new Request("https://x.test/api/references/analyze", { method: "POST", body: cortado })));
    adjunto(truncado, /demasiado grande/, 413);
    const normal = await leerCuerpo(new Request("https://x.test/api/references/analyze", { method: "POST", body: JSON.stringify({ images: [] }) }));
    assert.deepEqual(normal, { images: [] });
  });

  await caso("#21 mensajes 400 precisos: demasiadas fotos, foto vacía, ninguna foto, tipo", () => {
    adjunto(fallar(() => validarCuerpo({ images: [1, 2, 3, 4].map(() => ({ mime: "image/jpeg", base64: jpeg })) })), /hasta tres fotos/);
    adjunto(fallar(() => validarCuerpo({ images: [{ mime: "image/jpeg", base64: "" }] })), /vacía/);
    adjunto(fallar(() => validarCuerpo({ images: [] })), /al menos una foto/);
    adjunto(fallar(() => validarCuerpo({})), /al menos una foto/);
    adjunto(fallar(() => validarCuerpo({ images: [{ mime: "image/heic", base64: jpeg }] })), /JPG, PNG o WebP/);
    adjunto(fallar(() => validarCuerpo({ images: [{ mime: "image/png", base64: gif }] })), /Solo puedo usar fotos JPG, PNG o WebP/);
    adjunto(fallar(() => validarCuerpo({ images: [{ mime: "image/jpeg", base64: jpeg, ancho: 40, alto: 40 }] })), /muy pequeña/);
  });

  await caso("#17/#18 contenido que no es imagen o foto truncada se rechaza antes del proveedor", () => {
    adjunto(fallar(() => validarCuerpo({ images: [{ mime: "image/jpeg", base64: Buffer.from("hola, no soy una foto").toString("base64") }] })), /No pude leer esa foto/);
    adjunto(fallar(() => validarCuerpo({ images: [{ mime: "image/jpeg", base64: truncadoJpeg }] })), /No pude leer esa foto/);
    adjunto(fallar(() => validarCuerpo({ images: [{ mime: "image/jpeg", base64: "@@no-base64@@" }] })), /No pude leer esa foto/);
    const truncadoPng = Buffer.from(png, "base64").subarray(0, 60).toString("base64");
    adjunto(fallar(() => validarCuerpo({ images: [{ mime: "image/png", base64: truncadoPng }] })), /No pude leer esa foto/);
    const truncadoWebp = Buffer.from(webp, "base64").subarray(0, 20).toString("base64");
    adjunto(fallar(() => validarCuerpo({ images: [{ mime: "image/webp", base64: truncadoWebp }] })), /No pude leer esa foto/);
  });

  await caso("#18 fotos válidas pasan y el mime sale de los bytes, no de la declaración", () => {
    const body = validarCuerpo({ images: [{ mime: "image/jpeg", base64: jpeg, ancho: 200, alto: 160 }, { mime: "image/jpeg", base64: png }, { mime: "image/webp", base64: webp }], sin_cache: true, proveedor: "gemini" });
    assert.deepEqual(body.images.map((image) => image.mime), ["image/jpeg", "image/png", "image/webp"]);
    assert.equal(body.sinCache, true);
    assert.equal(validarCuerpo({ images: [{ mime: "image/png", base64: png }] }).sinCache, false);
    assert.deepEqual(referenciasEtiquetadas(body.images).map((image) => image.id), ["REF_01", "REF_02", "REF_03"]);
  });

  await caso("#5 rechazo de imagen del proveedor → ADJUNTO_INVALIDO no reintentable (422)", () => {
    const crudo = 'AI_IMAGE_REJECTED: {"error":{"code":400,"message":"Unable to process input image.","status":"INVALID_ARGUMENT"}}';
    adjunto(new ErrorIA("desconocido", "gemini", crudo, false), /No pude leer esa foto\. Prueba con otra imagen \(JPG, PNG o WebP\)/, 422);
  });

  await caso("#5 contrato entre paquetes: el rechazo que produce el adaptador de Gemini se traduce a ADJUNTO_INVALIDO", () => {
    // traducir-error-servidor.ts repeats the adapter prefix as a literal; this
    // binds both sides so renaming it in agente-core cannot silently turn a
    // rejected photo back into a retryable outage.
    const rechazo = categorizarError(new ApiError({ message: '{"error":{"code":400,"message":"Unable to process input image.","status":"INVALID_ARGUMENT"}}', status: 400 }), true);
    adjunto(rechazo, /No pude leer esa foto/, 422);
  });

  await caso("#5 un fallo desconocido del proveedor sigue siendo reintentable", () => {
    const { status, uiError } = respuestaError(new ErrorIA("desconocido", "gemini", "socket hang up", true), crypto.randomUUID(), true);
    assert.equal(uiError.code, "SERVICIO_NO_DISPONIBLE");
    assert.equal(uiError.retryable, true);
    assert.equal(status, 502);
  });

  await caso("#20 el texto crudo del proveedor no llega al navegador en producción; en desarrollo queda en detalles_dev", () => {
    const secreto = 'quota detail {"error":{"message":"Quota exceeded for project 1234567 key AIza-XYZ"}}';
    const produccion = respuestaError(new ErrorIA("cuota", "gemini", secreto, true), "6f1c7b5e-8f0a-4c1e-9a5b-2d3e4f5a6b7c", true);
    const serializado = JSON.stringify(produccion.body);
    assert.doesNotMatch(serializado, /AIza|1234567|Quota exceeded/);
    assert.equal(produccion.status, 429);
    assert.equal(produccion.body.request_id, "6f1c7b5e-8f0a-4c1e-9a5b-2d3e4f5a6b7c");
    const desarrollo = respuestaError(new ErrorIA("cuota", "gemini", secreto, true), crypto.randomUUID(), false);
    assert.match(desarrollo.uiError.detalles_dev.mensaje, /Quota exceeded/);
    assert.doesNotMatch(String(desarrollo.body.error), /Quota exceeded/);
  });

  await caso("A0.2 EXIF: el fixture compartido guarda 240×160 con orientación 6 y se ve 160×240 con la franja roja arriba", async () => {
    const meta = await sharp(exifOrientacion6).metadata();
    assert.deepEqual([meta.width, meta.height, meta.orientation], [240, 160, 6]);
    const { data, info } = await sharp(exifOrientacion6).rotate().raw().toBuffer({ resolveWithObject: true });
    assert.deepEqual([info.width, info.height], [160, 240]);
    assert.ok(data[0] > 200 && data[1] < 60, "arriba a la izquierda es rojo tras aplicar la orientación");
    const abajo = (info.height - 1) * info.width * info.channels;
    assert.ok(Math.abs(data[abajo] - data[abajo + 1]) < 30, "abajo es gris tras aplicar la orientación");
  });

  await caso("A0.2 EXIF: hoy el servidor no normaliza la orientación; los bytes con orientación 6 llegan intactos al proveedor", () => {
    // Characterization, not the target: both UI clients upright the photo in
    // the browser (createImageBitmap imageOrientation "from-image" + canvas
    // re-encode), so only non-UI callers reach this path. Normalizing here with
    // sharp().rotate() changes production behavior and needs the standalone
    // Docker check (Plan A §A0.2, L17); pending human decision in
    // docs/planes/estructuras-2026-09/ejecucion/fase-a/REVISION-HUMANA.md.
    // Remove this case when that normalization lands.
    const base64 = exifOrientacion6.toString("base64");
    const [image] = validarCuerpo({ images: [{ mime: "image/jpeg", base64 }] }).images;
    assert.equal(image.base64, base64);
    assert.equal(image.mime, "image/jpeg");
  });

  await caso("#22 la respuesta 200 incluye request_id y las banderas del análisis", () => {
    const requestId = crypto.randomUUID();
    const references = referenciasEtiquetadas([{ mime: "image/jpeg", base64: jpeg, ancho: 200, alto: 160 }]);
    const result = {
      blueprint: { schema_version: "2.0", source_images: [{ image_id: "REF_01", approved_roles: ["composition_reference"] }], elements: [], composition: { focal_point: "x", density: "unknown", symmetry: "unknown", negative_space: [] }, palette: { observed: [], priority: [] }, unresolved_decisions: [] },
      tieneEstructurasDeGlobos: false,
      tieneElementos: false,
      metadata: { passes: ["inventory", "audit"], cached: false, cache_key: "k", system_prompt_hash: "h", requires_review: false, unresolved_count: 0, default_approval_rule: "r" },
    } as AnalisisV2Resultado;
    const body = cuerpoExito(result, references, requestId, "gemini");
    assert.equal(body.request_id, requestId);
    assert.equal(body.tieneEstructurasDeGlobos, false);
    assert.equal(body.tieneElementos, false);
  });

  console.log(`[PASS] ${casos} casos de /api/references/analyze`);
}

run().catch((error: unknown) => {
  console.error("[FAIL]", error);
  process.exitCode = 1;
});
