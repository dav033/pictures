import type { Metadata, Viewport } from "next";
import { Taller3D } from "@/components/tres-d/Taller3D";
import { SharedQuoteFlagsProvider } from "@/components/shared-quotes/SharedQuoteFlags";

export const metadata: Metadata = { title: "Globos en 3D · Sempertex" };

/** Como en /asistente: sin esto, env(safe-area-inset-*) vale 0 y el teclado del celular tapa el chat de la IA. */
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", interactiveWidget: "resizes-content" };

export default function Pagina3D() {
  const readerEnabled = process.env.COTIZACION_COMPARTIDA_READER_ENABLED === "true";
  const writerEnabled = readerEnabled && process.env.COTIZACION_COMPARTIDA_WRITER_ENABLED === "true";
  return (
    <SharedQuoteFlagsProvider readerEnabled={readerEnabled} writerEnabled={writerEnabled}>
      <Taller3D />
    </SharedQuoteFlagsProvider>
  );
}
