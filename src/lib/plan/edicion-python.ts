import "server-only";
import {
  isPythonAdapterError,
  llamarPythonCatalogRecommendations,
  llamarPythonCatalogSelection,
  llamarPythonPlanArmadoBouquet,
  llamarPythonPlanEdit,
  llamarPythonPlanPatron,
  type PythonPlanArmadoGlobo,
  type PythonPlanEditLineaBase,
  type PythonPlanPatronLinea,
} from "@/lib/ia/nucleo/python-adapter";
import type { ArmadoBouquetResuelto, ArmadoBouquetV1, DisposicionNumero, VarianteBouquet } from "./armado-bouquet";
import type { ProductoCandidato } from "@/lib/rag/chat/buscar";
import { candidatoDesdePython } from "@/lib/rag/chat/candidato-python";
import type { CatalogAllowlist } from "@/lib/rag/retrieval/types";
import { errorAllowlistDesdePython } from "./allowlist-producto-variante";
import type { ContextoPlan } from "./aprobacion";
import { coloresRealesProducto } from "./colores-producto";
import { MENSAJE_UNICO_MATERIAL } from "./edicion-compatibilidad";
import { PlanEditError, type CausaEdicionPlan, type RechazoPatron } from "./edicion-error";
import type { EdicionPlan } from "./edicion-esquemas";
import type { ModoAdmitido, ModoPatronColor, PatronColor, PatronColorResuelto } from "./patron-color";
import { ordenarRecomendacionesPorColor } from "./recomendaciones-orden";
import { PlanBackendNoDisponibleError } from "./resolver-backend";
import type { PlanDecoracion } from "./tipos";

/** Deadline for the short catalog checks the editor makes while the customer waits. */
export const EDICION_PYTHON_DEADLINE_MS = 5_000;
/** Python may return up to this many variants; Next only orders and bounds them. */
export const RECOMENDACIONES_LIMITE_PYTHON = 100;
/** Display bound, same as the legacy editor. */
export const RECOMENDACIONES_MAX_PRODUCTOS = 12;

const MENSAJE_REFERENCIA_NO_ENCONTRADA = "No se encontró la variante para recomendar alternativas.";

/**
 * Un plan solo se puede editar contra el snapshot firmado con el que se
 * resolvió. `PYTHON_NO_SELECCIONADO` desapareció con el kill switch (ADR-0023
 * paso 5): ya no hay otro backend al que no poder volver.
 */
export function exigirContextoPython(contexto: ContextoPlan): string {
  if (!contexto.catalogSnapshotId) {
    throw new PlanBackendNoDisponibleError("SIN_SNAPSHOT_CATALOGO", "La propuesta aprobada no tiene un snapshot de catálogo disponible; vuelve a pedir la propuesta.");
  }
  return contexto.catalogSnapshotId;
}

/**
 * Admits the customer's explicit editor pick into the same-turn allowlist only
 * after Python validates the exact pair in the signed snapshot. The selection
 * allowlist is intentionally that single pair: the editor choice is not a model
 * pick, and the pair is checked again when the edited plan is resolved.
 *
 * Returns the admitted variant's real colors (Python already answers with the
 * variant's own colors, or the product's when it has exactly one), so the edit
 * can label the material with what it actually buys.
 */
export async function admitirVariantePython(input: {
  variante: { product_id: string; variant_id: string };
  catalogSnapshotId: string;
  whitelist: Map<string, Set<string>>;
  correlationId: string;
  signal?: AbortSignal;
}): Promise<string[]> {
  const { variante } = input;
  let seleccion: Awaited<ReturnType<typeof llamarPythonCatalogSelection>>;
  try {
    seleccion = await llamarPythonCatalogSelection({
      items: [{ product_id: variante.product_id, variant_id: variante.variant_id, quantity: 1 }],
      allowlist: [{ product_id: variante.product_id, variant_ids: [variante.variant_id] }],
      catalogSnapshotId: input.catalogSnapshotId,
      requestId: crypto.randomUUID(),
      correlationId: input.correlationId,
      deadlineMs: EDICION_PYTHON_DEADLINE_MS,
      ...(input.signal ? { parentSignal: input.signal } : {}),
    });
  } catch (error) {
    throw errorAllowlistDesdePython(error) ?? error;
  }
  const admitida = seleccion.validados.length === 1
    && seleccion.validados[0]!.product_id === variante.product_id
    && seleccion.validados[0]!.variant_id === variante.variant_id;
  if (!admitida) {
    throw new PlanEditError(409, "La variante elegida no está disponible en el catálogo de esta propuesta.", "VARIANTE_NO_ADMITIDA");
  }
  const variantes = input.whitelist.get(variante.product_id) ?? new Set<string>();
  variantes.add(variante.variant_id);
  input.whitelist.set(variante.product_id, variantes);
  const validado = seleccion.validados[0]!;
  return coloresRealesProducto(validado.product_title, validado.colors);
}

