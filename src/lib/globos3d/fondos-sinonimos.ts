import { FONDOS_CATALOGO } from "./fondos-escenografia";

/**
 * **Los ids de fondo que el lector inventa, antes de validar la lectura.** El esquema que se le manda a Gemini ya no lleva la
 * enumeración de los ~48 ids del catálogo (pasaba su tope), así que puede escribir uno que no existe («mesa_de_dulces»). Antes
 * eso rompía la validación y costaba una segunda lectura entera; ahora el id se normaliza (acentos, mayúsculas, espacios), se
 * busca en una tabla de sinónimos y, si no es de nadie, la pieza pasa a `otro` con el id inventado en su descripción. Puro.
 */

const IDS = new Set(FONDOS_CATALOGO.map((f) => f.id));

/** Cómo suele llamar el lector a lo que el catálogo tiene con otro id (ya normalizados: minúsculas, sin acentos, con guion bajo). */
export const SINONIMOS_DE_FONDO: Readonly<Record<string, string>> = {
  panel_circular: "panel_redondo", panel_redondo_dorado: "panel_redondo", circulo: "panel_redondo", panel_circulo: "panel_redondo", backdrop_redondo: "panel_redondo",
  luna: "media_luna", panel_media_luna: "media_luna", media_luna_azul: "media_luna",
  arco_chiara: "arcos_chiara", arcos: "arcos_chiara", arcos_escalonados: "arcos_chiara", arco_chiavari: "arcos_chiara", chiara: "arcos_chiara",
  pared_lentejuelas: "lentejuelas", pared_de_lentejuelas: "lentejuelas", panel_lentejuelas: "lentejuelas", lentejuela: "lentejuelas", pared_shimmer: "lentejuelas", shimmer_wall: "lentejuelas", shimmer: "lentejuelas",
  pedestal: "pedestales", cilindros: "pedestales", cilindro: "pedestales", plintos: "pedestales", plinto: "pedestales",
  mesa_con_mantel: "mesa_mantel", mesa_manteles: "mesa_mantel", mesa_mantel_blanco: "mesa_mantel", mesa_de_mantel: "mesa_mantel",
  mesa_de_postres: "mesa_postres", mesa_dulces: "mesa_postres", mesa_de_dulces: "mesa_postres", consola: "mesa_postres", mesa_de_dulces_con_mantel: "mesa_postres_mantel", mesa_de_postres_con_mantel: "mesa_postres_mantel", mesa_postres_con_mantel: "mesa_postres_mantel",
  mesa_de_regalos: "mesa_regalos", mesa_regalo: "mesa_regalos", mesa_de_centro: "mesa_centro",
  mesa_cocktail: "mesa_coctel", mesa_de_coctel: "mesa_coctel", mesa_alta: "mesa_coctel", mesa_cocktail_licra: "mesa_coctel_licra",
  tapete: "tapete_redondo", alfombra: "alfombra_redonda", tapete_circular: "alfombra_redonda", alfombra_circular: "alfombra_redonda",
  cortina: "cortina_luces", cortina_con_luces: "cortina_luces", cortinas: "cortina_luces", cortina_de_luces: "cortina_luces",
  letrero_nombre: "letrero", cartel: "letrero", tablero: "letrero",
  silla: "silla_tiffany", silla_chiavari: "silla_tiffany", silla_chiavari_dorada: "silla_tiffany", sillas: "silla_tiffany", silla_dorada: "silla_tiffany",
  silla_moderna_blanca: "silla_moderna", taburete: "taburete_alto", banco_alto: "taburete_alto",
  sillon_individual: "sillon", butaca: "sillon", loveseat: "love_seat", sofa_de_dos_plazas: "love_seat", sillon_doble: "love_seat",
  neon: "neon_cursiva", letrero_neon: "neon_cursiva", neon_sign: "neon_cursiva", letrero_de_neon: "neon_cursiva",
  aro: "aro_metalico", aro_dorado: "aro_metalico", arco_de_metal: "arco_metalico", marco_hexagonal: "aro_hexagonal", hexagono: "aro_hexagonal",
  escalones: "peldanos", escalon: "peldanos", gradas: "peldanos", peldano: "peldanos", escalera: "escalera_decorativa",
  columna: "columna_griega", pilar: "columna_griega", columna_romana: "columna_griega",
  jarron: "jarron_pampas", pampas: "jarron_pampas", lampara: "lampara_pie",
  base_de_pastel: "base_pastel", soporte_pastel: "base_pastel", torta: "pastel", tortas: "pastel", pastel_de_pisos: "pastel", torta_de_pisos: "pastel", cake: "pastel", tiered_cake: "pastel", pasteles: "pastel",
  cortina_de_flecos: "cortina_flecos", cortina_flecos_dorados: "cortina_flecos", cortina_de_tiras: "cortina_flecos", cortina_tiras: "cortina_flecos", cortina_de_tinsel: "cortina_flecos", cortina_tinsel: "cortina_flecos", cortina_shimmer: "cortina_flecos",
  cortina_de_fleco: "cortina_flecos", cortina_fleco: "cortina_flecos", cortina_de_raso: "cortina_flecos", cortina_de_satin: "cortina_flecos", fringe_curtain: "cortina_flecos", tinsel_curtain: "cortina_flecos", cortina_brillante: "cortina_flecos", cortina_metalizada: "cortina_flecos", flecos: "cortina_flecos",
  mesa_de_postres_blanca: "mesa_postres", mesa_de_postres_ornamentada: "mesa_postres", mesa_postres_blanca: "mesa_postres", marco_de_tela: "marco_tela", marco_con_tela: "marco_tela",
  nombre_acrilico: "rotulo_acrilico", nombre_de_acrilico: "rotulo_acrilico", letras_acrilico: "rotulo_acrilico",
  carrito: "carrito_dulces", candy_cart: "carrito_dulces",
};

