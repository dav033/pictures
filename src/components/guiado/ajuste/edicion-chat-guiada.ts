import type { CandidatoDelServidor } from "@/components/plan/ajuste/ajuste-propuesta";
import type { PedidoEdicionPlan } from "@/lib/ia/guiado/edicion-plan-chat";
import { FalloPlanEditar } from "@/lib/plan/peticion-plan-editar";
import { esGloboDelTono, tonoDelTitulo } from "@/lib/plan/tonos-color";
import { familiaDeColorPropuesta, plegarTexto, tonoClaroDe, TONOS_V2, type TonoClaroV2 } from "@/lib/rag/taxonomy/v2";
import { familiaSempertex } from "../color-globo";
import { colorCliente } from "../formato";
import {
  confirmacionDelCambio,
  describirCambio,
  edicionProtagonismo,
  edicionQuitarColor,
  edicionTamano,
  indiceDeColor,
  medidasEditables,
  parejaDe,
  piezaConArticulo,
  sinGloboLiso,
  type CambioPlan,
  type GloboParaPlan,
  type MedidasObjetivo,
  type PlanGuiado,
} from "./ajuste-plan-guiado";
import { ejecutarCambio, type DependenciasAjuste, type PlanFirmado } from "./ejecutar-ajuste";
import { globosDeCandidatos, planConImpresos, type GloboCatalogo } from "./selector-globos";

/**
 * Un cambio pedido POR CHAT sobre el plan vigente de la guiada (`PedidoEdicionPlan`, de `edicion-plan-chat.ts`), hecho
 * con los MISMOS cambios del editor «Ajustar mi plan» (`CambioPlan` → `ejecutarCambio` → `/api/plan-editar`): Python
 * vuelve a resolver y a firmar el plan, y lo que no se pidió (título, medidas, acabados, demás colores y piezas) queda
 * igual. Antes el chat rehacía el plan entero con /api/chat (probador 104, 2026-10-07).
 *
 * Sin React: la red llega por `DependenciasEdicionChat` (en la vista, `/api/plan-editar`; en las pruebas, dobles sin
 * coste). Aquí no se cuenta ningún globo.
 */

export type DependenciasEdicionChat = Pick<DependenciasAjuste, "aplicar" | "quitarPieza" | "agregarColor" | "reemplazarColor"> & {
  /**
   * Globos lisos del catálogo de una familia de color (la búsqueda del selector de «Cambiar»). `palabra`: la del tono
   * pedido («celeste»), para que sus globos lleguen primero entre todos los azules.
   */
  buscarGlobos: (familia: string, approvalToken: string, palabra: string | null) => Promise<readonly CandidatoDelServidor[]>;
};

/** El globo del catálogo que se eligió para un color pedido, y por qué. */
export type GloboElegidoChat = { globo: GloboParaPlan; titulo: string; acabado: string | null; candidatos: number; cubreTamanos: boolean };

export type EdicionChatHecha = PlanFirmado & {
  /** La línea corta del historial y de «Último ajuste: …» («Fashion Azul Celeste en lugar de azul en las columnas»). */
  descripcion: string;
  /** Lo que dice el chat al terminar («Listo: …; medidas y demás colores quedaron igual.»). */
  confirmacion: string;
  cambios: CambioPlan[];
  globos: GloboElegidoChat[];
};

/** Lo que dice el chat mientras Python rehace el plan. */
export function avisoEdicionChat(pedido: PedidoEdicionPlan): string {
  switch (pedido.tipo) {
    case "reemplazar_color": return `Cambio el ${nombreColor(pedido.color)} por ${nombreColor(pedido.colorNuevo)}; medidas y demás colores quedan igual…`;
    case "agregar_color": return `Añado ${pedido.colores.map(nombreColor).join(" y ")}; tus piezas conservan sus medidas…`;
    case "quitar_color": return `Quito el ${nombreColor(pedido.color)}; lo demás queda igual…`;
    case "protagonismo": return `Pongo ${pedido.direccion > 0 ? "más" : "menos"} ${nombreColor(pedido.color)}; lo demás queda igual…`;
    case "quitar_pieza": return "Quito esa pieza; lo demás queda igual…";
    case "tamano": return `${pedido.direccion > 0 ? "Agrando" : "Achico"} ${pedido.piezas.length ? "esas piezas" : "tu decoración"} un poco…`;
    case "medidas": return "Ajusto la medida; lo demás queda igual…";
  }
}

