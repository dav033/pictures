import { CREATIVIDAD_POR_DEFECTO, type NivelCreatividad } from "@/lib/ia/escena/creatividad";
import type { Imagen, PeticionImagen } from "@/lib/ia/nucleo/tipos";
import type { Brief, Producto } from "@/lib/types";
import { normalizeGenerationSources } from "./provenance";

/**
 * El cuerpo de POST /api/generate, UNO solo para las dos vistas.
 *
 * La guiada (/asistente) llamaba al mismo /api/generate que la clásica (/) pero con un cuerpo pobre: plan, brief,
 * solicitud y la foto, nada más. Sin el `blueprint` de la lectura de la foto el servidor no tenía de dónde sacar la
 * escenografía de la foto (mesa, fondo, flores: `sceneryFromReference`), las cajas de cada pieza en la guía de escena
 * (`guiaEscenaParaGeneracion`) ni el encuadre de la foto (`aspectoDeLaReferencia`), y FLUX recibía «dos columnas» sueltas
 * en un lienzo vacío: las juntaba en un arco (producción, 2026-10-06, conversación guiada-20261006-215048-bnrhtj). Este
 * módulo es el único que arma ese cuerpo: cada vista le da lo que sabe y las dos mandan los mismos campos con las mismas
 * reglas. Importable desde el cliente (sin «server-only»).
 *
 * Compatibilidad: solo campos que /api/generate ya acepta (su tipo `Body`); nada de esto llega tal cual a Python.
 */

/** Lo mínimo del plan aprobado que necesita el cuerpo: lo cumplen el `PlanResuelto` de la clásica y el plan de la tarjeta guiada. */
export type PlanParaGenerar = {
  plan_hash: string;
  compras: ReadonlyArray<{ variant_id: string; paquetes?: unknown }>;
};

export type EntradaCuerpoGeneracion<P extends PlanParaGenerar, B> = {
  /** La propuesta aprobada (con su `approval_token`). Sin ella el servidor responde APROBACION_REQUERIDA. */
  plan?: P;
  /** Ids de catálogo legado. Con un plan aprobado la clásica manda `[]` y la guiada no tiene otros. */
  productIds?: readonly string[];
  /** Variantes del RAG. Con un plan aprobado son las de sus compras (`fuentesDelPlan`). */
  ragVariantIds?: readonly string[];
  productQuantities?: Readonly<Record<string, number>>;
  manualProducts?: readonly Producto[];
  /** El brief de la conversación de cada vista (ver `cuerpoGeneracion`). */
  brief?: Brief;
  solicitudUsuario?: string;
  /** Ajuste escrito por el cliente sobre la imagen. Se manda tal cual: el servidor decide si hay imagen previa que ajustar. */
  instruccion?: string;
  /** El nivel del selector de la clásica; sin selector (la guiada), el de por defecto de la clásica. */
  creatividad?: NivelCreatividad;
  fotoEspacio?: { base64: string; mime: string } | null;
  imagenesReferencia?: readonly Imagen[];
  /** La lectura de la foto (`ReferenceBlueprintV2`) de la que salió el plan. */
  blueprint?: B;
  /** Lienzo pedido. Sin foto del espacio ninguna vista lo fija: el servidor lo saca de `blueprint`. */
  aspecto?: PeticionImagen["aspecto"];
  /** Ids de escenografía que el cliente apagó (solo la clásica tiene ese interruptor). */
  escenografiaApagada?: readonly string[];
  /** Última imagen generada, base de un ajuste. */
  imagenPrevia?: Imagen | null;
};

export type CuerpoGeneracion<P extends PlanParaGenerar, B> = {
  productIds: string[];
  ragVariantIds?: string[];
  plan?: P;
  planHash?: string;
  manualProducts?: Producto[];
  productQuantities: Record<string, number>;
  brief?: Brief;
  solicitudUsuario?: string;
  instruccion?: string;
  creatividad: NivelCreatividad;
  fotoEspacio?: { base64: string; mime: string };
  imagenesReferencia?: Imagen[];
  blueprint?: B;
  aspecto?: PeticionImagen["aspecto"];
  escenografia?: Array<{ element_id: string; visible: false }>;
  previousGeneratedImage?: Imagen;
  revisionInstruction?: string;
};

