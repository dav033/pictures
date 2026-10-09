import { armarEscena, type Escena, type NodoEscena, type Sala } from "./escena";
import { fallar } from "./herramientas-escena-colores";
import { MAX_NODOS, SALA_MAXIMA_CM } from "./limites-escena";
import {
  distribuirSalon, FRENTE_PANEL_CM, MESAS_SALON, PROFUNDIDAD_FONDO_CM, SILLAS_DESDE_FONDO_CM, type DistribucionSalon, type ParamsSalon, type TipoMesaSalon,
} from "./salon-evento";
import { desplazarNodo, mesasDeInvitados, nodoDeElemento, paletaDeMesas, quitarConLoSuyo, tipoDeMesa, type PaletaSalon } from "./salon-nodos";
import { cajaDeMueble, esDeSalon, esDeZona, PREFIJO_ZONA, unir, ZONAS_SALON, zonasPresentes, type RectCm, type ZonaSalon } from "./salon-zonas";

/**
 * Convierte la distribución de un salón en piezas de la escena y la ajusta después (`armar_salon`, `ajustar_salon`): crea,
 * mueve o quita SOLO las piezas con id `salon-…`. Lo del usuario nunca se borra: la decoración que ya había se conserva
 * (si el salón lleva fondo de fotos, se corre como un bloque a ese fondo, delante del panel).
 */

/** El alto de techo de un salón (cm) cuando la sala era más baja. */
const ALTO_SALON_CM = 450;
const metros = (cm: number) => `${(cm / 100).toLocaleString("es-CO", { maximumFractionDigits: 1 })} m`;

/** Las zonas de un salón que no dice cuáles: todas con 60 o más invitados; con menos, solo el fondo de fotos y los postres. */
export const zonasPorDefecto = (invitados: number): ZonaSalon[] => (invitados >= 60 ? [...ZONAS_SALON] : ["fondo_fotos", "mesa_postres"]);

export type PedidoSalon = {
  invitados?: number; mesa?: TipoMesaSalon; anchoCm?: number; fondoCm?: number; zonas?: readonly ZonaSalon[]; colores?: PaletaSalon; reemplazar?: boolean;
};

export type ResultadoSalon = { escena: Escena; resumen: string };

const rangoSala = (v: number | undefined, max: number, que: string): number | undefined => {
  if (v === undefined) return undefined;
  if (!Number.isFinite(v) || v < 300 || v > max) fallar(`${que} = ${v} cm está fuera de rango: va de 300 a ${max} cm.`);
  return Math.round(v);
};

/** Cajas del piso (cm) de las piezas del usuario que están en el piso, el aire o el techo (las que el salón debe esquivar o correr). */
function cajasDeLoPropio(escena: Escena): Array<{ nodo: NodoEscena; caja: RectCm }> {
  const armada = armarEscena(escena);
  return escena.nodos.flatMap((nodo) => {
    const hecho = armada.porNodo.find((x) => x.id === nodo.id);
    if (esDeSalon(nodo.id) || !hecho || hecho.copias === 0 || !["piso", "libre", "techo"].includes(nodo.colocacion.en)) return [];
    return [{ nodo, caja: { x0: hecho.caja.min.x, x1: hecho.caja.max.x, z0: hecho.caja.min.z, z1: hecho.caja.max.z } }];
  });
}

const textoZonas = (d: DistribucionSalon, mesa: TipoMesaSalon): string => {
  const zonas = ZONAS_SALON.filter((z) => d.elementos.some((e) => e.zona === z));
  const mesas = d.elementos.filter((e) => e.zona === null).length;
  return `${mesas} mesas de ${MESAS_SALON[mesa].puestos}${zonas.length ? ` + ${zonas.map((z) => z.replace("_", " ")).join(", ")}` : ""}`;
};

function falloDeCapacidad(d: DistribucionSalon, p: ParamsSalon): never {
  const { puestos } = MESAS_SALON[p.mesa];
  return fallar(`En una sala de ${metros(d.sala.anchoCm)} × ${metros(d.sala.fondoCm)} caben ${d.capacidad} mesas (${d.capacidad * puestos} invitados) y hacen falta ${d.mesasNecesarias} para ${p.invitados}: agranda la sala (hasta ${SALA_MAXIMA_CM.ancho / 100} × ${SALA_MAXIMA_CM.fondo / 100} m), usa mesas de 10 o quita zonas.`);
}

