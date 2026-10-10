import type { PedidoEdicionPlan } from "@/lib/ia/guiado/edicion-plan-chat";
import { FLORES_POR_DEFECTO, PETALOS_FLOR_POR_DEFECTO } from "@/lib/plan/flores-pieza";
import type { UbicacionPiezaNueva } from "@/lib/plan/pieza-nueva";
import type { CambioPanelV1 } from "./cambio-panel-v1";
import { conArticulo, plegar, resolverColorDicho } from "./ediciones-comunes";
import { PROPORCION_MINIMA } from "./ediciones-color";
import type { EdicionEspecV1 } from "./edicion-espec-v1";
import { MAX_FLORES, MAX_PETALOS, MIN_PETALOS, type EspecClienteV1, type LugarEspec, type PiezaEspec } from "./espec-cliente-v1";
import { medidasEditables } from "./rangos-medidas";

/**
 * **De lo que el cliente ya sabe pedir a las ediciones de la espec** (REQ-007, fase 5). Dos puertas, una sola salida:
 * el pedido del chat (`PedidoEdicionPlan`: las 10 herramientas `HERRAMIENTAS_EDICION`) y el cambio del panel «Ajustar mi
 * plan» (`CambioPanelV1`: el `CambioPlan` de la pantalla) se convierten en `EdicionEspecV1[]`. Lo que el motor 3D no hace por
 * decisión (renombrar, mover a otro sitio que no sea un lado: D-020, Q4) vuelve como `no_soportado`, con la frase para el
 * cliente: nunca se ejecuta algo parecido en silencio (D-023). Una pieza que el pedido nombra y el plan no tiene vuelve como
 * `no_encontrado`. Puro.
 */
export type RechazoDePedido = {
  ok: false;
  tipo: "no_soportado" | "no_encontrado" | "no_aplicable";
  /** Qué quedó sin hacer, en una frase corta y sin jerga (para el registro). */
  motivo: string;
  /** Lo que se le dice al cliente: empieza por «No pude:». */
  mensaje: string;
};
export type EdicionesDePedido = { ok: true; ediciones: EdicionEspecV1[]; avisos: string[] } | RechazoDePedido;

const rechazo = (tipo: RechazoDePedido["tipo"], motivo: string, mensaje: string): RechazoDePedido => ({ ok: false, tipo, motivo, mensaje: `No pude: ${mensaje}` });
const bien = (ediciones: EdicionEspecV1[], avisos: string[] = []): EdicionesDePedido => ({ ok: true, ediciones, avisos });
const NO_ENCONTRADA = rechazo("no_encontrado", "pieza_no_encontrada", "no encontré esa pieza en tu plan.");

/** Los ids de las piezas con esos nombres (como los muestra la tarjeta). Null si algún nombre no es de una pieza del plan. */
function idsDeNombres(espec: EspecClienteV1, nombres: readonly string[]): string[] | null {
  const ids: string[] = [];
  for (const nombre of nombres) {
    const delNombre = espec.piezas.filter((pieza) => plegar(pieza.nombre) === plegar(nombre));
    if (!delNombre.length) return null;
    for (const pieza of delNombre) if (!ids.includes(pieza.id)) ids.push(pieza.id);
  }
  return ids;
}

const LUGAR_DE_UBICACION: Readonly<Record<UbicacionPiezaNueva, LugarEspec>> = {
  centro: "centro", arriba: "fondo", fondo: "fondo", izquierda: "izquierda", derecha: "derecha", piso: "centro", entrada: "centro", mesa: "mesa", techo: "techo",
};

/** La pieza que hace pareja con otra (la misma pieza en el lado contrario): para «hacer lo mismo en la otra». */
export function parejaDe(espec: EspecClienteV1, pieza: PiezaEspec): PiezaEspec | null {
  const contrario = pieza.lugar === "izquierda" ? "derecha" : pieza.lugar === "derecha" ? "izquierda" : null;
  return contrario ? espec.piezas.find((otra) => otra.id !== pieza.id && otra.oficial === pieza.oficial && otra.lugar === contrario) ?? null : null;
}

const conPareja = (espec: EspecClienteV1, pieza: PiezaEspec, pareja: boolean | undefined): string[] => {
  const otra = pareja ? parejaDe(espec, pieza) : null;
  return otra ? [pieza.id, otra.id] : [pieza.id];
};

// --- El pedido del chat ---------------------------------------------------------------------------------------