/**
 * Recommendations for a Python plan. The reference must belong to the signed
 * allowlist (checked here, from signed data only, before any network call);
 * Python decides which catalog rows are recommendable; Next only orders them by
 * color and bounds the list for display.
 */
export async function recomendarAlternativasPython(input: {
  contexto: ContextoPlan;
  variantId: string;
  catalogAllowlist: CatalogAllowlist | null;
  correlationId: string;
  signal?: AbortSignal;
}): Promise<ProductoCandidato[]> {
  const catalogSnapshotId = exigirContextoPython(input.contexto);
  if (!input.contexto.allowlist.some((entrada) => entrada.variant_ids.includes(input.variantId))) {
    throw new PlanEditError(404, MENSAJE_REFERENCIA_NO_ENCONTRADA, "VARIANTE_REFERENCIA_NO_ENCONTRADA");
  }
  // A LoRA mode without variants authorizes nothing; never send it as "unrestricted".
  if (input.catalogAllowlist && input.catalogAllowlist.variantIds.length === 0) return [];

  let resultado: Awaited<ReturnType<typeof llamarPythonCatalogRecommendations>>;
  try {
    resultado = await llamarPythonCatalogRecommendations({
      referenceVariantId: input.variantId,
      catalogSnapshotId,
      ...(input.catalogAllowlist ? { loraVariantIds: input.catalogAllowlist.variantIds } : {}),
      limit: RECOMENDACIONES_LIMITE_PYTHON,
      requestId: crypto.randomUUID(),
      correlationId: input.correlationId,
      deadlineMs: EDICION_PYTHON_DEADLINE_MS,
      ...(input.signal ? { parentSignal: input.signal } : {}),
    });
  } catch (error) {
    if (isPythonAdapterError(error) && error.domainCode === "reference_variant_not_found") {
      throw new PlanEditError(404, MENSAJE_REFERENCIA_NO_ENCONTRADA, "VARIANTE_REFERENCIA_NO_ENCONTRADA");
    }
    if (isPythonAdapterError(error) && error.domainCode === "catalog_snapshot_not_found") {
      throw new PlanBackendNoDisponibleError("SIN_SNAPSHOT_CATALOGO", "El snapshot de catálogo de esta propuesta ya no está publicado; vuelve a pedir la propuesta.");
    }
    throw error;
  }
  const ordenados = ordenarRecomendacionesPorColor(
    resultado.candidates.map(candidatoDesdePython),
    { productId: resultado.reference.product_id, colores: resultado.reference.colors },
  );
  return ordenados.slice(0, RECOMENDACIONES_MAX_PRODUCTOS);
}

export const MENSAJE_PATRON_ACTIVO = "Esta pieza usa un patrón de color: cambia sus colores desde el patrón.";
/** Only when Python rejects a pattern without its own sentence (an older service). */
const MENSAJE_PATRON_INVALIDO = "Ese patrón de color no se puede armar en esta pieza.";

type Rechazo = { status: number; mensaje: string; causa?: CausaEdicionPlan };

/**
 * Domain rejections of POST /internal/v1/plan/edit (ADR-0028 §9), with the
 * same status and customer-facing sentence the TypeScript edit used before it
 * moved to Python. `invalid_plan` is what used to fail as a Zod error on the
 * edited plan (a seventh color, say).
 */