/** Arma un salón desde cero. Falla si ya hay uno (salvo `reemplazar`, que solo quita las piezas `salon-…`). */
export function armarSalon(escena: Escena, p: PedidoSalon, notas: string[]): ResultadoSalon {
  const previas = escena.nodos.filter((n) => esDeSalon(n.id)).map((n) => n.id);
  if (previas.length && !p.reemplazar) fallar(`Ya hay un salón armado (${previas.length} piezas «salon-…»). Para cambiar invitados, tipo de mesa, medidas o agregar una zona usa ajustar_salon; para mover o quitar una zona, mover_zona y quitar_zona; para rehacerlo, armar_salon con reemplazar = true (no toca tus piezas).`);
  const base = p.reemplazar ? quitarConLoSuyo(escena, previas).escena : escena;
  const invitados = p.invitados ?? 0;
  const zonas = p.zonas ?? (invitados > 0 ? zonasPorDefecto(invitados) : []);
  if (invitados === 0 && zonas.length === 0) fallar("Dime cuántos invitados o qué zonas armar (mesa_principal, pista, mesa_postres, fondo_fotos, entrada).");
  const mesa = p.mesa ?? "redonda8";
  const ancho = rangoSala(p.anchoCm, SALA_MAXIMA_CM.ancho, "ancho_cm"), fondo = rangoSala(p.fondoCm, SALA_MAXIMA_CM.fondo, "fondo_cm");

  const propias = cajasDeLoPropio(base);
  const conFondo = zonas.includes("fondo_fotos");
  const bloque = conFondo && propias.length ? propias.map((x) => x.caja).reduce(unir) : null;
  const profundidadFondoCm = bloque ? Math.ceil(Math.max(PROFUNDIDAD_FONDO_CM, FRENTE_PANEL_CM + (bloque.z1 - bloque.z0) + 40)) : undefined;
  const reservas = bloque ? [] : propias.map((x) => x.caja);

  const parametros: ParamsSalon = { invitados, mesa, zonas, reservas, ...(profundidadFondoCm ? { profundidadFondoCm } : {}), altoSalaCm: Math.max(base.sala.altoCm, ALTO_SALON_CM) };
  const fija = ancho !== undefined || fondo !== undefined;
  let d: DistribucionSalon;
  if (fija) d = distribuirSalon({ ...parametros, sala: { anchoCm: ancho ?? base.sala.anchoCm, fondoCm: fondo ?? base.sala.fondoCm } });
  else if (invitados > 0) {
    d = distribuirSalon({ ...parametros, sala: { anchoCm: base.sala.anchoCm, fondoCm: base.sala.fondoCm }, altoSalaCm: base.sala.altoCm });
    if (d.faltan > 0) d = distribuirSalon(parametros);
  } else d = distribuirSalon({ ...parametros, sala: { anchoCm: base.sala.anchoCm, fondoCm: base.sala.fondoCm }, altoSalaCm: base.sala.altoCm });
  if (d.faltan > 0) falloDeCapacidad(d, { ...parametros, sala: d.sala });

  const cambioSala = d.sala.anchoCm !== base.sala.anchoCm || d.sala.fondoCm !== base.sala.fondoCm;
  const sala: Sala = { ...base.sala, anchoCm: d.sala.anchoCm, fondoCm: d.sala.fondoCm, altoCm: cambioSala && Math.max(d.sala.anchoCm, d.sala.fondoCm) >= 900 ? Math.max(base.sala.altoCm, ALTO_SALON_CM) : base.sala.altoCm };
  const nuevos = d.elementos.map((e) => nodoDeElemento(e, p.colores ?? []));
  if (base.nodos.length + nuevos.length > MAX_NODOS) fallar(`El salón suma ${nuevos.length} piezas y la escena ya tiene ${base.nodos.length} (máximo ${MAX_NODOS}): quita piezas o usa menos zonas.`);

  // La decoración que ya estaba se conserva: con fondo de fotos va, como un bloque, delante del panel (centrada, con la espalda a 60 cm de la pared).
  let nodos = [...base.nodos];
  if (bloque) {
    const dx = -(bloque.x0 + bloque.x1) / 2, dz = -sala.fondoCm / 2 + FRENTE_PANEL_CM - bloque.z0;
    const moverlas = new Set(propias.map((x) => x.nodo.id));
    nodos = nodos.map((n) => (moverlas.has(n.id) ? desplazarNodo(n, dx, dz) : n));
    notas.push(`Tu decoración (${propias.length} pieza${propias.length > 1 ? "s" : ""}) se conservó y quedó en el fondo de fotos, delante del panel.`);
  }
  for (const z of d.sinLugar) notas.push(`La zona ${z} no cabe en una sala de ${metros(sala.anchoCm)} × ${metros(sala.fondoCm)}: no se armó.`);
  const resumen = `Salón de ${metros(sala.anchoCm)} × ${metros(sala.fondoCm)} × ${metros(sala.altoCm)}: ${textoZonas(d, mesa)} (${invitados} invitados, caben ${d.capacidad * MESAS_SALON[mesa].puestos}).`;
  return { escena: { ...base, sala, nodos: [...nodos, ...nuevos] }, resumen };
}

