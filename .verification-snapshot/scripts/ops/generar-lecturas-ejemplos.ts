/**
 * Regenera `src/lib/ia/amaterasu/lecturas-ejemplos.json`: la lectura revisada de cada foto de la galería con la
 * variante de la ruta (`VARIANTE_RUTA_ANALISIS`). Dos pasos, porque una lectura no se guarda sin mirarla contra la
 * foto:
 *
 * 1. Leer (paga una llamada de visión por foto y vez, ~US$0,02, con la MISMA configuración que la ruta):
 *    NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/ops/generar-lecturas-ejemplos.ts \
 *      --leer ejemplo-01,ejemplo-04 --veces 2 --dir <carpeta>
 *    Deja `<carpeta>/<id>-<n>.json` e imprime un resumen de cada lectura (piezas, colores, remate, conteo).
 * 2. Elegir (sin coste): un JSON `{ "ejemplo-01": { "lectura": "ejemplo-01-2.json", "revision": "por qué esta" } }`
 *    NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/ops/generar-lecturas-ejemplos.ts \
 *      --escribir --dir <carpeta> --elegir <eleccion.json>
 *    Calcula el sha256 y la huella perceptual del archivo de la galería y escribe el JSON (las fotos que no se
 *    eligen conservan su lectura si el archivo sigue vigente).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { MANIFIESTO_REFERENCIAS_EJEMPLO } from "../../src/lib/referencias-ejemplo/manifiesto";

const argumento = (nombre: string) => {
  const indice = process.argv.indexOf(nombre);
  return indice >= 0 ? process.argv[indice + 1] : undefined;
};
const SALIDA = path.join(process.cwd(), "src", "lib", "ia", "amaterasu", "lecturas-ejemplos.json");
/** US$ por millón de tokens de gemini-3.6-flash (el pensamiento se cobra como salida); los del banco de fotos. */
const PRECIO = { entrada: 0.75, salida: 3.75 };

type Json = Record<string, unknown>;

function resumen(analisis: { blueprint: { elements: Array<Json & { appearance: Json; visual_semantics?: Json }> }; lecturasCrudas?: Record<string, Json> }): string[] {
  return analisis.blueprint.elements.filter((elemento) => elemento.approved).map((elemento) => {
    const semantica = elemento.visual_semantics ?? {};
    const crudas = analisis.lecturasCrudas?.[String(elemento.element_id)];
    const apariencia = elemento.appearance;
    const partes = [
      `${String(elemento.element_id)} ${String(elemento.category)} «${String(elemento.name)}»`,
      semantica.structure_type ? `tipo=${String(semantica.structure_type)} @${String(semantica.placement ?? "?")}` : "",
      `×${JSON.stringify((elemento.quantity as Json | undefined)?.max ?? "?")}`,
      `colores=${JSON.stringify(apariencia.observed_colors)}`,
      apariencia.remate_columna ? `remate=${JSON.stringify(apariencia.remate_columna)}` : "",
      apariencia.tamanos_leidos ? `tamaños=${String(apariencia.tamanos_leidos)}` : "",
      crudas ? `lecturas=${JSON.stringify(crudas).slice(0, 600)}` : "",
    ];
    return partes.filter(Boolean).join(" | ");
  });
}

async function leer(ids: string[], veces: number, dir: string): Promise<void> {
  const { analizarReferenciasV2 } = await import("../../src/lib/ia/amaterasu/analizar-referencias-v2");
  const { VARIANTE_RUTA_ANALISIS } = await import("../../src/lib/ia/referencia/reference-structure");
  const { REFERENCE_ANALYSIS_PYTHON_ENABLED } = await import("../../src/lib/ia/nucleo/feature-flags");
  const { MODELO_LECTURA_FOTO } = await import("../../src/lib/ia/amaterasu/config-lectura-foto");
  const { crearChatTurnoPython } = await import("../../src/lib/ia/amaterasu/chat-python");
  const { chatLecturaFotoDe } = await import("../../src/lib/ia/nucleo/registro");
  const { referenciasEtiquetadas } = await import("../../src/app/api/references/analyze/analisis-http");
  mkdirSync(dir, { recursive: true });
  let gasto = 0;
  for (const foto of MANIFIESTO_REFERENCIAS_EJEMPLO.fotos.filter((item) => ids.includes(item.id))) {
    const base64 = readFileSync(path.join(process.cwd(), "public", "referencias-ejemplo", foto.archivo)).toString("base64");
    for (let vez = 1; vez <= veces; vez += 1) {
      const requestId = crypto.randomUUID();
      // La misma configuración del lector que la ruta (`config-lectura-foto.ts`): por Python o directo a Gemini.
      const chat = REFERENCE_ANALYSIS_PYTHON_ENABLED ? crearChatTurnoPython({ requestId, correlationId: requestId, model: MODELO_LECTURA_FOTO }) : await chatLecturaFotoDe("gemini");
      const referencias = referenciasEtiquetadas([{ base64, mime: "image/jpeg", ancho: foto.ancho, alto: foto.alto, originalAncho: foto.ancho, originalAlto: foto.alto }]);
      let tokens = { entrada: 0, salida: 0 };
      const analisis = await analizarReferenciasV2(chat, referencias, [], "perceptual", { requestId, correlationId: requestId, superficie: "scripts/ops/generar-lecturas-ejemplos" }, undefined, {
        forzarNuevoAnalisis: true,
        variante: VARIANTE_RUTA_ANALISIS,
        observarPase: ({ uso }) => { tokens = { entrada: tokens.entrada + uso.entrada, salida: tokens.salida + uso.salida + (uso.pensamiento ?? 0) }; },
      });
      const costo = (tokens.entrada * PRECIO.entrada + tokens.salida * PRECIO.salida) / 1e6;
      gasto += costo;
      const archivo = path.join(dir, `${foto.id}-${vez}.json`);
      writeFileSync(archivo, `${JSON.stringify(analisis, null, 1)}\n`);
      console.log(`\n== ${foto.id} lectura ${vez} (${tokens.entrada}/${tokens.salida} tokens, US$${costo.toFixed(4)}) → ${archivo}`);
      for (const linea of resumen(analisis as unknown as Parameters<typeof resumen>[0])) console.log(`  ${linea}`);
    }
  }
  console.log(`\nGasto estimado: US$${gasto.toFixed(4)}`);
}

