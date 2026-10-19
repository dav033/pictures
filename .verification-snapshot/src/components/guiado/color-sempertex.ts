import { tonoCliente } from "@/lib/plan/presentacion-cliente";
import { referenciaDelCatalogo, referenciaDelTitulo, type ReferenciaSempertex } from "@/lib/plan/referencia-sempertex";
import { esGloboDelTono, referenciaDeTono, tonoDelTitulo } from "@/lib/plan/tonos-color";
import { HEX_COLORES_V2, plegarTexto, tonoClaroDe, TONOS_V2, type TonoClaroV2 } from "@/lib/rag/taxonomy/v2";
import { familiaSempertex } from "./color-globo";
import { colorCliente, conMayuscula } from "./formato";

/**
 * LA fuente única del nombre y el tono de un color en la vista guiada: el nombre que se le dice al cliente y el hex
 * de la referencia del catálogo Sempertex que se compra. La usan la propuesta, la cabecera y los chips de «Tu plan»,
 * la tabla, la leyenda del editor («Modificar pieza»), «Ajustar mi plan» y los materiales de la cotización.
 *
 * Por qué existe (probador, 2026-10-06): el mismo globo se llamaba y se pintaba distinto según dónde se mirara. «Azul»
 * (Fashion Azul 040, un azul claro) salía azul rey en la propuesta y en «Ajustar mi plan» (paleta de la taxonomía),
 * celeste en los chips y la tabla (catálogo) y cian en la foto de materiales; tras editar, «Verde» era «Fashion Verde
 * Lima» en la tarjeta y «Verde lima mate» en el editor; y la plata de una foto era «Reflex Plata», «Plateado cromado»
 * y «Globo reflex plata cromado de 12"». Ahora:
 *  - nombre: el tono Sempertex en palabras de cliente, con el acabado solo cuando se sabe y no es el liso de siempre:
 *    «Azul», «Verde lima», «Plata cromado», «Rosa pastel»;
 *  - hex: el `hexTinta` de esa referencia (el mismo con que pinta el motor); sin referencia, la paleta;
 *  - producto: «Fashion Verde Lima», «Reflex Plata» (para el detalle o un `title`), o null.
 * Pura: sin React.
 */

export type ColorSempertex = {
  /** «Verde lima», «Plata cromado»: lo que lee el cliente, con mayúscula inicial. */
  nombre: string;
  /** `#rrggbb` de la referencia Sempertex (o de la paleta si no hay referencia). */
  hex: string;
  /** El globo tal como se pide en Sempertex («Reflex Plata»), o null si no se sabe cuál es. */
  producto: string | null;
};

const GRIS = "#9ca3af";

/** La palabra de la paleta y el nombre con que el catálogo la tiene («plateado» → «plata»). */
const ALIAS_CATALOGO: Readonly<Record<string, string>> = {
  plateado: "plata", rosado: "rosa", "dorado rosa": "oro rosa", champagne: "champaña", burdeos: "vino", cafe: "café",
};

/** El acabado de una familia dicho al cliente; la Fashion es el liso de siempre y no se nombra. */
const ACABADO_FAMILIA: Readonly<Record<string, string>> = {
  reflex: "cromado", metal: "metalizado", silk: "perlado", satin: "satinado", pastelMate: "pastel", pastelDusk: "pastel", neon: "neón",
};

const NOMBRE_FAMILIA: Readonly<Record<string, string>> = {
  fashion: "Fashion", reflex: "Reflex", metal: "Metal", silk: "Silk", satin: "Satín", pastelMate: "Pastel Matte", pastelDusk: "Pastel Dusk", neon: "Neón", cristal: "Crystal",
};

const PERLADO_EN_NOMBRE = /\b(?:nacar|perla|perlado)\b/;

function plegar(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("es").replace(/\s+/g, " ").trim();
}

/**
 * «Verde Lima» + reflex → «Verde lima cromado»; «Rosa» pastel → «Rosa pastel»; «Azul» Fashion → «Azul». El acabado
 * solo se nombra si se sabe (título o acabado del plan): una propuesta en «dorado» todavía no eligió entre Reflex y Silk.
 */
function nombreDeReferencia(referencia: ReferenciaSempertex, conAcabado: boolean): string {
  const base = conMayuscula(referencia.nombre.toLocaleLowerCase("es"));
  const acabado = conAcabado ? ACABADO_FAMILIA[referencia.familia] : undefined;
  if (!acabado) return base;
  const yaLoDice = plegar(base).includes(plegar(acabado)) || (acabado === "perlado" && PERLADO_EN_NOMBRE.test(plegar(base)));
  return yaLoDice ? base : `${base} ${acabado}`;
}

function productoDeReferencia(referencia: ReferenciaSempertex): string {
  const familia = NOMBRE_FAMILIA[referencia.familia];
  return familia ? `${familia} ${referencia.nombre}` : referencia.nombre;
}

/** La palabra de familia que entiende el catálogo, sacada del título o del acabado («Reflex Plata» → «reflex»). */
function familiaDe(titulo: string | null, acabado: string | null): string | null {
  const familia = familiaSempertex(titulo) ?? familiaSempertex(acabado);
  if (familia) return plegar(familia.nombre);
  return acabado ? plegar(acabado) : null;
}

