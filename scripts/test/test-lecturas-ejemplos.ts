// Sin red ni llave: las lecturas revisadas de la galería con la variante de la ruta (comparador clásica-guiada
// 2026-10-06, I1: la caché de v16 no respondía nunca y la guiada, que recodifica la foto, tampoco habría acertado).
// La misma foto por las dos vistas —el archivo intacto (clásica) y recodificado en JPEG 0,9 (guiada,
// `prepararFotoReferencia`)— da EXACTAMENTE la misma respuesta de /api/references/analyze, sin llamar al modelo.
process.env.LECTURA_UNICA_REFERENCIA_ENABLED = "true";
process.env.REFERENCE_ANALYSIS_PYTHON_ENABLED = "true";
process.env.GEMINI_API_KEY ??= "llave-offline-sin-uso";
process.env.PYTHON_BACKEND_URL ??= "http://python.test";
process.env.INTERNAL_HMAC_SECRET ??= "local-only-secret-0123456789abcdef";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const archivoEjemplo = (nombre: string) => readFileSync(path.join(process.cwd(), "public", "referencias-ejemplo", nombre));

let casos = 0;
async function caso(nombre: string, fn: () => Promise<void> | void): Promise<void> {
  await fn();
  casos += 1;
  console.log(`ok - ${nombre}`);
}