async function escribir(dir: string, eleccionArchivo: string): Promise<void> {
  const { ANALYSIS_PARSER_VERSION, sistemaAnalisis } = await import("../../src/lib/ia/amaterasu/analizar-referencias-v2");
  const { VARIANTE_RUTA_ANALISIS } = await import("../../src/lib/ia/referencia/reference-structure");
  const { MODELO_LECTURA_FOTO } = await import("../../src/lib/ia/amaterasu/config-lectura-foto");
  const { LECTURAS_EJEMPLOS, sha256DeBytes } = await import("../../src/lib/ia/amaterasu/lecturas-ejemplos");
  const { huellaImagen } = await import("../../src/lib/ia/amaterasu/huella-imagen");
  const { ReferenceBlueprintV2Schema } = await import("../../src/lib/ia/referencia/reference-blueprint");
  type Lectura = (typeof LECTURAS_EJEMPLOS)["ejemplos"][number];
  const eleccion = JSON.parse(readFileSync(eleccionArchivo, "utf8")) as Record<string, { lectura: string; revision: string }>;
  const vigentes = LECTURAS_EJEMPLOS.parser_version === ANALYSIS_PARSER_VERSION && LECTURAS_EJEMPLOS.variante === VARIANTE_RUTA_ANALISIS;
  const ejemplos: Lectura[] = [];
  for (const foto of MANIFIESTO_REFERENCIAS_EJEMPLO.fotos) {
    const bytes = readFileSync(path.join(process.cwd(), "public", "referencias-ejemplo", foto.archivo));
    const sha256 = sha256DeBytes(bytes);
    const elegida = eleccion[foto.id];
    if (!elegida) {
      const previa = vigentes ? LECTURAS_EJEMPLOS.ejemplos.find((item) => item.id === foto.id && item.sha256 === sha256) : undefined;
      if (previa) ejemplos.push(previa);
      else console.warn(`${foto.id}: sin lectura elegida`);
      continue;
    }
    const analisis = JSON.parse(readFileSync(path.join(dir, elegida.lectura), "utf8")) as Lectura["analisis"];
    ReferenceBlueprintV2Schema.parse(analisis.blueprint);
    const { huella, proporcion } = await huellaImagen(bytes);
    ejemplos.push({
      id: foto.id,
      archivo: foto.archivo,
      sha256,
      huella,
      proporcion: Math.round(proporcion * 10_000) / 10_000,
      revision: elegida.revision,
      analisis: { ...analisis, metadata: { ...analisis.metadata, cached: false, cache_key: `lectura-ejemplo:${foto.id}` } },
    });
  }
  const archivo = {
    parser_version: ANALYSIS_PARSER_VERSION,
    variante: VARIANTE_RUTA_ANALISIS,
    system_prompt_hash: sistemaAnalisis([], "perceptual", VARIANTE_RUTA_ANALISIS).systemPromptHash,
    modelo: MODELO_LECTURA_FOTO,
    generado: new Date().toISOString().slice(0, 10),
    ejemplos,
  };
  writeFileSync(SALIDA, `${JSON.stringify(archivo, null, 1)}\n`);
  console.log(`Escrito ${SALIDA}: ${ejemplos.length} fotos`);
}

async function main(): Promise<void> {
  for (const archivo of [".env.local", ".env"]) if (existsSync(archivo)) process.loadEnvFile(archivo);
  // Las llamadas quedan auditadas en data/registros como cualquier lectura (fuera de Next el registro está apagado).
  process.env.REGISTRO_ACTIVO ??= "1";
  // No es tráfico de producción: fuera de la serie de telemetría de la base.
  delete process.env.DATABASE_URL;
  await import("../../src/lib/ia/nucleo/telemetria-llamadas");
  const { configurarPersistenciaTelemetria } = await import("@sempertex/agente-core");
  configurarPersistenciaTelemetria(undefined);
  const dir = argumento("--dir");
  if (!dir) throw new Error("Falta --dir <carpeta de lecturas>.");
  if (process.argv.includes("--escribir")) {
    const eleccion = argumento("--elegir");
    if (!eleccion) throw new Error("Falta --elegir <eleccion.json>.");
    await escribir(dir, eleccion);
    return;
  }
  const ids = (argumento("--leer") ?? "").split(",").filter(Boolean);
  if (!ids.length) throw new Error("Falta --leer ejemplo-01,ejemplo-02.");
  await leer(ids, Math.max(1, Math.min(3, Number(argumento("--veces") ?? "1") || 1)), dir);
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
