import { ESTRUCTURAS_OFICIALES } from "@/lib/plan/estructuras-oficiales";
import { esOficialAgregable, MEDIDAS_ESTANDAR } from "@/lib/plan/pieza-nueva";
import { FEMENINAS, MAX_PIEZAS_PLAN, PIEZAS_CON_LADO } from "@/lib/plan/piezas-individuales";
import { colorConPesos } from "./colores-espec";
import {
  colorFabricable, conArticulo, conPesosNormalizados, conPiezasCambiadas, enPiezas, listaNatural, MOTIVO_PIEZA_AUSENTE,
  noAplicado, nombreColor, nombreDeCodigo, origenEditado, resolverColorDicho, seleccionar, type ResultadoEdicion,
} from "./ediciones-comunes";
import type { EdicionEspecV1 } from "./edicion-espec-v1";
import { sumarIdeaAEspec } from "./espec-desde-idea";
import { LUGAR_POR_OFICIAL } from "./espec-desde-propuesta";
import { MAX_COLORES_PIEZA, type ColorEspec, type EspecClienteV1, type PiezaEspec, type TamanosEspec } from "./espec-cliente-v1";
import { DENSIDAD_POR_DEFECTO, MEDIDAS_POR_DEFECTO, TAMANOS_POR_DEFECTO, UNIDADES_POR_DEFECTO, medidasDe, type MedidasEspec } from "./medidas-espec";
import { medidasEditables, type CampoMedida, type RangoMedida } from "./rangos-medidas";
import { representacionDe } from "./representable";

/**
 * Las ediciones de PIEZA de la espec: el tamaño (medidas y proporción de tamaños de globo), quitar y sumar piezas del
 * catálogo oficial o de una idea, las flores de globo y el lado. Ninguna crea geometría que no sea una pieza oficial: el
 * resto del plan queda exactamente como estaba.
 */
type Op<T extends EdicionEspecV1["op"]> = Extract<EdicionEspecV1, { op: T }>;

const ETIQUETA_MEDIDA: Readonly<Record<CampoMedida, string>> = { anchoM: "El ancho", altoM: "El alto", largoM: "El largo" };
/** Cuánto agranda o achica «un poco»: un 10 %, como el panel de siempre. */
export const PASO_TAMANO = 0.1;

const metros = (valor: number): string => `${String(Math.round(valor * 100) / 100).replace(".", ",")} m`;
const aCm = (valor: number): number => Math.round(valor * 100) / 100;
/** «del arco», «de la columna»: la pieza con su preposición. */
const dePieza = (pieza: Pick<PiezaEspec, "oficial" | "nombre">): string => conArticulo(pieza).replace(/^el /, "del ").replace(/^la /, "de la ");

function acotar(campo: CampoMedida, pedido: number, rango: RangoMedida, pieza: PiezaEspec, avisos: string[]): number {
  const valor = Math.min(rango[1], Math.max(rango[0], aCm(pedido)));
  if (valor !== aCm(pedido)) avisos.push(`${ETIQUETA_MEDIDA[campo]} ${dePieza(pieza)}: ${metros(pedido)} queda fuera de lo que se arma (de ${metros(rango[0])} a ${metros(rango[1])}); quedó en ${metros(valor)}.`);
  return valor;
}

/** Las medidas que se piden, llevadas a las que la pieza deja cambiar (con la regla de siempre: una sola medida va a la única que hay). */
function medidasPedidas(pieza: PiezaEspec, pedidas: MedidasEspec, editables: Partial<Record<CampoMedida, RangoMedida>>, avisos: string[]): Partial<Record<CampoMedida, number>> {
  const entradas = (Object.entries(pedidas) as Array<[CampoMedida, number]>).filter(([, valor]) => valor !== undefined);
  const campos = Object.keys(editables) as CampoMedida[];
  const propias = entradas.filter(([campo]) => campos.includes(campo));
  if (propias.length) {
    const ignoradas = entradas.filter(([campo]) => !campos.includes(campo));
    if (ignoradas.length) avisos.push(`${conArticulo(pieza)} no se mide por ${listaNatural(ignoradas.map(([campo]) => ETIQUETA_MEDIDA[campo].replace("El ", "").toLocaleLowerCase("es")))}: lo dejé como estaba.`);
    return Object.fromEntries(propias);
  }
  // Un aro se mide por su diámetro: el alto que se pida es el mismo diámetro.
  if (pieza.oficial === "aro_circular" && entradas.length) return { anchoM: entradas[0]![1] };
  if (entradas.length === 1 && campos.length === 1) return { [campos[0]!]: entradas[0]![1] };
  return {};
}