/** Paquetes de cada variante comprada del plan: lo mismo que el servidor usa para esas variantes al generar. */
export function cantidadesDelPlan(plan: PlanParaGenerar | undefined): Record<string, number> {
  if (!plan) return {};
  return Object.fromEntries(plan.compras.flatMap((compra) => (
    typeof compra.paquetes === "number" && Number.isFinite(compra.paquetes) && compra.paquetes > 0 ? [[compra.variant_id, compra.paquetes] as const] : []
  )));
}

/** Las fuentes de producto de una propuesta aprobada: lo que manda la clásica al aprobar (`aprobarPlan`). */
export function fuentesDelPlan(plan: PlanParaGenerar): { productIds: string[]; ragVariantIds: string[] } {
  return { productIds: [], ragVariantIds: [...new Set(plan.compras.map((compra) => compra.variant_id))] };
}

/**
 * Arma el cuerpo de /api/generate. Mismas reglas para las dos vistas:
 * - productos: ids legado y variantes normalizados (`normalizeGenerationSources`); las piezas «manual-» viajan solo en
 *   `manualProducts`. Con un plan, sus paquetes ganan en `productQuantities` (el servidor ya usa los del plan para esas
 *   variantes; el resto de cantidades que traiga la clásica se conserva tal cual).
 * - creatividad: la que se pida o `CREATIVIDAD_POR_DEFECTO` (la de la clásica). El nivel firmado en el plan manda en el servidor.
 * - foto: `imagenesReferencia` y su `blueprint`; `aspecto` solo si la vista lo fija (foto del espacio).
 * - ajuste: `previousGeneratedImage` solo con ajuste e imagen previa; `revisionInstruction` solo con imagen previa.
 *
 * Diferencias que quedan entre vistas, a propósito: `brief` y `solicitudUsuario` son los de la conversación de cada una
 * (la escena prefiere `original_request` del plan firmado, así que la solicitud casi nunca decide nada; en las dos son
 * las palabras del cliente: la guiada las arma con `entradaImagenGuiada`, contexto-cliente.ts), y la guiada no
 * tiene foto del espacio, selector de creatividad, interruptor de escenografía ni ajustes sobre la imagen.
 */
export function cuerpoGeneracion<P extends PlanParaGenerar, B>(entrada: EntradaCuerpoGeneracion<P, B>): CuerpoGeneracion<P, B> {
  const fuentes = normalizeGenerationSources(entrada.productIds ?? [], entrada.ragVariantIds ?? []);
  const instruccion = entrada.instruccion || undefined;
  const previa = entrada.imagenPrevia ?? undefined;
  const referencias = entrada.imagenesReferencia ?? [];
  const manuales = entrada.manualProducts ?? [];
  const apagadas = entrada.escenografiaApagada ?? [];
  return {
    productIds: fuentes.productIds.filter((id) => !id.startsWith("manual-")),
    ragVariantIds: fuentes.ragVariantIds.length ? fuentes.ragVariantIds : undefined,
    plan: entrada.plan,
    planHash: entrada.plan?.plan_hash,
    manualProducts: manuales.length ? [...manuales] : undefined,
    productQuantities: { ...(entrada.productQuantities ?? {}), ...cantidadesDelPlan(entrada.plan) },
    brief: entrada.brief,
    solicitudUsuario: entrada.solicitudUsuario,
    instruccion,
    creatividad: entrada.creatividad ?? CREATIVIDAD_POR_DEFECTO,
    fotoEspacio: entrada.fotoEspacio ? { base64: entrada.fotoEspacio.base64, mime: entrada.fotoEspacio.mime } : undefined,
    imagenesReferencia: referencias.length ? [...referencias] : undefined,
    blueprint: entrada.blueprint,
    aspecto: entrada.aspecto,
    escenografia: apagadas.length ? apagadas.map((elementId) => ({ element_id: elementId, visible: false as const })) : undefined,
    previousGeneratedImage: instruccion && previa ? previa : undefined,
    // Sin imagen previa no hay nada que ajustar: el servidor también lo ignora.
    revisionInstruction: previa ? instruccion : undefined,
  };
}

