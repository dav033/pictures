import type { AcabadoRotulo } from "./escenografia";
import { muebleDe } from "./mobiliario-catalogo";
import type { PiezaEscenografia } from "./mobiliario-pieza";
import { tonoEnIngles } from "./render-ia";
import { TEXTO_ROTULO_ACRILICO } from "./mobiliario-decorado";
import { ACABADO_ROTULO_EN, textoEnUnaLinea } from "./rotulos";

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
  neon_cursiva: "cursive neon sign on a dark panel", marco_tela: "fabric backdrop panel in a rectangular frame", rotulo_acrilico: "cut-out cursive name sign floating in front of the backdrop", columna_griega: "white Greek column", alfombra_redonda: "round rug",
  mesa_redonda_sillas: "round banquet table with a floor-length tablecloth and eight Tiffany chairs around it", mesa_imperial_sillas: "long banquet table with a floor-length tablecloth and ten Tiffany chairs around it",
  sala_lounge: "lounge set (sofa, two armchairs and a coffee table)",
};

/** El color de unas letras para FLUX: en espejo, «gold», «silver» o «rose gold» (no «yellow», «gray» o «pink»), siempre con su hex. */
function colorDeLetrasEn(hex: string, acabado: AcabadoRotulo): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m || acabado !== "acrilico_espejo") return tonoEnIngles(hex);
  const [r, g, b] = [m[1]!, m[2]!, m[3]!].map((x) => parseInt(x, 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b), croma = max - Math.min(r, g, b), luz = (max + Math.min(r, g, b)) / 2;
  const tono = croma === 0 ? 0 : max === r ? (60 * (((g - b) / croma) % 6) + 360) % 360 : max === g ? 60 * ((b - r) / croma + 2) : 60 * ((r - g) / croma + 4);
  const sufijo = ` (${hex.toUpperCase()})`;
  if (croma < 0.1 && luz > 0.45) return `silver${sufijo}`;
  if (croma >= 0.1 && tono >= 25 && tono < 70) return `gold${sufijo}`;
  if (croma >= 0.08 && (tono < 25 || tono >= 330) && luz > 0.55) return `rose gold${sufijo}`;
  return tonoEnIngles(hex);
}

/** Las letras en cursiva de un rótulo para FLUX: «black cursive vinyl lettering "David y Dayan"». */
const letrasEn = (texto: string, color: string, acabado: AcabadoRotulo): string => `${colorDeLetrasEn(color, acabado)} cursive ${ACABADO_ROTULO_EN[acabado]} lettering "${textoEnUnaLinea(texto)}"`;

/**
 * La frase de una pieza de escenografía del catálogo para FLUX: su nombre en inglés, con sus colores (nombre y hex) y, en un
 * letrero con texto o con un rótulo en cursiva, lo que dice y cómo está hecho («black cursive vinyl lettering "David y Dayan" on a
 * white fabric backdrop panel in a black rectangular frame»). null si no es del catálogo (queda como «other props»).
 */
export function fraseDeEscenografia(p: PiezaEscenografia): string | null {
  const id = p.mueble?.id;
  const nombre = id ? ESCENOGRAFIA_EN[id] : undefined;
  if (!id || !nombre) return null;
  const o = p.mueble?.opciones;
  const rotulo = p.mueble?.rotulo;
  const letras = rotulo ? letrasEn(rotulo.texto, rotulo.color, rotulo.acabado) : null;
  if (id === "rotulo_acrilico" && o) {
    const espejo = o.acabado === undefined || o.acabado === "metal" || o.acabado === "brillante";
    return `${letrasEn(o.texto || TEXTO_ROTULO_ACRILICO, o.colores[0] ?? muebleDe(id)?.colores[0] ?? "#d6b25a", espejo ? "acrilico_espejo" : "acrilico_mate")}, ${nombre}`;
  }
  if (id === "marco_tela" && o) {
    const [marco, tela] = [o.colores[0] ?? "#1c1c1c", o.colores[1] ?? "#f7f6f2"];
    const base = `${tonoEnIngles(tela)} fabric backdrop panel in a ${tonoEnIngles(marco)} rectangular frame`;
    return letras ? `${letras} on a ${base}` : base;
  }
  if (!o) return letras ? `${nombre}, with ${letras} on it` : nombre;
  const distintos = [...new Set(o.colores.slice(0, 2))];
  const colores = distintos.length ? ` in ${distintos.map(tonoEnIngles).join(" and ")}` : "";
  return `${nombre}${colores}${o.texto ? ` reading "${o.texto}"` : ""}${letras ? `, with ${letras} on it` : ""}`;
}

/** Qué son los props de escenografía: lo que se sabe del catálogo («6 × Tiffany chair in …, a round banquet table in …») o, si no, la frase de siempre. */
export function propsEnIngles(porNombre: ReadonlyMap<string, number>, total: number): string {
  if (!porNombre.size) return "backdrop panels, tables or rug";
  const nombrados = [...porNombre.values()].reduce((s, n) => s + n, 0);
  return [...[...porNombre].map(([nombre, n]) => (n > 1 ? `${n} × ${nombre}` : `a ${nombre}`)), ...(total > nombrados ? ["other props as in the input"] : [])].join(", ");
}