export function tamanoPieza(espec: EspecClienteV1, edicion: Op<"tamano_pieza">): ResultadoEdicion {
  const pieza = espec.piezas.find((item) => item.id === edicion.pieza);
  if (!pieza) return noAplicado(espec, MOTIVO_PIEZA_AUSENTE);
  const editables = medidasEditables(pieza);
  const campos = Object.keys(editables) as CampoMedida[];
  if (!campos.length) return noAplicado(espec, `${conArticulo(pieza)} no se mide en metros, así que no le puedo cambiar el tamaño.`);
  const avisos: string[] = [];
  const actuales = medidasDe(pieza);
  const cambios: Partial<Record<CampoMedida, number>> = {};
  if (edicion.medidas) {
    const pedidas = medidasPedidas(pieza, edicion.medidas, editables, avisos);
    for (const [campo, pedido] of Object.entries(pedidas) as Array<[CampoMedida, number]>) cambios[campo] = acotar(campo, pedido, editables[campo]!, pieza, avisos);
  } else {
    const factor = 1 + PASO_TAMANO * edicion.direccion!;
    for (const campo of campos) {
      const actual = actuales[campo];
      if (actual === undefined) continue;
      const pedido = aCm(actual * factor);
      cambios[campo] = acotar(campo, Math.abs(pedido - actual) < 0.01 ? actual + 0.01 * edicion.direccion! : pedido, editables[campo]!, pieza, avisos);
    }
  }
  const cambian = (Object.entries(cambios) as Array<[CampoMedida, number]>).filter(([campo, valor]) => Math.abs(valor - (actuales[campo] ?? Number.NaN)) >= 0.005 || actuales[campo] === undefined);
  if (!cambian.length) {
    const motivo = edicion.medidas ? "esa medida ya es la que lleva, o queda fuera de lo que se arma." : edicion.direccion! > 0 ? "ya está en su tamaño máximo." : "ya está en su tamaño mínimo.";
    return noAplicado(espec, `${conArticulo(pieza)} ${motivo}`, avisos);
  }
  const medidas: MedidasEspec = { ...pieza.medidas, ...Object.fromEntries(cambian) };
  // Un aro es redondo: el alto sigue al ancho.
  if (pieza.oficial === "aro_circular" && medidas.anchoM !== undefined) medidas.altoM = medidas.anchoM;
  // Si se cambia el alto de una columna, manda el alto y no la cuenta de capas que traía.
  const { capas: _capas, ...sinCapas } = pieza;
  const nueva: PiezaEspec = { ...(cambian.some(([campo]) => campo === "altoM") ? sinCapas : pieza), medidas };
  const dicho = cambian.map(([campo, valor]) => `${ETIQUETA_MEDIDA[campo].replace("El ", "").toLocaleLowerCase("es")} de ${metros(valor)}`);
  const descripcion = edicion.medidas ? `dejé ${conArticulo(pieza)} con ${listaNatural(dicho)}` : `${edicion.direccion! > 0 ? "agrandé" : "achiqué"} ${conArticulo(pieza)} (${listaNatural(dicho)})`;
  return { espec: conPiezasCambiadas(espec, new Map([[pieza.id, nueva]])), avisos, descripcion, tocadas: [pieza.id] };
}

// --- Proporción de tamaños de globo --------------------------------------------------------------------------------

/** De los globos más pequeños a los más grandes: la proporción de tamaños (`MEZCLAS`) de la pieza. */
export const ESCALA_TAMANOS: readonly TamanosEspec[] = ["organica_fina", "clasica", "organica_gruesa", "solo_grandes"];
const FRASE_TAMANOS: Readonly<Record<TamanosEspec, string>> = {
  organica_fina: "globos de varios tamaños, de chicos a medianos",
  clasica: "globos medianos, todos iguales",
  organica_gruesa: "globos medianos y grandes",
  solo_grandes: "solo globos grandes",
};
/** Piezas cuyos globos no se mezclan por tamaño: la malla, el techo, el ramo y el racimo llevan uno solo. */
const UN_SOLO_TAMANO = new Set<PiezaEspec["oficial"]>(["pared_densa", "pared_no_densa", "pared_organica", "techo_globos", "bouquet", "racimo_pared", "centro_mesa", "figura"]);
const SE_ARMA_EN_CUARTETOS = new Set<PiezaEspec["oficial"]>(["arco", "columna", "guirnalda"]);

