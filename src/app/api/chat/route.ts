import { chatDe, resolverProveedor } from "@/lib/ia/registro";
import { ErrorIA } from "@/lib/ia/tipos";
import type { Imagen, Mensaje } from "@/lib/ia/tipos";
import { ejecutarConversacionStream } from "@/lib/ia/ejecutar";
import { limitarHistorialChat } from "@/lib/ia/historial-chat";
import { construirSistema } from "@/lib/ia/prompt-sistema";
import { ReferenceBlueprintV2Schema, type ReferenceBlueprintV2 } from "@/lib/ia/reference-blueprint";
import { RAG_ENABLED, RAG_FRANJAS_ENABLED } from "@/lib/rag/flags";
import { PLAN_DECORACION_ENABLED } from "@/lib/plan/flags";
import type { Brief, ChatMessage } from "@/lib/types";
import { LoraModeSlugSchema } from "@/lib/lora/schema";
import { resolveLoraModeDatasetAllowlist } from "@/lib/lora/mode-resolver";

type Body = {
  messages: ChatMessage[];
  brief: Brief;
  /** Override de proveedor para esta petición — A/B en vivo desde la UI. */
  proveedor?: string;
  /** Foto real del espacio/venue adjunta al mensaje que se acaba de mandar. */
  fotoEspacio?: Imagen;
  /** Imágenes de inspiración de estilo adjuntas al mensaje que se acaba de mandar. */
  imagenesReferencia?: Imagen[];
  /** Blueprint ya analizado (panel de referencias) de las imágenes de este
   * turno — plan de integración de referencias visuales, R2. Solo se usa
   * como contexto de composición para el modelo; el emparejamiento con
   * catálogo real sigue siendo exclusivo de buscar_catalogo_rag (R3). */
  referenceBlueprint?: unknown;
  /** Modo LoRA activo; habilita el allowlist de productos de su dataset. */
  loraMode?: unknown;
};

const LIMITE_ESPERA_EVENTO_MS = 75_000;

/** Evita que una llamada al proveedor sin respuesta deje un stream abierto para siempre. */
function conLimiteDeEspera<T>(promesa: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const temporizador = setTimeout(
      () => reject(new ErrorIA("timeout", "gemini", "El asistente tardó demasiado en responder. Intenta nuevamente.", true)),
      LIMITE_ESPERA_EVENTO_MS,
    );
    promesa.then(resolve, reject).finally(() => clearTimeout(temporizador));
  });
}

function statusDe(causa: ErrorIA["causa"]): number {
  switch (causa) {
    case "sin_llave":
      return 503;
    case "cuota":
      return 429;
    case "filtrado":
      return 422;
    case "timeout":
      return 504;
    default:
      return 502;
  }
}

function datosDeError(error: unknown): { error: string; causa?: string; proveedor?: string } {
  if (error instanceof ErrorIA) {
    return { error: error.message, causa: error.causa, proveedor: error.proveedor };
  }
  const detalle = error instanceof Error ? error.message : "Error desconocido";
  if (/ECONNREFUSED|DATABASE_URL|postgres/i.test(detalle)) {
    return {
      error: "No se pudo conectar al catálogo RAG (PostgreSQL). Verifica DATABASE_URL y que el contenedor de base de datos esté activo.",
      causa: "base_datos",
    };
  }
  return { error: `Falló la llamada al proveedor de IA: ${detalle}` };
}

function formatoSSE(evento: string, datos: unknown): string {
  return `event: ${evento}\ndata: ${JSON.stringify(datos)}\n\n`;
}

