import type { EstructuraPlan, PlanDecoracion } from "./tipos";

export type EstadoComercialPlan = "VERIFICADO" | "APROBACION_REQUERIDA" | "PRESUPUESTO_EXCEDIDO";

export type LineaMaterial = {
  estructura_id: string;
  product_id: string;
  variant_id: string;
  sku: string | null;
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
  tipo: EstructuraPlan["tipo"];
  ubicacion: EstructuraPlan["ubicacion"];
  repeticiones: number;
  eje_m: number | null;
  total_unidades: number;
  lineas: LineaMaterial[];
  mezcla_real: Array<{ diam_pulg: number; forma: string | null; unidades: number; pct: number }>;
  supuestos: string[];
};

export type CompraConsolidada = {
  variant_id: string;
  product_id: string;
  sku: string | null;
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
  estructuras: string[];
  /** La imagen puede faltar en planes guardados antes de que se mostrara en el desglose. */
  imagen?: string | null;
};

export type PlanResuelto = {
  plan: PlanDecoracion;
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
