import { registrarLlamadaIA, type FlujoIA } from "./telemetria";
import { ErrorIA, type ChatPort, type Herramienta, type LlamadaHerramienta, type Mensaje, type ProveedorId } from "./tipos";

/** Un handler recibe los args ya parseados de la llamada y la llamada cruda
 * completa (por si necesita el `id`/`meta` — la mayoría no los usa, pero es
 * gratis tenerlos disponibles). Devuelve lo que se le manda de vuelta al
 * modelo como resultado de la función. */
export type ManejadorHerramienta = (
  args: Record<string, unknown>,
  llamada: LlamadaHerramienta,
  signal?: AbortSignal,
) => Promise<Record<string, unknown>>;

/** Nombre de herramienta → handler. Reemplaza el if-chain que tendría que
 * vivir aquí si el motor conociera las herramientas de un dominio concreto. */
export type RegistroHerramientas = Record<string, ManejadorHerramienta>;

export type ResultadoConversacion = {
  texto: string;
  historial: Mensaje[];
  proveedor: ProveedorId;
  modelo: string;
  /** true si se agotaron las vueltas sin que el modelo terminara con texto
   * (sin más llamadas a herramientas) — el consumidor decide qué decir en
   * ese caso vía `alAgotarVueltas`, esto solo lo deja registrado. */
  agotado: boolean;
};

export type OpcionesConversacion = {
  chat: ChatPort;
  sistema: string;
  historial: Mensaje[];
  /** Ya resuelto por el consumidor — el motor no decide qué herramientas
   * ofrecer, solo las declara al proveedor y despacha lo que llegue. */
  herramientas: Herramienta[];
  /** Nombre → handler. Cualquier llamada a una herramienta sin handler
   * registrado devuelve un error de "herramienta desconocida" al modelo en
   * vez de lanzar — igual que el comportamiento de siempre. */
  registro: RegistroHerramientas;
  /** Tope de vueltas de tool-calling antes de cortar la conversación. */
  vueltasMax?: number;
  /** Observabilidad pura: se llama justo antes de ejecutar cada herramienta,
   * con su nombre y args ya parseados. No cambia el flujo. */
  onLlamada?: (nombre: string, args: Record<string, unknown>) => void;
  /** Texto a devolver si se agotan las vueltas sin que el modelo termine.
   * Default: un mensaje genérico en español; el consumidor normalmente
   * quiere algo consciente de SU propio estado (ver demo-decoracion). */
  alAgotarVueltas?: (historial: Mensaje[]) => string;
  /** Señal de desconexión/cancelación del consumidor. */
  signal?: AbortSignal;
  /** Atribución de producto obligatoria para cada llamada del loop. */
  telemetria: {
    flujo: FlujoIA;
    requestId?: string;
    correlationId?: string;
    superficie?: string;
    herramienta?: string;
    thinkingLevel?: string;
    promptVersion?: string;
  };
};

const VUELTAS_MAX_DEFECTO = 10;
const textoAlAgotarVueltasDefecto = () => "Se agotaron los intentos sin llegar a una respuesta final.";

function asegurarNoCancelado(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new Error("CLIENT_CANCELLED");
}

function resultadoDeFallo(error: unknown, signal: AbortSignal | undefined): "error" | "timeout" | "cancelado" {
  if (signal?.aborted || (error instanceof Error && error.message === "CLIENT_CANCELLED")) return "cancelado";
  return error instanceof ErrorIA && error.causa === "timeout" ? "timeout" : "error";
}

function bytesImagenes(historial: Mensaje[]): number {
  let total = 0;
  for (const mensaje of historial) {
    if (mensaje.rol !== "usuario") continue;
    for (const imagen of mensaje.imagenes ?? []) {
      const limpio = imagen.base64.replace(/\s/g, "");
      const relleno = limpio.endsWith("==") ? 2 : limpio.endsWith("=") ? 1 : 0;
      total += Math.max(0, Math.floor((limpio.length * 3) / 4) - relleno);
    }
  }
  return total;
}

