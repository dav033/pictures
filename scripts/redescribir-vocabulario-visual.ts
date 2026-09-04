import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { aDescriptorPerceptual } from "../src/lib/lora/descriptor-perceptual";
import type { ProductConcept } from "../src/lib/lora/product-vocabulary";
import { V007_DATASET_PRODUCT_CONCEPTS } from "../src/lib/lora/v007-dataset-product-vocabulary";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SNAPSHOT_PATH = path.join(RAIZ, "data", "raw", "shopify-products.snapshot.json");
const SALIDA_PREDETERMINADA = path.join(RAIZ, "reports", "propuesta-vocabulario-visual-v001.json");
const VERSION_REPORTE = "propuesta-vocabulario-visual.v4";
const VERSION_REPORTE_ANTERIOR = "propuesta-vocabulario-visual.v3";
const VERSION_REPORTE_V2 = "propuesta-vocabulario-visual.v2";
const VERSION_REPORTE_V1 = "propuesta-vocabulario-visual.v1";
const VERSION_POLITICA_CACHE = "vocabulario-visual-cache.v4-opencode-process-pool";
const DESCRIPTOR_CALIBRADO_COLOR = "extremely pale desaturated silvery mauve-pink";
const DESCRIPTOR_CALIBRADO_FINISH = "chrome-like pearl sheen";
/**
 * Motor de visión: CLI de opencode contra OpenCode Zen, igual que
 * `src/lib/ordenes/generarCaption.ts` — no el CLI de Claude Code. Se
 * mantiene `PROVEEDORES_CONOCIDOS`/`ORQUESTACIONES_CONOCIDAS` con el valor
 * histórico ("claude-code"/"pool_claude_code") para que un `--out` generado
 * antes de este cambio se siga pudiendo leer y reanudar: la validez del
 * caché de cada concepto ya depende de `cache_key` (incluye proveedor,
 * modelo y esfuerzo), así que un archivo mixto reprocesa solo lo que
 * corresponda, nunca sirve una respuesta de un motor distinto como si fuera
 * la actual.
 */
const PROVEEDOR = "opencode" as const;
const PROVEEDORES_CONOCIDOS = ["claude-code", "opencode"] as const;
// El servidor local de opencode comparte una única base de sesiones SQLite
// (%LOCALAPPDATA%/opencode/opencode.db) entre TODOS los procesos `opencode
// run`, sin importar `--dir`. Con concurrencia > 1 esa base se puede
// bloquear intermitentemente ("database is locked") antes de llegar al
// modelo — `llamarOpencode` reintenta ese error puntual, así que 5 workers
// concurrentes sí funciona, solo con algo de reintento de por medio.
const CONCURRENCIA = 5;
// "Zen" es el catálogo de modelos alojado por OpenCode (zen.opencode.ai),
// con su PROPIO saldo de créditos — distinto del saldo/plan de la cuenta de
// OpenAI conectada directamente. Por eso el prefijo debe ser "opencode/",
// no "openai/": ese último rutea por el plan personal (ya con su límite
// propio agotado), no por el crédito de Zen. Mismo modelo subyacente que
// `generarCaption.ts` ya valida para visión, solo que ruteado por Zen.
const OPENCODE_MODELO = process.env.OPENCODE_VOCABULARIO_MODEL ?? "opencode/gpt-5.6-luna";
const OPENCODE_VARIANTE = process.env.OPENCODE_VOCABULARIO_VARIANT ?? "xhigh";
const CONTRATO_SUBAGENTE = "vision-producto-worker.v2";
const ORQUESTACION = "pool_opencode" as const;
const ORQUESTACIONES_CONOCIDAS = ["pool_claude_code", "pool_opencode"] as const;
const MAX_BYTES_SALIDA = 20 * 1024 * 1024;
const TIMEOUT_LOTE_MS = 15 * 60 * 1000;
const CONCEPTO_CALIBRACION = "balloon.round.latex.silk.spring_pink";
const HOST_FOTOS_PERMITIDO = "cdn.shopify.com";
const MAX_BYTES_FOTO = 20 * 1024 * 1024;
const RUTAS_PROTEGIDAS = [
  path.join(RAIZ, "src", "lib", "lora", "v007-dataset-product-vocabulary.ts"),
  path.join(RAIZ, "src", "lib", "lora", "product-vocabulary-data.ts"),
  path.join(RAIZ, "src", "lib", "lora", "descriptor-perceptual.ts"),
] as const;

const COLORES_MAPEADOS = [
  "spring pink",
  "arctic blue",
  "amethyst",
  "cream pearl",
  "pearl white",
  "mint green",
  "aurora green",
  "champagne",
  "green tea",
  "pastel lilac",
  "pastel blue",
] as const;

const ACABADOS_COMERCIALES = [
  "Silk satin",
  "Reflex high-shine",
  "Pastel Dusk muted",
  "Pastel Matte",
  "translucent Crystal",
  "solid Fashion",
] as const;

type Opciones = {
  limit: number | null;
  concepto: string | null;
  out: string;
};

type ShopifyImage = {
  id: string;
  position: number;
  variant_ids: string[];
  src: string;
};

type ShopifyVariant = {
  id: string;
  sku: string | null;
  featured_image: ShopifyImage | null;
};

type ShopifyProduct = {
  id: string;
  title: string;
  images: ShopifyImage[];
  variants: ShopifyVariant[];
};

type FotoElegida = {
  producto: ShopifyProduct;
  foto: ShopifyImage;
  coincidencias: string[];
};

type RevisionHumana = {
  requerida: boolean;
  motivos: string[];
};

type RespuestaVision = {
  color: string;
  finish: string;
  canonical_label: string;
  confidence: number;
  color_evidence: string;
  finish_evidence: string;
  mapped_color_verdict: "confirmed" | "contradicted" | "not_applicable";
  mapped_color_reason: string;
};

type TrabajoVision = {
  concepto: ProductConcept;
  elegida: FotoElegida;
  mapeado: string | null;
  prompt: string;
  cacheKey: string;
  indice: number;
  prefijo: string;
  fotoLocal: string;
};

type TrabajoPendiente = Omit<TrabajoVision, "fotoLocal">;

type ValoresAnteriores = {
  canonical_label: string;
  color: string;
  finish: string;
};

type ResultadoCompletado = {
  concept_id: string;
  estado: "completado";
  anterior: ValoresAnteriores;
  propuesta: {
    canonical_label: string;
    color: string;
    finish: string;
  };
  evidencia: {
    foto_url: string;
    archivo_shopify: string;
    shopify_image_id: string;
    shopify_product_id: string;
    catalog_title: string;
    coincidencias: string[];
    observacion_color: string;
    observacion_acabado: string;
  };
  confianza: number;
  auditoria_descriptor_perceptual:
    | {
        aplica: true;
        color_comercial: string;
        descriptor_mapeado_actual: string;
        veredicto: "CONFIRMADO" | "CONTRADICHO";
        razon: string;
      }
    | { aplica: false };
  proveedor: string;
  modelo: string;
  esfuerzo: string;
  cache_key: string;
  revision_humana: RevisionHumana;
  analizado_en: string;
};

type ResultadoError = {
  concept_id: string;
  estado: "error";
  anterior: ValoresAnteriores;
  error: string;
  intentado_en: string;
};

type ResultadoConcepto = ResultadoCompletado | ResultadoError;

type AuditoriaColor = {
  color_comercial: string;
  descriptor_mapeado_actual: string;
  estado: "CONFIRMADO" | "CONTRADICHO" | "PENDIENTE_SIN_EVIDENCIA";
  evaluaciones: Array<{
    concept_id: string;
    veredicto: "CONFIRMADO" | "CONTRADICHO";
    confianza: number;
    razon: string;
  }>;
};

type Reporte = {
  schema_version: typeof VERSION_REPORTE;
  creado_en: string;
  actualizado_en: string;
  fuentes: {
    vocabulario: string;
    snapshot_shopify: string;
    descriptor_perceptual: string;
  };
  ejecucion: {
    proveedor: typeof PROVEEDOR;
    orquestacion: typeof ORQUESTACION;
    modelo: string;
    esfuerzo: string;
    subagentes: number;
    concurrencia: number;
    limit: number | null;
    concepto: string | null;
    seleccion: string[];
    firma: string;
  };
  resumen: {
    conceptos_vocabulario: number;
    conceptos_en_reporte: number;
    completados: number;
    errores: number;
    pendientes_sin_procesar: number;
    revisiones_humanas_requeridas: number;
  };
  auditoria_colores_mapeados: AuditoriaColor[];
  conceptos: ResultadoConcepto[];
  migracion?: {
    desde: typeof VERSION_REPORTE_ANTERIOR | typeof VERSION_REPORTE_V2 | typeof VERSION_REPORTE_V1;
    migrado_en: string;
  };
};

