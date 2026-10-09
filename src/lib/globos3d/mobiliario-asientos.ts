import type { ElementoEscenografia } from "./escenografia";
import { barra, caja, cajaInclinada, cilindro, mat, r1, v, type Material } from "./mobiliario-base";

/**
 * **Asientos** (medidas en cm, de frente a +z): silla Tiffany (chiavari), silla moderna, banca, taburetes, sofá y
 * sillón. Cada uno por ancho, fondo y alto totales (el asiento queda a la proporción de siempre) y dos colores: la
 * estructura y el cojín o la tela.
 */

export type OpcionesAsiento = { anchoCm: number; fondoCm: number; altoCm: number; estructura: Material; cojin: Material };

/** Silla Tiffany / chiavari: patas afinadas, travesaños, respaldo de dos barras con barrotes y cojín. 45 × 45 × 90 cm. */
export function sillaTiffany(o: OpcionesAsiento): ElementoEscenografia[] {
  const { anchoCm: w, fondoCm: d, altoCm: h, estructura: e, cojin } = o;
  const asiento = r1(h * 0.5), xp = w / 2 - 2.2, zp = d / 2 - 2.2;
  const salida: ElementoEscenografia[] = [];
  for (const sx of [-1, 1]) {
    salida.push(
      barra(v(sx * xp, 0, zp), v(sx * xp, asiento - 4, zp), 1.3, e, 1.9),
      barra(v(sx * xp, 0, -zp), v(sx * xp, h, -zp), 1.3, e, 1.9),
      // Travesaños de abajo (a los lados) y el aro del asiento.
      barra(v(sx * xp, asiento * 0.4, zp), v(sx * xp, asiento * 0.4, -zp), 0.8, e),
    );
  }
  salida.push(
    barra(v(-xp, asiento * 0.4, zp), v(xp, asiento * 0.4, zp), 0.8, e),
    barra(v(-xp, asiento * 0.4, -zp), v(xp, asiento * 0.4, -zp), 0.8, e),
    caja(v(0, asiento - 6.5, 0), v(w - 2, 5, d - 2), e),
    caja(v(0, asiento - 2, 0), v(w - 3, 4, d - 3), cojin),
  );
  // Respaldo: travesaño de arriba (el más ancho), el de abajo y los barrotes entre los dos.
  const arriba = h - 3, abajo = asiento + 14;
  salida.push(caja(v(0, arriba, -zp), v(w - 2, 5, 2.6), e), caja(v(0, abajo, -zp), v(w - 4, 3, 2.2), e));
  const barrotes = 5;
  for (let i = 0; i < barrotes; i++) {
    const x = -xp + 3.5 + ((2 * xp - 7) * (i + 0.5)) / barrotes;
    salida.push(barra(v(x, abajo + 1, -zp), v(x, arriba, -zp), 0.65, e));
  }
  return salida;
}

/** Silla moderna: cáscara de asiento, patas abiertas de varilla, respaldo curvo inclinado. 45 × 48 × 82 cm. */
export function sillaModerna(o: OpcionesAsiento): ElementoEscenografia[] {
  const { anchoCm: w, fondoCm: d, altoCm: h, estructura: e, cojin } = o;
  const asiento = r1(h * 0.56), xp = w / 2 - 5, zp = d / 2 - 5, alto = h - asiento;
  const salida: ElementoEscenografia[] = [
    caja(v(0, asiento - 2, 0), v(w, 4, d), cojin),
    // El respaldo, algo echado hacia atrás: su canto de arriba llega al alto total.
    cajaInclinada(v(0, asiento + alto * 0.5, -d / 2 + 3), v(w - 3, alto * 0.94, 2.8), 7, cojin),
  ];
  for (const sx of [-1, 1]) {
    salida.push(
      barra(v(sx * (xp + 3.5), 0, zp + 3.5), v(sx * xp, asiento - 4, zp), 1.2, e),
      barra(v(sx * (xp + 3.5), 0, -zp - 3.5), v(sx * xp, asiento - 4, -zp), 1.2, e),
      // Los dos soportes del respaldo suben desde las patas de atrás.
      barra(v(sx * xp, asiento - 4, -zp), v(sx * (xp - 2), asiento + (h - asiento) * 0.35, -d / 2 + 2), 1.1, e),
    );
  }
  return salida;
}

