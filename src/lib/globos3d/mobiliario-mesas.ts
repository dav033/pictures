import { mesaConMantel, type ElementoEscenografia } from "./escenografia";
import { barra, caja, cilindro, cilindroTumbado, losa, mat, poligono, r1, trasladarGirar, v, type Material } from "./mobiliario-base";

/**
 * **Mesas** (cm): imperial (la larga de banquete), redonda, de cóctel (alta), consola de postres, mesa de centro,
 * hexagonales de alambre (sueltas o en juego nido), carrito de dulces y mesa de regalos. Las de mantel reutilizan
 * `mesaConMantel` (falda hasta el piso) o un tronco de cono (la redonda), y las sin mantel llevan tapa y patas.
 */

export type OpcionesMesa = { anchoCm: number; fondoCm: number; altoCm: number; tapa: Material; patas: Material; extra?: Material };

/** Mesa imperial / de banquete sin mantel: tapa, cuatro patas de caja y faldón. 240 × 90 × 75 cm. */
export function mesaImperial(o: OpcionesMesa): ElementoEscenografia[] {
  const { anchoCm: w, fondoCm: d, altoCm: h, tapa, patas } = o;
  const salida: ElementoEscenografia[] = [caja(v(0, h - 2, 0), v(w, 4, d), tapa)];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) salida.push(caja(v(sx * (w / 2 - 12), (h - 4) / 2, sz * (d / 2 - 10)), v(6, h - 4, 6), patas));
  for (const sz of [-1, 1]) salida.push(caja(v(0, h - 9, sz * (d / 2 - 10)), v(w - 36, 8, 2), patas));
  for (const sx of [-1, 1]) salida.push(caja(v(sx * (w / 2 - 12), h - 9, 0), v(2, 8, d - 32), patas));
  return salida;
}

/** Mesa redonda sin mantel: tapa de disco sobre un pie central con base. Ø150 × 75 cm (`anchoCm` = diámetro). */
export function mesaRedonda(o: OpcionesMesa): ElementoEscenografia[] {
  const { anchoCm: dia, altoCm: h, tapa, patas } = o;
  return [
    cilindro(v(0, h - 3, 0), dia / 2, 3, tapa),
    cilindro(v(0, 0, 0), Math.min(32, dia * 0.22), 3, patas),
    cilindro(v(0, 3, 0), 6, h - 8, patas, 5),
    cilindro(v(0, h - 6, 0), Math.min(30, dia * 0.2), 3, patas, 8),
  ];
}

/** Mesa redonda con mantel hasta el piso (cae abierto abajo) y, si hay `extra`, un sobremantel cuadrado en rombo encima. */
export function mesaRedondaMantel(o: OpcionesMesa): ElementoEscenografia[] {
  const { anchoCm: dia, altoCm: h, tapa } = o;
  const r = dia / 2;
  const salida: ElementoEscenografia[] = [
    cilindro(v(0, h - 3, 0), r + 1, 3, tapa),
    cilindro(v(0, 0, 0), r + 7, h - 3, tapa, r + 1),
  ];
  if (o.extra) salida.push(caja(v(0, h + 0.25, 0), v(r * 1.45, 0.5, r * 1.45), o.extra, 45));
  return salida;
}

/** Mesa de cóctel alta sin mantel: tapa pequeña, pie y base. Ø60 × 110 cm. */
export function mesaCoctel(o: OpcionesMesa): ElementoEscenografia[] {
  const { anchoCm: dia, altoCm: h, tapa, patas } = o;
  return [
    cilindro(v(0, 0, 0), 24, 2.5, patas, 22),
    cilindro(v(0, 2.5, 0), 3, h - 5, patas, 2.6),
    cilindro(v(0, h - 2.5, 0), dia / 2, 2.5, tapa),
  ];
}

