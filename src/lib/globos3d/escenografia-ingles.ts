import type { PiezaEscenografia } from "./mobiliario-pieza";
import { tonoEnIngles } from "./render-ia";

/**
 * Cómo se llama en inglés cada pieza del catálogo de fondos y mobiliario (`FONDOS_CATALOGO`), para el inventario cerrado
 * que se le manda a FLUX (`escenaEnIngles`): «6 × gold Tiffany chiavari chair» en vez de «party props», que lo dejaba
 * inventar muebles. Singular, sin artículo.
 */
export const ESCENOGRAFIA_EN: Readonly<Record<string, string>> = {
  panel_redondo: "round backdrop panel", media_luna: "crescent-moon backdrop panel", arcos_chiara: "set of stepped chiara arch panels", lentejuelas: "sequin wall panel",
  pedestales: "set of cylinder pedestals", mesa_mantel: "table with a floor-length tablecloth", tapete_redondo: "floor rug", cortina_luces: "curtain backdrop with fairy lights", letrero: "wooden name sign",
  silla_tiffany: "Tiffany (chiavari) chair", silla_moderna: "modern chair with slim black legs", banca: "cushioned bench", taburete_alto: "tall round bar stool", taburete_bajo: "low round stool",
  sofa: "three-seat sofa", love_seat: "two-seat love seat sofa", sillon: "armchair", mesa_imperial: "long rectangular banquet table", mesa_imperial_mantel: "long rectangular banquet table with a floor-length tablecloth",
  mesa_redonda: "round banquet table", mesa_redonda_mantel: "round banquet table with a floor-length tablecloth", mesa_coctel: "tall round cocktail table", mesa_coctel_licra: "tall cocktail table with a stretch spandex cover",
  mesa_postres: "narrow dessert console table", mesa_postres_mantel: "narrow dessert table with a floor-length tablecloth", mesa_centro: "low coffee table", mesa_hexagonal: "gold wire hexagonal side table",
  mesas_nido_hexagonales: "set of three gold wire hexagonal nesting tables", mesa_regalos: "gift table with a floor-length tablecloth and wrapped gift boxes", carrito_dulces: "candy cart with shelves and jars of sweets",
  aro_metalico: "metal ring backdrop stand", aro_hexagonal: "metal hexagon frame backdrop stand", arco_metalico: "metal arch frame stand", base_hexagonal: "hexagonal plinth", peldanos: "set of three display steps",
  escalera_decorativa: "decorative wooden ladder", biombo: "three-panel folding screen", jarron_pampas: "tall vase with pampas grass", lampara_pie: "floor lamp", base_pastel: "cake stand",
  neon_cursiva: "cursive neon sign on a dark panel", columna_griega: "white Greek column", alfombra_redonda: "round rug",
  mesa_redonda_sillas: "round banquet table with a floor-length tablecloth and eight Tiffany chairs around it", mesa_imperial_sillas: "long banquet table with a floor-length tablecloth and ten Tiffany chairs around it",
  sala_lounge: "lounge set (sofa, two armchairs and a coffee table)",
};

/**
 * La frase de una pieza de escenografía del catálogo para FLUX: su nombre en inglés, con sus colores (nombre y hex) y, en un
 * letrero con texto, lo que dice. null si no es del catálogo (queda como «other props»).
 */
export function fraseDeEscenografia(p: PiezaEscenografia): string | null {
  const id = p.mueble?.id;
  const nombre = id ? ESCENOGRAFIA_EN[id] : undefined;
  if (!id || !nombre) return null;
  const o = p.mueble?.opciones;
  if (!o) return nombre;
  const distintos = [...new Set(o.colores.slice(0, 2))];
  const colores = distintos.length ? ` in ${distintos.map(tonoEnIngles).join(" and ")}` : "";
  return `${nombre}${colores}${o.texto ? ` reading "${o.texto}"` : ""}`;
}

/** Qué son los props de escenografía: lo que se sabe del catálogo («6 × Tiffany chair in …, a round banquet table in …») o, si no, la frase de siempre. */
export function propsEnIngles(porNombre: ReadonlyMap<string, number>, total: number): string {
  if (!porNombre.size) return "backdrop panels, tables or rug";
  const nombrados = [...porNombre.values()].reduce((s, n) => s + n, 0);
  return [...[...porNombre].map(([nombre, n]) => (n > 1 ? `${n} × ${nombre}` : `a ${nombre}`)), ...(total > nombrados ? ["other props as in the input"] : [])].join(", ");
}