async function run(): Promise<void> {
  const { LECTURAS_EJEMPLOS, lecturaDeEjemplo, sha256DeBytes } = await import("@/lib/ia/amaterasu/lecturas-ejemplos");
  const { huellaImagen, mismaFoto } = await import("@/lib/ia/amaterasu/huella-imagen");
  const { ANALYSIS_PARSER_VERSION, sistemaAnalisis } = await import("@/lib/ia/amaterasu/analizar-referencias-v2");
  const { VARIANTE_RUTA_ANALISIS } = await import("@/lib/ia/referencia/reference-structure");
  const { ReferenceBlueprintV2Schema } = await import("@/lib/ia/referencia/reference-blueprint");
  const { tieneEstructurasDeGlobos } = await import("@/lib/ia/referencia/reference-structure");
  const { MANIFIESTO_REFERENCIAS_EJEMPLO } = await import("@/lib/referencias-ejemplo/manifiesto");
  const opciones = { parserVersion: ANALYSIS_PARSER_VERSION, variante: VARIANTE_RUTA_ANALISIS };
  const referencia = (bytes: Buffer) => ({ id: "REF_01", mime: "image/jpeg" as const, base64: bytes.toString("base64"), descripcion: "x" });
  // Lo que hace la guiada: decodificar y volver a codificar en JPEG 0,9 (las fotos de la galería ya miden 1200 px).
  const comoLaGuiada = (bytes: Buffer) => sharp(bytes).rotate().jpeg({ quality: 90 }).toBuffer();

  await caso("las 10 fotos tienen su lectura revisada con la variante y el parser de la ruta", () => {
    assert.equal(LECTURAS_EJEMPLOS.variante, VARIANTE_RUTA_ANALISIS, "regenera con scripts/ops/generar-lecturas-ejemplos.ts");
    assert.equal(LECTURAS_EJEMPLOS.parser_version, ANALYSIS_PARSER_VERSION, "regenera con scripts/ops/generar-lecturas-ejemplos.ts");
    if (LECTURAS_EJEMPLOS.system_prompt_hash !== sistemaAnalisis([], "perceptual", VARIANTE_RUTA_ANALISIS).systemPromptHash) {
      console.warn("  aviso: el prompt de la lectura cambió desde que se guardaron; siguen sirviendo, pero conviene regenerarlas");
    }
    for (const foto of MANIFIESTO_REFERENCIAS_EJEMPLO.fotos) {
      const ejemplo = LECTURAS_EJEMPLOS.ejemplos.find((item) => item.id === foto.id);
      assert.ok(ejemplo, `falta ${foto.id}`);
      assert.equal(ejemplo.sha256, sha256DeBytes(archivoEjemplo(foto.archivo)), `${foto.id}: la foto cambió`);
      assert.ok(ejemplo.revision.length > 10, `${foto.id}: sin nota de revisión`);
      const blueprint = ReferenceBlueprintV2Schema.parse(ejemplo.analisis.blueprint);
      assert.ok(tieneEstructurasDeGlobos(blueprint), `${foto.id} sin estructuras de globos`);
      assert.ok(ejemplo.analisis.lecturasCrudas && Object.keys(ejemplo.analisis.lecturasCrudas).length > 0, `${foto.id}: sin las lecturas que valida Python`);
    }
  });

  await caso("la huella reconoce la misma foto recodificada o reducida y nunca confunde dos fotos", async () => {
    const huellas = await Promise.all(MANIFIESTO_REFERENCIAS_EJEMPLO.fotos.map((foto) => huellaImagen(archivoEjemplo(foto.archivo))));
    for (const [indice, foto] of MANIFIESTO_REFERENCIAS_EJEMPLO.fotos.entries()) {
      const bytes = archivoEjemplo(foto.archivo);
      for (const variante of [await comoLaGuiada(bytes), await sharp(bytes).resize(900).jpeg({ quality: 80 }).toBuffer(), await sharp(bytes).png().toBuffer()]) {
        assert.equal(mismaFoto(await huellaImagen(variante), huellas[indice]!).igual, true, `${foto.id} recodificada`);
      }
      huellas.forEach((otra, otro) => { if (otro !== indice) assert.equal(mismaFoto(huellas[indice]!, otra).igual, false, `${foto.id} ≠ ${MANIFIESTO_REFERENCIAS_EJEMPLO.fotos[otro]!.id}`); });
      const recortada = await sharp(bytes).extract({ left: 0, top: 0, width: Math.round(foto.ancho * 0.85), height: foto.alto }).toBuffer();
      assert.equal(mismaFoto(await huellaImagen(recortada), huellas[indice]!).igual, false, `${foto.id} recortada ya no es la misma foto`);
    }
  });

  await caso("clásica (bytes) y guiada (recodificada) reciben la misma lectura y los píxeles del archivo de la galería", async () => {
    for (const foto of MANIFIESTO_REFERENCIAS_EJEMPLO.fotos) {
      const original = archivoEjemplo(foto.archivo);
      const clasica = await lecturaDeEjemplo([referencia(original)], opciones);
      const guiada = await lecturaDeEjemplo([referencia(await comoLaGuiada(original))], opciones);
      assert.ok(clasica && guiada, foto.id);
      assert.equal(clasica.coincidencia, "bytes");
      assert.equal(guiada.coincidencia, "huella");
      assert.equal(clasica.ejemplo.id, foto.id);
      assert.equal(guiada.ejemplo.id, foto.id);
      assert.deepEqual(guiada.analisis, clasica.analisis);
      assert.equal(guiada.pixeles, "galeria");
      assert.equal(guiada.referencias[0]!.base64, original.toString("base64"), "la ruta sigue con el archivo de la galería");
      assert.equal(clasica.analisis.metadata.cached, true);
    }
  });

  await caso("otra foto, dos fotos, otra variante u otro parser: no hay lectura guardada", async () => {
    const ej01 = archivoEjemplo("ejemplo-01.jpg");
    const otra = await sharp({ create: { width: 600, height: 400, channels: 3, background: { r: 200, g: 120, b: 160 } } }).jpeg().toBuffer();
    assert.equal(await lecturaDeEjemplo([referencia(otra)], opciones), null);
    assert.equal(await lecturaDeEjemplo([referencia(ej01), { ...referencia(ej01), id: "REF_02" }], opciones), null);
    assert.equal(await lecturaDeEjemplo([referencia(ej01)], { ...opciones, variante: "v16" }), null);
    assert.equal(await lecturaDeEjemplo([referencia(ej01)], { ...opciones, parserVersion: "otra" }), null);
    // Sin el archivo en disco (un despliegue sin public/) sale la misma lectura con los píxeles que llegaron.
    const sinDisco = await lecturaDeEjemplo([referencia(await comoLaGuiada(ej01))], { ...opciones, leerFoto: async () => null });
    assert.equal(sinDisco?.pixeles, "foto_recibida");
    assert.equal(sinDisco?.ejemplo.id, "ejemplo-01");
  });

  await caso("ruta: la misma foto por las dos vistas da la misma respuesta, sin llamar al modelo", async () => {
    const llamadas: string[] = [];
    // Python (validación de las lecturas) caído: aun así las dos respuestas son iguales; el modelo no se llama.
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      llamadas.push(new URL(String(input)).pathname);
      return Response.json({ detail: { code: "no_disponible_en_prueba" } }, { status: 503 });
    }) as typeof fetch;
    const { POST } = await import("@/app/api/references/analyze/route");
    const pedir = async (bytes: Buffer, extra: Record<string, unknown> = {}) => {
      const respuesta = await POST(new Request("http://127.0.0.1/api/references/analyze", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ images: [{ mime: "image/jpeg", base64: bytes.toString("base64"), ...extra }] }) }));
      assert.equal(respuesta.status, 200);
      const { request_id: _id, ...cuerpo } = await respuesta.json() as Record<string, unknown>;
      void _id;
      return cuerpo;
    };
    const original = archivoEjemplo("ejemplo-01.jpg");
    const clasica = await pedir(original, { ancho: 1200, alto: 800, originalAncho: 1200, originalAlto: 800 });
    const guiada = await pedir(await comoLaGuiada(original));
    assert.deepEqual(guiada, clasica);
    assert.equal((clasica.metadata as { cached: boolean }).cached, true);
    assert.ok(!llamadas.some((ruta) => /analisis|inventario|chat|generate/i.test(ruta)), `sin llamadas al modelo: ${llamadas.join(", ")}`);
  });

  console.log(`\n${casos} casos OK`);
}

void run().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
