export type ProveedorId = "gemini" | "fal";

/** Forma mínima de una imagen adjunta a un mensaje — solo lo que el motor
 * necesita para mandarla al modelo (base64 + mime type) y, si el consumidor
 * los da, un id semántico + descripción (el adaptador de Gemini los antepone
 * como texto "[IMAGEN_ID=...]" porque el modelo no ve EXIF/XMP de forma
 * fiable). Un consumidor con un tipo más rico (dimensiones, etc.) lo sigue
 * pasando sin problema: TypeScript acepta cualquier valor que además de esto
 * tenga más campos. */
export type ImagenAdjunta = { base64: string; mime: string; id?: string; descripcion?: string };

/** Bytes reales que representa un base64 (sin el padding `=`/`==`). Mismo
 * cálculo que antes vivía duplicado en el conteo de telemetría; centralizado
 * aquí porque tanto el motor (`ejecutar.ts`, para el caso de fallback/error)
 * como el adaptador de Gemini (para medir lo que de verdad se transmite tras
 * la Fase 3.1) lo necesitan. */
export function bytesDeBase64(base64: string): number {
  const limpio = base64.replace(/\s/g, "");
  const relleno = limpio.endsWith("==") ? 2 : limpio.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((limpio.length * 3) / 4) - relleno);
}

/* ---------- Transcript neutral ----------
   El historial no se guarda en el formato de ningún proveedor: cada adaptador
   lo traduce a su formato de cable en cada turno. Eso es lo que permite
   cambiar de proveedor a mitad de conversación sin perder el hilo. */
export type Mensaje =
  | { rol: "usuario"; texto: string; imagenes?: ImagenAdjunta[] }
  | { rol: "asistente"; texto: string }
  | { rol: "asistente"; llamadas: LlamadaHerramienta[] }
  | { rol: "herramienta"; nombre: string; llamadaId?: string; resultado: unknown };

export type LlamadaHerramienta = {
  /** Gemini a veces no lo manda. */
  id?: string;
  nombre: string;
  args: Record<string, unknown>;
  /**
   * Metadatos opacos específicos del proveedor que hay que reenviar tal cual
   * en el siguiente turno (ej. `thoughtSignature` de Gemini). Los adaptadores
   * de otros proveedores lo ignoran.
   */
  meta?: Record<string, unknown>;
};

/* ---------- Herramientas: JSON Schema puro, denominador común ---------- */
export type Herramienta = {
  nombre: string;
  descripcion: string;
  /** JSON Schema draft-07. */
  esquema: Record<string, unknown>;
};

/* ---------- Chat ---------- */
export type PeticionChat = {
  sistema: string;
  historial: Mensaje[];
  herramientas: Herramienta[];
  temperatura?: number;
  maxTokens?: number;
  /** Cancela la llamada local y la petición HTTP del proveedor cuando aplica. */
  signal?: AbortSignal;
};

export type TurnoChat = {
  texto: string;
  llamadas: LlamadaHerramienta[];
  /** `cacheados` viene de `cachedContentTokenCount` (caché implícito de
   * Gemini). Medido en 0 de forma consistente en el proyecto original; se
   * expone igual para que cualquier consumidor pueda instrumentarlo. */
  uso: {
    entrada: number;
    salida: number;
    cacheados?: number;
    pensamiento?: number;
    promptHerramientas?: number;
  };
  modelo: string;
  /** Bytes de imagen realmente transmitidos en ESTA llamada (Fase 3.1): un
   * adaptador que evita reenviar `inlineData` ya visto en una vuelta anterior
   * reporta aquí solo lo nuevo, no lo que hay en todo el historial. Si el
   * adaptador no lo implementa, el consumidor cae al conteo estructural del
   * historial completo (comportamiento anterior). */
  bytesImagenEnviados?: number;
};

/** Fragmentos de un turno en streaming: texto incremental y, al final, el turno completo ya armado. */
export type FragmentoChat = { tipo: "texto"; delta: string } | ({ tipo: "fin" } & TurnoChat);

export interface ChatPort {
  readonly id: ProveedorId;
  readonly modelo: string;
  turno(p: PeticionChat): Promise<TurnoChat>;
  turnoStream(p: PeticionChat): AsyncIterable<FragmentoChat>;
}

/* ---------- Errores tipados ----------
   Antes todo caía en un catch genérico que devolvía 502. Con esto el
   consumidor puede distinguir "falta llave" de "te pasaste de cuota" de "el
   contenido se filtró". */
export type CausaFallo = "sin_llave" | "cuota" | "filtrado" | "timeout" | "red" | "desconocido";

export class ErrorIA extends Error {
  constructor(
    readonly causa: CausaFallo,
    readonly proveedor: ProveedorId,
    mensaje: string,
    readonly reintentable: boolean,
  ) {
    super(mensaje);
    this.name = "ErrorIA";
  }
}
