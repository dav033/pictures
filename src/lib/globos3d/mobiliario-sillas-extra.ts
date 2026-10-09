import type { ElementoEscenografia } from "./escenografia";
import type { OpcionesAsiento } from "./mobiliario-asientos";
import { barra, caja, cajaInclinada, r1, v } from "./mobiliario-base";

/**
 * Las tres sillas nuevas de REQ-012, con el mismo contrato que `mobiliario-asientos.ts` (medidas totales en cm, de frente a +z,
 * apoyadas en y = 0, `estructura` y `cojin` como materiales): crossback (madera con el respaldo en X), ghost (acrílica
 * transparente) y plegable (de tubo, con las patas cruzadas).
 */

/** Silla crossback de madera: patas de sección cuadrada, respaldo con travesaño y dos barras en X, asiento con cojín. 44 × 46 × 90 cm. */
export function sillaCrossback(o: OpcionesAsiento): ElementoEscenografia[] {
  const { anchoCm: w, fondoCm: d, altoCm: h, estructura: e, cojin } = o;
  const asiento = r1(h * 0.5), xp = w / 2 - 2, zp = d / 2 - 2;
  const salida: ElementoEscenografia[] = [
    caja(v(0, asiento - 2.5, 0), v(w - 1, 5, d - 1), e),
    caja(v(0, asiento + 0.5, 0), v(w - 6, 3, d - 6), cojin),
    caja(v(0, h - 4, -zp), v(w - 2, 7, 2.8), e),
    caja(v(0, asiento + 8, -zp), v(w - 5, 3, 2.4), e),
  ];
  for (const sx of [-1, 1]) {
    salida.push(
      caja(v(sx * xp, (asiento - 5) / 2, zp), v(3.4, asiento - 5, 3.4), e),
      caja(v(sx * xp, h / 2, -zp), v(3.4, h, 3.4), e),
      barra(v(sx * xp, asiento * 0.35, zp), v(sx * xp, asiento * 0.35, -zp), 0.8, e),
    );
  }
  // El respaldo en X: dos barras que se cruzan entre el travesaño de abajo y el de arriba.
  salida.push(barra(v(-xp + 2, asiento + 9, -zp), v(xp - 2, h - 8, -zp), 1, e), barra(v(xp - 2, asiento + 9, -zp), v(-xp + 2, h - 8, -zp), 1, e));
  return salida;
}

/** Silla ghost (Louis, de acrílico transparente): asiento de una pieza, respaldo curvo algo echado hacia atrás y patas afinadas. 45 × 47 × 90 cm. */
export function sillaGhost(o: OpcionesAsiento): ElementoEscenografia[] {
  const { anchoCm: w, fondoCm: d, altoCm: h, estructura: e } = o;
  const asiento = r1(h * 0.5), xp = w / 2 - 3, zp = d / 2 - 3;
  const salida: ElementoEscenografia[] = [
    caja(v(0, asiento - 1.5, 0), v(w, 3, d), e),
    cajaInclinada(v(0, asiento + (h - asiento) / 2, -d / 2 + 2), v(w - 4, (h - asiento) * 0.97, 2.2), 6, e),
    // Los brazos, tallados en la misma pieza.
    caja(v(-w / 2 + 1.5, asiento + 12, 0), v(3, 2.4, d - 6), e), caja(v(w / 2 - 1.5, asiento + 12, 0), v(3, 2.4, d - 6), e),
  ];
  for (const sx of [-1, 1]) {
    salida.push(
      barra(v(sx * (xp + 1.5), 0, zp + 1.5), v(sx * xp, asiento - 3, zp), 1, e, 1.9),
      barra(v(sx * (xp + 1.5), 0, -zp - 1.5), v(sx * xp, asiento - 3, -zp), 1, e, 1.9),
      barra(v(sx * (w / 2 - 1.5), asiento, zp - 2), v(sx * (w / 2 - 1.5), asiento + 12, zp - 2), 1.1, e),
    );
  }
  return salida;
}

/** Silla plegable de tubo: patas cruzadas en X por cada lado, asiento con cojín delgado y respaldo de un panel. 44 × 46 × 82 cm. */
export function sillaPlegable(o: OpcionesAsiento): ElementoEscenografia[] {
  const { anchoCm: w, fondoCm: d, altoCm: h, estructura: e, cojin } = o;
  const asiento = r1(h * 0.54), xp = w / 2 - 2.5, zp = d / 2 - 3;
  const salida: ElementoEscenografia[] = [
    caja(v(0, asiento - 1.5, 0), v(w - 2, 3, d - 4), e),
    caja(v(0, asiento + 0.4, 0), v(w - 6, 1.8, d - 8), cojin),
    caja(v(0, h - 11, -zp), v(w - 6, 17, 1.8), e),
  ];
  for (const sx of [-1, 1]) {
    salida.push(
      // Las patas cruzadas: de adelante abajo a atrás arriba y al revés.
      barra(v(sx * xp, 1, zp), v(sx * xp, asiento - 3, -zp + 2), 1.1, e), barra(v(sx * xp, 1, -zp), v(sx * xp, asiento - 3, zp - 2), 1.1, e),
      barra(v(sx * xp, asiento - 3, -zp), v(sx * xp, h - 3, -zp), 1.1, e),
      barra(v(sx * xp, asiento - 3, zp), v(sx * xp, asiento - 3, -zp), 0.9, e),
    );
  }
  return salida;
}
