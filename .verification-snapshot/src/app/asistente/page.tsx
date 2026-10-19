import type { Viewport } from "next";
import { VistaGuiada } from "@/components/guiado/VistaGuiada";
import { resolverVersionCodigo } from "@/lib/registro/version";

/** Sin esto, env(safe-area-inset-*) vale 0 y el teclado del celular tapa el compositor. */
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", interactiveWidget: "resizes-content" };

export default function PaginaAsistenteGuiado() {
  // Con qué código se sirvió la página: si un turno lo responde otro despliegue, la vista pide recargar (version-pagina.ts).
  // `resolverVersionCodigo` y no `versionCodigo`: la de caché lee Date.now(), que con cacheComponents no se puede usar al
  // prerenderizar la página (Next lo marca como ruta bloqueante y rompe la construcción).
  return <VistaGuiada versionPagina={resolverVersionCodigo().corta} />;
}
