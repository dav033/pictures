import type { Viewport } from "next";
import { VistaGuiada } from "@/components/guiado/VistaGuiada";

/** Sin esto, env(safe-area-inset-*) vale 0 y el teclado del celular tapa el compositor. */
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", interactiveWidget: "resizes-content" };

export default function PaginaAsistenteGuiado() {
  return <VistaGuiada />;
}
