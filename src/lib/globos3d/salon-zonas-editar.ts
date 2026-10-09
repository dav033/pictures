import type { Escena } from "./escena";
import { fallar } from "./herramientas-escena-colores";
import { desplazarNodo, quitarConLoSuyo } from "./salon-nodos";
import { anclaDeZona, mesasVivas, miembrosDeZona, registroVivo, sinAnotar } from "./salon-registro";
import { cajaDeMueble, cajaDeZona, seCruzan, type RectCm, type ZonaSalon } from "./salon-zonas";

/**
 * Mover o quitar una zona de un salón armado (`mover_zona`, `quitar_zona`). Mover la deja «movida» en el registro (su pieza ya no
 * está donde la puso la herramienta): `ajustar_salon` no la vuelve a su sitio. Quitar saca solo lo que armó el salón; la decoración
 * del usuario que sigue a esa zona se queda en la escena.
 */

const NOMBRE: Readonly<Record<ZonaSalon | "mesas", string>> = {
  mesa_principal: "la mesa principal", pista: "la pista de baile", mesa_postres: "la mesa de postres", fondo_fotos: "el fondo de fotos", entrada: "la entrada", mesas: "las mesas de invitados",
};
const metros = (cm: number) => `${(cm / 100).toLocaleString("es-CO", { maximumFractionDigits: 1 })} m`;

/** Mueve el centro de una zona a (`xCm`, `zCm`) (lo que no se diga se queda); con todo lo suyo (sillas, arco, columnas, y la decoración del usuario que sigue a la zona). */
export function moverZona(escena: Escena, zona: ZonaSalon, xCm: number | undefined, zCm: number | undefined): { escena: Escena; resumen: string } {
  if (xCm === undefined && zCm === undefined) fallar("Dime a dónde: x_cm (izquierda − a derecha +) y/o z_cm (fondo − a frente +), desde el centro de la sala.");
  const ancla = anclaDeZona(escena, zona);
  const caja = cajaDeZona(escena, zona);
  if (!ancla || ancla.nodo.colocacion.en !== "piso" || !caja) return fallar(`No hay ${NOMBRE[zona]} en el salón. Agrégala con ajustar_salon (agregar_zonas).`);
  const { xCm: ax, zCm: az } = ancla.nodo.colocacion;
  const dx = xCm === undefined ? 0 : xCm - ax, dz = zCm === undefined ? 0 : zCm - az;
  const nueva: RectCm = { x0: caja.x0 + dx, x1: caja.x1 + dx, z0: caja.z0 + dz, z1: caja.z1 + dz };
  const { anchoCm, fondoCm } = escena.sala;
  if (nueva.x0 < -anchoCm / 2 || nueva.x1 > anchoCm / 2 || nueva.z0 < -fondoCm / 2 || nueva.z1 > fondoCm / 2) {
    fallar(`${NOMBRE[zona]} se saldría de la sala (${metros(anchoCm)} × ${metros(fondoCm)}): su centro puede ir entre x = ${Math.ceil(-anchoCm / 2 - (caja.x0 - ax))} y ${Math.floor(anchoCm / 2 - (caja.x1 - ax))} cm y entre z = ${Math.ceil(-fondoCm / 2 - (caja.z0 - az))} y ${Math.floor(fondoCm / 2 - (caja.z1 - az))} cm.`);
  }
  const ids = new Set(miembrosDeZona(escena, zona).map((v) => v.nodo.id));
  const choques = mesasVivas(escena).filter((m) => { const c = cajaDeMueble(m.nodo); return c !== null && seCruzan(c, nueva); }).length;
  const nodos = escena.nodos.map((n) => (ids.has(n.id) ? desplazarNodo(n, dx, dz) : n));
  const aviso = choques ? ` Ojo: ${choques} mesa(s) de invitados quedaron encimadas con ella: muévela otra vez o ajusta las mesas.` : "";
  return { escena: { ...escena, nodos }, resumen: `Moví ${NOMBRE[zona]} (${ids.size} pieza${ids.size > 1 ? "s" : ""}) a x = ${Math.round(ax + dx)}, z = ${Math.round(az + dz)} cm.${aviso}` };
}

/** Quita una zona (o las mesas de invitados) con lo suyo y lo que estaba sobre ella; las piezas del usuario que no estaban sobre ella no se tocan. */
export function quitarZona(escena: Escena, zona: ZonaSalon | "mesas"): { escena: Escena; resumen: string } {
  if (!registroVivo(escena)) fallar(`No hay ${NOMBRE[zona]} en el salón.`);
  const piezas = zona === "mesas" ? mesasVivas(escena) : miembrosDeZona(escena, zona);
  const suyas = piezas.filter((v) => v.info.rol !== "adoptada").map((v) => v.nodo.id);
  if (!suyas.length) fallar(`No hay ${NOMBRE[zona]} en el salón.`);
  const quitada = quitarConLoSuyo(escena, suyas);
  // La decoración del usuario que seguía a la zona queda como pieza suya, sin anotar.
  let nueva = sinAnotar(quitada.escena, piezas.filter((v) => v.info.rol === "adoptada").map((v) => v.nodo.id));
  if (zona === "mesas" && nueva.salon) nueva = { ...nueva, salon: { ...nueva.salon, invitados: 0 } };
  if (!registroVivo(nueva)) { const { salon: _vacio, ...resto } = nueva; nueva = resto; }
  return { escena: nueva, resumen: `Quité ${NOMBRE[zona]} (${suyas.length} pieza${suyas.length > 1 ? "s" : ""}${quitada.deMas ? ` y ${quitada.deMas} que estaban sobre ellas` : ""}). El resto del salón sigue igual.` };
}