const SCHEMA_VISION = {
  type: "object",
  properties: {
    color: { type: "string" },
    finish: { type: "string" },
    canonical_label: {
      type: "string",
      description: "Etiqueta compacta que contiene, carácter por carácter y sin parafrasear, los valores completos de color y finish.",
    },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    color_evidence: { type: "string" },
    finish_evidence: { type: "string" },
    mapped_color_verdict: {
      type: "string",
      enum: ["confirmed", "contradicted", "not_applicable"],
    },
    mapped_color_reason: { type: "string" },
  },
  required: [
    "color",
    "finish",
    "canonical_label",
    "confidence",
    "color_evidence",
    "finish_evidence",
    "mapped_color_verdict",
    "mapped_color_reason",
  ],
  additionalProperties: false,
};

const stringNoVacioSchema = z.string().trim().min(1);
const valoresAnterioresSchema = z
  .object({ canonical_label: stringNoVacioSchema, color: stringNoVacioSchema, finish: stringNoVacioSchema })
  .strict();
const propuestaSchema = valoresAnterioresSchema;
const evidenciaV1Schema = z
  .object({
    foto_url: z.string().url(),
    archivo_shopify: stringNoVacioSchema,
    shopify_product_id: stringNoVacioSchema,
    catalog_title: stringNoVacioSchema,
    coincidencias: z.array(stringNoVacioSchema).min(1),
    observacion_color: stringNoVacioSchema,
    observacion_acabado: stringNoVacioSchema,
  })
  .strict();
const evidenciaV2Schema = evidenciaV1Schema.extend({ shopify_image_id: stringNoVacioSchema }).strict();
const auditoriaDescriptorSchema = z.discriminatedUnion("aplica", [
  z
    .object({
      aplica: z.literal(true),
      color_comercial: stringNoVacioSchema,
      descriptor_mapeado_actual: stringNoVacioSchema,
      veredicto: z.enum(["CONFIRMADO", "CONTRADICHO"]),
      razon: stringNoVacioSchema,
    })
    .strict(),
  z.object({ aplica: z.literal(false) }).strict(),
]);
const resultadoCompletadoV1Schema = z
  .object({
    concept_id: stringNoVacioSchema,
    estado: z.literal("completado"),
    anterior: valoresAnterioresSchema,
    propuesta: propuestaSchema,
    evidencia: evidenciaV1Schema,
    confianza: z.number().min(0).max(1),
    auditoria_descriptor_perceptual: auditoriaDescriptorSchema,
    modelo: stringNoVacioSchema,
    variante: stringNoVacioSchema,
    analizado_en: stringNoVacioSchema,
  })
  .strict();
const revisionHumanaSchema = z
  .object({ requerida: z.boolean(), motivos: z.array(stringNoVacioSchema) })
  .strict()
  .refine((revision) => !revision.requerida || revision.motivos.length > 0, "Revisión requerida necesita motivo.");
const resultadoCompletadoV2Schema = resultadoCompletadoV1Schema
  .omit({ evidencia: true })
  .extend({
    evidencia: evidenciaV2Schema,
    cache_key: z.string().regex(/^[a-f0-9]{64}$/),
    revision_humana: revisionHumanaSchema,
  })
  .strict();
const resultadoCompletadoV3Schema = resultadoCompletadoV2Schema
  .omit({ modelo: true, variante: true })
  .extend({
    proveedor: stringNoVacioSchema,
    modelo: stringNoVacioSchema,
    esfuerzo: stringNoVacioSchema,
  })
  .strict();
const resultadoErrorSchema = z
  .object({
    concept_id: stringNoVacioSchema,
    estado: z.literal("error"),
    anterior: valoresAnterioresSchema,
    error: stringNoVacioSchema,
    intentado_en: stringNoVacioSchema,
  })
  .strict();
const ejecucionAnteriorSchema = z
  .object({
    modelo: stringNoVacioSchema,
    variante: stringNoVacioSchema,
    concurrencia: z.number().int().positive(),
    limit: z.number().int().positive().nullable(),
    concepto: stringNoVacioSchema.nullable(),
    seleccion: z.array(stringNoVacioSchema),
    firma: stringNoVacioSchema,
  })
  .strict();
const ejecucionV3Schema = ejecucionAnteriorSchema
  .omit({ variante: true })
  .extend({
    // Enum, no literal del proveedor actual: un --out escrito con el motor
    // anterior debe poder leerse y reanudarse. El cache_key por concepto
    // (más abajo) ya distingue qué proveedor/modelo produjo cada resultado.
    proveedor: z.enum(PROVEEDORES_CONOCIDOS),
    esfuerzo: stringNoVacioSchema,
    subagentes: z.number().int().positive(),
  })
  .strict();
const ejecucionSchema = ejecucionV3Schema
  .extend({ orquestacion: z.enum(ORQUESTACIONES_CONOCIDAS) })
  .strict();
const fuentesSchema = z
  .object({
    vocabulario: stringNoVacioSchema,
    snapshot_shopify: stringNoVacioSchema,
    descriptor_perceptual: stringNoVacioSchema,
  })
  .strict();
const resumenV1Schema = z
  .object({
    conceptos_vocabulario: z.number().int().nonnegative(),
    conceptos_en_reporte: z.number().int().nonnegative(),
    completados: z.number().int().nonnegative(),
    errores: z.number().int().nonnegative(),
    pendientes_sin_procesar: z.number().int().nonnegative(),
  })
  .strict();
const resumenV2Schema = resumenV1Schema.extend({ revisiones_humanas_requeridas: z.number().int().nonnegative() }).strict();
const auditoriaColorSchema = z
  .object({
    color_comercial: stringNoVacioSchema,
    descriptor_mapeado_actual: stringNoVacioSchema,
    estado: z.enum(["CONFIRMADO", "CONTRADICHO", "PENDIENTE_SIN_EVIDENCIA"]),
    evaluaciones: z.array(
      z
        .object({
          concept_id: stringNoVacioSchema,
          veredicto: z.enum(["CONFIRMADO", "CONTRADICHO"]),
          confianza: z.number().min(0).max(1),
          razon: stringNoVacioSchema,
        })
        .strict(),
    ),
  })
  .strict();
const reporteV1Schema = z
  .object({
    schema_version: z.literal(VERSION_REPORTE_V1),
    creado_en: stringNoVacioSchema,
    actualizado_en: stringNoVacioSchema,
    fuentes: fuentesSchema,
    ejecucion: ejecucionAnteriorSchema,
    resumen: resumenV1Schema,
    auditoria_colores_mapeados: z.array(auditoriaColorSchema),
    conceptos: z.array(z.union([resultadoCompletadoV1Schema, resultadoErrorSchema])),
  })
  .strict();
const reporteV2Schema = z
  .object({
    schema_version: z.literal(VERSION_REPORTE_V2),
    creado_en: stringNoVacioSchema,
    actualizado_en: stringNoVacioSchema,
    fuentes: fuentesSchema,
    ejecucion: ejecucionAnteriorSchema,
    resumen: resumenV2Schema,
    auditoria_colores_mapeados: z.array(auditoriaColorSchema),
    conceptos: z.array(z.union([resultadoCompletadoV2Schema, resultadoErrorSchema])),
    migracion: z
      .object({ desde: z.literal(VERSION_REPORTE_V1), migrado_en: stringNoVacioSchema })
      .strict()
      .optional(),
  })
  .strict();
const reporteV3Schema = z
  .object({
    schema_version: z.literal(VERSION_REPORTE_ANTERIOR),
    creado_en: stringNoVacioSchema,
    actualizado_en: stringNoVacioSchema,
    fuentes: fuentesSchema,
    ejecucion: ejecucionV3Schema,
    resumen: resumenV2Schema,
    auditoria_colores_mapeados: z.array(auditoriaColorSchema),
    conceptos: z.array(z.union([resultadoCompletadoV3Schema, resultadoErrorSchema])),
    migracion: z
      .object({ desde: z.enum([VERSION_REPORTE_V1, VERSION_REPORTE_V2]), migrado_en: stringNoVacioSchema })
      .strict()
      .optional(),
  })
  .strict();
const reporteV4Schema = reporteV3Schema
  .omit({ schema_version: true, ejecucion: true, migracion: true })
  .extend({
    schema_version: z.literal(VERSION_REPORTE),
    ejecucion: ejecucionSchema,
    migracion: z
      .object({
        desde: z.enum([VERSION_REPORTE_V1, VERSION_REPORTE_V2, VERSION_REPORTE_ANTERIOR]),
        migrado_en: stringNoVacioSchema,
      })
      .strict()
      .optional(),
  })
  .strict();

