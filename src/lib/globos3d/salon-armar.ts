import type { Escena, Sala } from "./escena";
import { fallar } from "./herramientas-escena-colores";
import { MAX_NODOS, SALA_MAXIMA_CM } from "./limites-escena";
import {
  distribuirSalon, FRENTE_PANEL_CM, falloDeSillas, MAX_INVITADOS_SALON, medidasDeMesa, MESAS_SALON, PROFUNDIDAD_FONDO_CM, type DistribucionSalon, type ParamsSalon, type TipoMesaSalon,
} from "./salon-evento";
import { desplazarNodo, ponerElemento, quitarConLoSuyo, type PaletaSalon } from "./salon-nodos";
import { registroVivo } from "./salon-registro";
import { resumenDeSalon } from "./salon-resumen";
import { piezasDeUsuarioEnElPiso } from "./salon-usuario";
import { unir, ZONAS_SALON, type ZonaSalon } from "./salon-zonas";

/**
 * `armar_salon`: convierte la distribución de un salón en piezas de la escena y las anota en su registro. Lo del usuario nunca se
 * borra: la decoración que ya estaba EN EL PISO se corre como un bloque al fondo de fotos (delante del panel) y queda anotada como
 * `adoptada` (sigue a su zona, no se quita con ella); lo del techo, el aire y la pared no se toca.
 */

/** El alto de techo de un salón (cm) cuando la sala era más baja. */
export const ALTO_SALON_CM = 450;
export const metros = (cm: number) => `${(cm / 100).toLocaleString("es-CO", { maximumFractionDigits: 1 })} m`;

/** Las zonas de un salón que no dice cuáles: todas con 60 o más invitados; con menos, solo el fondo de fotos y los postres. */
export const zonasPorDefecto = (invitados: number): ZonaSalon[] => (invitados >= 60 ? [...ZONAS_SALON] : ["fondo_fotos", "mesa_postres"]);

export type PedidoSalon = {
  invitados?: number; mesa?: TipoMesaSalon; sillas?: number; anchoCm?: number; fondoCm?: number; zonas?: readonly ZonaSalon[]; colores?: PaletaSalon; reemplazar?: boolean;
};

export type ResultadoSalon = { escena: Escena; resumen: string };

export const rangoSala = (v: number | undefined, max: number, que: string): number | undefined => {
  if (v === undefined) return undefined;
  if (!Number.isFinite(v) || v < 300 || v > max) fallar(`${que} = ${v} cm está fuera de rango: va de 300 a ${max} cm.`);
  return Math.round(v);
};

/** Por qué no caben las mesas y cuántos invitados sí caben en esa sala con esas zonas. */
export function falloDeCapacidad(d: DistribucionSalon, mesa: TipoMesaSalon, invitados: number, sillas?: number): never {
  const { puestos } = medidasDeMesa(mesa, sillas);
  const cabe = d.capacidad * puestos;
  return fallar(`En una sala de ${metros(d.sala.anchoCm)} × ${metros(d.sala.fondoCm)} con esas zonas caben ${d.capacidad} mesas de ${puestos} (${cabe} invitados) y hacen falta ${d.mesasNecesarias} para ${invitados}: ${cabe > 0 ? `pide hasta ${cabe} invitados, ` : ""}agranda la sala (hasta ${SALA_MAXIMA_CM.ancho / 100} × ${SALA_MAXIMA_CM.fondo / 100} m), usa mesas de 10 o quita zonas (la pista y los postres ocupan sitio).`);
}

/** Quita lo que armó el salón (y lo que está sobre ello) y todo el registro; lo del usuario, también lo que adoptó, se queda sin anotar. */
function sinSalon(escena: Escena): Escena {
  const registro = escena.salon;
  if (!registro) return escena;
  const suyas = Object.entries(registro.piezas).filter(([, i]) => i.rol !== "adoptada").map(([id]) => id);
  const { escena: limpia } = quitarConLoSuyo(escena, suyas);
  const { salon: _anotado, ...resto } = limpia;
  return resto;
}

