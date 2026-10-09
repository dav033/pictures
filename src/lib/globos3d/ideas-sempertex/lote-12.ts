import { ideaPerezosa, perezoso, type IdeaDigitalizada, type ProductoDeIdea } from "./tipos";
import { fuenteIdea, type FuenteIdea } from "./fuentes";
import { ocasionesDeEtiquetas } from "./index";
import { armarEscena, HUNDIMIENTO_SOBRE_CM, SALA_INICIAL, type Colocacion, type Escena, type NodoEscena, type Sala } from "../escena";
import { armarPieza, type Pieza } from "../piezas";
import { formatoPorId } from "../formatos";
import { sumarMateriales } from "../mezcla";
import { GLOBOS_TIENDA, productoDeGlobo } from "../productos-tienda";
import { mesaConMantel, paredLentejuelas, tapete, type ElementoEscenografia } from "../escenografia";
import { banderin, productoDe } from "../utileria";
import { opcionesRacimosLibres, type RacimoLibre } from "../estructuras-organicas";
import type { ColorOrganico, OpcionesOrganico, PuntoMezcla, RellenoOrganico, TramoOrganico } from "../organico";
import type { OpcionesMural } from "../murales";
import { metalizadoDeTienda } from "../metalizados";
import type { ParteGlobo, PropiedadesFlor } from "../decoraciones";
import type { AnilloTubito, Decoracion, PropiedadesMono } from "../figuras";
import type { Vec3 } from "../modulos";

/**
 * Ideas de fiesta de sempertex.com digitalizadas: **lote 12** (los números de `clasif/lote-12.json`): 7 escenas
 * (#640 Graduación, #654 Halloween fantasmal, #705 Love, #795 Tonos neutros, #847 Pinturas, #862 Primera comunión
 * niño, #896 Rosita Fresita), un ramo de flores de tubito (#876), un topiario de San Valentín (#899) y la pared de
 * Frankenstein (#929).
 *
 * Cómo se hizo (2026-10-08), idea por idea, con su foto (`fotos/<slug>--0.*`) recortada, ampliada y con rejilla:
 * - **Medidas**: la escala sale de algo de tamaño conocido en la misma foto (R-5 ≈ 12 cm, R-12 ≈ 25–28 cm, R-24 ≈ 55
 *   cm, T-260 ≈ 5 cm de grueso, una mesa de 75 cm, una mesa de coctel de 105 cm) y con ella alturas, anchos y tamaños;
 *   lo que está más cerca de la cámara (mesas, pedestales) lleva su propia escala.
 * - **Conteo**: las paredes de globos celda a celda (columnas y filas de la foto); flores, ramas, hojas y globos
 *   grandes uno a uno. En lo orgánico el motor da los globos para el grosor y el largo medidos (no se cuentan uno a
 *   uno: la nota lo dice). Ninguna idea del lote publica «Materiales» con cantidades: lo contado va con `contada: true`.
 * - **Colores**: si la idea publica productos, se usan ESOS códigos (aunque la foto mida otra cosa: la nota lo dice);
 *   si no, se midió en la foto (Python/PIL: mediana de un parche sin brillos, ΔE76 en Lab contra `hexGlobo` de la
 *   tabla oficial) y se tomó el más cercano que se fabrica en ese formato (Fashion si queda a ≤ 6 ΔE del mejor).
 * - **Impresos y metalizados**: el corazón rojo de Rosita Fresita es el metalizado de la tienda. Los «Feliz Grado» de
 *   #640 van en Reflex Dorado y la tienda solo los vende en Reflex Plata, y los lunares de #896 van sobre frambuesa (la
 *   tienda los tiene sobre rojo y verde lima): van lisos y la nota lo dice.
 * - **Jerarquía**: cada estructura de globos es un nodo raíz y lo suyo cuelga de ella (`sobre`) o va pegado a sus
 *   globos (los ramos de helio), para que la biblioteca saque «esta estructura con sus decoraciones» y «esta
 *   decoración sola». Las guirnaldas de #705 son racimos de un color uno junto a otro (así las arma la foto): cada
 *   racimo es su estructura. Mesas, pedestales, figuras de cartón y foami son escenografía suelta.
 * Unidades: cm. Espacio de cada escena: y arriba, +z hacia quien mira; los puntos `sobre` van en el espacio local del
 * padre (el de una pieza suelta, girada 0°, es el del mundo corrido a su origen).
 */