const RECHAZOS_EDICION: Readonly<Record<string, Rechazo>> = {
  estructura_no_encontrada: { status: 404, mensaje: "No se encontró la estructura seleccionada." },
  variante_objetivo_no_encontrada: { status: 404, mensaje: "No se encontró la variante objetivo en la estructura." },
  reparto_no_corresponde: { status: 409, mensaje: "La distribución no corresponde a los colores actuales de la pieza. Vuelve a abrirla e inténtalo otra vez." },
  material_no_editable: { status: 409, mensaje: "La variante visible no corresponde a un material editable." },
  unico_material: { status: 400, mensaje: MENSAJE_UNICO_MATERIAL, causa: "UNICO_MATERIAL" },
  sin_participacion: { status: 400, mensaje: "La estructura quedó sin participación de materiales." },
  patron_activo: { status: 409, mensaje: MENSAJE_PATRON_ACTIVO, causa: "PATRON_ACTIVO" },
  invalid_plan: { status: 400, mensaje: "La edición del plan no tiene un formato válido." },
};

/** Rejections of POST /internal/v1/plan/patron (ADR-0028 §10). */
const RECHAZOS_VISTA_PATRON: Readonly<Record<string, Rechazo>> = {
  estructura_no_encontrada: RECHAZOS_EDICION.estructura_no_encontrada!,
  invalid_plan: { status: 422, mensaje: "El patrón de color no tiene un formato válido." },
  // Slider preview (`participaciones`): same answers the edit gives for them.
  reparto_no_corresponde: RECHAZOS_EDICION.reparto_no_corresponde!,
  patron_activo: RECHAZOS_EDICION.patron_activo!,
  sin_patron: { status: 409, mensaje: "Esta pieza no tiene un patrón de color que dibujar." },
};

/** Rejections of POST /internal/v1/plan/armado-bouquet (ADR-0030). */
const RECHAZOS_VISTA_ARMADO: Readonly<Record<string, Rechazo>> = {
  estructura_no_encontrada: RECHAZOS_EDICION.estructura_no_encontrada!,
  invalid_plan: { status: 422, mensaje: "El armado del bouquet no tiene un formato válido." },
};

/** Only when Python rejects an assembly without its own sentence (an older service). */
const MENSAJE_ARMADO_INVALIDO = "Ese armado no se puede hacer con los globos de este bouquet.";

/** Rejections that only the preview gives (the colors slider's `repartir`). */
export const CODIGOS_VISTA_PATRON_SIN_DIBUJO = ["sin_patron", "patron_activo", "reparto_no_corresponde"] as const;
export type CodigoVistaPatronSinDibujo = (typeof CODIGOS_VISTA_PATRON_SIN_DIBUJO)[number];

function esCodigoSinDibujo(codigo: string): codigo is CodigoVistaPatronSinDibujo {
  return (CODIGOS_VISTA_PATRON_SIN_DIBUJO as readonly string[]).includes(codigo);
}

/**
 * The preview has nothing to draw for this request: the piece has no pattern
 * (`sin_patron`), its pattern is not a confeti (`patron_activo`) or the
 * slider's colors are not the piece's (`reparto_no_corresponde`). The editor
 * turns its live preview off quietly; the proposal did not change and nothing
 * was saved, so it is not "the proposal is out of date" (ADR-0028 §10, §13).
 * Same status and sentence as the edit's answer; `codigo` is Python's.
 */
export class VistaPatronSinDibujoError extends PlanEditError {
  readonly codigo: CodigoVistaPatronSinDibujo;

  constructor(rechazo: PlanEditError, codigo: CodigoVistaPatronSinDibujo) {
    super(rechazo.status, rechazo.message, rechazo.causa);
    this.name = "VistaPatronSinDibujoError";
    this.codigo = codigo;
  }
}

/**
 * `patron_invalido` of the pattern preview: besides the rule and the sentence,
 * the styles Python admits for the structure (ADR-0028 §10), so the editor
 * still offers them when no pattern could be suggested. `null` when the
 * rejection did not carry them (the edit never does).
 */
export class RechazoVistaPatronError extends PlanEditError {
  readonly modosAdmitidos: ModoAdmitido[] | null;