function plegar(texto: string | null | undefined): string {
  return plegarTexto(texto ?? "");
}

function nombreColor(color: string): string {
  const tono = tonoClaroDe(color);
  return tono ? TONOS_V2[tono].nombre.toLocaleLowerCase("es") : colorCliente(color);
}

function fallo(mensaje: string): never {
  throw new FalloPlanEditar(mensaje);
}

/** Las estructuras del plan con esos nombres (sin tildes ni mayúsculas, como los compara el servidor). Null si falta alguno. */
export function estructurasDeNombres(plan: PlanGuiado, nombres: readonly string[]): string[] | null {
  const ids: string[] = [];
  for (const nombre of nombres) {
    const delNombre = plan.plan.estructuras.filter((estructura) => plegar(estructura.nombre) === plegar(nombre));
    if (!delNombre.length) return null;
    for (const estructura of delNombre) if (!ids.includes(estructura.estructura_id)) ids.push(estructura.estructura_id);
  }
  return ids;
}

/** Las piezas (de `ids`, o todas) que llevan ese color. */
function piezasConColor(plan: PlanGuiado, ids: readonly string[], color: string): string[] {
  return plan.plan.estructuras
    .filter((estructura) => (!ids.length || ids.includes(estructura.estructura_id)) && estructura.materiales.some((material) => plegar(material.color) === plegar(color)))
    .map((estructura) => estructura.estructura_id);
}

type Linea = { color: string; diam: number | null; titulo: string | null; productId: string };

function lineasDe(plan: PlanGuiado, ids: readonly string[]): Linea[] {
  return plan.estructuras
    .filter((estructura) => !ids.length || ids.includes(estructura.estructura_id))
    .flatMap((estructura) => (estructura.lineas ?? []).flatMap((linea) => {
      if (!linea || typeof linea !== "object") return [];
      const campos = linea as Record<string, unknown>;
      return [{
        color: plegar(typeof campos.color === "string" ? campos.color : ""),
        diam: typeof campos.diam_pulg === "number" ? campos.diam_pulg : null,
        titulo: typeof campos.titulo === "string" ? campos.titulo : null,
        productId: typeof campos.product_id === "string" ? campos.product_id : "",
      }];
    }));
}

/** Familias Sempertex en el orden en que se prefieren (la lisa de siempre primero), como en el selector de «Cambiar». */
const ORDEN_ACABADO = ["Fashion", "Pastel Matte", "Pastel Dusk", "Pastel", "Reflex", "Silk", "Satín", "Metal", "Neón", "Crystal", "Deluxe"];

/**
 * El globo del catálogo para un color pedido por chat, de lo que devolvió la búsqueda: de su familia y, si es un tono
 * claro («celeste»), de ESE tono (Fashion Azul Celeste, Pastel Mate Azul; nunca Reflex Azul). Prefiere el que trae
 * todos los tamaños que el color necesita (si no, Python no podría comprarlo en alguna medida), luego el mismo acabado
 * que el globo al que reemplaza («mismos acabados»), luego la lisa de siempre. Null si no hay ninguno.
 */
export function elegirGloboParaColor(globos: readonly GloboCatalogo[], pedido: { color: string; tamanos: readonly number[]; acabadoPreferido: string | null; excluir?: ReadonlySet<string> }): GloboElegidoChat | null {
  const familia = plegar(familiaDeColorPropuesta(plegar(pedido.color)));
  const tono = tonoClaroDe(pedido.color);
  const delColor = globos.filter((globo) => plegar(globo.color) === familia && !pedido.excluir?.has(globo.productId) && (!tono || esGloboDelTono(globo.titulo, tono, [globo.color])));
  if (!delColor.length) return null;
  const cubre = (globo: GloboCatalogo) => pedido.tamanos.every((tamano) => globo.tamanos.includes(tamano));
  const rangoAcabado = (globo: GloboCatalogo) => {
    const posicion = ORDEN_ACABADO.indexOf(globo.acabado ?? "");
    return posicion < 0 ? ORDEN_ACABADO.length : posicion;
  };
  const puntaje = (globo: GloboCatalogo): number[] => [
    cubre(globo) ? 0 : 1,
    // Sin tono pedido, un azul «de siempre» antes que un celeste: el cliente dijo «azul».
    !tono && tonoDelTitulo(globo.titulo) !== null ? 1 : 0,
    pedido.acabadoPreferido && globo.acabado === pedido.acabadoPreferido ? 0 : 1,
    rangoAcabado(globo),
    -globo.tamanos.length,
  ];
  const ordenados = [...delColor].sort((a, b) => {
    const [pa, pb] = [puntaje(a), puntaje(b)];
    for (let indice = 0; indice < pa.length; indice += 1) if (pa[indice] !== pb[indice]) return pa[indice]! - pb[indice]!;
    return a.nombre.localeCompare(b.nombre, "es");
  });
  const elegido = ordenados[0]!;
  return {
    globo: { productId: elegido.productId, color: elegido.color, variantIds: elegido.variantIds, nombre: elegido.nombre },
    titulo: elegido.titulo, acabado: elegido.acabado, candidatos: delColor.length, cubreTamanos: cubre(elegido),
  };
}

