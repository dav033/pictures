import { consultaDeFiltros, type FiltrosPanel } from "./filtros";

const POR_PETICION = "50";

/**
 * Baja el feedback completo (con escenas y pasos) en NDJSON siguiendo `x-siguiente-cursor`: el servidor entrega 50 filas por
 * petición para no pasar los límites de la función, y aquí, en el navegador, se juntan en un solo archivo.
 */
export async function exportarCompleto(filtros: FiltrosPanel, alAvanzar: (filas: number) => void): Promise<void> {
  const partes: BlobPart[] = [];
  let cursor: string | null = "0";
  let filas = 0;
  while (cursor !== null) {
    const respuesta: Response = await fetch(`/api/feedback-ia/admin?${consultaDeFiltros(filtros, { completo: "1", limite: POR_PETICION, cursor })}`);
    if (!respuesta.ok) throw new Error("No se pudo exportar el feedback.");
    const texto = await respuesta.text();
    partes.push(texto);
    filas += texto.split("\n").filter(Boolean).length;
    alAvanzar(filas);
    cursor = respuesta.headers.get("x-siguiente-cursor");
  }
  const enlace = document.createElement("a");
  enlace.href = URL.createObjectURL(new Blob(partes, { type: "application/x-ndjson" }));
  enlace.download = `feedback-ia-${new Date().toISOString().slice(0, 10)}.ndjson`;
  enlace.click();
  URL.revokeObjectURL(enlace.href);
}