// ----------------------------------------------------------------------------------------------------------
// Ayudas de geometría
// ----------------------------------------------------------------------------------------------------------

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const mas = (a: Vec3, b: Vec3): Vec3 => v(a.x + b.x, a.y + b.y, a.z + b.z);
const menos = (a: Vec3, b: Vec3): Vec3 => v(a.x - b.x, a.y - b.y, a.z - b.z);
const por = (a: Vec3, k: number): Vec3 => v(a.x * k, a.y * k, a.z * k);
const largo = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
const unitario = (a: Vec3): Vec3 => { const n = largo(a) || 1; return por(a, 1 / n); };
const cruz = (a: Vec3, b: Vec3): Vec3 => v(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const pto = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const r2 = (x: number) => Math.round(x * 100) / 100 + 0;
const redondo = (p: Vec3): Vec3 => v(r2(p.x), r2(p.y), r2(p.z));
const rad = (g: number) => (g * Math.PI) / 180;
const ARRIBA = v(0, 1, 0);
const AL_FRENTE = v(0, 0, 1);

const R = (formatoId: string, infladoCm: number, codigo: string): ParteGlobo => ({ formatoId, infladoCm, codigo });
const libre = (xCm: number, yCm: number, zCm: number, giroGrados = 0): Colocacion => ({ en: "libre", xCm: r2(xCm), yCm: r2(yCm), zCm: r2(zCm), giroGrados });
const EN_LA_PARED: Colocacion = { en: "pared", pared: "fondo", aLoLargoCm: 0, alturaCm: 0 };
const sala = (anchoCm: number, fondoCm: number, altoCm: number, tonos?: Partial<Sala["tonos"]>): Sala =>
  ({ ...structuredClone(SALA_INICIAL), anchoCm, fondoCm, altoCm, tonos: { ...SALA_INICIAL.tonos, ...tonos } });

/** Un globo suelto (el centro de su cuerpo en el origen, el cuerpo hacia +y). */
const globo = (g: ParteGlobo): Pieza => ({ tipo: "globo", formatoId: g.formatoId, infladoCm: g.infladoCm, codigo: g.codigo });
const deco = (decoracion: Decoracion): Pieza => ({ tipo: "decoracion", decoracion });
const flor = (p: PropiedadesFlor): Decoracion => ({ tipo: "flor", propiedades: p });
const lazos = (formatoId: string, grosorCm: number, codigos: string[], cantidad: number, largoCm: number, anchoCm: number, aperturaGrados: number, giroGrados: number): AnilloTubito =>
  ({ formatoId, grosorCm, codigos, cantidad, estilo: "lazo", largoCm, anchoCm, aperturaGrados, giroGrados });
const burbujas = (formatoId: string, grosorCm: number, codigos: string[], cantidad: number, largoCm: number, aperturaGrados: number, giroGrados: number): AnilloTubito =>
  ({ formatoId, grosorCm, codigos, cantidad, estilo: "burbuja", largoCm, anchoCm: grosorCm, aperturaGrados, giroGrados });
const florTubito = (petalos: AnilloTubito, centro: ParteGlobo | null = null, interior: AnilloTubito | null = null, corona: (ParteGlobo & { cantidad: number }) | null = null): Decoracion =>
  ({ tipo: "flor_tubito", propiedades: { petalos, interior, corona, centro } });
const mono = (p: PropiedadesMono): Decoracion => ({ tipo: "mono", propiedades: p });

/**
 * El giro de una pieza puesta `sobre` con la normal `n` (el marco de `escena.ts`: su +y local mira hacia la normal y su
 * x local queda horizontal), girada `giroGrados` sobre la normal.
 */
function marcoNormal(n0: Vec3, giroGrados = 0): (p: Vec3) => Vec3 {
  const n = unitario(n0);
  const aux = Math.abs(n.y) < 0.9 ? v(0, 1, 0) : v(1, 0, 0);
  const xL = unitario(cruz(aux, n));
  const zL = cruz(n, xL);
  const c = Math.cos(rad(giroGrados)), s = Math.sin(rad(giroGrados));
  return (p: Vec3) => {
    const x = p.x * c - p.z * s, z = p.x * s + p.z * c;
    return mas(mas(por(xL, x), por(n, p.y)), por(zL, z));
  };
}

/** Una pieza `sobre` la superficie de globos de su padre: `sobre` la corre a lo largo de la normal hasta apoyarla. */
const sobre = (id: string, nombre: string, padreId: string, pieza: Pieza, punto: Vec3, normal: Vec3 = ARRIBA, giroGrados = 0): NodoEscena =>
  ({ id, nombre, pieza, colocacion: { en: "sobre", padreId, puntoCm: redondo(punto), normal: redondo(unitario(normal)), giroGrados } });

/**
 * Una pieza `sobre` un padre SIN globos (un tallo de tubitos, un moño): `sobre` no encuentra cuerpos y deja su espalda a
 * `HUNDIMIENTO_SOBRE_CM` antes del punto, así que el origen de la pieza queda exactamente en `origen` (espacio local del
 * padre), con su +y hacia `normal`.
 */
function sobreEn(id: string, nombre: string, padreId: string, pieza: Pieza, origen: Vec3, normal: Vec3 = ARRIBA, giroGrados = 0): NodoEscena {
  const n = unitario(normal);
  const punto = mas(origen, por(n, armarPieza(pieza).caja.min.y + HUNDIMIENTO_SOBRE_CM));
  return { id, nombre, pieza, colocacion: { en: "sobre", padreId, puntoCm: redondo(punto), normal: redondo(n), giroGrados } };
}

/** Como `sobreEn`, con el centro de la caja de la pieza en `centro` (padre suelto y sin girar: su espacio es el del mundo). */
function sobreCentrada(id: string, nombre: string, padreId: string, pieza: Pieza, centro: Vec3, normal: Vec3 = ARRIBA, giroGrados = 0): NodoEscena {
  const c = armarPieza(pieza).caja;
  const medio = por(mas(c.min, c.max), 0.5);
  return sobreEn(id, nombre, padreId, pieza, menos(centro, marcoNormal(normal, giroGrados)(medio)), normal, giroGrados);
}

/**
 * Un tubito recto de `desde` a `hasta` (espacio del padre sin globos): una burbuja de tubito con apertura −90° (hacia −y
 * de su espacio), puesta con la normal de `hasta` a `desde`, así su punta queda en `desde` y su arranque en `hasta`.
 */
function varita(id: string, nombre: string, padreId: string, t: { formatoId: string; grosorCm: number; codigo: string }, desde: Vec3, hasta: Vec3): NodoEscena {
  const d = menos(hasta, desde);
  const n = unitario(d);
  return { id, nombre, pieza: deco(florTubito(burbujas(t.formatoId, t.grosorCm, [t.codigo], 1, r2(largo(d)), -90, 0))), colocacion: { en: "sobre", padreId, puntoCm: redondo(mas(desde, por(n, HUNDIMIENTO_SOBRE_CM))), normal: redondo(n), giroGrados: 0 } };
}

/**
 * Un tallo de tubito que cruza un amarre: dos burbujas opuestas de `largoCm` cada una a lo largo de `direccion`, con el
 * centro en `centro` (espacio de un padre sin globos y sin girar). El nudo del medio queda escondido en el amarre.
 */
function tallo(id: string, nombre: string, padreId: string, t: { formatoId: string; grosorCm: number; codigo: string }, centro: Vec3, direccion: Vec3, largoCm: number): NodoEscena {
  const d = unitario(direccion);
  const n = unitario(Math.abs(d.z) < 0.9 ? menos(AL_FRENTE, por(d, d.z)) : menos(ARRIBA, por(d, d.y)));
  const m0 = marcoNormal(n, 0);
  const xL = m0(v(1, 0, 0)), zL = m0(v(0, 0, 1));
  const giro = (Math.atan2(pto(d, zL), pto(d, xL)) * 180) / Math.PI;
  return sobreEn(id, nombre, padreId, deco(florTubito(burbujas(t.formatoId, t.grosorCm, [t.codigo], 2, r2(largoCm), 0, 0))), centro, n, r2(giro));
}

// ----------------------------------------------------------------------------------------------------------
// Escenografía
// ----------------------------------------------------------------------------------------------------------

const caja = (centro: Vec3, tamano: Vec3, hex: string, acabado: ElementoEscenografia["acabado"] = "mate", giroGrados = 0): ElementoEscenografia =>
  ({ forma: "caja", centro: redondo(centro), tamano: redondo(tamano), hex, acabado, ...(giroGrados ? { giroGrados } : {}) });
const cilindro = (base: Vec3, radioCm: number, altoCm: number, hex: string, acabado: ElementoEscenografia["acabado"] = "mate", radioArribaCm?: number): ElementoEscenografia =>
  ({ forma: "cilindro", base: redondo(base), radioCm: r2(radioCm), altoCm: r2(altoCm), hex, acabado, ...(radioArribaCm !== undefined ? { radioArribaCm: r2(radioArribaCm) } : {}) });
/** Una bola (pompón, flor, fruta) hecha de cilindros apilados; `achatado` < 1 la aplasta. */
function bola(centro: Vec3, radioCm: number, hex: string, acabado: ElementoEscenografia["acabado"] = "papel", tramos = 6, achatado = 1): ElementoEscenografia[] {
  const salida: ElementoEscenografia[] = [];
  for (let i = 0; i < tramos; i++) {
    const a0 = -Math.PI / 2 + (Math.PI * i) / tramos, a1 = -Math.PI / 2 + (Math.PI * (i + 1)) / tramos;
    salida.push(cilindro(v(centro.x, centro.y + radioCm * achatado * Math.sin(a0), centro.z), Math.max(0.3, radioCm * Math.cos(a0)), radioCm * achatado * (Math.sin(a1) - Math.sin(a0)), hex, acabado, Math.max(0.3, radioCm * Math.cos(a1))));
  }
  return salida;
}
/** Un tablón (tira, pluma, trazo de una letra de foami) de `desde` a `hasta`, de canto hacia quien mira. */
function tablon(desde: Vec3, hasta: Vec3, anchoCm: number, gruesoCm: number, hex: string, acabado: ElementoEscenografia["acabado"] = "mate"): ElementoEscenografia {
  const d = menos(hasta, desde);
  const x = unitario(d);
  const y = unitario(Math.abs(x.y) < 0.95 ? cruz(AL_FRENTE, x) : cruz(x, v(1, 0, 0)));
  return { forma: "caja", centro: v(r2(largo(d) / 2), 0, 0), tamano: v(r2(largo(d)), r2(anchoCm), r2(gruesoCm)), hex, acabado, en: { origen: redondo(desde), ejeX: redondo(x), ejeY: redondo(y) } };
}
/** Un tubo (aro de metal, cinta) de `desde` a `hasta`. */
function tubo(desde: Vec3, hasta: Vec3, radioCm: number, hex: string, acabado: ElementoEscenografia["acabado"] = "metal"): ElementoEscenografia {
  const d = menos(hasta, desde);
  const y = unitario(d);
  const x = unitario(Math.abs(y.y) < 0.95 ? cruz(y, ARRIBA) : cruz(y, AL_FRENTE));
  return { forma: "cilindro", base: v(0, 0, 0), radioCm, altoCm: r2(largo(d)), hex, acabado, en: { origen: redondo(desde), ejeX: redondo(x), ejeY: redondo(y) } };
}
/** Un panel plano (de frente, en z) con un contorno de puntos (cm) y huecos. */
const panel = (contorno: Array<[number, number]>, zCm: number, grosorCm: number, hex: string, acabado: ElementoEscenografia["acabado"] = "papel", huecos: Array<Array<[number, number]>> = []): ElementoEscenografia =>
  ({ forma: "panel", contorno: contorno.map(([x, y]) => ({ x: r2(x), y: r2(y) })), huecos: huecos.map((h) => h.map(([x, y]) => ({ x: r2(x), y: r2(y) }))), zCm: r2(zCm), grosorCm, hex, acabado });
/** Un óvalo (cara de fantasma, cabeza de una figura de cartón) de centro (x, y). */
const ovalo = (x: number, y: number, rx: number, ry: number, puntos = 20): Array<[number, number]> =>
  Array.from({ length: puntos }, (_, i) => [x + rx * Math.cos((2 * Math.PI * i) / puntos), y + ry * Math.sin((2 * Math.PI * i) / puntos)] as [number, number]);
const escenografia = (elementos: ElementoEscenografia[]): Pieza => ({ tipo: "escenografia", elementos });

// ----------------------------------------------------------------------------------------------------------
// Orgánico
// ----------------------------------------------------------------------------------------------------------

const colorOrg = (codigo: string, peso: number, formatos?: string[]): ColorOrganico => ({ codigo, peso, ...(formatos ? { formatos } : {}) });
const constante = (pesos: Readonly<Record<string, number>>): PuntoMezcla[] => [{ t: 0, pesos }, { t: 1, pesos }];
const organico = (opciones: OpcionesOrganico): Pieza => ({ tipo: "organico", opciones, flores: null });

type Racimo = { puntos: Vec3[]; radio: number; radioFin?: number };

/**
 * Racimos orgánicos (cada uno, un tramo de guirnalda con remate en las dos puntas) con sus inflados y su relleno. Con
 * un color que no se fabrica en R-9 (el Coral Tropical), el relleno va solo con tríos de R-5.
 */
function racimos(o: { racimos: Racimo[]; mezcla: Readonly<Record<string, number>>; colores: ColorOrganico[]; semilla: number; inflados: Readonly<Record<string, number>>; relleno: RellenoOrganico[]; densidad?: number }): Pieza {
  const libres: RacimoLibre[] = o.racimos.map((r, k) => ({
    id: `racimo_${k + 1}`, nombre: `Racimo ${k + 1}`, puntos: r.puntos.map(redondo), radioInicioCm: r.radio, radioFinCm: r.radioFin ?? r.radio,
    mezcla: constante(o.mezcla), tapas: { inicio: true, fin: true },
  }));
  const opciones = opcionesRacimosLibres({ racimos: libres, colores: o.colores, semilla: o.semilla, suelo: true, relleno: o.relleno });
  return organico({ ...opciones, inflados: { ...o.inflados }, ...(o.densidad ? { densidad: o.densidad } : {}) });
}

// ----------------------------------------------------------------------------------------------------------
// Productos
// ----------------------------------------------------------------------------------------------------------

const quitarOrigen = (url: string) => url.replace(/^https:\/\/sempertex\.com/, "");

/** Un producto que la idea publica (nombre, url y código tal cual; el formato, el del mapeo). */
type Publicado = { nombre: string; url: string; formato: string | null; codigo: string | null };
const P = (nombre: string, url: string, formato: string | null, codigo: string | null): Publicado => ({ nombre, url, formato, codigo });

/** El liso de la tienda para un formato y un código (nombre y url relativa exactos), con la cantidad contada. */
function liso(formatoId: string, codigo: string, cantidad: number): ProductoDeIdea {
  const tipo = formatoPorId(formatoId)?.tipo ?? "redondo";
  const fila = GLOBOS_TIENDA.find((p) => p.tipo === tipo && p.codigo === codigo);
  const p = fila ? { nombre: fila.nombre, url: fila.url } : (() => { const x = productoDeGlobo(formatoId, codigo); return { nombre: x.nombre, url: quitarOrigen(x.url) }; })();
  return { nombre: p.nombre, url: p.url, formato: formatoId, codigo, cantidad, contada: true };
}

/**
 * Los productos de la idea a partir de lo armado (que es lo contado en la foto): los metalizados de la tienda y la
 * utilería que la idea publica (el mural de cuadros) por las veces que quedaron puestos, y los globos lisos por formato y
 * código (el producto de la tienda es uno por color para todas sus tallas: se reconoce por el tipo de globo y el
 * código). Lo que la idea publica sale con su nombre y url tal cual; si la foto no lo tiene, sin cantidad.
 */
function productosDe(escena: Escena, publicados: readonly Publicado[]): ProductoDeIdea[] {
  const armada = armarEscena(escena);
  const salida: ProductoDeIdea[] = [];
  const usados = new Set<Publicado>();
  const otros = new Map<string, { nombre: string; url: string; cantidad: number }>();
  const sumar = (nombre: string, url: string, cantidad: number) => {
    const previo = otros.get(url) ?? { nombre, url, cantidad: 0 };
    previo.cantidad += cantidad;
    otros.set(url, previo);
  };
  for (const nodo of escena.nodos) {
    const copias = armada.porNodo.find((n) => n.id === nodo.id)?.copias ?? 0;
    if (copias === 0) continue;
    if (nodo.pieza.tipo === "metalizado" && nodo.pieza.metalizado.producto) sumar(nodo.pieza.metalizado.producto.nombre, nodo.pieza.metalizado.producto.url, copias);
    if (nodo.pieza.tipo === "escenografia") for (const p of nodo.pieza.productos ?? []) if (!p.generico && publicados.some((x) => x.url === p.url)) sumar(p.nombre, p.url, p.cantidad * copias);
  }
  for (const o of otros.values()) {
    const publicado = publicados.find((p) => p.url === o.url);
    if (publicado) usados.add(publicado);
    salida.push({ nombre: publicado?.nombre ?? o.nombre, url: o.url, formato: null, codigo: null, cantidad: o.cantidad, contada: true });
  }
  for (const m of sumarMateriales(armada.materiales)) {
    const cantidad = Math.ceil(m.cantidad - 1e-9);
    if (cantidad <= 0) continue;
    const tipo = formatoPorId(m.formatoId)?.tipo;
    const publicado = publicados.find((p) => p.formato !== null && formatoPorId(p.formato)?.tipo === tipo && p.codigo === m.codigo);
    if (publicado) { usados.add(publicado); salida.push({ nombre: publicado.nombre, url: publicado.url, formato: m.formatoId, codigo: m.codigo, cantidad, contada: true }); }
    else salida.push(liso(m.formatoId, m.codigo, cantidad));
  }
  for (const p of publicados) if (!usados.has(p)) salida.push({ ...p, cantidad: null });
  return salida;
}

function fuente(slug: string): FuenteIdea {
  const f = fuenteIdea(slug);
  if (!f) throw new Error(`La idea «${slug}» no está en las fuentes.`);
  return f;
}

/**
 * La idea con su número, ocasiones y foto de su fuente; perezosa (ver `tipos.ts`): la escena se arma y sus productos se
 * calculan la primera vez que se piden (salen de armar la escena: los orgánicos tardan unas décimas). Las ocasiones
 * salen de las etiquetas con `ocasionesDeEtiquetas`, que vive en `index.ts` (que importa este lote): se calculan al
 * leerlas, como en los lotes 06 y 09.
 */
function idea(slug: string, nombre: string, escena: () => Escena, nota: string, publicados: readonly Publicado[] = []): IdeaDigitalizada {
  const f = fuente(slug);
  const hecha = perezoso(escena);
  return ideaPerezosa({
    id: `idea:${slug}`, numero: f.numero, slug, nombre, fotoUrl: f.fotoUrl, clase: "escena", nota,
    get ocasiones() { return ocasionesDeEtiquetas(f.etiquetas); },
  }, () => ({ tipo: "escena", escena: hecha() }), () => productosDe(hecha(), publicados));
}

// Productos que publican varias ideas (nombre y url tal cual de la tienda).
const P_DORADO = P("GLOBO LATEX REDONDO REFLEX DORADO", "/products/globo-para-fiesta-latex-redondo-reflex-dorado", "R-12", "970");
const P_VIOLETA = P("GLOBO REDONDO REFLEX VIOLETA", "/products/globo-para-fiesta-latex-redondo-reflex-violeta", "R-12", "951");
const P_ARENA = P("GLOBO REDONDO FASHION ARENA", "/products/globo-para-fiesta-latex-redondo-fashion-arena", "R-12", "071");
const P_NEGRO = P("GLOBO REDONDO FASHION NEGRO", "/products/globo-para-fiesta-latex-redondo-fashion-negro", "R-12", "080");
const P_BLANCO = P("GLOBO REDONDO FASHION BLANCO", "/products/globo-para-fiesta-latex-redondo-fashion-blanco", "R-12", "005");

// ----------------------------------------------------------------------------------------------------------
// 640 · Graduación (escena)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 1080 × 1080: los R-5 dorados de la torre miden ~37 px (≈ 12 cm) y los «Feliz Grado» ~86 px (R-12 a 28 cm):
 * 3,1 px/cm en la pared; lo de delante (ramo, racimo, pedestal) ~3,5 px/cm. La torre orgánica, pegada a la pared,
 * mide 837 px (≈ 2,65 m) y se escalona: 1,8 m de ancho abajo, 1,35 m a media altura y 0,9 m arriba (el perfil de
 * ancho por filas de píxeles). Colores medidos: el rojo vino, Fashion Merlot (ΔE 8); el ciruela cromado mide Reflex
 * Fucsia (ΔE 8) pero la idea publica Reflex Violeta; el dorado y el arena, los publicados. A la izquierda un ramo de 5
 * R-12 de helio amarrado a un racimo en el piso; a la derecha un pedestal de cartón kraft (60 × 90 cm) con una
 * guirnalda baja en media luna a su pie y un R-12 dorado «Feliz Grado».
 */
const escena640 = (): Escena => {
  const S = sala(520, 420, 300, { piso: "#a07a3a", paredes: "#ebeae6", techo: "#f6f5f2" });
  const Z_TORRE = -S.fondoCm / 2 + 32;
  // Filas de la torre: altura del eje, borde izquierdo y derecho de la silueta (medidos en la foto) y radio.
  const FILAS: ReadonlyArray<readonly [number, number, number, number]> = [
    [22, -90, 89, 23], [54, -90, 89, 23], [86, -78, 89, 23], [118, -69, 88, 23],
    [150, -52, 84, 22], [182, -48, 80, 22], [214, -39, 52, 21], [244, -20, 44, 19],
  ];
  const torre = racimos({
    racimos: FILAS.map(([y, a, b, radio]) => ({ puntos: [v(a + radio, y, 0), v((a + b) / 2, y, 0), v(b - radio, y, 0)], radio })),
    mezcla: { "R-18": 0.18, "R-12": 0.7, "R-9": 0.12 },
    colores: [colorOrg("970", 3.3), colorOrg("018", 3), colorOrg("951", 2.4, ["R-5", "R-12"]), colorOrg("071", 1.3)],
    semilla: 640, inflados: { "R-18": 36, "R-12": 26, "R-9": 18, "R-5": 11 },
    relleno: [{ formatoId: "R-9", infladoCm: 17, trios: false }, { formatoId: "R-5", infladoCm: 11, trios: false }],
  });
  const grado = globo(R("R-12", 28, "970"));
  const RACIMO = v(-172, 0, -55);
  const racimo = racimos({
    racimos: [{ puntos: [v(-7, 24, 0), v(7, 27, 0)], radio: 27 }],
    mezcla: { "R-12": 0.55, "R-9": 0.15, "R-5": 0.3 },
    colores: [colorOrg("018", 3), colorOrg("951", 2, ["R-5", "R-12"]), colorOrg("970", 2), colorOrg("071", 0.6)],
    semilla: 6401, inflados: { "R-12": 21, "R-9": 16, "R-5": 10 },
    relleno: [{ formatoId: "R-5", infladoCm: 10, trios: true }],
  });
  const ramo: Pieza = deco({ tipo: "ramo_helio", propiedades: { globos: [R("R-12", 28, "970"), R("R-12", 28, "970"), R("R-12", 28, "951"), R("R-12", 28, "071"), R("R-12", 28, "018")], alturaCm: 135, cinta: { hex: "#3a3434" }, peso: { hex: "#c9a24a" } } });
  const PEDESTAL = v(128, 0, -75);
  // Media luna al pie del pedestal: por delante, de su izquierda a su derecha (ángulos del frente, +z = 90°).
  const mediaLuna = [195, 160, 125, 90, 55, 20, -15].map((a) => v(r2(46 * Math.cos(rad(a))), 12, r2(46 * Math.sin(rad(a)))));
  const guirnalda = racimos({
    racimos: [{ puntos: mediaLuna, radio: 14 }],
    mezcla: { "R-12": 0.15, "R-9": 0.45, "R-5": 0.4 },
    colores: [colorOrg("071", 2), colorOrg("951", 1.5, ["R-5", "R-12"]), colorOrg("970", 1.2)],
    semilla: 6402, inflados: { "R-12": 20, "R-9": 15, "R-5": 11 },
    relleno: [{ formatoId: "R-5", infladoCm: 11, trios: true }],
  });
  const KRAFT = "#d2a467", ORO = "#d9b24c";
  const pedestal: ElementoEscenografia[] = [
    cilindro(v(0, 0, 0), 30, 90, KRAFT, "papel"),
    // Plato dorado grande de pie, plato chico dorado, dos vasos negros con dorado y el empaque de pasabocas.
    { forma: "cilindro", base: v(0, 0, 0), radioCm: 15, altoCm: 0.8, hex: ORO, acabado: "metal", en: { origen: v(-5, 106, -14), ejeX: v(1, 0, 0), ejeY: v(0, 0.26, 0.97) } },
    { forma: "cilindro", base: v(0, 0, 0), radioCm: 8.5, altoCm: 0.8, hex: "#e8c45a", acabado: "metal", en: { origen: v(15, 99, 4), ejeX: v(1, 0, 0), ejeY: v(0, 0.3, 0.95) } },
    cilindro(v(-15, 90, 8), 3.2, 9, "#1f1f1f", "papel", 3.8), cilindro(v(-6, 90, 12), 3.2, 9, "#1f1f1f", "papel", 3.8),
    caja(v(4, 92, 10), v(10, 4, 8), "#efe7d4", "papel"),
  ];
  return {
    sala: S,
    nodos: [
      { id: "torre", nombre: "Torre orgánica escalonada merlot, violeta, dorado y arena", pieza: torre, colocacion: libre(0, 0, Z_TORRE) },
      sobre("grado-izquierda", "R-12 Reflex Dorado (Feliz Grado en la foto, izquierda)", "torre", grado, v(-62, 119, 12), v(-0.75, 0, 0.66)),
      sobre("grado-derecha-arriba", "R-12 Reflex Dorado (Feliz Grado en la foto, derecha arriba)", "torre", grado, v(62, 181, 12), v(0.6, 0.1, 0.8)),
      sobre("grado-derecha-abajo", "R-12 Reflex Dorado (Feliz Grado en la foto, derecha abajo)", "torre", grado, v(70, 66, 14), v(0.7, 0, 0.7)),
      { id: "racimo-ramo", nombre: "Racimo del ramo (merlot, violeta, dorado y arena)", pieza: racimo, colocacion: libre(RACIMO.x, 0, RACIMO.z) },
      // El ramo de helio, amarrado arriba del racimo (su peso queda metido entre sus globos).
      { id: "ramo", nombre: "Ramo de 5 R-12 de helio", pieza: ramo, colocacion: libre(RACIMO.x, 52, RACIMO.z) },
      { id: "guirnalda-pedestal", nombre: "Guirnalda en media luna al pie del pedestal", pieza: guirnalda, colocacion: libre(PEDESTAL.x, 0, PEDESTAL.z) },
      sobre("grado-pedestal", "R-12 Reflex Dorado grande (Feliz Grado en la foto, junto al pedestal)", "guirnalda-pedestal", globo(R("R-12", 30, "970")), v(50, 22, -6), v(0.55, 0.8, 0.2)),
      { id: "pedestal", nombre: "Pedestal de cartón kraft con platos y vasos dorados", pieza: escenografia(pedestal), colocacion: libre(PEDESTAL.x, 0, PEDESTAL.z) },
    ],
  };
};
const idea640 = idea("graduacion", "Graduación: torre orgánica merlot y dorado con ramo de helio", escena640,
  "Igual: la torre orgánica escalonada contra la pared, ~2,6 m de alto y 1,8 m de ancho abajo que se angosta a 0,9 m arriba (8 filas medidas por el perfil de la foto), de R-18, R-12, R-9 y R-5 en Merlot, Reflex Violeta, Reflex Dorado y Arena, con sus 3 R-12 dorados de «Feliz Grado» en los mismos sitios; el ramo de 5 R-12 de helio (dorado, dorado, violeta, arena y merlot) amarrado a un racimo en el piso a la izquierda; el pedestal de cartón kraft de 60 × 90 cm con platos y vasos dorados y negros, la guirnalda baja en media luna a su pie con el R-12 dorado grande, y el piso de tela dorada. Distinto: los «Feliz Grado» van lisos (la tienda solo vende ese impreso en Reflex Plata y en la foto son dorados); el ciruela cromado de la foto mide Reflex Fucsia (ΔE 8) y va el Reflex Violeta que publica la idea; en la foto los colores van por grupos (los racimitos de R-5 dorados, el arena) y el motor los reparte; los globos de lo orgánico los da el motor para el grosor y el largo medidos (la torre lleva muchos R-5 de relleno); el Merlot no está publicado (va con el liso de la tienda).", [P_DORADO, P_VIOLETA, P_ARENA]);

// ----------------------------------------------------------------------------------------------------------
// 654 · Halloween fantasmal (escena)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 1080 × 1080 sobre fondo negro: los R-12 del arco miden ~70 px (≈ 24 cm): 2,9 px/cm; las mesas de coctel de
 * delante, ~3,4 px/cm (≈ 1,1 m de alto). Arco orgánico en «A» de 1075 × 830 px (≈ 3,7 m de pie a pie y 2,85 m de
 * alto): un montículo grande al pie izquierdo, la pata izquierda delgada que sube inclinada, un remate grueso arriba
 * (~80 cm) y la pata derecha gruesa que baja a otro montículo, con un R-24 gris en el piso a la derecha, un R-24 gris
 * arriba, dos cristal (uno con araña, otro con escarcha plateada), telarañas de fibra, dos letreros de calavera, un
 * murciélago de lentejuelas, una guirnalda de papel de esqueletos y, detrás, el mural metalizado de cuadros plata
 * (1 × 2 m). Delante, dos mesas de coctel con mantel blanco y cara de fantasma.
 */
const escena654 = (): Escena => {
  const S = sala(580, 440, 320, { piso: "#232323", paredes: "#262626", techo: "#2a2a2a" });
  const Z_ARCO = -150;
  const recorrido = [
    v(-150, 32, 8), v(-116, 58, 4), v(-88, 96, 0), v(-70, 135, 0), v(-56, 175, 0), v(-42, 212, 0), v(-22, 240, 0), v(5, 251, 0),
    v(36, 251, 0), v(60, 237, 0), v(76, 204, 0), v(84, 165, 0), v(86, 128, 0), v(95, 90, 0), v(112, 56, 4), v(136, 32, 8),
  ];
  const tramo: TramoOrganico = {
    id: "arco", nombre: "Arco en A", recorrido,
    grosor: [{ t: 0, radioCm: 40 }, { t: 0.1, radioCm: 33 }, { t: 0.22, radioCm: 21 }, { t: 0.38, radioCm: 21 }, { t: 0.5, radioCm: 36 }, { t: 0.6, radioCm: 37 }, { t: 0.72, radioCm: 30 }, { t: 0.86, radioCm: 32 }, { t: 1, radioCm: 34 }],
    mezcla: constante({ "R-12": 0.8, "R-9": 0.05, "R-5": 0.15 }), irregularidad: 0.15, tapas: { inicio: true, fin: true },
  };
  const arco = organico({
    semilla: 654, tramos: [tramo], inflados: { "R-12": 24, "R-9": 17, "R-5": 10 }, variacionInflado: 0.07,
    relleno: [{ formatoId: "R-12", infladoCm: 20, trios: false }],
    colores: [colorOrg("951", 5, ["R-5", "R-12"]), colorOrg("081", 2.8), colorOrg("080", 2.2)], suelo: true, huecosFlores: 0, vista: AL_FRENTE,
  });
  const telarana = (radioCm: number): Pieza => deco({ tipo: "telarana", propiedades: { radioCm, radios: 9, anillos: 5, hex: "#f1eff5", grosorCm: 0.7 } });
  const BLANCO = "#f4f3ef", NEGRO = "#151515";
  // Mesa de coctel con mantel hasta el piso (se abre abajo) y cara de fantasma al frente (ojos y boca de tela negra).
  const mesaFantasma = (x: number, z: number, alto: number): ElementoEscenografia[] => {
    const rArriba = 30, rAbajo = 40;
    const radioEn = (h: number) => rAbajo + (rArriba - rAbajo) * (h / alto);
    return [
      cilindro(v(x, 0, z), rAbajo, alto, BLANCO, "tela", rArriba),
      cilindro(v(x, alto, z), rArriba + 1, 1.5, BLANCO, "tela"),
      panel(ovalo(x - 9, alto * 0.72, 4.5, 8), z + radioEn(alto * 0.72), 0.6, NEGRO, "tela"),
      panel(ovalo(x + 9, alto * 0.72, 4.5, 8), z + radioEn(alto * 0.72), 0.6, NEGRO, "tela"),
      panel(ovalo(x, alto * 0.48, 3, 6), z + radioEn(alto * 0.48), 0.6, NEGRO, "tela"),
    ];
  };
  const mesas: ElementoEscenografia[] = [
    ...mesaFantasma(-36, -92, 108), ...mesaFantasma(24, -112, 112),
    // Platos morados y de zigzag, vasos morados y negros, y cupcakes.
    cilindro(v(-46, 109.5, -92), 11, 1, "#5b2a92", "brillante"), cilindro(v(-26, 109.5, -86), 11, 1, "#5b2a92", "brillante"),
    { forma: "cilindro", base: v(0, 0, 0), radioCm: 12, altoCm: 0.8, hex: "#5b2a92", acabado: "brillante", en: { origen: v(-40, 121, -100), ejeX: v(1, 0, 0), ejeY: v(0, 0.26, 0.97) } },
    { forma: "cilindro", base: v(0, 0, 0), radioCm: 12, altoCm: 0.8, hex: "#2b2b2b", acabado: "papel", motivo: { dibujo: "rayas", hex: "#f4f4f4", cara: "arriba" }, en: { origen: v(22, 126, -122), ejeX: v(1, 0, 0), ejeY: v(0, 0.26, 0.97) } },
    cilindro(v(-22, 109.5, -84), 3, 9, "#4b2a9a", "papel", 3.6), cilindro(v(36, 113.5, -104), 3, 9, "#1f1f1f", "papel", 3.6), cilindro(v(14, 113.5, -100), 3, 9, "#1f1f1f", "papel", 3.6),
    cilindro(v(18, 113.5, -108), 3, 4, "#f0e6d8"), cilindro(v(26, 113.5, -104), 3, 4, "#f0e6d8"), cilindro(v(32, 113.5, -112), 3, 4, "#f0e6d8"),
  ];
  // Utilería: esqueleto colgado, sombrero de bruja y araña morada de escarcha.
  const HUESO = "#e9edf2", MORADO = "#7a2bb0";
  const adornos: ElementoEscenografia[] = [
    ...bola(v(-70, 150, -110), 5, HUESO, "papel"), tablon(v(-70, 145, -110), v(-70, 112, -110), 6, 1, HUESO, "papel"),
    tablon(v(-70, 138, -110), v(-82, 120, -110), 2, 1, HUESO, "papel"), tablon(v(-70, 138, -110), v(-58, 120, -110), 2, 1, HUESO, "papel"),
    tablon(v(-70, 112, -110), v(-77, 88, -110), 2.4, 1, HUESO, "papel"), tablon(v(-70, 112, -110), v(-63, 88, -110), 2.4, 1, HUESO, "papel"),
    cilindro(v(-95, 140, -112), 14, 2, NEGRO, "tela"), cilindro(v(-95, 142, -112), 8, 22, NEGRO, "tela", 0.5),
    ...bola(v(-148, 62, -122), 6, MORADO, "lentejuelas"),
    ...[-1, 1].flatMap((lado) => [0, 1, 2, 3].map((k) => tablon(v(-148, 62, -120), v(-148 + lado * (10 + k * 1.5), 68 - k * 5, -118), 1, 0.6, MORADO, "lentejuelas"))),
  ];
  const calavera = (y: number): ElementoEscenografia[] => [
    panel(ovalo(-50, y, 8, 8), Z_ARCO + 22, 0.5, NEGRO, "papel"),
    panel(ovalo(-50, y + 1, 4.5, 4), Z_ARCO + 22.5, 0.3, "#f6f6f6", "papel"),
  ];
  const murcielago: Array<[number, number]> = [[0, 0], [-6, 4], [-12, 2], [-20, 8], [-24, 0], [-18, -2], [-14, -8], [-8, -4], [0, -8], [8, -4], [14, -8], [18, -2], [24, 0], [20, 8], [12, 2], [6, 4]];
  const guirnaldaPapel = banderin({
    recorrido: { tipo: "recto", desde: v(-50, 0, 0), hasta: v(92, 0, 0) }, caidaCm: 6, cantidad: 12, forma: "rectangulo", anchoCm: 10, altoCm: 16,
    colores: ["#f2f2f2"], motivos: [{ dibujo: "calavera", hex: "#1b1b1b" }], cordon: "#f2f2f2", productoId: null, descripcion: "guirnalda de papel de esqueletos",
  });
  return {
    sala: S,
    nodos: [
      { id: "arco", nombre: "Arco orgánico en A violeta, gris y negro", pieza: arco, colocacion: libre(0, 0, Z_ARCO) },
      sobre("gris-arriba", "R-24 Fashion Gris (arriba)", "arco", globo(R("R-24", 36, "081")), v(-8, 266, 6), v(0, 0.85, 0.5)),
      sobre("gris-piso", "R-24 Fashion Gris (en el piso, a la derecha)", "arco", globo(R("R-24", 55, "081")), v(150, 30, 10), v(1, 0, 0.25)),
      sobre("cristal-izquierda", "R-12 Cristal (con araña en la foto)", "arco", globo(R("R-12", 26, "390")), v(-150, 72, 20), v(-0.1, 0.2, 1)),
      sobre("cristal-derecha", "R-12 Cristal (con escarcha plateada en la foto)", "arco", globo(R("R-12", 26, "390")), v(88, 95, 20), v(0.3, 0, 1)),
      sobre("telarana-derecha", "Telaraña de fibra blanca (derecha)", "arco", telarana(34), v(100, 72, 25), v(0.35, 0, 1)),
      sobre("telarana-izquierda", "Telaraña de fibra blanca (izquierda)", "arco", telarana(26), v(-108, 86, 25), v(-0.2, 0, 1)),
      { id: "calaveras", nombre: "Letreros de calavera", pieza: escenografia([...calavera(217), ...calavera(176)]), colocacion: libre(0, 0, 0) },
      { id: "murcielago", nombre: "Murciélago de lentejuelas", pieza: escenografia([panel(murcielago.map(([x, y]) => [62 + x, 162 + y] as [number, number]), Z_ARCO + 26, 0.6, NEGRO, "lentejuelas")]), colocacion: libre(0, 0, 0) },
      { id: "guirnalda-papel", nombre: "Guirnalda de papel de esqueletos", pieza: guirnaldaPapel, colocacion: libre(0, 214, Z_ARCO + 30) },
      // El mural de cuadros plata detrás del arco: se ve por la abertura entre las patas.
      { id: "mural-plata", nombre: "Mural metalizado de cuadros plata", pieza: { tipo: "escenografia", utileria: "otro", elementos: [paredLentejuelas({ anchoCm: 100, altoCm: 200, hex: "#cfd2d8" })], productos: [productoDe("mural-metalizado-cuadros-plata", 1, "mural metalizado de cuadros plata")] }, colocacion: libre(12, 5, Z_ARCO - 26) },
      { id: "mesas", nombre: "Mesas de coctel de fantasma", pieza: escenografia(mesas), colocacion: libre(0, 0, 0) },
      { id: "adornos", nombre: "Esqueleto, sombrero de bruja y araña", pieza: escenografia(adornos), colocacion: libre(0, 0, 0) },
    ],
  };
};
const idea654 = idea("halloween-fantasmal", "Halloween fantasmal: arco violeta con mesas de fantasma", escena654,
  "Igual: el arco orgánico en «A» de ~3,5 m de pie a pie y ~2,8 m de alto, con el montículo grande al pie izquierdo, la pata izquierda delgada, el remate grueso arriba y la pata derecha gruesa, en Reflex Violeta (mayoría), Fashion Gris y Fashion Negro (los 3 publicados); el R-24 gris de arriba, el R-24 gris en el piso a la derecha, los dos cristal, dos telarañas de fibra blanca, los letreros de calavera, el murciélago de lentejuelas, la guirnalda de papel de esqueletos, el esqueleto, el sombrero de bruja, la araña morada y el mural metalizado de cuadros plata de la tienda (1 × 2 m) detrás; delante, las dos mesas de coctel con mantel blanco y cara de fantasma, con platos morados y de zigzag, vasos y cupcakes. Distinto: en la foto el arco es más ancho abajo (el montículo izquierdo sube hasta ~1 m) y el motor lo deja algo más esbelto; el cristal de la izquierda lleva una araña dentro y el de la derecha escarcha plateada (aquí lisos); las telarañas de la foto son fibra estirada (aquí una red de hilo); los globos de lo orgánico los da el motor (no se contaron uno a uno).", [P_VIOLETA, P("GLOBO REDONDO FASHION GRIS", "/products/globo-para-fiesta-latex-redondo-fashion-gris", "R-12", "081"), P_NEGRO, P("MURAL METALIZADO CUADROS PLATA", "/products/mural-metalizado-cuadros-plata", null, null)]);

// ----------------------------------------------------------------------------------------------------------
// 705 · Love (escena)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 1000 × 1000: el R-24 rosado de arriba mide ~180 px (≈ 55 cm): 3,3 px/cm en la pared; los pedestales de
 * acrílico de delante, 3,6 px/cm. La pared blanca mide 735 × 700 px (≈ 2,2 × 2,1 m): R-12 blancos (~60 px ≈ 20 cm)
 * con R-5 blancos entre ellos, en tablero. Encima, tres guirnaldas en diagonal hechas de racimos de un color uno junto
 * a otro (de izquierda a derecha): arriba merlot, fucsia, rosado y merlot, con el R-24 rosado; en medio merlot y coral
 * (con un coral grande), un racimito rosado, merlot y rojo, fucsia con rosado, coral y merlot; abajo coral, rojo,
 * merlot y fucsia a la izquierda y rojo y rosado a la derecha, con un R-24 fucsia. Dos pedestales de acrílico (50 × 75
 * cm) llenos de globos, un racimo rojo y coral entre ellos con un coral grande encima, un R-24 fucsia en el tapete
 * blanco, platos «LOVE», vasos y servilletas. Colores medidos: el coral es Fashion Coral Tropical (ΔE 7–9; la idea no
 * lo publica y no se fabrica en R-18: los grandes van en R-12 a 30 cm); el resto, los publicados (el rojo vino mide
 * Rojo Imperial, ΔE 7, y va Merlot, que es el publicado).
 */
const escena705 = (): Escena => {
  const S = sala(480, 380, 300, { piso: "#b98a5f", paredes: "#ece8e1", techo: "#f6f4f0" });
  const pared: OpcionesMural = {
    disposicion: "tablero", grande: { formatoId: "R-12", infladoCm: 20 }, chico: { formatoId: "R-5", infladoCm: 9 },
    matriz: { colores: ["005"], filas: Array.from({ length: 16 }, () => "a".repeat(17)) },
  };
  // Los racimos van delante de la pared (su frente, a 20 cm del fondo).
  const Z_PARED = -S.fondoCm / 2 + 20 + 14;
  const INFLADOS = { "R-12": 21, "R-9": 16, "R-5": 10 };
  // Relleno de huecos con globos medianos (la foto casi no tiene R-5 sueltos); el coral no se fabrica en R-9.
  const SIN_R9: RellenoOrganico[] = [{ formatoId: "R-12", infladoCm: 16, trios: false }];
  const CON_R9: RellenoOrganico[] = [{ formatoId: "R-9", infladoCm: 15, trios: false }];
  type Def = { id: string; nombre: string; puntos: Array<[number, number]>; radio: number; radioFin?: number; colores: ColorOrganico[]; z?: number };
  const CORAL = (peso = 1) => colorOrg("059", peso, ["R-5", "R-12"]);
  const pieza = (d: Def, k: number): Pieza => {
    const coral = d.colores.some((c) => c.codigo === "059");
    return racimos({
      racimos: [{ puntos: d.puntos.map(([x, y]) => v(x, y, 0)), radio: d.radio, ...(d.radioFin ? { radioFin: d.radioFin } : {}) }],
      mezcla: coral ? { "R-12": 0.85, "R-5": 0.15 } : { "R-12": 0.78, "R-9": 0.1, "R-5": 0.12 },
      colores: d.colores, semilla: 7050 + k, inflados: INFLADOS, relleno: coral ? SIN_R9 : CON_R9,
    });
  };
  // Racimos de la pared: (x, y) del eje en cm (x desde el centro de la pared, y desde el piso), medidos en la foto.
  const RACIMOS: Def[] = [
    { id: "merlot-arriba-izquierda", nombre: "Racimo merlot (arriba a la izquierda)", puntos: [[-61, 212], [-58, 186]], radio: 22, radioFin: 20, colores: [colorOrg("018", 1)] },
    { id: "fucsia-arriba", nombre: "Racimo fucsia (arriba)", puntos: [[-28, 180], [5, 170]], radio: 20, colores: [colorOrg("012", 1)] },
    { id: "rosado-arriba", nombre: "Racimo rosado (arriba)", puntos: [[15, 170], [50, 158], [80, 141]], radio: 20, radioFin: 17, colores: [colorOrg("009", 1)] },
    { id: "merlot-arriba-derecha", nombre: "Racimo merlot (arriba a la derecha)", puntos: [[78, 141], [105, 140], [124, 133]], radio: 20, colores: [colorOrg("018", 1)] },
    { id: "merlot-medio-izquierda", nombre: "Racimo merlot (en medio a la izquierda)", puntos: [[-125, 152], [-108, 138]], radio: 18, colores: [colorOrg("018", 1)] },
    { id: "coral-medio-izquierda", nombre: "Racimo coral (en medio a la izquierda)", puntos: [[-108, 160], [-82, 152]], radio: 16, colores: [CORAL()], z: 6 },
    { id: "rosado-merlot-rojo", nombre: "Racimito rosado, merlot y rojo", puntos: [[-74, 153], [-50, 140]], radio: 14, colores: [colorOrg("009", 1), colorOrg("018", 1), colorOrg("015", 1)] },
    { id: "fucsia-rosado-medio", nombre: "Racimo fucsia y rosado (en medio)", puntos: [[-50, 130], [-22, 112]], radio: 18, colores: [colorOrg("012", 2), colorOrg("009", 1.2)], z: 4 },
    { id: "coral-medio", nombre: "Racimo coral (en medio)", puntos: [[-10, 128], [15, 115], [35, 100]], radio: 19, colores: [CORAL()] },
    { id: "merlot-medio", nombre: "Racimo merlot (en medio, abajo)", puntos: [[-35, 102], [-5, 97]], radio: 11, colores: [colorOrg("018", 1)] },
    { id: "coral-abajo-izquierda", nombre: "Racimo coral (abajo a la izquierda)", puntos: [[-108, 105], [-82, 90]], radio: 17, colores: [CORAL()] },
    { id: "rojo-abajo-izquierda", nombre: "Racimo rojo (abajo a la izquierda)", puntos: [[-92, 78], [-62, 72]], radio: 12, colores: [colorOrg("015", 1)], z: 4 },
    { id: "merlot-abajo-izquierda", nombre: "Racimo merlot (abajo a la izquierda)", puntos: [[-135, 72], [-112, 62]], radio: 19, colores: [colorOrg("018", 1)] },
    { id: "fucsia-abajo-izquierda", nombre: "Racimo fucsia (abajo a la izquierda)", puntos: [[-112, 48], [-92, 40]], radio: 12, colores: [colorOrg("012", 1)], z: 4 },
    { id: "rojo-abajo-derecha", nombre: "Racimo rojo (abajo a la derecha)", puntos: [[75, 65], [100, 55], [115, 40]], radio: 22, colores: [colorOrg("015", 1)] },
    { id: "rosado-abajo-derecha", nombre: "Racimo rosado (abajo a la derecha)", puntos: [[64, 34], [71, 13]], radio: 15, colores: [colorOrg("009", 1)], z: 8 },
  ];
  // Delante: el relleno de cada pedestal de acrílico y el racimo de entre los dos (x, z del pedestal).
  const PED_IZQ = v(-64, 0, -100), PED_DER = v(19, 0, -100);
  const relleno = (id: string, nombre: string, p: Vec3, k: number, colores: ColorOrganico[]): NodoEscena => ({
    id, nombre, colocacion: libre(p.x, 0, p.z),
    pieza: racimos({ racimos: [{ puntos: [v(0, 14, 0), v(0, 58, 0)], radio: 21 }], mezcla: { "R-12": 0.9, "R-5": 0.1 }, colores, semilla: 7060 + k, inflados: INFLADOS, relleno: SIN_R9 }),
  });
  const ACRILICO = "#e6edf0";
  const pedestal = (p: Vec3, ancho: number, alto: number): ElementoEscenografia[] => [
    caja(v(p.x, alto - 0.75, p.z), v(ancho, 1.5, ancho), ACRILICO, "brillante"),
    ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => caja(v(p.x + (sx * (ancho - 1.5)) / 2, alto / 2, p.z + (sz * (ancho - 1.5)) / 2), v(1.5, alto, 1.5), ACRILICO, "brillante"))),
  ];
  // Plato «LOVE» de pie, plato negro detrás, vaso con servilleta y cubiertos sobre cada pedestal.
  const mesaLove = (p: Vec3, alto: number): ElementoEscenografia[] => [
    { forma: "cilindro", base: v(0, 0, 0), radioCm: 15, altoCm: 0.8, hex: "#1d1d1d", acabado: "brillante", en: { origen: v(p.x - 4, alto + 16, p.z - 14), ejeX: v(1, 0, 0), ejeY: v(0, 0.26, 0.97) } },
    { forma: "cilindro", base: v(0, 0, 0), radioCm: 12, altoCm: 0.8, hex: "#f6e3ea", acabado: "papel", motivo: { dibujo: "texto", texto: "LOVE", hex: "#d42032", cara: "arriba" }, en: { origen: v(p.x - 4, alto + 13, p.z - 12), ejeX: v(1, 0, 0), ejeY: v(0, 0.26, 0.97) } },
    cilindro(v(p.x + 14, alto, p.z + 6), 3.5, 10, "#f4f0ee", "papel", 4.2), caja(v(p.x + 14, alto + 13, p.z + 6), v(7, 7, 2), "#d42032", "papel", 20),
    cilindro(v(p.x - 18, alto, p.z + 8), 3.2, 9, "#f6e3c8", "papel", 4), caja(v(p.x - 18, alto + 11, p.z + 8), v(7, 7, 2), "#d42032", "papel", -15),
    caja(v(p.x, alto + 0.6, p.z + 14), v(26, 1.2, 10), "#e9d3db", "papel"),
  ];
  const escenario: ElementoEscenografia[] = [
    ...tapete({ anchoCm: 320, fondoCm: 170, hex: "#f1ece6" }).map((e) => (e.forma === "caja" ? { ...e, centro: v(e.centro.x, e.centro.y, -85) } : e)),
    ...pedestal(PED_IZQ, 50, 75), ...pedestal(PED_DER, 52, 77),
    ...mesaLove(PED_IZQ, 75), ...mesaLove(PED_DER, 77),
  ];
  const nodos: NodoEscena[] = [
    { id: "pared", nombre: "Pared de globos blancos (tablero de R-12 y R-5)", pieza: { tipo: "mural", mural: pared }, colocacion: EN_LA_PARED },
    ...RACIMOS.map((d, k): NodoEscena => ({ id: d.id, nombre: d.nombre, pieza: pieza(d, k), colocacion: libre(0, 0, Z_PARED + (d.z ?? 0)) })),
    // Los grandes: el R-24 rosado sobre el racimo rosado de arriba, el coral grande sobre el coral de la izquierda y el
    // R-24 fucsia junto al racimo rojo de abajo a la derecha.
    sobre("rosado-grande", "R-24 Fashion Rosado (arriba a la derecha)", "rosado-arriba", globo(R("R-24", 55, "009")), v(58, 172, 10), v(0.1, 0.8, 0.6)),
    sobre("coral-grande-izquierda", "R-12 Coral Tropical grande (izquierda)", "coral-medio-izquierda", globo(R("R-12", 30, "059")), v(-112, 170, 0), v(-0.3, 1, 0.3)),
    sobre("fucsia-grande-derecha", "R-24 Fashion Fucsia (abajo a la derecha)", "rojo-abajo-derecha", globo(R("R-24", 50, "012")), v(64, 72, 12), v(-0.6, 0.2, 0.8)),
    relleno("relleno-pedestal-izquierdo", "Globos dentro del pedestal izquierdo", PED_IZQ, 0, [colorOrg("015", 2), CORAL(1.5), colorOrg("009", 2), colorOrg("018", 0.5)]),
    relleno("relleno-pedestal-derecho", "Globos dentro del pedestal derecho", PED_DER, 1, [colorOrg("015", 2), CORAL(1.5), colorOrg("009", 1.5), colorOrg("018", 1)]),
    {
      id: "racimo-entre-pedestales", nombre: "Racimo rojo y coral entre los pedestales", colocacion: libre(-21, 0, -100),
      pieza: racimos({ racimos: [{ puntos: [v(0, 26, 0), v(2, 48, 0)], radio: 17 }], mezcla: { "R-12": 0.9, "R-5": 0.1 }, colores: [colorOrg("015", 2), CORAL(1)], semilla: 7062, inflados: INFLADOS, relleno: SIN_R9 }),
    },
    sobre("coral-grande-centro", "R-12 Coral Tropical grande (entre los pedestales)", "racimo-entre-pedestales", globo(R("R-12", 30, "059")), v(1, 64, 0), ARRIBA),
    { id: "fucsia-piso", nombre: "R-24 Fashion Fucsia (en el tapete)", pieza: globo(R("R-24", 52, "012")), colocacion: libre(-112, 36, -62) },
    { id: "pedestales", nombre: "Pedestales de acrílico, tapete y vajilla LOVE", pieza: escenografia(escenario), colocacion: libre(0, 0, 0) },
  ];
  return { sala: S, nodos };
};
const idea705 = idea("love", "Love: pared blanca con guirnaldas de racimos rojos y rosados", escena705,
  "Igual: la pared blanca de ~2,2 × 2,1 m (tablero de 17 × 16: 136 R-12 y 136 R-5) y, encima, las tres guirnaldas en diagonal armadas como en la foto, racimo de un color junto a otro: arriba merlot, fucsia, rosado (con el R-24 rosado) y merlot; en medio merlot, coral (con un coral grande), un racimito rosado-merlot-rojo, fucsia con rosado, coral y merlot; abajo coral, rojo, merlot y fucsia a la izquierda y rojo (con el R-24 fucsia) y rosado a la derecha; los dos pedestales de acrílico llenos de globos rojos, coral, rosados y merlot, el racimo rojo y coral entre ellos con su coral grande, el R-24 fucsia en el tapete blanco y la vajilla «LOVE». Distinto: el coral de la foto es Fashion Coral Tropical (ΔE 7–9), que la idea no publica (va con el liso de la tienda) y no se fabrica en R-18: los corales grandes son R-12 a 30 cm (en la foto, ~40 cm); el rojo vino mide Rojo Imperial (ΔE 7) y va el Merlot publicado; cada racimo es su propia estructura (la biblioteca no saca «la guirnalda entera»); los globos de cada racimo los da el motor; el acrílico es solo el canto (no se ve transparente).", [
  P("GLOBO REDONDO FASHION FUCSIA", "/products/globo-para-fiesta-latex-redondo-fashion-fucsia", "R-12", "012"),
  P("GLOBO REDONDO FASHION ROSADO", "/products/globo-para-fiesta-latex-redondo-fashion-rosado", "R-12", "009"),
  P("GLOBO REDONDO FASHION ROJO", "/products/globo-para-fiesta-latex-redondo-fashion-rojo", "R-12", "015"),
  P("GLOBO REDONDO FASHION MERLOT", "/products/globo-latex-redondo-fashion-merlot", "R-12", "018"),
  P_BLANCO,
]);

