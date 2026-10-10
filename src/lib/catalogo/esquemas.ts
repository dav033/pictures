import { z } from "zod";
import { DetalleIdeaSchema } from "@/lib/biblioteca-sempertex/detalle-idea-esquema";
import { DecoracionSempertexSchema } from "@/lib/biblioteca-sempertex/esquemas";
import { TIPOS_ITEM, type TipoItem } from "@/lib/globos3d/biblioteca";
import { TIPOS_MESA, TIPOS_SILLA } from "@/lib/globos3d/mobiliario-conjunto-tipos";
import { PlanIdeaGuardadoSchema } from "@/lib/plan/plan-de-idea";
import { ReferenciaSchema } from "@/lib/plan/referencia-sempertex";
import { esIdRepositorio, idCalificado } from "./ids";
import type { EntradaCatalogo } from "./repositorio";
import type { ClaseEntrada, IdRepositorio, Superficie } from "./tipos";

/**
 * Los esquemas zod de los repositorios de catálogo (REQ-013, SPEC §4.2): el manifiesto y la carga (`dato`) de cada clase. Las
 * entradas fundadoras se comprueban contra ellos en `test-catalogo-repositorios` (no al importar: el registro no paga validar
 * miles de entradas); las de terceros se validarán al cargarlas (fase 7).
 */

const Texto = z.string().min(1);
const Hex = z.string().regex(/^#[0-9a-f]{6}$/i);
const Positivo = z.number().finite().positive();
const UrlPublica = z.string().regex(/^https:\/\//);
const Semver = z.string().regex(/^\d+\.\d+\.\d+$/);
const Funcion = z.custom<(...args: never[]) => unknown>((v) => typeof v === "function", "se esperaba una función");
const IdRepositorioSchema = z.string().refine((s): s is IdRepositorio => esIdRepositorio(s), "repositorio desconocido");

const SUPERFICIES: Readonly<Record<Superficie, true>> = { taller: true, ia_taller: true, foto: true, rag: true, estudio: true, guiada: true };

const LicenciaSchema = z.object({
  regimen: z.enum(["propia", "marca-socio", "referencia", "cc-by", "cc0", "comercial"]),
  titular: Texto, url: UrlPublica.optional(), atribucion: Texto.optional(), restricciones: z.array(Texto),
}).strict();

const ProcedenciaSchema = z.object({
  fuente: z.enum(["idea-sempertex", "celebra", "tienda-sempertex", "referencia-web", "referencia-dueno", "propio", "terceros"]),
  titulo: Texto, url: UrlPublica.optional(), fotoUrl: UrlPublica.optional(), licencia: LicenciaSchema.optional(),
}).strict();

const ItemBibliotecaSchema = z.looseObject({
  id: Texto,
  tipo: z.enum(TIPOS_ITEM.map((t) => t.id) as [TipoItem, ...TipoItem[]]),
  nombre: Texto,
  descripcion: z.string(),
  ocasiones: z.array(Texto),
  fuente: z.object({ tipo: Texto, titulo: Texto, url: UrlPublica.optional(), fotoUrl: UrlPublica.optional() }).optional(),
  contenido: z.looseObject({ tipo: z.enum(["escena", "conjunto", "pieza"]) }),
});

const EntradaComunSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/), nombre: Texto, descripcion: Texto, lugar: z.enum(["piso", "pared"]),
  retiroCm: z.number().finite().nonnegative().optional(), alturaParedCm: z.number().finite().nonnegative().optional(), flotaCm: Positivo.optional(),
  telon: z.literal(true).optional(), rotulable: z.union([z.literal(true), z.literal("mayor")]).optional(), elementos: Funcion,
});
const fondoFijo = <G extends z.ZodType>(grupo: G) => EntradaComunSchema.extend({ clase: z.literal("fondo"), grupo });
const mueble = <G extends z.ZodType>(grupo: G) => EntradaComunSchema.extend({
  clase: z.literal("mueble"), grupo,
  medidas: z.object({ anchoCm: Positivo, fondoCm: Positivo, altoCm: Positivo }),
  sillas: z.object({ porDefecto: z.number().int().positive(), min: z.number().int().positive(), max: z.number().int().positive(), par: z.boolean() }).optional(),
  colores: z.array(Hex).min(1), coloresDe: z.array(Texto).min(1),
  fondo: z.enum(["libre", "igual_ancho", "proporcional", "fijo"]).optional(),
  seguirPrimero: z.boolean().optional(), asiento: z.boolean().optional(), asientos: z.number().int().positive().optional(),
  conTexto: z.boolean().optional(), textoPorDefecto: Texto.optional(), lineasTexto: z.number().int().positive().optional(),
  acabadosPropios: z.array(z.tuple([Texto, Texto])).optional(), sobreMesa: z.boolean().optional(), armar: Funcion,
});