export async function POST(request: Request) {
  const { messages, brief, proveedor, fotoEspacio, imagenesReferencia, referenceBlueprint: rawReferenceBlueprint, loraMode: rawLoraMode }: Body = await request.json();
  const cookieProveedor = request.headers
    .get("cookie")
    ?.match(/ia_proveedor=(gemini)/)?.[1];

  let chat;
  let historial: Mensaje[];
  let sistema: string;
  let referenceBlueprint: ReferenceBlueprintV2 | undefined;
  let catalogAllowlist: Awaited<ReturnType<typeof resolveLoraModeDatasetAllowlist>> = null;

  try {
    const id = resolverProveedor({ override: proveedor, cookie: cookieProveedor });
    chat = await chatDe(id);

    // Solo se pasa al modelo con el plan de decoración activo — sin él, el
    // chat sigue el camino legado y este bloque solo agregaría tokens sin
    // que ninguna herramienta sepa qué hacer con los element_id.
    referenceBlueprint = PLAN_DECORACION_ENABLED && rawReferenceBlueprint
      ? ReferenceBlueprintV2Schema.parse(rawReferenceBlueprint)
      : undefined;
    const loraMode = rawLoraMode == null ? null : LoraModeSlugSchema.parse(rawLoraMode);
    catalogAllowlist = RAG_ENABLED && loraMode ? await resolveLoraModeDatasetAllowlist(loraMode) : null;

    sistema = construirSistema({ ragEnabled: RAG_ENABLED, franjasEnabled: RAG_FRANJAS_ENABLED, brief, referenceBlueprint, catalogAllowlist: catalogAllowlist ?? undefined });

    // Las imágenes solo se adjuntan al último mensaje (el que se acaba de
    // mandar en este turno) — `historial` se reconstruye desde texto plano
    // en cada request, así que no hay imágenes de turnos anteriores que
    // reinyectar; el cliente las re-manda mientras sigan adjuntas.
    const imagenesActuales: Imagen[] = [
      ...(fotoEspacio
        ? [
            {
              ...fotoEspacio,
              id: "ESPACIO_BASE",
              descripcion: "Foto real del espacio del cliente.",
            },
          ]
        : []),
      ...(imagenesReferencia ?? []).map((imagen, indice) => ({
        ...imagen,
        id: `ESTILO_${String(indice + 1).padStart(2, "0")}`,
        descripcion: "Referencia visual de decoración del cliente.",
      })),
    ];
    // The brief carries durable event facts; old prose only adds input tokens
    // and makes each tool-calling turn slower as the chat grows.
    const mensajes = limitarHistorialChat(messages ?? []);
    historial = mensajes.map((m, i) => {
      if (m.role === "assistant") return { rol: "asistente" as const, texto: m.content };
      const esUltimo = i === mensajes.length - 1;
      return {
        rol: "usuario" as const,
        texto: m.content,
        imagenes: esUltimo && imagenesActuales.length ? imagenesActuales : undefined,
      };
    });
  } catch (error) {
    return Response.json(datosDeError(error), { status: statusDe(error instanceof ErrorIA ? error.causa : "desconocido") });
  }

  // La respuesta SSE se abre antes de esperar al proveedor. Esperar el primer
  // fragmento aquí bloqueaba los headers y permitía que el timeout absoluto
  // del navegador venciera durante un turno válido con varias herramientas.
  const generador = ejecutarConversacionStream({ chat, sistema, historial, brief: brief ?? {}, referenceBlueprint, catalogAllowlist: catalogAllowlist ?? undefined });
  const iterador = generador[Symbol.asyncIterator]();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const enviar = (evento: string, datos: unknown) => controller.enqueue(encoder.encode(formatoSSE(evento, datos)));

      try {
        while (true) {
          const actual = await conLimiteDeEspera(iterador.next());
          if (actual.done) break;
          const evento = actual.value;
          if (evento.tipo === "texto") {
            enviar("texto", { delta: evento.delta });
          } else if (evento.tipo === "herramienta") {
            enviar("herramienta", { nombre: evento.nombre, estado: evento.estado });
          } else {
            const r = evento.resultado;
            enviar("fin", {
              reply: r.texto,
              brief: r.brief,
              recomendaciones: r.recomendaciones,
              decoraciones: r.decoraciones,
              categorias: r.categorias,
              filtrosCategorias: r.filtrosCategorias,
              medidas: r.medidas,
              cotizacion: r.cotizacion,
              proveedor: r.proveedor,
              modelo: r.modelo,
              seleccionIA: r.seleccionFinalIA,
              instruccionIA: r.instruccionIA,
              ragCandidatos: r.ragCandidatos,
              ragValidados: r.ragValidados,
              ragRechazados: r.ragRechazados,
              ragTotal: r.ragTotal,
              plan: r.plan,
              referenceBlueprint: r.referenceBlueprint,
            });
          }
        }
      } catch (error) {
        enviar("error", datosDeError(error));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
