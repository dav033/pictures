import type { ElementoEscenografia, MotivoEscenografia } from "./escenografia";
import type { Punto2 } from "./trenza";
import { barra, caja, cilindro, losa, mat, poligono, r1, v, type Material } from "./mobiliario-base";

/**
 * **Decorado de pie** (cm): marcos metálicos (aro, hexágono, arco) con su pie, base hexagonal, peldaños de
 * exhibición, escalera decorativa, biombo, jarrón con pampas, lámpara de pie, base de pastel, letrero de neón,
 * columna griega y alfombra redonda. Todo apoyado en el piso, de frente a +z y centrado en x = 0.
 */

export type OpcionesDecorado = { anchoCm: number; fondoCm: number; altoCm: number; principal: Material; secundario: Material; texto?: string };

const circulo = (radio: number, n = 64): Punto2[] => poligono(n, radio);

/** Contorno de un arco de medio punto como marco en U (abierto abajo): la banda va por dentro. */
function contornoArcoMarco(ancho: number, alto: number, banda: number): Punto2[] {
  const arco = (r: number, recto: number) => Array.from({ length: 33 }, (_, i) => { const a = (i / 32) * Math.PI; return { x: r1(Math.cos(a) * r), y: r1(recto + Math.sin(a) * r) }; });
  const r = ancho / 2, ri = r - banda;
  const fuera = arco(r, Math.max(0, alto - r)), dentro = arco(ri, Math.max(0, alto - r));
  return [{ x: r, y: 0 }, ...fuera, { x: -r, y: 0 }, { x: -ri, y: 0 }, ...dentro.reverse(), { x: ri, y: 0 }];
}

/**
 * Marco metálico con pie: `aro` (círculo), `hexagono` o `arco` (de medio punto, abierto abajo). `anchoCm` es el
 * diámetro (o el ancho del arco) y `altoCm` la altura total hasta lo más alto del marco.
 */
export function marcoMetalico(o: OpcionesDecorado & { forma: "aro" | "hexagono" | "arco" }): ElementoEscenografia[] {
  const { anchoCm: dia, altoCm: alto, principal: metal, forma } = o;
  const banda = 3, grosor = 2.2;
  const pie = (ancho: number): ElementoEscenografia[] => [
    caja(v(-ancho / 2, 1.25, 0), v(5, 2.5, 34), metal), caja(v(ancho / 2, 1.25, 0), v(5, 2.5, 34), metal),
  ];
  if (forma === "arco") {
    const contorno = contornoArcoMarco(dia, alto, banda);
    return [{ forma: "panel", contorno, zCm: 0, grosorCm: grosor, ...metal }, ...pie(dia - banda)];
  }
  const r = dia / 2;
  // El hexágono va con una arista arriba y abajo: su ancho es el diámetro pedido y su alto, 0,87 de él.
  const mitadAlto = forma === "aro" ? r : r * Math.sqrt(3) / 2;
  const centro = Math.max(mitadAlto + 10, alto - mitadAlto);
  const exterior = forma === "aro" ? circulo(r) : poligono(6, r), interior = forma === "aro" ? circulo(r - banda) : poligono(6, r - banda * 1.15);
  const mover = (c: Punto2[]) => c.map((p) => ({ x: p.x, y: r1(p.y + centro) }));
  const salida: ElementoEscenografia[] = [{ forma: "panel", contorno: mover(exterior), huecos: [mover(interior)], zCm: 0, grosorCm: grosor, ...metal }];
  // Pie: un mástil detrás del aro hasta el piso y dos patines.
  salida.push(caja(v(0, (centro - mitadAlto) / 2, -1.2), v(3, centro - mitadAlto, 2.4), metal), ...pie(Math.min(dia * 0.5, 70)));
  return salida;
}

/** Base hexagonal (plinto): prisma de seis lados con una tapa un poco más ancha. `anchoCm` es el diámetro entre esquinas. */
export function baseHexagonal(o: OpcionesDecorado): ElementoEscenografia[] {
  const { anchoCm: dia, altoCm: h, principal: m } = o;
  return [losa(poligono(6, dia / 2, 0), 0, h - 3, m), losa(poligono(6, dia / 2 + 1.5, 0), h - 3, 3, m)];
}

