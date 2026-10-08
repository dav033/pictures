import type { Vec3 } from "./modulos";
import type { TuboDecoracion } from "./decoraciones";
import type { MaterialDecoracion } from "./figuras";
import { formatoPorId } from "./formatos";

/**
 * **Rizos de tubito** (T-160 / T-260 / T-360), todo por propiedades: lo que más falta en las «Ideas de fiesta» de
 * sempertex.com después de figuras, formas e impresos (108 ideas los usan).
 *
 * - **Tirabuzón**: el tubito enrollado en espiral cónica (se enrolla en un palo y se suelta): vueltas, radio al
 *   empezar y al terminar, largo. Cuelga hacia abajo desde el amarre, o sale de frente (el rizo pegado a una columna).
 * - **Resorte**: lo mismo con el radio constante (espiral cilíndrica).
 * - **Penacho**: varios tirabuzones que salen de un mismo punto, abiertos en cono (remate de columna, nido de un
 *   topiario, el chorro de rizos de un colgante).
 * - **Flecos**: tiras onduladas que cuelgan de una barra (el colgante tipo medusa).
 * - **Voluta**: espiral plana (pétalos, marcos, adornos de pared).
 * - **Burbujas en cadena**: un tubito retorcido en burbujas que se tocan, en recta (colgando), en aro (un polígono:
 *   5 burbujas hacen un pentágono) o en contorno de estrella.
 *
 * Se arman en el espacio de las decoraciones **de pie** (como el moño y la estrella en una pared): +z es arriba, +y
 * hacia quien mira y x hacia su izquierda (`P(derecha, frente, arriba)`); el amarre (por donde se cuelga o se pega)
 * está en el origen. **Materiales**: cada tirabuzón, resorte, rizo de un penacho, fleco o voluta es un tubito aparte
 * (o más, si su largo no cabe en uno); una cadena de burbujas es un tubito largo retorcido: se cuenta por largo, como
 * en `materialesDecoracion` (`figuras.ts`). Unidades: cm.
 * Todo determinista: mismas propiedades, mismos puntos.
 */

/** Un tubito: formato (T-160, T-260, T-360), grosor inflado y color. */
export type TubitoRizo = { formatoId: string; grosorCm: number; codigo: string };

/** «abajo»: el rizo cuelga del amarre (eje −z); «frente»: sale hacia quien mira (eje +y), de frente se ve en espiral. */
export type EjeRizo = "abajo" | "frente";

export type RizoTirabuzon = {
  forma: "tirabuzon"; tubito: TubitoRizo; vueltas: number;
  /** Radio de la espiral junto al amarre y en la punta (cónica si son distintos). */
  radioInicialCm: number; radioFinalCm: number;
  /** Largo a lo largo del eje (las espiras nunca se montan: el paso es al menos el grosor). */
  largoCm: number; eje?: EjeRizo; giroGrados?: number;
};
export type RizoResorte = { forma: "resorte"; tubito: TubitoRizo; vueltas: number; radioCm: number; largoCm: number; eje?: EjeRizo; giroGrados?: number };
export type RizoPenacho = {
  forma: "penacho"; formatoId: string; grosorCm: number;
  /** Colores rizo a rizo, en ciclo. */
  codigos: string[]; rizos: number; vueltas: number; radioInicialCm: number; radioFinalCm: number; largoCm: number;
  /** Hacia dónde sale el penacho: 0° = arriba (remate de columna), 90° = de frente, 180° = abajo (colgante). */
  inclinacionGrados: number;
  /** Medio ángulo del cono en que se abren los rizos. */
  aperturaGrados: number;
};
export type RizoFlecos = {
  forma: "flecos"; formatoId: string; grosorCm: number; codigos: string[]; tiras: number;
  /** Ancho de la barra de la que cuelgan. */
  anchoCm: number; largoCm: number;
  /** Cuántas ondas hace cada tira y de qué amplitud. */
  ondas: number; amplitudCm: number;
  /** 0–0,5: cuánto más cortas pueden quedar algunas tiras (las puntas desparejas de la foto). */
  disparejo?: number;
};
export type RizoVoluta = { forma: "voluta"; tubito: TubitoRizo; vueltas: number; radioInicialCm: number; radioFinalCm: number; giroGrados?: number };
export type RizoBurbujas = {
  forma: "burbujas"; formatoId: string; grosorCm: number;
  /** Colores burbuja a burbuja, en ciclo. */
  codigos: string[];
  /** Largo de cada burbuja (de torcedura a torcedura), en ciclo: [9, 3, 3] = una grande y dos chiquitas. */
  largosCm: number[];
  recorrido: "recta" | "aro" | "estrella";
  /** Recta y aro: cuántas burbujas. En la estrella salen del contorno. */
  cantidad: number;
  /** Estrella: puntas, radio de las puntas y de los vértices de adentro. */
  puntas?: number; radioCm?: number; radioInteriorCm?: number; giroGrados?: number;
};

