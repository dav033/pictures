import type { Escena } from "./escena";
import { fallar } from "./herramientas-escena-colores";
import { desplazarNodo, idsDeZona, mesasDeInvitados, quitarConLoSuyo } from "./salon-nodos";
import { cajaDeMueble, PREFIJO_ZONA, seCruzan, unir, type RectCm, type ZonaSalon } from "./salon-zonas";

/** Mover o quitar una zona de un salón armado (`mover_zona`, `quitar_zona`): solo las piezas `salon-…` de esa zona, nada del usuario. */

const NOMBRE: Readonly<Record<ZonaSalon | "mesas", string>> = {
  mesa_principal: "la mesa principal", pista: "la pista de baile", mesa_postres: "la mesa de postres", fondo_fotos: "el fondo de fotos", entrada: "la entrada", mesas: "las mesas de invitados",
};
const metros = (cm: number) => `${(cm / 100).toLocaleString("es-CO", { maximumFractionDigits: 1 })} m`;

const cajaDeZona = (escena: Escena, zona: ZonaSalon): RectCm | null => {
  const cajas = escena.nodos.filter((n) => idsDeZona(escena, zona).includes(n.id)).flatMap((n) => { const c = cajaDeMueble(n); return c ? [c] : []; });
  return cajas.length ? cajas.reduce(unir) : null;
};

/** Mueve el centro de una zona a (`xCm`, `zCm`) (lo que no se diga se queda); con todo lo suyo (sillas, arco, columnas). */
export function moverZona(escena: Escena, zona: ZonaSalon, xCm: number | undefined, zCm: number | undefined): { escena: Escena; resumen: string } {
  if (xCm === undefined && zCm === undefined) fallar("Dime a dónde: x_cm (izquierda − a derecha +) y/o z_cm (fondo − a frente +), desde el centro de la sala.");
  const ancla = escena.nodos.find((n) => n.id === PREFIJO_ZONA[zona]);
  const caja = cajaDeZona(escena, zona);
  if (!ancla || ancla.colocacion.en !== "piso" || !caja) return fallar(`No hay ${NOMBRE[zona]} en el salón. Agrégala con ajustar_salon (agregar_zonas).`);
  const dx = xCm === undefined ? 0 : xCm - ancla.colocacion.xCm, dz = zCm === undefined ? 0 : zCm - ancla.colocacion.zCm;
  const nueva: RectCm = { x0: caja.x0 + dx, x1: caja.x1 + dx, z0: caja.z0 + dz, z1: caja.z1 + dz };
  const { anchoCm, fondoCm } = escena.sala;
  if (nueva.x0 < -anchoCm / 2 || nueva.x1 > anchoCm / 2 || nueva.z0 < -fondoCm / 2 || nueva.z1 > fondoCm / 2) {
    const { xCm: ax, zCm: az } = ancla.colocacion;
    fallar(`${NOMBRE[zona]} se saldría de la sala (${metros(anchoCm)} × ${metros(fondoCm)}): su centro puede ir entre x = ${Math.ceil(-anchoCm / 2 - (caja.x0 - ax))} y ${Math.floor(anchoCm / 2 - (caja.x1 - ax))} cm y entre z = ${Math.ceil(-fondoCm / 2 - (caja.z0 - az))} y ${Math.floor(fondoCm / 2 - (caja.z1 - az))} cm.`);
  }
  const ids = new Set(idsDeZona(escena, zona));
  const choques = mesasDeInvitados(escena).filter((m) => { const c = cajaDeMueble(m); return c !== null && seCruzan(c, nueva); }).length;
  const nodos = escena.nodos.map((n) => (ids.has(n.id) ? desplazarNodo(n, dx, dz) : n));
  const aviso = choques ? ` Ojo: ${choques} mesa(s) de invitados quedaron encimadas con ella: ajusta con ajustar_salon o muévela otra vez.` : "";
  return { escena: { ...escena, nodos }, resumen: `Moví ${NOMBRE[zona]} (${ids.size} pieza${ids.size > 1 ? "s" : ""}) a x = ${Math.round(ancla.colocacion.xCm + dx)}, z = ${Math.round(ancla.colocacion.zCm + dz)} cm.${aviso}` };
}

/** Quita una zona (o las mesas de invitados) con lo suyo y lo que estaba sobre ella; las piezas del usuario que no estaban sobre ella no se tocan. */
export function quitarZona(escena: Escena, zona: ZonaSalon | "mesas"): { escena: Escena; resumen: string } {
  const ids = zona === "mesas" ? mesasDeInvitados(escena).map((n) => n.id) : idsDeZona(escena, zona);
  if (!ids.length) fallar(`No hay ${NOMBRE[zona]} en el salón.`);
  const { escena: nueva, deMas } = quitarConLoSuyo(escena, ids);
  return { escena: nueva, resumen: `Quité ${NOMBRE[zona]} (${ids.length} pieza${ids.length > 1 ? "s" : ""}${deMas ? ` y ${deMas} que estaban sobre ellas` : ""}). El resto del salón sigue igual.` };
}
