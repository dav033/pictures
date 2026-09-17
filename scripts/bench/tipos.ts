/**
 * Contrato del benchmark de fidelidad. Lo consume el generador de informe
 * (`scripts/bench/informe.ts`) y lo produce el arnés (`scripts/bench-fidelidad.ts`).
 *
 * Una corrida por fase del plan. El informe compara corridas entre sí, así que
 * los campos NO pueden cambiar de significado entre fases: si una fase necesita
 * medir algo nuevo, se añade un campo opcional en vez de redefinir uno existente.
 */

/** Identificador de la fase del plan que produjo la corrida. */
export type FaseBenchmark = "fase-0-linea-base" | "fase-1" | "fase-2" | "fase-3" | "fase-4" | "fase-4b" | "fase-5";

export type MetaCorrida = {
  fase: FaseBenchmark;
  /** ISO 8601. */
  fecha: string;
  commit: string;
  /** Semilla del PRNG que eligió las referencias: fija la selección entre fases. */
  semillaSeleccion: number;
  espacio: { nombre: string; ancho: number; alto: number };
  slotLora: { slug: string; artifactId: string; trigger: string; evaluationStatus: string; escala: number };
  modelos: { lora: string; imagen: string; chat: string };
  parametros: { pasos: number; guidance: number; ancho: number; alto: number };
  /**
   * Banderas efectivas de la corrida, leídas con `featureEnabled` (no del env
   * crudo, que no dice cuál es el default). Sin esto una corrida no es
   * atribuible: las fases 0 a 3 quedaron sin registro de qué estaba encendido,
   * así que una diferencia entre dos corridas no se puede achacar al código en
   * vez de a una variable de entorno olvidada.
   */
  banderas?: Readonly<Record<string, boolean>>;
  /** Semilla fija de la corrida (`LORA_EVAL_SEED`), o `null` si se sorteó cada imagen. */
  semillaImagen?: number | null;
  /** Gasto real medido contra el saldo del proveedor. `null` si no se pudo medir. */
  gastoUsd: number | null;
};

export type PistaColor = {
  elementos: number;
  /** Etiquetas crudas del analizador, sin plegar. */
  coloresCrudos: string[];
  /** Paleta plegada al vocabulario del catálogo (`coloresFotoCliente`). */
  paletaCatalogo: string[];
  /** Colores que llegan a la búsqueda de catálogo (`coloresFotoParaBusqueda`). */
  paletaBusqueda: string[];
  /** Observados que no sobreviven al plegado ni al filtro de catálogo. */
  perdidos: string[];
  /**
   * Colores de la paleta que NINGÚN concepto de `PRODUCT_VOCABULARY` puede
   * dibujar (F12). No es configuración: es el resultado que decide si la foto
   * puede representarse siquiera.
   */
  sinConcepto: string[];
  /** Colores de la paleta que sí llegan a la escena. */
  renderizables: string[];
  /**
   * Participación medida sobre los píxeles (fase 2.1), ponderada por el área de
   * la caja de cada elemento. Ausente en las corridas anteriores a la fase 2 y
   * vacía cuando la bandera estaba apagada: las tres situaciones son distintas y
   * el informe las distingue.
   */
  participaciones?: Array<{ color: string; share: number }>;
};

export type PistaCaption = {
  texto: string;
  longitud: number;
  /** Techo efectivo del compilador en modo híbrido. */
  techo: number;
  /** Tallas que el compilador descartó por no estar en `allowed_codes`. */
  tallasOmitidas: string[];
  diagnosticos: string[];
};

export type PistaPreflight = { ok: boolean; errores: string[] };

export type PistaImagen = {
  /** Ruta relativa al directorio de la corrida. `null` si la etapa falló. */
  etapa1: string | null;
  final: string | null;
  fallo: string | null;
};

export type PistaQa = { pass: boolean | null; retryReasons: string[] };

/** Rúbrica del juez. Ordena dentro de UNA llamada; nunca es métrica absoluta. */
export type PistaJuez = {
  fotorrealismo: number;
  fidelidadColor: number;
  fidelidadEspacio: number;
  usable: number;
  peorDefecto: string;
};

/**
 * Colocación consciente del espacio (fase 6.A). `null` cuando la corrida no la
 * ejercitó, que es el estado de las fases anteriores.
 */
export type PistaColocacion = {
  usada: boolean;
  aperturas: number;
  paredesPlanas: number;
  obstaculos: number;
  anclasMetricas: number;
  /** Cajas que el colocador asignó, por estructura. Vacío si no colocó nada. */
  cajas: Record<string, { x: number; y: number; width: number; height: number }>;
  fallo: string | null;
};

export type CasoBenchmark = {
  referencia: string;
  titulo: string;
  fixturePlan: string;
  semillaImagen: number;
  color: PistaColor;
  caption: PistaCaption | null;
  preflight: PistaPreflight | null;
  imagen: PistaImagen;
  qa: PistaQa | null;
  juez: PistaJuez | null;
  colocacion: PistaColocacion | null;
};

export type Corrida = { meta: MetaCorrida; casos: CasoBenchmark[] };