export type PropiedadesRizo = RizoTirabuzon | RizoResorte | RizoPenacho | RizoFlecos | RizoVoluta | RizoBurbujas;
export type FormaRizo = PropiedadesRizo["forma"];
export type DecoracionRizo = { tipo: "rizo"; propiedades: PropiedadesRizo };

export type RizoArmado = { tubos: TuboDecoracion[]; materiales: MaterialDecoracion[]; radioCm: number; fondoCm: number; altoCm: number; anchoCm: number };

const rad = (g: number) => (g * Math.PI) / 180;
const r2 = (n: number) => Math.round(n * 100) / 100;
const mas = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const menos = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const por = (a: Vec3, k: number): Vec3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const largo3 = (a: Vec3) => Math.hypot(a.x, a.y, a.z);
const unitario = (a: Vec3): Vec3 => por(a, 1 / (largo3(a) || 1));
const cruz = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const redondo = (p: Vec3): Vec3 => ({ x: Math.round(p.x * 1000) / 1000 + 0, y: Math.round(p.y * 1000) / 1000 + 0, z: Math.round(p.z * 1000) / 1000 + 0 });
/** Lo que ve quien mira: a su derecha, hacia él y arriba. */
const P = (derecha: number, frente: number, arriba: number): Vec3 => ({ x: -derecha, y: frente, z: arriba });
const PUNTOS_POR_VUELTA = 18;
const limitar = (v: number, min: number, max: number) => Math.min(max, Math.max(min, Number.isFinite(v) ? v : min));

/** Dos vectores perpendiculares al eje (y entre sí), para dibujar la espiral alrededor de él. */
function baseDe(eje: Vec3): { u: Vec3; v: Vec3 } {
  const e = unitario(eje);
  const auxiliar: Vec3 = Math.abs(e.z) < 0.9 ? { x: 0, y: 0, z: 1 } : { x: 0, y: 1, z: 0 };
  const u = unitario(cruz(auxiliar, e));
  return { u, v: cruz(e, u) };
}

/**
 * Espiral alrededor de `eje` desde `origen`: `vueltas` vueltas, radio de `r0` a `r1` y `largo` a lo largo del eje.
 * El primer punto ya está en la espiral (a `r0` del eje): el amarre queda junto al eje, a un radio.
 */
export function espiral(origen: Vec3, eje: Vec3, vueltas: number, r0: number, r1: number, largo: number, giroRad = 0): Vec3[] {
  const e = unitario(eje);
  const { u, v } = baseDe(e);
  const n = Math.max(6, Math.ceil(vueltas * PUNTOS_POR_VUELTA));
  const puntos: Vec3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = giroRad + 2 * Math.PI * vueltas * t;
    const r = r0 + (r1 - r0) * t;
    puntos.push(redondo(mas(origen, mas(por(e, largo * t), mas(por(u, r * Math.cos(a)), por(v, r * Math.sin(a)))))));
  }
  return puntos;
}

/** Vueltas, radios y largo válidos para un tubito de grosor `g`: las espiras no se montan (paso ≥ 1,05 grosores). */
function medidasEspiral(g: number, vueltas: number, r0: number, r1: number, largo: number) {
  const n = limitar(vueltas, 0.25, 20);
  const radioMin = g * 0.6;
  return { vueltas: n, r0: limitar(r0, radioMin, 200), r1: limitar(r1, radioMin, 200), largo: Math.max(limitar(largo, 0, 1000), n * g * 1.05) };
}

