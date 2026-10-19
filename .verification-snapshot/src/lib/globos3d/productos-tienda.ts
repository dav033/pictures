import { formatoPorId, type TipoGlobo } from "./formatos";
import { referenciaPorCodigo } from "@/lib/plan/referencia-sempertex";
import { urlTienda } from "./utileria-catalogo";

/**
 * **Globos lisos en la tienda Sempertex** (https://sempertex.com): de (tipo de globo + color) al producto exacto que
 * se compra. La tienda tiene UN producto por tipo y color («GLOBO REDONDO FASHION NARANJA») y las tallas son sus
 * variantes (R-5, R-9, R-12…, cada una en paquetes de varias unidades): por eso el mapeo es por tipo + código de color
 * y cada fila dice qué tallas vende la tienda de ese producto.
 *
 * Cómo se hizo (2026-10-07): se bajó con `curl` el listado público de la tienda (/products.json, 7 páginas, 1661
 * productos, con pausas) y se cruzó cada color de la tabla oficial (`TABLA_SEMPERTEX`, 90 referencias) con el título
 * exacto «GLOBO {REDONDO|LINK-O-LOON®|TUBITO|CORAZON} {FAMILIA} {COLOR}» (sin tildes; la tienda abrevia PM = Pastel
 * Mate y PD = Pastel Dusk; el Cristal Transparente 390 se vende como «FASHION TRANSPARENTE»). Los 216 de abajo
 * salieron de ese listado: nombre y url son los de la tienda, tal cual. Además se abrió la página de 13 de ellos
 * (`pagina: true`), uno a uno y con calma: todas respondieron 200 con ese producto. Lo que no está en el listado
 * (`NO_ESTAN_EN_LA_TIENDA`, 9 combinaciones) sale como «sin verificar», con una búsqueda en la tienda en vez de url.
 * Se regenera con el mismo cruce; no se edita a mano.
 */
export type ProductoGloboTienda = {
  tipo: TipoGlobo;
  /** Código de color de la tabla oficial («061»). */
  codigo: string;
  /** Nombre exacto del producto en la tienda. */
  nombre: string;
  /** Url relativa del producto (/products/…). */
  url: string;
  /** Tallas que la tienda vende de este producto (sus variantes): «R-5», «LOL-12», «T-260», «C-6»… */
  tallas: readonly string[];
  /** Su página se abrió y respondió 200 (además de estar en el listado). */
  pagina?: true;
};

