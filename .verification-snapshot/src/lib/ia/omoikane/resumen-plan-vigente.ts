import type { BasePlan } from "@/lib/plan/edicion-esquemas";
import { UBICACIONES } from "@/lib/plan/composicion";
import { identificarEstructuraOficial } from "@/lib/plan/estructuras-oficiales";
import {
  acabadoCliente,
  cantidadCliente,
  describirEstructuraCliente,
  medidasCliente,
  nombreColorCliente,
  productoCliente,
  pulgadasCliente,
  tamanosCliente,
} from "@/lib/plan/presentacion-cliente";

/**
 * What the chat model is told about the proposal the customer has on screen
 * (§7 "editar una propuesta desde el chat").
 *
 * Without it `ajustar_plan_decoracion` was a tool with nothing to point at: the
 * model never saw an `estructura_id` or a `variant_id`, so "cambia el azul por
 * rojo" could only be answered by a guess. This module turns the verified plan
 * into compact Spanish text — each piece as the customer is told about it, plus
 * the identifiers the tool arguments need — and the short rules for using it.
 *
 * Pure and deterministic: no I/O, no clock, no randomness. It READS the plan, it
 * never computes a count, a share or a price (Python owns those; a figure printed
 * here is the one the card already shows).
 *
 * Safety:
 * - Only the fields below are read. The approval token, its signature and the
 *   `plan_hash` are never touched, so they cannot leak into a prompt.
 * - The echoed `estructuras` come from the browser (only the token is verified,
 *   and `aplicarEdicionPlan` re-resolves the plan before editing), so every text
 *   is sanitized (one line, no control characters, bounded) and every identifier
 *   must look like one. A forged title cannot start a new instruction line, and a
 *   forged id can only make an edit fail: Python checks it against the plan it
 *   resolved itself.
 * - The size is bounded; what does not fit is dropped line by line, never cut in
 *   the middle of an identifier, and the text says so.
 */

/** Budget of the description of the proposal (the fixed rules block comes on top). */
export const MAX_CARACTERES_RESUMEN_PLAN = 6000;

const MAX_ESTRUCTURAS = 12;
const MAX_LINEAS_POR_ESTRUCTURA = 40;

type Objeto = Record<string, unknown>;