const EJE: Readonly<Record<EjeRizo, Vec3>> = { abajo: { x: 0, y: 0, z: -1 }, frente: { x: 0, y: 1, z: 0 } };

function tirabuzon(t: TubitoRizo, vueltas: number, r0: number, r1: number, largo: number, eje: Vec3, origen: Vec3 = { x: 0, y: 0, z: 0 }, giroRad = 0): TuboDecoracion {
  const g = Math.max(0.5, t.grosorCm);
  const m = medidasEspiral(g, vueltas, r0, r1, largo);
  // El rizo arranca a medio grosor del amarre (el nudo queda pegado, no metido).
  const inicio = mas(origen, por(unitario(eje), g / 2));
  return { formatoId: t.formatoId, grosorCm: g, codigo: t.codigo, puntos: espiral(inicio, eje, m.vueltas, m.r0, m.r1, m.largo, giroRad), cerrado: false };
}

/** Las direcciones de los rizos de un penacho: repartidas en el cono (ángulo de oro), deterministas. */
export function direccionesPenacho(n: number, inclinacionGrados: number, aperturaGrados: number): Vec3[] {
  const centro = unitario({ x: 0, y: Math.sin(rad(inclinacionGrados)), z: Math.cos(rad(inclinacionGrados)) });
  const { u, v } = baseDe(centro);
  const oro = Math.PI * (3 - Math.sqrt(5));
  const salida: Vec3[] = [];
  for (let k = 0; k < n; k++) {
    const polar = rad(limitar(aperturaGrados, 0, 90)) * Math.sqrt((k + 0.5) / n);
    const az = k * oro;
    salida.push(unitario(mas(por(centro, Math.cos(polar)), por(mas(por(u, Math.cos(az)), por(v, Math.sin(az))), Math.sin(polar)))));
  }
  return salida;
}

function armarPenacho(p: RizoPenacho): TuboDecoracion[] {
  const n = Math.round(limitar(p.rizos, 1, 24));
  const codigos = p.codigos.length ? p.codigos : ["005"];
  return direccionesPenacho(n, p.inclinacionGrados, p.aperturaGrados).map((d, k) =>
    tirabuzon({ formatoId: p.formatoId, grosorCm: p.grosorCm, codigo: codigos[k % codigos.length]! }, p.vueltas, p.radioInicialCm, p.radioFinalCm, p.largoCm, d, { x: 0, y: 0, z: 0 }, k * 2.1));
}

function armarFlecos(p: RizoFlecos): TuboDecoracion[] {
  const n = Math.round(limitar(p.tiras, 1, 80));
  const g = Math.max(0.5, p.grosorCm);
  const codigos = p.codigos.length ? p.codigos : ["005"];
  const ancho = Math.max(0, p.anchoCm);
  const ondas = limitar(p.ondas, 0, 12);
  const disparejo = limitar(p.disparejo ?? 0.15, 0, 0.5);
  const tubos: TuboDecoracion[] = [];
  for (let k = 0; k < n; k++) {
    // A lo ancho de la barra, en dos filas (una un grosor más adelante) para que tapen como en la foto.
    const derecha = n === 1 ? 0 : -ancho / 2 + (ancho * k) / (n - 1);
    const fila = k % 2 === 0 ? 0 : g;
    // Largo y fase de cada tira: deterministas y distintos (la sucesión de Weyl con la razón áurea).
    const h = (k * 0.6180339887) % 1;
    const largo = Math.max(g * 2, p.largoCm * (1 - disparejo * h));
    const fase = 2 * Math.PI * ((k * 0.381966) % 1);
    const muestras = Math.max(6, Math.ceil(ondas * 10) + 2);
    const puntos: Vec3[] = [];
    for (let i = 0; i <= muestras; i++) {
      const t = i / muestras;
      // La onda crece desde la barra (amarrada) hacia la punta (suelta).
      const a = p.amplitudCm * Math.min(1, t * 3);
      puntos.push(redondo(P(derecha + a * Math.sin(2 * Math.PI * ondas * t + fase), fila + a * 0.5 * Math.cos(2 * Math.PI * ondas * t + fase), -g / 2 - largo * t)));
    }
    tubos.push({ formatoId: p.formatoId, grosorCm: g, codigo: codigos[k % codigos.length]!, puntos, cerrado: false });
  }
  return tubos;
}

