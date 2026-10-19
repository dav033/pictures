import { z } from "zod";
import { ReferenceBlueprintV2Schema } from "@/lib/ia/referencia/reference-blueprint";
import { coloresNombradosReferencia } from "@/lib/plan/colores-referencia";
import { HEX_COLORES_OBSERVABLES } from "@/lib/rag/taxonomy/v2";

const RespuestaAnalisisSchema = z.object({ blueprint: ReferenceBlueprintV2Schema }).passthrough();

/**
 * Cómo dice el cliente cada color del catálogo. Los colores salen de `coloresNombradosReferencia`, la MISMA lectura
 * de las etiquetas que usa el plan para comprar (`colores-referencia.ts`): lo que la guiada dice que vio es lo que el
 * plan lee de la foto, color por color. Hasta el 2026-10-06 la guiada tenía su propio diccionario de 14 colores: el
 * transparente, el gris, el vino, el durazno, el crema o el oro rosa no existían en él y desaparecían de la frase y
 * del brief del plan («Veo dos columnas en rosa y plata» con una foto rosa, plata, blanca y con transparentes).
 */
const NOMBRE_CLIENTE: Readonly<Record<string, string>> = {
  plateado: "plata", rosado: "rosa", "dorado rosa": "oro rosa", burdeos: "vino", champagne: "champaña", cafe: "café",
};

/** El acabado de cada color tal como lo escribió la lectura (`acabadoDeEtiqueta`), dicho para el cliente. */
const ACABADO_CLIENTE: Readonly<Record<string, string>> = { reflex: "cromado", satin: "perlado" };

const ARTICULO: Readonly<Record<string, string>> = { columna: "una", guirnalda: "una", "pared de globos": "una", "figura de globos": "una" };
const NUMEROS = ["", "", "dos", "tres", "cuatro", "cinco", "seis"];
/** Colores que caben en la frase; `colores` los lleva todos (el tope del blueprint por pieza es 8). */
const MAX_COLORES_FRASE = 6;
const MAX_COLORES = 8;

const FORMAS: Readonly<Record<string, string>> = {
  arco: "arco", semiarco: "medio arco", columna: "columna", guirnalda: "guirnalda",
  pared: "pared de globos", bouquet: "ramo de globos", ramo: "ramo de globos",
  escultura: "figura de globos", centro_mesa: "centro de mesa", aro: "aro de globos",
};

export type ReferenciaGuiada = {
  blueprint: z.infer<typeof ReferenceBlueprintV2Schema>;
  frase: string;
  aspecto?: number;
  piezas: Array<{ x: number; y: number; ancho: number; alto: number }>;
  /** Cada color de las piezas de globos, sin acabado («Plata», «Transparente»): es lo que va al brief del plan. */
  colores: Array<{ nombre: string; hex: string }>;
};

type Elemento = z.infer<typeof ReferenceBlueprintV2Schema>["elements"][number];

/** «pastel pink», «soft pink» → pastel; «matte white» → mate. Solo lo que la etiqueta dice: el silencio no es mate. */
function acabadoCliente(etiqueta: string, acabado: string | undefined): string | null {
  if (/\b(?:metallic|metalizad[oa]|foil)\b/i.test(etiqueta)) return "metalizado";
  if (acabado && ACABADO_CLIENTE[acabado]) return ACABADO_CLIENTE[acabado]!;
  if (/\b(?:pastel|soft)\b/i.test(etiqueta)) return "pastel";
  return acabado === "mate" ? "mate" : null;
}

/** Los colores de las piezas en el orden en que cuentan, cada uno con su acabado para la frase. */
function coloresDeLasPiezas(elementos: readonly Elemento[]): Array<{ color: string; nombre: string; frase: string; hex: string }> {
  const vistos = new Map<string, { color: string; nombre: string; frase: string; hex: string }>();
  for (const elemento of elementos) {
    const apariencia = elemento.appearance.resolved_colors.length ? { ...elemento.appearance, observed_colors: elemento.appearance.resolved_colors } : elemento.appearance;
    for (const { color, acabado, etiqueta } of coloresNombradosReferencia(apariencia)) {
      if (vistos.has(color)) continue;
      const nombre = NOMBRE_CLIENTE[color] ?? color;
      const confeti = color === "transparente" && /\bconfet/i.test(etiqueta);
      const adjetivo = color === "transparente" ? null : acabadoCliente(etiqueta, acabado);
      vistos.set(color, {
        color,
        nombre: nombre.charAt(0).toLocaleUpperCase("es") + nombre.slice(1),
        frase: [nombre, adjetivo, confeti ? "con confeti" : null].filter(Boolean).join(" "),
        hex: HEX_COLORES_OBSERVABLES[color] ?? "#9ca3af",
      });
    }
  }
  return [...vistos.values()];
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
  const colores = coloresDeLasPiezas(elementos).slice(0, MAX_COLORES);
  const frasePiezas = formasUnicas.length ? formasUnicas.join(" y ") : "una decoración con globos";
  const nombres = colores.slice(0, MAX_COLORES_FRASE).map((color) => color.frase);
  const fraseColores = nombres.length ? ` en ${nombres.length > 1 ? `${nombres.slice(0, -1).join(", ")} y ${nombres.at(-1)}` : nombres[0]}` : "";
  return {
    blueprint: parsed.data.blueprint,
    frase: `Veo ${frasePiezas}${fraseColores}. ¿Te armo el plan con estas piezas?`,
    ...(parsed.data.blueprint.source_images[0]?.aspect_ratio ? { aspecto: parsed.data.blueprint.source_images[0].aspect_ratio } : {}),
    piezas: elementos.slice(0, 8).map((elemento) => ({ x: elemento.reference_bbox.x, y: elemento.reference_bbox.y, ancho: elemento.reference_bbox.width, alto: elemento.reference_bbox.height })),
    colores: colores.map(({ nombre, hex }) => ({ nombre, hex })),
  };
}