/** Arma un salón desde cero. Falla si ya hay uno (salvo `reemplazar`, que solo quita las piezas que armó el salón). */
export function armarSalon(escena: Escena, p: PedidoSalon, notas: string[]): ResultadoSalon {
  const hay = registroVivo(escena);
  if (hay && !p.reemplazar) fallar(`Ya hay un salón armado (${hay.invitados} invitados). Para cambiar invitados, tipo de mesa, medidas o agregar una zona usa ajustar_salon; para mover o quitar una zona, mover_zona y quitar_zona; para rehacerlo, armar_salon con reemplazar = true (no toca tus piezas).`);
  const base = sinSalon(escena);
  const invitados = p.invitados ?? 0;
  if (invitados > MAX_INVITADOS_SALON) fallar(`Un salón admite hasta ${MAX_INVITADOS_SALON} invitados (me pasaron ${invitados}).`);
  const zonas = p.zonas ?? (invitados > 0 ? zonasPorDefecto(invitados) : []);
  if (invitados === 0 && zonas.length === 0) fallar("Dime cuántos invitados o qué zonas armar (mesa_principal, pista, mesa_postres, fondo_fotos, entrada).");
  const mesa = p.mesa ?? "redonda8";
  const falloSillas = p.sillas === undefined ? null : falloDeSillas(mesa, p.sillas);
  if (falloSillas) fallar(falloSillas);
  // Las sillas de siempre del tipo de mesa no se guardan: es lo mismo que no pedir nada.
  const sillas = p.sillas === MESAS_SALON[mesa].puestos ? undefined : p.sillas;
  const ancho = rangoSala(p.anchoCm, SALA_MAXIMA_CM.ancho, "ancho_cm"), fondo = rangoSala(p.fondoCm, SALA_MAXIMA_CM.fondo, "fondo_cm");

  const propias = piezasDeUsuarioEnElPiso(base, true);
  const bloque = zonas.includes("fondo_fotos") && propias.length ? propias.map((x) => x.caja).reduce(unir) : null;
  const profundidadFondoCm = bloque ? Math.ceil(Math.max(PROFUNDIDAD_FONDO_CM, FRENTE_PANEL_CM + (bloque.z1 - bloque.z0) + 40)) : undefined;
  const fija = ancho !== undefined || fondo !== undefined;
  const distribuir = (reservas: ParamsSalon["reservas"], profundidad: number | undefined): DistribucionSalon => {
    const parametros: ParamsSalon = { invitados, mesa, ...(sillas !== undefined ? { sillas } : {}), zonas, reservas, ...(profundidad ? { profundidadFondoCm: profundidad } : {}), altoSalaCm: Math.max(base.sala.altoCm, ALTO_SALON_CM) };
    const actual = { anchoCm: ancho ?? base.sala.anchoCm, fondoCm: fondo ?? base.sala.fondoCm };
    if (fija) return distribuirSalon({ ...parametros, sala: actual });
    if (invitados === 0) return distribuirSalon({ ...parametros, sala: actual, altoSalaCm: base.sala.altoCm });
    const enLaActual = distribuirSalon({ ...parametros, sala: actual, altoSalaCm: base.sala.altoCm });
    return enLaActual.faltan > 0 ? distribuirSalon(parametros) : enLaActual;
  };
  let d = distribuir(bloque ? [] : propias.map((x) => x.caja), profundidadFondoCm);
  // Sin sitio para el fondo de fotos, la decoración se queda donde estaba (y las mesas la esquivan).
  const adopta = bloque !== null && !d.sinLugar.includes("fondo_fotos");
  if (bloque && !adopta) d = distribuir(propias.map((x) => x.caja), undefined);
  if (d.faltan > 0) falloDeCapacidad(d, mesa, invitados, sillas);

  const cambioSala = d.sala.anchoCm !== base.sala.anchoCm || d.sala.fondoCm !== base.sala.fondoCm;
  const sala: Sala = { ...base.sala, anchoCm: d.sala.anchoCm, fondoCm: d.sala.fondoCm, altoCm: cambioSala && Math.max(d.sala.anchoCm, d.sala.fondoCm) >= 900 ? Math.max(base.sala.altoCm, ALTO_SALON_CM) : base.sala.altoCm };
  if (base.nodos.length + d.elementos.length > MAX_NODOS) fallar(`El salón suma ${d.elementos.length} piezas y la escena ya tiene ${base.nodos.length} (máximo ${MAX_NODOS}): quita piezas o usa menos zonas.`);

  const inicial = { invitados, mesa, ...(sillas !== undefined ? { sillas } : {}), profundidadFondoCm: adopta && profundidadFondoCm ? profundidadFondoCm : PROFUNDIDAD_FONDO_CM };
  let nodos = [...base.nodos];
  if (adopta && bloque) {
    const dx = -(bloque.x0 + bloque.x1) / 2, dz = -sala.fondoCm / 2 + FRENTE_PANEL_CM - bloque.z0;
    const mover = new Set(propias.map((x) => x.id));
    nodos = nodos.map((n) => (mover.has(n.id) ? desplazarNodo(n, dx, dz) : n));
  }
  let resultado: Escena = { ...base, sala, nodos };
  let ranura = 0;
  for (const e of d.elementos) resultado = ponerElemento(resultado, e, p.colores ?? [], inicial, e.rol === "mesa" ? ++ranura : undefined);
  if (adopta && resultado.salon) {
    const adoptadas = Object.fromEntries(propias.map((x) => [x.id, { zona: "fondo_fotos" as const, rol: "adoptada" as const }]));
    resultado = { ...resultado, salon: { ...resultado.salon, piezas: { ...resultado.salon.piezas, ...adoptadas } } };
    notas.push(`Tu decoración (${propias.length} pieza${propias.length > 1 ? "s" : ""}) se conservó y quedó en el fondo de fotos, delante del panel.`);
  }
  for (const z of d.sinLugar) notas.push(`La zona ${z} no cabe en una sala de ${metros(sala.anchoCm)} × ${metros(sala.fondoCm)}: no se armó.`);
  return { escena: resultado, resumen: `${resumenDeSalon(resultado)} (${invitados} invitados, caben ${d.capacidad * medidasDeMesa(mesa, sillas).puestos}).` };
}