  constructor(message: string, patron: RechazoPatron | undefined, modosAdmitidos: ModoAdmitido[] | null) {
    super(422, message, "PATRON_INVALIDO", patron);
    this.modosAdmitidos = modosAdmitidos;
  }
}

/**
 * A known domain rejection as `PlanEditError`; anything else (transport,
 * authentication, an unknown code) is not a business answer and is left to
 * the caller. `patron_invalido` keeps Python's `motivo` and `mensaje`: the
 * decorator reads which color or rule broke the pattern.
 */
function rechazoDesdePython(error: unknown, rechazos: Readonly<Record<string, Rechazo>>): PlanEditError | null {
  if (!isPythonAdapterError(error) || !error.domainCode) return null;
  if (error.domainCode === "patron_invalido") {
    const { motivo, mensaje } = error.domainDetails ?? {};
    return new PlanEditError(422, mensaje ?? MENSAJE_PATRON_INVALIDO, "PATRON_INVALIDO", motivo && mensaje ? { motivo, mensaje } : undefined);
  }
  if (error.domainCode === "armado_invalido") {
    const { motivo, mensaje } = error.domainDetails ?? {};
    return new PlanEditError(422, mensaje ?? MENSAJE_ARMADO_INVALIDO, "ARMADO_INVALIDO", motivo && mensaje ? { motivo, mensaje } : undefined);
  }
  const rechazo = rechazos[error.domainCode];
  return rechazo ? new PlanEditError(rechazo.status, rechazo.mensaje, rechazo.causa) : null;
}

/** The options the bouquet editor may offer, as Python decides them from the purchase. */
export type OpcionesArmado = { variantes_admitidas: VarianteBouquet[]; disposiciones_admitidas: DisposicionNumero[] };

/**
 * `armado_invalido` of the assembly preview: besides the rule and the
 * sentence, the styles and number placements Python admits for the bouquet
 * (ADR-0030), so the editor still offers them when no recipe fits. `null`
 * when the rejection did not carry them (the edit never does).
 */
export class RechazoVistaArmadoError extends PlanEditError {
  readonly opciones: OpcionesArmado | null;

  constructor(message: string, armado: RechazoPatron | undefined, opciones: OpcionesArmado | null) {
    super(422, message, "ARMADO_INVALIDO", armado);
    this.opciones = opciones;
  }
}

/**
 * Applies one edit to the declarative plan in Python (the only owner of the
 * mutation). `lineasBase` are the lines of the base plan Next has just
 * re-resolved and verified, never the ones the browser echoed.
 */
export async function editarPlanPython(input: {
  plan: PlanDecoracion;
  lineasBase: ReadonlyArray<{ estructura_id: string; lineas: readonly PythonPlanEditLineaBase[] }>;
  edicion: EdicionPlan;
  coloresVariante: readonly string[];
  completarPatrones: boolean;
  /** `BOUQUETS_ARMADO_V1`: the caller will ask the re-resolution to suggest the removed assembly again. */
  completarArmados?: boolean;
  correlationId: string;
  signal?: AbortSignal;
}): Promise<{ plan: PlanDecoracion; avisos: string[] }> {
  try {
    const resultado = await llamarPythonPlanEdit({
      plan: input.plan,
      lineasBase: input.lineasBase,
      edicion: input.edicion,
      coloresVariante: input.coloresVariante,
      completarPatrones: input.completarPatrones,
      ...(input.completarArmados === undefined ? {} : { completarArmados: input.completarArmados }),
      requestId: crypto.randomUUID(),
      correlationId: input.correlationId,
      deadlineMs: EDICION_PYTHON_DEADLINE_MS,
      ...(input.signal ? { parentSignal: input.signal } : {}),
    });
    return { plan: resultado.plan, avisos: resultado.avisos };
  } catch (error) {
    throw rechazoDesdePython(error, RECHAZOS_EDICION) ?? error;
  }
}

/**
 * Pattern preview for the editor: the pattern Python expands (or suggests,
 * with `null`) and counts, with the same grid the next resolution quotes.
 */