/**
 * Cambiar los globos de una pieza puede cambiar el rango de sus medidas (un arco clásico no se arma igual que uno orgánico):
 * las medidas que quedan fuera del rango nuevo se acotan y se dice, para que la tarjeta y el armado digan lo mismo.
 */
function medidasAlRangoDeLosGlobos(pieza: PiezaEspec, avisos: string[]): PiezaEspec {
  const rangos = medidasEditables(pieza);
  const medidas: MedidasEspec = { ...pieza.medidas };
  let cambio = false;
  for (const campo of Object.keys(rangos) as CampoMedida[]) {
    const actual = medidas[campo];
    const rango = rangos[campo];
    if (actual === undefined || !rango) continue;
    const valor = Math.min(rango[1], Math.max(rango[0], actual));
    if (valor === actual) continue;
    medidas[campo] = aCm(valor);
    cambio = true;
    avisos.push(`${ETIQUETA_MEDIDA[campo]} ${dePieza(pieza)} quedó en ${metros(valor)}: con esos globos se arma de ${metros(rango[0])} a ${metros(rango[1])}.`);
  }
  return cambio ? { ...pieza, medidas } : pieza;
}

export function tamanoGlobos(espec: EspecClienteV1, edicion: Op<"tamano_globos">): ResultadoEdicion {
  const seleccion = seleccionar(espec, edicion.pieza ? [edicion.pieza] : undefined);
  if ("faltan" in seleccion) return noAplicado(espec, MOTIVO_PIEZA_AUSENTE);
  const avisos: string[] = [];
  const cambios = new Map<string, PiezaEspec>();
  let destino: TamanosEspec | null = null;
  let limite = false;
  for (const pieza of seleccion.piezas) {
    if (UN_SOLO_TAMANO.has(pieza.oficial)) { if (edicion.pieza) avisos.push(`${conArticulo(pieza)} lleva globos de un solo tamaño: no tiene proporción de tamaños que mover.`); continue; }
    const posicion = ESCALA_TAMANOS.indexOf(pieza.tamanos) + edicion.direccion;
    if (posicion < 0 || posicion >= ESCALA_TAMANOS.length) { limite = true; continue; }
    destino = ESCALA_TAMANOS[posicion]!;
    if (SE_ARMA_EN_CUARTETOS.has(pieza.oficial) && (pieza.tamanos === "clasica") !== (destino === "clasica")) {
      avisos.push(destino === "clasica" ? `${conArticulo(pieza)} pasa a armarse en cuartetos de globos iguales.` : `${conArticulo(pieza)} pasa a armarse con globos de varios tamaños, ya no en cuartetos.`);
    }
    cambios.set(pieza.id, medidasAlRangoDeLosGlobos({ ...pieza, tamanos: destino }, avisos));
  }
  if (!cambios.size) return noAplicado(espec, limite ? `${edicion.pieza ? conArticulo(seleccion.piezas[0]!) : "tus piezas"} ya llevan los globos ${edicion.direccion > 0 ? "más grandes" : "más pequeños"} que se arman.` : "esas piezas llevan globos de un solo tamaño.", avisos);
  const nueva = conPiezasCambiadas(espec, cambios);
  const tocadas = nueva.piezas.filter((pieza) => cambios.has(pieza.id));
  const frase = tocadas.length === 1 || new Set(tocadas.map((pieza) => pieza.tamanos)).size === 1 ? FRASE_TAMANOS[destino!] : `globos ${edicion.direccion > 0 ? "más grandes" : "más pequeños"}`;
  return { espec: nueva, avisos, descripcion: `puse ${frase} ${enPiezas(espec, tocadas)}`, tocadas: tocadas.map((pieza) => pieza.id) };
}

// --- Quitar y sumar piezas ----------------------------------------------------------------------------------------

export function quitarPieza(espec: EspecClienteV1, edicion: Op<"quitar_pieza">): ResultadoEdicion {
  const pieza = espec.piezas.find((item) => item.id === edicion.pieza);
  if (!pieza) return noAplicado(espec, MOTIVO_PIEZA_AUSENTE);
  if (espec.piezas.length <= 1) return noAplicado(espec, "tu plan necesita al menos una pieza.");
  return { espec: { ...espec, origen: origenEditado(espec), piezas: espec.piezas.filter((item) => item.id !== pieza.id) }, avisos: [], descripcion: `quité ${conArticulo(pieza)}`, tocadas: [pieza.id] };
}