export const GLOBOS_TIENDA: readonly ProductoGloboTienda[] = [
  { tipo: "redondo", codigo: "005", nombre: "GLOBO REDONDO FASHION BLANCO", url: "/products/globo-para-fiesta-latex-redondo-fashion-blanco", tallas: ["R-5", "R-9", "R-12", "R-18", "R-24", "R-36", "R-40"], pagina: true },
  { tipo: "redondo", codigo: "009", nombre: "GLOBO REDONDO FASHION ROSADO", url: "/products/globo-para-fiesta-latex-redondo-fashion-rosado", tallas: ["R-5", "R-9", "R-12", "R-18", "R-24", "R-36", "R-40"] },
  { tipo: "redondo", codigo: "010", nombre: "GLOBO REDONDO FASHION PALO DE ROSA", url: "/products/globo-para-fiesta-latex-redondo-fashion-palo-de-rosa", tallas: ["R-5", "R-9", "R-12", "R-18", "R-24", "R-36"] },
  { tipo: "redondo", codigo: "011", nombre: "GLOBO REDONDO FASHION ROSA", url: "/products/globo-latex-redondo-fashion-rosa", tallas: ["R-5", "R-9", "R-12", "R-18", "R-24", "R-36"] },
  { tipo: "redondo", codigo: "012", nombre: "GLOBO REDONDO FASHION FUCSIA", url: "/products/globo-para-fiesta-latex-redondo-fashion-fucsia", tallas: ["R-5", "R-9", "R-12", "R-18", "R-24", "R-36", "R-40"] },
  { tipo: "redondo", codigo: "014", nombre: "GLOBO REDONDO FASHION FRAMBUESA", url: "/products/globo-para-fiesta-latex-redondo-fashion-frambuesa", tallas: ["R-5", "R-9", "R-12", "R-24", "R-36"] },
  { tipo: "redondo", codigo: "015", nombre: "GLOBO REDONDO FASHION ROJO", url: "/products/globo-para-fiesta-latex-redondo-fashion-rojo", tallas: ["R-5", "R-9", "R-12", "R-18", "R-24", "R-36", "R-40"] },
  { tipo: "redondo", codigo: "016", nombre: "GLOBO REDONDO FASHION ROJO IMPERIAL", url: "/products/globo-latex-redondo-fashion-rojo-imperial", tallas: ["R-5", "R-9", "R-12", "R-18", "R-24"] },
  { tipo: "redondo", codigo: "018", nombre: "GLOBO REDONDO FASHION MERLOT", url: "/products/globo-latex-redondo-fashion-merlot", tallas: ["R-5", "R-9", "R-12", "R-18", "R-24"] },
  { tipo: "redondo", codigo: "020", nombre: "GLOBO REDONDO FASHION AMARILLO", url: "/products/globo-para-fiesta-latex-redondo-fashion-amarillo", tallas: ["R-5", "R-9", "R-12", "R-18", "R-24", "R-36"] },
  { tipo: "redondo", codigo: "021", nombre: "GLOBO REDONDO FASHION AMARILLO MIEL", url: "/products/copia-de-globo-latex-redondo-fashion-amarillomiel", tallas: ["R-5", "R-9", "R-12", "R-18", "R-24"] },
  { tipo: "redondo", codigo: "023", nombre: "GLOBO REDONDO FASHION MOSTAZA", url: "/products/globo-para-fiesta-latex-redondo-fashion-mostaza", tallas: ["R-5", "R-9", "R-12", "R-18", "R-24"] },
  { tipo: "redondo", codigo: "027", nombre: "GLOBO REDONDO FASHION EUCALIPTO", url: "/products/globo-para-fiesta-latex-redondo-fashion-eucalipto", tallas: ["R-5", "R-9", "R-12", "R-18", "R-24", "R-36"], pagina: true },
  { tipo: "redondo", codigo: "029", nombre: "GLOBO REDONDO FASHION VERDE TREBOL", url: "/products/globo-latex-redondo-fashion-verde-trebol", tallas: ["R-5", "R-9", "R-12", "R-18", "R-24"] },
  { tipo: "redondo", codigo: "030", nombre: "GLOBO REDONDO FASHION VERDE", url: "/products/globo-para-fiesta-latex-redondo-fashion-verde", tallas: ["R-5", "R-9", "R-12", "R-18"] },
  { tipo: "redondo", codigo: "031", nombre: "GLOBO REDONDO FASHION VERDE LIMA", url: "/products/globo-para-fiesta-latex-redondo-fashion-verde-lima", tallas: ["R-5", "R-9", "R-12", "R-18", "R-24", "R-36", "R-40"] },
  { tipo: "redondo", codigo: "032", nombre: "GLOBO REDONDO FASHION VERDE SELVA", url: "/products/globo-para-fiesta-latex-redondo-fashion-verde-selva", tallas: ["R-5", "R-9", "R-12", "R-18", "R-24"] },
  { tipo: "redondo", codigo: "035", nombre: "GLOBO REDONDO FASHION TURQUESA PROFUNDO", url: "/products/globo-latex-redondo-fashion-turquesa-profundo", tallas: ["R-5", "R-9", "R-12", "R-18", "R-24"] },
  { tipo: "redondo", codigo: "037", nombre: "GLOBO LATEX REDONDO FASHION AGUAMARINA", url: "/products/globo-para-fiesta-latex-redondo-fashion-aguamarina", tallas: ["R-5", "R-9", "R-12", "R-18", "R-24", "R-36"] },
  { tipo: "redondo", codigo: "038", nombre: "GLOBO REDONDO FASHION AZUL CARIBE", url: "/products/globo-para-fiesta-latex-redondo-fashion-azul-caribe", tallas: ["R-5", "R-9", "R-12", "R-24"] },
  { tipo: "redondo", codigo: "040", nombre: "GLOBO REDONDO FASHION AZUL", url: "/products/globo-para-fiesta-latex-redondo-fashion-azul", tallas: ["R-5", "R-9", "R-12", "R-18", "R-24", "R-36", "R-40"] },
  { tipo: "redondo", codigo: "041", nombre: "GLOBO REDONDO FASHION AZUL REY", url: "/products/globo-para-fiesta-latex-redondo-fashion-azul-rey", tallas: ["R-5", "R-9", "R-12", "R-18", "R-24", "R-40"] },
  { tipo: "redondo", codigo: "042", nombre: "GLOBO REDONDO FASHION AZUL HORTENSIA", url: "/products/globo-latex-redondo-fashion-hortensia", tallas: ["R-5", "R-9", "R-12", "R-18", "R-24"] },
  { tipo: "redondo", codigo: "044", nombre: "GLOBO REDONDO FASHION AZUL NAVAL", url: "/products/globo-para-fiesta-latex-redondo-fashion-azul-naval", tallas: ["R-5", "R-9", "R-12", "R-18", "R-24"] },
  { tipo: "redondo", codigo: "050", nombre: "GLOBO REDONDO FASHION LILA", url: "/products/globo-para-fiesta-latex-redondo-fashion-lila", tallas: ["R-5", "R-9", "R-12", "R-18", "R-36"] },
  { tipo: "redondo", codigo: "051", nombre: "GLOBO REDONDO FASHION VIOLETA", url: "/products/globo-para-fiesta-latex-redondo-fashion-violeta", tallas: ["R-5", "R-9", "R-12", "R-18", "R-24"] },
  { tipo: "redondo", codigo: "056", nombre: "GLOBO REDONDO FASHION ORQUIDEA MORADA", url: "/products/globo-para-fiesta-latex-redondo-fashion-orquidea-morada", tallas: ["R-5", "R-9", "R-12", "R-18", "R-24"] },
  { tipo: "redondo", codigo: "059", nombre: "GLOBO REDONDO FASHION CORAL TROPICAL", url: "/products/globo-para-fiesta-latex-redondo-fashion-coral-tropical", tallas: ["R-5", "R-9", "R-12", "R-18", "R-24"] },
  { tipo: "redondo", codigo: "060", nombre: "GLOBO REDONDO FASHION DURAZNO", url: "/products/globo-para-fiesta-latex-redondo-fashion-durazno", tallas: ["R-5", "R-9", "R-12", "R-18", "R-24", "R-36"] },
  { tipo: "redondo", codigo: "061", nombre: "GLOBO REDONDO FASHION NARANJA", url: "/products/globo-para-fiesta-latex-redondo-fashion-naranja", tallas: ["R-5", "R-9", "R-12", "R-18", "R-24", "R-40"], pagina: true },
  { tipo: "redondo", codigo: "062", nombre: "GLOBO REDONDO FASHION NARANJA COBRIZO", url: "/products/globo-latex-redondo-fashion-naranja-cobrizo", tallas: ["R-5", "R-9", "R-12", "R-18", "R-24"] },
  { tipo: "redondo", codigo: "070", nombre: "GLOBO REDONDO FASHION MOCA", url: "/products/globo-latex-redondo-fashion-moca", tallas: ["R-5", "R-9", "R-12", "R-18", "R-24"] },
  { tipo: "redondo", codigo: "071", nombre: "GLOBO REDONDO FASHION ARENA", url: "/products/globo-para-fiesta-latex-redondo-fashion-arena", tallas: ["R-5", "R-9", "R-12", "R-18", "R-24", "R-36"] },
  { tipo: "redondo", codigo: "073", nombre: "GLOBO REDONDO FASHION LATTE", url: "/products/globo-para-fiesta-latex-redondo-fashion-latte", tallas: ["R-5", "R-9", "R-12", "R-18", "R-24", "R-36"] },
  { tipo: "redondo", codigo: "074", nombre: "GLOBO REDONDO FASHION CAFÉ", url: "/products/globo-para-fiesta-latex-redondo-fashion-cafe", tallas: ["R-5", "R-9", "R-12", "R-18", "R-24"] },
  { tipo: "redondo", codigo: "076", nombre: "GLOBO REDONDO FASHION CHOCOLATE", url: "/products/globo-para-fiesta-latex-redondo-fashion-chocolate", tallas: ["R-5", "R-12"] },
  { tipo: "redondo", codigo: "080", nombre: "GLOBO REDONDO FASHION NEGRO", url: "/products/globo-para-fiesta-latex-redondo-fashion-negro", tallas: ["R-5", "R-9", "R-12", "R-18", "R-24", "R-36", "R-40"] },
  { tipo: "redondo", codigo: "081", nombre: "GLOBO REDONDO FASHION GRIS", url: "/products/globo-para-fiesta-latex-redondo-fashion-gris", tallas: ["R-5", "R-9", "R-12", "R-24", "R-36"] },
  { tipo: "redondo", codigo: "107", nombre: "GLOBO LATEX REDONDO PASTEL DUSK CREMA", url: "/products/globo-para-fiesta-latex-redondo-pastel-dusk-crema", tallas: ["R-5", "R-9", "R-12", "R-18", "R-24", "R-36"] },
  { tipo: "redondo", codigo: "110", nombre: "GLOBO REDONDO PASTEL DUSK ROSA", url: "/products/globo-para-fiesta-latex-redondo-pastel-dusk-rosa", tallas: ["R-5", "R-9", "R-12", "R-18", "R-24"] },
  { tipo: "redondo", codigo: "126", nombre: "GLOBO REDONDO PASTEL DUSK TÉ VERDE", url: "/products/globo-para-fiesta-latex-redondo-pastel-dusk-te-verde", tallas: ["R-5", "R-9", "R-12", "R-18", "R-24"] },
  { tipo: "redondo", codigo: "140", nombre: "GLOBO REDONDO PASTEL DUSK AZUL", url: "/products/globo-para-fiesta-latex-redondo-pastel-dusk-azul", tallas: ["R-5", "R-9", "R-12", "R-18", "R-24"] },
  { tipo: "redondo", codigo: "150", nombre: "GLOBO REDONDO PASTEL DUSK LAVANDA", url: "/products/globo-para-fiesta-latex-redondo-pastel-dusk-lavanda", tallas: ["R-5", "R-9", "R-12", "R-18", "R-24"] },
  { tipo: "redondo", codigo: "212", nombre: "GLOBO REDONDO NEON FUCSIA", url: "/products/globo-para-fiesta-latex-redondo-neon-fucsia", tallas: ["R-5", "R-9", "R-12", "R-18", "R-24"] },
  { tipo: "redondo", codigo: "220", nombre: "GLOBO REDONDO NEON AMARILLO", url: "/products/globo-para-fiesta-latex-redondo-neon-amarillo", tallas: ["R-5", "R-9", "R-12", "R-18", "R-24"] },
  { tipo: "redondo", codigo: "230", nombre: "GLOBO REDONDO NEON VERDE", url: "/products/globo-para-fiesta-latex-redondo-neon-verde", tallas: ["R-5", "R-9", "R-12", "R-18", "R-24"] },
  { tipo: "redondo", codigo: "240", nombre: "GLOBO REDONDO NEON AZUL", url: "/products/globo-para-fiesta-latex-redondo-neon-azul", tallas: ["R-5", "R-9", "R-12", "R-18", "R-24"] },
  { tipo: "redondo", codigo: "261", nombre: "GLOBO REDONDO NEON NARANJA", url: "/products/globo-para-fiesta-latex-redondo-neon-naranja", tallas: ["R-5", "R-9", "R-12", "R-18", "R-24"] },
  { tipo: "redondo", codigo: "390", nombre: "GLOBO REDONDO FASHION TRANSPARENTE", url: "/products/globo-para-fiesta-latex-redondo-fashion-transparente", tallas: ["R-5", "R-9", "R-12", "R-18", "R-24", "R-36"], pagina: true },
  { tipo: "redondo", codigo: "405", nombre: "GLOBO REDONDO SATIN BLANCO", url: "/products/globo-para-fiesta-latex-redondo-satin-blanco", tallas: ["R-5", "R-9", "R-12", "R-24"] },
  { tipo: "redondo", codigo: "406", nombre: "GLOBO REDONDO SATIN PERLA", url: "/products/globo-para-fiesta-latex-redondo-satin-perla", tallas: ["R-5", "R-9", "R-12", "R-18", "R-24", "R-40"] },
  { tipo: "redondo", codigo: "409", nombre: "GLOBO REDONDO SATIN ROSADO", url: "/products/globo-para-fiesta-latex-redondo-satin-rosado", tallas: ["R-5", "R-9", "R-12", "R-18"] },
  { tipo: "redondo", codigo: "412", nombre: "GLOBO REDONDO SATIN FUCSIA", url: "/products/globo-para-fiesta-latex-redondo-satin-fucsia", tallas: ["R-5", "R-9", "R-12"] },
  { tipo: "redondo", codigo: "440", nombre: "GLOBO REDONDO SATIN AZUL", url: "/products/globo-para-fiesta-latex-redondo-satin-azul", tallas: ["R-5", "R-9", "R-12"] },
  { tipo: "redondo", codigo: "450", nombre: "GLOBO REDONDO SATIN LILA", url: "/products/globo-para-fiesta-latex-redondo-satin-lila", tallas: ["R-5", "R-9", "R-12"] },
  { tipo: "redondo", codigo: "481", nombre: "GLOBO REDONDO SATIN PLATA", url: "/products/globo-para-fiesta-latex-redondo-satin-plata", tallas: ["R-5", "R-9", "R-12", "R-18", "R-24", "R-36"] },
  { tipo: "redondo", codigo: "512", nombre: "GLOBO REDONDO METAL FUCSIA", url: "/products/globo-para-fiesta-latex-redondo-metal-fucsia", tallas: ["R-5", "R-9", "R-12"] },
  { tipo: "redondo", codigo: "515", nombre: "GLOBO REDONDO METAL ROJO", url: "/products/globo-para-fiesta-latex-redondo-metal-rojo", tallas: ["R-5", "R-9", "R-12"] },
  { tipo: "redondo", codigo: "530", nombre: "GLOBO REDONDO METAL VERDE", url: "/products/globo-para-fiesta-latex-redondo-metal-verde", tallas: ["R-5", "R-9", "R-12"] },
  { tipo: "redondo", codigo: "540", nombre: "GLOBO REDONDO METAL AZUL", url: "/products/globo-para-fiesta-latex-redondo-metal-azul", tallas: ["R-5", "R-9", "R-12", "R-18"] },
  { tipo: "redondo", codigo: "568", nombre: "GLOBO REDONDO METAL DORADO ROSA", url: "/products/globo-para-fiesta-latex-redondo-metal-dorado-rosa", tallas: ["R-5", "R-9", "R-12", "R-18", "R-24", "R-36"] },
  { tipo: "redondo", codigo: "570", nombre: "GLOBO REDONDO METAL DORADO", url: "/products/globo-para-fiesta-latex-redondo-metal-dorado-cobre", tallas: ["R-5", "R-9", "R-12", "R-18", "R-24", "R-36"], pagina: true },
  { tipo: "redondo", codigo: "580", nombre: "GLOBO REDONDO METAL NEGRO", url: "/products/globo-para-fiesta-latex-redondo-metal-negro", tallas: ["R-5", "R-9", "R-12", "R-18"] },
  { tipo: "redondo", codigo: "609", nombre: "GLOBO REDONDO PASTEL MATE ROSADO", url: "/products/globo-para-fiesta-latex-redondo-pastel-mate-rosado", tallas: ["R-5", "R-9", "R-12", "R-18", "R-24", "R-36"], pagina: true },
  { tipo: "redondo", codigo: "620", nombre: "GLOBO REDONDO PASTEL MATE AMARILLO", url: "/products/globo-para-fiesta-latex-redondo-pastel-mate-amarillo", tallas: ["R-5", "R-9", "R-12", "R-18", "R-24", "R-36"] },
  { tipo: "redondo", codigo: "630", nombre: "GLOBO REDONDO PASTEL MATE VERDE", url: "/products/globo-para-fiesta-latex-redondo-pastel-mate-verde", tallas: ["R-5", "R-9", "R-12", "R-18", "R-24", "R-36"] },
  { tipo: "redondo", codigo: "640", nombre: "GLOBO REDONDO PASTEL MATE AZUL", url: "/products/globo-para-fiesta-latex-redondo-pastel-mate-azul", tallas: ["R-5", "R-9", "R-12", "R-18", "R-24", "R-36"] },
  { tipo: "redondo", codigo: "650", nombre: "GLOBO REDONDO PASTEL MATE LILA", url: "/products/globo-para-fiesta-latex-redondo-pastel-mate-lila", tallas: ["R-5", "R-9", "R-12", "R-18", "R-24", "R-36"] },
  { tipo: "redondo", codigo: "661", nombre: "GLOBO REDONDO PASTEL MATE NUDE", url: "/products/globo-latex-redondo-pastel-mate-nude", tallas: ["R-5", "R-9", "R-12", "R-18", "R-24", "R-36"] },
  { tipo: "redondo", codigo: "663", nombre: "GLOBO REDONDO PASTEL MATE MELON", url: "/products/globo-para-fiesta-latex-redondo-pastel-mate-melon", tallas: ["R-5", "R-9", "R-12", "R-18", "R-24"] },
  { tipo: "redondo", codigo: "806", nombre: "GLOBO REDONDO SILK BLANCO NÁCAR", url: "/products/globo-latex-redondo-silk-blanco-nacar", tallas: ["R-5", "R-9", "R-12", "R-18", "R-24"] },
  { tipo: "redondo", codigo: "809", nombre: "GLOBO REDONDO SILK ROSA PRIMAVERAL", url: "/products/globo-latex-redondo-silk-rosa-primaveral", tallas: ["R-5", "R-9", "R-12", "R-18", "R-24"] },
  { tipo: "redondo", codigo: "826", nombre: "GLOBO REDONDO SILK VERDE MENTA", url: "/products/globo-latex-redondo-silk-verde-menta", tallas: ["R-5", "R-9", "R-12", "R-18", "R-24"] },
  { tipo: "redondo", codigo: "839", nombre: "GLOBO REDONDO SILK AZUL ÁRTICO", url: "/products/globo-latex-redondo-silk-azul-artico", tallas: ["R-5", "R-9", "R-12", "R-18", "R-24"] },
  { tipo: "redondo", codigo: "850", nombre: "GLOBO REDONDO SILK AMATISTA", url: "/products/globo-latex-redondo-silk-amatista", tallas: ["R-5", "R-9", "R-12", "R-18", "R-24"] },
  { tipo: "redondo", codigo: "870", nombre: "GLOBO REDONDO SILK DORADO", url: "/products/globo-latex-redondo-silk-rocio-de-oro", tallas: ["R-5", "R-9", "R-12", "R-18", "R-24"] },
  { tipo: "redondo", codigo: "873", nombre: "GLOBO REDONDO SILK PERLA CREMA", url: "/products/globo-latex-redondo-silk-perla-crema", tallas: ["R-5", "R-9", "R-12", "R-18", "R-24"] },
  { tipo: "redondo", codigo: "880", nombre: "GLOBO REDONDO SILK GRIS MEDIANOCHE", url: "/products/globo-latex-redondo-silk-gris-medianoche", tallas: ["R-5", "R-9", "R-12", "R-18", "R-24"], pagina: true },
  { tipo: "redondo", codigo: "909", nombre: "GLOBO REDONDO REFLEX ROSADO", url: "/products/globo-para-fiesta-latex-redondo-reflex-rosado", tallas: ["R-5", "R-12", "R-18", "R-24"] },
  { tipo: "redondo", codigo: "912", nombre: "GLOBO REDONDO REFLEX FUCSIA", url: "/products/globo-para-fiesta-latex-redondo-reflex-fucsia", tallas: ["R-5", "R-12", "R-18", "R-24"] },
  { tipo: "redondo", codigo: "915", nombre: "GLOBO REDONDO REFLEX CRISTAL ROJO", url: "/products/globo-para-fiesta-latex-redondo-reflex-cristal-rojo", tallas: ["R-5", "R-12", "R-18", "R-24"] },
  { tipo: "redondo", codigo: "931", nombre: "GLOBO REDONDO REFLEX VERDE LIMA", url: "/products/globo-para-fiesta-latex-redondo-reflex-verde-lima", tallas: ["R-5", "R-12"] },
  { tipo: "redondo", codigo: "932", nombre: "GLOBO REDONDO REFLEX VERDE AURORA", url: "/products/globo-para-fiesta-latex-redondo-reflex-verde-aurora", tallas: ["R-5", "R-12", "R-18", "R-24"] },
  { tipo: "redondo", codigo: "940", nombre: "GLOBO REDONDO REFLEX AZUL", url: "/products/globo-para-fiesta-latex-redondo-reflex-azul", tallas: ["R-5", "R-12", "R-18", "R-24"] },
  { tipo: "redondo", codigo: "944", nombre: "GLOBO REDONDO REFLEX AZUL GALAXY", url: "/products/globo-latex-redondo-reflex-azul-galaxy", tallas: ["R-5", "R-12", "R-18", "R-24"] },
  { tipo: "redondo", codigo: "951", nombre: "GLOBO REDONDO REFLEX VIOLETA", url: "/products/globo-para-fiesta-latex-redondo-reflex-violeta", tallas: ["R-5", "R-12"] },
  { tipo: "redondo", codigo: "968", nombre: "GLOBO REDONDO REFLEX DORADO ROSA", url: "/products/globo-para-fiesta-latex-redondo-reflex-dorado-rosa", tallas: ["R-5", "R-12", "R-18", "R-24"] },
  { tipo: "redondo", codigo: "970", nombre: "GLOBO LATEX REDONDO REFLEX DORADO", url: "/products/globo-para-fiesta-latex-redondo-reflex-dorado", tallas: ["R-5", "R-9", "R-12", "R-18", "R-24"], pagina: true },
  { tipo: "redondo", codigo: "971", nombre: "GLOBO REDONDO REFLEX CHAMPAÑA", url: "/products/globo-para-fiesta-latex-redondo-reflex-champana", tallas: ["R-5", "R-12", "R-18", "R-24"] },
  { tipo: "redondo", codigo: "981", nombre: "GLOBO LATEX REDONDO REFLEX PLATA", url: "/products/globo-para-fiesta-latex-redondo-reflex-plata", tallas: ["R-5", "R-9", "R-12", "R-18", "R-24"] },
  { tipo: "link", codigo: "005", nombre: "GLOBO LINK-O-LOON® FASHION BLANCO", url: "/products/globo-para-fiesta-latex-link-o-loon-fashion-blanco", tallas: ["LOL-6", "LOL-12", "LOL-660"] },
  { tipo: "link", codigo: "009", nombre: "GLOBO LINK-O-LOON® FASHION ROSADO", url: "/products/globo-para-fiesta-latex-link-o-loon-fashion-rosado", tallas: ["LOL-6", "LOL-12", "LOL-660"] },
  { tipo: "link", codigo: "010", nombre: "GLOBO LINK-O-LOON® FASHION PALO DE ROSA", url: "/products/globo-para-fiesta-latex-link-o-loon-fashion-palo-de-rosa", tallas: ["LOL-12"] },
  { tipo: "link", codigo: "011", nombre: "GLOBO LINK-O-LOON® FASHION ROSA", url: "/products/globo-latex-link-o-loon-r-fashion-rosa", tallas: ["LOL-6", "LOL-12"] },
  { tipo: "link", codigo: "012", nombre: "GLOBO LINK-O-LOON® FASHION FUCSIA", url: "/products/globo-para-fiesta-latex-link-o-loon-fashion-fucsia", tallas: ["LOL-6", "LOL-12", "LOL-660"] },
  { tipo: "link", codigo: "015", nombre: "GLOBO LINK-O-LOON® FASHION ROJO", url: "/products/globo-para-fiesta-latex-link-o-loon-fashion-rojo", tallas: ["LOL-6", "LOL-12", "LOL-660"] },
  { tipo: "link", codigo: "018", nombre: "GLOBO LINK-O-LOON® FASHION MERLOT", url: "/products/globo-latex-link-o-loon-fashion-merlot", tallas: ["LOL-12"] },
  { tipo: "link", codigo: "020", nombre: "GLOBO LINK-O-LOON® FASHION AMARILLO", url: "/products/globo-para-fiesta-latex-link-o-loon-fashion-amarillo", tallas: ["LOL-6", "LOL-9", "LOL-12", "LOL-660"] },
  { tipo: "link", codigo: "021", nombre: "GLOBO LINK-O-LOON® FASHION AMARILLO MIEL", url: "/products/globo-latex-link-o-loon-fashion-amarillo-miel", tallas: ["LOL-12"] },
  { tipo: "link", codigo: "027", nombre: "GLOBO LINK-O-LOON® FASHION EUCALIPTO", url: "/products/globo-para-fiesta-latex-link-o-loon-fashion-eucalipto", tallas: ["LOL-6", "LOL-12"] },
  { tipo: "link", codigo: "029", nombre: "GLOBO LINK-O-LOON® FASHION VERDE TREBOL", url: "/products/globo-latex-link-o-loon-fashion-verde-trebol", tallas: ["LOL-12"] },
  { tipo: "link", codigo: "030", nombre: "GLOBO LINK-O-LOON® FASHION VERDE", url: "/products/globo-para-fiesta-latex-link-o-loon-fashion-verde", tallas: ["LOL-6", "LOL-12", "LOL-660"] },
  { tipo: "link", codigo: "031", nombre: "GLOBO LINK-O-LOON® FASHION VERDE LIMA", url: "/products/globo-para-fiesta-latex-link-o-loon-fashion-verde-lima", tallas: ["LOL-6", "LOL-9", "LOL-12", "LOL-660"] },
  { tipo: "link", codigo: "032", nombre: "GLOBO LINK-O-LOON® FASHION VERDE SELVA", url: "/products/globo-para-fiesta-latex-link-o-loon-fashion-verde-selva", tallas: ["LOL-6", "LOL-12"] },
  { tipo: "link", codigo: "035", nombre: "GLOBO LINK-O-LOON® FASHION TURQUESA PROFUNDO", url: "/products/globo-latex-link-o-loon-fashion-turquesa-profundo", tallas: ["LOL-12"] },
  { tipo: "link", codigo: "040", nombre: "GLOBO LINK-O-LOON® FASHION AZUL", url: "/products/globo-para-fiesta-latex-link-o-loon-fashion-azul", tallas: ["LOL-6", "LOL-9", "LOL-12", "LOL-660"] },
  { tipo: "link", codigo: "041", nombre: "GLOBO LINK-O-LOON® FASHION AZUL REY", url: "/products/globo-para-fiesta-latex-link-o-loon-fashion-azul-rey", tallas: ["LOL-6", "LOL-12", "LOL-660"] },
  { tipo: "link", codigo: "051", nombre: "GLOBO LINK-O-LOON® FASHION VIOLETA", url: "/products/globo-para-fiesta-latex-link-o-loon-fashion-violeta", tallas: ["LOL-12"], pagina: true },
  { tipo: "link", codigo: "061", nombre: "GLOBO LINK-O-LOON® FASHION NARANJA", url: "/products/globo-para-fiesta-latex-link-o-loon-fashion-naranja", tallas: ["LOL-6", "LOL-12", "LOL-660"], pagina: true },
  { tipo: "link", codigo: "062", nombre: "GLOBO LINK-O-LOON® FASHION NARANJA COBRIZO", url: "/products/globo-latex-link-o-loon-fashion-naranja-cobrizo", tallas: ["LOL-12"] },
  { tipo: "link", codigo: "070", nombre: "GLOBO LINK-O-LOON® FASHION MOCA", url: "/products/globo-latex-link-o-loon-r-fashion-moca", tallas: ["LOL-12"] },
  { tipo: "link", codigo: "071", nombre: "GLOBO LINK-O-LOON® FASHION ARENA", url: "/products/globo-para-fiesta-latex-link-o-loon-fashion-arena", tallas: ["LOL-6", "LOL-12"] },
  { tipo: "link", codigo: "074", nombre: "GLOBO LINK-O-LOON® FASHION CAFÉ", url: "/products/globo-para-fiesta-latex-link-o-loon-fashion-cafe", tallas: ["LOL-12"] },
  { tipo: "link", codigo: "080", nombre: "GLOBO LINK-O-LOON® FASHION NEGRO", url: "/products/globo-para-fiesta-latex-link-o-loon-fashion-negro", tallas: ["LOL-6", "LOL-12", "LOL-660"] },
  { tipo: "link", codigo: "107", nombre: "GLOBO LINK-O-LOON® PASTEL DUSK CREMA", url: "/products/globo-latex-link-o-loon-pastel-dusk-crema", tallas: ["LOL-6", "LOL-12"] },
  { tipo: "link", codigo: "110", nombre: "GLOBO LINK-O-LOON® PASTEL DUSK ROSA", url: "/products/globo-latex-link-o-loon-pastel-dusk-rosa", tallas: ["LOL-6", "LOL-12"] },
  { tipo: "link", codigo: "140", nombre: "GLOBO LINK-O-LOON® PASTEL DUSK AZUL", url: "/products/globo-latex-link-o-loon-pastel-dusk-azul", tallas: ["LOL-6", "LOL-12"] },
  { tipo: "link", codigo: "150", nombre: "GLOBO LINK-O-LOON® PASTEL DUSK LAVANDA", url: "/products/globo-latex-link-o-loon-pastel-dusk-lavanda", tallas: ["LOL-6", "LOL-12"] },
  { tipo: "link", codigo: "390", nombre: "GLOBO LINK-O-LOON® FASHION TRANSPARENTE", url: "/products/globo-para-fiesta-latex-link-o-loon-fashion-transparente", tallas: ["LOL-6", "LOL-12", "LOL-660"] },
  { tipo: "link", codigo: "405", nombre: "GLOBO LINK-O-LOON® SATIN BLANCO", url: "/products/globo-para-fiesta-latex-link-o-loon-satin-blanco", tallas: ["LOL-12"] },
  { tipo: "link", codigo: "406", nombre: "GLOBO LINK-O-LOON® SATIN PERLA", url: "/products/globo-para-fiesta-latex-link-o-loon-satin-perla", tallas: ["LOL-6", "LOL-12"] },
  { tipo: "link", codigo: "409", nombre: "GLOBO LINK-O-LOON® SATIN ROSADO", url: "/products/globo-para-fiesta-latex-link-o-loon-satin-rosado", tallas: ["LOL-6"] },
  { tipo: "link", codigo: "440", nombre: "GLOBO LINK-O-LOON® SATIN AZUL", url: "/products/globo-para-fiesta-latex-link-o-loon-satin-azul", tallas: ["LOL-12"] },
  { tipo: "link", codigo: "481", nombre: "GLOBO LINK-O-LOON® SATIN PLATA", url: "/products/globo-para-fiesta-latex-link-o-loon-satin-plata", tallas: ["LOL-6", "LOL-12"] },
  { tipo: "link", codigo: "512", nombre: "GLOBO LINK-O-LOON® METAL FUCSIA", url: "/products/globo-para-fiesta-latex-link-o-loon-metal-fucsia", tallas: ["LOL-6", "LOL-12"] },
  { tipo: "link", codigo: "570", nombre: "GLOBO LINK-O-LOON® METAL DORADO", url: "/products/globo-para-fiesta-latex-link-o-loon-metal-dorado-cobre", tallas: ["LOL-6", "LOL-12"] },
  { tipo: "link", codigo: "609", nombre: "GLOBO LINK-O-LOON® PM ROSADO", url: "/products/globo-para-fiesta-latex-link-o-loon-pastel-mate-rosado", tallas: ["LOL-6", "LOL-12"] },
  { tipo: "link", codigo: "620", nombre: "GLOBO LINK-O-LOON® PASTEL MATE AMARILLO", url: "/products/globo-para-fiesta-latex-link-o-loon-pastel-mate-amarillo", tallas: ["LOL-6", "LOL-12"] },
  { tipo: "link", codigo: "630", nombre: "GLOBO LINK-O-LOON® PM VERDE", url: "/products/globo-para-fiesta-latex-link-o-loon-pastel-mate-verde", tallas: ["LOL-6", "LOL-12"] },
  { tipo: "link", codigo: "640", nombre: "GLOBO LINK-O-LOON® PASTEL MATE AZUL", url: "/products/globo-para-fiesta-latex-link-o-loon-pastel-mate-azul", tallas: ["LOL-6", "LOL-12"] },
  { tipo: "link", codigo: "650", nombre: "GLOBO LINK-O-LOON® PASTEL MATE LILA", url: "/products/globo-para-fiesta-latex-link-o-loon-pastel-mate-lila", tallas: ["LOL-6", "LOL-12"] },
  { tipo: "link", codigo: "661", nombre: "GLOBO LINK-O-LOON® PASTEL MATE NUDE", url: "/products/globo-latex-link-o-loon-r-pastel-mate-nude", tallas: ["LOL-6", "LOL-12"] },
  { tipo: "link", codigo: "663", nombre: "GLOBO LINK-O-LOON® PASTEL MATE MELON", url: "/products/globo-latex-link-o-loon-pastel-mate-melon", tallas: ["LOL-6", "LOL-12"] },
  { tipo: "tubito", codigo: "005", nombre: "GLOBO TUBITO FASHION BLANCO", url: "/products/globo-para-fiesta-latex-tubito-fashion-blanco", tallas: ["T-160", "T-260", "T-360"] },
  { tipo: "tubito", codigo: "009", nombre: "GLOBO TUBITO FASHION ROSADO", url: "/products/globo-para-fiesta-latex-tubito-fashion-rosado", tallas: ["T-160", "T-260", "T-360"] },
  { tipo: "tubito", codigo: "010", nombre: "GLOBO TUBITO FASHION PALO DE ROSA", url: "/products/globo-para-fiestalatex-tubito-fashion-palo-de-rosa", tallas: ["T-260"] },
  { tipo: "tubito", codigo: "011", nombre: "GLOBO TUBITO FASHION ROSA", url: "/products/globo-latex-tubito-fashion-rosa", tallas: ["T-260"] },
  { tipo: "tubito", codigo: "012", nombre: "GLOBO TUBITO FASHION FUCSIA", url: "/products/globo-para-fiesta-latex-tubito-fashion-fucsia", tallas: ["T-160", "T-260", "T-360"], pagina: true },
  { tipo: "tubito", codigo: "015", nombre: "GLOBO TUBITO FASHION ROJO", url: "/products/globo-para-fiesta-latex-tubito-fashion-rojo", tallas: ["T-160", "T-260", "T-360"] },
  { tipo: "tubito", codigo: "016", nombre: "GLOBO TUBITO FASHION ROJO IMPERIAL", url: "/products/globo-latex-tubito-fashion-rojo-imperial", tallas: ["T-260"] },
  { tipo: "tubito", codigo: "018", nombre: "GLOBO TUBITO FASHION MERLOT", url: "/products/globo-latex-tubito-fashion-merlot", tallas: ["T-260"] },
  { tipo: "tubito", codigo: "020", nombre: "GLOBO TUBITO FASHION AMARILLO", url: "/products/globo-para-fiesta-latex-tubito-fashion-amarillo", tallas: ["T-160", "T-260", "T-360"] },
  { tipo: "tubito", codigo: "021", nombre: "GLOBO TUBITO FASHION AMARILLO MIEL", url: "/products/globo-latex-tubito-fashion-amarillo-miel", tallas: ["T-260"] },
  { tipo: "tubito", codigo: "027", nombre: "GLOBO TUBITO FASHION EUCALIPTO", url: "/products/globo-para-fiesta-latex-tubito-fashion-eucalipto", tallas: ["T-160", "T-260"] },
  { tipo: "tubito", codigo: "029", nombre: "GLOBO TUBITO FASHION VERDE TREBOL", url: "/products/globo-latex-tubito-fashion-verde-trebol", tallas: ["T-260"] },
  { tipo: "tubito", codigo: "030", nombre: "GLOBO TUBITO FASHION VERDE", url: "/products/globo-para-fiesta-latex-tubito-fashion-verde", tallas: ["T-260"] },
  { tipo: "tubito", codigo: "031", nombre: "GLOBO TUBITO FASHION VERDE LIMA", url: "/products/globo-para-fiesta-latex-tubito-fashion-verde-lima", tallas: ["T-160", "T-260", "T-360"] },
  { tipo: "tubito", codigo: "032", nombre: "GLOBO TUBITO FASHION VERDE SELVA", url: "/products/globo-para-fiesta-latex-tubito-fashion-verde-selva", tallas: ["T-160", "T-260", "T-360"] },
  { tipo: "tubito", codigo: "035", nombre: "GLOBO TUBITO FASHION TURQUESA PROFUNDO", url: "/products/globo-latex-tubito-fashion-turquesa-profundo", tallas: ["T-260"] },
  { tipo: "tubito", codigo: "037", nombre: "GLOBO TUBITO FASHION AGUAMARINA", url: "/products/globo-para-fiesta-latex-tubito-fashion-aguamarina", tallas: ["T-260"] },
  { tipo: "tubito", codigo: "040", nombre: "GLOBO TUBITO FASHION AZUL", url: "/products/globo-para-fiesta-latex-tubito-fashion-azul", tallas: ["T-160", "T-260", "T-360"] },
  { tipo: "tubito", codigo: "041", nombre: "GLOBO TUBITO FASHION AZUL REY", url: "/products/globo-para-fiesta-latex-tubito-fashion-azul-rey", tallas: ["T-160", "T-260", "T-360"] },
  { tipo: "tubito", codigo: "042", nombre: "GLOBO TUBITO FASHION AZUL HORTENSIA", url: "/products/globo-latex-tubito-fashion-hortensia", tallas: ["T-260"] },
  { tipo: "tubito", codigo: "044", nombre: "GLOBO TUBITO FASHION AZUL NAVAL", url: "/products/globo-para-fiesta-latex-tubito-fashion-azul-naval", tallas: ["T-260"] },
  { tipo: "tubito", codigo: "050", nombre: "GLOBO TUBITO FASHION LILA", url: "/products/globo-para-fiesta-latex-tubito-fashion-lila", tallas: ["T-260"] },
  { tipo: "tubito", codigo: "051", nombre: "GLOBO TUBITO FASHION VIOLETA", url: "/products/globo-para-fiesta-latex-tubito-fashion-violeta", tallas: ["T-160", "T-260"] },
  { tipo: "tubito", codigo: "060", nombre: "GLOBO TUBITO FASHION DURAZNO", url: "/products/globo-para-fiesta-latex-tubito-fashion-durazno", tallas: ["T-160", "T-260", "T-360"] },
  { tipo: "tubito", codigo: "061", nombre: "GLOBO TUBITO FASHION NARANJA", url: "/products/globo-para-fiesta-latex-tubito-fashion-naranja", tallas: ["T-160", "T-260", "T-360"] },
  { tipo: "tubito", codigo: "062", nombre: "GLOBO TUBITO FASHION NARANJA COBRIZO", url: "/products/globo-latex-tubito-fashion-naranja-cobrizo", tallas: ["T-260"] },
  { tipo: "tubito", codigo: "070", nombre: "GLOBO TUBITO FASHION MOCA", url: "/products/globo-latex-tubito-fashion-moca", tallas: ["T-260"] },
  { tipo: "tubito", codigo: "071", nombre: "GLOBO TUBITO FASHION ARENA", url: "/products/globo-para-fiesta-latex-tubito-fashion-arena", tallas: ["T-160", "T-260", "T-360"] },
  { tipo: "tubito", codigo: "073", nombre: "GLOBO TUBITO FASHION LATTE", url: "/products/globo-para-fiesta-latex-tubito-fashion-latte", tallas: ["T-260"] },
  { tipo: "tubito", codigo: "074", nombre: "GLOBO TUBITO FASHION CAFÉ", url: "/products/globo-para-fiesta-latex-tubito-fashion-cafe", tallas: ["T-160", "T-260", "T-360"] },
  { tipo: "tubito", codigo: "076", nombre: "GLOBO TUBITO FASHION CHOCOLATE", url: "/products/globo-para-fiesta-latex-tubito-fashion-chocolate", tallas: ["T-160", "T-260"] },
  { tipo: "tubito", codigo: "080", nombre: "GLOBO TUBITO FASHION NEGRO", url: "/products/globo-para-fiesta-latex-tubito-fashion-negro", tallas: ["T-160", "T-260", "T-360"], pagina: true },
  { tipo: "tubito", codigo: "081", nombre: "GLOBO TUBITO FASHION GRIS", url: "/products/globo-para-fiesta-latex-tubito-fashion-gris", tallas: ["T-260"] },
  { tipo: "tubito", codigo: "107", nombre: "GLOBO TUBITO PASTEL DUSK CREMA", url: "/products/globo-para-fiesta-latex-tubito-pastel-dusk-crema", tallas: ["T-160", "T-260"] },
  { tipo: "tubito", codigo: "110", nombre: "GLOBO TUBITO PASTEL DUSK ROSA", url: "/products/globo-para-fiesta-latex-tubito-pastel-dusk-rosa", tallas: ["T-260"] },
  { tipo: "tubito", codigo: "126", nombre: "GLOBO TUBITO PASTEL DUSK TÉ VERDE", url: "/products/globo-para-fiesta-latex-tubito-pastel-dusk-te-verde", tallas: ["T-260"] },
  { tipo: "tubito", codigo: "140", nombre: "GLOBO TUBITO PASTEL DUSK AZUL", url: "/products/globo-para-fiesta-latex-tubito-pastel-dusk-azul", tallas: ["T-260"] },
  { tipo: "tubito", codigo: "150", nombre: "GLOBO TUBITO PASTEL DUSK LAVANDA", url: "/products/globo-para-fiesta-latex-tubito-pastel-dusk-lavanda", tallas: ["T-260"] },
  { tipo: "tubito", codigo: "212", nombre: "GLOBO TUBITO NEON FUCSIA", url: "/products/globo-para-fiesta-latex-tubito-neon-fucsia", tallas: ["T-260"] },
  { tipo: "tubito", codigo: "230", nombre: "GLOBO TUBITO NEON VERDE", url: "/products/globo-para-fiesta-latex-tubito-neon-verde", tallas: ["T-260"] },
  { tipo: "tubito", codigo: "240", nombre: "GLOBO TUBITO NEON AZUL", url: "/products/globo-para-fiesta-latex-tubito-neon-azul", tallas: ["T-260"] },
  { tipo: "tubito", codigo: "261", nombre: "GLOBO TUBITO NEON NARANJA", url: "/products/globo-latex-tubito-neon-naranja", tallas: ["T-260"] },
  { tipo: "tubito", codigo: "390", nombre: "GLOBO TUBITO FASHION TRANSPARENTE", url: "/products/globo-para-fiesta-latex-tubito-fashion-transparente", tallas: ["T-260", "T-360"] },
  { tipo: "tubito", codigo: "405", nombre: "GLOBO TUBITO SATIN BLANCO", url: "/products/globo-para-fiesta-latex-tubito-satin-blanco", tallas: ["T-260"] },
  { tipo: "tubito", codigo: "406", nombre: "GLOBO TUBITO SATIN PERLA", url: "/products/globo-para-fiesta-latex-tubito-satin-perla", tallas: ["T-160", "T-260"] },
  { tipo: "tubito", codigo: "409", nombre: "GLOBO TUBITO SATIN ROSADO", url: "/products/globo-para-fiesta-latex-tubito-satin-rosado", tallas: ["T-260"] },
  { tipo: "tubito", codigo: "440", nombre: "GLOBO TUBITO SATIN AZUL", url: "/products/globo-para-fiesta-latex-tubito-satin-azul", tallas: ["T-260"] },
  { tipo: "tubito", codigo: "481", nombre: "GLOBO TUBITO SATIN PLATA", url: "/products/globo-para-fiesta-latex-tubito-satin-plata", tallas: ["T-160", "T-260"] },
  { tipo: "tubito", codigo: "515", nombre: "GLOBO TUBITO METAL ROJO", url: "/products/globo-para-fiesta-latex-tubito-metal-rojo", tallas: ["T-260"] },
  { tipo: "tubito", codigo: "530", nombre: "GLOBO TUBITO METAL VERDE", url: "/products/globo-para-fiesta-latex-tubito-metal-verde", tallas: ["T-260"] },
  { tipo: "tubito", codigo: "540", nombre: "GLOBO TUBITO METAL AZUL", url: "/products/globo-para-fiesta-latex-tubito-metal-azul", tallas: ["T-260"] },
  { tipo: "tubito", codigo: "568", nombre: "GLOBO TUBITO METAL DORADO ROSA", url: "/products/globo-para-fiesta-latex-tubito-metal-dorado-rosa", tallas: ["T-260"] },
  { tipo: "tubito", codigo: "570", nombre: "GLOBO TUBITO METAL DORADO", url: "/products/globo-para-fiesta-latex-tubito-metal-dorado-cobre", tallas: ["T-160", "T-260"] },
  { tipo: "tubito", codigo: "609", nombre: "GLOBO TUBITO PASTEL MATE ROSADO", url: "/products/globo-latex-tubito-pastel-mate-rosado", tallas: ["T-260"] },
  { tipo: "tubito", codigo: "620", nombre: "GLOBO TUBITO PASTEL MATE AMARILLO", url: "/products/globo-para-fiesta-latex-tubito-pastel-mate-amarillo", tallas: ["T-260"] },
  { tipo: "tubito", codigo: "630", nombre: "GLOBO TUBITO PASTEL MATE VERDE", url: "/products/globo-para-fiesta-latex-tubito-pastel-mate-verde", tallas: ["T-260"] },
  { tipo: "tubito", codigo: "640", nombre: "GLOBO TUBITO PASTEL MATE AZUL", url: "/products/globo-latex-tubito-pastel-mate-azul", tallas: ["T-260"] },
  { tipo: "tubito", codigo: "650", nombre: "GLOBO TUBITO PASTEL MATE LILA", url: "/products/globo-para-fiesta-latex-tubito-pastel-mate-lila", tallas: ["T-260"] },
  { tipo: "tubito", codigo: "661", nombre: "GLOBO TUBITO PASTEL MATE NUDE", url: "/products/globo-latex-tubito-pastel-mate-nude", tallas: ["T-260"] },
  { tipo: "tubito", codigo: "663", nombre: "GLOBO TUBITO PASTEL MATE MELON", url: "/products/globo-para-fiesta-latex-tubito-pastel-mate-melon", tallas: ["T-260"] },
  { tipo: "tubito", codigo: "806", nombre: "GLOBO TUBITO SILK BLANCO NÁCAR", url: "/products/globo-latex-tubito-silk-blanco-nacar", tallas: ["T-260"] },
  { tipo: "tubito", codigo: "809", nombre: "GLOBO TUBITO SILK ROSA PRIMAVERAL", url: "/products/globo-latex-tubito-silk-rosa-primaveral", tallas: ["T-260"] },
  { tipo: "tubito", codigo: "839", nombre: "GLOBO TUBITO SILK AZUL ÁRTICO", url: "/products/globo-latex-tubito-silk-azul-artico", tallas: ["T-260"] },
  { tipo: "tubito", codigo: "850", nombre: "GLOBO TUBITO SILK AMATISTA", url: "/products/globo-latex-tubito-silk-amatista", tallas: ["T-260"] },
  { tipo: "tubito", codigo: "870", nombre: "GLOBO TUBITO SILK DORADO", url: "/products/globo-latex-tubito-silk-rocio-de-oro", tallas: ["T-260"] },
  { tipo: "tubito", codigo: "873", nombre: "GLOBO TUBITO SILK PERLA CREMA", url: "/products/globo-latex-tubito-silk-perla-crema", tallas: ["T-260"] },
  { tipo: "tubito", codigo: "880", nombre: "GLOBO TUBITO SILK GRIS MEDIANOCHE", url: "/products/globo-latex-tubito-silk-gris-medianoche", tallas: ["T-260"] },
  { tipo: "tubito", codigo: "909", nombre: "GLOBO TUBITO REFLEX ROSADO", url: "/products/globo-para-fiesta-latex-tubito-reflex-rosado", tallas: ["T-260"] },
  { tipo: "tubito", codigo: "912", nombre: "GLOBO TUBITO REFLEX FUCSIA", url: "/products/globo-para-fiesta-latex-tubito-reflex-fucsia", tallas: ["T-260"] },
  { tipo: "tubito", codigo: "915", nombre: "GLOBO TUBITO REFLEX CRISTAL ROJO", url: "/products/globo-para-fiesta-latex-tubito-reflex-cristal-rojo", tallas: ["T-260"] },
  { tipo: "tubito", codigo: "931", nombre: "GLOBO TUBITO REFLEX VERDE LIMA", url: "/products/globo-para-fiesta-latex-tubito-reflex-verde-lima", tallas: ["T-260"] },
  { tipo: "tubito", codigo: "932", nombre: "GLOBO TUBITO REFLEX VERDE AURORA", url: "/products/globo-para-fiesta-latex-tubito-reflex-verde-aurora", tallas: ["T-260"] },
  { tipo: "tubito", codigo: "940", nombre: "GLOBO TUBITO REFLEX AZUL", url: "/products/globo-para-fiesta-latex-tubito-reflex-azul", tallas: ["T-260"] },
  { tipo: "tubito", codigo: "944", nombre: "GLOBO TUBITO REFLEX AZUL GALAXY", url: "/products/globo-tubito-reflex-azul", tallas: ["T-260"] },
  { tipo: "tubito", codigo: "951", nombre: "GLOBO TUBITO REFLEX VIOLETA", url: "/products/globo-para-fiesta-latex-tubito-reflex-violeta", tallas: ["T-260"] },
  { tipo: "tubito", codigo: "968", nombre: "GLOBO TUBITO REFLEX DORADO ROSA", url: "/products/globo-para-fiesta-latex-tubito-reflex-dorado-rosa", tallas: ["T-260"] },
  { tipo: "tubito", codigo: "970", nombre: "GLOBO TUBITO REFLEX DORADO", url: "/products/globo-para-fiesta-latex-tubito-reflex-dorado", tallas: ["T-260"], pagina: true },
  { tipo: "tubito", codigo: "971", nombre: "GLOBO TUBITO REFLEX CHAMPAÑA", url: "/products/globo-para-fiesta-latex-tubito-reflex-champana", tallas: ["T-260"] },
  { tipo: "tubito", codigo: "981", nombre: "GLOBO TUBITO REFLEX PLATA", url: "/products/globo-para-fiesta-latex-tubito-reflex-plata", tallas: ["T-260"] },
  { tipo: "corazon", codigo: "005", nombre: "GLOBO CORAZON FASHION BLANCO", url: "/products/globo-para-fiesta-latex-corazon-fashion-blanco", tallas: ["C-6", "C-12"] },
  { tipo: "corazon", codigo: "009", nombre: "GLOBO CORAZON FASHION ROSADO", url: "/products/globo-para-fiesta-latex-corazon-fashion-rosado", tallas: ["C-6", "C-12"] },
  { tipo: "corazon", codigo: "015", nombre: "GLOBO CORAZON FASHION ROJO", url: "/products/globo-para-fiesta-latex-corazon-fashion-rojo", tallas: ["C-6", "C-12"] },
  { tipo: "corazon", codigo: "390", nombre: "GLOBO CORAZON FASHION TRANSPARENTE", url: "/products/globo-para-fiesta-latex-corazon-fashion-transparente", tallas: ["C-12"] },
];