/** Cómo se convierte cada herramienta del chat: la tabla que prueba `test-motor-guiada-ediciones-mapeo.ts`. */
export function edicionDesdePedido(espec: EspecClienteV1, pedido: PedidoEdicionPlan): EdicionesDePedido {
  switch (pedido.tipo) {
    case "reemplazar_color": {
      const ids = idsDeNombres(espec, pedido.piezas);
      if (!ids) return NO_ENCONTRADA;
      return bien([{ op: "reemplazar_color", de: pedido.color, a: pedido.colorNuevo, ...(ids.length ? { piezas: ids } : {}) }]);
    }
    case "agregar_color": {
      const ids = idsDeNombres(espec, pedido.piezas);
      if (!ids) return NO_ENCONTRADA;
      return bien(pedido.colores.map((color): EdicionEspecV1 => ({ op: "agregar_color", color, ...(ids.length ? { piezas: ids } : {}) })));
    }
    case "quitar_color": {
      const ids = idsDeNombres(espec, pedido.piezas);
      if (!ids) return NO_ENCONTRADA;
      return bien([{ op: "quitar_color", color: pedido.color, ...(ids.length ? { piezas: ids } : {}) }]);
    }
    case "protagonismo": {
      const ids = idsDeNombres(espec, pedido.piezas);
      if (!ids) return NO_ENCONTRADA;
      return bien([{ op: "mas_menos_color", color: pedido.color, direccion: pedido.direccion, ...(ids.length ? { piezas: ids } : {}) }]);
    }
    case "quitar_pieza": {
      const ids = idsDeNombres(espec, pedido.piezas);
      if (!ids?.length) return NO_ENCONTRADA;
      if (ids.length >= espec.piezas.length) return rechazo("no_aplicable", "quitaria_todo", "tu plan necesita al menos una pieza.");
      return bien(ids.map((pieza): EdicionEspecV1 => ({ op: "quitar_pieza", pieza })));
    }
    case "tamano": {
      const ids = idsDeNombres(espec, pedido.piezas);
      if (!ids) return NO_ENCONTRADA;
      const piezas = ids.length ? espec.piezas.filter((pieza) => ids.includes(pieza.id)) : espec.piezas.filter((pieza) => Object.keys(medidasEditables(pieza)).length > 0);
      return bien(piezas.map((pieza): EdicionEspecV1 => ({ op: "tamano_pieza", pieza: pieza.id, direccion: pedido.direccion })));
    }
    case "medidas": {
      const ids = idsDeNombres(espec, pedido.piezas);
      if (!ids?.length) return NO_ENCONTRADA;
      const medidas = medidasDeWire(pedido.medidas);
      return bien(ids.map((pieza): EdicionEspecV1 => ({ op: "tamano_pieza", pieza, medidas })));
    }
    case "agregar_pieza": {
      const { estructura, ubicacion, medidas, colores, organica } = pedido.pieza;
      return bien([{
        op: "agregar_pieza", oficial: estructura,
        ...(ubicacion ? { lugar: LUGAR_DE_UBICACION[ubicacion] } : {}),
        ...(medidas && Object.keys(medidas).length ? { medidas: medidasDeWire(medidas) } : {}),
        ...(colores.length ? { colores: [...colores] } : {}),
        ...(organica ? { organica: true } : {}),
      }]);
    }
    case "colores_pieza": return coloresDePieza(espec, pedido);
    case "mover_pieza": {
      const ids = idsDeNombres(espec, [pedido.pieza]);
      if (!ids?.length) return NO_ENCONTRADA;
      if (pedido.ubicacion !== "izquierda" && pedido.ubicacion !== "derecha") return rechazo("no_soportado", "mover_a_otro_lugar", "por ahora solo puedo pasar una pieza a la izquierda o a la derecha; los demás lugares no los puedo elegir.");
      return bien([{ op: "lado", pieza: ids[0]!, lado: pedido.ubicacion }]);
    }
    case "renombrar_pieza": return rechazo("no_soportado", "renombrar_pieza", "por ahora no puedo cambiarle el nombre a una pieza.");
    case "flores": return floresDePedido(espec, pedido);
  }
}

function medidasDeWire(medidas: { ancho_m?: number | undefined; alto_m?: number | undefined; largo_m?: number | undefined }) {
  return { ...(medidas.ancho_m ? { anchoM: medidas.ancho_m } : {}), ...(medidas.alto_m ? { altoM: medidas.alto_m } : {}), ...(medidas.largo_m ? { largoM: medidas.largo_m } : {}) };
}