/**
 * Lo que ocupa hoy el fondo de fotos desde la pared, leído de la escena (para que ajustar invitados no mueva la cuadrícula): lo dicen las
 * sillas de la mesa principal; sin ellas, la decoración del usuario que está pegada al panel.
 */
function profundidadFondoActual(escena: Escena, propias: readonly RectCm[]): number | undefined {
  const panel = escena.nodos.find((n) => n.id === PREFIJO_ZONA.fondo_fotos);
  if (panel?.colocacion.en !== "piso") return undefined;
  const zPared = -escena.sala.fondoCm / 2;
  const silla = escena.nodos.find((n) => n.id === `${PREFIJO_ZONA.mesa_principal}-silla-1`);
  if (silla?.colocacion.en === "piso") return silla.colocacion.zCm - SILLAS_DESDE_FONDO_CM - zPared;
  const pegadas = propias.filter((r) => r.z0 < zPared + FRENTE_PANEL_CM + 80);
  return pegadas.length ? Math.ceil(Math.max(PROFUNDIDAD_FONDO_CM, pegadas.reduce(unir).z1 - zPared + 40)) : undefined;
}

export type PedidoAjuste = { invitados?: number; mesa?: TipoMesaSalon; anchoCm?: number; fondoCm?: number; agregarZonas?: readonly ZonaSalon[] };

/** Rectángulos que ocupan hoy las piezas de las zonas que ya están (para respetar las que el usuario movió). */
function rectasDeZonas(escena: Escena, zonas: readonly ZonaSalon[]): RectCm[] {
  return zonas.flatMap((z) => {
    const cajas = escena.nodos.filter((n) => esDeZona(n.id, z)).flatMap((n) => { const c = cajaDeMueble(n); return c ? [c] : []; });
    return cajas.length ? [cajas.reduce(unir)] : [];
  });
}

/**
 * Cambia un salón armado sin rehacerlo: invitados (agrega o quita mesas del final de la cuadrícula; las de adelante no se
 * mueven), tipo de mesa (las cambia en su sitio, con sus colores), medidas de la sala (si no caben las mesas, la agranda) o zonas
 * que faltan. Si la sala cambia de medidas, cada zona se corre con su pared; si no, las zonas se quedan donde estén.
 */