export async function vistaPreviaPatronPython(input: {
  plan: PlanDecoracion;
  estructuraId: string;
  patronColor: PatronColor | null;
  /** Colors slider over a confeti, while dragging (see `llamarPythonPlanPatron`). */
  participaciones?: readonly number[];
  /** With `patronColor` null: the starting point of that style instead of the preset. */
  modo?: ModoPatronColor;
  /** With `modo`: the editor's draft; Python keeps from it what the new style admits. */
  desde?: PatronColor;
  /** The structure's resolved lines: Python names each color by what is bought (a hint, never a count). */
  lineas?: readonly PythonPlanPatronLinea[];
  correlationId: string;
  signal?: AbortSignal;
}): Promise<{ patron: PatronColorResuelto; modos_admitidos: ModoAdmitido[] }> {
  try {
    const resultado = await llamarPythonPlanPatron({
      plan: input.plan,
      estructuraId: input.estructuraId,
      patronColor: input.patronColor,
      ...(input.participaciones === undefined ? {} : { participaciones: input.participaciones }),
      ...(input.modo === undefined ? {} : { modo: input.modo }),
      ...(input.desde === undefined ? {} : { desde: input.desde }),
      ...(input.lineas === undefined ? {} : { lineas: input.lineas }),
      requestId: crypto.randomUUID(),
      correlationId: input.correlationId,
      deadlineMs: EDICION_PYTHON_DEADLINE_MS,
      ...(input.signal ? { parentSignal: input.signal } : {}),
    });
    return { patron: resultado.patron, modos_admitidos: resultado.modos_admitidos };
  } catch (error) {
    const rechazo = rechazoDesdePython(error, RECHAZOS_VISTA_PATRON);
    if (rechazo?.causa === "PATRON_INVALIDO" && isPythonAdapterError(error)) {
      throw new RechazoVistaPatronError(rechazo.message, rechazo.patron, error.domainDetails?.modosAdmitidos ?? null);
    }
    if (rechazo && isPythonAdapterError(error) && error.domainCode && esCodigoSinDibujo(error.domainCode)) {
      throw new VistaPatronSinDibujoError(rechazo, error.domainCode);
    }
    throw rechazo ?? error;
  }
}

/**
 * Assembly preview for the bouquet editor (ADR-0030): the assembly Python
 * resolves (or suggests, with `null`) with the same legend, supplies and
 * prompts the next resolution quotes. `globos` are the bouquet's resolved
 * lines as the browser holds them; they classify, never count.
 */
export async function vistaPreviaArmadoPython(input: {
  plan: PlanDecoracion;
  estructuraId: string;
  armadoBouquet: ArmadoBouquetV1 | null;
  globos: readonly PythonPlanArmadoGlobo[];
  variante?: VarianteBouquet;
  disposicion?: DisposicionNumero;
  correlationId: string;
  signal?: AbortSignal;
}): Promise<{ armado: ArmadoBouquetResuelto } & OpcionesArmado> {
  try {
    const resultado = await llamarPythonPlanArmadoBouquet({
      plan: input.plan,
      estructuraId: input.estructuraId,
      armadoBouquet: input.armadoBouquet,
      globos: input.globos,
      ...(input.variante === undefined ? {} : { variante: input.variante }),
      ...(input.disposicion === undefined ? {} : { disposicion: input.disposicion }),
      requestId: crypto.randomUUID(),
      correlationId: input.correlationId,
      deadlineMs: EDICION_PYTHON_DEADLINE_MS,
      ...(input.signal ? { parentSignal: input.signal } : {}),
    });
    return { armado: resultado.armado, variantes_admitidas: resultado.variantes_admitidas, disposiciones_admitidas: resultado.disposiciones_admitidas };
  } catch (error) {
    const rechazo = rechazoDesdePython(error, RECHAZOS_VISTA_ARMADO);
    if (rechazo?.causa === "ARMADO_INVALIDO" && isPythonAdapterError(error)) {
      const { variantesAdmitidas, disposicionesAdmitidas } = error.domainDetails ?? {};
      const opciones = variantesAdmitidas && disposicionesAdmitidas
        ? { variantes_admitidas: variantesAdmitidas, disposiciones_admitidas: disposicionesAdmitidas }
        : null;
      throw new RechazoVistaArmadoError(rechazo.message, rechazo.patron, opciones);
    }
    throw rechazo ?? error;
  }
}