type ReporteV1 = z.infer<typeof reporteV1Schema>;
type ReporteV2 = z.infer<typeof reporteV2Schema>;
type ReporteV3 = z.infer<typeof reporteV3Schema>;
type ResultadoCompletadoV1 = z.infer<typeof resultadoCompletadoV1Schema>;
type ResultadoCompletadoV2 = z.infer<typeof resultadoCompletadoV2Schema>;

function mostrarAyuda(): void {
  console.log(`Uso: npx tsx scripts/redescribir-vocabulario-visual.ts [opciones]

Opciones:
  --limit N          Procesa como máximo N conceptos (prioriza casos críticos).
  --concepto <id[,id2,...]>  Procesa solo esos concept_id (uno o varios separados por coma).
  --out <ruta>       JSON de propuesta. Por defecto: reports/propuesta-vocabulario-visual-v001.json
  --help             Muestra esta ayuda.

Motor: opencode (OpenCode Zen), modelo ${OPENCODE_MODELO}, variante ${OPENCODE_VARIANTE}, pool de hasta ${CONCURRENCIA} workers por lote.
El JSON funciona como caché por concept_id: resultados completados no vuelven a consumir visión.`);
}

function rutaCanonica(ruta: string): string {
  const absoluta = path.resolve(ruta);
  let existente = absoluta;
  const sufijo: string[] = [];
  while (!existsSync(existente)) {
    const padre = path.dirname(existente);
    if (padre === existente) break;
    sufijo.unshift(path.basename(existente));
    existente = padre;
  }
  const base = existsSync(existente) ? realpathSync.native(existente) : existente;
  const resuelta = path.resolve(base, ...sufijo);
  return process.platform === "win32" ? resuelta.toLowerCase() : resuelta;
}

function validarRutaSalida(ruta: string): void {
  const salidaCanonica = rutaCanonica(ruta);
  for (const protegida of RUTAS_PROTEGIDAS) {
    if (salidaCanonica === rutaCanonica(protegida)) {
      throw new Error(`--out no puede apuntar a fuente protegida: ${protegida}`);
    }
    if (existsSync(ruta) && existsSync(protegida)) {
      const salidaStat = statSync(ruta);
      const protegidaStat = statSync(protegida);
      if (salidaStat.ino !== 0 && salidaStat.dev === protegidaStat.dev && salidaStat.ino === protegidaStat.ino) {
        throw new Error(`--out comparte identidad de archivo con fuente protegida: ${protegida}`);
      }
    }
  }
}

function leerOpciones(argumentos: string[]): Opciones {
  const opciones: Opciones = { limit: null, concepto: null, out: SALIDA_PREDETERMINADA };
  for (let i = 0; i < argumentos.length; i += 1) {
    const argumento = argumentos[i];
    if (argumento === "--help" || argumento === "-h") {
      mostrarAyuda();
      process.exit(0);
    }
    if (argumento === "--limit") {
      const valor = argumentos[++i];
      const numero = Number(valor);
      if (!valor || !Number.isSafeInteger(numero) || numero <= 0) {
        throw new Error("--limit exige un entero positivo.");
      }
      opciones.limit = numero;
      continue;
    }
    if (argumento === "--concepto") {
      const valor = argumentos[++i]?.trim();
      if (!valor) throw new Error("--concepto exige un concept_id.");
      opciones.concepto = valor;
      continue;
    }
    if (argumento === "--out") {
      const valor = argumentos[++i]?.trim();
      if (!valor) throw new Error("--out exige una ruta.");
      opciones.out = path.resolve(process.cwd(), valor);
      continue;
    }
    throw new Error(`Flag desconocido: ${argumento}`);
  }
  validarRutaSalida(opciones.out);
  return opciones;
}

function esRegistro(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

function cadena(valor: unknown, contexto: string): string {
  if (typeof valor !== "string" || !valor.trim()) throw new Error(`${contexto} debe ser string no vacío.`);
  return valor;
}

function numero(valor: unknown, contexto: string): number {
  if (typeof valor !== "number" || !Number.isFinite(valor)) throw new Error(`${contexto} debe ser número.`);
  return valor;
}

function identificador(valor: unknown, contexto: string): string {
  if ((typeof valor !== "string" && typeof valor !== "number") || !String(valor).trim()) {
    throw new Error(`${contexto} debe ser identificador string/número no vacío.`);
  }
  return String(valor);
}

function leerImagen(valor: unknown, contexto: string): ShopifyImage {
  if (!esRegistro(valor)) throw new Error(`${contexto} debe ser objeto.`);
  const variantIds = valor.variant_ids;
  if (!Array.isArray(variantIds)) throw new Error(`${contexto}.variant_ids debe ser arreglo.`);
  return {
    id: identificador(valor.id, `${contexto}.id`),
    position: typeof valor.position === "number" ? valor.position : Number.MAX_SAFE_INTEGER,
    variant_ids: variantIds.map((id, indice) => identificador(id, `${contexto}.variant_ids[${indice}]`)),
    src: cadena(valor.src, `${contexto}.src`),
  };
}

function leerSnapshot(): ShopifyProduct[] {
  const raw: unknown = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8"));
  if (!esRegistro(raw) || !Array.isArray(raw.productos)) {
    throw new Error('Snapshot inválido: se esperaba objeto con clave "productos" de tipo arreglo.');
  }

  return raw.productos.map((valor, indice) => {
    const contexto = `productos[${indice}]`;
    if (!esRegistro(valor)) throw new Error(`${contexto} debe ser objeto.`);
    if (!Array.isArray(valor.images)) throw new Error(`${contexto}.images debe ser arreglo.`);
    if (!Array.isArray(valor.variants)) throw new Error(`${contexto}.variants debe ser arreglo.`);
    const images = valor.images.map((imagen, imageIndex) => leerImagen(imagen, `${contexto}.images[${imageIndex}]`));
    const variants = valor.variants.map((variante, variantIndex): ShopifyVariant => {
      const variantContext = `${contexto}.variants[${variantIndex}]`;
      if (!esRegistro(variante)) throw new Error(`${variantContext} debe ser objeto.`);
      if (variante.sku !== null && variante.sku !== undefined && typeof variante.sku !== "string") {
        throw new Error(`${variantContext}.sku debe ser string o null.`);
      }
      return {
        id: identificador(variante.id, `${variantContext}.id`),
        sku: typeof variante.sku === "string" && variante.sku.trim() ? variante.sku : null,
        featured_image:
          variante.featured_image === null || variante.featured_image === undefined
            ? null
            : leerImagen(variante.featured_image, `${variantContext}.featured_image`),
      };
    });
    return {
      id: identificador(valor.id, `${contexto}.id`),
      title: cadena(valor.title, `${contexto}.title`),
      images,
      variants,
    };
  });
}

function normalizar(valor: string): string {
  return valor
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function elegirFoto(concepto: ProductConcept, productos: ShopifyProduct[]): FotoElegida {
  const ids = new Set(concepto.catalog_product_ids.map(String));
  const titulos = new Set((concepto.catalog_titles ?? []).map(normalizar));

  const candidatos = productos
    .map((producto) => {
      const variantesSku = producto.variants.filter((variante) => variante.sku && ids.has(variante.sku));
      const porProducto = ids.has(producto.id);
      const porTitulo = titulos.has(normalizar(producto.title));
      if (!porProducto && variantesSku.length === 0 && !porTitulo) return null;

      const varianteIds = new Set(variantesSku.map((variante) => variante.id));
      const imagenes = new Map<string, ShopifyImage>();
      for (const variante of variantesSku) {
        if (variante.featured_image) imagenes.set(variante.featured_image.src, variante.featured_image);
      }
      for (const imagen of producto.images) imagenes.set(imagen.src, imagen);

      const foto = [...imagenes.values()].sort((a, b) => {
        const afinidadA = a.variant_ids.some((id) => varianteIds.has(id)) ? 1 : 0;
        const afinidadB = b.variant_ids.some((id) => varianteIds.has(id)) ? 1 : 0;
        return afinidadB - afinidadA || a.position - b.position;
      })[0];
      if (!foto) return null;

      const coincidencias = [
        ...(porProducto ? [`product_id:${producto.id}`] : []),
        ...variantesSku.map((variante) => `sku:${variante.sku}`),
        ...(porTitulo ? ["catalog_title"] : []),
      ];
      const puntaje = (porProducto ? 10_000 : 0) + variantesSku.length * 100 + (porTitulo ? 10 : 0);
      return { producto, foto, coincidencias, puntaje };
    })
    .filter((valor): valor is FotoElegida & { puntaje: number } => valor !== null)
    .sort((a, b) => b.puntaje - a.puntaje);

  const elegido = candidatos[0];
  if (!elegido) {
    throw new Error("Sin producto Shopify con foto cruzable por catalog_product_ids/catalog_titles.");
  }
  return elegido;
}

function nombreArchivoShopify(url: string): string {
  try {
    return decodeURIComponent(path.basename(new URL(url).pathname));
  } catch {
    return path.basename(url.split("?")[0] ?? url);
  }
}

type FormatoImagen = { mime: "image/jpeg" | "image/png" | "image/webp" | "image/gif"; extension: string };

function validarUrlFoto(valor: string): URL {
  let url: URL;
  try {
    url = new URL(valor);
  } catch {
    throw new Error("URL de foto Shopify inválida.");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname.toLowerCase() !== HOST_FOTOS_PERMITIDO ||
    (url.port !== "" && url.port !== "443") ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw new Error(`Foto rechazada: solo HTTPS en ${HOST_FOTOS_PERMITIDO}.`);
  }
  return url;
}

function detectarFormatoImagen(bytes: Buffer): FormatoImagen | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mime: "image/jpeg", extension: ".jpg" };
  }
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mime: "image/png", extension: ".png" };
  }
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") {
    return { mime: "image/webp", extension: ".webp" };
  }
  if (bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(bytes.toString("ascii", 0, 6))) {
    return { mime: "image/gif", extension: ".gif" };
  }
  return null;
}