/** Combinaciones que la tabla oficial dice que se fabrican pero que el listado de la tienda no trae (2026-10-07). */
export const NO_ESTAN_EN_LA_TIENDA: ReadonlyArray<{ tipo: TipoGlobo; codigo: string; esperado: string }> = [
  { tipo: "corazon", codigo: "012", esperado: "GLOBO CORAZON FASHION FUCSIA" },
  { tipo: "tubito", codigo: "023", esperado: "GLOBO TUBITO FASHION MOSTAZA" },
  { tipo: "tubito", codigo: "038", esperado: "GLOBO TUBITO FASHION AZUL CARIBE" },
  { tipo: "link", codigo: "042", esperado: "GLOBO LINK-O-LOON FASHION AZUL HORTENSIA" },
  { tipo: "link", codigo: "050", esperado: "GLOBO LINK-O-LOON FASHION LILA" },
  { tipo: "link", codigo: "060", esperado: "GLOBO LINK-O-LOON FASHION DURAZNO" },
  { tipo: "tubito", codigo: "826", esperado: "GLOBO TUBITO SILK VERDE MENTA" },
  { tipo: "tubito", codigo: "220", esperado: "GLOBO TUBITO NEON AMARILLO" },
  { tipo: "link", codigo: "970", esperado: "GLOBO LINK-O-LOON REFLEX DORADO" },
];