function armarVoluta(p: RizoVoluta): TuboDecoracion[] {
  const g = Math.max(0.5, p.tubito.grosorCm);
  const vueltas = limitar(p.vueltas, 0.25, 8);
  // Las espiras de una voluta plana no se montan: la separación radial por vuelta es al menos el grosor.
  const r0 = limitar(p.radioInicialCm, g * 0.6, 200);
  const r1 = Math.max(limitar(p.radioFinalCm, g * 0.6, 200), r0 + vueltas * g * 1.05);
  const n = Math.max(8, Math.ceil(vueltas * PUNTOS_POR_VUELTA * 1.5));
  const giro = rad(p.giroGrados ?? 0);
  const puntos: Vec3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = giro + 2 * Math.PI * vueltas * t;
    const r = r0 + (r1 - r0) * t;
    puntos.push(redondo(P(r * Math.cos(a), 0, r * Math.sin(a))));
  }
  return [{ formatoId: p.tubito.formatoId, grosorCm: g, codigo: p.tubito.codigo, puntos, cerrado: false }];
}

/** El contorno de una estrella (puntas y vértices de adentro alternados), con la primera punta arriba. */
function contornoEstrella(puntas: number, radio: number, interior: number, giroRad: number): Vec3[] {
  const n = Math.round(limitar(puntas, 3, 12));
  const salida: Vec3[] = [];
  for (let j = 0; j < 2 * n; j++) {
    const r = j % 2 === 0 ? radio : interior;
    const a = Math.PI / 2 + giroRad + (Math.PI * j) / n;
    salida.push(P(r * Math.cos(a), 0, r * Math.sin(a)));
  }
  return salida;
}

/**
 * Una burbuja de tubito entre dos torceduras `a` y `b`: el eje va de `a` a `b` acortado medio grosor de cada lado
 * (las puntas redondas llegan justo a las torceduras, donde toca a la siguiente). Una burbuja más corta que el grosor
 * queda redonda.
 */
function burbuja(a: Vec3, b: Vec3, g: number, formatoId: string, codigo: string): TuboDecoracion {
  const d = menos(b, a);
  const l = largo3(d);
  const u = unitario(d);
  const recorte = Math.min(g / 2, l * 0.45);
  const ini = mas(a, por(u, recorte)), fin = menos(b, por(u, recorte));
  return { formatoId, grosorCm: g, codigo, puntos: [redondo(ini), redondo(por(mas(ini, fin), 0.5)), redondo(fin)], cerrado: false };
}

/** Las torceduras de una cadena: los vértices del recorrido y, en cada tramo, las que caben con el ciclo de largos. */
function torcedurasEnTramos(vertices: readonly Vec3[], cerrado: boolean, largos: readonly number[]): Vec3[] {
  const salida: Vec3[] = [vertices[0]!];
  let k = 0;
  const tramos = cerrado ? vertices.length : vertices.length - 1;
  for (let i = 0; i < tramos; i++) {
    const a = vertices[i]!, b = vertices[(i + 1) % vertices.length]!;
    const l = largo3(menos(b, a));
    // Cuántas burbujas del ciclo caben en el tramo; se estiran o encogen un poco para llenarlo justo.
    const elegidos: number[] = [];
    let suma = 0;
    while (suma < l - 1e-9) {
      const x = largos[k % largos.length]!;
      if (elegidos.length && suma + x / 2 > l) break;
      elegidos.push(x); suma += x; k++;
    }
    if (!elegidos.length) { elegidos.push(largos[k % largos.length]!); suma = elegidos[0]!; k++; }
    let acumulado = 0;
    for (const x of elegidos) {
      acumulado += x;
      salida.push(redondo(mas(a, por(menos(b, a), acumulado / suma))));
    }
  }
  return salida;
}