async function ejecutarHerramienta(
  registro: RegistroHerramientas,
  llamada: LlamadaHerramienta,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const manejador = registro[llamada.nombre];
  if (!manejador) return { error: `herramienta desconocida: ${llamada.nombre}` };
  return manejador(llamada.args ?? {}, llamada, signal);
}

/**
 * Bucle de tool-calling agnóstico de proveedor Y de dominio: recibe un
 * `ChatPort` ya resuelto y un `registro` de herramientas, y conversa con el
 * modelo hasta que responda sin más llamadas a herramientas, o hasta agotar
 * `vueltasMax`.
 */
export async function ejecutarConversacion(opts: OpcionesConversacion): Promise<ResultadoConversacion> {
  const historial = [...opts.historial];
  const vueltasMax = opts.vueltasMax ?? VUELTAS_MAX_DEFECTO;
  const alAgotarVueltas = opts.alAgotarVueltas ?? textoAlAgotarVueltasDefecto;

  for (let vuelta = 0; vuelta < vueltasMax; vuelta++) {
    asegurarNoCancelado(opts.signal);
    const inicio = Date.now();
    let turno;
    try {
      turno = await opts.chat.turno({ sistema: opts.sistema, historial, herramientas: opts.herramientas, signal: opts.signal });
    } catch (error) {
      registrarLlamadaIA({
        ...opts.telemetria,
        flujo: opts.telemetria.flujo,
        capacidad: "chat_turno",
        proveedor: opts.chat.id,
        modelo: opts.chat.modelo,
        operacion: "chat",
        vuelta,
        bytesImagenEntrada: bytesImagenes(historial),
        ms: Date.now() - inicio,
        resultado: resultadoDeFallo(error, opts.signal),
        error: error instanceof Error ? error.message : "error desconocido",
      });
      throw error;
    }

    registrarLlamadaIA({
      ...opts.telemetria,
      flujo: opts.telemetria.flujo,
      capacidad: "chat_turno",
      proveedor: opts.chat.id,
      modelo: turno.modelo,
      operacion: "chat",
      vuelta,
      bytesImagenEntrada: bytesImagenes(historial),
      ms: Date.now() - inicio,
      tokensEntrada: turno.uso.entrada,
      tokensSalida: turno.uso.salida,
      tokensCacheados: turno.uso.cacheados,
      tokensPensamiento: turno.uso.pensamiento,
      tokensPromptHerramientas: turno.uso.promptHerramientas,
      resultado: "ok",
    });

    if (turno.llamadas.length === 0) {
      return { texto: turno.texto, historial, proveedor: opts.chat.id, modelo: turno.modelo, agotado: false };
    }

    const llamadas = turno.llamadas.map((l, i) => ({ ...l, id: l.id ?? `local_${vuelta}_${i}` }));
    historial.push({ rol: "asistente", llamadas });

    for (const llamada of llamadas) {
      asegurarNoCancelado(opts.signal);
      opts.onLlamada?.(llamada.nombre, llamada.args ?? {});
      const resultado = await ejecutarHerramienta(opts.registro, llamada, opts.signal);
      historial.push({ rol: "herramienta", nombre: llamada.nombre, llamadaId: llamada.id, resultado });
    }
  }

  return { texto: alAgotarVueltas(historial), historial, proveedor: opts.chat.id, modelo: opts.chat.modelo, agotado: true };
}

export type EventoConversacion =
  | { tipo: "texto"; delta: string }
  | { tipo: "herramienta"; nombre: string; estado: "ejecutando" | "lista" }
  | { tipo: "fin"; resultado: ResultadoConversacion };

/**
 * Misma máquina que `ejecutarConversacion`, pero como generador: emite el
 * texto de la respuesta final apenas llega (streaming real) y un evento por
 * herramienta mientras se ejecuta.
 */