/** Busca y elige el globo de un color pedido; si no hay ninguno liso, el mensaje de siempre («No encontré globos lisos…»). */
async function globoPara(base: PlanGuiado, color: string, dependencias: DependenciasEdicionChat, preferencias: { acabadoPreferido: string | null; excluir?: ReadonlySet<string>; tamanos: readonly number[] }): Promise<GloboElegidoChat> {
  const familia = familiaDeColorPropuesta(plegar(color));
  const tono = tonoClaroDe(color);
  const conImpresos = planConImpresos(lineasDe(base, []).map((linea) => linea.titulo));
  const elegir = async (palabra: string | null) => elegirGloboParaColor(globosDeCandidatos(await dependencias.buscarGlobos(familia, base.approval_token, palabra), { conImpresos }), { color, ...preferencias });
  // Con un tono, primero la búsqueda con su palabra («celeste»); si no trae ninguno del tono, la de toda la familia.
  const elegido = (tono ? await elegir(palabraDeTono(tono)) : null) ?? await elegir(null);
  if (!elegido) fallo(sinGloboLiso(nombreColor(color)));
  return elegido;
}

/** La palabra con que el catálogo nombra un tono en sus títulos («celeste»; «pastel» para el rosa pastel). */
function palabraDeTono(tono: TonoClaroV2): string {
  return TONOS_V2[tono].titulo[0] ?? (TONOS_V2[tono].pastel ? "pastel" : TONOS_V2[tono].nombre.toLocaleLowerCase("es"));
}

function listaNatural(elementos: readonly string[]): string {
  if (elementos.length <= 1) return elementos[0] ?? "";
  return `${elementos.slice(0, -1).join(", ")} y ${elementos.at(-1)}`;
}

function conArticulo(plan: PlanGuiado, ids: readonly string[]): string {
  return listaNatural(ids.map((id) => {
    const estructura = plan.plan.estructuras.find((item) => item.estructura_id === id);
    return estructura ? piezaConArticulo(estructura) : "la pieza";
  }));
}

/** Las medidas pedidas que esa pieza deja escribir; si no deja ninguna de esas y se pidió una sola, su única medida. */
function medidasDePieza(plan: PlanGuiado, estructuraId: string, pedidas: MedidasObjetivo): MedidasObjetivo | null {
  const editables = medidasEditables(plan, estructuraId);
  const propias = Object.fromEntries(editables.flatMap((medida) => (pedidas[medida.campo] !== undefined ? [[medida.campo, pedidas[medida.campo]!]] : []))) as MedidasObjetivo;
  if (Object.keys(propias).length) return propias;
  const valores = Object.values(pedidas);
  return editables.length === 1 && valores.length === 1 ? { [editables[0]!.campo]: valores[0]! } : null;
}

/** Cambios de tamaño o de medida pieza por pieza: si su pareja (columna izquierda ↔ derecha) también va, en un solo cambio «a las dos». */
function conParejas(plan: PlanGuiado, ids: readonly string[], cambio: (estructuraId: string, pareja: boolean) => CambioPlan | null): CambioPlan[] {
  const hechos = new Set<string>();
  const cambios: CambioPlan[] = [];
  for (const id of ids) {
    if (hechos.has(id)) continue;
    const pareja = parejaDe(plan, id);
    const conPareja = Boolean(pareja && ids.includes(pareja.estructura_id));
    const uno = cambio(id, conPareja);
    hechos.add(id);
    if (conPareja && pareja) hechos.add(pareja.estructura_id);
    if (uno) cambios.push(uno);
  }
  return cambios;
}

