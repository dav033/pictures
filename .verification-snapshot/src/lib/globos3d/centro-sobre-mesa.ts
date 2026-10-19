import { armarNodoSuelto, HUNDIMIENTO_SOBRE_CM, vectorALocal, vectorAlMundo, type ColocacionSobre, type Escena, type EscenaArmada, type NodoEscena } from "./escena";
import { superficieSuperior } from "./mobiliario-superficie";
import type { Vec3 } from "./modulos";
import type { Pieza } from "./piezas";

/**
 * **Poner algo encima de una mesa** (`poner_sobre` / `mover_sobre` con una mesa de padre, y los centros de mesa): la decoración queda `sobre` la mesa, en el espacio
 * de la mesa y con `encima: true` (la convención de los centros de mesa del salón: lo de pie queda de pie y todo gira con la mesa), con su
 * base en la cubierta —la altura sale de la geometría de la mesa, `superficieSuperior`— y el hundimiento del látex compensado. Es la misma
 * función que usan los centros de mesa del salón (`centros-mesa.ts`) y `poner_sobre` / `mover_sobre`.
 */

/** Un centro no se pone si ocupa más de esta parte de lo angosto de la cubierta. */
export const OCUPACION_MAXIMA = 0.9;

const r1 = (n: number) => Math.round(n * 10) / 10;

export type SitioEnMesa = {
  /** Corrimiento a la derecha de la mesa desde el centro de su cubierta (cm). */
  xCm?: number;
  /** Corrimiento hacia el frente de la mesa desde el centro de su cubierta (cm). */
  zCm?: number;
  giroGrados: number;
};

/**
 * La colocación de `pieza` sobre la mesa `mesa`, centrada en su cubierta (más el corrimiento pedido), o el motivo por el que no se puede
 * (no es una mesa, no cabe, no sube al techo, no se arma). `idPropio` es el de la pieza si ya está en la escena (mover).
 */
export function colocacionSobreMesa(escena: Escena, armada: EscenaArmada, mesa: NodoEscena, pieza: Pieza, sitio: SitioEnMesa, idPropio = "centro-nuevo"): ColocacionSobre | { motivo: string } {
  const cubierta = superficieSuperior(mesa, armada);
  if (!cubierta) return { motivo: `«${mesa.nombre}» no es una mesa con cubierta donde apoyar algo (usa una mesa: redonda, imperial, cóctel, de postres…).` };
  const { marco } = cubierta;
  const normal = vectorALocal(marco, { x: 0, y: 1, z: 0 });
  let punto: Vec3 = { x: cubierta.local.x + (sitio.xCm ?? 0), y: cubierta.local.y + HUNDIMIENTO_SOBRE_CM, z: cubierta.local.z + (sitio.zCm ?? 0) };
  const colocacionCon = (p: Vec3): ColocacionSobre => ({
    en: "sobre", padreId: mesa.id, puntoCm: { x: r1(p.x), y: r1(p.y), z: r1(p.z) },
    normal: { x: r1(normal.x), y: r1(normal.y), z: r1(normal.z) }, giroGrados: sitio.giroGrados, encima: true,
  });
  const nodoCon = (p: Vec3): NodoEscena => ({ id: idPropio, nombre: idPropio, pieza, colocacion: colocacionCon(p) });
  let armado = armarNodoSuelto(escena, armada, nodoCon(punto));
  // Centrado: lo armado cae donde su caja, no donde su origen; se corre lo que falte (dos pasadas bastan).
  const meta = { x: cubierta.centro.x, z: cubierta.centro.z };
  const corrida = vectorAlMundo(marco, { x: sitio.xCm ?? 0, y: 0, z: sitio.zCm ?? 0 });
  for (let pasada = 0; pasada < 2 && armado.copias > 0; pasada++) {
    const dx = meta.x + corrida.x - (armado.caja.min.x + armado.caja.max.x) / 2, dz = meta.z + corrida.z - (armado.caja.min.z + armado.caja.max.z) / 2;
    if (Math.hypot(dx, dz) < 0.3) break;
    const d = vectorALocal(marco, { x: dx, y: 0, z: dz });
    punto = { x: punto.x + d.x, y: punto.y, z: punto.z + d.z };
    armado = armarNodoSuelto(escena, armada, nodoCon(punto));
  }
  if (armado.copias === 0) return { motivo: `no se pudo armar sobre la mesa (${armado.avisos[0] ?? "sin motivo"})` };
  const ancho = armado.caja.max.x - armado.caja.min.x, fondo = armado.caja.max.z - armado.caja.min.z;
  const largo = Math.max(ancho, fondo), angosto = cubierta.angostoCm;
  if (largo > angosto * OCUPACION_MAXIMA) return { motivo: `no cabe: mide ${Math.round(largo)} cm y la cubierta de «${mesa.nombre}» tiene ${Math.round(angosto)} cm de lo angosto (máximo ${Math.round(angosto * OCUPACION_MAXIMA)} cm)` };
  if (armado.caja.max.y > escena.sala.altoCm) return { motivo: `llegaría a ${Math.round(armado.caja.max.y)} cm y el techo está a ${Math.round(escena.sala.altoCm)} cm` };
  return colocacionCon(punto);
}
