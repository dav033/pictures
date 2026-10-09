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