/** Fecha del cruce con la tienda. */
export const REVISADO_TIENDA = "2026-10-07";

/** Cómo quedó comprobado el producto de un globo. */
export type EstadoProducto = "verificado" | "sin verificar";

/**
 * El producto de la tienda para un globo de ese formato y color. `estado` «verificado»: está en el listado de la tienda
 * (y `tallaEnTienda` dice si esa talla es una de sus variantes). «sin verificar»: no se encontró; `nombre` es el que
 * tendría y `url` una búsqueda en la tienda.
 */
export type ProductoDeGlobo = { nombre: string; url: string; estado: EstadoProducto; tallaEnTienda: boolean; paginaComprobada: boolean };

const PALABRA_TIPO: Readonly<Record<TipoGlobo, string>> = { redondo: "REDONDO", link: "LINK-O-LOON®", tubito: "TUBITO", corazon: "CORAZON" };
const PALABRA_FAMILIA: Readonly<Record<string, string>> = { fashion: "FASHION", reflex: "REFLEX", silk: "SILK", pastelMate: "PASTEL MATE", satin: "SATIN", metal: "METAL", pastelDusk: "PASTEL DUSK", neon: "NEON", cristal: "FASHION" };

const POR_CLAVE = new Map(GLOBOS_TIENDA.map((p) => [`${p.tipo}|${p.codigo}`, p]));