// ----------------------------------------------------------------------------------------------------------
// 795 · Ocasiones especiales tonos neutros (escena)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 1080 × 1080: la mesa dorada mide 670 px (≈ 1,55 m) y su tapa está a 325 px del piso (≈ 75 cm): 4,3 px/cm. El
 * aro de metal dorado (ajustado por mínimos cuadrados a seis puntos de la foto) tiene el centro a 1,19 m del piso y
 * 88 cm de radio (≈ 1,8 m). Su guirnalda orgánica va de arriba a la izquierda (118°) por la derecha hasta abajo (−42°),
 * más gruesa a la derecha, con un racimo aparte abajo a la izquierda (186°–226°); en el tramo de aro sin globos, a 158°,
 * una flor de 8 hojas de tubito dorado retorcido (~45 cm) con plumas de pampa y un centro de R-5. Debajo de la mesa,
 * un monticulo orgánico en el piso. Colores: los 4 publicados (el rosado de la foto se ve más salmón).
 */
const escena795 = (): Escena => {
  const S = sala(460, 320, 280, { piso: "#e3dfd8", paredes: "#dedad4", techo: "#f4f2ee" });
  const Z_ARO = -85, CENTRO = v(8, 119, 0), RADIO = 88;
  const enAro = (grados: number, radio = RADIO) => v(r2(CENTRO.x + radio * Math.cos(rad(grados))), r2(CENTRO.y + radio * Math.sin(rad(grados))), 0);
  const arcoDe = (desde: number, hasta: number, pasos: number, radio = RADIO) => Array.from({ length: pasos + 1 }, (_, i) => enAro(desde + ((hasta - desde) * i) / pasos, radio));
  const COLORES = [colorOrg("071", 3), colorOrg("609", 2.4), colorOrg("640", 2.2), colorOrg("970", 2, ["R-5", "R-9"])];
  const INFLADOS = { "R-12": 23, "R-9": 15, "R-5": 9.5 };
  // Relleno sin tríos: los R-5 de la foto son los racimitos dorados (y algunos arena), no un relleno parejo.
  const RELLENO: RellenoOrganico[] = [{ formatoId: "R-9", infladoCm: 15, trios: false }];
  const MEZCLA = constante({ "R-12": 0.6, "R-9": 0.2, "R-5": 0.2 });
  const guirnaldaAro: TramoOrganico = {
    id: "guirnalda", nombre: "Guirnalda del aro", recorrido: arcoDe(118, -42, 16, RADIO - 3),
    grosor: [{ t: 0, radioCm: 17 }, { t: 0.3, radioCm: 20 }, { t: 0.55, radioCm: 26 }, { t: 0.85, radioCm: 22 }, { t: 1, radioCm: 18 }],
    mezcla: MEZCLA, irregularidad: 0.16, tapas: { inicio: true, fin: true },
  };
  const racimoAro: TramoOrganico = {
    id: "racimo_izquierdo", nombre: "Racimo de abajo a la izquierda", recorrido: arcoDe(186, 226, 4, RADIO + 6),
    grosor: [{ t: 0, radioCm: 20 }, { t: 1, radioCm: 23 }], mezcla: MEZCLA, irregularidad: 0.16, tapas: { inicio: true, fin: true },
  };
  const aro = organico({ semilla: 795, tramos: [guirnaldaAro, racimoAro], inflados: INFLADOS, variacionInflado: 0.07, relleno: RELLENO, colores: COLORES, suelo: true, huecosFlores: 0, vista: AL_FRENTE });
  const monticulo = racimos({
    racimos: [{ puntos: [v(-44, 21, 0), v(0, 23, -4), v(46, 21, 0)], radio: 22 }],
    mezcla: { "R-12": 0.6, "R-9": 0.2, "R-5": 0.2 }, colores: COLORES, semilla: 7951, inflados: INFLADOS, relleno: RELLENO,
  });
  // La flor de hojas doradas: 8 hojas de tubito retorcido en burbujas, con un anillo de R-5 azul y el centro rosado.
  const PUNTO_FLOR = enAro(158);
  const florHojas = deco(florTubito(burbujas("T-260", 5, ["970"], 8, 45, 0, 8), R("R-5", 8, "609"), null, { ...R("R-5", 8, "640"), cantidad: 6 }));
  // Las plumas de pampa, saliendo del centro de la flor entre las hojas.
  const PAMPA = "#efe5cc";
  const pampas: ElementoEscenografia[] = [100, 62, 30, -18, 145, 205, 250].flatMap((a, k) => {
    const desde = v(PUNTO_FLOR.x, PUNTO_FLOR.y, Z_ARO + 9), largoPluma = 44 + (k % 3) * 6;
    const punta = v(r2(desde.x + largoPluma * Math.cos(rad(a))), r2(desde.y + largoPluma * Math.sin(rad(a))), Z_ARO + 9);
    const inicio = v(r2(desde.x + (punta.x - desde.x) * 0.45), r2(desde.y + (punta.y - desde.y) * 0.45), Z_ARO + 9);
    return [tubo(desde, inicio, 0.3, "#a8895a", "mate"), tubo(inicio, punta, 4.5, PAMPA, "pampa")];
  });
  // El aro de metal dorado: tramos rectos de tubo alrededor del círculo.
  const ORO = "#c9a64a";
  const aroMetal: ElementoEscenografia[] = Array.from({ length: 36 }, (_, i) => tubo(mas(enAro(i * 10), v(0, 0, Z_ARO)), mas(enAro((i + 1) * 10), v(0, 0, Z_ARO)), 1.2, ORO));
  // La mesa dorada de patas torneadas, con la base de cupcakes, los platos de pie, vasos y servilletas doradas.
  const MESA_Z = -8, ALTO = 75;
  const mesa: ElementoEscenografia[] = [
    caja(v(0, ALTO - 2.5, MESA_Z), v(150, 5, 70), ORO, "satinado"),
    caja(v(0, ALTO - 10, MESA_Z), v(144, 10, 64), ORO, "satinado"),
    ...[-1, 1].flatMap((sx) => [-1, 1].flatMap((sz) => {
      const x = sx * 68, z = MESA_Z + sz * 29;
      return [cilindro(v(x, 0, z), 3, 15, ORO, "satinado", 4), ...bola(v(x, 22, z), 5.5, ORO, "satinado", 4), cilindro(v(x, 27, z), 3.5, 20, ORO, "satinado", 3), ...bola(v(x, 52, z), 5, ORO, "satinado", 4), cilindro(v(x, 56, z), 4, 10, ORO, "satinado")];
    })),
    // Base de cupcakes de 3 pisos gris con 9 cupcakes.
    cilindro(v(0, ALTO, MESA_Z), 2, 34, "#7d7f86", "mate"),
    ...[[ALTO + 2, 16], [ALTO + 14, 13], [ALTO + 26, 10]].flatMap(([y, r]) => [cilindro(v(0, y!, MESA_Z), r!, 1, "#7d7f86", "mate"), ...[-1, 0, 1].map((k) => cilindro(v(k * r! * 0.55, y! + 1, MESA_Z + 3), 2.8, 4, "#e9d9b4", "mate", 3.2))]),
    // Platos coral de pie con su plato plata y dorado, vasos rosados con servilleta dorada.
    { forma: "cilindro", base: v(0, 0, 0), radioCm: 15, altoCm: 0.8, hex: "#d98c7d", acabado: "papel", en: { origen: v(-42, ALTO + 15, MESA_Z - 18), ejeX: v(1, 0, 0), ejeY: v(0, 0.26, 0.97) } },
    { forma: "cilindro", base: v(0, 0, 0), radioCm: 11, altoCm: 0.8, hex: "#c9ccd2", acabado: "metal", en: { origen: v(-42, ALTO + 14, MESA_Z - 17), ejeX: v(1, 0, 0), ejeY: v(0, 0.26, 0.97) } },
    { forma: "cilindro", base: v(0, 0, 0), radioCm: 15, altoCm: 0.8, hex: "#d98c7d", acabado: "papel", en: { origen: v(42, ALTO + 15, MESA_Z - 18), ejeX: v(1, 0, 0), ejeY: v(0, 0.26, 0.97) } },
    { forma: "cilindro", base: v(0, 0, 0), radioCm: 11, altoCm: 0.8, hex: "#e2bd4a", acabado: "metal", en: { origen: v(42, ALTO + 14, MESA_Z - 17), ejeX: v(1, 0, 0), ejeY: v(0, 0.26, 0.97) } },
    ...[-60, -30, 28, 60].flatMap((x) => [cilindro(v(x, ALTO, MESA_Z - 4), 3.2, 9, "#e3a59a", "papel", 3.8), caja(v(x, ALTO + 11, MESA_Z - 4), v(6, 6, 2), "#d9b24c", "papel", 20)]),
    cilindro(v(-25, ALTO, MESA_Z + 14), 13, 0.8, "#d98c7d", "papel"), caja(v(0, ALTO + 0.4, MESA_Z + 12), v(120, 0.4, 22), "#f2ece3", "papel"),
  ];
  return {
    sala: S,
    nodos: [
      { id: "aro", nombre: "Guirnalda orgánica del aro (arena, rosado, azul y dorado)", pieza: aro, colocacion: libre(0, 0, Z_ARO) },
      sobre("flor-hojas", "Flor de 8 hojas de tubito dorado", "aro", florHojas, PUNTO_FLOR, AL_FRENTE),
      { id: "monticulo", nombre: "Montículo orgánico bajo la mesa", pieza: monticulo, colocacion: libre(0, 0, MESA_Z - 6) },
      { id: "aro-metal", nombre: "Aro de metal dorado", pieza: escenografia(aroMetal), colocacion: libre(0, 0, 0) },
      { id: "pampas", nombre: "Plumas de pampa", pieza: escenografia(pampas), colocacion: libre(0, 0, 0) },
      { id: "mesa", nombre: "Mesa dorada de patas torneadas con cupcakes y platos", pieza: escenografia(mesa), colocacion: libre(0, 0, 0) },
    ],
  };
};
const idea795 = idea("ocasiones-especiales-tonos-neutros", "Tonos neutros: aro orgánico con flor de hojas doradas y mesa dorada", escena795,
  "Igual: el aro de metal dorado de ~1,8 m (centro y radio ajustados a seis puntos de la foto) con la guirnalda orgánica de arriba a la izquierda por la derecha hasta abajo, más gruesa a la derecha, y el racimo de abajo a la izquierda, en Arena, Pastel Mate Rosado, Pastel Mate Azul y Reflex Dorado (los 4 publicados; el dorado en R-5 y R-9); en el tramo de aro sin globos la flor de 8 hojas de T-260 Reflex Dorado de ~45 cm con su centro de R-5 azul y rosado y las plumas de pampa; el montículo orgánico en el piso bajo la mesa; la mesa dorada de 1,5 m con patas torneadas, la base de cupcakes de 3 pisos, los platos coral de pie con su plato plata y dorado, los vasos y las servilletas doradas. Distinto: las hojas de la foto son dos tubitos retorcidos juntos; aquí una cadena de burbujas de un tubito por hoja; algunos R-5 dorados de la foto parecen de escarcha (aquí Reflex Dorado liso); el rosado de la foto se ve más salmón; los globos de lo orgánico los da el motor (no se contaron uno a uno).", [
  P_ARENA, P_DORADO,
  P("GLOBO REDONDO PASTEL MATE AZUL", "/products/globo-para-fiesta-latex-redondo-pastel-mate-azul", "R-12", "640"),
  P("GLOBO REDONDO PASTEL MATE ROSADO", "/products/globo-para-fiesta-latex-redondo-pastel-mate-rosado", "R-12", "609"),
]);