/** La referencia que se compra para un color del plan: la que dice el título; si no, la del tono; si no, la del alias. */
export function referenciaDeColor(color: string, opciones: { titulo?: string | null; acabado?: string | null } = {}): ReferenciaSempertex | null {
  const titulo = opciones.titulo?.trim() || null;
  const familia = familiaDe(titulo, opciones.acabado?.trim() || null);
  const limpio = plegar(color);
  const delTitulo = titulo ? referenciaDelTitulo(titulo, familia) : null;
  if (delTitulo) return delTitulo;
  if (!limpio || limpio.startsWith("#")) return null;
  const tono = titulo ? tonoCliente(limpio, titulo) : limpio;
  const alias = ALIAS_CATALOGO[limpio];
  return referenciaDelCatalogo(tono, familia)
    ?? referenciaDelCatalogo(limpio, familia)
    ?? (alias ? referenciaDelCatalogo(alias, familia) : null);
}

/**
 * Los tonos claros de la taxonomía (`TONOS_V2`, probador 2026-10-07: «celeste no existe»). Un color «celeste» de la
 * propuesta se llama «Celeste» y se pinta con su referencia Sempertex (la 040, azul claro; con acabado pastel, la 640),
 * no gris ni azul rey. Un globo cuyo título dice un tono que la lámina no nombra («FASHION AZUL CELESTE», guardado
 * como «azul») se llama «Celeste» y su producto es «Fashion Azul Celeste», no «Azul» / «Fashion Azul». Null si no es tono.
 */
function colorDeTono(crudo: string, opciones: { titulo?: string | null; acabado?: string | null }, conAcabado: boolean): ColorSempertex | null {
  const titulo = opciones.titulo?.trim() || null;
  const delTitulo = titulo ? tonoDelTitulo(titulo) : null;
  const pedido = tonoClaroDe(crudo);
  // Un «celeste» con el título de un globo que no es de ese tono (lo eligió otro): manda el globo que se compra.
  if (!delTitulo && (!pedido || (titulo && !esGloboDelTono(titulo, pedido)))) return null;
  const tono: TonoClaroV2 = delTitulo ?? pedido!;
  const familia = TONOS_V2[tono].familia;
  const referencia = (titulo ? referenciaDeColor(familia, opciones) : null)
    ?? delTonoConAcabado(tono, opciones.acabado ?? null)
    ?? referenciaDeTono(tono);
  const acabado = conAcabado && referencia ? ACABADO_FAMILIA[referencia.familia] : undefined;
  const nombre = acabado && !plegar(TONOS_V2[tono].nombre).includes(plegar(acabado)) ? `${TONOS_V2[tono].nombre} ${acabado}` : TONOS_V2[tono].nombre;
  let producto: string | null = null;
  if (conAcabado && referencia) {
    const base = productoDeReferencia(referencia);
    const palabra = titulo ? TONOS_V2[tono].titulo.find((candidata) => ` ${plegarTexto(titulo)} `.includes(` ${candidata} `)) : undefined;
    producto = palabra && !plegar(base).split(" ").includes(palabra) ? `${base} ${conMayuscula(palabra)}` : base;
  }
  return { nombre, hex: referencia?.hexTinta ?? TONOS_V2[tono].hex, producto };
}

/** «celeste» con acabado «pastel» → la 640 (Pastel Mate Azul); solo si esa referencia es del tono. */
function delTonoConAcabado(tono: TonoClaroV2, acabado: string | null): ReferenciaSempertex | null {
  if (!acabado?.trim()) return null;
  const referencia = referenciaDelCatalogo(TONOS_V2[tono].familia, plegar(acabado));
  return referencia && TONOS_V2[tono].basesSempertex.includes(referencia.nombreBase) ? referencia : null;
}

/**
 * El nombre, el tono y el producto Sempertex de un color del plan («azul», «plateado» o un `#rrggbb`), con el título
 * del producto que se compra y su acabado si se conocen.
 */
export function colorSempertex(color: string, opciones: { titulo?: string | null; acabado?: string | null } = {}): ColorSempertex {
  const crudo = color.trim();
  if (/^#[0-9a-f]{6}$/i.test(crudo)) return { nombre: crudo, hex: crudo.toLowerCase(), producto: null };
  const conAcabado = Boolean(opciones.titulo?.trim() || opciones.acabado?.trim());
  const tonal = colorDeTono(crudo, opciones, conAcabado);
  if (tonal) return tonal;
  const referencia = referenciaDeColor(crudo, opciones);
  if (referencia) return { nombre: nombreDeReferencia(referencia, conAcabado), hex: referencia.hexTinta, producto: conAcabado ? productoDeReferencia(referencia) : null };
  const paleta = HEX_COLORES_V2[plegar(crudo) as keyof typeof HEX_COLORES_V2];
  return { nombre: conMayuscula(colorCliente(crudo) || "Otro color"), hex: paleta ?? GRIS, producto: null };
}