// ── Resumen para los registros ──────────────────────────────────────────────────────────────────────────────────

export type ResumenImagen = { mime: string | null; kb: number };

/** Lo que el registro guarda del cuerpo: qué campos vinieron y su forma, sin base64 ni el plan entero. */
export type ResumenCuerpoGeneracion = {
  campos: string[];
  planHash: string | null;
  estructurasPlan: number | null;
  /** Estructuras del plan que materializan un elemento de la foto (`referencia_element_id`). */
  estructurasConReferencia: number;
  productIds: number;
  ragVariantIds: number;
  productQuantities: number;
  manualProducts: number;
  creatividad: unknown;
  brief: unknown;
  solicitudUsuario: number;
  instruccion: boolean;
  fotoEspacio: ResumenImagen | null;
  imagenesReferencia: ResumenImagen[];
  blueprint: { elementos: number; estructurasDeGlobos: number; aspectoFoto: number | null } | null;
  aspecto: unknown;
  escenografiaApagada: number;
  imagenPrevia: boolean;
  revisionInstruction: boolean;
};

function registro(valor: unknown): Record<string, unknown> | null {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor) ? valor as Record<string, unknown> : null;
}

function lista(valor: unknown): unknown[] {
  return Array.isArray(valor) ? valor : [];
}

function resumenImagen(valor: unknown): ResumenImagen | null {
  const imagen = registro(valor);
  if (!imagen) return null;
  const base64 = typeof imagen.base64 === "string" ? imagen.base64 : "";
  return { mime: typeof imagen.mime === "string" ? imagen.mime : null, kb: Math.round((base64.length * 3) / 4 / 1024) };
}

export function resumenCuerpoGeneracion(cuerpo: Readonly<Record<string, unknown>>): ResumenCuerpoGeneracion {
  const plan = registro(cuerpo.plan);
  const estructuras = lista(registro(plan?.plan)?.estructuras).map(registro);
  const blueprint = registro(cuerpo.blueprint);
  const elementos = lista(blueprint?.elements).map(registro);
  const aspectoFoto = registro(lista(blueprint?.source_images)[0])?.aspect_ratio;
  const solicitud = cuerpo.solicitudUsuario;
  return {
    campos: Object.keys(cuerpo).filter((clave) => cuerpo[clave] !== undefined).sort(),
    planHash: typeof plan?.plan_hash === "string" ? plan.plan_hash : null,
    estructurasPlan: plan ? estructuras.length : null,
    estructurasConReferencia: estructuras.filter((estructura) => typeof estructura?.referencia_element_id === "string").length,
    productIds: lista(cuerpo.productIds).length,
    ragVariantIds: lista(cuerpo.ragVariantIds).length,
    productQuantities: Object.keys(registro(cuerpo.productQuantities) ?? {}).length,
    manualProducts: lista(cuerpo.manualProducts).length,
    creatividad: cuerpo.creatividad ?? null,
    brief: cuerpo.brief ?? null,
    solicitudUsuario: typeof solicitud === "string" ? solicitud.length : 0,
    instruccion: typeof cuerpo.instruccion === "string" && cuerpo.instruccion.trim().length > 0,
    fotoEspacio: resumenImagen(cuerpo.fotoEspacio),
    imagenesReferencia: lista(cuerpo.imagenesReferencia).map(resumenImagen).filter((imagen): imagen is ResumenImagen => imagen !== null),
    blueprint: blueprint
      ? {
          elementos: elementos.length,
          estructurasDeGlobos: elementos.filter((elemento) => elemento?.category === "balloon_structure").length,
          aspectoFoto: typeof aspectoFoto === "number" ? aspectoFoto : null,
        }
      : null,
    aspecto: cuerpo.aspecto ?? null,
    escenografiaApagada: lista(cuerpo.escenografia).length,
    imagenPrevia: cuerpo.previousGeneratedImage !== undefined,
    revisionInstruction: typeof cuerpo.revisionInstruction === "string" && cuerpo.revisionInstruction.trim().length > 0,
  };
}