const RangoMesa = z.tuple([Positivo, Positivo]);
const GeneradorSchema = z.discriminatedUnion("id", [
  z.object({
    id: z.literal("mesa_param"), tipos: z.array(z.enum(TIPOS_MESA)).min(1),
    limites: z.record(z.enum(TIPOS_MESA), z.object({ ancho: RangoMesa, fondo: RangoMesa, alto: RangoMesa })),
  }).strict(),
  z.object({ id: z.literal("sillas_param"), tipos: z.array(z.enum(TIPOS_SILLA)).min(1), maxPorMesa: z.number().int().positive() }).strict(),
]);

const PlanDeIdeaSchema = z.object({ idIdea: Texto, plan: PlanIdeaGuardadoSchema.nullable(), detalle: DetalleIdeaSchema.nullable() })
  .strict().refine((p) => p.plan !== null || p.detalle !== null, "ni plan ni detalle");

/** El esquema de la carga de cada clase. */
export const ESQUEMAS_DATO: Readonly<{ [C in ClaseEntrada]: z.ZodType }> = {
  "item-biblioteca": ItemBibliotecaSchema,
  formato: z.object({
    id: Texto, tipo: z.enum(["redondo", "link", "tubito", "corazon"]), nombre: Texto, diametroMaxCm: Positivo, infladoDecoracionCm: Positivo,
    largoCm: Positivo.optional(), descripcion: Texto,
  }).strict(),
  color: ReferenciaSchema,
  "producto-tienda": z.object({
    id: z.string().regex(/^[a-z0-9-]+$/), nombre: Texto, url: z.string().regex(/^\/products\/[^\s]+$/), tipo: Texto, tematica: z.string(),
    colores: z.array(Texto), medidas: Texto.nullable(), piezasPorPaquete: z.number().int().positive().nullable(),
  }).strict(),
  "plan-idea": PlanDeIdeaSchema,
  "decoracion-guiada": DecoracionSempertexSchema,
  modulo: z.object({
    id: z.enum(["pareja", "trio", "cuarteto", "quinteto", "sexteto"]), nombre: Texto, globos: z.number().int().min(2).max(6), armado: Texto,
    inclinacion: z.number().finite().nonnegative(),
  }).strict(),
  mueble: mueble(z.enum(["asiento", "mesa"])),
  "mueble-fijo": fondoFijo(z.literal("mesa")),
  generador: GeneradorSchema,
  fondo: fondoFijo(z.enum(["fondo", "decorado"]).optional()),
  decorado: mueble(z.literal("decorado")),
};

export const CLASES_ENTRADA = Object.keys(ESQUEMAS_DATO) as ClaseEntrada[];

export const ManifiestoSchema = z.object({
  esquema: z.literal(1),
  id: IdRepositorioSchema,
  version: Semver,
  historial: z.array(z.object({ version: Semver, nota: Texto }).strict()).min(1),
  nombre: Texto,
  descripcion: Texto,
  clases: z.array(z.enum(CLASES_ENTRADA as [ClaseEntrada, ...ClaseEntrada[]])).min(1),
  licencia: LicenciaSchema,
  precio: z.discriminatedUnion("tipo", [
    z.object({ tipo: z.literal("crosswalk-tienda") }).strict(),
    z.object({ tipo: z.literal("lista-alquiler"), archivo: Texto, moneda: z.enum(["COP", "USD"]), vigencia: Texto }).strict(),
    z.object({ tipo: z.literal("sin-precio"), motivo: Texto }).strict(),
  ]),
  visiblePorDefecto: z.array(z.enum(Object.keys(SUPERFICIES) as [Superficie, ...Superficie[]])),
  depende: z.array(IdRepositorioSchema),
  idsLocales: z.union([z.object({ prefijos: z.array(Texto).min(1) }).strict(), z.object({ exactos: z.literal("del-cargador") }).strict()]),
  datos: z.string().regex(/^data\/(taller|catalogos\/[a-z0-9/-]+)$/),
}).strict()
  .refine((m) => m.historial.at(-1)?.version === m.version, "la última línea del historial no es la versión del manifiesto")
  .refine((m) => !m.depende.includes(m.id), "un repositorio no depende de sí mismo");

const EntradaBaseSchema = z.object({
  id: Texto, idLocal: Texto, repositorio: IdRepositorioSchema, clase: z.enum(CLASES_ENTRADA as [ClaseEntrada, ...ClaseEntrada[]]),
  nombre: Texto, descripcion: z.string(), procedencia: ProcedenciaSchema,
}).refine((e) => e.id === idCalificado(e.repositorio, e.idLocal), "el id no es <repositorio>:<idLocal>");

/** Lo que no cuadra de una entrada (vacío si está bien): sus campos y su carga según su clase. Lee `dato`: la arma. */
export function problemasDeEntrada(entrada: EntradaCatalogo): string[] {
  const base = EntradaBaseSchema.safeParse({ ...entrada });
  const dato = ESQUEMAS_DATO[entrada.clase].safeParse(entrada.dato);
  return [...(base.success ? [] : base.error.issues), ...(dato.success ? [] : dato.error.issues)]
    .map((i) => `${entrada.id}: ${i.path.join(".") || "(raíz)"} ${i.message}`);
}