function armarBurbujas(p: RizoBurbujas): TuboDecoracion[] {
  const g = Math.max(0.5, p.grosorCm);
  const codigos = p.codigos.length ? p.codigos : ["005"];
  const largos = (p.largosCm.length ? p.largosCm : [g * 2]).map((x) => Math.max(g, limitar(x, g, 200)));
  let torceduras: Vec3[];
  if (p.recorrido === "recta") {
    const n = Math.round(limitar(p.cantidad, 1, 200));
    torceduras = [{ x: 0, y: 0, z: 0 }];
    let z = 0;
    for (let i = 0; i < n; i++) { z -= largos[i % largos.length]!; torceduras.push({ x: 0, y: 0, z: r2(z) }); }
  } else if (p.recorrido === "aro") {
    // Un polígono: cada burbuja es un lado recto. El radio sale de que las cuerdas midan lo que cada burbuja.
    const n = Math.round(limitar(p.cantidad, 3, 200));
    const lados = Array.from({ length: n }, (_, i) => largos[i % largos.length]!);
    const perimetro = lados.reduce((s, x) => s + x, 0);
    const medio = perimetro / n;
    const radio = medio / (2 * Math.sin(Math.PI / n));
    const giro = rad(p.giroGrados ?? 0);
    torceduras = [];
    let acumulado = 0;
    for (let i = 0; i < n; i++) {
      // La primera torcedura abajo del todo y las demás repartidas según el largo de cada burbuja.
      const a = -Math.PI / 2 + giro + (2 * Math.PI * acumulado) / perimetro;
      torceduras.push(redondo(P(radio * Math.cos(a), 0, radio * Math.sin(a))));
      acumulado += lados[i]!;
    }
    torceduras.push(torceduras[0]!);
  } else {
    const puntas = Math.round(limitar(p.puntas ?? 5, 3, 12));
    const radio = limitar(p.radioCm ?? 40, g * 3, 300);
    const interior = limitar(p.radioInteriorCm ?? radio * 0.4, g, radio * 0.95);
    const vertices = contornoEstrella(puntas, radio, interior, rad(p.giroGrados ?? 0));
    torceduras = torcedurasEnTramos(vertices, true, largos);
  }
  const tubos: TuboDecoracion[] = [];
  for (let i = 0; i + 1 < torceduras.length; i++) {
    tubos.push(burbuja(torceduras[i]!, torceduras[i + 1]!, g, p.formatoId, codigos[i % codigos.length]!));
  }
  return tubos;
}

/** Lo que se pierde de un tubito en la boquilla, el nudo y la cola, y lo que gastan las torceduras (como en `figuras.ts`). */
const DESPERDICIO_TUBITO_CM = 15;
const FACTOR_TORCEDURA = 1.1;

function largoTramo(t: TuboDecoracion): number {
  let total = t.grosorCm;
  for (let i = 1; i < t.puntos.length; i++) total += largo3(menos(t.puntos[i]!, t.puntos[i - 1]!));
  return total;
}

/**
 * Los tubitos de un rizo, por formato y color: un tubito por tramo (cada rizo, fleco o voluta es un T-260 entero
 * inflado en parte; si el tramo es más largo que lo útil de uno, los que hagan falta). Una cadena de burbujas es un solo
 * tubito retorcido: se suman sus burbujas por color y se cuenta por largo.
 */
export function materialesRizo(p: PropiedadesRizo, tubos: readonly TuboDecoracion[]): MaterialDecoracion[] {
  const cuenta = new Map<string, MaterialDecoracion>();
  const sumar = (formatoId: string, codigo: string, n: number) => {
    const k = `${formatoId}|${codigo}`;
    const m = cuenta.get(k) ?? { formatoId, codigo, cantidad: 0 };
    m.cantidad += n;
    cuenta.set(k, m);
  };
  const util = (formatoId: string) => (formatoPorId(formatoId)?.largoCm ?? 152) - DESPERDICIO_TUBITO_CM;
  if (p.forma === "burbujas") {
    const largos = new Map<string, { formatoId: string; codigo: string; largo: number }>();
    for (const t of tubos) {
      const k = `${t.formatoId}|${t.codigo}`;
      const x = largos.get(k) ?? { formatoId: t.formatoId, codigo: t.codigo, largo: 0 };
      x.largo += largoTramo(t);
      largos.set(k, x);
    }
    for (const x of largos.values()) sumar(x.formatoId, x.codigo, Math.max(1, Math.ceil((x.largo * FACTOR_TORCEDURA) / util(x.formatoId))));
  } else {
    // Sin torceduras: solo el largo inflado.
    for (const t of tubos) sumar(t.formatoId, t.codigo, Math.max(1, Math.ceil(largoTramo(t) / util(t.formatoId))));
  }
  return [...cuenta.values()];
}