/** Peldaños de exhibición: gradas de caja, la más alta atrás. `altoCm` es la del escalón de atrás; `pasos` los escalones. */
export function peldanos(o: OpcionesDecorado & { pasos?: number }): ElementoEscenografia[] {
  const { anchoCm: w, fondoCm: d, altoCm: h, principal: m } = o;
  const n = o.pasos ?? 3, fondoPaso = d / n;
  return Array.from({ length: n }, (_, k) => {
    const alto = r1((h * (n - k)) / n);
    return caja(v(0, alto / 2, -d / 2 + fondoPaso * (k + 0.5)), v(w, alto, fondoPaso), m);
  });
}

/** Escalera decorativa de madera, apoyada en la pared: dos largueros inclinados y peldaños. 45 × 150 cm. */
export function escaleraDecorativa(o: OpcionesDecorado): ElementoEscenografia[] {
  const { anchoCm: w, fondoCm: d, altoCm: h, principal: m } = o;
  const salida: ElementoEscenografia[] = [];
  const x = w / 2 - 2;
  const z = (y: number) => d / 2 - 2 - ((d - 4) * y) / h;
  const n = Math.max(3, Math.round(h / 28));
  for (const sx of [-1, 1]) salida.push(barra(v(sx * x, 0, z(0)), v(sx * x, h, z(h)), 2, m));
  for (let i = 1; i <= n; i++) {
    const y = (h * i) / (n + 0.6);
    salida.push(caja(v(0, y, z(y)), v(w, 2.4, 9), m));
  }
  return salida;
}

/**
 * Biombo plegable de paneles en zigzag: marco y tela por panel. `anchoCm` es lo que mide a lo largo y `fondoCm` lo que
 * se abre el zigzag (de ahí sale el ángulo de las bisagras).
 */
export function biombo(o: OpcionesDecorado & { paneles?: number }): ElementoEscenografia[] {
  const { anchoCm: total, fondoCm: fondo, altoCm: h, principal: marco, secundario: tela } = o;
  const n = o.paneles ?? 3, grueso = 3;
  // Cada panel mide `ancho` y avanza `ancho·cos a` a lo largo y `ancho·sin a` a lo hondo; el zigzag ocupa `ancho·sin a + grueso` de fondo.
  // El ángulo y el ancho de cada panel dependen uno del otro: dos pasadas bastan.
  const anguloDe = (ancho: number, cos: number) => Math.asin(Math.min(0.7, Math.max(0.1, (fondo - grueso * cos) / ancho)));
  let angulo = anguloDe(total / n, 1);
  let ancho = (total - grueso * Math.sin(angulo)) / (n * Math.cos(angulo));
  angulo = anguloDe(ancho, Math.cos(angulo));
  ancho = (total - grueso * Math.sin(angulo)) / (n * Math.cos(angulo));
  const centros: { x: number; z: number; giro: number }[] = [];
  let px = 0, pz = 0;
  for (let i = 0; i < n; i++) {
    const sentido = i % 2 === 0 ? 1 : -1;
    const dx = Math.cos(angulo) * ancho, dz = -sentido * Math.sin(angulo) * ancho;
    centros.push({ x: px + dx / 2, z: pz + dz / 2, giro: sentido * (angulo * 180) / Math.PI });
    px += dx; pz += dz;
  }
  const mx = px / 2, mz = (Math.max(...centros.map((c) => c.z)) + Math.min(...centros.map((c) => c.z))) / 2;
  return centros.flatMap((c) => [
    caja(v(r1(c.x - mx), h / 2, r1(c.z - mz)), v(r1(ancho), h, grueso), marco, r1(c.giro)),
    caja(v(r1(c.x - mx), h / 2, r1(c.z - mz)), v(r1(ancho - 7), h - 7, grueso + 0.6), tela, r1(c.giro)),
  ]);
}