async function fetchFotoSegura(valorInicial: string): Promise<Response> {
  let url = validarUrlFoto(valorInicial);
  for (let redireccion = 0; redireccion <= 3; redireccion += 1) {
    const respuesta = await fetch(url, {
      redirect: "manual",
      headers: { "User-Agent": "demo-decoracion-vocabulario-visual/2.0" },
      signal: AbortSignal.timeout(45_000),
    });
    if (![301, 302, 303, 307, 308].includes(respuesta.status)) return respuesta;
    const location = respuesta.headers.get("location");
    await respuesta.body?.cancel();
    if (!location) throw new Error(`Redirección HTTP ${respuesta.status} sin Location.`);
    if (redireccion === 3) throw new Error("Demasiadas redirecciones al descargar foto.");
    url = validarUrlFoto(new URL(location, url).toString());
  }
  throw new Error("No se pudo resolver URL de foto.");
}

async function descargarFoto(url: string, directorio: string, indice: number): Promise<string> {
  const respuesta = await fetchFotoSegura(url);
  if (!respuesta.ok) {
    await respuesta.body?.cancel();
    throw new Error(`Descarga de foto falló con HTTP ${respuesta.status}.`);
  }
  const mime = respuesta.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(mime)) {
    await respuesta.body?.cancel();
    throw new Error(`MIME de foto no permitido: ${mime || "ausente"}.`);
  }
  const contentLengthRaw = respuesta.headers.get("content-length");
  if (contentLengthRaw && !/^\d+$/.test(contentLengthRaw)) {
    await respuesta.body?.cancel();
    throw new Error("Content-Length inválido en foto.");
  }
  const contentLength = Number(contentLengthRaw ?? "0");
  if (contentLength > MAX_BYTES_FOTO) {
    await respuesta.body?.cancel();
    throw new Error("La foto supera 20 MB.");
  }
  if (!respuesta.body) throw new Error("Respuesta de foto sin body.");

  const lector = respuesta.body.getReader();
  const fragmentos: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await lector.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES_FOTO) {
      await lector.cancel();
      throw new Error("La foto supera 20 MB durante streaming.");
    }
    fragmentos.push(value);
  }
  if (total === 0) throw new Error("La foto descargada está vacía.");
  const bytes = Buffer.concat(fragmentos.map((fragmento) => Buffer.from(fragmento)), total);
  const formato = detectarFormatoImagen(bytes);
  if (!formato) throw new Error("Magic bytes de foto no reconocidos.");
  if (formato.mime !== mime) throw new Error(`MIME ${mime} contradice magic bytes ${formato.mime}.`);
  const ruta = path.join(directorio, `evidencia-${String(indice).padStart(3, "0")}${formato.extension}`);
  writeFileSync(ruta, bytes);
  return ruta;
}

function descriptorMapeado(color: string): string | null {
  return (COLORES_MAPEADOS as readonly string[]).includes(color) ? aDescriptorPerceptual(color) : null;
}

function construirPrompt(concepto: ProductConcept, descriptorActual: string | null): string {
  const patron = concepto.visual.pattern;
  const contextoEstructural = {
    shape: concepto.visual.shape,
    material: concepto.visual.material,
    pattern_kind: patron.kind,
    pattern_motif: patron.motif ?? null,
  };
  const evaluacion = descriptorActual
    ? `Después de decidir el color de forma independiente, compara SOLO el color contra este descriptor perceptual candidato ya existente: "${descriptorActual}". Devuelve mapped_color_verdict="confirmed" únicamente si coinciden claridad, saturación, matiz y subtono observables; si una diferencia material existe, devuelve "contradicted". Explica la evidencia visual breve en mapped_color_reason.`
    : 'No hay descriptor de color candidato para auditar. Devuelve mapped_color_verdict="not_applicable" y mapped_color_reason vacío.';

  return `Analiza la FOTO DE PRODUCTO adjunta con visión. Tu tarea es proponer vocabulario perceptual en inglés para un modelo generador de imágenes.

REGLA CENTRAL: describe únicamente píxeles observables del producto. No uses, traduzcas ni infieras nombres de producto, nombres de línea, texto impreso, marca, etiquetas, SKU ni filename. Ignora fondo, empaque y texto. El archivo local tiene nombre neutro a propósito.

Contexto estructural no comercial para identificar el objeto (no aporta color ni acabado):
${JSON.stringify(contextoEstructural)}

COLOR:
- Decide explícitamente claridad, saturación, temperatura/subtono y matiz.
- Usa "extremely pale", "very pale", "desaturated", "muted", "silvery", etc. cuando la foto lo exija. No suavices una desaturación extrema a solo "pale".
- Evita nombres poéticos o comerciales. Escribe un descriptor compacto y reproducible.

ACABADO/SUPERFICIE:
- Describe físicamente brillo, reflexión, opacidad y transparencia.
- En látex distingue pearlescent, chrome/high-gloss, matte y translucent. "Satin" textil no sirve para látex.
- Usa vocabulario consistente: "chrome-like pearl sheen", "soft pearlescent sheen", "high-gloss chrome", "soft matte", "clear translucent" cuando corresponda.

CALIBRACIÓN OBLIGATORIA: una foto de látex casi plateado, apenas rosa-malva, muy desaturado y con reflejo nacarado cromado debe producir exactamente color="extremely pale desaturated silvery mauve-pink" y finish="chrome-like pearl sheen". "pale pearlescent pink" se queda corto y es incorrecto para ese caso.

${evaluacion}

canonical_label debe ser una etiqueta descriptiva compacta del objeto observado. CONSTRÚYELA copiando carácter por carácter los valores completos que escribiste en color y finish; no los resumas, traduzcas, flexiones ni parafrasees. Antes de responder, comprueba literalmente que canonical_label incluye ambas cadenas exactas. Si no, corrige canonical_label. No uses nombres comerciales. color_evidence y finish_evidence deben señalar rasgos visibles concretos, no instrucciones ni metadatos. confidence es número entre 0 y 1.

Responde ÚNICAMENTE con un objeto JSON válido, sin markdown ni texto alrededor, según este schema:
${JSON.stringify(SCHEMA_VISION)}`;
}

function calcularCacheKey(
  concepto: ProductConcept,
  elegida: FotoElegida,
  prompt: string,
): string {
  const material = JSON.stringify({
    cache_policy: VERSION_POLITICA_CACHE,
    concepto: {
      concept_id: concepto.concept_id,
      canonical_label: concepto.canonical_label,
      visual: concepto.visual,
    },
    foto: {
      shopify_product_id: elegida.producto.id,
      shopify_image_id: elegida.foto.id,
      url: elegida.foto.src,
    },
    vision: {
      proveedor: PROVEEDOR,
      orquestacion: ORQUESTACION,
      contrato_subagente: CONTRATO_SUBAGENTE,
      prompt,
      schema: SCHEMA_VISION,
      modelo: OPENCODE_MODELO,
      esfuerzo: OPENCODE_VARIANTE,
    },
  });
  return createHash("sha256").update(material).digest("hex");
}

function contieneFrase(texto: string, frase: string): boolean {
  const textoNormalizado = ` ${normalizar(texto)} `;
  const fraseNormalizada = normalizar(frase);
  return fraseNormalizada.length > 0 && textoNormalizado.includes(` ${fraseNormalizada} `);
}

