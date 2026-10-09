import { mesaConMantel, type ElementoEscenografia } from "./escenografia";
import { caja, cilindro, losa, mat, r1, v } from "./mobiliario-base";
import { contornoDeMesa, desplazarContorno, distanciaAlContorno, dentroDelContorno, normalDeArista } from "./mobiliario-contornos";
import type { MesaGuardada } from "./mobiliario-conjunto-tipos";
import { mesaCoctel, mesaCoctelLicra, mesaImperial, mesaRedonda, mesaRedondaMantel } from "./mobiliario-mesas";
import type { Punto2 } from "./trenza";

/**
 * **Mesas paramétricas** (REQ-012): redonda, cuadrada, rectangular, ovalada, cóctel, media luna, serpentina y banquete en U,
 * con mantel hasta el piso, corto o sin mantel (tapa y patas), color y camino de mesa. Todo en el marco de la mesa (cm, y arriba,
 * centrada en su caja). Las redondas, cuadradas, rectangulares y cóctel reutilizan las mesas del catálogo, así que se ven igual
 * que ellas; el resto sale del contorno de su tapa (`mobiliario-contornos.ts`). Aquí también: la superficie de arriba, donde
 * se apoya lo que va sobre la mesa.
 */

/** Cuánto cae un mantel corto (cm). */
const CAIDA_MANTEL_CORTO_CM = 35;
const ANCHO_CAMINO_CM = 28;

/** El camino de mesa: una tira a lo largo de la mesa (que cuelga en las cabeceras si hay mantel) o, en la redonda, cruzada por el medio. */
function camino(m: MesaGuardada, hex: string): ElementoEscenografia[] {
  const alX = m.tipo === "redonda" || m.anchoCm >= m.fondoCm;
  const largo = alX ? m.anchoCm : m.fondoCm;
  const material = mat(hex, "brillante");
  const caida = m.mantel === "ninguno" ? 0 : 30;
  const tira = caja(v(0, m.altoCm + 0.25, 0), alX ? v(largo + 0.6, 0.5, ANCHO_CAMINO_CM) : v(ANCHO_CAMINO_CM, 0.5, largo + 0.6), material);
  if (!caida || m.tipo === "redonda") return [tira];
  const cuelgan = [-1, 1].map((s) => caja(alX ? v(s * (largo / 2 + 1.5), m.altoCm - caida / 2, 0) : v(0, m.altoCm - caida / 2, s * (largo / 2 + 1.5)), alX ? v(0.4, caida, ANCHO_CAMINO_CM) : v(ANCHO_CAMINO_CM, caida, 0.4), material));
  return [tira, ...cuelgan];
}

/** Redonda, con la misma silueta que las del catálogo. */
function redonda(m: MesaGuardada): ElementoEscenografia[] {
  const { anchoCm: dia, altoCm: h } = m;
  const tela = mat(m.colorMantel, "tela"), metal = mat(m.colorPatas, "metal");
  if (m.mantel === "piso") return mesaRedondaMantel({ anchoCm: dia, fondoCm: dia, altoCm: h, tapa: tela, patas: tela });
  if (m.mantel === "ninguno") return mesaRedonda({ anchoCm: dia, fondoCm: dia, altoCm: h, tapa: mat(m.colorMantel, "mate"), patas: metal });
  const r = dia / 2;
  return [
    cilindro(v(0, h - 3, 0), r + 1.2, 3, tela),
    cilindro(v(0, h - CAIDA_MANTEL_CORTO_CM - 1.5, 0), r + 4, CAIDA_MANTEL_CORTO_CM, tela, r + 1),
    cilindro(v(0, 0, 0), Math.min(32, dia * 0.22), 3, metal),
    cilindro(v(0, 3, 0), 6, h - 8, metal, 5),
  ];
}

/** Cuadrada y rectangular: la de mantel al piso es `mesaConMantel`; la sin mantel, la imperial. */
function rectangular(m: MesaGuardada): ElementoEscenografia[] {
  const { anchoCm: a, fondoCm: f, altoCm: h } = m;
  const tela = mat(m.colorMantel, "tela"), metal = mat(m.colorPatas, "metal");
  if (m.mantel === "piso") return mesaConMantel({ anchoCm: a - 2.4, fondoCm: f - 2.4, altoCm: h, mantel: m.colorMantel });
  if (m.mantel === "ninguno") return mesaImperial({ anchoCm: a, fondoCm: f, altoCm: h, tapa: mat(m.colorMantel, "mate"), patas: metal });
  const caida = CAIDA_MANTEL_CORTO_CM;
  const salida: ElementoEscenografia[] = [
    caja(v(0, h - 1.5, 0), v(a, 3, f), tela),
    caja(v(0, h - 3 - caida / 2, f / 2 - 0.3), v(a - 0.6, caida, 0.6), tela), caja(v(0, h - 3 - caida / 2, -f / 2 + 0.3), v(a - 0.6, caida, 0.6), tela),
    caja(v(-a / 2 + 0.3, h - 3 - caida / 2, 0), v(0.6, caida, f - 0.6), tela), caja(v(a / 2 - 0.3, h - 3 - caida / 2, 0), v(0.6, caida, f - 0.6), tela),
  ];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) salida.push(caja(v(sx * (a / 2 - 10), (h - 4) / 2, sz * (f / 2 - 10)), v(6, h - 4, 6), metal));
  return salida;
}