/** Arma un rizo: sus tramos de tubito, su radio (para encuadrar y repartir), cuánto sobresale por detrás y sus medidas. */
export function armarRizo(p: PropiedadesRizo): RizoArmado {
  let tubos: TuboDecoracion[];
  switch (p.forma) {
    case "tirabuzon":
      tubos = [tirabuzon(p.tubito, p.vueltas, p.radioInicialCm, p.radioFinalCm, p.largoCm, EJE[p.eje ?? "abajo"], undefined, rad(p.giroGrados ?? 0))];
      break;
    case "resorte":
      tubos = [tirabuzon(p.tubito, p.vueltas, p.radioCm, p.radioCm, p.largoCm, EJE[p.eje ?? "abajo"], undefined, rad(p.giroGrados ?? 0))];
      break;
    case "penacho": tubos = armarPenacho(p); break;
    case "flecos": tubos = armarFlecos(p); break;
    case "voluta": tubos = armarVoluta(p); break;
    case "burbujas": tubos = armarBurbujas(p); break;
  }
  let minX = Infinity, maxX = -Infinity, minY = Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const t of tubos) for (const q of t.puntos) {
    const r = t.grosorCm / 2;
    minX = Math.min(minX, q.x - r); maxX = Math.max(maxX, q.x + r);
    minY = Math.min(minY, q.y - r);
    minZ = Math.min(minZ, q.z - r); maxZ = Math.max(maxZ, q.z + r);
  }
  const materiales = materialesRizo(p, tubos);
  if (!Number.isFinite(minX)) return { tubos, materiales, radioCm: 0, fondoCm: 0, altoCm: 0, anchoCm: 0 };
  const ancho = maxX - minX, alto = maxZ - minZ;
  return { tubos, materiales, radioCm: r2(Math.max(ancho, alto) / 2), fondoCm: r2(Math.max(0, -minY)), altoCm: r2(alto), anchoCm: r2(ancho) };
}

const NOMBRE_FORMA: Readonly<Record<FormaRizo, string>> = {
  tirabuzon: "a twisted-balloon corkscrew curl", resorte: "a twisted-balloon spring coil", penacho: "a plume of curly twisting balloons",
  flecos: "a fringe of wavy hanging twisting balloons", voluta: "a flat spiral of a twisting balloon", burbujas: "a chain of twisted balloon bubbles",
};

/** Qué es, en inglés y corto (para la foto con IA). */
export function rizoEnIngles(p: PropiedadesRizo): string {
  if (p.forma === "burbujas" && p.recorrido === "estrella") return "a star outlined with a chain of twisted balloon bubbles";
  if (p.forma === "burbujas" && p.recorrido === "aro") return "a ring of twisted balloon bubbles";
  return NOMBRE_FORMA[p.forma];
}

const T260 = (codigo: string, grosorCm = 3.5): TubitoRizo => ({ formatoId: "T-260", grosorCm, codigo });