/** Jarrón alto con tallos de pampas: jarrón en dos troncos de cono y plumas abiertas en abanico. */
export function jarronPampas(o: OpcionesDecorado): ElementoEscenografia[] {
  const { anchoCm: ancho, fondoCm: fondo, altoCm: h, principal: jarron, secundario: pampa } = o;
  // Lo abiertas que van las plumas: proporcional al ancho y al fondo pedidos (53 × 28 cm con las medidas de partida).
  const vaso = Math.min(h * 0.4, 60), r = ancho * 0.215, kx = ancho / 53, kz = fondo / 28;
  const salida: ElementoEscenografia[] = [cilindro(v(0, 0, 0), r * 0.62, vaso * 0.55, jarron, r), cilindro(v(0, vaso * 0.55, 0), r, vaso * 0.35, jarron, r * 0.55), cilindro(v(0, vaso * 0.9, 0), r * 0.55, vaso * 0.1, jarron, r * 0.7)];
  const tallo = mat("#b89a6e", "mate");
  const tallos = 11;
  for (let k = 0; k < tallos; k++) {
    const ang = k * 2.39996, inclina = 0.05 + 0.36 * ((k * 0.618) % 1);
    const largo = (h - vaso) * (0.7 + 0.3 * (((k * 0.37) % 1)));
    const dx = Math.cos(ang) * Math.sin(inclina), dz = Math.sin(ang) * Math.sin(inclina) * 0.6, dy = Math.cos(inclina);
    const base = v(dx * 2, vaso, dz * 2), punta = v((dx * largo + dx * 2) * kx, vaso + dy * largo, (dz * largo + dz * 2) * kz);
    const pluma = Math.min(34, largo * 0.32);
    const inicio = v(punta.x - dx * pluma, punta.y - dy * pluma, punta.z - dz * pluma);
    salida.push(barra(base, inicio, 0.45, tallo), barra(inicio, punta, 3.6, pampa, 0.5));
  }
  return salida;
}

/** Lámpara de pie: base redonda, mástil fino y pantalla de tela encendida. */
export function lamparaPie(o: OpcionesDecorado): ElementoEscenografia[] {
  const { anchoCm: dia, altoCm: h, principal: pie } = o;
  const pantalla = Math.min(30, h * 0.2);
  return [
    cilindro(v(0, 0, 0), 15, 2.2, pie, 14),
    cilindro(v(0, 2.2, 0), 1.2, h - pantalla - 2, pie),
    { forma: "cilindro", base: v(0, h - pantalla, 0), radioCm: dia / 2, radioArribaCm: dia / 2 * 0.72, altoCm: pantalla, hex: o.secundario.hex, acabado: "llama" },
  ];
}

/** Base de pastel (platón sobre pie): disco, tallo y pie. `anchoCm` es el diámetro del plato. */
export function basePastel(o: OpcionesDecorado): ElementoEscenografia[] {
  const { anchoCm: dia, altoCm: h, principal: m } = o;
  return [cilindro(v(0, 0, 0), dia * 0.26, 1.5, m, dia * 0.22), cilindro(v(0, 1.5, 0), 2.4, h - 3.5, m, 1.8), cilindro(v(0, h - 2, 0), dia / 2, 2, m, dia / 2 - 0.4)];
}

/** Letrero de neón: tablero oscuro (acrílico) con el texto en cursiva luminosa. Va en la pared. */
export function neonCursiva(o: OpcionesDecorado): ElementoEscenografia[] {
  const motivo: MotivoEscenografia = { dibujo: "texto", texto: o.texto || "Happy Birthday", hex: o.secundario.hex, estilo: "neon" };
  return [{ forma: "caja", centro: v(0, o.altoCm / 2, 1), tamano: v(o.anchoCm, o.altoCm, 1.6), hex: o.principal.hex, acabado: o.principal.acabado, motivo }];
}

/** Columna griega blanca: base, fuste y capitel cuadrado. `anchoCm` es el ancho de la base y del capitel; el fuste es 12 cm más angosto. */
export function columnaGriega(o: OpcionesDecorado): ElementoEscenografia[] {
  const { anchoCm: ancho, altoCm: h, principal: m } = o;
  const dia = Math.max(8, ancho - 12), base = Math.max(8, h * 0.06), r = dia / 2;
  const salida: ElementoEscenografia[] = [
    caja(v(0, base / 2, 0), v(dia + 12, base, dia + 12), m), caja(v(0, base + 2, 0), v(dia + 6, 4, dia + 6), m),
    cilindro(v(0, base + 4, 0), r, h - 2 * base - 4, m, r * 0.88),
    caja(v(0, h - base - 2, 0), v(dia + 6, 4, dia + 6), m), caja(v(0, h - base / 2, 0), v(dia + 12, base, dia + 12), m),
  ];
  return salida;
}

/** Alfombra redonda de tela; con `secundario` distinto asoma un ribete. `anchoCm` es el diámetro. */
export function alfombraRedonda(o: OpcionesDecorado): ElementoEscenografia[] {
  const { anchoCm: dia, principal: m, secundario: borde } = o;
  if (borde.hex === m.hex) return [cilindro(v(0, 0, 0), dia / 2, 1, m)];
  // Con ribete: el disco de abajo es del color del borde y el de arriba, 4 cm más angosto.
  return [cilindro(v(0, 0, 0), dia / 2, 0.5, borde), cilindro(v(0, 0.5, 0), dia / 2 - 4, 0.5, m)];
}