export function ajustarSalon(escena: Escena, p: PedidoAjuste, notas: string[]): ResultadoSalon {
  if (!escena.nodos.some((n) => esDeSalon(n.id))) fallar("No hay un salón armado en la escena: usa armar_salon (o planificar_evento) primero.");
  const mesas = mesasDeInvitados(escena);
  const tipoActual = (mesas[0] && tipoDeMesa(mesas[0])) ?? "redonda8";
  const mesa = p.mesa ?? tipoActual;
  const invitados = p.invitados ?? mesas.length * MESAS_SALON[tipoActual].puestos;
  const presentes = zonasPresentes(escena);
  const zonas = ZONAS_SALON.filter((z) => presentes.includes(z) || p.agregarZonas?.includes(z));
  const ancho = rangoSala(p.anchoCm, SALA_MAXIMA_CM.ancho, "ancho_cm"), fondo = rangoSala(p.fondoCm, SALA_MAXIMA_CM.fondo, "fondo_cm");
  const fija = ancho !== undefined || fondo !== undefined;
  const actual = { anchoCm: ancho ?? escena.sala.anchoCm, fondoCm: fondo ?? escena.sala.fondoCm };
  const propias = cajasDeLoPropio(escena).map((x) => x.caja);
  const profundidadFondoCm = profundidadFondoActual(escena, propias);
  const nodoPista = escena.nodos.find((n) => n.id === PREFIJO_ZONA.pista);
  const cajaPista = nodoPista ? cajaDeMueble(nodoPista) : null;
  const pistaCm = cajaPista ? cajaPista.x1 - cajaPista.x0 : undefined;

  const calcular = (reservas: RectCm[]): DistribucionSalon => {
    const parametros: ParamsSalon = { invitados, mesa, zonas, reservas, altoSalaCm: escena.sala.altoCm, ...(profundidadFondoCm ? { profundidadFondoCm } : {}), ...(pistaCm ? { pistaCm } : {}) };
    const d = distribuirSalon({ ...parametros, sala: actual });
    if (d.faltan === 0 || fija) return d;
    return distribuirSalon({ ...parametros, salaMinima: actual });
  };
  let d = calcular(propias);
  const cambioSala = d.sala.anchoCm !== escena.sala.anchoCm || d.sala.fondoCm !== escena.sala.fondoCm;
  if (!cambioSala) d = calcular([...propias, ...rectasDeZonas(escena, presentes)]);
  if (d.faltan > 0) falloDeCapacidad(d, { invitados, mesa, zonas, sala: d.sala });

  const paleta = paletaDeMesas(escena);
  let nodos = [...escena.nodos];
  const porId = (id: string) => nodos.findIndex((n) => n.id === id);

  // Zonas que ya estaban: con la sala cambiada se corren con su pared (todo lo suyo, también su decoración); si no, no se tocan.
  if (cambioSala) {
    for (const z of presentes) {
      const ancla = d.elementos.find((e) => e.id === PREFIJO_ZONA[z]);
      const hoy = nodos.find((n) => n.id === PREFIJO_ZONA[z])?.colocacion;
      if (!ancla || hoy?.en !== "piso") continue;
      const dx = ancla.xCm - hoy.xCm, dz = ancla.zCm - hoy.zCm;
      nodos = nodos.map((n) => (esDeZona(n.id, z) ? desplazarNodo(n, dx, dz) : n));
    }
  }
  // Zonas que se piden y no estaban.
  const nuevos: NodoEscena[] = d.elementos.filter((e) => e.zona !== null && !presentes.includes(e.zona)).map((e) => nodoDeElemento(e, paleta));
  for (const z of d.sinLugar) notas.push(`La zona ${z} no cabe en la sala: no se armó.`);

  // Mesas de invitados: las que existen se mueven a su celda (y cambian de tipo si se pidió); las que faltan se crean; las que sobran se quitan.
  const hechas = new Set<string>();
  for (const e of d.elementos.filter((x) => x.zona === null)) {
    hechas.add(e.id);
    const i = porId(e.id);
    const nueva = nodoDeElemento(e, paleta);
    if (i < 0) { nuevos.push(nueva); continue; }
    const igual = tipoDeMesa(nodos[i]!) === mesa;
    nodos[i] = { ...nodos[i]!, colocacion: nueva.colocacion, ...(igual ? {} : { pieza: nueva.pieza }) };
  }
  const sobran = mesas.filter((m) => !hechas.has(m.id)).map((m) => m.id);
  let quitadas = 0;
  let resultado: Escena = { ...escena, nodos };
  if (sobran.length) {
    const r = quitarConLoSuyo(resultado, sobran);
    resultado = r.escena;
    quitadas = r.deMas;
  }
  if (resultado.nodos.length + nuevos.length > MAX_NODOS) fallar(`El ajuste dejaría ${resultado.nodos.length + nuevos.length} piezas y el máximo es ${MAX_NODOS}.`);
  const sala: Sala = cambioSala ? { ...resultado.sala, anchoCm: d.sala.anchoCm, fondoCm: d.sala.fondoCm, altoCm: Math.max(d.sala.anchoCm, d.sala.fondoCm) >= 900 ? Math.max(resultado.sala.altoCm, ALTO_SALON_CM) : resultado.sala.altoCm } : resultado.sala;
  const fuera = cambioSala ? cajasDeLoPropio(escena).filter((x) => x.caja.x1 < -sala.anchoCm / 2 || x.caja.x0 > sala.anchoCm / 2 || x.caja.z1 < -sala.fondoCm / 2 || x.caja.z0 > sala.fondoCm / 2).length : 0;
  if (fuera) notas.push(`${fuera} pieza(s) tuyas quedaron fuera de la sala nueva: muévelas (no las toqué).`);
  const agregadas = nuevos.filter((n) => n.id.startsWith("salon-mesa-")).length;
  if (agregadas) notas.push(`${agregadas} mesa(s) nueva(s) sin centro de mesa ni decoración: si el salón los llevaba, vuelve a decorarlas.`);
  if (sobran.length) notas.push(`Quité ${sobran.length} mesa(s) del final${quitadas ? ` y ${quitadas} pieza(s) que estaban sobre ellas` : ""}.`);
  const resumen = `Salón ajustado: ${textoZonas(d, mesa)} para ${invitados} invitados (caben ${d.capacidad * MESAS_SALON[mesa].puestos}) en ${metros(sala.anchoCm)} × ${metros(sala.fondoCm)}.`;
  return { escena: { ...resultado, sala, nodos: [...resultado.nodos, ...nuevos] }, resumen };
}