/** «Cambia la guirnalda a dorado»: deja la pieza en esos colores con cambios, sumas y quitas sobre lo que ya lleva (sin rehacerla). */
function coloresDePieza(espec: EspecClienteV1, pedido: Extract<PedidoEdicionPlan, { tipo: "colores_pieza" }>): EdicionesDePedido {
  const ids = idsDeNombres(espec, pedido.piezas);
  if (!ids?.length) return NO_ENCONTRADA;
  const pedidos = pedido.colores.flatMap((palabra) => resolverColorDicho(palabra));
  if (!pedidos.length) return rechazo("no_aplicable", "color_no_reconocido", "no reconozco ese color.");
  const ediciones: EdicionEspecV1[] = [];
  for (const id of ids) {
    const pieza = espec.piezas.find((item) => item.id === id)!;
    const faltan = pedidos.filter((pedida) => !pieza.colores.some((color) => color.codigo === pedida.codigo));
    let sobran = pieza.colores.filter((color) => !pedidos.some((pedida) => pedida.codigo === color.codigo));
    for (const falta of faltan) {
      const sale = sobran[0];
      if (sale) {
        ediciones.push({ op: "reemplazar_color", de: sale.codigo, a: falta.codigo, piezas: [id] });
        sobran = sobran.slice(1);
      } else {
        ediciones.push({ op: "agregar_color", color: falta.codigo, piezas: [id] });
      }
    }
    for (const sobra of sobran) ediciones.push({ op: "quitar_color", color: sobra.codigo, piezas: [id] });
  }
  return ediciones.length ? bien(ediciones) : rechazo("no_aplicable", "ya_van_en_esos_colores", "esas piezas ya van en esos colores.");
}

function floresDePedido(espec: EspecClienteV1, pedido: Extract<PedidoEdicionPlan, { tipo: "flores" }>): EdicionesDePedido {
  const ids = idsDeNombres(espec, pedido.piezas);
  if (!ids) return NO_ENCONTRADA;
  const piezas = ids.length ? espec.piezas.filter((pieza) => ids.includes(pieza.id)) : espec.piezas;
  if (pedido.quitar) {
    const conFlores = piezas.filter((pieza) => pieza.flores);
    if (!conFlores.length) return rechazo("no_aplicable", "sin_flores", `${ids.length === 1 ? conArticulo(piezas[0]!) : "tu plan"} no lleva flores de globo.`);
    return bien(conFlores.map((pieza): EdicionEspecV1 => ({ op: "flores", pieza: pieza.id, flores: null })));
  }
  const ediciones: EdicionEspecV1[] = [];
  for (const pieza of piezas) {
    const petalo = colorDeFlor(espec, pieza, pedido.colorPetalo) ?? pieza.colores[0]!.codigo;
    if (pedido.colorPetalo && !colorDeFlor(espec, pieza, pedido.colorPetalo)) return rechazo("no_aplicable", "color_de_flor_desconocido", `no reconozco el color ${pedido.colorPetalo} para las flores.`);
    const centro = pedido.colorCentro ? colorDeFlor(espec, pieza, pedido.colorCentro) : (pieza.colores.find((color) => color.codigo !== petalo)?.codigo ?? null);
    if (pedido.colorCentro && !centro) return rechazo("no_aplicable", "color_de_centro_desconocido", `no reconozco el color ${pedido.colorCentro} para el centro de las flores.`);
    const cantidad = Math.min(MAX_FLORES, pedido.cantidad ?? pieza.flores?.cantidad ?? FLORES_POR_DEFECTO);
    const petalos = Math.min(MAX_PETALOS, Math.max(MIN_PETALOS, pieza.flores?.petalos ?? PETALOS_FLOR_POR_DEFECTO));
    ediciones.push({ op: "flores", pieza: pieza.id, flores: { cantidad, petalos, codigo: petalo, ...(centro && centro !== petalo ? { centro } : {}) } });
  }
  return ediciones.length ? bien(ediciones) : rechazo("no_aplicable", "sin_piezas", "no encontré dónde poner flores.");
}

/** El código del color de unas flores: el que la pieza (o el plan) ya lleva con ese nombre o, si no, el que dice la palabra. */
function colorDeFlor(espec: EspecClienteV1, pieza: PiezaEspec, dicho: string | null): string | null {
  if (!dicho) return null;
  const plegado = plegar(dicho);
  const delPlan = [...pieza.colores, ...espec.piezas.flatMap((otra) => otra.colores)].find((color) => plegar(color.nombre) === plegado || color.codigo === dicho);
  return delPlan?.codigo ?? resolverColorDicho(dicho)[0]?.codigo ?? null;
}

// --- El cambio del panel ----------------------------------------------------------------------------------------