/** El nombre que tendría en la tienda (para lo que no está): «GLOBO TUBITO FASHION MOSTAZA». */
export function nombreEsperado(tipo: TipoGlobo, codigo: string): string {
  const ref = referenciaPorCodigo(codigo);
  if (!ref) return `GLOBO ${PALABRA_TIPO[tipo]} ${codigo}`;
  const color = codigo === "390" ? "TRANSPARENTE" : ref.nombre.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
  return `GLOBO ${PALABRA_TIPO[tipo]} ${PALABRA_FAMILIA[ref.familia] ?? ref.familia.toUpperCase()} ${color}`;
}

/** El producto de la tienda para un globo (formato del taller + código de color). */
export function productoDeGlobo(formatoId: string, codigo: string): ProductoDeGlobo {
  const tipo = formatoPorId(formatoId)?.tipo ?? "redondo";
  const p = POR_CLAVE.get(`${tipo}|${codigo}`);
  if (p) return { nombre: p.nombre, url: urlTienda(p.url), estado: "verificado", tallaEnTienda: p.tallas.includes(formatoId), paginaComprobada: Boolean(p.pagina) };
  const nombre = nombreEsperado(tipo, codigo);
  return { nombre, url: urlTienda(`/search?q=${encodeURIComponent(nombre.replace("®", ""))}`), estado: "sin verificar", tallaEnTienda: false, paginaComprobada: false };
}