/**
 * Hace el cambio pedido por chat sobre `base` con los cambios del editor, uno tras otro sobre el plan que deja el
 * anterior. Lanza `FalloPlanEditar` con el mensaje para el cliente si no se pudo; el plan que se ve no se toca hasta
 * que esto resuelve.
 */
export async function ejecutarEdicionChat(base: PlanGuiado, pedido: PedidoEdicionPlan, dependencias: DependenciasEdicionChat): Promise<EdicionChatHecha> {
  const ids = estructurasDeNombres(base, pedido.piezas);
  if (!ids) fallo("No encontré esa pieza en tu plan. Tu plan sigue como estaba.");
  const ajuste: DependenciasAjuste = { ...dependencias, buscar: async () => [] };
  const globos: GloboElegidoChat[] = [];
  const hechos: CambioPlan[] = [];
  let actual: PlanFirmado = { plan: base, cotizacion: undefined };
  /** Un cambio sobre el plan que dejó el anterior (`armar` lo calcula con ese plan: los índices pueden moverse). */
  const aplicar = async (armar: (plan: PlanGuiado) => CambioPlan | null): Promise<void> => {
    const cambio = armar(actual.plan);
    if (!cambio) return;
    const nuevo = await ejecutarCambio(cambio, actual.plan, ajuste);
    hechos.push(cambio);
    actual = { ...nuevo, piezas: [...new Set([...(actual.piezas ?? []), ...(nuevo.piezas ?? [])])] };
  };

  switch (pedido.tipo) {
    case "reemplazar_color": {
      const destino = piezasConColor(base, ids, pedido.color);
      if (!destino.length) fallo(`Tu plan no lleva ${nombreColor(pedido.color)}${ids.length ? " en esas piezas" : ""}. Tu plan sigue como estaba.`);
      const lineas = lineasDe(base, destino).filter((linea) => linea.color === plegar(pedido.color));
      const mismaFamilia = plegar(familiaDeColorPropuesta(plegar(pedido.colorNuevo))) === plegar(pedido.color);
      const elegido = await globoPara(base, pedido.colorNuevo, dependencias, {
        tamanos: [...new Set(lineas.flatMap((linea) => (linea.diam ? [linea.diam] : [])))],
        acabadoPreferido: familiaSempertex(lineas.find((linea) => linea.titulo)?.titulo)?.nombre ?? null,
        // Un celeste en lugar de un azul: el globo de siempre no cuenta como celeste.
        ...(mismaFamilia ? { excluir: new Set(lineas.map((linea) => linea.productId)) } : {}),
      });
      globos.push(elegido);
      await aplicar(() => ({ tipo: "reemplazar-color", color: pedido.color, ...(ids.length ? { estructuraIds: destino } : {}), globo: elegido.globo }));
      break;
    }
    case "agregar_color": {
      for (const color of pedido.colores) {
        const elegido = await globoPara(base, color, dependencias, {
          tamanos: [...new Set(lineasDe(base, ids).flatMap((linea) => (linea.diam ? [linea.diam] : [])))],
          acabadoPreferido: null,
        });
        globos.push(elegido);
        await aplicar(() => ({ tipo: "agregar-color", color: elegido.globo.color, globo: elegido.globo, ...(ids.length ? { estructuraIds: ids } : {}) }));
      }
      break;
    }
    case "quitar_color": {
      const destino = piezasConColor(base, ids, pedido.color);
      if (!destino.length) fallo(`Tu plan no lleva ${nombreColor(pedido.color)}${ids.length ? " en esas piezas" : ""}.`);
      for (const id of destino) {
        await aplicar((plan) => {
          const indice = indiceDeColor(plan, id, pedido.color);
          return indice >= 0 && edicionQuitarColor(plan, id, indice) ? { tipo: "quitar-color", estructuraId: id, indice } : null;
        });
      }
      if (!hechos.length) fallo("Ese color no se puede quitar: cada pieza necesita al menos un color. Puedes cambiarlo por otro.");
      break;
    }
    case "protagonismo": {
      const destino = piezasConColor(base, ids, pedido.color);
      if (!destino.length) fallo(`Tu plan no lleva ${nombreColor(pedido.color)}${ids.length ? " en esas piezas" : ""}.`);
      for (const id of destino) {
        await aplicar((plan) => {
          const indice = indiceDeColor(plan, id, pedido.color);
          return indice >= 0 && edicionProtagonismo(plan, id, indice, pedido.direccion) ? { tipo: "protagonismo", estructuraId: id, indice, direccion: pedido.direccion } : null;
        });
      }
      if (!hechos.length) fallo(pedido.direccion > 0 ? `Tus piezas ya llevan todo el ${nombreColor(pedido.color)} que admiten, o lo llevan en un orden fijo.` : `Tus piezas ya llevan lo mínimo de ${nombreColor(pedido.color)}, o lo llevan en un orden fijo.`);
      break;
    }
    case "quitar_pieza": {
      if (ids.length >= base.plan.estructuras.length) fallo("Tu plan necesita al menos una pieza.");
      for (const id of ids) await aplicar(() => ({ tipo: "quitar-pieza", estructuraId: id }));
      break;
    }
    case "tamano": {
      if (!ids.length) {
        await aplicar(() => ({ tipo: "tamano-todo", direccion: pedido.direccion }));
        break;
      }
      for (const cambio of conParejas(base, ids, (id, pareja) => (edicionTamano(base, id, pedido.direccion) ? { tipo: "tamano", estructuraId: id, direccion: pedido.direccion, ...(pareja ? { pareja: true } : {}) } : null))) {
        await aplicar(() => cambio);
      }
      if (!hechos.length) fallo(pedido.direccion > 0 ? "Esas piezas ya están en su tamaño máximo." : "Esas piezas ya están en su tamaño mínimo.");
      break;
    }
    case "medidas": {
      for (const cambio of conParejas(base, ids, (id, pareja) => {
        const medidas = medidasDePieza(base, id, pedido.medidas);
        return medidas ? { tipo: "medidas", estructuraId: id, medidas, ...(pareja ? { pareja: true } : {}) } : null;
      })) {
        await aplicar(() => cambio);
      }
      if (!hechos.length) fallo("Esa medida no se puede escribir en esa pieza. Tu plan sigue como estaba.");
      break;
    }
  }

  const descripcion = descripcionDe(base, pedido, hechos, ids);
  const confirmacion = hechos.length === 1 ? confirmacionDelCambio(base, hechos[0]!, actual.piezas, actual.plan) : `Listo: ${descripcion}; lo demás quedó igual.`;
  return { ...actual, descripcion: descripcion.slice(0, 160), confirmacion, cambios: hechos, globos };
}

