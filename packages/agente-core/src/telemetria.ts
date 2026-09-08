import type { ProveedorId } from "./tipos";

export const FLUJOS_IA = [
  "armador_decoracion", "generador_imagen", "analisis_referencia", "happie_paquetes",
  "happie_conversacion", "entrenamiento_lora", "indexacion_catalogo", "evaluacion",
] as const;
export type FlujoIA = (typeof FLUJOS_IA)[number];

export const ETIQUETAS_FLUJO_IA: Readonly<Record<FlujoIA, string>> = {
  armador_decoracion: "Armador de decoraciones",
  generador_imagen: "Generador de imagen",
  analisis_referencia: "Análisis de referencias",
  happie_paquetes: "Happie — recomendador",
  happie_conversacion: "Happie — conversación",
  entrenamiento_lora: "Entrenamiento LoRA",
  indexacion_catalogo: "Indexación de catálogo",
  evaluacion: "Evaluaciones",
};

export const CAPACIDADES_IA = [
  "chat_turno", "parser_intencion", "embedding_consulta", "embedding_documento",
  "qa_visual", "imagen_generacion", "imagen_generacion_correctiva",
  "analisis_referencia_inventario", "analisis_referencia_auditoria",
  "happie_recomendacion", "happie_conversacion", "rerank_candidatos",
] as const;
export type CapacidadIA = (typeof CAPACIDADES_IA)[number];
export type Operacion = "chat" | "imagen";
export type ResultadoLlamadaIA = "ok" | "error" | "timeout" | "cancelado";
export type PrecioModeloIA =
  | {
      tipoUnidad: "millon_tokens";
      precioEntrada: number;
      precioSalida: number;
      precioCacheado: number;
      moneda: string;
    }
  | {
      tipoUnidad: "generacion" | "segundo" | "corrida";
      precioUnidad: number;
      moneda: string;
    };

/** Metadatos acotados de una llamada. No admite prompts, mensajes, imágenes ni base64. */
export type EventoLlamadaIA = {
  cuando?: string;
  flujo: FlujoIA;
  capacidad: CapacidadIA;
  proveedor: ProveedorId;
  modelo: string;
  requestId?: string;
  correlationId?: string;
  superficie?: string;
  vuelta?: number;
  herramienta?: string;
  thinkingLevel?: string;
  promptVersion?: string;
  tokensEntrada?: number;
  tokensSalida?: number;
  tokensPensamiento?: number;
  tokensCacheados?: number;
  tokensPromptHerramientas?: number;
  bytesImagenEntrada?: number;
  intento?: number;
  proveedorRequestId?: string;
  unidadesFacturadas?: number;
  ms: number;
  resultado: ResultadoLlamadaIA;
  pricingId?: number;
  costeEstimado?: number;
  moneda?: string;
  /** Compatibilidad del buffer caliente. Nunca se escribe en almacenamiento durable. */
  error?: string;
  /** Compatibilidad de vista antigua; vistas nuevas usan capacidad. */
  operacion?: Operacion;
};

export type EventoTelemetria = EventoLlamadaIA & { cuando: string };
export interface PersistenciaTelemetria { guardar(evento: EventoTelemetria): Promise<void> }
export type EjecutorSql = (sql: string, parametros: readonly unknown[]) => Promise<unknown>;

const LIMITE = 50;
const flujos = new Set<string>(FLUJOS_IA);
const capacidades = new Set<string>(CAPACIDADES_IA);
const pendientes = new Set<Promise<void>>();
let persistencia: PersistenciaTelemetria | undefined;

declare global { var __telemetriaAgenteCore: EventoTelemetria[] | undefined }

function buffer(): EventoTelemetria[] {
  if (!globalThis.__telemetriaAgenteCore) globalThis.__telemetriaAgenteCore = [];
  return globalThis.__telemetriaAgenteCore;
}

function numeroValido(valor: number | undefined): number | null {
  return valor !== undefined && Number.isFinite(valor) ? valor : null;
}