/** Rizos de partida (todo se cambia por propiedades): uno de cada forma, en colores de las ideas de sempertex.com. */
export const RIZOS_PREDEFINIDOS: ReadonlyArray<{ id: string; nombre: string; descripcion: string; decoracion: DecoracionRizo }> = [
  {
    id: "rizo_tirabuzon", nombre: "Tirabuzón de T-260", descripcion: "Un T-260 Fashion Fucsia enrollado en espiral cónica: 4 vueltas, de 2,5 a 5 cm de radio, 34 cm colgando.",
    decoracion: { tipo: "rizo", propiedades: { forma: "tirabuzon", tubito: T260("012"), vueltas: 4, radioInicialCm: 2.5, radioFinalCm: 5, largoCm: 34 } },
  },
  {
    id: "rizo_resorte", nombre: "Resorte de T-160", descripcion: "Un T-160 Reflex Dorado en resorte apretado: 6 vueltas de 2 cm de radio, 18 cm.",
    decoracion: { tipo: "rizo", propiedades: { forma: "resorte", tubito: { formatoId: "T-160", grosorCm: 2, codigo: "970" }, vueltas: 6, radioCm: 2, largoCm: 18 } },
  },
  {
    id: "rizo_resorte_frente", nombre: "Rizo de frente (neón)", descripcion: "Un T-260 Neón Fucsia en resorte corto que sale de frente: de lejos se ve como un caracol, como los rizos pegados a una columna.",
    decoracion: { tipo: "rizo", propiedades: { forma: "resorte", tubito: T260("212", 3), vueltas: 2.5, radioCm: 5, largoCm: 10, eje: "frente" } },
  },
  {
    id: "rizo_penacho", nombre: "Penacho de rizos", descripcion: "Siete tirabuzones de T-260 que salen de un punto hacia arriba, abiertos 40°: el remate de una columna.",
    decoracion: { tipo: "rizo", propiedades: { forma: "penacho", formatoId: "T-260", grosorCm: 3, codigos: ["212", "220", "230", "240", "261"], rizos: 7, vueltas: 3, radioInicialCm: 2, radioFinalCm: 4, largoCm: 30, inclinacionGrados: 0, aperturaGrados: 40 } },
  },
  {
    id: "rizo_flecos", nombre: "Flecos de tubito", descripcion: "Doce T-260 azules y plateados colgando ondulados de una barra de 60 cm (el colgante tipo medusa).",
    decoracion: { tipo: "rizo", propiedades: { forma: "flecos", formatoId: "T-260", grosorCm: 3, codigos: ["040", "981", "041"], tiras: 12, anchoCm: 60, largoCm: 60, ondas: 1.5, amplitudCm: 3, disparejo: 0.2 } },
  },
  {
    id: "rizo_voluta", nombre: "Voluta (espiral plana)", descripcion: "Un T-260 Reflex Dorado enrollado plano en 2,5 vueltas: para flores, marcos y adornos de pared.",
    decoracion: { tipo: "rizo", propiedades: { forma: "voluta", tubito: T260("970", 3), vueltas: 2.5, radioInicialCm: 2, radioFinalCm: 14 } },
  },
  {
    id: "rizo_cadena_burbujas", nombre: "Cadena de burbujas", descripcion: "Un T-260 Fashion Rosado retorcido en 10 burbujas iguales de 7 cm que cuelgan en hilera.",
    decoracion: { tipo: "rizo", propiedades: { forma: "burbujas", formatoId: "T-260", grosorCm: 4, codigos: ["009"], largosCm: [7], recorrido: "recta", cantidad: 10 } },
  },
  {
    id: "rizo_aro_burbujas", nombre: "Aro de 5 burbujas", descripcion: "Cinco burbujas de T-260 Verde Selva que cierran un pentágono (el aro del centro de una estrella).",
    decoracion: { tipo: "rizo", propiedades: { forma: "burbujas", formatoId: "T-260", grosorCm: 3.5, codigos: ["032"], largosCm: [11], recorrido: "aro", cantidad: 5 } },
  },
  {
    id: "rizo_estrella_burbujas", nombre: "Estrella de burbujas", descripcion: "El contorno de una estrella de 5 puntas en burbujas de T-260 Metal Dorado: una grande y dos chiquitas, en ciclo.",
    decoracion: { tipo: "rizo", propiedades: { forma: "burbujas", formatoId: "T-260", grosorCm: 3.5, codigos: ["570"], largosCm: [9, 3.6, 3.6], recorrido: "estrella", cantidad: 0, puntas: 5, radioCm: 42, radioInteriorCm: 16 } },
  },
];
