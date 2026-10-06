import { clasificarColores, type PALETA_COLORES_V2 } from "@/lib/rag/taxonomy/v2";

type ColorCatalogo = (typeof PALETA_COLORES_V2)[number];

const COLOR_CLIENTE: Readonly<Record<string, { nombre: string; color: ColorCatalogo }>> = {
  rosewood: { nombre: "Palo de rosa", color: "rosado" },
  "palo de rosa": { nombre: "Palo de rosa", color: "rosado" },
  durazno: { nombre: "Durazno", color: "naranja" },
};

/** Convierte nota de biblioteca en nombre para cliente; no participa en costeo. */
export function presentacionMaterialGuiado(nota: string | undefined): { nombre: string; color?: ColorCatalogo } {
  const referencia = nota?.match(/\bR-(\d+)\s+([^,;.]+)/i);
  if (!referencia) return { nombre: "Globo de látex" };
  const nombreOriginal = referencia[2]!.trim();
  const conocido = COLOR_CLIENTE[nombreOriginal.toLocaleLowerCase("es")];
  const clasificado = clasificarColores(nombreOriginal);
  const color = conocido?.color ?? (clasificado.status === "known" ? clasificado.values[0] : undefined);
  const nombreColor = conocido?.nombre ?? nombreOriginal;
  return {
    nombre: `Globo de látex ${referencia[1]}\" ${nombreColor}`,
    ...(color ? { color } : {}),
  };
}