const NUMERO_DE_ID = /^EST_(\d{2})_/;

/** El id de una pieza nueva: el primer número libre, y el sufijo de su oficial (`EST_04_GUIRNALDA`). */
function idNuevo(espec: EspecClienteV1, oficial: PiezaEspec["oficial"]): string {
  const usados = new Set(espec.piezas.map((pieza) => pieza.id));
  const mayor = Math.max(0, ...espec.piezas.map((pieza) => Number(NUMERO_DE_ID.exec(pieza.id)?.[1] ?? 0)));
  for (let numero = mayor + 1; numero < 100; numero += 1) {
    const id = `EST_${String(numero).padStart(2, "0")}_${oficial.toUpperCase()}`;
    if (!usados.has(id)) return id;
  }
  for (let numero = 1; numero < mayor; numero += 1) {
    const id = `EST_${String(numero).padStart(2, "0")}_${oficial.toUpperCase()}`;
    if (!usados.has(id)) return id;
  }
  return `EST_99_${oficial.toUpperCase()}`;
}

function lugarNuevo(espec: EspecClienteV1, oficial: PiezaEspec["oficial"], pedido: PiezaEspec["lugar"] | undefined): PiezaEspec["lugar"] {
  if (pedido) return pedido;
  if (PIEZAS_CON_LADO.has(oficial)) {
    const ocupa = (lugar: PiezaEspec["lugar"]) => espec.piezas.some((pieza) => pieza.oficial === oficial && pieza.lugar === lugar);
    if (!ocupa("izquierda")) return "izquierda";
    if (!ocupa("derecha")) return "derecha";
  }
  return LUGAR_POR_OFICIAL[oficial] ?? "centro";
}

function nombreNuevo(espec: EspecClienteV1, oficial: PiezaEspec["oficial"], lugar: PiezaEspec["lugar"]): string {
  const base = ESTRUCTURAS_OFICIALES[oficial].nombre;
  const lado = (lugar === "izquierda" || lugar === "derecha") && PIEZAS_CON_LADO.has(oficial) ? ` ${lugar === "izquierda" ? (esFemenina(oficial) ? "izquierda" : "izquierdo") : (esFemenina(oficial) ? "derecha" : "derecho")}` : "";
  const propuesto = `${base}${lado}`;
  const usados = new Set(espec.piezas.map((pieza) => pieza.nombre));
  if (!usados.has(propuesto)) return propuesto;
  for (let numero = 2; numero < 20; numero += 1) if (!usados.has(`${propuesto} ${numero}`)) return `${propuesto} ${numero}`;
  return propuesto;
}

const esFemenina = (oficial: PiezaEspec["oficial"]): boolean => FEMENINAS.has(oficial);

/** Los colores del plan, de los que más pesan a los que menos, a partes proporcionales (los de una pieza nueva sin colores dichos). */
function coloresDelPlan(espec: EspecClienteV1): ColorEspec[] {
  const suma = new Map<string, ColorEspec>();
  for (const pieza of espec.piezas) for (const color of pieza.colores) {
    const previo = suma.get(color.codigo);
    suma.set(color.codigo, previo ? { ...previo, peso: previo.peso + color.peso } : { ...color });
  }
  const principales = [...suma.values()].sort((a, b) => b.peso - a.peso).slice(0, 4);
  return conPesosNormalizados(principales);
}