function esObjeto(valor: unknown): valor is Objeto {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

/** One line, no control or format characters, no quotes that could close a quoted value, bounded. */
function limpiar(valor: unknown, maximo: number): string | null {
  if (typeof valor !== "string") return null;
  const texto = valor
    .normalize("NFKC")
    .replace(/[\p{C}\p{Zl}\p{Zp}]/gu, " ")
    .replace(/[`"\\<>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!texto) return null;
  const caracteres = [...texto];
  return caracteres.length > maximo ? `${caracteres.slice(0, maximo - 1).join("").trimEnd()}…` : texto;
}

/** An identifier of the plan or the catalog: letters, digits and a few separators, never a sentence. */
function leerId(valor: unknown): string | null {
  return typeof valor === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,159}$/.test(valor) ? valor : null;
}

function leerNumero(valor: unknown): number | null {
  return typeof valor === "number" && Number.isFinite(valor) ? valor : null;
}

function leerRepeticiones(valor: unknown): number {
  const numero = leerNumero(valor);
  return numero !== null && Number.isInteger(numero) && numero >= 1 && numero <= 24 ? numero : 1;
}

type Linea = {
  variantId: string;
  productId: string;
  titulo: string | null;
  tamano: string | null;
  color: string | null;
  acabado: string | null;
  unidades: number | null;
  forma: string | null;
};

function leerLinea(valor: unknown): Linea | null {
  if (!esObjeto(valor)) return null;
  const variantId = leerId(valor.variant_id);
  const productId = leerId(valor.product_id);
  if (!variantId || !productId) return null;
  const tituloCrudo = limpiar(valor.titulo, 120);
  const codigo = limpiar(valor.tamano_codigo, 20);
  const diametro = leerNumero(valor.diam_pulg);
  const color = limpiar(valor.color, 40);
  const unidades = leerNumero(valor.unidades);
  return {
    variantId,
    productId,
    titulo: tituloCrudo ? limpiar(productoCliente(tituloCrudo), 70) : null,
    tamano: codigo ? pulgadasCliente(codigo) : diametro !== null ? `${diametro} pulgadas` : null,
    color: color ? nombreColorCliente(color) : null,
    acabado: acabadoCliente(limpiar(valor.acabado, 30), tituloCrudo ?? undefined),
    unidades: unidades !== null && unidades >= 0 ? unidades : null,
    forma: limpiar(valor.forma, 20),
  };
}

type Material = { productId: string | null; variantId: string | null; color: string | null; participacion: number | null };

function leerMateriales(declarada: unknown): Material[] {
  if (!esObjeto(declarada) || !Array.isArray(declarada.materiales)) return [];
  return declarada.materiales.filter(esObjeto).slice(0, 6).map((material) => {
    const color = limpiar(material.color, 40);
    const participacion = leerNumero(material.participacion);
    return {
      productId: leerId(material.product_id),
      variantId: leerId(material.variant_id),
      color: color ? nombreColorCliente(color) : null,
      participacion: participacion !== null && participacion > 0 && participacion <= 1 ? participacion : null,
    };
  });
}

/** Which declared material a purchased line belongs to; null when it is not unambiguous. */
function materialDeLaLinea(linea: Linea, materiales: readonly Material[]): number | null {
  let candidatos = materiales.flatMap((material, indice) => (material.productId === linea.productId ? [indice] : []));
  if (candidatos.length > 1) {
    const porVariante = candidatos.filter((indice) => materiales[indice]!.variantId === linea.variantId);
    if (porVariante.length > 0) candidatos = porVariante;
  }
  if (candidatos.length > 1 && linea.color) {
    const porColor = candidatos.filter((indice) => materiales[indice]!.color === linea.color);
    if (porColor.length > 0) candidatos = porColor;
  }
  return candidatos.length === 1 ? candidatos[0]! : null;
}

function porcentaje(participacion: number): string {
  return `${Math.round(participacion * 100)} %`;
}

const FORMATO_COP = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });

type EstructuraDescrita = { encabezado: string; lineas: string[] };

function describirEstructura(valor: unknown, numero: number, declarada: unknown): EstructuraDescrita | null {
  if (!esObjeto(valor)) return null;
  const estructuraId = leerId(valor.estructura_id);
  if (!estructuraId) return null;
  const declaradaObjeto = esObjeto(declarada) ? declarada : {};
  const nombre = limpiar(valor.nombre, 60);
  const tipo = limpiar(valor.tipo, 30) ?? "pieza";
  const ubicacionCruda = typeof valor.ubicacion === "string" ? valor.ubicacion : "";
  const ubicacionValida = (UBICACIONES as readonly string[]).includes(ubicacionCruda);
  const repeticiones = leerRepeticiones(valor.repeticiones);
  const lineas = (Array.isArray(valor.lineas) ? valor.lineas : []).map(leerLinea).filter((linea): linea is Linea => linea !== null);

  // The customer's own words for the piece ("la columna a la izquierda"), the way the card names it.
  const oficial = identificarEstructuraOficial({
    tipo,
    densidad: limpiar(declaradaObjeto.densidad, 20) ?? undefined,
    ubicacion: ubicacionValida ? ubicacionCruda : undefined,
    nombre: nombre ?? undefined,
    estructura_oficial: limpiar(declaradaObjeto.estructura_oficial, 40) ?? undefined,
  });
  const comoSeLeDice = ubicacionValida && nombre
    ? describirEstructuraCliente({ oficialId: oficial?.id, nombre, ubicacion: ubicacionCruda, repeticiones }, "definido")
    : nombre ?? "una pieza";

  const medidas = esObjeto(declaradaObjeto.medidas)
    ? medidasCliente(tipo, {
        ...(leerNumero(declaradaObjeto.medidas.ancho_m) !== null ? { ancho_m: leerNumero(declaradaObjeto.medidas.ancho_m)! } : {}),
        ...(leerNumero(declaradaObjeto.medidas.alto_m) !== null ? { alto_m: leerNumero(declaradaObjeto.medidas.alto_m)! } : {}),
        ...(leerNumero(declaradaObjeto.medidas.largo_m) !== null ? { largo_m: leerNumero(declaradaObjeto.medidas.largo_m)! } : {}),
      })
    : null;
  const total = leerNumero(valor.total_unidades);
  const cantidad = total !== null && total >= 0
    ? cantidadCliente(total, repeticiones, { tipo, lineas: lineas.map((linea) => ({ titulo: linea.titulo ?? "", forma: linea.forma })) })
    : null;
  const mezclaReal = Array.isArray(valor.mezcla_real)
    ? valor.mezcla_real.filter(esObjeto).flatMap((fila) => (leerNumero(fila.diam_pulg) !== null ? [{ diam_pulg: leerNumero(fila.diam_pulg)! }] : []))
    : [];
  const tamanos = tamanosCliente(mezclaReal);
  const mezclaActual = limpiar(declaradaObjeto.mezcla, 20);

  const materiales = leerMateriales(declaradaObjeto);
  const reparto = materiales.length >= 2
    ? materiales.map((material, indice) => {
        const color = material.color
          ?? lineas.find((linea) => linea.productId === material.productId)?.color
          ?? "color sin nombre";
        return `${indice + 1}) ${color}${material.participacion !== null ? ` ${porcentaje(material.participacion)}` : ""}`;
      }).join(", ")
    : null;

  const encabezado = [
    `${numero}. ${comoSeLeDice}${nombre && nombre.toLowerCase() !== comoSeLeDice.toLowerCase() ? ` (nombre en el plan: "${nombre}")` : ""}`,
    `estructura_id=${estructuraId}`,
    `tipo ${tipo}`,
    ...(repeticiones > 1 ? [`${repeticiones} iguales: un cambio en esta estructura se aplica a todas`] : []),
    ...(medidas ? [medidas] : []),
    ...(cantidad ? [cantidad] : []),
    ...(tamanos ? [tamanos] : []),
    ...(mezclaActual ? [`mezcla de tamaños actual ${mezclaActual}`] : []),
  ].join(" — ") + (reparto ? `\n   Reparto de colores (en este orden se manda «repartir»): ${reparto}` : "");

  const lineasTexto = lineas.slice(0, MAX_LINEAS_POR_ESTRUCTURA).map((linea) => {
    const material = materialDeLaLinea(linea, materiales);
    const partes = [
      `variant_id=${linea.variantId} product_id=${linea.productId}`,
      ...(linea.titulo ? [linea.titulo] : []),
      ...(linea.tamano ? [linea.tamano] : []),
      ...(linea.color ? [`${linea.color}${linea.acabado ? ` ${linea.acabado}` : ""}`] : linea.acabado ? [linea.acabado] : []),
      ...(linea.unidades !== null ? [`${linea.unidades} u`] : []),
      ...(material !== null ? [`material ${material + 1}${materiales[material]!.participacion !== null ? ` (${porcentaje(materiales[material]!.participacion!)})` : ""}`] : []),
    ];
    return `   - ${partes.join(" | ")}`;
  });
  return { encabezado, lineas: lineasTexto };
}

function marcadorLineasOmitidas(omitidas: number): string {
  return `   …y ${omitidas} ${omitidas === 1 ? "línea más" : "líneas más"} de esta estructura que no se listan aquí; si el cliente se refiere a una de ellas, pregúntale cuál.`;
}

/**
 * The proposal on screen as text for the model: per structure its identifier, how
 * the customer calls it, its measures, how colors are shared and every purchased
 * line (`variant_id`, `product_id`, short title, size, color, units, share of its
 * material). At most `maximo` characters.
 */
export function describirPlanVigente(base: BasePlan, maximo: number = MAX_CARACTERES_RESUMEN_PLAN): string {
  const declaradas = new Map<string, unknown>(base.plan.estructuras.map((estructura) => [estructura.estructura_id, estructura]));
  const todas = base.estructuras.map((estructura, indice) => describirEstructura(estructura, indice + 1, declaradas.get(estructura.estructura_id)));
  const legibles = todas.filter((estructura): estructura is EstructuraDescrita => estructura !== null);
  const estructuras = legibles.slice(0, MAX_ESTRUCTURAS);
  const sinListar = todas.length - estructuras.length;

  // `totales` travels with the echoed plan (passthrough); it is shown as the card shows it, never recomputed.
  const totales: unknown = base.totales;
  const total = esObjeto(totales) ? leerNumero(totales.total_cop) : null;
  const entrada = [
    "Estructuras de la propuesta en pantalla (cada línea es un material comprado):",
  ];
  const cierre = [
    ...(sinListar > 0 ? [`…y ${sinListar} ${sinListar === 1 ? "estructura más" : "estructuras más"} que no se listan aquí.`] : []),
    ...(total !== null && total >= 0 ? [`Total que muestra la tarjeta ahora: ${FORMATO_COP.format(Math.round(total))} (solo informativo; tras un cambio, el que devuelva la herramienta).`] : []),
  ];

  // The headers always fit; lines share what is left, one per structure at a time so
  // that no structure is the one left without any line when the budget is short.
  const tamanoFijo = [...entrada, ...cierre, ...estructuras.map((estructura) => estructura.encabezado)].join("\n").length
    + estructuras.length * (marcadorLineasOmitidas(999).length + 1);
  let disponible = maximo - tamanoFijo;
  const incluidas = estructuras.map(() => 0);
  let avanzo = true;
  while (avanzo) {
    avanzo = false;
    for (const [indice, estructura] of estructuras.entries()) {
      const siguiente = estructura.lineas[incluidas[indice]!];
      if (siguiente === undefined || siguiente.length + 1 > disponible) continue;
      disponible -= siguiente.length + 1;
      incluidas[indice] = incluidas[indice]! + 1;
      avanzo = true;
    }
  }

  const cuerpo = estructuras.flatMap((estructura, indice) => {
    const omitidas = estructura.lineas.length - incluidas[indice]!;
    return [estructura.encabezado, ...estructura.lineas.slice(0, incluidas[indice]), ...(omitidas > 0 ? [marcadorLineasOmitidas(omitidas)] : [])];
  });
  const texto = [...entrada, ...cuerpo, ...cierre].join("\n");
  if (texto.length <= maximo) return texto;
  // Last resort (an absurdly long header): cut at a line boundary, never inside an identifier.
  const corte = texto.lastIndexOf("\n", maximo - 40);
  return `${texto.slice(0, corte > 0 ? corte : 0)}\n…resumen recortado por tamaño.`;
}

/**
 * Rules for editing what the customer already saw. Appended at the very end of
 * the system prompt, after the frozen reference text and the brief, so it never
 * changes the cached prefix of the prompt (src/lib/ia/omoikane/prompt-sistema.ts
 * stays byte for byte as it was).
 */
export const REGLAS_EDICION_PROPUESTA_VIGENTE = `Reglas para cambiar lo que el cliente ya ve:
- Para cualquier cambio sobre esta propuesta ("cambia el azul por rojo", "quita las servilletas", "agrégale dorado", "que el rosado sea el protagonista", "globos más grandes") usa ajustar_plan_decoracion. No llames confirmar_plan_decoracion a menos que el cliente pida un diseño distinto desde cero, y no rediseñes lo que no pidió cambiar.
- Resuelve lo que dice el cliente ("la columna de la izquierda", "los globos azules", "el más grande", "el arco") contra la lista de arriba. Los identificadores (estructura_id, variant_id, product_id) son solo para llenar los argumentos: nunca se los digas al cliente.
- Si es ambiguo (varias columnas y no dijo cuál, dos tonos de azul distintos, "el más grande" con empate), haz UNA sola pregunta corta, con las opciones dichas con palabras, y no llames la herramienta todavía. Si pidió "todo" o "en todas", aplícalo a cada estructura y línea que lo tenga, con varias ediciones en una sola llamada.
- Cada edición cambia UNA línea por UNA variante. Si un color tiene varios tamaños en una estructura (varias líneas), reemplaza cada línea por la variante del mismo tamaño.
- Para un material nuevo busca primero con buscar_catalogo_rag (una consulta de un solo color, por ejemplo "globo latex redondo rojo") y usa EXACTAMENTE el product_id y variant_id que devolvió esa búsqueda, nunca uno de la lista de arriba ni de memoria. Si no hay en ese color, dilo con honestidad y ofrece lo más cercano que sí apareció.
- Para repartir los colores manda un número por material en el orden del reparto de esa estructura, sumando 1. Para el tamaño de los globos usa mezcla, un escalón a la vez. Nunca mandes precios ni cantidades de globos: los calcula el sistema.
- El patrón de color y el armado de arcos, columnas y guirnaldas no se cambian por aquí: dile que lo ajuste desde la propuesta en pantalla.
- Al terminar, di en una frase qué cambiaste y el nuevo total que devolvió la herramienta (total_cop), sin inventar cifras. Si la herramienta rechaza el cambio, explícale el motivo con su mensaje_cliente y no digas que ya lo hiciste.`;

/** The block appended to the system prompt of a turn that has a verified proposal. */
export function bloquePropuestaVigente(base: BasePlan): string {
  return `

PROPUESTA VIGENTE EN PANTALLA (verificada en este turno; es lo que el cliente está viendo ahora)
Los identificadores de esta lista son datos internos solo para ti.
${describirPlanVigente(base)}

${REGLAS_EDICION_PROPUESTA_VIGENTE}`;
}

/**
 * The system prompt of one turn. With a proposal that `planVigenteDelTurno`
 * verified, its description goes at the end; without one (nothing echoed, an
 * invalid or expired token) the prompt is returned untouched.
 */
export function sistemaConPropuestaVigente(sistema: string, planVigente: { base: BasePlan } | undefined): string {
  return planVigente ? sistema + bloquePropuestaVigente(planVigente.base) : sistema;
}
