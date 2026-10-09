import { colorDeGloboEnIngles, enLista, formatoEnIngles } from "@/lib/globos3d/render-ia";
import { referenciaPorCodigo } from "@/lib/plan/referencia-sempertex";
import type { ConfigModulo } from "./configuracion";

/**
 * Texto para FLUX.2 `/edit` con la captura 3D del módulo como base: una foto de producto de UN solo módulo de globos
 * sobre un fondo continuo neutro. La forma, la posición y la cantidad de globos vienen de la captura; el texto solo
 * pone el realismo del látex, el acabado de cada color y cierra el inventario (nada más en la foto).
 * Si este texto cambia, hay que subir `VERSION_PIPELINE` (clave-render.ts).
 */

const NOMBRE_EN: Readonly<Record<string, string>> = {
  pareja: "pair (duo) of two balloons",
  trio: "trio of three balloons",
  cuarteto: "quad (four balloons)",
  quinteto: "cluster of five balloons",
  sexteto: "cluster of six balloons",
};

/** Cómo se ve cada familia de acabado, para que FLUX no vuelva brillante un mate ni mate un cromado. */
const ACABADO_EN: Readonly<Record<string, string>> = {
  fashion: "opaque matte latex, no shine",
  pastelMate: "soft opaque matte pastel latex, no shine",
  pastelDusk: "soft opaque matte dusty-pastel latex, no shine",
  neon: "bright opaque matte neon latex",
  satin: "smooth satin latex with a gentle sheen",
  silk: "pearlescent satin latex with a soft iridescent sheen",
  metal: "metallic latex with a satin metal sheen",
  reflex: "glossy mirror-chrome latex with sharp reflections of the studio lights",
  cristal: "clear translucent see-through latex",
};

/** «2 × matte light pink (#F2B6C8), opaque matte latex, no shine»: cada color con cuántos globos y cómo se ve. */
function lineaDeColor(codigo: string, cantidad: number): string {
  const ref = referenciaPorCodigo(codigo);
  if (!ref) return `${cantidad} × balloon`;
  return `${cantidad} × ${colorDeGloboEnIngles(ref)}, ${ACABADO_EN[ref.familia] ?? "latex"}`;
}

export function promptModuloEstudio(config: ConfigModulo): string {
  const porColor = new Map<string, number>();
  for (const codigo of config.colores) porColor.set(codigo, (porColor.get(codigo) ?? 0) + 1);
  const colores = enLista([...porColor.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([codigo, n]) => lineaDeColor(codigo, n)));
  const total = config.colores.length;
  return [
    `Turn this 3D preview into a real professional studio product photograph of a single ${NOMBRE_EN[config.tipo] ?? "balloon cluster"}.`,
    `Keep the arrangement exactly as shown: ${total} ${formatoEnIngles(config.formatoId)} latex balloons knotted together at the center, same positions, same overlap and same camera angle; do not add, remove, merge or recolor balloons.`,
    `The balloons: ${colores}.`,
    "Color fidelity: every balloon keeps exactly the color it has in the input image and the hex code given for it; do not darken, desaturate or tint the balloons.",
    "Make it a real photograph, not a 3D render: natural soft highlights and subtle latex texture, balloons slightly squashed where they touch, tiny real knots at the center.",
    "Background: a seamless, plain, light neutral grey studio backdrop and floor with no horizon line, soft diffused studio lighting and a soft natural contact shadow under the balloons.",
    "Nothing else is in the image: no room, furniture, table, ribbon, string, text, logo, people, props or extra balloons.",
    "Centered composition with comfortable empty space around the balloons; sharp detail, natural depth.",
  ].join(" ");
}