/** Mesa de cóctel con funda de licra: el cuerpo se afina a media altura y abre en la tapa. */
export function mesaCoctelLicra(o: OpcionesMesa): ElementoEscenografia[] {
  const { anchoCm: dia, altoCm: h, tapa } = o;
  const r = dia / 2, mitad = h * 0.5;
  return [
    cilindro(v(0, 0, 0), 26, mitad, tapa, 19),
    cilindro(v(0, mitad, 0), 19, h - mitad - 3, tapa, r),
    cilindro(v(0, h - 3, 0), r + 1.5, 3, tapa),
  ];
}

/** Consola / mesa de postres (angosta y alta) sin mantel: tapa, cuatro patas y un estante bajo. 180 × 45 × 90 cm. */
export function consola(o: OpcionesMesa): ElementoEscenografia[] {
  const { anchoCm: w, fondoCm: d, altoCm: h, tapa, patas } = o;
  const salida: ElementoEscenografia[] = [caja(v(0, h - 1.5, 0), v(w, 3, d), tapa), caja(v(0, h * 0.24, 0), v(w - 10, 2.5, d - 8), patas)];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) salida.push(barra(v(sx * (w / 2 - 6), 0, sz * (d / 2 - 5)), v(sx * (w / 2 - 6), h - 3, sz * (d / 2 - 5)), 1.4, patas, 2));
  salida.push(caja(v(0, h - 6, 0), v(w - 12, 5, d - 10), patas));
  return salida;
}

/** Mesa de centro baja de sala: tapa gruesa, patas de varilla abiertas. 100 × 55 × 42 cm. */
export function mesaCentro(o: OpcionesMesa): ElementoEscenografia[] {
  const { anchoCm: w, fondoCm: d, altoCm: h, tapa, patas } = o;
  const salida: ElementoEscenografia[] = [caja(v(0, h - 2.5, 0), v(w, 5, d), tapa)];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) salida.push(barra(v(sx * (w / 2 - 5), 0, sz * (d / 2 - 5)), v(sx * (w / 2 - 12), h - 5, sz * (d / 2 - 12)), 1.3, patas));
  return salida;
}

/**
 * Mesa hexagonal de alambre dorado: aro de arriba (sin tapa; con `extra` lleva un vidrio o espejo), seis patas
 * finas y un aro más bajo que las une. `anchoCm` es el diámetro entre esquinas.
 */
export function mesaHexagonal(o: OpcionesMesa): ElementoEscenografia[] {
  const { anchoCm: dia, altoCm: h, patas: oro, extra } = o;
  const r = dia / 2, marco = 2.4, grueso = 1.6;
  const salida: ElementoEscenografia[] = [losa(poligono(6, r), h - grueso, grueso, oro, [poligono(6, r - marco)])];
  if (extra) salida.push(losa(poligono(6, r - marco * 0.5), h - grueso * 0.6, 0.6, extra));
  const baja = poligono(6, r * 0.9), y = h * 0.32;
  poligono(6, r - 0.8).forEach((p, i) => {
    const a = baja[i]!, b = baja[(i + 1) % 6]!;
    salida.push(barra(v(p.x, 0, p.y), v(p.x, h - grueso, p.y), 0.6, oro), barra(v(a.x, y, a.y), v(b.x, y, b.y), 0.5, oro));
  });
  return salida;
}

/** Juego nido de tres mesas hexagonales de distinto tamaño, corridas en escalón como en las fotos de fiesta. */
export function mesasNidoHexagonales(o: OpcionesMesa): ElementoEscenografia[] {
  const escalones = [{ k: 1, x: -o.anchoCm * 0.95, z: 6 }, { k: 0.8, x: 0, z: 0 }, { k: 0.62, x: o.anchoCm * 0.78, z: -4 }];
  return escalones.flatMap((e) => trasladarGirar(mesaHexagonal({ ...o, anchoCm: r1(o.anchoCm * e.k), altoCm: r1(o.altoCm * (0.5 + e.k * 0.5)) }), e.x, e.z, 0));
}