// ----------------------------------------------------------------------------------------------------------
// 847 · Pinturas (escena)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 740 × 570: los globos de la pared miden ~25–27 px y van uno junto a otro; con las letras de foami de ~68 cm y
 * la mesa a ~1 m: 1,9 px/cm, R-12 a 16 cm (paso de 14,4 cm). La pared son franjas verticales de colores; contadas por
 * columnas de globos de izquierda a derecha (la foto corta las dos de las orillas): azul rey 3, rojo 2, naranja 3,
 * amarillo 4, verde 2, verde aurora 5, azul caribe 3, azul 4 y fucsia 3 = 29 columnas, y 22 filas (~3,2 m). Colores
 * medidos (la idea no publica productos): Fashion Azul Rey (ΔE 6), Fashion Rojo (ΔE 3), Fashion Naranja (ΔE 13),
 * Fashion Amarillo (ΔE 7), Fashion Verde (ΔE 7), Reflex Verde Aurora (ΔE 4: el verde oscuro), Fashion Azul Caribe
 * (ΔE 10), Fashion Azul (ΔE 10) y Fashion Fucsia (el más cercano Fashion, ΔE 17). Delante: el marco lila de foami
 * girado con el «5» azul, el tubo de pintura azul y el pincel a la izquierda, el tubo verde a la derecha, la mesa negra
 * con la torta de 3 pisos, las letras «M» y «A» y las cajas de madera con dulces.
 */