const normalizar = (id: string): string => id.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

/** El id del catálogo que corresponde a lo que escribió el lector, o null si no se parece a ninguno. */
export function idDeFondoConocido(id: string): string | null {
  if (IDS.has(id)) return id;
  const n = normalizar(id);
  if (IDS.has(n)) return n;
  const sinonimo = SINONIMOS_DE_FONDO[n];
  return sinonimo && IDS.has(sinonimo) ? sinonimo : null;
}

/**
 * La lectura cruda con sus piezas «fondo» de id inventado corregidas: al id del catálogo si es un sinónimo; si no, `otro` con una
 * descripción que dice qué fue. `correcciones` lista lo que se cambió (para el registro). No toca nada que no sea una pieza fondo con id de texto.
 */
export function corregirFondosLeidos(crudo: unknown): { crudo: unknown; correcciones: string[] } {
  const piezas = typeof crudo === "object" && crudo !== null ? (crudo as { piezas?: unknown }).piezas : undefined;
  if (!Array.isArray(piezas)) return { crudo, correcciones: [] };
  const correcciones: string[] = [];
  const nuevas = piezas.map((p: unknown, i): unknown => {
    if (typeof p !== "object" || p === null) return p;
    const o = p as { tipo?: unknown; id?: unknown; texto?: unknown; nota?: unknown };
    if (o.tipo !== "fondo" || typeof o.id !== "string") return p;
    const conocido = idDeFondoConocido(o.id);
    if (conocido === o.id) return p;
    if (conocido) {
      correcciones.push(`Pieza ${i + 1}: fondo «${o.id}» → «${conocido}»`);
      return { ...o, id: conocido };
    }
    correcciones.push(`Pieza ${i + 1}: fondo «${o.id}» no está en el catálogo → otro`);
    const detalle = typeof o.nota === "string" && o.nota ? ` (${o.nota})` : typeof o.texto === "string" && o.texto ? ` (con el texto «${o.texto}»)` : "";
    return { tipo: "otro", descripcion: `Fondo «${o.id}» que no está en el catálogo${detalle}`.slice(0, 120) };
  });
  return { crudo: { ...(crudo as object), piezas: nuevas }, correcciones };
}