export function agregarPieza(espec: EspecClienteV1, edicion: Op<"agregar_pieza">): ResultadoEdicion {
  const oficial = ESTRUCTURAS_OFICIALES[edicion.oficial];
  if (espec.piezas.length >= MAX_PIEZAS_PLAN) return noAplicado(espec, `tu plan ya tiene el máximo de ${MAX_PIEZAS_PLAN} piezas.`);
  const avisos: string[] = [];
  const lugar = lugarNuevo(espec, edicion.oficial, edicion.lugar);
  const base: PiezaEspec = {
    id: idNuevo(espec, edicion.oficial),
    oficial: edicion.oficial,
    nombre: nombreNuevo(espec, edicion.oficial, lugar),
    lugar,
    medidas: {},
    colores: [{ codigo: "005", nombre: "blanco", peso: 1 }],
    tamanos: edicion.organica ? "organica_fina" : TAMANOS_POR_DEFECTO[edicion.oficial],
    ...(DENSIDAD_POR_DEFECTO[edicion.oficial] ? { densidad: DENSIDAD_POR_DEFECTO[edicion.oficial]! } : {}),
    ...(UNIDADES_POR_DEFECTO[edicion.oficial] ? { unidades: UNIDADES_POR_DEFECTO[edicion.oficial]! } : {}),
  };
  const representacion = representacionDe(base);
  if (representacion.estado === "fallback") return noAplicado(espec, `${oficial.nombre.toLocaleLowerCase("es")} todavía no la puedo armar en 3D.`);
  // Los colores: los que dijo el cliente o, si no dijo ninguno, los del plan.
  let colores: ColorEspec[];
  if (edicion.colores?.length) {
    const resueltos = edicion.colores.flatMap((palabra) => {
      const hallados = resolverColorDicho(palabra);
      if (!hallados.length) avisos.push(`No reconocí el color «${palabra}»: no lo usé.`);
      return hallados.map((color) => ({ ...color, peso: 1 / Math.max(1, edicion.colores!.length * hallados.length) }));
    });
    if (!resueltos.length) return noAplicado(espec, "no reconozco ninguno de esos colores.", avisos);
    colores = colorConPesos(resueltos, MAX_COLORES_PIEZA, avisos).map((color) => ({ ...color }));
  } else {
    colores = coloresDelPlan(espec);
  }
  const fabricables = colores.map((color) => ({ ...colorFabricable(color, base, avisos), peso: color.peso }));
  const conColores: PiezaEspec = { ...base, colores: conPesosNormalizados(fabricables.length ? fabricables : [{ codigo: "005", nombre: "blanco", peso: 1 }]) };
  // Las medidas: las que dijo el cliente, acotadas, o las estándar de esa pieza.
  const estandar = esOficialAgregable(edicion.oficial) ? MEDIDAS_ESTANDAR[edicion.oficial] : {};
  const sugeridas: MedidasEspec = { ...(estandar.ancho_m ? { anchoM: estandar.ancho_m } : {}), ...(estandar.alto_m ? { altoM: estandar.alto_m } : {}), ...(estandar.largo_m ? { largoM: estandar.largo_m } : {}) };
  const editables = medidasEditables(conColores);
  const pedidas = edicion.medidas ? medidasPedidas(conColores, edicion.medidas, editables, avisos) : {};
  const partida = Object.keys(pedidas).length ? pedidas : sugeridas;
  const medidas: MedidasEspec = {};
  for (const [campo, valor] of Object.entries(partida) as Array<[CampoMedida, number]>) {
    const rango = editables[campo];
    if (rango) medidas[campo] = acotar(campo, valor, rango, conColores, avisos);
  }
  if (conColores.oficial === "aro_circular" && medidas.anchoM !== undefined) medidas.altoM = medidas.anchoM;
  const nueva: PiezaEspec = { ...conColores, medidas: Object.keys(medidas).length ? medidas : MEDIDAS_POR_DEFECTO[edicion.oficial] };
  if (representacion.estado === "aproximada" && representacion.motivo) avisos.push(`${nueva.nombre}: ${representacion.motivo}`);
  const resultado: EspecClienteV1 = { ...espec, origen: origenEditado(espec), piezas: [...espec.piezas, nueva] };
  const lugarTexto = lugar === "izquierda" ? " a la izquierda" : lugar === "derecha" ? " a la derecha" : lugar === "fondo" ? " al fondo" : lugar === "techo" ? " en el techo" : lugar === "mesa" ? " sobre la mesa" : " en el centro";
  return { espec: resultado, avisos, descripcion: `añadí ${conArticulo(nueva)}${lugarTexto} en ${listaNatural(nueva.colores.map(nombreColor))}`, tocadas: [nueva.id] };
}

/** «Agregar a mi plan» una idea del catálogo: las piezas de la idea se suman a las del plan (que quedan intactas). */
export function agregarIdea(espec: EspecClienteV1, edicion: Op<"agregar_idea">, idea: EspecClienteV1 | null): ResultadoEdicion {
  if (!idea) return noAplicado(espec, "no encontré esa idea del catálogo.");
  const suma = sumarIdeaAEspec(espec, idea, edicion.ideaId);
  if (!suma.ok) return noAplicado(espec, `sumar esa idea pasaría del máximo de ${suma.maximo} piezas de un plan.`);
  const nuevas = suma.espec.piezas.filter((pieza) => suma.nuevas.includes(pieza.id));
  return { espec: suma.espec, avisos: [], descripcion: `añadí ${listaNatural(nuevas.map(conArticulo))} de esa idea`, tocadas: suma.nuevas };
}

