import { chatDe, resolverProveedor } from "@/lib/ia/registro";
import { ErrorIA } from "@/lib/ia/tipos";
import type { Imagen, Mensaje } from "@/lib/ia/tipos";
import { ejecutarConversacion, ejecutarConversacionStream } from "@/lib/ia/ejecutar";
import type { EventoConversacion } from "@/lib/ia/ejecutar";
import { construirSistema } from "@/lib/ia/prompt-sistema";
import { RAG_ENABLED, RAG_FRANJAS_ENABLED } from "@/lib/rag/flags";
import type { Brief, ChatMessage } from "@/lib/types";

type Body = {
  messages: ChatMessage[];
  brief: Brief;
  /** Override de proveedor para esta petición — A/B en vivo desde la UI. */
  proveedor?: string;
  /** Foto real del espacio/venue adjunta al mensaje que se acaba de mandar. */
  fotoEspacio?: Imagen;
  /** Imágenes de inspiración de estilo adjuntas al mensaje que se acaba de mandar. */
  imagenesReferencia?: Imagen[];
};

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
  return { error: `Falló la llamada al proveedor de IA: ${detalle}` };
}

function formatoSSE(evento: string, datos: unknown): string {
  return `event: ${evento}\ndata: ${JSON.stringify(datos)}\n\n`;
}

export async function POST(request: Request) {
  const { messages, brief, proveedor, fotoEspacio, imagenesReferencia }: Body = await request.json();
  const cookieProveedor = request.headers
    .get("cookie")
    ?.match(/ia_proveedor=(gemini)/)?.[1];

  let chat;
  let historial: Mensaje[];
  let sistema: string;

  try {
    const id = resolverProveedor({ override: proveedor, cookie: cookieProveedor });
    chat = await chatDe(id);

    sistema = construirSistema({ ragEnabled: RAG_ENABLED, franjasEnabled: RAG_FRANJAS_ENABLED, brief });

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
    const mensajes = messages ?? [];
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

  // Se intenta abrir el stream primero. Si el proveedor falla ANTES de mandar
  // el primer fragmento (llave inválida, red caída), todavía no se mandó
  // ningún byte de la respuesta: se puede caer al camino JSON de toda la vida
  // sin que el cliente note la diferencia (§5.4 del plan — fallback no-stream).
  const generador = ejecutarConversacionStream({ chat, sistema, historial, brief: brief ?? {} });
  const iterador = generador[Symbol.asyncIterator]();
  let primero: IteratorResult<EventoConversacion>;
  try {
    primero = await iterador.next();
  } catch {
    try {
      const resultado = await ejecutarConversacion({ chat, sistema, historial, brief: brief ?? {} });
      return Response.json({
        reply: resultado.texto,
        brief: resultado.brief,
        recomendaciones: resultado.recomendaciones,
        decoraciones: resultado.decoraciones,
        categorias: resultado.categorias,
        filtrosCategorias: resultado.filtrosCategorias,
        medidas: resultado.medidas,
        cotizacion: resultado.cotizacion,
        proveedor: resultado.proveedor,
        modelo: resultado.modelo,
        seleccionIA: resultado.seleccionFinalIA,
        instruccionIA: resultado.instruccionIA,
        ragCandidatos: resultado.ragCandidatos,
        ragValidados: resultado.ragValidados,
        ragRechazados: resultado.ragRechazados,
        ragTotal: resultado.ragTotal,
      });
    } catch (error) {
      return Response.json(datosDeError(error), {
        status: statusDe(error instanceof ErrorIA ? error.causa : "desconocido"),
      });
    }
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const enviar = (evento: string, datos: unknown) => controller.enqueue(encoder.encode(formatoSSE(evento, datos)));

      try {
        let actual: IteratorResult<EventoConversacion> = primero;
        while (!actual.done) {
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
            });
          }
          actual = await iterador.next();
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