/**
 * Carrito de dulces: dos repisas sobre cuatro postes con ruedas, techo con volante de otro color y frascos de
 * golosinas. `tapa` es el cuerpo, `patas` el metal y `extra` el volante y los frascos.
 */
export function carritoDulces(o: OpcionesMesa): ElementoEscenografia[] {
  const { anchoCm: w, fondoCm: d, altoCm: h, tapa: cuerpo, patas: metal, extra: acento = mat("#d6336c", "satinado") } = o;
  const repisa = r1(h * 0.62);
  const salida: ElementoEscenografia[] = [
    caja(v(0, 24, 0), v(w, 30, d), cuerpo),
    caja(v(0, 40, 0), v(w + 4, 3, d + 4), cuerpo),
    caja(v(0, repisa, 0), v(w, 2.5, d), cuerpo),
    caja(v(0, h - 2, 0), v(w + 6, 4, d + 6), cuerpo),
    // Volante del techo: una tira del color de acento que cuelga por delante y por los lados.
    caja(v(0, h - 8, (d + 6) / 2), v(w + 6, 8, 1), acento),
    caja(v(-(w + 6) / 2, h - 8, 0), v(1, 8, d + 6), acento),
    caja(v((w + 6) / 2, h - 8, 0), v(1, 8, d + 6), acento),
  ];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    salida.push(barra(v(sx * (w / 2 - 2), 41.5, sz * (d / 2 - 2)), v(sx * (w / 2 - 2), h - 4, sz * (d / 2 - 2)), 1.2, metal));
    salida.push(cilindroTumbado(v(sx * (w / 2 - 4), 5.5, sz * (d / 2 - 3)), 5.5, 3.5, "x", mat("#333333", "mate")));
  }
  const frascos = 5;
  for (let i = 0; i < frascos; i++) {
    const x = -w / 2 + (w * (i + 0.5)) / frascos;
    const claro = i % 2 === 0;
    salida.push(
      cilindro(v(x, 41.5, 4), 5, 14, claro ? mat("#f2d36b", "brillante") : acento), cilindro(v(x, 55.5, 4), 5.4, 2, metal),
      cilindro(v(x, repisa + 1.25, -4), 5.5, 12, claro ? mat("#f4f1ea", "brillante") : acento), cilindro(v(x, repisa + 13.25, -4), 5.9, 2, metal),
    );
  }
  return salida;
}

/** Mesa de regalos: mesa con mantel hasta el piso y una pila de cajas de regalo con moños encima. */
export function mesaRegalos(o: OpcionesMesa): ElementoEscenografia[] {
  const { anchoCm: w, fondoCm: d, altoCm: h, tapa: mantel, patas: caja1, extra: caja2 = mat("#f0b8c8", "satinado") } = o;
  const salida = mesaConMantel({ anchoCm: w, fondoCm: d, altoCm: h, mantel: mantel.hex });
  const cinta = mat("#f4f1ea", "satinado");
  const regalos = [
    { x: -0.28, base: 0, ancho: 32, alto: 24, fondo: 26, m: caja1 }, { x: 0, base: 0, ancho: 26, alto: 20, fondo: 24, m: caja2 },
    { x: 0.27, base: 0, ancho: 30, alto: 16, fondo: 26, m: mat("#f2d36b", "satinado") }, { x: 0, base: 20, ancho: 18, alto: 14, fondo: 16, m: caja1 },
  ];
  for (const g of regalos) {
    const x = r1(g.x * w), y = h + g.base + g.alto / 2;
    salida.push(
      caja(v(x, y, 0), v(g.ancho, g.alto, g.fondo), g.m),
      caja(v(x, y, 0), v(3, g.alto + 0.6, g.fondo + 0.6), cinta),
      caja(v(x, y + g.alto / 2 + 0.3, 0), v(g.ancho + 0.6, 0.6, 3), cinta),
    );
  }
  return salida;
}