function frasesComercialesRelevantes(concepto: ProductConcept): string[] {
  const frases = new Set<string>(ACABADOS_COMERCIALES);
  for (const titulo of concepto.catalog_titles ?? []) {
    const coincidencia = titulo.match(/\b(?:PASTEL\s+DUSK|PASTEL\s+MATTE|PASTEL\s+MATE|SILK|REFLEX|FASHION|CRYSTAL)\b\s+(.+)$/i);
    if (coincidencia?.[1]?.trim()) {
      frases.add(titulo);
      frases.add(coincidencia[1].trim());
    }
  }
  if ((ACABADOS_COMERCIALES as readonly string[]).includes(concepto.visual.finish)) {
    frases.add(concepto.visual.finish);
    frases.add(concepto.canonical_label);
  }
  if ((COLORES_MAPEADOS as readonly string[]).includes(concepto.visual.color)) {
    frases.add(concepto.visual.color);
    frases.add(concepto.canonical_label);
  }
  for (const linea of ["silk", "reflex", "fashion", "crystal"]) {
    for (const contexto of [
      `${linea} finish`,
      `${linea} line`,
      `${linea} series`,
      `${linea} latex`,
      `${linea} balloon`,
      `finish ${linea}`,
      `line ${linea}`,
      `series ${linea}`,
    ]) {
      frases.add(contexto);
    }
  }
  return [...frases];
}

function validarSinFiltracionComercial(
  concepto: ProductConcept,
  campos: Array<readonly [string, string]>,
): void {
  const frases = frasesComercialesRelevantes(concepto);
  for (const [campo, texto] of campos) {
    for (const frase of frases) {
      if (contieneFrase(texto, frase)) {
        throw new Error(`${campo} filtró frase comercial relevante "${frase}".`);
      }
    }
    const normalizado = normalizar(texto);
    if (["silk", "reflex", "fashion", "crystal", "pastel dusk", "pastel matte"].includes(normalizado)) {
      throw new Error(`${campo} quedó reducido a nombre de línea comercial.`);
    }
  }
}

function revisionHumanaPara(
  conceptId: string,
  propuesta: { color: string; finish: string },
): RevisionHumana {
  const clonaCalibracion =
    conceptId !== CONCEPTO_CALIBRACION &&
    normalizar(propuesta.color) === normalizar(DESCRIPTOR_CALIBRADO_COLOR) &&
    normalizar(propuesta.finish) === normalizar(DESCRIPTOR_CALIBRADO_FINISH);
  return {
    requerida: clonaCalibracion,
    motivos: clonaCalibracion
      ? ["CLONA_DESCRIPTOR_CALIBRADO_SPRING_PINK_EN_OTRO_CONCEPTO: posible sesgo del ejemplo; revisar foto manualmente."]
      : [],
  };
}

/**
 * En Windows npm deja `opencode` en el PATH como .cmd, y Node ya no permite
 * spawnear un .cmd sin `shell: true` — y con shell de por medio este prompt
 * (multilínea, con comillas) se rompe al escapar. Se apunta directo al .exe
 * que ese .cmd invoca por dentro (mismo criterio que
 * `src/lib/ordenes/generarCaption.ts`).
 */
function binarioOpencode(): string {
  if (process.env.OPENCODE_BIN) return process.env.OPENCODE_BIN;
  if (process.platform !== "win32") return "opencode";
  const candidatos = [
    path.join(process.env.APPDATA ?? "", "npm", "node_modules", "opencode-ai", "bin", "opencode.exe"),
    path.join(process.env.LOCALAPPDATA ?? "", "opencode", "bin", "opencode.exe"),
  ];
  return candidatos.find((ruta) => existsSync(ruta)) ?? "opencode";
}

function validarRespuestaVision(valor: unknown, tieneMapeo: boolean, concepto: ProductConcept): RespuestaVision {
  if (!esRegistro(valor)) throw new Error("Respuesta de visión no es objeto JSON.");
  const confidence = numero(valor.confidence, "confidence");
  if (confidence < 0 || confidence > 1) throw new Error("confidence debe estar entre 0 y 1.");
  const verdict = cadena(valor.mapped_color_verdict, "mapped_color_verdict");
  if (!["confirmed", "contradicted", "not_applicable"].includes(verdict)) {
    throw new Error("mapped_color_verdict inválido.");
  }
  if (tieneMapeo && verdict === "not_applicable") {
    throw new Error("Visión omitió auditoría del descriptor mapeado.");
  }
  if (!tieneMapeo && verdict !== "not_applicable") {
    throw new Error("Visión auditó descriptor inexistente.");
  }

  const resultado: RespuestaVision = {
    color: cadena(valor.color, "color"),
    finish: cadena(valor.finish, "finish"),
    canonical_label: cadena(valor.canonical_label, "canonical_label"),
    confidence,
    color_evidence: cadena(valor.color_evidence, "color_evidence"),
    finish_evidence: cadena(valor.finish_evidence, "finish_evidence"),
    mapped_color_verdict: verdict as RespuestaVision["mapped_color_verdict"],
    mapped_color_reason:
      verdict === "not_applicable" && valor.mapped_color_reason === ""
        ? ""
        : cadena(valor.mapped_color_reason, "mapped_color_reason"),
  };

  validarSinFiltracionComercial(concepto, [
    ["color", resultado.color],
    ["finish", resultado.finish],
    ["canonical_label", resultado.canonical_label],
    ["color_evidence", resultado.color_evidence],
    ["finish_evidence", resultado.finish_evidence],
    ["mapped_color_reason", resultado.mapped_color_reason],
  ]);
  const labelNormalizada = resultado.canonical_label.toLowerCase();
  if (!labelNormalizada.includes(resultado.color.toLowerCase()) || !labelNormalizada.includes(resultado.finish.toLowerCase())) {
    throw new Error("canonical_label no contiene color y finish literalmente.");
  }
  return resultado;
}

/**
 * opencode no tiene un equivalente del `--json-schema` del CLI de Claude:
 * `--format json` emite el stream de eventos de la sesión (JSONL), no la
 * respuesta tipada. El schema viaja dentro del prompt y acá se rearma el
 * texto final del assistant desde los eventos `text` — acumulados por id de
 * part, porque un mismo part puede llegar actualizado más de una vez
 * mientras streamea (mismo criterio que `src/lib/ordenes/generarCaption.ts`).
 */
function textoFinalDeEventosOpencode(raw: string): string | null {
  const partes = new Map<string, string>();
  for (const linea of raw.split(/\r?\n/)) {
    if (!linea.startsWith("{")) continue;
    try {
      const evento = JSON.parse(linea) as { type?: string; part?: { id?: string; text?: string } };
      if (evento.type === "text" && evento.part?.id && typeof evento.part.text === "string") {
        partes.set(evento.part.id, evento.part.text);
      }
    } catch {
      // Línea truncada o log suelto mezclado en el stream — se ignora.
    }
  }
  const texto = [...partes.values()].join("").trim();
  return texto || null;
}

/** Recorta el objeto JSON aunque el modelo lo haya envuelto en ```json o en un párrafo. */
function recortarJsonOpencode(texto: string): string | null {
  const inicio = texto.indexOf("{");
  const fin = texto.lastIndexOf("}");
  if (inicio === -1 || fin <= inicio) return null;
  return texto.slice(inicio, fin + 1);
}

function extraerSalidaOpencode(raw: string): unknown {
  const texto = textoFinalDeEventosOpencode(raw);
  if (!texto) throw new Error("opencode no devolvió texto de respuesta.");
  const json = recortarJsonOpencode(texto);
  if (!json) throw new Error("opencode no devolvió un objeto JSON reconocible.");
  try {
    return JSON.parse(json) as unknown;
  } catch {
    throw new Error("opencode devolvió un JSON inválido.");
  }
}