// --- Flores de globo ------------------------------------------------------------------------------------------------

const FORMATO_FLOR = ["R-5"] as const;

export function floresPieza(espec: EspecClienteV1, edicion: Op<"flores">): ResultadoEdicion {
  const pieza = espec.piezas.find((item) => item.id === edicion.pieza);
  if (!pieza) return noAplicado(espec, MOTIVO_PIEZA_AUSENTE);
  const { flores: _anteriores, ...sinFlores } = pieza;
  if (edicion.flores === null) {
    if (!pieza.flores) return noAplicado(espec, `${conArticulo(pieza)} no lleva flores de globo.`);
    return { espec: conPiezasCambiadas(espec, new Map([[pieza.id, sinFlores]])), avisos: [], descripcion: `quité las flores de globo de ${conArticulo(pieza)}`, tocadas: [pieza.id] };
  }
  const avisos: string[] = [];
  const petalo = colorFabricable({ codigo: edicion.flores.codigo, nombre: nombreDeCodigo(edicion.flores.codigo) }, pieza, avisos, FORMATO_FLOR);
  const centro = edicion.flores.centro ? colorFabricable({ codigo: edicion.flores.centro, nombre: nombreDeCodigo(edicion.flores.centro) }, pieza, avisos, FORMATO_FLOR) : null;
  const flores = { cantidad: edicion.flores.cantidad, petalos: edicion.flores.petalos, codigo: petalo.codigo, ...(centro && centro.codigo !== petalo.codigo ? { centro: centro.codigo } : {}) };
  if (pieza.flores && JSON.stringify(pieza.flores) === JSON.stringify(flores)) return noAplicado(espec, `${conArticulo(pieza)} ya lleva esas flores.`, avisos);
  const dicho = `${flores.cantidad} ${flores.cantidad === 1 ? "flor" : "flores"} de globo ${nombreColor(petalo)}${centro && flores.centro ? ` con centro ${nombreColor(centro)}` : ""}`;
  return { espec: conPiezasCambiadas(espec, new Map([[pieza.id, { ...pieza, flores }]])), avisos, descripcion: `puse ${dicho} en ${conArticulo(pieza)}`, tocadas: [pieza.id] };
}

// --- Lado ---------------------------------------------------------------------------------------------------------------

const TERMINA_EN_LADO = /\s(?:izquierd[ao]|derech[ao])$/i;

export function ladoPieza(espec: EspecClienteV1, edicion: Op<"lado">): ResultadoEdicion {
  const pieza = espec.piezas.find((item) => item.id === edicion.pieza);
  if (!pieza) return noAplicado(espec, MOTIVO_PIEZA_AUSENTE);
  if (pieza.lugar === "techo" || pieza.lugar === "mesa") return noAplicado(espec, `${conArticulo(pieza)} ${pieza.lugar === "techo" ? "va en el techo" : "va sobre la mesa"}, no a un lado.`);
  if (pieza.lugar === edicion.lado) return noAplicado(espec, `${conArticulo(pieza)} ya está a la ${edicion.lado}.`);
  const avisos: string[] = [];
  const masculino = !esFemenina(pieza.oficial);
  const nombre = TERMINA_EN_LADO.test(pieza.nombre)
    ? pieza.nombre.replace(TERMINA_EN_LADO, ` ${edicion.lado === "izquierda" ? (masculino ? "izquierdo" : "izquierda") : (masculino ? "derecho" : "derecha")}`)
    : pieza.nombre;
  if (nombre !== pieza.nombre && espec.piezas.some((otra) => otra.id !== pieza.id && otra.nombre === nombre)) avisos.push(`Ya había ${nombre.toLocaleLowerCase("es")}: las dos quedan del mismo lado.`);
  const ocupante = espec.piezas.find((otra) => otra.id !== pieza.id && otra.oficial === pieza.oficial && otra.lugar === edicion.lado);
  if (ocupante && !avisos.length) avisos.push(`A la ${edicion.lado} ya estaba ${conArticulo(ocupante)}: quedan juntas.`);
  return { espec: conPiezasCambiadas(espec, new Map([[pieza.id, { ...pieza, lugar: edicion.lado, nombre }]])), avisos, descripcion: `pasé ${conArticulo(pieza)} a la ${edicion.lado}`, tocadas: [pieza.id] };
}