/** La línea corta del cambio: la del editor si fue uno solo; si fueron varios, la del pedido entero. */
function descripcionDe(base: PlanGuiado, pedido: PedidoEdicionPlan, hechos: readonly CambioPlan[], ids: readonly string[]): string {
  if (hechos.length === 1) return describirCambio(base, hechos[0]!);
  const piezas = (lista: readonly string[]) => conArticulo(base, lista);
  switch (pedido.tipo) {
    case "agregar_color": return `con ${listaNatural(hechos.flatMap((cambio) => (cambio.tipo === "agregar-color" ? [cambio.globo?.nombre ?? colorCliente(cambio.color)] : [])))}`;
    case "quitar_color": return `sin ${nombreColor(pedido.color)} en ${piezas(hechos.flatMap((cambio) => ("estructuraId" in cambio ? [cambio.estructuraId] : [])))}`;
    case "protagonismo": return `${pedido.direccion > 0 ? "más" : "menos"} ${nombreColor(pedido.color)} en ${piezas(hechos.flatMap((cambio) => ("estructuraId" in cambio ? [cambio.estructuraId] : [])))}`;
    case "quitar_pieza": return `sin ${piezas(ids)}`;
    case "tamano": return `${piezas(ids)} ${pedido.direccion > 0 ? "más grandes" : "más pequeñas"}`;
    case "medidas": return `${piezas(ids)} de ${Object.values(pedido.medidas).map((valor) => `${String(valor).replace(".", ",")} m`).join(" × ")}`;
    case "reemplazar_color": return hechos[0] ? describirCambio(base, hechos[0]) : `${nombreColor(pedido.colorNuevo)} en lugar de ${nombreColor(pedido.color)}`;
  }
}