export async function* ejecutarConversacionStream(opts: OpcionesConversacion): AsyncGenerator<EventoConversacion> {
  const historial = [...opts.historial];
  const vueltasMax = opts.vueltasMax ?? VUELTAS_MAX_DEFECTO;
  const alAgotarVueltas = opts.alAgotarVueltas ?? textoAlAgotarVueltasDefecto;

  for (let vuelta = 0; vuelta < vueltasMax; vuelta++) {
    asegurarNoCancelado(opts.signal);
    const inicio = Date.now();
    let texto = "";
    let llamadasCrudas: LlamadaHerramienta[] = [];
    let uso = { entrada: 0, salida: 0, cacheados: 0, pensamiento: 0, promptHerramientas: 0 };
    let modelo = opts.chat.modelo;

    try {
      for await (const fragmento of opts.chat.turnoStream({ sistema: opts.sistema, historial, herramientas: opts.herramientas, signal: opts.signal })) {
        asegurarNoCancelado(opts.signal);
        if (fragmento.tipo === "texto") {
          texto += fragmento.delta;
          yield { tipo: "texto", delta: fragmento.delta };
        } else {
          texto = fragmento.texto;
          llamadasCrudas = fragmento.llamadas;
          uso = {
            entrada: fragmento.uso.entrada,
            salida: fragmento.uso.salida,
            cacheados: fragmento.uso.cacheados ?? 0,
            pensamiento: fragmento.uso.pensamiento ?? 0,
            promptHerramientas: fragmento.uso.promptHerramientas ?? 0,
          };
          modelo = fragmento.modelo;
        }
      }
    } catch (error) {
      registrarLlamadaIA({
        ...opts.telemetria,
        flujo: opts.telemetria.flujo,
        capacidad: "chat_turno",
        proveedor: opts.chat.id,
        modelo: opts.chat.modelo,
        operacion: "chat",
        vuelta,
        bytesImagenEntrada: bytesImagenes(historial),
        ms: Date.now() - inicio,
        resultado: resultadoDeFallo(error, opts.signal),
        error: error instanceof Error ? error.message : "error desconocido",
      });
      throw error;
    }

    registrarLlamadaIA({
      ...opts.telemetria,
      flujo: opts.telemetria.flujo,
      capacidad: "chat_turno",
      proveedor: opts.chat.id,
      modelo,
      operacion: "chat",
      vuelta,
      bytesImagenEntrada: bytesImagenes(historial),
      ms: Date.now() - inicio,
      tokensEntrada: uso.entrada,
      tokensSalida: uso.salida,
      tokensCacheados: uso.cacheados,
      tokensPensamiento: uso.pensamiento,
      tokensPromptHerramientas: uso.promptHerramientas,
      resultado: "ok",
    });

    if (llamadasCrudas.length === 0) {
      yield { tipo: "fin", resultado: { texto, historial, proveedor: opts.chat.id, modelo, agotado: false } };
      return;
    }

    const llamadas = llamadasCrudas.map((l, i) => ({ ...l, id: l.id ?? `local_${vuelta}_${i}` }));
    historial.push({ rol: "asistente", llamadas });

    for (const llamada of llamadas) {
      asegurarNoCancelado(opts.signal);
      opts.onLlamada?.(llamada.nombre, llamada.args ?? {});
      yield { tipo: "herramienta", nombre: llamada.nombre, estado: "ejecutando" };
      const resultado = await ejecutarHerramienta(opts.registro, llamada, opts.signal);
      yield { tipo: "herramienta", nombre: llamada.nombre, estado: "lista" };
      historial.push({ rol: "herramienta", nombre: llamada.nombre, llamadaId: llamada.id, resultado });
    }
  }

  yield {
    tipo: "fin",
    resultado: { texto: alAgotarVueltas(historial), historial, proveedor: opts.chat.id, modelo: opts.chat.modelo, agotado: true },
  };
}