const escena847 = (): Escena => {
  const S = sala(560, 420, 340, { piso: "#5a4a4c", paredes: "#f2eee8", techo: "#f7f5f2" });
  const FRANJAS: ReadonlyArray<readonly [string, number]> = [["041", 3], ["015", 2], ["061", 3], ["020", 4], ["030", 2], ["932", 5], ["038", 3], ["040", 4], ["012", 3]];
  const fila = FRANJAS.map(([, n], k) => "abcdefghi"[k]!.repeat(n)).join("");
  const pared: OpcionesMural = {
    disposicion: "simple", grande: { formatoId: "R-12", infladoCm: 16 }, chico: null,
    matriz: { colores: FRANJAS.map(([c]) => c), filas: Array.from({ length: 22 }, () => fila) },
  };
  const Z = -S.fondoCm / 2 + 16;
  // Marco lila de foami girado 14° con el hueco al medio y el «5» azul de bloques.
  const girar = (x: number, y: number, g: number, cx: number, cy: number): [number, number] => [cx + x * Math.cos(rad(g)) - y * Math.sin(rad(g)), cy + x * Math.sin(rad(g)) + y * Math.cos(rad(g))];
  const cuadrado = (lado: number) => [[-lado, -lado], [lado, -lado], [lado, lado], [-lado, lado]].map(([x, y]) => girar(x! / 2, y! / 2, 14, 0, 216));
  const LILA = "#c08fda", AZUL5 = "#45a8e0";
  const cinco: ElementoEscenografia[] = [
    caja(v(3, 258, Z + 10), v(47, 12, 8), AZUL5), caja(v(-15, 240, Z + 10), v(12, 36, 8), AZUL5), caja(v(3, 222, Z + 10), v(47, 12, 8), AZUL5),
    caja(v(21, 204, Z + 10), v(12, 36, 8), AZUL5), caja(v(3, 186, Z + 10), v(47, 12, 8), AZUL5),
  ];
  const pintura: ElementoEscenografia[] = [
    { forma: "panel", contorno: cuadrado(116).map(([x, y]) => ({ x: r2(x), y: r2(y) })), huecos: [cuadrado(80).reverse().map(([x, y]) => ({ x: r2(x), y: r2(y) }))], zCm: Z + 4, grosorCm: 4, hex: LILA, acabado: "mate" },
    ...cinco,
    // La lata blanca que vierte pintura rosada sobre la torta.
    { forma: "cilindro", base: v(0, 0, 0), radioCm: 8, altoCm: 14, hex: "#f4f4f4", acabado: "metal", en: { origen: v(26, 196, Z + 18), ejeX: v(0.8, 0.6, 0), ejeY: v(-0.6, 0.8, 0) } },
    tablon(v(22, 192, Z + 20), v(12, 160, Z + 26), 5, 2, "#ef7fae", "brillante"),
    // El tubo de pintura azul (acrílico) y el pincel rosado de la izquierda.
    caja(v(-134, 196, Z + 8), v(60, 28, 10), "#5aa0d8", "satinado"), caja(v(-100, 196, Z + 8), v(10, 18, 10), "#c9c9c9", "metal"),
    tablon(v(-100, 184, Z + 14), v(-37, 300, Z + 14), 3, 3, "#f2a7c7", "satinado"), caja(v(-104, 176, Z + 14), v(8, 14, 6), "#7fb6e8", "mate"),
    // El tubo verde de la derecha, con la tapa plateada arriba y la boquilla blanca abajo.
    caja(v(84, 210, Z + 8), v(36, 100, 10), "#4cc23a", "satinado"), caja(v(84, 272, Z + 8), v(34, 26, 10), "#c9c9c9", "metal"), caja(v(84, 154, Z + 8), v(14, 12, 10), "#f4f4f4", "mate"),
  ];
  const MESA_Z = -120, ALTO = 100;
  const MADERA = "#d9b98a";
  const letraM: ElementoEscenografia[] = [
    tablon(v(-80, 0, -80), v(-80, 62, -80), 12, 8, "#f26aa6"), tablon(v(-80, 62, -80), v(-62, 30, -80), 11, 8, "#f26aa6"),
    tablon(v(-62, 30, -80), v(-44, 62, -80), 11, 8, "#f26aa6"), tablon(v(-44, 62, -80), v(-44, 0, -80), 12, 8, "#f26aa6"),
  ];
  const letraA: ElementoEscenografia[] = [
    tablon(v(46, 5, -80), v(70, 66, -80), 12, 8, "#f5823a"), tablon(v(70, 66, -80), v(94, 5, -80), 12, 8, "#f5823a"), caja(v(70, 22, -80), v(30, 9, 8), "#f5823a"),
  ];
  // La mesa (en su espacio: centrada, x hacia la derecha) con la torta sobre su base azul y los cupcakes.
  const mesa: ElementoEscenografia[] = [
    ...mesaConMantel({ anchoCm: 170, fondoCm: 60, altoCm: ALTO, mantel: "#1f1f22" }),
    cilindro(v(15, ALTO, 0), 32, 4, "#2f6fd0", "satinado"),
    cilindro(v(15, ALTO + 4, 0), 22, 18, "#f7f7f7", "mate"), cilindro(v(15, ALTO + 22, 0), 15, 20, "#f39ac0", "mate"), cilindro(v(15, ALTO + 42, 0), 9, 12, "#f4f4f4", "metal"),
    ...[-9, -1, 7, 31, 39].map((x, k) => cilindro(v(x, ALTO + 4, 24), 3.5, 5, ["#f5d23c", "#e84b5a", "#4aa3df", "#8fd24a", "#b07ad6"][k]!, "mate", 4.2)),
  ];
  // Las letras, las cajas de madera con dulces a los lados, el balde de chupetines.
  const delante: ElementoEscenografia[] = [
    ...letraM, ...letraA,
    caja(v(-150, 30, -100), v(60, 60, 40), MADERA, "madera"), caja(v(-150, 75, -100), v(50, 30, 36), "#f4f4f4", "mate"),
    caja(v(-120, 15, -70), v(45, 30, 35), "#d6332f", "brillante"),
    caja(v(150, 40, -100), v(70, 80, 40), MADERA, "madera"), caja(v(110, 60, -110), v(40, 120, 36), MADERA, "madera"),
    cilindro(v(5, 0, -75), 12, 32, "#c9c9c9", "metal"), ...[-6, 0, 6, 12].flatMap((x, k) => bola(v(x, 44 + (k % 2) * 4, -75), 3.5, ["#f5d23c", "#8fd24a", "#f06ab0", "#4aa3df"][k]!, "brillante", 4)),
  ];
  return {
    sala: S,
    nodos: [
      { id: "pared", nombre: "Pared de franjas verticales arcoíris", pieza: { tipo: "mural", mural: pared }, colocacion: EN_LA_PARED },
      { id: "pintura", nombre: "Marco lila, número 5, tubos de pintura y pincel de foami", pieza: escenografia(pintura), colocacion: libre(0, 0, 0) },
      { id: "mesa", nombre: "Mesa negra con la torta de 3 pisos", pieza: escenografia(mesa), colocacion: libre(-5, 0, MESA_Z) },
      { id: "letras-cajas", nombre: "Letras M y A de foami y cajas de dulces", pieza: escenografia(delante), colocacion: libre(0, 0, 0) },
    ],
  };
};
const idea847 = idea("pinturas", "Pinturas: pared de franjas arcoíris", escena847,
  "Igual: la pared de franjas verticales celda a celda, 29 columnas × 22 filas de R-12 a 16 cm (≈ 4,2 × 3,2 m): azul rey 3, rojo 2, naranja 3, amarillo 4, verde 2, verde aurora 5, azul caribe 3, azul 4 y fucsia 3 columnas, con los colores medidos en la foto; delante, el marco lila de foami girado con el «5» azul, la lata que vierte pintura rosada, el tubo de pintura azul y el pincel, el tubo verde, la mesa negra con la torta de 3 pisos y los cupcakes, las letras «M» y «A» de foami, las cajas de madera con dulces y el balde de chupetines. Distinto: en la foto cada columna va corrida medio globo de la vecina (aquí en retícula cuadrada); la foto corta las dos franjas de las orillas (se completaron a 3 columnas); la franja roja se ve fucsia arriba por la luz (va Fashion Rojo, ΔE 3 abajo); el verde oscuro es Reflex Verde Aurora (ΔE 4), único que se le parece; la idea no publica productos y la escala es aproximada (sin una medida segura en la foto); la utilería de foami es de bloques simples.");

