import type { PlanDecoracion, PlanDecoracion1_1, PropCatalogo } from "./tipos";
import type { TipoEstructura, Ubicacion } from "./composicion";

export type EstadoComercialPlan = "VERIFICADO" | "APROBACION_REQUERIDA" | "PRESUPUESTO_EXCEDIDO";

/**
 * De dónde viene una línea comprada (PLAN-COMPOSICION-RICA-V001.md §6.8):
 * una estructura (globos, escultura) o un prop de catálogo independiente.
 * Ver `LineaMaterial.origen` / `CompraConsolidada.elementos_origen`.
 */
export type OrigenLineaPlan =
  | { kind: "estructura"; id: string }
  | { kind: "prop"; id: string };

export type LineaMaterial = {
  /**
   * Histórico: id de la estructura dueña de esta línea. Para una línea que
   * viene de un prop de catálogo (Plan 1.1), lleva el `prop_id` en su lugar
   * — nunca queda vacío — pero `origen` es la fuente de verdad tipada para
   * distinguir ambos casos; los consumidores nuevos deben leer `origen`.
   */
  estructura_id: string;
  origen: OrigenLineaPlan;
  product_id: string;
  variant_id: string;
  sku: string | null;
  sku_original?: string | null;
  source_snapshot_id?: string | null;
  source_variant_id?: string | null;
  inventory_quantity?: number | null;
  unidades_inferidas?: boolean | null;
  titulo: string;
  color: string | null;
  tamano_codigo: string | null;
  diam_pulg: number | null;
  diam_cm: number | null;
  forma: string | null;
  acabado: string | null;
  unidades: number;
  imagen?: string | null;
  sustitucion: { pedido: string; entregado: string; motivo: string } | null;
};

export type EstructuraResuelta = {
  estructura_id: string;
  nombre: string;
  /** Tipo canónico completo (composicion.ts): incluye `escultura` para Plan 1.1. */
  tipo: TipoEstructura;
  ubicacion: Ubicacion;
  repeticiones: number;
  eje_m: number | null;
  total_unidades: number;
  lineas: LineaMaterial[];
  mezcla_real: Array<{ diam_pulg: number; forma: string | null; unidades: number; pct: number }>;
  supuestos: string[];
};

/**
 * Un prop de catálogo resuelto (Plan 1.1, §6.7): un solo `product_id`/
 * `variant_id`, cantidad instalada exacta y una única línea de compra —
 * nunca un BOM de varios componentes como una escultura.
 */
export type PropResuelto = {
  prop_id: string;
  product_id: string;
  variant_id: string;
  rol_escena: PropCatalogo["rol_escena"];
  ubicacion: Ubicacion;
  unidades: number;
  linea: LineaMaterial;
  porque: string;
};

export type CompraConsolidada = {
  variant_id: string;
  product_id: string;
  sku: string | null;
  sku_original?: string | null;
  source_snapshot_id?: string | null;
  source_variant_id?: string | null;
  inventory_quantity?: number | null;
  unidades_inferidas?: boolean | null;
  titulo: string;
  tamano_codigo: string | null;
  diam_pulg: number | null;
  color: string | null;
  unidades_necesarias: number;
  /** Cantidad instalada en el diseño; alias explícito de unidades_necesarias. */
  design_quantity: number;
  /** Reserva estadística realmente cubierta por esta compra. */
  waste_reserve: number;
  /** Diseño + reserva cubierta; no fuerza otro paquete por sí sola. */
  required_quantity: number;
  unidades_con_merma: number;
  unidades_paquete: number;
  paquetes: number;
  purchase_quantity: number;
  used: number;
  leftover_inventory: number;
  consumption_cost: number;
  purchase_cost: number;
  additional_package_for_waste: boolean;
  sobrante: number;
  precio_paquete: number;
  subtotal: number;
  /**
   * Histórico: solo ids de estructura. Se mantiene sin cambios para no
   * romper consumidores existentes (`cotizarPlan` en
   * `src/lib/cotizacion/motor.ts`); una compra que solo viene de un prop deja
   * este arreglo vacío. `elementos_origen` es la fuente generalizada.
   */
  estructuras: string[];
  /** Todo lo que consolidó esta compra: estructuras y/o props (§6.8). */
  elementos_origen: OrigenLineaPlan[];
  /** La imagen puede faltar en planes guardados antes de que se mostrara en el desglose. */
  imagen?: string | null;
};

export type PlanResuelto = {
  plan: PlanDecoracion | PlanDecoracion1_1;
  /** Props de catálogo resueltos (Plan 1.1). Vacío para Plan 1.0. */
  props?: PropResuelto[];
  plan_hash: string;
  /** Open-event traceability kept alongside the resolved plan for UI/audit. */
  event_label?: string | null;
  original_request?: string;
  event_match_levels?: Array<"exact_event" | "thematic" | "adaptable">;
  event_relaxations?: string[];
  /** Issued only after the server validated the plan; never used as plan data. */
  approval_token?: string;
  request_id?: string;
  estructuras: EstructuraResuelta[];
  compras: CompraConsolidada[];
  totales: {
    globos_por_tamano: Record<string, number>;
    total_unidades: number;
    total_cop: number;
    design_quantity: number;
    target_waste_reserve: number;
    covered_waste_reserve: number;
    uncovered_waste_reserve: number;
    natural_package_surplus: number;
    purchase_cost: number;
    consumption_cost: number;
    waste_only_savings_cop: number;
    additional_waste_packages: number;
    /** Ahorro verificable por consolidar paquetes frente a comprar cada línea por separado. */
    ahorro_paquetes_cop: number;
    incluye_iva: boolean;
    merma_porcentaje: number;
  };
  comercial: {
    estado: EstadoComercialPlan;
    techo_cop?: number;
    delta_cop: number;
    procedencia?: "explicito" | "inferido" | "supuesto";
  };
  alternativas: Array<{
    familia_id: string;
    titulo: string;
    total_cop: number;
    ahorro_cop: number;
    etiqueta: "economica" | "equilibrada" | "premium";
  }>;
  merma_log: string;
  sustituciones: Array<{ estructura_id: string; pedido: string; entregado: string; motivo: string }>;
  sin_cobertura: Array<{ estructura_id: string; product_id: string; tamano: string }>;
  advertencias: string[];
};