/** Calcula estimado local. toolUsePromptTokenCount es desglose del prompt y no se suma otra vez. */
export function calcularCosteEstimado(
  evento: Pick<EventoLlamadaIA, "tokensEntrada" | "tokensSalida" | "tokensPensamiento" | "tokensCacheados" | "tokensPromptHerramientas" | "unidadesFacturadas">,
  precio: PrecioModeloIA,
): number {
  if (precio.tipoUnidad !== "millon_tokens") {
    return (evento.unidadesFacturadas ?? 0) * precio.precioUnidad;
  }
  const entradaNoCacheada = Math.max(0, (evento.tokensEntrada ?? 0) - (evento.tokensCacheados ?? 0));
  const salidaFacturada = (evento.tokensSalida ?? 0) + (evento.tokensPensamiento ?? 0);
  return (
    entradaNoCacheada * precio.precioEntrada
    + salidaFacturada * precio.precioSalida
    + (evento.tokensCacheados ?? 0) * precio.precioCacheado
  ) / 1_000_000;
}

export function crearPersistenciaPostgres(ejecutar: EjecutorSql): PersistenciaTelemetria {
  return {
    async guardar(evento): Promise<void> {
      await ejecutar(
        `INSERT INTO ai_call_log (
          created_at, flujo, capacidad, request_id, correlation_id, proveedor,
          modelo, superficie, vuelta, herramienta, thinking_level, prompt_version,
          tokens_entrada, tokens_salida, tokens_pensamiento, tokens_cacheados,
          tokens_prompt_herramientas, bytes_imagen_entrada, intento,
          proveedor_request_id, unidades_facturadas, ms, resultado, pricing_id, coste_estimado, moneda
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
          $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26
        )`,
        [evento.cuando, evento.flujo, evento.capacidad, evento.requestId ?? null,
          evento.correlationId ?? null, evento.proveedor, evento.modelo,
          evento.superficie ?? null, numeroValido(evento.vuelta), evento.herramienta ?? null,
          evento.thinkingLevel ?? null, evento.promptVersion ?? null,
          numeroValido(evento.tokensEntrada), numeroValido(evento.tokensSalida),
          numeroValido(evento.tokensPensamiento), numeroValido(evento.tokensCacheados),
          numeroValido(evento.tokensPromptHerramientas), numeroValido(evento.bytesImagenEntrada),
          numeroValido(evento.intento), evento.proveedorRequestId ?? null,
          numeroValido(evento.unidadesFacturadas), evento.ms,
          evento.resultado, evento.pricingId ?? null, numeroValido(evento.costeEstimado),
          evento.moneda ?? null],
      );
    },
  };
}

export function configurarPersistenciaTelemetria(nueva: PersistenciaTelemetria | undefined): void {
  persistencia = nueva;
}

/** Guarda primero en buffer. Persistencia durable corre fuera de ruta crítica y nunca lanza. */
export function registrarLlamadaIA(evento: EventoLlamadaIA): void {
  if (!flujos.has(evento.flujo) || !capacidades.has(evento.capacidad)) {
    if (process.env.NODE_ENV !== "production") {
      throw new Error(`Taxonomía IA inválida: ${evento.flujo}/${evento.capacidad}`);
    }
    return;
  }
  const completo: EventoTelemetria = { ...evento, cuando: evento.cuando ?? new Date().toISOString() };
  const lista = buffer();
  lista.unshift(completo);
  lista.length = Math.min(lista.length, LIMITE);
  if (!persistencia) return;

  let tarea: Promise<void>;
  try {
    tarea = Promise.resolve(persistencia.guardar(completo)).catch(() => undefined);
  } catch {
    return;
  }
  pendientes.add(tarea);
  void tarea.finally(() => pendientes.delete(tarea));
}

/** Alias compatible con consumidores existentes. */
export const registrarEvento = registrarLlamadaIA;

export function ultimosEventos(): EventoTelemetria[] { return [...buffer()] }

/** Útil para cierre ordenado y pruebas; fallos ya fueron aislados. */
export async function esperarPersistenciaTelemetria(): Promise<void> {
  await Promise.all([...pendientes]);
}
