import type { z } from "zod";
import { PlanActualGuiadoSchema, type PlanActualGuiado, type PropuestaComposicionSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
import { ESTRUCTURAS_OFICIALES, ESTRUCTURAS_OFICIALES_IDS, type EstructuraOficialId } from "@/lib/plan/estructuras-oficiales";
import { ladoDeUbicacion, lineaPareja, MAX_PIEZAS_PLAN, parejasDePropuesta, piezasIndividualesDePropuesta, recortarCantidades, type Lateral, type PiezaIndividual } from "@/lib/plan/piezas-individuales";
import { CREATIVIDAD_POR_DEFECTO } from "@/lib/ia/escena/creatividad";
import { coloresFotoFaltantes, type ColorFotoFaltante } from "@/lib/plan/colores-foto-plan";
import { tonoClaroDe } from "@/lib/rag/taxonomy/v2";
import { generarPasosPlan } from "./generar-pasos-plan";
import { listaNatural, piezaEnPalabras } from "./propuesta-composicion";
import { briefChatCliente, lineaPalabrasCliente, type ContextoClienteGuiado } from "./contexto-cliente";

/**
 * Instrucciones y resúmenes con los que la vista guiada pide el plan a /api/chat y lo deja en el historial.
 * Importable desde el cliente: sin «server-only», núcleo de IA ni adaptador de Python.
 */

type PropuestaGuiada = z.infer<typeof PropuestaComposicionSchema>;

/** Piezas que solo se ven orgánicas si mezclan tamaños: sin la orden explícita el plan salía todo en 12". */
export const ESTRUCTURAS_ORGANICAS: ReadonlySet<EstructuraOficialId> = new Set<EstructuraOficialId>([
  "arco_asimetrico", "semiarco_asimetrico", "columna_asimetrica", "pared_organica", "guirnalda", "racimo_pared",
]);

/** Lo que no es un globo liso (impresos, Infinity, dos caras, balones, frases) no va en una pieza del plan guiado. */
const GLOBO_NO_LISO = /impres|estampad|2 caras|dos caras|feliz|cumplea|happy|birthday|infinity|bal[oó]n|f[uú]tbol|\bcopa\b/i;

/** Orden de globos lisos. Sin la palabra «látex»: en el texto del cliente bloquea la categoría en la búsqueda del catálogo. */
const SOLO_LISOS = "Usa solo globos lisos de un solo color: nada estampado, impreso ni con dibujos, letras, números o frases.";

const REINTENTO = 'El intento anterior no sirvió: busca cada color en los tamaños que existan (5", 12", 18"), solo globos lisos de un solo color, incluye TODOS los colores pedidos y usa solo variantes con cobertura antes de confirmar.';

/** Materiales que admite una pieza del plan (`EstructuraPlanSchema.materiales.max(6)`). */
const MAX_MATERIALES_PIEZA = 6;

function nombreOficial(estructura: EstructuraOficialId): string {
  return ESTRUCTURAS_OFICIALES[estructura].nombre;
}

function listaColores(colores: readonly string[]): string[] {
  return [...new Set(colores.map((color) => color.trim().toLocaleLowerCase("es")).filter((color) => color.length > 0))];
}

/**
 * Globo liso redondo con el que se busca cada color. Sin la pista el modelo usaba el MISMO producto (un transparente) para
 * «transparente» y «plateado»; el servidor le devolvía al material su color real y la validación rechazaba el plan 3 veces
 * por «falta el plateado» (producción, 2026-10-06).
 */
const BUSQUEDA_COLOR: Readonly<Record<string, string>> = {
  // Sin nombres de acabado (Reflex, Satin, Fashion): /api/chat los lee como acabados obligatorios y rechaza el plan.
  plateado: "globo redondo plata",
  dorado: "globo redondo oro",
  transparente: "globo redondo cristal",
  blanco: "globo redondo blanco",
  negro: "globo redondo negro",
  rosado: "globo redondo rosado",
  "dorado rosa": "globo redondo oro rosa",
  // Tonos claros (taxonomy/v2.ts `TONOS_V2`): la búsqueda nombra el tono y el catálogo devuelve solo globos de ese tono
  // (tonos-color.ts). Sin otro azul en la frase: nombrarlo haría que la búsqueda aceptara cualquier azul.
  celeste: "globo redondo azul celeste",
  "rosa pastel": "globo redondo rosado pastel",
  durazno: "globo redondo durazno",
};

function lineaColores(colores: readonly string[]): string {
  const pistas = colores.filter((color) => BUSQUEDA_COLOR[color]).map((color) => `${color} → ${BUSQUEDA_COLOR[color]}`);
  const tonos = colores.filter((color) => tonoClaroDe(color) !== null);
  return [
    `Colores: usa EXACTAMENTE estos colores: ${colores.join(", ")}; no agregues otros; si uno no tiene cobertura usa el tono más cercano de ese mismo color. Todos deben aparecer en el plan.`,
    `Busca cada color por separado y usa un producto distinto para cada uno, cuyo color de catálogo sea ese color (nunca el mismo product_id para dos colores).${pistas.length ? ` Búsquedas sugeridas: ${pistas.join("; ")}.` : ""}`,
    // Probador (2026-10-07): «celeste» salía «Azul cromado» (un petróleo). El tono es el globo claro de su familia.
    ...(tonos.length ? [`${listaNatural(tonos)} ${tonos.length === 1 ? "es un tono claro" : "son tonos claros"}: usa solo los globos de ese tono que trae su búsqueda sugerida y, en el material, declara el color de catálogo que trae ese producto.`] : []),
  ].join("\n");
}

/**
 * El reintento cuando el plan anterior perdió un color de la foto (`coloresFotoFaltantes`): ese color, en qué piezas
 * (por su estructura_id: un nombre de pieza en el texto se leería como pedido del cliente) y cómo buscarlo. Sin
 * «todos los tamaños de la mezcla»: un color con pocos tamaños va en los que tenga; si no hay ninguno, la tarjeta lo dice.
 */
function lineasColoresFaltantes(faltantes: readonly ColorFotoFaltante[]): string[] {
  return faltantes.map((faltante) => {
    const busqueda = BUSQUEDA_COLOR[faltante.color] ?? `globo redondo ${faltante.color}`;
    return `Al plan anterior le faltó el ${faltante.color}, que la foto sí tiene en ${faltante.piezas.map((pieza) => pieza.estructura_id).join(", ")}: búscalo aparte con buscar_catalogo_rag («${busqueda}») y ponlo como material de esas piezas en los tamaños que tenga, aunque no estén todos los de la mezcla. Si el catálogo no lo tiene en ningún tamaño, confirma sin él.`;
  });
}

/** Los colores de la foto que le faltan a un plan confirmado, para pedirlos en el reintento (`instruccionPlanFoto`). */
export function coloresFaltantesPlanGuiado(plan: unknown, opciones: { coloresPedidos?: readonly string[] } = {}): ColorFotoFaltante[] {
  return coloresFotoFaltantes(plan, opciones.coloresPedidos ? { soloEstos: opciones.coloresPedidos } : {});
}

/**
 * Instrucción con la que la vista guiada pide el plan a /api/chat. NO lleva el evento ni la temática: /api/chat toma este
 * mensaje como lo que dijo el cliente y vuelve la ocasión un filtro duro del catálogo. Con «Cumpleaños» solo quedaban globos
 * impresos de cumpleaños (balón de fútbol, copa dorada, «feliz cumpleaños»), todos de 12", y el arco orgánico salía de un
 * solo tamaño (verificación del 2026-10-06: 4 de 4 planes de cumpleaños). Las piezas y los colores ya están decididos, y la
 * imagen recibe el evento y la temática por su propio brief.
 *
 * `cliente` (comparador 100, I2): las palabras del cliente que importan —medida, lugar, momento, presupuesto— van en una
 * línea propia, para que /api/chat las vea como lo que pidió (`extraerRestriccionesUsuario`: el presupuesto se vuelve
 * techo). El evento no: va en el brief (`cuerpoPlanGuiado`). Solo en el primer plan; un cambio conserva el plan anterior.
 */
export function instruccionPlanGuiado(propuesta: PropuestaGuiada, opciones?: { reintento?: boolean; planAnterior?: PlanActualGuiado; referencia?: ReferenciaDelPlan; faltantes?: readonly ColorFotoFaltante[]; cliente?: ContextoClienteGuiado }): string {
  // Piezas SIEMPRE individuales: una línea por pieza, con repeticiones 1, su propio id y su lado. Antes la línea era
  // «2 × Columna (…; repeticiones: 2)»: le pedíamos UNA estructura repetida y la guiada mostraba «2 × Columna», sin
  // forma de quitar solo una (registro guiada-20261006-212136-dgkw9b). Sin nombres («Columna 1» activa
  // `extraerRestriccionesUsuario`): el servidor los pone al confirmar.
  const { piezas: individuales } = piezasIndividualesDePropuesta(propuesta.piezas);
  const colores = listaColores(propuesta.colores);
  // Colores propios de cada pieza individual («Agregar al plan»: la idea nueva en sus colores, las de antes en los suyos).
  // `recortarCantidades` es el mismo recorte, en el mismo orden, que hace `piezasIndividualesDePropuesta`.
  const origen = recortarCantidades(propuesta.piezas).piezas.flatMap((pieza, indice) => Array.from({ length: pieza.cantidad }, () => indice));
  const propias = individuales.map((_, indice) => listaColores(propuesta.piezas[origen[indice] ?? -1]?.colores ?? []).filter((color) => colores.includes(color)));
  // Medidas propias: las de la pieza de la idea que el cliente sumó (el tamaño que vio en la foto). Mandan sobre las que
  // tomaría de una pieza anterior de su misma oficial.
  const medidasPropias = individuales.map((_, indice) => medidasEnTexto(propuesta.piezas[origen[indice] ?? -1]?.medidas));
  const conservadas = opciones?.planAnterior ? piezasConservadas(individuales, opciones.planAnterior, colores, propias) : new Map<string, PiezaConservada>();
  // Parejas («2 × Columna»): la izquierda y la derecha van iguales. Sin colores propios ni reparto conservado del plan
  // anterior, las dos llevan todos los colores del plan (si caben en una pieza): antes el modelo los repartía y salía una
  // columna dorada y fucsia y la otra rosada y oro rosa (verificador, 2026-10-06). `confirmar_plan_decoracion` lee la
  // línea de la pareja y las iguala.
  const parejas = parejasDePropuesta(individuales, origen);
  const enPareja = new Set(parejas.flat().map((pieza) => pieza.estructuraId));
  if (colores.length <= MAX_MATERIALES_PIEZA) {
    individuales.forEach((pieza, indice) => {
      if (enPareja.has(pieza.estructuraId) && !propias[indice]?.length && !conservadas.get(pieza.estructuraId)?.participacion) propias[indice] = [...colores];
    });
  }
  // Con un plan que salió de una foto, cada pieza que sigue en el plan conserva el elemento de la foto que materializa.
  const referencia = opciones?.referencia;
  const deLaFoto = referencia ? elementosDeLaFoto(individuales, referencia) : new Map<string, string>();
  // «Arco orgánico» que pidió el cliente es el arco completo (`arco`): también mezcla tamaños, aunque su oficial no sea de las orgánicas.
  const pedidasOrganicas = new Set(opciones?.cliente?.organicas ?? []);
  const piezas = individuales.map((pieza, indice) => {
    const conservada = conservadas.get(pieza.estructuraId);
    const suyos = propias[indice] ?? [];
    const medidas = medidasPropias[indice] || conservada?.medidas;
    const elemento = deLaFoto.get(pieza.estructuraId);
    const datos = [
      `estructura_oficial: ${pieza.estructura}`,
      `estructura_id: ${pieza.estructuraId}`,
      ...(pieza.ubicacion ? [`ubicacion: ${pieza.ubicacion}`] : []),
      ...(elemento ? [`referencia_element_id: ${elemento}`] : []),
      "repeticiones: 1",
      ...(suyos.length ? [`colores de esta pieza: ${suyos.join(", ")}`] : []),
      ...(medidas ? [`medidas: ${medidas}`] : []),
      ...(conservada?.participacion ? [`participacion: ${conservada.participacion}`] : []),
      // Probador 124, hallazgo 4: el arco que el decorador pidió «orgánico» salió de mezcla clásica y la guiada lo abría
      // con el editor de arco de patrón. Su mezcla queda dicha en la pieza: con ella se arma y se edita como orgánico
      // (`motorDePieza`), sin cambiar su oficial (`arco`, las dos patas en el piso; nunca `arco_asimetrico`).
      ...(pedidasOrganicas.has(pieza.estructura) && !ESTRUCTURAS_ORGANICAS.has(pieza.estructura) ? ["mezcla: organica_fina (la pidió orgánica; organica_gruesa solo si sus colores no tienen 5\")"] : []),
    ];
    return `- ${nombreOficial(pieza.estructura)} (${datos.join("; ")})`;
  });
  const organicas = [...new Set(individuales.filter((pieza) => ESTRUCTURAS_ORGANICAS.has(pieza.estructura) || pedidasOrganicas.has(pieza.estructura)).map((pieza) => nombreOficial(pieza.estructura)))];
  const palabrasCliente = opciones?.planAnterior ? null : lineaPalabrasCliente(opciones?.cliente, { sinMedida: medidasPropias.some(Boolean) });
  const lineas = [
    "Resuelve ahora el plan exacto de esta decoración con confirmar_plan_decoracion. El cliente ya la eligió: no le preguntes nada ni le pidas que la acepte; confirma el plan en este mismo turno.",
    "Piezas (usa exactamente estas, con su estructura_oficial, su estructura_id y su ubicacion si la trae):",
    ...piezas,
    "Cada línea es UNA pieza del plan: una estructura propia con repeticiones 1. Nunca juntes dos líneas en una estructura repetida.",
    ...parejas.map(([izquierda, derecha]) => lineaPareja(izquierda.estructuraId, derecha.estructuraId)),
    ...(propias.some((suyos) => suyos.length > 0) ? ["Si una pieza trae «colores de esta pieza», sus materiales llevan SOLO esos colores, todos ellos; no le pongas los colores de las otras piezas."] : []),
    ...(conservadas.size ? ["Las piezas que traen medidas o participacion ya están en el plan del cliente: usa EXACTAMENTE esas medidas en la estructura y esa participacion por color en sus materiales; no las cambies."] : []),
    ...(!conservadas.size && medidasPropias.some(Boolean) ? ["Las piezas que traen medidas son las que el cliente eligió: usa EXACTAMENTE esas medidas en la estructura; no las cambies."] : []),
    ...(palabrasCliente ? [palabrasCliente] : []),
    lineaColores(colores),
    // «de cada color» era imposible para colores con pocos tamaños lisos (plateado): el modelo lo quitaba, la validación
    // rechazaba el plan 3 veces y la guiada mostraba «No pude terminar este plan» (producción, 2026-10-06).
    ...(organicas.length ? [`Mezcla de tamaños: en ${listaNatural(organicas)} mezcla al menos 3 tamaños (por ejemplo 5", 12" y 18") en la pieza; no hace falta que cada color tenga todos los tamaños: un color con pocos tamaños disponibles va en los que tenga, pero ningún color se quita. Una pieza orgánica nunca va en un solo tamaño.`] : []),
    SOLO_LISOS,
    // Sin describir el plan anterior: /api/chat lee las cantidades del texto como restricciones («2 columnas») y las volvía a
    // meter en un plan que el cliente pidió sin columnas (recorrido 2, 2026-10-06).
    ...(opciones?.planAnterior ? ["Es un cambio que pidió el cliente sobre su plan anterior: el plan nuevo lleva SOLO las piezas de esta lista, ni una más."] : []),
    ...(referencia ? lineasDeLaFoto(referencia, deLaFoto, colores, opciones?.planAnterior) : []),
    "Cuando el plan quede confirmado, responde al cliente con una sola frase corta, sin repetir cantidades ni precios.",
    ...(opciones?.reintento ? [REINTENTO] : []),
    ...(opciones?.reintento && opciones.faltantes?.length ? lineasColoresFaltantes(opciones.faltantes) : []),
  ];
  return lineas.join("\n");
}

/** La foto de la que salió el plan vigente, como la tiene la vista: su lectura, la foto si sigue en memoria y sus piezas. */
export type FotoParaRehacer<B> = { blueprint: B; imagen?: { base64: string; mime: string }; referencia: ReferenciaDelPlan | null };

/**
 * El cuerpo de /api/chat con que la guiada resuelve una propuesta. Con `foto` (rehacer un plan que salió de una foto)
 * lleva lo mismo que la clásica en cada turno con la referencia adjunta: la foto (`imagenesReferencia`), su lectura
 * (`referenceBlueprint`) y la creatividad por defecto; la instrucción ata cada pieza a su elemento de la foto.
 */
export function cuerpoPlanGuiado<B>(propuesta: PropuestaGuiada, opciones: { reintento: boolean; planAnterior?: PlanActualGuiado; foto?: FotoParaRehacer<B> | null; faltantes?: readonly ColorFotoFaltante[]; cliente?: ContextoClienteGuiado }) {
  const { reintento, planAnterior, foto, faltantes, cliente } = opciones;
  return {
    schema_version: "chat.v1" as const,
    messages: [{ role: "user" as const, content: instruccionPlanGuiado(propuesta, { reintento, ...(planAnterior ? { planAnterior } : {}), ...(foto?.referencia ? { referencia: foto.referencia } : {}), ...(faltantes?.length ? { faltantes } : {}), ...(cliente ? { cliente } : {}) }) }],
    brief: briefChatGuiado(propuesta.colores, cliente),
    // Las palabras del cliente: el plan las guarda como `original_request` (la escena de la imagen) y saca de ellas la ocasión.
    ...(cliente?.solicitud ? { solicitudCliente: cliente.solicitud } : {}),
    // Piezas SIEMPRE individuales: el servidor separa cualquier estructura repetida y nombra cada pieza.
    piezasIndividuales: true as const,
    ...(foto ? { creatividad: CREATIVIDAD_POR_DEFECTO, referenceBlueprint: foto.blueprint, ...(foto.imagen ? { imagenesReferencia: [{ base64: foto.imagen.base64, mime: foto.imagen.mime }] } : {}) } : {}),
  };
}

/**
 * Lo que un plan que salió de una foto le deja a su versión siguiente para no perderla al rehacerse («Cambiar algo»,
 * «Hazla más sencilla», «Hacerla más grande», «Otros colores», «Agregar al plan»). Sin esto el plan nuevo se pedía sin
 * la foto: perdía la lectura (blueprint), la escenografía y las cajas de las piezas, y la imagen salía inventada
 * (producción, 2026-10-06, guiada-20261006-220821-ci54dg: tras «Hazla más sencilla» dos columnas orgánicas de la
 * foto salieron como un arco con cintas «framing the entrance doorway»).
 */
export type ReferenciaDelPlan = {
  /** Cada pieza del plan con el elemento de la foto que materializa (`referencia_element_id`). */
  piezas: ReadonlyArray<{ estructura?: EstructuraOficialId; ubicacion?: string; elemento: string }>;
  /** Elementos de la foto que el plan declaró que no arma (`referencia_omitida`): la mesa, el fondo, las flores. */
  omitidos: ReadonlyArray<{ elemento: string; motivoTipo: string }>;
};

type PlanConReferencia = {
  plan?: {
    estructuras?: ReadonlyArray<{ estructura_oficial?: unknown; ubicacion?: unknown; referencia_element_id?: unknown }>;
    referencia_omitida?: ReadonlyArray<{ element_id?: unknown; motivo_tipo?: unknown }>;
  };
};

/** Ids de elemento de la foto como los escribe la lectura («REF_01_E02»): nada más viaja al texto del cliente. */
const ID_ELEMENTO = /^[A-Za-z0-9_-]{1,80}$/;
const MOTIVOS_OMISION: ReadonlySet<string> = new Set(["fuera_de_catalogo", "emulacion_propuesta", "emulacion_rechazada", "decision_de_diseno"]);

/** La referencia de un plan confirmado, o null si el plan no materializa ningún elemento de una foto. */
export function referenciaDelPlan(plan: unknown): ReferenciaDelPlan | null {
  if (!plan || typeof plan !== "object") return null;
  const leido = (plan as PlanConReferencia).plan;
  const piezas = (leido?.estructuras ?? []).flatMap((estructura) => {
    const elemento = estructura.referencia_element_id;
    if (typeof elemento !== "string" || !ID_ELEMENTO.test(elemento)) return [];
    const oficial = typeof estructura.estructura_oficial === "string" && esIdOficial(estructura.estructura_oficial) ? estructura.estructura_oficial : undefined;
    return [{ ...(oficial ? { estructura: oficial } : {}), ...(typeof estructura.ubicacion === "string" ? { ubicacion: estructura.ubicacion } : {}), elemento }];
  });
  if (!piezas.length) return null;
  const omitidos = (leido?.referencia_omitida ?? []).flatMap((item) => (
    typeof item.element_id === "string" && ID_ELEMENTO.test(item.element_id) && typeof item.motivo_tipo === "string" && MOTIVOS_OMISION.has(item.motivo_tipo)
      ? [{ elemento: item.element_id, motivoTipo: item.motivo_tipo }]
      : []
  ));
  return { piezas, omitidos };
}

/**
 * Qué elemento de la foto materializa cada pieza nueva: la anterior de su misma oficial y su mismo lado; si no, la de su
 * misma oficial; si no, la de su mismo tipo (columna, arco…) y lado, y al final la de su mismo tipo. Cada elemento, una
 * vez. Una pieza sin pareja (la que el cliente agregó) no materializa ninguno.
 */
function elementosDeLaFoto(individuales: readonly PiezaIndividual[], referencia: ReferenciaDelPlan): Map<string, string> {
  const tipoDe = (oficial: EstructuraOficialId | undefined) => (oficial ? ESTRUCTURAS_OFICIALES[oficial].tipoBase : undefined);
  type Previa = ReferenciaDelPlan["piezas"][number];
  const criterios: ReadonlyArray<(pieza: PiezaIndividual, previa: Previa) => boolean> = [
    (pieza, previa) => previa.estructura === pieza.estructura && pieza.ubicacion !== undefined && previa.ubicacion === pieza.ubicacion,
    (pieza, previa) => previa.estructura === pieza.estructura,
    (pieza, previa) => tipoDe(previa.estructura) === tipoDe(pieza.estructura) && pieza.ubicacion !== undefined && previa.ubicacion === pieza.ubicacion,
    (pieza, previa) => tipoDe(previa.estructura) === tipoDe(pieza.estructura),
  ];
  const usados = new Set<string>();
  const resultado = new Map<string, string>();
  for (const criterio of criterios) {
    for (const pieza of individuales) {
      if (resultado.has(pieza.estructuraId)) continue;
      const elegida = referencia.piezas.find((previa) => !usados.has(previa.elemento) && criterio(pieza, previa));
      if (!elegida) continue;
      usados.add(elegida.elemento);
      resultado.set(pieza.estructuraId, elegida.elemento);
    }
  }
  return resultado;
}

/**
 * Las líneas de la foto en la instrucción. Sin nombres de piezas ni cantidades (`extraerRestriccionesUsuario` los leería
 * como lo que pidió el cliente): solo ids de la lectura y motivos del contrato.
 */
function lineasDeLaFoto(referencia: ReferenciaDelPlan, deLaFoto: ReadonlyMap<string, string>, colores: readonly string[], planAnterior?: PlanActualGuiado): string[] {
  const materializados = new Set(deLaFoto.values());
  const quitados = [...new Set(referencia.piezas.map((pieza) => pieza.elemento))].filter((elemento) => !materializados.has(elemento));
  const omitidos = referencia.omitidos.filter((item) => !materializados.has(item.elemento) && !quitados.includes(item.elemento));
  const anteriores = new Set((planAnterior?.colores ?? []).map((color) => color.trim().toLocaleLowerCase("es")));
  const coloresNuevos = anteriores.size > 0 && colores.some((color) => !anteriores.has(color));
  return [
    "Esta decoración salió de la foto de referencia del cliente (ANALISIS_REFERENCIA_VISUAL): conserva su composición, el lugar de cada pieza y su escenografía. Cada pieza que trae referencia_element_id materializa ese elemento de la foto: ponlo tal cual en su estructura.",
    ...(quitados.length ? [`Elementos de la foto que el cliente quitó de su plan: decláralos en referencia_omitida con motivo_tipo decision_de_diseno: ${quitados.join(", ")}.`] : []),
    // Sin el motivo ni la propuesta de antes: su texto nombra piezas («pared de globos») que /api/chat leería como pedido.
    ...(omitidos.length ? [`Elementos de la foto que el plan no arma: decláralos otra vez en referencia_omitida con el mismo motivo_tipo y un motivo corto${omitidos.some((item) => item.motivoTipo === "emulacion_propuesta") ? " (con emulacion_propuesta, también su propuesta)" : ""}: ${omitidos.map((item) => `${item.elemento} (${item.motivoTipo})`).join(", ")}.`] : []),
    ...(coloresNuevos ? ["El cliente pidió otros colores: los colores de esta lista mandan sobre los de la foto; de la foto se conservan la forma, el lugar de cada pieza y la escenografía."] : []),
  ];
}

type PiezaConservada = { medidas?: string; participacion?: string };
type PiezaAnterior = { estructura: EstructuraOficialId; ubicacion?: Lateral; medidas?: PlanActualGuiado["piezas"][number]["medidas"]; participacion?: PlanActualGuiado["piezas"][number]["participacion"] };

/** Número con punto y sin ceros de más («2.46»): el texto no lleva coma decimal, que se leería como separador. */
function decimal(valor: number): string {
  return String(Math.round(valor * 100) / 100);
}

/** «ancho_m 2.23, alto_m 2.62», o "" sin medidas. */
function medidasEnTexto(medidas: { ancho_m?: number; alto_m?: number; largo_m?: number } | undefined): string {
  if (!medidas) return "";
  return (["ancho_m", "alto_m", "largo_m"] as const).flatMap((campo) => (medidas[campo] ? [`${campo} ${decimal(medidas[campo])}`] : [])).join(", ");
}

/**
 * Lo que «Cambiar algo» conserva de cada pieza que sigue en el plan: sus medidas y la parte de cada color (de los globos
 * que Python resolvió, con los ajustes que el cliente ya hizo). Sin esto el modelo elegía medidas nuevas: tras ajustar,
 * el arco pasaba de 3 × 2,5 a 2,5 × 2,2 m y las columnas de 2,46 a 2 m (verificación de «Ajustar mi plan», 2026-10-06).
 * Cada pieza nueva toma la anterior de su misma oficial (la del mismo lado primero). La participación solo viaja si el
 * cliente no pidió colores nuevos y la pieza no lleva colores que ya no están. Sin nombres ni «una columna»: ver arriba.
 * Una pieza con colores propios («Agregar al plan») decide sola: su participación viaja si sus colores son los mismos que
 * tenía; así las piezas de antes conservan su proporción aunque la idea nueva traiga colores que el plan no tenía.
 */
function piezasConservadas(individuales: readonly PiezaIndividual[], anterior: PlanActualGuiado, colores: readonly string[], propias: ReadonlyArray<readonly string[]> = []): Map<string, PiezaConservada> {
  const previas: PiezaAnterior[] = anterior.piezas.flatMap((pieza) => Array.from({ length: pieza.cantidad }, (_, indice) => ({
    estructura: pieza.estructura,
    ...(pieza.cantidad === 2 ? { ubicacion: indice === 0 ? "lateral_izquierdo" as const : "lateral_derecho" as const } : pieza.ubicacion ? { ubicacion: pieza.ubicacion } : {}),
    ...(pieza.medidas ? { medidas: pieza.medidas } : {}),
    ...(pieza.participacion ? { participacion: pieza.participacion } : {}),
  })));
  const disponibles = new Set(colores);
  const anteriores = new Set(anterior.colores.map((color) => color.trim().toLocaleLowerCase("es")));
  const sinColoresNuevos = colores.every((color) => anteriores.has(color));
  const usadas = new Set<number>();
  const resultado = new Map<string, PiezaConservada>();
  for (const [posicion, pieza] of individuales.entries()) {
    const candidatas = previas.map((previa, indice) => ({ previa, indice })).filter(({ previa }) => previa.estructura === pieza.estructura);
    const elegida = candidatas.find(({ previa, indice }) => !usadas.has(indice) && pieza.ubicacion !== undefined && previa.ubicacion === pieza.ubicacion)
      ?? candidatas.find(({ indice }) => !usadas.has(indice))
      ?? candidatas[0];
    if (!elegida) continue;
    usadas.add(elegida.indice);
    const { medidas, participacion } = elegida.previa;
    const textoMedidas = medidas ? (["ancho_m", "alto_m", "largo_m"] as const).flatMap((campo) => (medidas[campo] ? [`${campo} ${decimal(medidas[campo])}`] : [])).join(", ") : "";
    const suyos = propias[posicion] ?? [];
    const coloresParte = (participacion ?? []).map((parte) => parte.color.trim().toLocaleLowerCase("es"));
    const viaja = suyos.length
      ? coloresParte.length > 0 && coloresParte.every((color) => suyos.includes(color)) && suyos.every((color) => coloresParte.includes(color))
      : sinColoresNuevos && coloresParte.length > 0 && coloresParte.every((color) => disponibles.has(color));
    const partes = viaja && participacion
      ? participacion.map((parte) => `${parte.color.trim().toLocaleLowerCase("es")} ${decimal(parte.parte)}`).join(", ")
      : "";
    if (!textoMedidas && !partes) continue;
    resultado.set(pieza.estructuraId, { ...(textoMedidas ? { medidas: textoMedidas } : {}), ...(partes ? { participacion: partes } : {}) });
  }
  return resultado;
}

/**
 * «Sí, armémoslo» con una foto. `colores` son los que la lectura le mostró al cliente («Veo un arco en dorado, blanco, azul
 * y rosa»): sin ellos el plan seguía al análisis crudo y perdía el azul que el cliente vio y aprobó.
 */
export function instruccionPlanFoto(opciones?: { reintento?: boolean; colores?: readonly string[]; faltantes?: readonly ColorFotoFaltante[] }): string {
  const colores = listaColores(opciones?.colores ?? []);
  return [
    "Sí, armémoslo. Prepara el plan para reproducir las piezas de globos aprobadas en la foto y sus colores, usando la lectura de referencia, y confírmalo con confirmar_plan_decoracion en este mismo turno sin preguntarme nada.",
    ...(colores.length ? [lineaColores(colores)] : []),
    `${SOLO_LISOS} Cuando el plan quede confirmado, responde con una sola frase corta, sin repetir cantidades ni precios.`,
    ...(opciones?.reintento ? [REINTENTO] : []),
    ...(opciones?.reintento && opciones.faltantes?.length ? lineasColoresFaltantes(opciones.faltantes) : []),
  ].join("\n");
}

/**
 * Brief de chat-v1 del plan: los colores y, con `cliente`, el evento, el lugar y el momento que dijo el cliente. Nada de
 * eso filtra el catálogo (`filtrosDurosDeBusqueda`: lo que solo dice el brief no es filtro); sin el evento el plan
 * inventaba la ocasión («Fiesta» para una boda) y la imagen no tenía el ambiente. La temática no va: el modelo la leería
 * como colores. El briefSchema exige min(1).
 */
export function briefChatGuiado(colores: readonly string[], cliente?: ContextoClienteGuiado): { colores?: string[]; tipo_evento?: string; espacio?: string; momento_dia?: string } {
  const lista = listaColores(colores);
  return { ...(lista.length ? { colores: lista } : {}), ...briefChatCliente(cliente) };
}

type LineaPlanRevisada = { titulo?: string; diam_pulg?: number | null; tamano_codigo?: string | null; unidades?: number };
type PlanRevisado = {
  plan?: { estructuras?: Array<{ estructura_id?: string; estructura_oficial?: string; nombre?: string }> };
  estructuras?: Array<{ estructura_id?: string; lineas?: LineaPlanRevisada[] }>;
  compras?: Array<{ titulo?: string }>;
};

/**
 * Por qué un plan confirmado no sirve para la vista guiada (una pieza orgánica en un solo tamaño, globos que no son lisos
 * o un color de la foto que el plan no compra), o null si sirve. No toca cantidades, que son de Python: solo decide si
 * se gasta el reintento automático en pedirlo otra vez. `coloresPedidos`: los colores que eligió el cliente; con ellos
 * solo se exigen los de la foto que siguen en su lista (`coloresFotoFaltantes`).
 */
export function defectoPlanGuiado(plan: unknown, cotizacion?: unknown, opciones: { coloresPedidos?: readonly string[] } = {}): string | null {
  const defecto = defectoFormaPlanGuiado(plan, cotizacion);
  if (defecto) return defecto;
  // Lo que la guiada le dijo al cliente que vio («… rosa pastel y transparente») tiene que estar en lo que compra.
  const faltantes = coloresFaltantesPlanGuiado(plan, opciones);
  return faltantes.length
    ? `le faltan colores de la foto: ${faltantes.map((faltante) => `${faltante.color} (${faltante.piezas.map((pieza) => pieza.estructura_id).join(", ")})`).join("; ")}`
    : null;
}

function defectoFormaPlanGuiado(plan: unknown, cotizacion?: unknown): string | null {
  if (!plan || typeof plan !== "object") return null;
  const leido = plan as PlanRevisado;
  for (const pieza of leido.plan?.estructuras ?? []) {
    if (!esIdOficial(pieza.estructura_oficial) || !ESTRUCTURAS_ORGANICAS.has(pieza.estructura_oficial)) continue;
    const lineas = leido.estructuras?.find((estructura) => estructura.estructura_id === pieza.estructura_id)?.lineas ?? [];
    const tamanos = new Set(lineas.filter((linea) => (linea.unidades ?? 1) > 0).map((linea) => linea.diam_pulg ?? linea.tamano_codigo).filter((tamano) => tamano != null));
    if (tamanos.size < 2) return `la pieza orgánica «${pieza.nombre ?? pieza.estructura_oficial}» salió en un solo tamaño`;
  }
  const lineasCotizacion = (cotizacion as { lineas?: Array<{ nombre?: unknown }> } | null | undefined)?.lineas ?? [];
  const titulos = [
    ...(leido.estructuras ?? []).flatMap((estructura) => estructura.lineas ?? []).map((linea) => linea.titulo),
    ...(leido.compras ?? []).map((compra) => compra.titulo),
    ...lineasCotizacion.map((linea) => linea.nombre),
  ].filter((titulo): titulo is string => typeof titulo === "string");
  const noLiso = titulos.find((titulo) => GLOBO_NO_LISO.test(titulo));
  return noLiso ? `trae globos que no son lisos («${noLiso}»)` : null;
}

function numero(valor: number): string {
  return String(Math.round(valor * 100) / 100).replace(".", ",");
}

function medidasPieza(medidas: { ancho_m?: number; alto_m?: number; largo_m?: number }): string {
  const { ancho_m: ancho, alto_m: alto, largo_m: largo } = medidas;
  if (ancho && alto) return `de ${numero(ancho)} × ${numero(alto)} m`;
  if (alto) return `de ${numero(alto)} m`;
  if (largo) return `de ${numero(largo)} m`;
  if (ancho) return `de ${numero(ancho)} m`;
  return "";
}

function esIdOficial(valor: string | undefined): valor is EstructuraOficialId {
  return valor !== undefined && (ESTRUCTURAS_OFICIALES_IDS as readonly string[]).includes(valor);
}

type MedidasLeidas = { ancho_m?: number; alto_m?: number; largo_m?: number };
type PiezaPlanLeida = { oficial?: EstructuraOficialId; nombre: string; repeticiones: number; ubicacion?: string; medidas: MedidasLeidas; participacion: Array<{ color: string; parte: number }> };
type EstructuraLeida = { estructura_id: string; nombre: string; estructura_oficial?: string; repeticiones: number; ubicacion?: string; medidas?: MedidasLeidas };
type LineasLeidas = Array<{ estructura_id?: string; lineas?: Array<{ color?: string | null; unidades?: number }> }>;

/** Partes en centésimas que suman 1 (mayor resto), de los globos por color que resolvió Python. */
function partesPorColor(lineas: ReadonlyArray<{ color?: string | null; unidades?: number }>): Array<{ color: string; parte: number }> {
  const porColor = new Map<string, number>();
  for (const linea of lineas) {
    const color = (linea.color ?? "").trim().toLocaleLowerCase("es");
    if (color && (linea.unidades ?? 0) > 0) porColor.set(color, (porColor.get(color) ?? 0) + (linea.unidades ?? 0));
  }
  const total = [...porColor.values()].reduce((suma, valor) => suma + valor, 0);
  if (total <= 0) return [];
  const exactas = [...porColor].map(([color, unidades]) => ({ color, centesimas: (unidades / total) * 100 }));
  const enteras = exactas.map((parte) => Math.floor(parte.centesimas));
  let resto = 100 - enteras.reduce((suma, valor) => suma + valor, 0);
  for (const indice of exactas.map((parte, posicion) => ({ posicion, fraccion: parte.centesimas - Math.floor(parte.centesimas) })).sort((a, b) => b.fraccion - a.fraccion).map((parte) => parte.posicion)) {
    if (resto <= 0) break;
    enteras[indice]! += 1;
    resto -= 1;
  }
  return exactas.map((parte, posicion) => ({ color: parte.color, parte: enteras[posicion]! / 100 })).filter((parte) => parte.parte > 0);
}

function leerPlan(plan: unknown): { piezas: PiezaPlanLeida[]; colores: string[]; total: number } | null {
  try {
    const desglose = generarPasosPlan(plan);
    const estructuras = (plan as { plan: { estructuras: EstructuraLeida[] } }).plan.estructuras;
    const resueltas = (plan as { estructuras?: LineasLeidas }).estructuras ?? [];
    const piezas = estructuras.map((pieza): PiezaPlanLeida => ({
      ...(esIdOficial(pieza.estructura_oficial) ? { oficial: pieza.estructura_oficial } : {}),
      nombre: pieza.nombre,
      repeticiones: pieza.repeticiones,
      ...(pieza.ubicacion ? { ubicacion: pieza.ubicacion } : {}),
      medidas: pieza.medidas ?? {},
      participacion: partesPorColor(resueltas.find((resuelta) => resuelta.estructura_id === pieza.estructura_id)?.lineas ?? []),
    }));
    const colores = [...new Set(desglose.globos.map((globo) => globo.color.trim().toLocaleLowerCase("es")).filter((color) => color.length > 0 && color !== "color indicado en el plan"))];
    return { piezas, colores, total: desglose.total };
  } catch {
    return null;
  }
}

/** Nombre individual que puso el servidor («Columna izquierda», «Centro de mesa con globos 2»). */
const NOMBRE_INDIVIDUAL = /\s(?:izquierd[ao]|derech[ao]|\d+)$/i;

function piezaResumen(pieza: PiezaPlanLeida): string {
  const medidas = medidasPieza(pieza.medidas);
  // Una pieza individual se nombra como la ve el cliente («columna izquierda de 2,4 m»): así el chat sabe cuál es cuál.
  if (pieza.oficial && pieza.repeticiones === 1 && NOMBRE_INDIVIDUAL.test(pieza.nombre.trim())) return `${pieza.nombre.trim().toLocaleLowerCase("es")}${medidas ? ` ${medidas}` : ""}`;
  const nombre = pieza.oficial
    ? piezaEnPalabras(pieza.oficial, pieza.repeticiones).replace(/^(?:un|una|dos|tres|cuatro|\d+) /, "")
    : pieza.nombre.toLocaleLowerCase("es");
  return `${pieza.repeticiones} ${nombre}${medidas ? ` ${medidas}` : ""}`;
}

/**
 * Texto del mensaje del plan (viaja en el historial, así «Cambiar algo» sabe qué hay). Ej.: «Tu plan: 1 arco orgánico de
 * 2 × 2,2 m y 2 columnas de 2,4 m, en azul, blanco y dorado; 180 globos en total.». Máximo 400 caracteres, sin ids ni SKU.
 */
export function resumenPlanGuiado(plan: unknown): string {
  const leido = leerPlan(plan);
  if (!leido || !leido.piezas.length) return "Tu plan está listo.";
  const colores = leido.colores.length ? `, en ${listaNatural(leido.colores)}` : "";
  const total = leido.total > 0 ? `; ${leido.total} globos en total` : "";
  const completo = `Tu plan: ${listaNatural(leido.piezas.map(piezaResumen))}${colores}${total}.`;
  if (completo.length <= 400) return completo;
  const sinMedidas = `Tu plan: ${listaNatural(leido.piezas.map((pieza) => piezaResumen({ ...pieza, medidas: {} })))}${colores}${total}.`;
  return sinMedidas.length <= 400 ? sinMedidas : `${sinMedidas.slice(0, 398).trimEnd()}….`.slice(0, 400);
}

function describirPlanActual(plan: PlanActualGuiado): string {
  const piezas = plan.piezas.map((pieza) => `${pieza.cantidad} ${pieza.nombre ?? nombreOficial(pieza.estructura)}`);
  return `${listaNatural(piezas)} en ${listaNatural(plan.colores)}`;
}

/** Resumen estructurado del plan para `estadoGuiado.planActual`. Null si el plan no trae piezas oficiales ni colores. */
export function planActualDesdePlan(plan: unknown): PlanActualGuiado | null {
  const leido = leerPlan(plan);
  if (!leido) return null;
  const piezas = leido.piezas.flatMap((pieza) => {
    if (!pieza.oficial) return [];
    const medidas = Object.fromEntries((["ancho_m", "alto_m", "largo_m"] as const).flatMap((campo) => {
      const valor = pieza.medidas[campo];
      return valor && valor > 0 && valor <= 100 ? [[campo, valor]] : [];
    }));
    const lado = ladoDeUbicacion(pieza.ubicacion);
    return [{
      estructura: pieza.oficial,
      cantidad: Math.min(12, Math.max(1, Math.trunc(pieza.repeticiones))),
      nombre: pieza.nombre.slice(0, 120),
      ...(lado ? { ubicacion: pieza.ubicacion as Lateral } : {}),
      ...(Object.keys(medidas).length ? { medidas } : {}),
      ...(pieza.participacion.length ? { participacion: pieza.participacion.slice(0, 6).map((parte) => ({ color: parte.color.slice(0, 40), parte: parte.parte })) } : {}),
    }];
  }).slice(0, MAX_PIEZAS_PLAN);
  const colores = leido.colores.map((color) => color.slice(0, 40)).slice(0, 8);
  const candidato = { piezas, colores, totalGlobos: leido.total, resumen: resumenPlanGuiado(plan) };
  const valido = PlanActualGuiadoSchema.safeParse(candidato);
  return valido.success ? valido.data : null;
}

/** Texto para el sistema del asistente guiado: el resumen si existe, o las piezas y colores. */
export function textoPlanActual(plan: PlanActualGuiado): string {
  return plan.resumen ?? `${describirPlanActual(plan)}${plan.totalGlobos ? `; ${plan.totalGlobos} globos en total` : ""}.`;
}