// ----------------------------------------------------------------------------------------------------------
// 862 · Primera comunión niño (escena)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 740 × 570 (con marco blanco): la pared azul va del piso al falso techo (330 px). Ampliada ×5: los globos grandes
 * van en retícula cuadrada (paso 27,5 px, uno junto a otro) y entre cada cuatro queda un hueco: la mitad lleva un R-5
 * azul y la otra mitad queda abierta (los rombos claros), alternados en damero. 26 columnas × 12 filas; con el techo a
 * ~2,5 m: 1,3 px/cm, R-12 a 21 cm y R-5 a 9 cm (≈ 4,9 × 2,3 m). Color medido: azul de tono 200° (Neón Azul ΔE 12; entre
 * los Fashion a ≤ 6 ΔE del mejor, Fashion Azul, que es el de ese tono). Arriba, dos nubes de globos blancos; delante,
 * dos pedestales blancos con arreglos de flores, dos figuras de cartón de Jesús, dos palomas y la mesa blanca de dos
 * pisos con los postres.
 */
const escena862 = (): Escena => {
  const S = sala(560, 400, 300, { piso: "#d9cfc8", paredes: "#eef0f2", techo: "#f2f3f5" });
  const COLS = 26, FILAS = 12;
  // Un R-5 en la mitad de los huecos (en damero); en la otra mitad, el hueco queda abierto.
  const huecos: Array<[number, number]> = [];
  for (let f = 0; f < FILAS - 1; f++) for (let c = 0; c < COLS - 1; c++) if ((f + c) % 2 === 0) huecos.push([c + 0.5, f + 0.5]);
  const pared: OpcionesMural = {
    disposicion: "simple", grande: { formatoId: "R-12", infladoCm: 21 }, chico: null,
    matriz: { colores: ["040"], filas: Array.from({ length: FILAS }, () => "a".repeat(COLS)) },
    encima: [{ formatoId: "R-5", infladoCm: 9, codigo: "040", puntos: huecos }],
  };
  const Z_NUBES = -S.fondoCm / 2 + 35;
  const nube = (semilla: number): Pieza => ({
    tipo: "forma",
    forma: { clase: "rellena", contorno: { tipo: "predefinido", id: "nube", anchoCm: 92, altoCm: 62 }, tecnica: { tipo: "organico", radioCm: 14, mezcla: { "R-12": 0.6, "R-9": 0.4 }, semilla, inflados: { "R-12": 22, "R-9": 16 } }, colores: { codigos: ["005"], patron: "un_color" } },
  });
  const BLANCO = "#f6f6f4", PIEL = "#f2c9a0", PELO = "#7a4a2a", TUNICA = "#dcecf2", FAJA = "#e2572b";
  // Figura de cartón de Jesús (de frente): túnica, faja roja, cabeza, pelo y barba.
  const jesus = (x: number, z: number): ElementoEscenografia[] => [
    panel([[x - 24, 0], [x + 24, 0], [x + 20, 82], [x + 14, 92], [x - 14, 92], [x - 20, 82]], z, 1, TUNICA, "papel"),
    tablon(v(x - 18, 84, z + 1.2), v(x + 16, 30, z + 1.2), 8, 0.6, FAJA, "papel"),
    panel(ovalo(x, 104, 15, 17), z - 0.5, 1, PELO, "papel"),
    panel(ovalo(x, 106, 11, 12), z + 1, 0.6, PIEL, "papel"),
    panel([[x - 9, 100], [x + 9, 100], [x + 6, 88], [x, 84], [x - 6, 88]], z + 1.7, 0.4, PELO, "papel"),
  ];
  const paloma = (x: number, y: number, z: number, lado: number): ElementoEscenografia =>
    panel([[0, 0], [lado * 10, 4], [lado * 16, 14], [lado * 6, 6], [lado * -4, 8], [lado * -12, 2], [lado * -4, -2], [lado * 2, -8]].map(([a, b]) => [x + a!, y + b!] as [number, number]), z, 0.6, "#ffffff", "papel");
  const flores = (x: number, z: number): ElementoEscenografia[] => [
    ...[[-14, 0, 9, "#f4f4f2"], [10, 2, 10, "#d6e8b4"], [0, 10, 11, "#f4f4f2"], [-6, -6, 8, "#7fa6d8"], [14, -8, 8, "#f4f4f2"], [-18, -10, 7, "#d6e8b4"], [4, -12, 8, "#9fc28a"]].flatMap(([dx, dy, r, hex]) => bola(v(x + Number(dx), 124 + Number(dy), z + 6), Number(r), String(hex), "tela", 4)),
  ];
  const escenario: ElementoEscenografia[] = [
    // El falso techo blanco sobre la pared.
    caja(v(0, 262, -S.fondoCm / 2 + 20), v(S.anchoCm, 40, 40), "#f4f5f6", "mate"),
    // Pedestales blancos con sus flores, las figuras de Jesús y las palomas.
    caja(v(-170, 55, -140), v(34, 110, 34), BLANCO, "mate"), caja(v(170, 55, -140), v(34, 110, 34), BLANCO, "mate"),
    ...flores(-170, -140), ...flores(170, -140),
    ...jesus(-110, -120), ...jesus(108, -120),
    paloma(-78, 140, -150, -1), paloma(118, 145, -150, 1),
  ];
  // La mesa blanca de dos pisos con patas torneadas, los postres, la torta y los frascos de vidrio.
  const MESA = v(-5, 0, -110);
  const mesa: ElementoEscenografia[] = [
    caja(v(0, 78, 0), v(170, 4, 60), BLANCO, "brillante"), caja(v(0, 116, -10), v(130, 4, 40), BLANCO, "brillante"),
    ...[-80, 80].flatMap((x) => [-26, 26].map((z) => cilindro(v(x, 0, z), 3, 76, BLANCO, "satinado", 2.5))),
    ...[-60, 60].map((x) => cilindro(v(x, 80, -10), 2.5, 36, BLANCO, "satinado")),
    cilindro(v(0, 118, -10), 9, 14, "#2f8f5b", "mate"), cilindro(v(0, 132, -10), 8, 8, "#f4f4f4", "mate"),
    ...[-42, -30, 30, 42].map((x) => caja(v(x, 122, -10), v(10, 8, 10), "#c6a77a", "papel")),
    ...[-20, 0, 20].map((x, k) => cilindro(v(x, 80, 8), 7 + (k % 2) * 2, 18 + (k % 2) * 10, "#dfe8ea", "brillante")),
    ...[-70, -55, -40, 40, 55, 70].map((x) => caja(v(x, 82, 12), v(10, 4, 10), "#cfe3ee", "papel")),
  ];
  return {
    sala: S,
    nodos: [
      { id: "pared", nombre: "Pared de globos azules (R-12 y R-5 en damero)", pieza: { tipo: "mural", mural: pared }, colocacion: EN_LA_PARED },
      { id: "nube-izquierda", nombre: "Nube de globos blancos (izquierda)", pieza: nube(8621), colocacion: libre(-50, 200, Z_NUBES) },
      { id: "nube-derecha", nombre: "Nube de globos blancos (derecha)", pieza: nube(8622), colocacion: libre(127, 204, Z_NUBES) },
      { id: "escenario", nombre: "Falso techo, pedestales con flores, figuras de Jesús y palomas", pieza: escenografia(escenario), colocacion: libre(0, 0, 0) },
      { id: "mesa", nombre: "Mesa blanca de dos pisos con postres", pieza: escenografia(mesa), colocacion: libre(MESA.x, 0, MESA.z) },
    ],
  };
};
const idea862 = idea("primera-comunion-nino", "Primera comunión niño: pared azul con nubes", escena862,
  "Igual: la pared azul del piso al falso techo, celda a celda: 26 × 12 R-12 Fashion Azul a 21 cm en retícula cuadrada y un R-5 azul en la mitad de los 275 huecos, en damero (138), dejando abierta la otra mitad como los rombos claros de la foto (≈ 4,9 × 2,3 m); las dos nubes de globos blancos arriba (28 cada una); los dos pedestales blancos con arreglos de flores, las dos figuras de cartón de Jesús, las dos palomas, el falso techo y la mesa blanca de dos pisos con patas torneadas, la torta, los frascos y los postres. Distinto: el azul mide Neón Azul (ΔE 12) y va Fashion Azul por el tono (200°); la escala sale del alto del falso techo (~2,5 m), sin otra medida segura; las nubes son siluetas de nube rellenas con el motor (R-12 y R-9 que da él); las figuras de cartón, las flores y los postres son escenografía simple; la idea no publica productos.");

