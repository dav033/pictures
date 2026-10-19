/**
 * Arnés del navegador para `test-ui-calificacion-chat.ts`: la lista de mensajes del chat guiado como la arma `VistaGuiada`
 * (cada respuesta de la IA nace como burbuja vacía marcada como producida, se llena y recién entonces se deja calificar) con las
 * filas de calificación REALES de `CalificacionGuiada`. La conversación se guarda en `sessionStorage` para poder recargar la página.
 */
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { CalificacionGuiada, type MensajeGuiadoCalificable } from "../../../../src/components/guiado/CalificacionGuiada";
import { marcarProducido } from "../../../../src/components/feedback-ia/producidos";

type Mensaje = MensajeGuiadoCalificable;
type Widget = NonNullable<Mensaje["widgets"]>[number];

declare global {
  interface Window {
    /** Monta el chat (`estricto`: dentro de StrictMode, como `next dev`) y resuelve cuando ya acepta turnos. */
    __montarChat: (estricto: boolean) => Promise<void>;
    /** Un turno: el mensaje de la persona y la respuesta de la IA (burbuja vacía, texto, fin). */
    __turno: (pedido: string, respuesta: string, widgets?: Widget[]) => Promise<void>;
    /** Una respuesta de la IA que llega sin un mensaje nuevo de la persona (p. ej. «Recalcular mi plan»). */
    __respuestaSuelta: (respuesta: string, widgets?: Widget[]) => Promise<void>;
  }
}

const CLAVE = "arnes:mensajes";
const siguienteTick = () => new Promise<void>((resolver) => setTimeout(resolver, 0));

function restaurar(): Mensaje[] {
  try {
    return JSON.parse(sessionStorage.getItem(CLAVE) ?? "[]") as Mensaje[];
  } catch {
    return [];
  }
}

const nuevoId = (): string => `m${Array.from(crypto.getRandomValues(new Uint8Array(8)), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;

type Gestos = { turno: Window["__turno"]; suelta: Window["__respuestaSuelta"] };
let gestos: Gestos | null = null;
let avisarMontado: (() => void) | null = null;

function Chat() {
  const [mensajes, setMensajes] = useState<Mensaje[]>(restaurar);
  const [transmitiendoId, setTransmitiendoId] = useState<string | null>(null);

  useEffect(() => {
    sessionStorage.setItem(CLAVE, JSON.stringify(mensajes));
  }, [mensajes]);

  useEffect(() => {
    async function responder(previos: Mensaje[], respuesta: string, widgets?: Widget[]): Promise<void> {
      const id = nuevoId();
      marcarProducido(id);
      setMensajes((actuales) => [...actuales, ...previos, { id, role: "assistant", content: "" }]);
      setTransmitiendoId(id);
      await siguienteTick();
      setMensajes((actuales) => actuales.map((m) => (m.id === id ? { ...m, content: respuesta, ...(widgets ? { widgets } : {}) } : m)));
      await siguienteTick();
      setTransmitiendoId(null);
      await siguienteTick();
    }
    gestos = {
      turno: (pedido, respuesta, widgets) => responder([{ id: nuevoId(), role: "user", content: pedido }], respuesta, widgets),
      suelta: (respuesta, widgets) => responder([], respuesta, widgets),
    };
    avisarMontado?.();
    return () => { gestos = null; };
  }, []);

  return (
    <main>
      {mensajes.map((mensaje, indice) => (
        <div key={mensaje.id} data-mensaje={mensaje.id} data-rol={mensaje.role}>
          <p>{mensaje.content}</p>
          <CalificacionGuiada mensajes={mensajes} indice={indice} listo={transmitiendoId !== mensaje.id} />
        </div>
      ))}
    </main>
  );
}

window.__montarChat = (estricto) => new Promise<void>((resolver) => {
  avisarMontado = resolver;
  createRoot(document.getElementById("raiz") as HTMLElement).render(estricto ? <StrictMode><Chat /></StrictMode> : <Chat />);
});
window.__turno = (pedido, respuesta, widgets) => gestos!.turno(pedido, respuesta, widgets);
window.__respuestaSuelta = (respuesta, widgets) => gestos!.suelta(respuesta, widgets);
