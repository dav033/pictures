import { z } from "zod";
import { ReferenceBlueprintV2Schema } from "@/lib/ia/referencia/reference-blueprint";

const RespuestaAnalisisSchema = z.object({ blueprint: ReferenceBlueprintV2Schema }).passthrough();

const COLORES: Readonly<Record<string, { nombre: string; hex: string }>> = {
  amarillo: { nombre: "Amarillo", hex: "#facc15" }, azul: { nombre: "Azul", hex: "#3b82f6" },
  blanco: { nombre: "Blanco", hex: "#ffffff" }, cafe: { nombre: "Café", hex: "#8b5e3c" },
  dorado: { nombre: "Dorado", hex: "#d4a72c" }, fucsia: { nombre: "Fucsia", hex: "#d946a3" },
  lila: { nombre: "Lila", hex: "#a78bfa" }, naranja: { nombre: "Naranja", hex: "#f97316" },
  negro: { nombre: "Negro", hex: "#252525" }, plata: { nombre: "Plata", hex: "#b9bec7" },
  rojo: { nombre: "Rojo", hex: "#ef4444" }, rosado: { nombre: "Rosa", hex: "#ec8fb5" },
  verde: { nombre: "Verde", hex: "#22a06b" }, violeta: { nombre: "Violeta", hex: "#8b5cf6" },
};

// El analizador nombra los colores en inglés o con nombres de catálogo: el widget los dice en palabras de cliente.
const SINONIMOS_COLOR: Readonly<Record<string, string>> = {
  yellow: "amarillo", blue: "azul", navy: "azul", celeste: "azul", white: "blanco", ivory: "blanco", cream: "blanco", crema: "blanco",
  brown: "cafe", gold: "dorado", golden: "dorado", oro: "dorado", fuchsia: "fucsia", magenta: "fucsia", lilac: "lila", lavender: "lila",
  purple: "violeta", morado: "violeta", violet: "violeta", orange: "naranja", coral: "naranja", black: "negro", silver: "plata",
  plateado: "plata", red: "rojo", pink: "rosado", rosa: "rosado", blush: "rosado", green: "verde", mint: "verde", sage: "verde",
};

const ARTICULO: Readonly<Record<string, string>> = { columna: "una", guirnalda: "una", "pared de globos": "una", "figura de globos": "una" };
const NUMEROS = ["", "", "dos", "tres", "cuatro", "cinco", "seis"];

const FORMAS: Readonly<Record<string, string>> = {
  arco: "arco", semiarco: "medio arco", columna: "columna", guirnalda: "guirnalda",
  pared: "pared de globos", bouquet: "ramo de globos", ramo: "ramo de globos",
  escultura: "figura de globos", centro_mesa: "centro de mesa", aro: "aro de globos",
};

export type ReferenciaGuiada = {
  frase: string;
  aspecto?: number;
  piezas: Array<{ x: number; y: number; ancho: number; alto: number }>;
  colores: Array<{ nombre: string; hex: string }>;
};

function colorCliente(valor: string): { nombre: string; hex: string } | null {
  const limpio = valor.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es");
  const palabras = limpio.replace(/[^a-z ]/g, " ").split(/\s+/).filter(Boolean);
  for (const palabra of palabras) {
    const clave = COLORES[palabra] ? palabra : SINONIMOS_COLOR[palabra];
    if (clave && COLORES[clave]) return COLORES[clave]!;
  }
  return null;
}

export function adaptarAnalisisReferencia(raw: unknown): ReferenciaGuiada | null {
  const parsed = RespuestaAnalisisSchema.safeParse(raw);
  if (!parsed.success) return null;
  const elementos = parsed.data.blueprint.elements.filter((elemento) => elemento.approved && elemento.category === "balloon_structure");
  if (!elementos.length) return null;

  const conteoFormas = new Map<string, number>();
  for (const elemento of elementos) {
    const tipo = elemento.visual_semantics?.structure_type;
    const forma = tipo ? FORMAS[tipo] : undefined;
    const cantidad = elemento.quantity_semantics === "physical_instances" ? elemento.quantity.max : 1;
    if (forma) conteoFormas.set(forma, (conteoFormas.get(forma) ?? 0) + cantidad);
  }
  const formasUnicas = [...conteoFormas].map(([forma, cantidad]) => {
    const formaPlural = forma === "columna" ? "columnas" : forma === "arco" ? "arcos" : forma === "medio arco" ? "medios arcos" : forma;
    return cantidad > 1 ? `${NUMEROS[cantidad] ?? cantidad} ${formaPlural}` : `${ARTICULO[forma] ?? "un"} ${forma}`;
  });
  const colores = [...new Map(elementos.flatMap((elemento) => elemento.appearance.resolved_colors.length ? elemento.appearance.resolved_colors : elemento.appearance.observed_colors)
    .map(colorCliente).filter((color): color is { nombre: string; hex: string } => color !== null)
    .map((color) => [color.nombre, color])).values()].slice(0, 5);
  const frasePiezas = formasUnicas.length ? formasUnicas.join(" y ") : "una decoración con globos";
  const nombres = colores.map((color) => color.nombre.toLocaleLowerCase("es"));
  const fraseColores = nombres.length ? ` en ${nombres.length > 1 ? `${nombres.slice(0, -1).join(", ")} y ${nombres.at(-1)}` : nombres[0]}` : "";
  return {
    frase: `Veo ${frasePiezas}${fraseColores}.`,
    ...(parsed.data.blueprint.source_images[0]?.aspect_ratio ? { aspecto: parsed.data.blueprint.source_images[0].aspect_ratio } : {}),
    piezas: elementos.slice(0, 8).map((elemento) => ({ x: elemento.reference_bbox.x, y: elemento.reference_bbox.y, ancho: elemento.reference_bbox.width, alto: elemento.reference_bbox.height })),
    colores,
  };
}
