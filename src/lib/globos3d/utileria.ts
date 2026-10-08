import type { Vec3 } from "./modulos";
import type { Punto2 } from "./trenza";
import type { ElementoEscenografia, MarcoElemento, MotivoEscenografia, ProductoDePieza, SolidoEscenografia } from "./escenografia";
import type { Pieza } from "./piezas";
import { armarEscena, idNuevo, type Colocacion, type Escena, type EscenaArmada, type NodoArmado, type NodoEscena } from "./escena";
import { productoCatalogo, type TipoUtileria } from "./utileria-catalogo";

/**
 * **Utilería de fiesta** en 3D: banderines, platos, vasos, servilletas, mantel, cubiertos, bolsa y calabaza de dulces,
 * gorrito, letrero o topper, velas, caja de regalo, bandeja y paquetes. Todo es escenografía (no es globo ni cotiza
 * como globo), armada con cajas, cilindros y paneles de `escenografia.ts`, con lo impreso (calavera, murciélago,
 * calabaza, «Happy Halloween»…) como `motivo` que el visor estampa. Cada pieza lleva el producto Sempertex que
 * representa (`utileria-catalogo.ts`), que sale en la lista «Productos de fiesta» de la escena.
 *
 * Medidas en cm. Cada pieza apoya su base en y = 0 de su espacio local y mira a +z (salvo el banderín, cuyo origen es
 * el centro de su cordón), así que sobre una mesa basta ponerla suelta (`libre`) a la altura de la tapa
 * (`sobreMesa`).
 */

// ----------------------------------------------------------------------------------------------------------
// Producto asociado
// ----------------------------------------------------------------------------------------------------------

/** El producto del catálogo (por id) en `cantidad` paquetes; sin id (o si no está), un «genérico» con esa descripción. */
export function productoDe(id: string | null, cantidad: number, generico: string, variante?: string): ProductoDePieza {
  const p = id ? productoCatalogo(id) : undefined;
  if (!p) return { nombre: `Genérico: ${generico}`, url: "", cantidad, ...(variante ? { variante } : {}), generico: true };
  return { nombre: p.nombre, url: p.url, cantidad, ...(variante ? { variante } : {}) };
}

/** Paquetes que hacen falta para `piezas` sueltas de un producto (1 si la tienda no dice cuántas trae). */
export function paquetesPara(id: string | null, piezas: number): number {
  const porPaquete = id ? productoCatalogo(id)?.piezasPorPaquete ?? null : null;
  return porPaquete && porPaquete > 0 ? Math.max(1, Math.ceil(piezas / porPaquete)) : 1;
}

function utileria(tipo: TipoUtileria, elementos: ElementoEscenografia[], productos: ProductoDePieza[]): Pieza {
  return { tipo: "escenografia", utileria: tipo, elementos, productos };
}