/** Patas finas repartidas por el borde, metidas 10 cm: las de una tapa con contorno (ovalada, media luna, serpentina, U) sin mantel o con mantel corto. */
function patasEnContorno(p: readonly Punto2[], h: number, hex: string): ElementoEscenografia[] {
  const largos = p.map((q, i) => { const s = p[(i + 1) % p.length]!; return Math.hypot(s.x - q.x, s.y - q.y); });
  const perimetro = largos.reduce((s, x) => s + x, 0);
  const cuantas = Math.max(4, Math.min(24, Math.round(perimetro / 150)));
  const metal = mat(hex, "metal");
  const salida: ElementoEscenografia[] = [];
  for (let k = 0; k < cuantas; k++) {
    let resto = ((k + 0.5) / cuantas) * perimetro, i = 0;
    while (i < p.length - 1 && resto > largos[i]!) { resto -= largos[i]!; i++; }
    const a = p[i]!, b = p[(i + 1) % p.length]!, t = largos[i]! ? resto / largos[i]! : 0, n = normalDeArista(p, i);
    salida.push(cilindro(v(r1(a.x + (b.x - a.x) * t - n.x * 10), 0, r1(a.y + (b.y - a.y) * t - n.y * 10)), 2.5, h - 4, metal));
  }
  return salida;
}

/** Ovalada, media luna, serpentina y U: la tapa y el faldón siguen el contorno. */
function conContorno(m: MesaGuardada): ElementoEscenografia[] {
  const { altoCm: h } = m;
  const p = contornoDeMesa(m).puntos;
  const tela = mat(m.colorMantel, "tela");
  if (m.mantel === "ninguno") return [losa(p, h - 4, 4, mat(m.colorMantel, "mate")), ...patasEnContorno(p, h, m.colorPatas)];
  const corto = m.mantel === "corto";
  const salida = [losa(desplazarContorno(p, 2), h - 3, 3, tela), losa(desplazarContorno(p, 1), corto ? h - CAIDA_MANTEL_CORTO_CM - 1.5 : 0, corto ? CAIDA_MANTEL_CORTO_CM : h - 1.5, tela)];
  return corto ? [...salida, ...patasEnContorno(p, h, m.colorPatas)] : salida;
}

/** Los sólidos de una mesa en su marco (centrada, apoyada en y = 0, con su camino si lleva). */
export function armarMesa(m: MesaGuardada): ElementoEscenografia[] {
  const sinCamino = ((): ElementoEscenografia[] => {
    switch (m.tipo) {
      case "redonda": return redonda(m);
      case "cuadrada": case "rectangular": return rectangular(m);
      case "coctel": return m.mantel === "ninguno"
        ? mesaCoctel({ anchoCm: m.anchoCm, fondoCm: m.anchoCm, altoCm: m.altoCm, tapa: mat(m.colorMantel, "satinado"), patas: mat(m.colorPatas, "metal") })
        : mesaCoctelLicra({ anchoCm: m.anchoCm, fondoCm: m.anchoCm, altoCm: m.altoCm, tapa: mat(m.colorMantel, "tela"), patas: mat(m.colorMantel, "tela") });
      case "ovalada": case "media_luna": case "serpentina": case "u": return conContorno(m);
    }
  })();
  return m.camino && ADMITE_CAMINO.has(m.tipo) ? [...sinCamino, ...camino(m, m.camino)] : sinCamino;
}

/** Las mesas que llevan camino de mesa (las de contorno libre y la cóctel no). */
export const ADMITE_CAMINO: ReadonlySet<MesaGuardada["tipo"]> = new Set(["redonda", "cuadrada", "rectangular", "ovalada"]);

// ----------------------------------------------------------------------------------------------------------
// La superficie de arriba
// ----------------------------------------------------------------------------------------------------------

/** La tapa de una mesa en su marco: su contorno, su alto sobre el piso y un círculo que cabe entero encima (para poner un centro de mesa). */
export type SuperficieLocal = { altoCm: number; contorno: Punto2[]; centro: Punto2; radioUtilCm: number };

const SIMETRICAS: ReadonlySet<MesaGuardada["tipo"]> = new Set(["redonda", "cuadrada", "rectangular", "ovalada", "coctel"]);

/** El punto de la tapa más lejos de su borde (una malla de 21 × 21 sobre su caja): el sitio del centro de mesa en una media luna o una U. */
function puntoMasInterior(p: readonly Punto2[]): { centro: Punto2; radio: number } {
  const xs = p.map((q) => q.x), ys = p.map((q) => q.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  let mejor = { centro: { x: 0, y: 0 }, radio: -1 };
  for (let i = 0; i <= 20; i++) for (let j = 0; j <= 20; j++) {
    const x = x0 + ((x1 - x0) * i) / 20, y = y0 + ((y1 - y0) * j) / 20;
    if (!dentroDelContorno(p, x, y)) continue;
    const d = distanciaAlContorno(p, x, y);
    if (d > mejor.radio) mejor = { centro: { x: r1(x), y: r1(y) }, radio: d };
  }
  return mejor;
}

/** La superficie de arriba de una mesa, en su marco. */
export function superficieDeMesa(m: MesaGuardada): SuperficieLocal {
  const contorno = contornoDeMesa(m).puntos;
  if (SIMETRICAS.has(m.tipo)) return { altoCm: m.altoCm, contorno, centro: { x: 0, y: 0 }, radioUtilCm: r1(distanciaAlContorno(contorno, 0, 0)) };
  const { centro, radio } = puntoMasInterior(contorno);
  return { altoCm: m.altoCm, contorno, centro, radioUtilCm: r1(Math.max(0, radio)) };
}