/** Banca (de comedor o de fondo de cama): tablón con cojín y patas rectas unidas por un travesaño. 120 × 38 × 45 cm. */
export function banca(o: OpcionesAsiento): ElementoEscenografia[] {
  const { anchoCm: w, fondoCm: d, altoCm: h, estructura: e, cojin } = o;
  const salida: ElementoEscenografia[] = [caja(v(0, h - 8, 0), v(w, 5, d), e), caja(v(0, h - 3, 0), v(w - 4, 6, d - 4), cojin)];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) salida.push(caja(v(sx * (w / 2 - 5), (h - 10.5) / 2, sz * (d / 2 - 4)), v(5, h - 10.5, 5), e));
    salida.push(caja(v(sx * (w / 2 - 5), h * 0.28, 0), v(3, 3, d - 8), e));
  }
  salida.push(caja(v(0, h * 0.28, 0), v(w - 10, 3, 3), e));
  return salida;
}

/** Taburete (alto de barra, o bajo si `altoCm` es menor): asiento redondo, cuatro patas abiertas y aro para los pies. `anchoCm` es lo que abren las patas en el piso (el asiento es 9 cm más angosto). */
export function taburete(o: OpcionesAsiento): ElementoEscenografia[] {
  const { anchoCm: dia, altoCm: h, estructura: e, cojin } = o;
  const pie = dia / 2 - 1.2, r = pie - 3.5, asiento = h - 4, alto = r - 3;
  const salida: ElementoEscenografia[] = [cilindro(v(0, asiento, 0), r, 4, cojin, r - 0.8)];
  const angulos = [0, 90, 180, 270].map((g) => (g * Math.PI) / 180);
  for (const a of angulos) salida.push(barra(v(Math.cos(a) * pie, 0, Math.sin(a) * pie), v(Math.cos(a) * alto, asiento, Math.sin(a) * alto), 1.2, e));
  // Apoyapiés: un octágono de varillas a 1/3 de la altura (solo si el taburete es alto).
  if (h >= 60) {
    const y = h * 0.34, rr = pie - (pie - alto) * (y / asiento);
    for (let i = 0; i < 8; i++) {
      const a0 = (i / 8) * Math.PI * 2, a1 = ((i + 1) / 8) * Math.PI * 2;
      salida.push(barra(v(Math.cos(a0) * rr, y, Math.sin(a0) * rr), v(Math.cos(a1) * rr, y, Math.sin(a1) * rr), 0.8, e));
    }
  }
  return salida;
}

/**
 * Sofá (de 2 a 4 plazas según el ancho) o sillón: base, brazos, respaldo y cojines de asiento y de espalda.
 * El sillón de una plaza es el mismo con menos ancho (un solo cojín).
 */
export function sofa(o: OpcionesAsiento): ElementoEscenografia[] {
  const { anchoCm: w, fondoCm: d, altoCm: h, estructura: pata, cojin: tela } = o;
  const patas = 9, brazo = r1(Math.min(18, w * 0.11)), baseH = 20, asientoTop = patas + baseH + 12;
  const dentro = w - 2 * brazo, plazas = Math.max(1, Math.round(dentro / 62)), ancho = dentro / plazas;
  const salida: ElementoEscenografia[] = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) salida.push(barra(v(sx * (w / 2 - 8), 0, sz * (d / 2 - 8)), v(sx * (w / 2 - 7), patas, sz * (d / 2 - 7)), 1.7, pata, 2.4));
  salida.push(
    caja(v(0, patas + baseH / 2, 0), v(w, baseH, d), tela),
    // Brazos y espaldar.
    caja(v(-(w / 2 - brazo / 2), patas + (h * 0.72 - patas) / 2, 0), v(brazo, h * 0.72 - patas, d), tela),
    caja(v(w / 2 - brazo / 2, patas + (h * 0.72 - patas) / 2, 0), v(brazo, h * 0.72 - patas, d), tela),
    caja(v(0, patas + (h - patas) / 2, -d / 2 + 8), v(dentro, h - patas, 16), tela),
  );
  for (let i = 0; i < plazas; i++) {
    const x = -dentro / 2 + ancho * (i + 0.5);
    salida.push(
      caja(v(x, patas + baseH + 6, 8), v(ancho - 1.5, 12, d - 18), tela),
      cajaInclinada(v(x, asientoTop + (h - asientoTop) * 0.46, -d / 2 + 22), v(ancho - 2, (h - asientoTop) * 0.9, 14), 12, tela),
    );
  }
  return salida;
}