// ----------------------------------------------------------------------------------------------------------
// Ayudas de geometría
// ----------------------------------------------------------------------------------------------------------

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const resta = (a: Vec3, b: Vec3): Vec3 => v(a.x - b.x, a.y - b.y, a.z - b.z);
const suma = (a: Vec3, b: Vec3): Vec3 => v(a.x + b.x, a.y + b.y, a.z + b.z);
const por = (a: Vec3, k: number): Vec3 => v(a.x * k, a.y * k, a.z * k);
const largo = (a: Vec3) => Math.hypot(a.x, a.y, a.z);
const unitario = (a: Vec3): Vec3 => { const n = largo(a) || 1; return por(a, 1 / n); };
const cruz = (a: Vec3, b: Vec3): Vec3 => v(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const ARRIBA = v(0, 1, 0);
const redondo = (n: number) => Math.round(n * 1000) / 1000;
const r3 = (p: Vec3): Vec3 => v(redondo(p.x), redondo(p.y), redondo(p.z));

/** Un elemento llevado a un marco (si ya traía uno, se componen: primero el suyo y luego este). */
function enMarco(e: ElementoEscenografia, marco: MarcoElemento): ElementoEscenografia {
  if (!e.en) return { ...e, en: marco };
  const x = unitario(marco.ejeX), z = unitario(cruz(x, marco.ejeY)), y = cruz(z, x);
  const girar = (p: Vec3): Vec3 => v(x.x * p.x + y.x * p.y + z.x * p.z, x.y * p.x + y.y * p.y + z.y * p.z, x.z * p.x + y.z * p.y + z.z * p.z);
  return { ...e, en: { origen: suma(marco.origen, girar(e.en.origen)), ejeX: girar(e.en.ejeX), ejeY: girar(e.en.ejeY) } };
}

/** Un tramo de cilindro de `a` a `b` (el cordón del banderín, las asas). */
function tramo(a: Vec3, b: Vec3, radioCm: number, hex: string): ElementoEscenografia {
  const d = resta(b, a);
  const dir = unitario(d);
  const lado = Math.abs(dir.y) > 0.95 ? v(1, 0, 0) : unitario(cruz(dir, ARRIBA));
  return { forma: "cilindro", base: v(0, 0, 0), radioCm, altoCm: redondo(largo(d)), hex, acabado: "satinado", en: { origen: r3(a), ejeX: r3(lado), ejeY: r3(dir) } };
}

/** Banda en arco (media elipse): las asas de una bolsa, el asa de la cubeta. Contorno en el plano xy, base en y = 0. */
function contornoAsa(anchoCm: number, altoCm: number, bandaCm: number): Punto2[] {
  const fuera: Punto2[] = [], dentro: Punto2[] = [];
  const pasos = 16;
  for (let i = 0; i <= pasos; i++) {
    const t = Math.PI - (Math.PI * i) / pasos;
    fuera.push({ x: redondo((anchoCm / 2) * Math.cos(t)), y: redondo(altoCm * Math.sin(t)) });
    dentro.push({ x: redondo((anchoCm / 2 - bandaCm) * Math.cos(t)), y: redondo(Math.max(0, altoCm - bandaCm) * Math.sin(t)) });
  }
  return [...fuera, ...dentro.reverse()];
}

/** Un círculo como contorno (letreros redondos, recortes). */
function contornoCirculo(radioCm: number, centro: Punto2 = { x: 0, y: 0 }, pasos = 28): Punto2[] {
  return Array.from({ length: pasos }, (_, i) => ({ x: redondo(centro.x + radioCm * Math.cos((2 * Math.PI * i) / pasos)), y: redondo(centro.y + radioCm * Math.sin((2 * Math.PI * i) / pasos)) }));
}

// ----------------------------------------------------------------------------------------------------------
// Catenaria (el cordón del banderín)
// ----------------------------------------------------------------------------------------------------------

/**
 * El cordón que cuelga entre `desde` y `hasta`, bajando `caidaCm` respecto a la cuerda en su punto medio: una
 * catenaria y = a·cosh((s − s0)/a) + c en el plano vertical que los une (s, lo horizontal desde `desde`). `a` se busca
 * por bisección para dar esa caída (la caída baja al crecer `a`). Devuelve `pasos + 1` puntos.
 */
export function catenaria(desde: Vec3, hasta: Vec3, caidaCm: number, pasos = 48): Vec3[] {
  const horizontal = v(hasta.x - desde.x, 0, hasta.z - desde.z);
  const L = largo(horizontal);
  const dy = hasta.y - desde.y;
  const recta = () => Array.from({ length: pasos + 1 }, (_, i) => suma(desde, por(resta(hasta, desde), i / pasos)));
  if (L < 1e-6 || caidaCm <= 0.01) return recta();
  const curva = (a: number) => {
    const s0 = L / 2 - a * Math.asinh(dy / (2 * a * Math.sinh(L / (2 * a))));
    const c = -a * Math.cosh(-s0 / a);
    return (s: number) => a * Math.cosh((s - s0) / a) + c;
  };
  const caida = (a: number) => dy / 2 - curva(a)(L / 2);
  let bajo = L / 60, alto = L * 1e4;
  if (caida(bajo) < caidaCm) return recta();
  for (let i = 0; i < 200; i++) {
    const medio = Math.sqrt(bajo * alto);
    if (caida(medio) > caidaCm) bajo = medio; else alto = medio;
  }
  const y = curva(Math.sqrt(bajo * alto));
  const u = por(horizontal, 1 / L);
  return Array.from({ length: pasos + 1 }, (_, i) => {
    const s = (L * i) / pasos;
    return v(desde.x + u.x * s, desde.y + y(s), desde.z + u.z * s);
  });
}

/** Un punto y su tangente a la distancia `d` (cm, a lo largo) de una polilínea. */
function enLaPolilinea(puntos: readonly Vec3[], d: number): { p: Vec3; t: Vec3 } {
  let resto = d;
  for (let i = 1; i < puntos.length; i++) {
    const a = puntos[i - 1]!, b = puntos[i]!;
    const tramoCm = largo(resta(b, a));
    if (resto <= tramoCm || i === puntos.length - 1) {
      const k = tramoCm > 0 ? Math.min(1, Math.max(0, resto / tramoCm)) : 0;
      return { p: suma(a, por(resta(b, a), k)), t: unitario(resta(b, a)) };
    }
    resto -= tramoCm;
  }
  return { p: puntos[0]!, t: v(1, 0, 0) };
}

const largoPolilinea = (puntos: readonly Vec3[]) => puntos.slice(1).reduce((s, p, i) => s + largo(resta(p, puntos[i]!)), 0);

// ----------------------------------------------------------------------------------------------------------
// Banderín
// ----------------------------------------------------------------------------------------------------------

export type FormaBanderin = "triangulo" | "rectangulo" | "golondrina" | "circulo";

/**
 * Por dónde va el cordón: `recto` entre dos puntos (cuelga en catenaria) o `arco` alrededor de una mesa redonda
 * (centro en el origen, a `radioCm`, de `desdeGrados` a `hastaGrados` medidos desde el frente +z hacia +x, con los dos
 * extremos a la misma altura y = 0 y la caída a lo largo del arco).
 */
export type RecorridoBanderin =
  | { tipo: "recto"; desde: Vec3; hasta: Vec3 }
  | { tipo: "arco"; radioCm: number; desdeGrados: number; hastaGrados: number };

export type OpcionesBanderin = {
  recorrido: RecorridoBanderin;
  caidaCm: number;
  cantidad: number;
  forma: FormaBanderin;
  anchoCm: number;
  altoCm: number;
  /** Colores de los banderines, en ciclo. */
  colores: string[];
  /** Lo impreso en cada banderín, en ciclo (null = liso). */
  motivos: Array<MotivoEscenografia | null>;
  cordon: string;
  /** Cordón libre en cada punta, sin banderines (por defecto, medio banderín): lo que se amarra. */
  margenCm?: number;
  productoId: string | null;
  /** Para el «genérico» si no hay producto. */
  descripcion?: string;
};

/** El contorno de un banderín colgado de su borde de arriba (y = 0), hacia abajo. */
function contornoBanderin(forma: FormaBanderin, w: number, h: number): Punto2[] {
  if (forma === "rectangulo") return [{ x: -w / 2, y: 0 }, { x: -w / 2, y: -h }, { x: w / 2, y: -h }, { x: w / 2, y: 0 }];
  if (forma === "golondrina") return [{ x: -w / 2, y: 0 }, { x: -w / 2, y: -h }, { x: 0, y: -h * 0.72 }, { x: w / 2, y: -h }, { x: w / 2, y: 0 }];
  if (forma === "circulo") return contornoCirculo(Math.min(w, h) / 2, { x: 0, y: -Math.min(w, h) / 2 - 0.6 });
  return [{ x: -w / 2, y: 0 }, { x: 0, y: -h }, { x: w / 2, y: 0 }];
}

/** Los puntos del cordón de un banderín en su espacio local. */
export function cordonBanderin(o: Pick<OpcionesBanderin, "recorrido" | "caidaCm">): Vec3[] {
  const r = o.recorrido;
  if (r.tipo === "recto") return catenaria(r.desde, r.hasta, o.caidaCm);
  // Alrededor de una mesa: la catenaria «desenrollada» a lo largo del arco y luego enrollada en el círculo.
  const a0 = (r.desdeGrados * Math.PI) / 180, a1 = (r.hastaGrados * Math.PI) / 180;
  const L = Math.abs(a1 - a0) * r.radioCm;
  const plano = catenaria(v(0, 0, 0), v(L, 0, 0), o.caidaCm);
  return plano.map((p) => {
    const ang = a0 + (a1 - a0) * (p.x / (L || 1));
    return v(r.radioCm * Math.sin(ang), p.y, r.radioCm * Math.cos(ang));
  });
}

/**
 * Banderín: un cordón en catenaria (o alrededor de una mesa) con `cantidad` banderines repartidos a lo largo, cada
 * uno colgado de su borde de arriba, siguiendo el cordón (inclinado como él) y de frente al salón; colores y
 * motivos en ciclo.
 */
export function banderin(o: OpcionesBanderin): Pieza {
  const cordon = cordonBanderin(o);
  const total = largoPolilinea(cordon);
  const elementos: ElementoEscenografia[] = [];
  // El cordón en tramos (uno de cada dos puntos basta para que se vea curvo).
  for (let i = 2; i < cordon.length; i += 2) elementos.push(tramo(cordon[i - 2]!, cordon[i]!, 0.18, o.cordon));
  const n = Math.max(1, Math.round(o.cantidad));
  const margen = Math.min(total / 3, Math.max(0, o.margenCm ?? o.anchoCm / 2));
  const paso = (total - 2 * margen) / n;
  const contorno = contornoBanderin(o.forma, o.anchoCm, o.altoCm);
  const exterior = o.recorrido.tipo === "arco";
  for (let k = 0; k < n; k++) {
    const { p, t } = enLaPolilinea(cordon, margen + paso * (k + 0.5));
    // ejeX a lo largo del cordón (hacia donde avanza); el frente (ejeX × arriba) mira al salón o hacia fuera de la mesa.
    let x = t;
    const frente = unitario(cruz(x, ARRIBA));
    const haciaFuera = exterior ? v(p.x, 0, p.z) : v(0, 0, 1);
    if (frente.x * haciaFuera.x + frente.z * haciaFuera.z < 0) x = por(x, -1);
    const motivo = o.motivos.length ? o.motivos[k % o.motivos.length] ?? null : null;
    elementos.push({
      forma: "panel", contorno, zCm: -0.1, grosorCm: 0.2,
      hex: o.colores[k % Math.max(1, o.colores.length)] ?? "#f28c28", acabado: "papel",
      ...(motivo ? { motivo: { cara: "frente", ...motivo } } : {}),
      en: { origen: r3(suma(p, v(0, -0.15, 0))), ejeX: r3(x), ejeY: ARRIBA },
    });
  }
  return utileria("banderin", elementos, [productoDe(o.productoId, 1, o.descripcion ?? "banderín de papel")]);
}

/**
 * Un banderín colgado entre dos puntos del MUNDO: la pieza (con el cordón alrededor de su punto medio) y su colocación
 * suelta en ese punto medio. Así se mueve como cualquier pieza suelta.
 */
export function banderinEntre(desde: Vec3, hasta: Vec3, o: Omit<OpcionesBanderin, "recorrido">): { pieza: Pieza; colocacion: Colocacion } {
  const medio = r3(por(suma(desde, hasta), 0.5));
  return {
    pieza: banderin({ ...o, recorrido: { tipo: "recto", desde: r3(resta(desde, medio)), hasta: r3(resta(hasta, medio)) } }),
    colocacion: { en: "libre", xCm: medio.x, yCm: medio.y, zCm: medio.z, giroGrados: 0 },
  };
}

/** Cuántos banderines caben a lo largo de un cordón de `largoCm` con su ancho y una separación. */
export const banderinesQueCaben = (largoCm: number, anchoCm: number, separacionCm = 4) => Math.max(1, Math.floor(largoCm / (anchoCm + separacionCm)));

// ----------------------------------------------------------------------------------------------------------
// Mesa: platos, vasos, servilletas, cubiertos, bandeja, mantel
// ----------------------------------------------------------------------------------------------------------

/** Un plato desechable (base, ala que sube y el centro), base en y = 0, cara hacia +y. */
function plato(diametroCm: number, hex: string, centro: string | null, motivo: MotivoEscenografia | null, y0: number): ElementoEscenografia[] {
  const R = diametroCm / 2, rFondo = R * 0.62;
  const salida: ElementoEscenografia[] = [
    { forma: "cilindro", base: v(0, y0, 0), radioCm: rFondo, altoCm: 0.3, hex, acabado: "papel" },
    { forma: "cilindro", base: v(0, y0 + 0.3, 0), radioCm: rFondo + 0.2, radioArribaCm: R, altoCm: 1.3, hex, acabado: "papel" },
  ];
  // El centro (de otro color o con lo impreso) asoma apenas sobre el ala.
  if (centro || motivo) salida.push({ forma: "cilindro", base: v(0, y0 + 1.6, 0), radioCm: rFondo * 1.05, altoCm: 0.06, hex: centro ?? hex, acabado: "papel", ...(motivo ? { motivo: { cara: "arriba", ...motivo } } : {}) });
  return salida;
}

export type OpcionesPlatos = {
  cantidad: number; diametroCm: number; hex: string; centro?: string | null; motivo?: MotivoEscenografia | null;
  /** De pie (apoyado hacia atrás, de cara al salón), como en las mesas de las fotos. */
  dePie?: boolean;
  productoId: string | null; descripcion?: string; variante?: string;
};

/** Platos apilados (cada uno 0,35 cm sobre el anterior) o uno de pie inclinado 15° hacia atrás. */
export function platos(o: OpcionesPlatos): Pieza {
  const n = Math.max(1, Math.round(o.cantidad));
  let elementos: ElementoEscenografia[] = [];
  for (let i = 0; i < n; i++) elementos.push(...plato(o.diametroCm, o.hex, o.centro ?? null, i === n - 1 ? o.motivo ?? null : null, i * 0.35));
  if (o.dePie) {
    // Su cara (+y) mira al frente y un poco arriba; el canto de abajo toca y = 0.
    const a = (15 * Math.PI) / 180, R = o.diametroCm / 2;
    const marco: MarcoElemento = { origen: v(0, redondo(R * Math.cos(a)), 0), ejeX: v(1, 0, 0), ejeY: r3(v(0, Math.sin(a), Math.cos(a))) };
    elementos = elementos.map((e) => enMarco(e, marco));
  }
  return utileria("plato", elementos, [productoDe(o.productoId, paquetesPara(o.productoId, n), o.descripcion ?? "platos desechables", o.variante)]);
}

export type OpcionesVasos = {
  cantidad: number; altoCm: number; diametroCm: number; hex: string; motivo?: MotivoEscenografia | null;
  /** Una servilleta doblada asomando de cada vaso (su color), como en las fotos. */
  servilleta?: string | null;
  productoId: string | null; descripcion?: string; variante?: string;
  servilletaProductoId?: string | null; servilletaVariante?: string;
};

/** Vasos desechables en fila (separados lo que mide uno y un poco), con servilleta asomada si se pide. */
export function vasos(o: OpcionesVasos): Pieza {
  const n = Math.max(1, Math.round(o.cantidad));
  const R = o.diametroCm / 2;
  const elementos: ElementoEscenografia[] = [];
  const paso = o.diametroCm + 2;
  for (let i = 0; i < n; i++) {
    const x = (i - (n - 1) / 2) * paso;
    elementos.push({ forma: "cilindro", base: v(x, 0, 0), radioCm: R * 0.78, radioArribaCm: R, altoCm: o.altoCm, hex: o.hex, acabado: "papel", ...(o.motivo ? { motivo: { cara: "frente", ...o.motivo } } : {}) });
    if (o.servilleta) {
      // La servilleta en abanico: dos paños triangulares cruzados que salen de la boca del vaso.
      const triangulo: Punto2[] = [{ x: -R * 0.9, y: 0 }, { x: R * 0.9, y: 0 }, { x: R * 1.25, y: R * 1.5 }, { x: 0, y: R * 2.1 }, { x: -R * 1.25, y: R * 1.5 }];
      const base = v(x, o.altoCm - R * 1.2, 0);
      elementos.push(
        { forma: "panel", contorno: triangulo, zCm: -0.1, grosorCm: 0.2, hex: o.servilleta, acabado: "papel", en: { origen: base, ejeX: r3(v(Math.cos(0.5), 0, -Math.sin(0.5))), ejeY: ARRIBA } },
        { forma: "panel", contorno: triangulo, zCm: -0.1, grosorCm: 0.2, hex: o.servilleta, acabado: "papel", en: { origen: base, ejeX: r3(v(Math.cos(-0.7), 0, -Math.sin(-0.7))), ejeY: ARRIBA } },
      );
    }
  }
  const productos = [productoDe(o.productoId, paquetesPara(o.productoId, n), o.descripcion ?? "vasos desechables", o.variante)];
  if (o.servilleta) productos.push(productoDe(o.servilletaProductoId ?? null, paquetesPara(o.servilletaProductoId ?? null, n), "servilletas de papel", o.servilletaVariante));
  return utileria("vaso", elementos, productos);
}

/** Servilletas dobladas en cuadro, apiladas (cada una 0,25 cm), la de arriba con su impreso. */
export function servilletas(o: { cantidad: number; ladoCm: number; hex: string; motivo?: MotivoEscenografia | null; productoId: string | null; descripcion?: string; variante?: string }): Pieza {
  const n = Math.max(1, Math.round(o.cantidad));
  const alto = n * 0.25;
  const elementos: ElementoEscenografia[] = [
    { forma: "caja", centro: v(0, alto / 2, 0), tamano: v(o.ladoCm, alto, o.ladoCm), hex: o.hex, acabado: "papel", giroGrados: 12, ...(o.motivo ? { motivo: { cara: "arriba", ...o.motivo } } : {}) },
  ];
  return utileria("servilleta", elementos, [productoDe(o.productoId, paquetesPara(o.productoId, n), o.descripcion ?? "servilletas de papel", o.variante)]);
}

/**
 * Juegos de cubiertos (tenedor, cuchillo y cuchara) acostados, uno junto a otro. En la tienda van por separado: un
 * producto por cada uno (paquetes para los juegos que se piden).
 */
export function cubiertos(o: { juegos: number; hex: string; productoIds: { tenedor: string | null; cuchillo: string | null; cuchara: string | null }; variante?: string }): Pieza {
  const n = Math.max(1, Math.round(o.juegos));
  const elementos: ElementoEscenografia[] = [];
  for (let j = 0; j < n; j++) {
    const x0 = (j - (n - 1) / 2) * 9;
    // Mango y cabeza de cada uno (la cuchara con la cabeza redonda, el tenedor y el cuchillo rectos).
    elementos.push(
      { forma: "caja", centro: v(x0 - 2.6, 0.2, 2), tamano: v(1.1, 0.4, 10), hex: o.hex, acabado: "satinado" },
      { forma: "caja", centro: v(x0 - 2.6, 0.2, -5.5), tamano: v(2.2, 0.4, 5), hex: o.hex, acabado: "satinado" },
      { forma: "caja", centro: v(x0, 0.2, 2), tamano: v(1.1, 0.4, 10), hex: o.hex, acabado: "satinado" },
      { forma: "caja", centro: v(x0, 0.2, -5.5), tamano: v(1.8, 0.4, 5), hex: o.hex, acabado: "satinado" },
      { forma: "caja", centro: v(x0 + 2.6, 0.2, 2), tamano: v(1.1, 0.4, 10), hex: o.hex, acabado: "satinado" },
      { forma: "cilindro", base: v(x0 + 2.6, 0, -5.3), radioCm: 1.6, altoCm: 0.5, hex: o.hex, acabado: "satinado" },
    );
  }
  const { tenedor, cuchillo, cuchara } = o.productoIds;
  return utileria("cubiertos", elementos, [
    productoDe(tenedor, paquetesPara(tenedor, n), "tenedores desechables", o.variante),
    productoDe(cuchillo, paquetesPara(cuchillo, n), "cuchillos desechables", o.variante),
    productoDe(cuchara, paquetesPara(cuchara, n), "cucharas desechables", o.variante),
  ]);
}

/** Bandeja (charola) con borde. */
export function bandeja(o: { anchoCm: number; fondoCm: number; hex: string; productoId: string | null; descripcion?: string; variante?: string }): Pieza {
  const { anchoCm: a, fondoCm: f } = o;
  const borde = 1.6;
  const elementos: ElementoEscenografia[] = [
    { forma: "caja", centro: v(0, 0.3, 0), tamano: v(a, 0.6, f), hex: o.hex, acabado: "satinado" },
    { forma: "caja", centro: v(0, borde / 2, f / 2 - 0.4), tamano: v(a, borde, 0.8), hex: o.hex, acabado: "satinado" },
    { forma: "caja", centro: v(0, borde / 2, -f / 2 + 0.4), tamano: v(a, borde, 0.8), hex: o.hex, acabado: "satinado" },
    { forma: "caja", centro: v(a / 2 - 0.4, borde / 2, 0), tamano: v(0.8, borde, f), hex: o.hex, acabado: "satinado" },
    { forma: "caja", centro: v(-a / 2 + 0.4, borde / 2, 0), tamano: v(0.8, borde, f), hex: o.hex, acabado: "satinado" },
  ];
  return utileria("bandeja", elementos, [productoDe(o.productoId, 1, o.descripcion ?? "bandeja", o.variante)]);
}

/**
 * Mantel de plástico con caída: la tela de la tapa en y = 0 (su origen va en la tapa de la mesa) y cuatro paños que
 * caen `caidaCm` por los lados (un poco abiertos, como cae el plástico).
 */
export function mantel(o: { anchoCm: number; fondoCm: number; caidaCm: number; hex: string; productoId: string | null; descripcion?: string; variante?: string }): Pieza {
  const { anchoCm: a, fondoCm: f, caidaCm: c } = o;
  const abre = Math.min(6, c * 0.08);
  const pano = (ancho: number): Punto2[] => [{ x: -ancho / 2 - abre, y: -c }, { x: ancho / 2 + abre, y: -c }, { x: ancho / 2, y: 0 }, { x: -ancho / 2, y: 0 }];
  const elementos: ElementoEscenografia[] = [
    { forma: "caja", centro: v(0, 0.15, 0), tamano: v(a + 1.2, 0.3, f + 1.2), hex: o.hex, acabado: "brillante" },
    { forma: "panel", contorno: pano(a + 1.2), zCm: f / 2 + 0.3, grosorCm: 0.3, hex: o.hex, acabado: "brillante" },
    { forma: "panel", contorno: pano(a + 1.2), zCm: -f / 2 - 0.6, grosorCm: 0.3, hex: o.hex, acabado: "brillante" },
    { forma: "panel", contorno: pano(f + 1.2), zCm: a / 2 + 0.3, grosorCm: 0.3, hex: o.hex, acabado: "brillante", en: { origen: v(0, 0, 0), ejeX: v(0, 0, -1), ejeY: ARRIBA } },
    { forma: "panel", contorno: pano(f + 1.2), zCm: a / 2 + 0.3, grosorCm: 0.3, hex: o.hex, acabado: "brillante", en: { origen: v(0, 0, 0), ejeX: v(0, 0, 1), ejeY: ARRIBA } },
  ];
  return utileria("mantel", elementos, [productoDe(o.productoId, 1, o.descripcion ?? "mantel de plástico", o.variante)]);
}

// ----------------------------------------------------------------------------------------------------------
// Piso y regalos: bolsa y calabaza de dulces, gorrito, letrero/topper, velas, caja de regalo, paquete
// ----------------------------------------------------------------------------------------------------------

/** Bolsa de dulces de papel con asas y su impreso al frente. */
export function bolsaDulces(o: { anchoCm: number; altoCm: number; fondoCm: number; hex: string; asas?: string; motivo?: MotivoEscenografia | null; cantidad?: number; productoId: string | null; descripcion?: string }): Pieza {
  const { anchoCm: a, altoCm: h, fondoCm: f } = o;
  const asa = contornoAsa(a * 0.55, h * 0.45, 1.2);
  const elementos: ElementoEscenografia[] = [
    { forma: "caja", centro: v(0, h / 2, 0), tamano: v(a, h, f), hex: o.hex, acabado: "papel", ...(o.motivo ? { motivo: { cara: "frente", ...o.motivo } } : {}) },
    { forma: "panel", contorno: asa, zCm: f / 2 - 1.2, grosorCm: 0.3, hex: o.asas ?? o.hex, acabado: "papel", en: { origen: v(0, h - 0.5, 0), ejeX: v(1, 0, 0), ejeY: ARRIBA } },
    { forma: "panel", contorno: asa, zCm: -f / 2 + 0.9, grosorCm: 0.3, hex: o.asas ?? o.hex, acabado: "papel", en: { origen: v(0, h - 0.5, 0), ejeX: v(1, 0, 0), ejeY: ARRIBA } },
  ];
  const n = Math.max(1, Math.round(o.cantidad ?? 1));
  return utileria("bolsa_dulces", elementos, [productoDe(o.productoId, paquetesPara(o.productoId, n), o.descripcion ?? "bolsa de dulces")]);
}

/** Cubeta de dulces en forma de calabaza (la cara impresa al frente) con su asa negra. */
export function calabazaDulces(o: { diametroCm: number; altoCm: number; hex: string; asa?: string; productoId: string | null; descripcion?: string }): Pieza {
  const R = o.diametroCm / 2;
  const asa = o.asa ?? "#1a1414";
  const elementos: ElementoEscenografia[] = [
    { forma: "cilindro", base: v(0, 0, 0), radioCm: R * 0.82, radioArribaCm: R, altoCm: o.altoCm * 0.55, hex: o.hex, acabado: "satinado" },
    { forma: "cilindro", base: v(0, o.altoCm * 0.55, 0), radioCm: R, radioArribaCm: R * 0.88, altoCm: o.altoCm * 0.45, hex: o.hex, acabado: "satinado", motivo: { dibujo: "calabaza", cara: "frente", hex: "#1a1414", escala: 1.3 } },
    { forma: "cilindro", base: v(0, o.altoCm - 0.6, 0), radioCm: R * 0.9, altoCm: 0.8, hex: asa, acabado: "satinado" },
    { forma: "panel", contorno: contornoAsa(R * 1.8, R * 0.9, 0.9), zCm: -0.3, grosorCm: 0.6, hex: asa, acabado: "satinado", en: { origen: v(0, o.altoCm - 0.4, 0), ejeX: v(1, 0, 0), ejeY: ARRIBA } },
  ];
  return utileria("calabaza_dulces", elementos, [productoDe(o.productoId, 1, o.descripcion ?? "cubeta de dulces de calabaza")]);
}

/** Gorrito de fiesta (cono con pompón). */
export function gorrito(o: { altoCm: number; diametroCm: number; hex: string; pompon?: string; cantidad?: number; productoId: string | null; descripcion?: string }): Pieza {
  const n = Math.max(1, Math.round(o.cantidad ?? 1));
  const R = o.diametroCm / 2;
  const elementos: ElementoEscenografia[] = [];
  for (let i = 0; i < n; i++) {
    const x = (i - (n - 1) / 2) * (o.diametroCm + 3);
    elementos.push(
      { forma: "cilindro", base: v(x, 0, 0), radioCm: R, radioArribaCm: 0.3, altoCm: o.altoCm, hex: o.hex, acabado: "papel" },
      { forma: "cilindro", base: v(x, o.altoCm - 0.6, 0), radioCm: 1.6, radioArribaCm: 1.2, altoCm: 2.6, hex: o.pompon ?? "#ffffff", acabado: "tela" },
    );
  }
  return utileria("gorrito", elementos, [productoDe(o.productoId, paquetesPara(o.productoId, n), o.descripcion ?? "gorritos de fiesta")]);
}

/**
 * Letrero o topper: un recorte (rectángulo, círculo o calabaza) con lo impreso al frente. `apoyo`: con un palito
 * debajo (topper de pastel o de maceta), en atril (apoyado hacia atrás en el piso o en la mesa) o colgado (su borde
 * de abajo en y = 0, sin apoyo: para pegarlo en un frente).
 */
export function letrero(o: { forma: "rectangulo" | "circulo" | "calabaza"; anchoCm: number; altoCm: number; hex: string; motivo: MotivoEscenografia | null; apoyo: "palito" | "atril" | "colgado"; productoId: string | null; descripcion?: string; tipo?: "letrero" | "topper" }): Pieza {
  const { anchoCm: a, altoCm: h } = o;
  let contorno: Punto2[];
  if (o.forma === "rectangulo") contorno = [{ x: -a / 2, y: 0 }, { x: a / 2, y: 0 }, { x: a / 2, y: h }, { x: -a / 2, y: h }];
  else if (o.forma === "circulo") contorno = contornoCirculo(Math.min(a, h) / 2, { x: 0, y: Math.min(a, h) / 2 });
  else {
    // Calabaza: un óvalo ancho con un tallito arriba.
    const pasos = 30;
    contorno = Array.from({ length: pasos }, (_, i) => {
      const t = (2 * Math.PI * i) / pasos - Math.PI / 2;
      const ondula = 1 + 0.05 * Math.cos(6 * t);
      return { x: redondo((a / 2) * Math.cos(t) * ondula), y: redondo(h * 0.42 + h * 0.42 * Math.sin(t) * ondula) };
    });
    const tope = h * 0.84;
    contorno.splice(Math.round(pasos / 4) + 1, 0, { x: a * 0.05, y: tope }, { x: a * 0.08, y: h }, { x: -a * 0.02, y: h }, { x: -a * 0.05, y: tope });
  }
  const palito = o.apoyo === "palito" ? h * 0.6 : 0;
  const tablero: ElementoEscenografia = { forma: "panel", contorno, zCm: -0.25, grosorCm: 0.5, hex: o.hex, acabado: "papel", ...(o.motivo ? { motivo: { cara: "frente", ...o.motivo } } : {}) };
  const elementos: ElementoEscenografia[] = [];
  if (o.apoyo === "atril") {
    const a12 = (12 * Math.PI) / 180;
    elementos.push(enMarco(tablero, { origen: v(0, 0, 0), ejeX: v(1, 0, 0), ejeY: r3(v(0, Math.cos(a12), -Math.sin(a12))) }));
    // La pata de atrás.
    elementos.push(tramo(v(0, h * 0.55 * Math.cos(a12), -h * 0.55 * Math.sin(a12) - 0.3), v(0, 0, -h * 0.4), 0.3, "#c9b28f"));
  } else {
    elementos.push(enMarco(tablero, { origen: v(0, palito, 0), ejeX: v(1, 0, 0), ejeY: ARRIBA }));
    if (palito > 0) elementos.push({ forma: "cilindro", base: v(0, 0, 0), radioCm: 0.25, altoCm: palito + 1, hex: "#e9dcc4", acabado: "madera" });
  }
  return utileria(o.tipo ?? (o.apoyo === "palito" ? "topper" : "letrero"), elementos, [productoDe(o.productoId, 1, o.descripcion ?? (o.apoyo === "palito" ? "topper" : "letrero"))]);
}

/** Velas de cumpleaños con su llama. */
export function velas(o: { cantidad: number; altoCm: number; hex: string; productoId: string | null; descripcion?: string }): Pieza {
  const n = Math.max(1, Math.round(o.cantidad));
  const elementos: ElementoEscenografia[] = [];
  for (let i = 0; i < n; i++) {
    const ang = (2 * Math.PI * i) / n, r = n > 1 ? 3 + n * 0.4 : 0;
    const base = v(redondo(r * Math.sin(ang)), 0, redondo(r * Math.cos(ang)));
    elementos.push(
      { forma: "cilindro", base, radioCm: 0.45, altoCm: o.altoCm, hex: o.hex, acabado: "satinado" },
      { forma: "cilindro", base: v(base.x, o.altoCm, base.z), radioCm: 0.05, altoCm: 0.6, hex: "#2b2b2b", acabado: "mate" },
      { forma: "cilindro", base: v(base.x, o.altoCm + 0.5, base.z), radioCm: 0.38, radioArribaCm: 0.02, altoCm: 1.6, hex: "#ffc23d", acabado: "llama" },
    );
  }
  return utileria("vela", elementos, [productoDe(o.productoId, paquetesPara(o.productoId, n), o.descripcion ?? "velas de cumpleaños")]);
}

/** Caja de regalo con listón en cruz y moño. */
export function cajaRegalo(o: { ladoCm: number; altoCm: number; hex: string; liston: string; productoId: string | null; descripcion?: string }): Pieza {
  const { ladoCm: l, altoCm: h } = o;
  const banda = Math.max(1.5, l * 0.12);
  const elementos: ElementoEscenografia[] = [
    { forma: "caja", centro: v(0, h / 2, 0), tamano: v(l, h, l), hex: o.hex, acabado: "papel" },
    { forma: "caja", centro: v(0, h - 1, 0), tamano: v(l + 0.8, 2, l + 0.8), hex: o.hex, acabado: "papel" },
    { forma: "caja", centro: v(0, h / 2 + 0.05, 0), tamano: v(banda, h + 0.3, l + 1), hex: o.liston, acabado: "satinado" },
    { forma: "caja", centro: v(0, h / 2 + 0.05, 0), tamano: v(l + 1, h + 0.3, banda), hex: o.liston, acabado: "satinado" },
    { forma: "caja", centro: v(-l * 0.13, h + l * 0.08, 0), tamano: v(l * 0.3, l * 0.14, banda), hex: o.liston, acabado: "satinado", giroGrados: 0, en: { origen: v(0, 0, 0), ejeX: r3(unitario(v(1, 0.5, 0))), ejeY: r3(unitario(v(-0.5, 1, 0))) } },
    { forma: "caja", centro: v(l * 0.13, h + l * 0.08, 0), tamano: v(l * 0.3, l * 0.14, banda), hex: o.liston, acabado: "satinado", en: { origen: v(0, 0, 0), ejeX: r3(unitario(v(1, -0.5, 0))), ejeY: r3(unitario(v(0.5, 1, 0))) } },
  ];
  return utileria("caja_regalo", elementos, [productoDe(o.productoId, 1, o.descripcion ?? "caja de regalo")]);
}

/** Un producto en su empaque (bolsa o caja con su etiqueta impresa), de pie o acostado: lo que se exhibe al frente. */
export function paquete(o: { anchoCm: number; altoCm: number; fondoCm: number; hex: string; motivo: MotivoEscenografia | null; acostado?: boolean; productoId: string | null; descripcion?: string }): Pieza {
  const { anchoCm: a, altoCm: h, fondoCm: f } = o;
  const elementos: ElementoEscenografia[] = o.acostado
    ? [{ forma: "caja", centro: v(0, f / 2, 0), tamano: v(a, f, h), hex: o.hex, acabado: "brillante", ...(o.motivo ? { motivo: { cara: "arriba", ...o.motivo } } : {}) }]
    : [{ forma: "caja", centro: v(0, h / 2, 0), tamano: v(a, h, f), hex: o.hex, acabado: "brillante", ...(o.motivo ? { motivo: { cara: "frente", ...o.motivo } } : {}) }];
  return utileria("paquete", elementos, [productoDe(o.productoId, 1, o.descripcion ?? "producto empacado")]);
}

// ----------------------------------------------------------------------------------------------------------
// Sobre una mesa
// ----------------------------------------------------------------------------------------------------------

/**
 * La altura de la superficie de arriba de una mesa (sus sólidos ya en el mundo) en (x, z): la tapa más alta de las
 * cajas y cilindros derechos que tienen ese punto en su huella (los paños de la falda no cuentan). null si no hay.
 */
export function superficieEn(solidos: readonly SolidoEscenografia[], x: number, z: number): number | null {
  let mejor: number | null = null;
  for (const s of solidos) {
    if (s.ejeY.y < 0.999) continue;
    const d = v(x - s.origen.x, 0, z - s.origen.z);
    let arriba: number | null = null;
    if (s.forma === "caja") {
      const u = d.x * s.ejeX.x + d.z * s.ejeX.z, w = d.x * s.ejeZ.x + d.z * s.ejeZ.z;
      if (Math.abs(u) <= s.tamano.x / 2 && Math.abs(w) <= s.tamano.z / 2) arriba = s.origen.y + s.tamano.y / 2;
    } else if (s.forma === "cilindro") {
      if (Math.hypot(d.x, d.z) <= Math.max(s.radioCm, s.radioArribaCm)) arriba = s.origen.y + s.altoCm;
    }
    if (arriba !== null && (mejor === null || arriba > mejor)) mejor = arriba;
  }
  return mejor;
}

/** Lo armado de una mesa de la escena (sola si va en el piso, en una pared o suelta: no hace falta armar lo demás). */
function mesaArmada(escena: Escena, mesaId: string, armada?: EscenaArmada): NodoArmado | null {
  const hecha = armada?.porNodo.find((n) => n.id === mesaId);
  if (hecha) return hecha;
  const mesa = escena.nodos.find((n) => n.id === mesaId);
  if (!mesa) return null;
  const sola = mesa.colocacion.en !== "ancla" && mesa.colocacion.en !== "sobre";
  return armarEscena(sola ? { sala: escena.sala, nodos: [mesa] } : escena).porNodo.find((n) => n.id === mesaId) ?? null;
}

/**
 * Dónde va una pieza de utilería sobre una mesa de la escena: suelta, con su base en la tapa (la superficie más alta
 * bajo ese punto: el mantel, el camino o una tarima), corrida (dx, dz) del centro de la mesa. null si ahí no hay mesa.
 */
export function sobreMesa(escena: Escena, mesaId: string, dxCm: number, dzCm: number, giroGrados = 0, armada?: EscenaArmada): Colocacion | null {
  const mesa = mesaArmada(escena, mesaId, armada);
  if (!mesa || !mesa.solidos.length) return null;
  const x = (mesa.caja.min.x + mesa.caja.max.x) / 2 + dxCm, z = (mesa.caja.min.z + mesa.caja.max.z) / 2 + dzCm;
  const y = superficieEn(mesa.solidos, x, z);
  if (y === null) return null;
  return { en: "libre", xCm: redondo(x), yCm: redondo(y), zCm: redondo(z), giroGrados };
}

/** Si una pieza de la escena tiene una tapa donde poner cosas (una mesa): su centro tiene superficie. */
export function esMesa(escena: Escena, nodoId: string, armada?: EscenaArmada): boolean {
  const nodo = escena.nodos.find((n) => n.id === nodoId);
  if (!nodo || nodo.pieza.tipo !== "escenografia" || nodo.pieza.utileria) return false;
  return sobreMesa(escena, nodoId, 0, 0, 0, armada) !== null && (mesaArmada(escena, nodoId, armada)?.caja.max.y ?? 0) > 30;
}

// ----------------------------------------------------------------------------------------------------------
// Banderín entre dos puntos de una estructura
// ----------------------------------------------------------------------------------------------------------

/**
 * Los dos puntos de una estructura de donde colgar un banderín: a `fraccionAlto` de su altura, la cara de dentro de
 * los globos de cada lado (lo más hacia el centro que llega un globo a esa altura), en el plano de sus globos. Sin
 * globos a esa altura (un marco de escenografía), los bordes de su caja metidos un 15 %.
 */
export function puntosBanderinEn(nodo: NodoArmado, fraccionAlto = 0.72): { desde: Vec3; hasta: Vec3 } {
  const { min, max } = nodo.caja;
  const y = min.y + (max.y - min.y) * fraccionAlto;
  const cx = (min.x + max.x) / 2;
  let izquierda = -Infinity, derecha = Infinity, zSuma = 0, zCuenta = 0;
  for (const g of nodo.globos) {
    const r = g.infladoCm / 2;
    const c = suma(g.nudo, por(g.direccion, r + g.cuelloExtraCm));
    const dy = Math.abs(c.y - y);
    if (dy >= r) continue;
    const media = Math.sqrt(r * r - dy * dy);
    if (c.x < cx) izquierda = Math.max(izquierda, c.x + media); else derecha = Math.min(derecha, c.x - media);
    zSuma += c.z; zCuenta++;
  }
  const z = zCuenta ? zSuma / zCuenta : max.z;
  if (!Number.isFinite(izquierda) || !Number.isFinite(derecha) || derecha - izquierda < 30) {
    const ancho = max.x - min.x;
    return { desde: r3(v(min.x + ancho * 0.15, y, max.z)), hasta: r3(v(max.x - ancho * 0.15, y, max.z)) };
  }
  return { desde: r3(v(izquierda, y, z)), hasta: r3(v(derecha, y, z)) };
}

// ----------------------------------------------------------------------------------------------------------
// Lista «Productos de fiesta» de una escena
// ----------------------------------------------------------------------------------------------------------

export type ProductoEnLista = { nombre: string; url: string; cantidad: number; variante: string | null; generico: boolean; /** Las piezas de la escena que lo usan. */ piezas: string[] };

/**
 * Los productos de fiesta de una escena: los de cada pieza de utilería por las veces que quedó puesta (sus copias en
 * `armada`; 1 sin ella), sumados por producto, primero los del catálogo y luego los genéricos.
 */
export function productosDeFiesta(escena: Escena, armada?: EscenaArmada): ProductoEnLista[] {
  const porClave = new Map<string, ProductoEnLista>();
  for (const nodo of escena.nodos) {
    if (nodo.pieza.tipo !== "escenografia" || !nodo.pieza.productos?.length) continue;
    const copias = armada ? armada.porNodo.find((n) => n.id === nodo.id)?.copias ?? 0 : 1;
    if (copias <= 0) continue;
    for (const p of nodo.pieza.productos) {
      const clave = `${p.url}|${p.nombre}|${p.variante ?? ""}`;
      const previo = porClave.get(clave);
      if (previo) { previo.cantidad += p.cantidad * copias; if (!previo.piezas.includes(nodo.nombre)) previo.piezas.push(nodo.nombre); }
      else porClave.set(clave, { nombre: p.nombre, url: p.url, cantidad: p.cantidad * copias, variante: p.variante ?? null, generico: Boolean(p.generico), piezas: [nodo.nombre] });
    }
  }
  return [...porClave.values()].sort((a, b) => Number(a.generico) - Number(b.generico) || a.nombre.localeCompare(b.nombre, "es") || (a.variante ?? "").localeCompare(b.variante ?? "", "es"));
}

/** Mete una pieza de utilería en la escena con su colocación; devuelve la escena nueva y el id. */
export function agregarUtileria(escena: Escena, pieza: Pieza, colocacion: Colocacion, nombre: string, idBase: string): { escena: Escena; id: string } {
  const id = idNuevo(escena, idBase);
  const nodo: NodoEscena = { id, nombre, pieza, colocacion };
  return { escena: { ...escena, nodos: [...escena.nodos, nodo] }, id };
}
