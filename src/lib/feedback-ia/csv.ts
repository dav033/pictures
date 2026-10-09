import type { FilaListado } from "./repositorio";

const COLUMNAS: ReadonlyArray<readonly [string, (fila: FilaListado) => string | number | boolean | null]> = [
  ["id", (f) => f.id],
  ["fecha", (f) => f.creadoEn],
  ["producto", (f) => f.producto],
  ["turno", (f) => f.turnoId],
  ["calificacion", (f) => f.calificacion],
  ["motivos", (f) => f.motivos.join("; ")],
  ["deshecho", (f) => f.deshecho],
  ["comentario", (f) => f.comentario],
  ["pedido", (f) => f.pedido],
  ["modelo", (f) => f.modelo],
  ["coste_usd", (f) => f.costeUsd],
  ["latencia_ms", (f) => f.latenciaMs],
  ["herramientas", (f) => f.herramientas.join("; ")],
  ["captura_antes", (f) => f.tieneImagenAntes],
  ["captura_despues", (f) => f.tieneImagenDespues],
];

/** Una celda que empieza por =, +, - o @ se interpretaría como fórmula al abrir el CSV en una hoja de cálculo. */
function celda(valor: string | number | boolean | null): string {
  if (valor === null) return "";
  let texto = String(valor);
  if (/^[=+\-@\t\r]/.test(texto)) texto = `'${texto}`;
  return /[",\n\r]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

/** Encabezado con BOM, para que Excel respete los acentos. */
export const ENCABEZADO_CSV = `\uFEFF${COLUMNAS.map(([nombre]) => nombre).join(",")}\r\n`;

/** Filas del listado como líneas CSV (cada una termina en CRLF); el encabezado se manda una sola vez al principio. */
export function filasACsv(filas: readonly FilaListado[]): string {
  return filas.map((fila) => `${COLUMNAS.map(([, valor]) => celda(valor(fila))).join(",")}\r\n`).join("");
}