function ejecutarOpencode(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hijo = spawn(binarioOpencode(), args, { cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const salida: Buffer[] = [];
    const errores: Buffer[] = [];
    let bytesSalida = 0;
    let bytesErrores = 0;
    let fallo: Error | null = null;
    const terminar = (error: Error) => {
      if (fallo) return;
      fallo = error;
      hijo.kill();
    };
    const temporizador = setTimeout(
      () => terminar(new Error(`opencode excedió timeout de ${TIMEOUT_LOTE_MS} ms.`)),
      TIMEOUT_LOTE_MS,
    );
    hijo.stdout.on("data", (fragmento: Buffer) => {
      bytesSalida += fragmento.length;
      if (bytesSalida > MAX_BYTES_SALIDA) terminar(new Error("Salida de opencode excedió 20 MiB."));
      else salida.push(fragmento);
    });
    hijo.stderr.on("data", (fragmento: Buffer) => {
      bytesErrores += fragmento.length;
      if (bytesErrores > MAX_BYTES_SALIDA) terminar(new Error("stderr de opencode excedió 20 MiB."));
      else errores.push(fragmento);
    });
    hijo.on("error", (error) => terminar(new Error(`No se pudo ejecutar opencode: ${error.message}`)));
    hijo.on("close", (codigo) => {
      clearTimeout(temporizador);
      if (fallo) return reject(fallo);
      const stderr = Buffer.concat(errores).toString("utf8").trim();
      const stdout = Buffer.concat(salida).toString("utf8");
      if (codigo !== 0) {
        const detalle = stderr || stdout.trim().slice(-2_000);
        return reject(
          new Error(`opencode terminó con status ${codigo ?? "desconocido"}${detalle ? `: ${detalle}` : "."}`),
        );
      }
      resolve(stdout);
    });
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const MAX_REINTENTOS_DB_LOCKED = 4;

async function llamarOpencode(trabajo: TrabajoVision): Promise<RespuestaVision> {
  const args = [
    "run",
    // El mensaje va ANTES de los flags a propósito: `--file` es de tipo
    // array en el parser de opencode y se traga cualquier positional que
    // venga después, tomando el prompt entero como si fuera otro archivo
    // adjunto ("File not found: Analiza la FOTO...").
    trabajo.prompt,
    "--model",
    OPENCODE_MODELO,
    "--variant",
    OPENCODE_VARIANTE,
    "--format",
    "json",
    // Agente read-only: la foto ya va adjunta, el modelo no tiene por qué
    // tocar el disco más allá de leerla.
    "--agent",
    "plan",
    "--file",
    trabajo.fotoLocal,
  ];

  // La base de sesiones local de opencode se comparte entre procesos
  // concurrentes; ocasionalmente uno pierde la carrera por el lock ANTES de
  // llegar a la API (sin costo). Reintentar con backoff es seguro: si el
  // error fuera del modelo/proveedor (créditos, modelo deshabilitado, etc.)
  // no contiene "database is locked" y se propaga en el primer intento.
  let ultimoError: unknown;
  for (let intento = 0; intento <= MAX_REINTENTOS_DB_LOCKED; intento += 1) {
    try {
      const raw = await ejecutarOpencode(args, path.dirname(trabajo.fotoLocal));
      return validarRespuestaVision(extraerSalidaOpencode(raw), trabajo.mapeado !== null, trabajo.concepto);
    } catch (error) {
      ultimoError = error;
      const mensaje = error instanceof Error ? error.message : String(error);
      if (!mensaje.includes("database is locked") || intento === MAX_REINTENTOS_DB_LOCKED) throw error;
      await sleep(500 * (intento + 1) + Math.floor(Math.random() * 300));
    }
  }
  throw ultimoError;
}

function valoresAnteriores(concepto: ProductConcept): ValoresAnteriores {
  return {
    canonical_label: concepto.canonical_label,
    color: concepto.visual.color,
    finish: concepto.visual.finish,
  };
}

function datosEjecucion(opciones: Opciones, seleccion: ProductConcept[]): Reporte["ejecucion"] {
  return {
    proveedor: PROVEEDOR,
    orquestacion: ORQUESTACION,
    modelo: OPENCODE_MODELO,
    esfuerzo: OPENCODE_VARIANTE,
    subagentes: CONCURRENCIA,
    concurrencia: CONCURRENCIA,
    limit: opciones.limit,
    concepto: opciones.concepto,
    seleccion: seleccion.map((concepto) => concepto.concept_id),
    firma: firmaEjecucion(opciones, seleccion),
  };
}

function crearReporte(opciones: Opciones, seleccion: ProductConcept[]): Reporte {
  const ahora = new Date().toISOString();
  return {
    schema_version: VERSION_REPORTE,
    creado_en: ahora,
    actualizado_en: ahora,
    fuentes: {
      vocabulario: "src/lib/lora/v007-dataset-product-vocabulary.ts",
      snapshot_shopify: "data/raw/shopify-products.snapshot.json",
      descriptor_perceptual: "src/lib/lora/descriptor-perceptual.ts",
    },
    ejecucion: datosEjecucion(opciones, seleccion),
    resumen: {
      conceptos_vocabulario: V007_DATASET_PRODUCT_CONCEPTS.length,
      conceptos_en_reporte: 0,
      completados: 0,
      errores: 0,
      pendientes_sin_procesar: V007_DATASET_PRODUCT_CONCEPTS.length,
      revisiones_humanas_requeridas: 0,
    },
    auditoria_colores_mapeados: [],
    conceptos: [],
  };
}

function mensajeZod(error: z.ZodError): string {
  return error.issues
    .slice(0, 4)
    .map((issue) => `${issue.path.join(".") || "raíz"}: ${issue.message}`)
    .join("; ");
}

function validarSemanticaReporte(reporte: Reporte): void {
  const ids = new Set<string>();
  for (const resultado of reporte.conceptos) {
    if (ids.has(resultado.concept_id)) throw new Error(`--out inválido: concept_id duplicado ${resultado.concept_id}.`);
    ids.add(resultado.concept_id);
    const concepto = V007_DATASET_PRODUCT_CONCEPTS.find((candidato) => candidato.concept_id === resultado.concept_id);
    if (!concepto) throw new Error(`--out contiene concept_id inexistente: ${resultado.concept_id}.`);
    if (JSON.stringify(resultado.anterior) !== JSON.stringify(valoresAnteriores(concepto))) {
      throw new Error(`--out contiene valores anteriores alterados para ${resultado.concept_id}.`);
    }
    if (resultado.estado === "completado") {
      validarSinFiltracionComercial(concepto, [
        ["propuesta.color", resultado.propuesta.color],
        ["propuesta.finish", resultado.propuesta.finish],
        ["propuesta.canonical_label", resultado.propuesta.canonical_label],
        ["evidencia.observacion_color", resultado.evidencia.observacion_color],
        ["evidencia.observacion_acabado", resultado.evidencia.observacion_acabado],
        [
          "auditoria_descriptor_perceptual.razon",
          resultado.auditoria_descriptor_perceptual.aplica
            ? resultado.auditoria_descriptor_perceptual.razon
            : "",
        ],
      ]);
      const revisionEsperada = revisionHumanaPara(resultado.concept_id, resultado.propuesta);
      if (JSON.stringify(resultado.revision_humana) !== JSON.stringify(revisionEsperada)) {
        throw new Error(`--out contiene señal de revisión humana inconsistente para ${resultado.concept_id}.`);
      }
    }
  }
}

function convertirCompletadoV2(resultado: ResultadoCompletadoV2): ResultadoCompletado {
  const { variante, ...resto } = resultado;
  return { ...resto, proveedor: "opencode", modelo: resultado.modelo, esfuerzo: variante };
}

function completarResultadoV1(resultado: ResultadoCompletadoV1, productos: ShopifyProduct[]): ResultadoCompletadoV2 {
    const concepto = V007_DATASET_PRODUCT_CONCEPTS.find((candidato) => candidato.concept_id === resultado.concept_id);
    if (!concepto) throw new Error(`No se puede migrar concept_id inexistente: ${resultado.concept_id}.`);
    if (JSON.stringify(resultado.anterior) !== JSON.stringify(valoresAnteriores(concepto))) {
      throw new Error(`No se puede migrar ${resultado.concept_id}: vocabulario cambió.`);
    }
    validarSinFiltracionComercial(concepto, [
      ["propuesta.color", resultado.propuesta.color],
      ["propuesta.finish", resultado.propuesta.finish],
      ["propuesta.canonical_label", resultado.propuesta.canonical_label],
      ["evidencia.observacion_color", resultado.evidencia.observacion_color],
      ["evidencia.observacion_acabado", resultado.evidencia.observacion_acabado],
      [
        "auditoria_descriptor_perceptual.razon",
        resultado.auditoria_descriptor_perceptual.aplica ? resultado.auditoria_descriptor_perceptual.razon : "",
      ],
    ]);
    const elegida = elegirFoto(concepto, productos);
    if (
      resultado.evidencia.foto_url !== elegida.foto.src ||
      resultado.evidencia.shopify_product_id !== elegida.producto.id ||
      resultado.evidencia.archivo_shopify !== nombreArchivoShopify(elegida.foto.src)
    ) {
      throw new Error(`No se puede migrar ${resultado.concept_id}: identidad de foto cambió.`);
    }
    return {
      ...resultado,
      evidencia: { ...resultado.evidencia, shopify_image_id: elegida.foto.id },
      cache_key: createHash("sha256")
        .update(JSON.stringify({ politica: "legacy-v1", concept_id: resultado.concept_id, modelo: resultado.modelo }))
        .digest("hex"),
      revision_humana: revisionHumanaPara(resultado.concept_id, resultado.propuesta),
    };
}

function migrarReporteAnterior(
  reporte: ReporteV1 | ReporteV2 | ReporteV3,
  opciones: Opciones,
  seleccion: ProductConcept[],
  productos: ShopifyProduct[],
): Reporte {
  const conceptos = reporte.conceptos.map((resultado): ResultadoConcepto => {
    if (resultado.estado === "error") return resultado;
    if (reporte.schema_version === VERSION_REPORTE_ANTERIOR) return resultado as ResultadoCompletado;
    const v2 = reporte.schema_version === VERSION_REPORTE_V1
      ? completarResultadoV1(resultado as ResultadoCompletadoV1, productos)
      : resultado as ResultadoCompletadoV2;
    return convertirCompletadoV2(v2);
  });
  const migrado: Reporte = {
    schema_version: VERSION_REPORTE,
    creado_en: reporte.creado_en,
    actualizado_en: reporte.actualizado_en,
    fuentes: reporte.fuentes,
    ejecucion: datosEjecucion(opciones, seleccion),
    resumen: {
      ...reporte.resumen,
      revisiones_humanas_requeridas: conceptos.filter(
        (resultado) => resultado.estado === "completado" && resultado.revision_humana.requerida,
      ).length,
    },
    auditoria_colores_mapeados: reporte.auditoria_colores_mapeados,
    conceptos,
    migracion: { desde: reporte.schema_version, migrado_en: new Date().toISOString() },
  };
  actualizarReporte(
    migrado,
    new Map(V007_DATASET_PRODUCT_CONCEPTS.map((concepto, indice) => [concepto.concept_id, indice])),
  );
  return migrado;
}

function leerReporte(
  ruta: string,
  opciones: Opciones,
  seleccion: ProductConcept[],
  productos: ShopifyProduct[],
): { reporte: Reporte; migrado: boolean } {
  if (!existsSync(ruta)) return { reporte: crearReporte(opciones, seleccion), migrado: false };
  const raw: unknown = JSON.parse(readFileSync(ruta, "utf8"));
  if (esRegistro(raw) && raw.schema_version === VERSION_REPORTE_V1) {
    const validado = reporteV1Schema.safeParse(raw);
    if (!validado.success) throw new Error(`--out v1 inválido; no se migra: ${mensajeZod(validado.error)}`);
    const reporte = migrarReporteAnterior(validado.data, opciones, seleccion, productos);
    validarSemanticaReporte(reporte);
    return { reporte, migrado: true };
  }
  if (esRegistro(raw) && raw.schema_version === VERSION_REPORTE_V2) {
    const validado = reporteV2Schema.safeParse(raw);
    if (!validado.success) throw new Error(`--out v2 inválido; no se migra: ${mensajeZod(validado.error)}`);
    const reporte = migrarReporteAnterior(validado.data, opciones, seleccion, productos);
    validarSemanticaReporte(reporte);
    return { reporte, migrado: true };
  }
  if (esRegistro(raw) && raw.schema_version === VERSION_REPORTE_ANTERIOR) {
    const validado = reporteV3Schema.safeParse(raw);
    if (!validado.success) throw new Error(`--out v3 inválido; no se migra: ${mensajeZod(validado.error)}`);
    const reporte = migrarReporteAnterior(validado.data, opciones, seleccion, productos);
    validarSemanticaReporte(reporte);
    return { reporte, migrado: true };
  }
  const validado = reporteV4Schema.safeParse(raw);
  if (!validado.success) {
    throw new Error(`--out no es reporte ${VERSION_REPORTE} válido: ${mensajeZod(validado.error)}`);
  }
  const reporte = validado.data as Reporte;
  validarSemanticaReporte(reporte);
  return { reporte, migrado: false };
}

function firmaEjecucion(opciones: Opciones, seleccion: ProductConcept[]): string {
  return JSON.stringify({
    proveedor: PROVEEDOR,
    orquestacion: ORQUESTACION,
    contrato_subagente: CONTRATO_SUBAGENTE,
    modelo: OPENCODE_MODELO,
    esfuerzo: OPENCODE_VARIANTE,
    subagentes: CONCURRENCIA,
    limit: opciones.limit,
    concepto: opciones.concepto,
    seleccion: seleccion.map((concepto) => concepto.concept_id),
  });
}

function construirAuditoria(resultados: ResultadoConcepto[]): AuditoriaColor[] {
  return COLORES_MAPEADOS.map((color) => {
    const evaluaciones = resultados.flatMap((resultado) => {
      if (resultado.estado !== "completado") return [];
      const auditoria = resultado.auditoria_descriptor_perceptual;
      if (!auditoria.aplica || auditoria.color_comercial !== color) return [];
      return [{
        concept_id: resultado.concept_id,
        veredicto: auditoria.veredicto,
        confianza: resultado.confianza,
        razon: auditoria.razon,
      }];
    });
    const estado =
      evaluaciones.length === 0
        ? "PENDIENTE_SIN_EVIDENCIA"
        : evaluaciones.some((evaluacion) => evaluacion.veredicto === "CONTRADICHO")
          ? "CONTRADICHO"
          : "CONFIRMADO";
    return {
      color_comercial: color,
      descriptor_mapeado_actual: aDescriptorPerceptual(color),
      estado,
      evaluaciones,
    };
  });
}

function actualizarReporte(reporte: Reporte, orden: Map<string, number>): void {
  reporte.conceptos.sort(
    (a, b) => (orden.get(a.concept_id) ?? Number.MAX_SAFE_INTEGER) - (orden.get(b.concept_id) ?? Number.MAX_SAFE_INTEGER),
  );
  reporte.auditoria_colores_mapeados = construirAuditoria(reporte.conceptos);
  const completados = reporte.conceptos.filter((resultado) => resultado.estado === "completado").length;
  const errores = reporte.conceptos.filter((resultado) => resultado.estado === "error").length;
  const revisiones = reporte.conceptos.filter(
    (resultado) => resultado.estado === "completado" && resultado.revision_humana.requerida,
  ).length;
  reporte.resumen = {
    conceptos_vocabulario: V007_DATASET_PRODUCT_CONCEPTS.length,
    conceptos_en_reporte: reporte.conceptos.length,
    completados,
    errores,
    pendientes_sin_procesar: Math.max(0, V007_DATASET_PRODUCT_CONCEPTS.length - reporte.conceptos.length),
    revisiones_humanas_requeridas: revisiones,
  };
  reporte.actualizado_en = new Date().toISOString();
}

function escribirArchivoSincronizado(ruta: string, contenido: string): void {
  const descriptor = openSync(ruta, "wx");
  try {
    writeFileSync(descriptor, contenido, "utf8");
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function renombrarConReintentos(origen: string, destino: string): void {
  const pausas = [0, 25, 100, 250];
  let ultimoError: unknown;
  for (const pausa of pausas) {
    if (pausa > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, pausa);
    try {
      renameSync(origen, destino);
      return;
    } catch (error) {
      ultimoError = error;
      const codigo = esRegistro(error) && typeof error.code === "string" ? error.code : "";
      if (!["EPERM", "EACCES", "EBUSY"].includes(codigo)) throw error;
    }
  }
  throw ultimoError;
}

function guardarReporte(ruta: string, reporte: Reporte, orden: Map<string, number>): void {
  actualizarReporte(reporte, orden);
  validarSemanticaReporte(reporte);
  const validado = reporteV4Schema.safeParse(reporte);
  if (!validado.success) throw new Error(`Reporte interno inválido: ${mensajeZod(validado.error)}`);
  mkdirSync(path.dirname(ruta), { recursive: true });
  const sufijo = `${process.pid}-${Date.now()}`;
  const temporal = `${ruta}.${sufijo}.tmp`;
  const respaldo = `${ruta}.${sufijo}.backup`;
  escribirArchivoSincronizado(temporal, `${JSON.stringify(reporte, null, 2)}\n`);
  if (!existsSync(ruta)) {
    try {
      renombrarConReintentos(temporal, ruta);
    } catch (error) {
      rmSync(temporal, { force: true });
      throw error;
    }
    return;
  }

  try {
    renombrarConReintentos(ruta, respaldo);
  } catch (error) {
    rmSync(temporal, { force: true });
    throw error;
  }
  try {
    renombrarConReintentos(temporal, ruta);
  } catch (errorNuevo) {
    try {
      renombrarConReintentos(respaldo, ruta);
    } catch (errorRestauracion) {
      throw new Error(
        `Falló reemplazo y restauración. Reporte recuperable en ${respaldo}. Errores: ${String(errorNuevo)}; ${String(errorRestauracion)}`,
      );
    } finally {
      rmSync(temporal, { force: true });
    }
    throw errorNuevo;
  }
  rmSync(respaldo, { force: true, maxRetries: 3, retryDelay: 50 });
}

function prioridad(concepto: ProductConcept, indiceOriginal: number): number {
  if (concepto.concept_id === CONCEPTO_CALIBRACION) return -1_000_000;
  const colorCritico = (COLORES_MAPEADOS as readonly string[]).includes(concepto.visual.color);
  const acabadoCritico = (ACABADOS_COMERCIALES as readonly string[]).includes(concepto.visual.finish);
  if (colorCritico && acabadoCritico) return -500_000 + indiceOriginal;
  if (colorCritico) return -250_000 + indiceOriginal;
  return indiceOriginal;
}

function seleccionarConceptos(opciones: Opciones): ProductConcept[] {
  let seleccion = V007_DATASET_PRODUCT_CONCEPTS.map((concepto, indice) => ({ concepto, indice }))
    .sort((a, b) => prioridad(a.concepto, a.indice) - prioridad(b.concepto, b.indice))
    .map(({ concepto }) => concepto);
  if (opciones.concepto) {
    // Acepta uno o varios concept_id separados por coma — permite reprocesar
    // exactamente un lote puntual (p. ej. los que quedaron en error) sin
    // tocar el resto del vocabulario ya completado.
    const pedidos = opciones.concepto.split(",").map((valor) => valor.trim()).filter(Boolean);
    const disponibles = new Set(seleccion.map((concepto) => concepto.concept_id));
    const inexistentes = pedidos.filter((id) => !disponibles.has(id));
    if (inexistentes.length > 0) throw new Error(`concept_id inexistente: ${inexistentes.join(", ")}`);
    const pedidosSet = new Set(pedidos);
    seleccion = seleccion.filter((concepto) => pedidosSet.has(concepto.concept_id));
  }
  if (opciones.limit !== null) seleccion = seleccion.slice(0, opciones.limit);
  return seleccion;
}

function upsertResultado(reporte: Reporte, resultado: ResultadoConcepto): void {
  const indice = reporte.conceptos.findIndex((existente) => existente.concept_id === resultado.concept_id);
  if (indice === -1) reporte.conceptos.push(resultado);
  else reporte.conceptos[indice] = resultado;
}

async function main(): Promise<void> {
  const opciones = leerOpciones(process.argv.slice(2));
  const seleccion = seleccionarConceptos(opciones);
  const firma = firmaEjecucion(opciones, seleccion);
  const productos = leerSnapshot();
  const lecturaReporte = leerReporte(opciones.out, opciones, seleccion, productos);
  const reporte = lecturaReporte.reporte;
  const orden = new Map(V007_DATASET_PRODUCT_CONCEPTS.map((concepto, indice) => [concepto.concept_id, indice]));
  const seleccionCambio = reporte.ejecucion.firma !== firma;
  reporte.ejecucion = datosEjecucion(opciones, seleccion);

  console.log(`Snapshot validado: ${productos.length} productos. Selección: ${seleccion.length} conceptos.`);
  if (lecturaReporte.migrado) console.log(`Reporte anterior migrado a ${VERSION_REPORTE}; caché de visión se validará por concepto.`);
  const directorioTemporal = mkdtempSync(path.join(tmpdir(), "vocabulario-visual-"));
  let huboCambios = seleccionCambio || lecturaReporte.migrado;
  let guardadoEnBucle = false;
  try {
    const pendientes: TrabajoPendiente[] = [];
    for (let indice = 0; indice < seleccion.length; indice += 1) {
      const concepto = seleccion[indice];
      const prefijo = `[${indice + 1}/${seleccion.length}] ${concepto.concept_id}`;
      try {
        const elegida = elegirFoto(concepto, productos);
        const mapeado = descriptorMapeado(concepto.visual.color);
        const prompt = construirPrompt(concepto, mapeado);
        const cacheKey = calcularCacheKey(concepto, elegida, prompt);
        const existente = reporte.conceptos.find((resultado) => resultado.concept_id === concepto.concept_id);
        if (existente?.estado === "completado" && existente.cache_key === cacheKey) {
          console.log(`${prefijo}: caché válida ${cacheKey.slice(0, 12)}.`);
          continue;
        }
        if (existente?.estado === "completado") console.log(`${prefijo}: caché inválida; reanálisis necesario.`);
        else console.log(`${prefijo}: pendiente de lote opencode.`);
        pendientes.push({ concepto, elegida, mapeado, prompt, cacheKey, indice, prefijo });
      } catch (error) {
        const mensaje = error instanceof Error ? error.message : String(error);
        upsertResultado(reporte, {
          concept_id: concepto.concept_id,
          estado: "error",
          anterior: valoresAnteriores(concepto),
          error: mensaje,
          intentado_en: new Date().toISOString(),
        });
        huboCambios = true;
        guardarReporte(opciones.out, reporte, orden);
        guardadoEnBucle = true;
        console.error(`${prefijo}: ERROR: ${mensaje}`);
      }
    }

    for (let inicio = 0; inicio < pendientes.length; inicio += CONCURRENCIA) {
      const baseLote = pendientes.slice(inicio, inicio + CONCURRENCIA);
      const descargas = await Promise.allSettled(
        baseLote.map(async (trabajo): Promise<TrabajoVision> => {
          const directorioWorker = path.join(directorioTemporal, `worker-${trabajo.indice + 1}`);
          mkdirSync(directorioWorker, { recursive: true });
          return {
            ...trabajo,
            fotoLocal: await descargarFoto(trabajo.elegida.foto.src, directorioWorker, 1),
          };
        }),
      );
      const lote: TrabajoVision[] = [];
      descargas.forEach((descarga, indice) => {
        const trabajo = baseLote[indice];
        if (descarga.status === "fulfilled") {
          lote.push(descarga.value);
          return;
        }
        const mensaje = descarga.reason instanceof Error ? descarga.reason.message : String(descarga.reason);
        upsertResultado(reporte, {
          concept_id: trabajo.concepto.concept_id,
          estado: "error",
          anterior: valoresAnteriores(trabajo.concepto),
          error: mensaje,
          intentado_en: new Date().toISOString(),
        });
        console.error(`${trabajo.prefijo}: ERROR: ${mensaje}`);
      });
      if (lote.length === 0) {
        huboCambios = true;
        guardarReporte(opciones.out, reporte, orden);
        guardadoEnBucle = true;
        continue;
      }

      console.log(`Lote opencode: ${lote.length} workers concurrentes (${lote.map((trabajo) => trabajo.concepto.concept_id).join(", ")}).`);
      const respuestas = await Promise.allSettled(lote.map((trabajo) => llamarOpencode(trabajo)));
      respuestas.forEach((respuesta, indice) => {
        const trabajo = lote[indice];
        if (respuesta.status === "rejected") {
          const mensaje = respuesta.reason instanceof Error ? respuesta.reason.message : String(respuesta.reason);
          upsertResultado(reporte, {
            concept_id: trabajo.concepto.concept_id,
            estado: "error",
            anterior: valoresAnteriores(trabajo.concepto),
            error: mensaje,
            intentado_en: new Date().toISOString(),
          });
          console.error(`${trabajo.prefijo}: ERROR DE WORKER: ${mensaje}`);
          return;
        }
        const vision = respuesta.value;
        const propuesta = {
          canonical_label: vision.canonical_label,
          color: vision.color,
          finish: vision.finish,
        };
        const resultado: ResultadoCompletado = {
          concept_id: trabajo.concepto.concept_id,
          estado: "completado",
          anterior: valoresAnteriores(trabajo.concepto),
          propuesta,
          evidencia: {
            foto_url: trabajo.elegida.foto.src,
            archivo_shopify: nombreArchivoShopify(trabajo.elegida.foto.src),
            shopify_image_id: trabajo.elegida.foto.id,
            shopify_product_id: trabajo.elegida.producto.id,
            catalog_title: trabajo.elegida.producto.title,
            coincidencias: trabajo.elegida.coincidencias,
            observacion_color: vision.color_evidence,
            observacion_acabado: vision.finish_evidence,
          },
          confianza: vision.confidence,
          auditoria_descriptor_perceptual: trabajo.mapeado
            ? {
                aplica: true,
                color_comercial: trabajo.concepto.visual.color,
                descriptor_mapeado_actual: trabajo.mapeado,
                veredicto: vision.mapped_color_verdict === "confirmed" ? "CONFIRMADO" : "CONTRADICHO",
                razon: vision.mapped_color_reason,
              }
            : { aplica: false },
          proveedor: PROVEEDOR,
          modelo: OPENCODE_MODELO,
          esfuerzo: OPENCODE_VARIANTE,
          cache_key: trabajo.cacheKey,
          revision_humana: revisionHumanaPara(trabajo.concepto.concept_id, propuesta),
          analizado_en: new Date().toISOString(),
        };
        upsertResultado(reporte, resultado);
        console.log(`${trabajo.prefijo}: ${vision.color}; ${vision.finish}; confianza ${vision.confidence.toFixed(2)}.`);
      });
      huboCambios = true;
      guardarReporte(opciones.out, reporte, orden);
      guardadoEnBucle = true;
    }
  } finally {
    rmSync(directorioTemporal, { recursive: true, force: true });
  }

  if (huboCambios && !guardadoEnBucle) guardarReporte(opciones.out, reporte, orden);
  console.log(`Reporte: ${opciones.out}`);
  console.log(
    `Resultado: ${reporte.resumen.completados} completados, ${reporte.resumen.errores} errores, ${reporte.resumen.pendientes_sin_procesar} pendientes.`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