// ----------------------------------------------------------------------------------------------------------
// 896 · Rosita Fresita (escena)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 740 × 570 (con marco blanco): la pared roja tiene 7 columnas y 11 filas de R-12 (paso ~30 px, uno junto a otro;
 * 7 filas sobre la mesa y el resto detrás de ella), y en los huecos entre cada cuatro, en damero, un R-5 coral (los
 * otros huecos quedan abiertos); por los lados asoma un R-5 coral en una fila sí y otra no. Con la mesa a 75 cm:
 * ~1,5 px/cm en la pared, R-12 a 22 cm (≈ 1,4 × 2,2 m). Colores medidos (la idea no publica productos): Fashion Rojo
 * (ΔE 13) y, los chicos, Fashion Coral Tropical (ΔE 11). Delante: la mesa con faldón rosado de encaje, la figura de
 * Rosita Fresita, los biombos calados, la fresa gigante de foami, pompones de papel, cortinas y la máquina de crispetas;
 * a la izquierda, un ramo de helio con el corazón metalizado rojo y dos R-12 frambuesa de lunares blancos.
 */
const escena896 = (): Escena => {
  const S = sala(600, 460, 290, { piso: "#e3d3cb", paredes: "#ecd3d0", techo: "#f3e6e4" });
  const COLS = 7, FILAS = 11;
  const chicos: Array<[number, number]> = [];
  for (let f = 0; f < FILAS - 1; f++) for (let c = -1; c < COLS; c++) if ((((f + c) % 2) + 2) % 2 === 1) chicos.push([c + 0.5, f + 0.5]);
  const pared: OpcionesMural = {
    disposicion: "simple", grande: { formatoId: "R-12", infladoCm: 22 }, chico: null,
    matriz: { colores: ["015"], filas: Array.from({ length: FILAS }, () => "a".repeat(COLS)) },
    encima: [{ formatoId: "R-5", infladoCm: 10, codigo: "059", puntos: chicos }],
  };
  const ROSA = "#f6b8cf", BLANCO = "#f7f4f2", ROJO = "#e8322c", VERDE = "#2f9a3e";
  const MESA_Z = -150;
  const mesa: ElementoEscenografia[] = [
    ...mesaConMantel({ anchoCm: 230, fondoCm: 70, altoCm: 75, mantel: ROSA }),
    // Dulceros, la torre fucsia del centro con fresas, las figuritas de la mesa y las flores del faldón.
    caja(v(0, 100, -10), v(16, 50, 16), "#e0399a", "papel"), ...bola(v(0, 130, -10), 9, "#ea3f8f", "papel", 4),
    ...[-70, -40, 40, 70].flatMap((x, k) => [cilindro(v(x, 75, 5), 10, 8 + (k % 2) * 6, "#f0e2e8", "brillante"), ...bola(v(x, 88 + (k % 2) * 6, 5), 5, ROJO, "papel", 4)]),
    panel([[-92, 75], [-78, 75], [-76, 112], [-85, 120], [-94, 112]], -15, 0.6, "#e9524c", "papel"),
    panel([[70, 75], [86, 75], [84, 110], [78, 118], [70, 110]], -15, 0.6, "#f2d04a", "papel"),
    ...[-100, -55, -10, 35, 80].map((x) => panel(ovalo(x, 70, 5, 5, 10), 36, 0.6, "#f5a33a", "papel")),
  ];
  const fresa: ElementoEscenografia[] = [
    ...bola(v(0, 44, 0), 42, ROJO, "brillante", 8, 1.05),
    panel([[-22, 86], [-8, 80], [0, 92], [8, 80], [22, 86], [12, 74], [-12, 74]], 18, 2, VERDE, "mate"),
  ];
  // Rosita Fresita de cartón: vestido rosado, blusa blanca, cabeza, pelo rojo y gorro rosado.
  const rosita: ElementoEscenografia[] = [
    panel([[-8, 0], [8, 0], [6, 40], [-6, 40]], 0, 1, "#f2f2f2", "papel"),
    panel([[-30, 40], [30, 40], [16, 86], [-16, 86]], 0.2, 1, "#f39ab3", "papel"),
    panel([[-14, 86], [14, 86], [12, 104], [-12, 104]], 0.2, 1, BLANCO, "papel"),
    panel(ovalo(0, 122, 24, 24), -0.4, 1, "#d8402e", "papel"), panel(ovalo(0, 120, 15, 16), 0.6, 0.6, "#f6d2b8", "papel"),
    panel(ovalo(0, 142, 26, 10), 1.2, 1, "#f07aa0", "papel"),
  ];
  const biombo = (x: number): ElementoEscenografia => panel([[x - 28, 0], [x + 28, 0], [x + 28, 170], [x - 28, 170]], 0, 3, BLANCO, "madera",
    [0, 1, 2, 3].map((k) => [[x - 18, 20 + k * 38], [x - 18, 46 + k * 38], [x + 18, 46 + k * 38], [x + 18, 20 + k * 38]] as Array<[number, number]>));
  const escenario: ElementoEscenografia[] = [
    biombo(-150), biombo(-92),
    // Pompones de papel fucsia y rojo y las cortinas blancas de corazones.
    ...bola(v(-185, 222, -150), 24, "#f0479a", "papel", 6), ...bola(v(85, 255, -160), 28, "#f0473f", "papel", 6), ...bola(v(235, 210, -150), 26, "#f0479a", "papel", 6),
    caja(v(200, 125, -225), v(50, 250, 2), "#f6eef0", "tela"), caja(v(-245, 125, -225), v(40, 250, 2), "#f6eef0", "tela"),
    // La máquina de crispetas roja sobre su carrito.
    caja(v(250, 40, -170), v(44, 80, 40), "#c8202a", "brillante"), caja(v(250, 105, -170), v(44, 50, 40), "#f3dede", "brillante"), caja(v(250, 133, -170), v(48, 6, 44), "#c8202a", "brillante"),
  ];
  const ramo: Pieza = deco({ tipo: "ramo_helio", propiedades: { globos: [R("R-12", 28, "014"), R("R-12", 28, "014")], alturaCm: 112, cinta: { hex: "#f4f4f4" }, peso: { hex: "#e0399a" } } });
  const corazon: Pieza = { tipo: "metalizado", metalizado: metalizadoDeTienda("corazon-rojo-2", { cinta: { largoCm: 92, hex: "#f4f4f4" } }) };
  return {
    sala: S,
    nodos: [
      { id: "pared", nombre: "Pared de globos rojos con R-5 coral en damero", pieza: { tipo: "mural", mural: pared }, colocacion: { en: "pared", pared: "fondo", aLoLargoCm: 10, alturaCm: 0 } },
      { id: "mesa", nombre: "Mesa con faldón rosado de encaje y dulces", pieza: escenografia(mesa), colocacion: libre(0, 0, MESA_Z) },
      { id: "ramo", nombre: "Ramo de 2 R-12 Fashion Frambuesa (de lunares en la foto)", pieza: ramo, colocacion: libre(-232, 2, -60) },
      { id: "corazon", nombre: "Corazón metalizado rojo con helio", pieza: corazon, colocacion: libre(-246, 0, -70) },
      { id: "rosita", nombre: "Figura de cartón de Rosita Fresita", pieza: escenografia(rosita), colocacion: libre(-165, 0, -60) },
      { id: "fresa", nombre: "Fresa gigante de foami", pieza: escenografia(fresa), colocacion: libre(190, 0, -70) },
      { id: "escenario", nombre: "Biombos, pompones, cortinas y máquina de crispetas", pieza: escenografia(escenario), colocacion: libre(0, 0, 0) },
    ],
  };
};
const idea896 = idea("rosita-fresita", "Rosita Fresita: pared roja con lunares coral", escena896,
  "Igual: la pared roja celda a celda, 7 × 11 R-12 a 22 cm (≈ 1,4 × 2,2 m) con los R-5 coral en damero en los huecos y en los lados (40), dejando abiertos los otros huecos como en la foto; el corazón metalizado rojo de la tienda con su cinta y dos R-12 frambuesa en un ramo de helio a la izquierda; la mesa de 2,3 m con faldón rosado de encaje, los dulceros, la torre fucsia, las figuritas y las flores naranjas; la figura de cartón de Rosita Fresita, los biombos calados, la fresa gigante de foami, los tres pompones de papel, las cortinas y la máquina de crispetas. Distinto: los R-12 del ramo llevan lunares blancos en la foto (la tienda los tiene en rojo y verde lima: van lisos, Fashion Frambuesa medido, ΔE 7); los chicos miden Fashion Coral Tropical (ΔE 11) aunque se ven rosados; la idea no publica productos (colores medidos); figuras, biombos y fresa son escenografía simple.");

// ----------------------------------------------------------------------------------------------------------
// 876 · Ramo de flores en reflex (escena: el ramo amarrado)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 740 × 570 (recorte sobre blanco): los tallos de T-260 miden ~23 px de grueso (≈ 5 cm): 4,6 px/cm. Ramo de 465 ×
 * 520 px (≈ 1 × 1,1 m). Se cuentan 16 flores (13 con el centro plateado a la vista y 3 de canto), de ~105 px (≈ 23 cm):
 * 5 pétalos en lazo de T-260 Reflex Dorado Rosa con un centro plateado (una burbuja de T-260 Reflex Plata), cada una en
 * su tallo de T-260 Reflex Plata; los tallos se juntan en el moño de T-260 Dorado Rosa (dos lazos y dos colas) y siguen
 * por debajo, abriéndose un poco. La raíz es el moño (no lleva globos: lo demás queda donde se pide, a la medida de la
 * foto); cada flor va en la punta de su tallo, mirando hacia fuera del ramo.
 */
const escena876 = (): Escena => {
  const S = sala(300, 280, 240, { piso: "#f2f2f2", paredes: "#ffffff", techo: "#ffffff" });
  const MONO = v(0, 80, 0);
  const TALLO = { formatoId: "T-260", grosorCm: 4.5, codigo: "981" };
  // Cada flor: (x, y) en la foto respecto al moño (px → cm), su fondo z y hacia dónde mira.
  const FLORES: ReadonlyArray<{ px: number; py: number; z: number; mira: Vec3 }> = [
    { px: 345, py: 35, z: -15, mira: v(0, 1, -0.2) }, { px: 290, py: 52, z: -8, mira: v(-0.3, 1, 0) }, { px: 405, py: 50, z: -10, mira: v(0.2, 1, -0.1) },
    { px: 330, py: 95, z: 8, mira: v(0, 0.6, 0.8) }, { px: 440, py: 120, z: 6, mira: v(0.2, 0.5, 0.8) }, { px: 518, py: 126, z: -4, mira: v(0.6, 0.6, 0.3) },
    { px: 553, py: 137, z: -14, mira: v(0.85, 0.4, -0.1) }, { px: 190, py: 108, z: -6, mira: v(-0.6, 0.6, 0.3) }, { px: 217, py: 135, z: 6, mira: v(-0.3, 0.4, 0.85) },
    { px: 122, py: 172, z: -2, mira: v(-0.9, 0.3, 0.2) }, { px: 285, py: 195, z: 14, mira: v(0, 0.3, 1) }, { px: 400, py: 200, z: 16, mira: v(0.05, 0.2, 1) },
    { px: 185, py: 255, z: 10, mira: v(-0.5, 0, 0.85) }, { px: 130, py: 215, z: 8, mira: v(-0.9, -0.1, 0.4) }, { px: 215, py: 288, z: 4, mira: v(-0.4, -0.4, 0.8) },
    { px: 540, py: 178, z: 6, mira: v(0.8, 0.2, 0.5) },
  ];
  const flor876 = deco(florTubito(lazos("T-260", 4.5, ["968"], 5, 10.5, 7, 15, 0), null, burbujas("T-260", 5, ["981"], 1, 5, 90, 0)));
  const nodos: NodoEscena[] = [
    { id: "mono", nombre: "Moño de T-260 Reflex Dorado Rosa", pieza: deco(mono({ formatoId: "T-260", grosorCm: 4.5, codigo: "968", lazosPorLado: 1, largoLazoCm: 13, anchoLazoCm: 8, aberturaGrados: 0, colas: true, largoColaCm: 22, centro: null })), colocacion: libre(MONO.x, MONO.y, MONO.z) },
  ];
  FLORES.forEach((f, i) => {
    const cabeza = v(r2((f.px - 385) / 4.6), r2((330 - f.py) / 4.6), f.z);
    const d = unitario(cabeza);
    // El tallo: del moño a la flor y lo mismo por debajo del moño (se cruzan en el amarre, como en la foto).
    const L = r2(largo(cabeza) - 4);
    nodos.push(tallo(`tallo-${i + 1}`, `Tallo de T-260 Reflex Plata ${i + 1}`, "mono", TALLO, v(0, 0, 0), d, L));
    nodos.push(sobreCentrada(`flor-${i + 1}`, `Flor de 5 pétalos Reflex Dorado Rosa ${i + 1}`, "mono", flor876, cabeza, f.mira));
  });
  return { sala: S, nodos };
};
const idea876 = idea("ramo-de-flores-en-reflex", "Ramo de flores de tubito en reflex", escena876,
  "Igual: el ramo de ~1 × 1,1 m con 16 flores contadas (13 con el centro a la vista y 3 de canto) de 5 pétalos en lazo de T-260 Reflex Dorado Rosa y centro de T-260 Reflex Plata, cada una en su tallo de T-260 Reflex Plata, todos amarrados con el moño de T-260 Dorado Rosa de dos lazos y dos colas y abiertos por debajo, con los 2 productos que publica la idea. Distinto: la ficha dice ~20 flores y la foto deja ver 16; cada tallo baja por debajo del moño lo mismo que sube (en la foto los de abajo son algo más cortos y parejos); el centro plateado de la foto es más redondo (aquí una burbuja de tubito); los tubitos se cuentan por largo con el desperdicio de cada lazo (en la práctica una flor sale de un solo tubito); no hay estructura de globos: el moño es la raíz.", [
  P("GLOBO TUBITO REFLEX DORADO ROSA", "/products/globo-para-fiesta-latex-tubito-reflex-dorado-rosa", "T-260", "968"),
  P("GLOBO TUBITO REFLEX PLATA", "/products/globo-para-fiesta-latex-tubito-reflex-plata", "T-260", "981"),
]);