export function edicionDesdeCambio(espec: EspecClienteV1, cambio: CambioPanelV1): EdicionesDePedido {
  const pieza = "estructuraId" in cambio ? espec.piezas.find((item) => item.id === cambio.estructuraId) : undefined;
  if ("estructuraId" in cambio && !pieza) return NO_ENCONTRADA;
  switch (cambio.tipo) {
    case "protagonismo": {
      const color = pieza!.colores[cambio.indice];
      if (!color) return rechazo("no_encontrado", "color_no_encontrado", "no encontré ese color en la pieza.");
      return bien([{ op: "mas_menos_color", color: color.codigo, direccion: cambio.direccion, piezas: conPareja(espec, pieza!, cambio.pareja) }]);
    }
    case "cantidad": return cantidadAProporcion(espec, pieza!, cambio);
    case "tamano":
      return bien(conPareja(espec, pieza!, cambio.pareja).map((id): EdicionEspecV1 => ({ op: "tamano_pieza", pieza: id, direccion: cambio.direccion })));
    case "medidas": {
      const medidas = medidasDeWire(cambio.medidas);
      return bien(conPareja(espec, pieza!, cambio.pareja).map((id): EdicionEspecV1 => ({ op: "tamano_pieza", pieza: id, medidas })));
    }
    case "quitar-color": {
      const color = pieza!.colores[cambio.indice];
      if (!color) return rechazo("no_encontrado", "color_no_encontrado", "no encontré ese color en la pieza.");
      return bien([{ op: "quitar_color", color: color.codigo, piezas: conPareja(espec, pieza!, cambio.pareja) }]);
    }
    case "agregar-color":
      return bien([{ op: "agregar_color", color: cambio.color, ...(cambio.estructuraIds?.length ? { piezas: cambio.estructuraIds } : {}) }]);
    case "reemplazar-color":
      return bien([{ op: "reemplazar_color", de: cambio.codigo ?? cambio.color, a: cambio.nuevo, ...(cambio.estructuraIds?.length ? { piezas: cambio.estructuraIds } : {}) }]);
    case "tamano-todo": {
      const piezas = espec.piezas.filter((item) => Object.keys(medidasEditables(item)).length > 0);
      return piezas.length ? bien(piezas.map((item): EdicionEspecV1 => ({ op: "tamano_pieza", pieza: item.id, direccion: cambio.direccion }))) : rechazo("no_aplicable", "sin_medidas", "ninguna de tus piezas se mide en metros.");
    }
    case "quitar-pieza":
      return espec.piezas.length <= 1 ? rechazo("no_aplicable", "quitaria_todo", "tu plan necesita al menos una pieza.") : bien([{ op: "quitar_pieza", pieza: cambio.estructuraId }]);
    case "tamano-globos":
      return bien(conPareja(espec, pieza!, cambio.pareja).map((id): EdicionEspecV1 => ({ op: "tamano_globos", pieza: id, direccion: cambio.direccion })));
  }
}

/**
 * «Que lleve N globos de este color»: el panel dice cuántos lleva hoy (`desde`) y cuántos quiere (`objetivo`). Con la
 * parte que ese color tiene hoy se saca el total de la pieza y la parte nueva es `objetivo / total`; los demás colores
 * conservan su proporción entre sí.
 */
function cantidadAProporcion(espec: EspecClienteV1, pieza: PiezaEspec, cambio: Extract<CambioPanelV1, { tipo: "cantidad" }>): EdicionesDePedido {
  const color = pieza.colores[cambio.indice];
  if (!color) return rechazo("no_encontrado", "color_no_encontrado", "no encontré ese color en la pieza.");
  if (pieza.colores.length < 2) return rechazo("no_aplicable", "un_solo_color", `${conArticulo(pieza)} lleva un solo color: para variar cuántos globos lleva de cada uno añade otro color.`);
  if (cambio.desde <= 0) return rechazo("no_aplicable", "sin_cantidad_actual", "no sé cuántos globos lleva hoy ese color en la pieza.");
  const total = cambio.desde / color.peso;
  const parte = Math.min(1 - (pieza.colores.length - 1) * PROPORCION_MINIMA, Math.max(PROPORCION_MINIMA, cambio.objetivo / total));
  const ediciones = conPareja(espec, pieza, cambio.pareja).flatMap((id): EdicionEspecV1[] => {
    const destino = espec.piezas.find((item) => item.id === id)!;
    const propio = destino.colores.find((item) => item.codigo === color.codigo);
    if (!propio) return [];
    const otros = 1 - propio.peso;
    const pesos = destino.colores.map((item) => (item.codigo === color.codigo ? parte : otros > 0 ? item.peso * ((1 - parte) / otros) : (1 - parte) / (destino.colores.length - 1)));
    return [{ op: "proporcion_color", pieza: id, pesos }];
  });
  return ediciones.length ? bien(ediciones) : rechazo("no_aplicable", "color_no_esta", "ese color no está en la pieza.");
}