// ----------------------------------------------------------------------------------------------------------
// 899 · San Valentín (topiario)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 1000 × 1000 (recorte): el tallo trenzado de T-260 dorado mide ~45 px de grueso (≈ 11 cm, como el de #380):
 * 4,1 px/cm; alto 925 px ≈ 2,25 m. De abajo arriba: un cuarteto de R-12 Reflex Fucsia (~105 px ≈ 26 cm), el tallo
 * trenzado de T-260 Reflex Dorado hasta la flor grande (centro a ~1,74 m): 5 pétalos de R-12 Fashion Frambuesa (~28 cm)
 * con un lazo de T-260 dorado de ~46 cm alrededor de cada uno, una corona de 5 R-5 Reflex Fucsia (~11 cm) y un R-5
 * dorado al centro. Abajo, 8 florecitas de tubito (3 rojas de 9 pétalos y 5 fucsia de 8, de ~24 cm, con centro de
 * burbujitas doradas) en ramitas de T-260 dorado que salen de la base. Colores: los publicados; las florecitas rojas no
 * están publicadas y miden Fashion Rojo (ΔE 10; el Metal Rojo, ΔE 8, queda a menos de 6 y se toma el Fashion).
 */
const escena899 = (): Escena => {
  const S = sala(380, 340, 300, { piso: "#efeceb", paredes: "#f7f6f4", techo: "#ffffff" });
  const Y0 = 22;
  const en = (x: number, y: number, z: number) => v(x, y - Y0, z);
  const tallo899: Pieza = { tipo: "letras", letras: { texto: "I", altoCm: 152, grosorCm: 11, disposicion: "fila", tecnica: "tubito", formatoId: "T-260", infladoCm: 5, colores: ["970"], patron: "un_color" } };
  const florGrande = deco(flor({ petalos: { ...R("R-12", 28, "014"), cantidad: 5, aperturaGrados: 0, giroGrados: 18 }, corona: { ...R("R-5", 11, "912"), cantidad: 5 }, centro: { ...R("R-5", 7, "970"), cantidad: 1 } }));
  const lazosOro = deco(florTubito(lazos("T-260", 4.5, ["970"], 5, 46, 26, 0, 18)));
  const RAMA = { formatoId: "T-260", grosorCm: 4, codigo: "970" };
  const centroOro = burbujas("T-260", 3, ["970"], 4, 3, 60, 0);
  const florecita = (codigo: string, petalos: number) => deco(florTubito(burbujas("T-260", 4.5, [codigo], petalos, 11, 8, 0), null, centroOro));
  // Las florecitas: (x, y) en la foto → cm del eje y del piso (4,1 px/cm, eje en x = 510 px, piso en y = 975 px).
  const FLORECITAS: ReadonlyArray<{ id: string; nombre: string; px: number; py: number; z: number; codigo: string; petalos: number; rama: boolean }> = [
    { id: "roja-derecha", nombre: "Florecita roja (derecha, arriba)", px: 660, py: 630, z: 2, codigo: "015", petalos: 9, rama: true },
    { id: "roja-izquierda", nombre: "Florecita roja (izquierda)", px: 358, py: 690, z: 0, codigo: "015", petalos: 9, rama: true },
    { id: "roja-centro", nombre: "Florecita roja (al centro, sobre la base)", px: 485, py: 765, z: 14, codigo: "015", petalos: 9, rama: false },
    { id: "fucsia-arriba", nombre: "Florecita fucsia (arriba a la izquierda)", px: 420, py: 660, z: -6, codigo: "012", petalos: 8, rama: true },
    { id: "fucsia-izquierda", nombre: "Florecita fucsia (izquierda, abajo)", px: 305, py: 800, z: 6, codigo: "012", petalos: 8, rama: true },
    { id: "fucsia-base-izquierda", nombre: "Florecita fucsia (sobre la base, izquierda)", px: 405, py: 860, z: 18, codigo: "012", petalos: 8, rama: false },
    { id: "fucsia-base-derecha", nombre: "Florecita fucsia (sobre la base, derecha)", px: 510, py: 845, z: 20, codigo: "012", petalos: 8, rama: false },
    { id: "fucsia-derecha", nombre: "Florecita fucsia (derecha, abajo)", px: 668, py: 800, z: 6, codigo: "012", petalos: 8, rama: true },
  ];
  const nodos: NodoEscena[] = [
    { id: "tallo", nombre: "Tallo trenzado de T-260 Reflex Dorado", pieza: tallo899, colocacion: libre(0, Y0, 0) },
    // La base: 4 R-12 en anillo acostado alrededor del pie del tallo (una decoración suya, no otra estructura).
    sobreCentrada("base", "Base de 4 R-12 Reflex Fucsia", "tallo", deco(flor({ petalos: { ...R("R-12", 26, "912"), cantidad: 4, aperturaGrados: 10, giroGrados: 45 }, centro: null })), en(0, 14, 0)),
    sobreCentrada("lazos-flor", "Lazos de T-260 dorado de la flor grande", "tallo", lazosOro, en(0, 174, -3), AL_FRENTE),
    sobreCentrada("flor-grande", "Flor de 5 R-12 Fashion Frambuesa con corona Reflex Fucsia", "tallo", florGrande, en(0, 174, 4), AL_FRENTE),
  ];
  for (const f of FLORECITAS) {
    const cabeza = en(r2((f.px - 510) / 4.1), r2((975 - f.py) / 4.1), f.z);
    if (f.rama) {
      // La ramita sale de lo alto de la base (a ~30 cm del piso) y llega a la flor.
      const desde = en(r2(Math.sign(cabeza.x) * 6), 32, 6);
      const hasta = menos(cabeza, por(unitario(menos(cabeza, desde)), 4));
      nodos.push(varita(`rama-${f.id}`, `Ramita de T-260 dorado (${f.nombre.toLowerCase()})`, "tallo", RAMA, desde, hasta));
    }
    nodos.push(sobreCentrada(`flor-${f.id}`, f.nombre, "tallo", florecita(f.codigo, f.petalos), cabeza, unitario(v(cabeza.x * 0.01, 0.35, 1))));
  }
  return { sala: S, nodos };
};
const idea899 = idea("san-valentin", "San Valentín: topiario de flor frambuesa con tallo trenzado", escena899,
  "Igual: el topiario de ~2,25 m: el tallo trenzado de T-260 Reflex Dorado (11 cm de grueso), la base de 4 R-12 Reflex Fucsia, la flor grande de 5 R-12 Fashion Frambuesa con su lazo de T-260 dorado de ~46 cm alrededor de cada pétalo, la corona de 5 R-5 Reflex Fucsia y el R-5 dorado al centro, y abajo las 8 florecitas de tubito contadas (3 rojas de 9 pétalos y 5 fucsia de 8, con centro de burbujitas doradas), 5 en ramitas de T-260 dorado y 3 sobre la base, con los 4 productos que publica la idea. Distinto: las ramitas de la foto llevan nuditos en los codos (aquí rectas); los pétalos de la flor grande son algo ovalados en la foto; las florecitas rojas no están publicadas (Fashion Rojo, medido) y las fucsia miden Neón Fucsia (ΔE 2) pero va el Fashion Fucsia publicado; el R-5 de la corona va Reflex Fucsia (la idea lo publica en redondo, sin talla).", [
  P("GLOBO REDONDO FASHION FRAMBUESA", "/products/globo-para-fiesta-latex-redondo-fashion-frambuesa", "R-12", "014"),
  P("GLOBO TUBITO REFLEX DORADO", "/products/globo-para-fiesta-latex-tubito-reflex-dorado", "T-260", "970"),
  P("GLOBO TUBITO FASHION FUCSIA", "/products/globo-para-fiesta-latex-tubito-fashion-fucsia", "T-260", "012"),
  P("GLOBO REDONDO REFLEX FUCSIA", "/products/globo-para-fiesta-latex-redondo-reflex-fucsia", "R-12", "912"),
]);

// ----------------------------------------------------------------------------------------------------------
// 929 · Temporada de sustos (pared de Frankenstein)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 1000 × 1000 (recorte): los R-5 de las cadenitas miden ~24 px (≈ 6 cm), los grandes del pelo ~90 px (≈ 22 cm) y
 * los dedos de tubito ~25 px (≈ 5–6 cm): 4 px/cm. La pared: 10 columnas alternadas blanco y negro (empieza blanca a la
 * izquierda) de 10 globos de ~65 px (R-9 a 16 cm; ≈ 1,45 × 1,45 m), cada columna corrida medio globo de la vecina. Encima
 * la cabellera orgánica (~2,1 m: sobresale por los lados) de R-12 cromados verde lima con una cadenita de R-5 que la
 * recorre por delante; abajo del pelo, el corbatín violeta (dos lazos y un R-5 al centro) y dos manos de T-260 neón
 * verde con uñas negras. Colores: los publicados (la pared clara mide Pastel Mate Verde, ΔE 7, pero la idea publica
 * Fashion Blanco; el corbatín mide Fashion Lila, ΔE 11, y va el Reflex Violeta publicado).
 */
const escena929 = (): Escena => {
  const S = sala(380, 300, 280, { piso: "#f2f2f2", paredes: "#ffffff", techo: "#ffffff" });
  const pared: OpcionesMural = {
    disposicion: "simple", grande: { formatoId: "R-9", infladoCm: 16 }, chico: null,
    matriz: { colores: ["005", "080"], filas: Array.from({ length: 10 }, () => "ab".repeat(5)) },
  };
  const Z_PELO = -S.fondoCm / 2 + 29;
  const pelo: TramoOrganico = {
    id: "cabellera", nombre: "Cabellera",
    recorrido: [v(-82, 148, 6), v(-50, 156, 0), v(-16, 160, 4), v(18, 158, 0), v(52, 154, 4), v(84, 146, 6)],
    grosor: [{ t: 0, radioCm: 24 }, { t: 0.5, radioCm: 27 }, { t: 1, radioCm: 24 }],
    mezcla: constante({ "R-12": 0.88, "R-5": 0.12 }), irregularidad: 0.16, tapas: { inicio: true, fin: true },
  };
  const cabellera = organico({
    semilla: 929, tramos: [pelo], inflados: { "R-12": 22, "R-5": 7 }, variacionInflado: 0.08,
    relleno: [{ formatoId: "R-12", infladoCm: 18, trios: false }],
    colores: [colorOrg("931", 3), colorOrg("230", 0.6, ["R-12"])], suelo: true, huecosFlores: 0, vista: AL_FRENTE,
  });
  const cadenita: Pieza = {
    tipo: "guirnalda",
    guirnalda: { formatoId: "R-5", infladoCm: 6.5, patron: "un_color", colores: ["931"], anchoCm: 0, caidaCm: 0, recorrido: [{ x: -84, y: 140 }, { x: -66, y: 150 }, { x: -48, y: 139 }, { x: -30, y: 152 }, { x: -11, y: 141 }, { x: 8, y: 153 }, { x: 26, y: 141 }, { x: 44, y: 151 }, { x: 62, y: 138 }, { x: 80, y: 146 }] },
  };
  const mano = (giroGrados: number): Pieza => deco({ tipo: "mano", propiedades: { formatoId: "T-260", grosorCm: 5, codigo: "230", dedos: 5, largoDedoCm: 30, aberturaGrados: 8, garra: true, giroGrados } });
  const corbatin = deco(mono({ formatoId: "T-260", grosorCm: 5, codigo: "951", lazosPorLado: 1, largoLazoCm: 20, anchoLazoCm: 13, aberturaGrados: 0, colas: false, largoColaCm: 0, centro: R("R-5", 7.5, "951") }));
  return {
    sala: S,
    nodos: [
      { id: "pared", nombre: "Pared de rayas blancas y negras", pieza: { tipo: "mural", mural: pared }, colocacion: EN_LA_PARED },
      sobre("mano-izquierda", "Mano de T-260 neón verde (izquierda)", "pared", mano(-8), v(-28, 92, 9), AL_FRENTE, 180),
      sobre("mano-derecha", "Mano de T-260 neón verde (derecha)", "pared", mano(8), v(22, 87, 9), AL_FRENTE, 180),
      sobre("corbatin", "Corbatín de T-260 Reflex Violeta", "pared", corbatin, v(12, 126, 9), AL_FRENTE),
      { id: "cabellera", nombre: "Cabellera orgánica verde lima", pieza: cabellera, colocacion: libre(0, 0, Z_PELO) },
      { id: "cadenita", nombre: "Cadenita de R-5 verde lima del pelo", pieza: cadenita, colocacion: libre(0, 0, Z_PELO + 26) },
    ],
  };
};
const idea929 = idea("temporada-de-sustos", "Temporada de sustos: pared de Frankenstein", escena929,
  "Igual: la pared de 10 columnas alternadas blanca y negra de 10 globos (R-9 a 16 cm; ≈ 1,45 × 1,45 m), con la cabellera orgánica de R-12 cromados Reflex Verde Lima (y algunos Neón Verde) que sobresale por los lados, la cadenita de R-5 verde lima que la recorre por delante, el corbatín de T-260 Reflex Violeta con su R-5 al centro y las dos manos de T-260 Neón Verde que cuelgan de la pared, con los 6 productos que publica la idea. Distinto: en la foto cada columna va corrida medio globo de la vecina (aquí en retícula cuadrada); la pared clara mide Pastel Mate Verde (ΔE 7) y va el Fashion Blanco publicado; las uñas negras de las manos no van y la muñeca sube hacia el pelo; el corbatín de la foto tiene los lazos más llenos; la cadenita de la foto se mete y sale del pelo a tramos (aquí corrida por delante); los globos de la cabellera los da el motor.", [
  P("GLOBO REDONDO REFLEX VERDE LIMA", "/products/globo-para-fiesta-latex-redondo-reflex-verde-lima", "R-12", "931"),
  P_VIOLETA,
  P("GLOBO REDONDO NEON VERDE", "/products/globo-para-fiesta-latex-redondo-neon-verde", "R-12", "230"),
  P("GLOBO TUBITO NEON VERDE", "/products/globo-para-fiesta-latex-tubito-neon-verde", "T-260", "230"),
  P_BLANCO, P_NEGRO,
]);


/** Ideas de fiesta de sempertex.com digitalizadas: lote 12. */
export const LOTE_12: readonly IdeaDigitalizada[] = [idea640, idea654, idea705, idea795, idea847, idea862, idea876, idea896, idea899, idea929];
