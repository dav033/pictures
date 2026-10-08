import { ideaPerezosa, type IdeaDigitalizada, type ProductoDeIdea } from "./tipos";
import { armarEscena, HUNDIMIENTO_SOBRE_CM, SALA_INICIAL, type Colocacion, type Escena, type NodoEscena, type Sala } from "../escena";
import { armarPieza, type Pieza } from "../piezas";
import { formatoPorId } from "../formatos";
import { GLOBOS_TIENDA, productoDeGlobo } from "../productos-tienda";
import { mesaConMantel, tapete, type ElementoEscenografia } from "../escenografia";
import { banderin, letrero, platos, servilletas, vasos } from "../utileria";
import { opcionesAroOrganico, opcionesArcoRectangular, opcionesRacimosLibres, opcionesTroncoConBase, type RacimoLibre } from "../estructuras-organicas";
import { formaColumna, type ColorOrganico, type OpcionesOrganico, type PuntoMezcla, type RellenoOrganico } from "../organico";
import type { PatronColumna } from "../columnas";
import type { ParteGlobo, PropiedadesFlor } from "../decoraciones";
import type { AnilloTubito, Decoracion } from "../figuras";
import type { EstiloOjo, PropiedadesArana, PropiedadesCalabaza } from "../halloween";
import type { PropiedadesRizo } from "../rizos";
import type { ColorMetalizado, FormaMetalizado } from "../metalizados";
import { impresoPorId, impresoPorUrl, type ImpresoEnPieza } from "../impresos-catalogo";
import type { Vec3 } from "../modulos";

/**
 * Ideas de fiesta de sempertex.com digitalizadas: **lote 11** (los números de `clasif/lote-11.json`: 7 escenas —la mesa
 * de M&M, los corazones brillantes, los corazones surtidos, el año nuevo, la mesa de Halloween con columnas de techo,
 * El Principito y la fiesta de Halloween— y 3 estructuras sueltas —el arco mundialista, el árbol y la columna
 * metalizada—, todas como escena con su sala).
 *
 * Cómo se hizo (2026-10-08), idea por idea, con su foto (`fotos/<slug>--0.*`) abierta, recortada, ampliada y con más
 * contraste:
 * - **Conteo**: globos, cuartetos, collares, estrellas, arañas e impresos contados en la foto (con manchas de color por
 *   HSV donde se puede: los nudos de la malla de M&M, las estrellas de El Principito). Ninguna idea del lote publica
 *   «Materiales» con cantidades: todo lo contado va con `contada: true`. En lo orgánico el motor da los globos para el
 *   grosor y el largo medidos (no se cuentan uno a uno: la nota lo dice).
 * - **Medidas**: la escala sale de algo de tamaño conocido en la misma foto (la mesa de 76–80 cm, una baldosa de 40 cm,
 *   el R-24 impreso, el R-12 de estructura a ~25 cm, el T-260 a 5 cm) y con ella alturas, anchos y tamaños. Cuando la
 *   foto tiene perspectiva (la mesa delante, la pared detrás) se corrige con la profundidad.
 * - **Colores**: si la idea publica productos, se usan ESOS códigos (aunque la foto mida otra cosa: la nota lo dice).
 *   Si no, se midió en la foto (Python/PIL: mediana de un parche sin brillos, con balance de blancos contra la pared
 *   blanca cuando la foto viene gris; ΔE76 en Lab contra `hexGlobo` de la tabla oficial) y se tomó el código más
 *   cercano que se fabrica en ese formato. Los cromados engañan (reflejan lo de alrededor): se dice.
 * - **Impresos**: si la tienda lo tiene (`impresos-catalogo.ts`: Corazones Brillantes, Feliz Año Estrellas, Balón de
 *   Fútbol en R-24, Futbolmanía, Araña Metalink, Happy Halloween), el globo lo lleva sobre su látex (en un surtido, el
 *   color del surtido más cercano al medido); si no, va el liso de su fondo y la nota lo dice.
 * - **Jerarquía**: cada estructura es una raíz y lo suyo cuelga de ella (`sobre`): «esta estructura con sus
 *   decoraciones» y «esta decoración sola». En las columnas que cuelgan del techo la raíz es el collar de arriba y los
 *   módulos (un globo negro y un collar de R-5) y la araña van `sobre` él, a la altura medida. Las partes de un arco de
 *   colores por tramos (el mundialista) y la copa del árbol son piezas propias colgadas de la raíz: el motor orgánico
 *   reparte los colores en toda la pieza, no por tramo. La escenografía (mesas, cortinas, utilería) va aparte.
 * Unidades: cm. Espacio de cada escena: y arriba, +z hacia quien mira; los puntos `sobre` van en el espacio local del
 * padre.
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
const r2 = (x: number) => Math.round(x * 100) / 100 + 0;
const redondo = (p: Vec3): Vec3 => v(r2(p.x), r2(p.y), r2(p.z));
const rad = (g: number) => (g * Math.PI) / 180;
const ARRIBA = v(0, 1, 0);
const AL_FRENTE = v(0, 0, 1);

const R = (formatoId: string, infladoCm: number, codigo: string): ParteGlobo => ({ formatoId, infladoCm, codigo });
const PISO: Colocacion = { en: "piso", xCm: 0, zCm: 0, giroGrados: 0 };
const libre = (xCm: number, yCm: number, zCm: number, giroGrados = 0): Colocacion => ({ en: "libre", xCm: r2(xCm), yCm: r2(yCm), zCm: r2(zCm), giroGrados });
const enPiso = (xCm: number, zCm: number, giroGrados = 0): Colocacion => ({ en: "piso", xCm: r2(xCm), zCm: r2(zCm), giroGrados });
const enTecho = (xCm: number, zCm: number, cuelgaCm: number): Colocacion => ({ en: "techo", xCm: r2(xCm), zCm: r2(zCm), cuelgaCm: r2(cuelgaCm), giroGrados: 0, volteada: false });
const sala = (anchoCm: number, fondoCm: number, altoCm: number, tonos?: Partial<Sala["tonos"]>): Sala =>
  ({ ...structuredClone(SALA_INICIAL), anchoCm, fondoCm, altoCm, tonos: { ...SALA_INICIAL.tonos, ...tonos } });

/** Un globo suelto; con `impresoId`, con el impreso de la tienda sobre su látex. */
const globo = (g: ParteGlobo, impresoId?: string): Pieza =>
  ({ tipo: "globo", formatoId: g.formatoId, infladoCm: g.infladoCm, codigo: g.codigo, ...(impresoId ? { impresos: [{ impresoId, codigo: g.codigo }] } : {}) });

/** Una columna de cuartetos de `niveles` niveles (la trenza de Sempertex: un nivel cada 0,8 diámetros). */
function columna(formatoId: string, infladoCm: number, niveles: number, colores: string[], patron: PatronColumna = "un_color", impresos?: ImpresoEnPieza[]): Pieza {
  return { tipo: "columna", formatoId, infladoCm, alturaCm: r2(niveles * infladoCm * 0.8), patron, colores, ...(impresos?.length ? { impresos } : {}) };
}

const deco = (decoracion: Decoracion): Pieza => ({ tipo: "decoracion", decoracion });
const flor = (p: PropiedadesFlor): Decoracion => ({ tipo: "flor", propiedades: p });
/** Un anillo de `cantidad` globos iguales alrededor de un centro (collar de R-5, par de R-12). */
const anillo = (g: ParteGlobo, cantidad: number, aperturaGrados = 0, giroGrados = 0): Decoracion =>
  flor({ petalos: { ...g, cantidad, aperturaGrados, giroGrados }, centro: null });
const lazos = (formatoId: string, grosorCm: number, codigos: string[], cantidad: number, largoCm: number, anchoCm: number, aperturaGrados: number, giroGrados: number): AnilloTubito =>
  ({ formatoId, grosorCm, codigos, cantidad, estilo: "lazo", largoCm, anchoCm, aperturaGrados, giroGrados });
const burbujas = (formatoId: string, grosorCm: number, codigos: string[], cantidad: number, largoCm: number, aperturaGrados: number, giroGrados: number): AnilloTubito =>
  ({ formatoId, grosorCm, codigos, cantidad, estilo: "burbuja", largoCm, anchoCm: grosorCm, aperturaGrados, giroGrados });
const florTubito = (petalos: AnilloTubito, centro: ParteGlobo | null = null): Decoracion =>
  ({ tipo: "flor_tubito", propiedades: { petalos, interior: null, corona: null, centro } });
const rizo = (p: PropiedadesRizo): Decoracion => ({ tipo: "rizo", propiedades: p });
const arana = (p: PropiedadesArana): Decoracion => ({ tipo: "arana", propiedades: p });
const metalizado = (forma: FormaMetalizado, pulgadas: number, color: ColorMetalizado, extra: { impreso?: { dibujo: "texto" | "estrellas"; texto?: string; hex?: string } } = {}): Pieza =>
  ({ tipo: "metalizado", metalizado: { forma, pulgadas, color, ...(extra.impreso ? { impreso: extra.impreso } : {}) } });

/** La pieza como la arma `sobre`: una decoración, sin «de frente». */
const comoSobre = (pieza: Pieza): Pieza => (pieza.tipo === "decoracion" && pieza.deFrente ? { tipo: "decoracion", decoracion: pieza.decoracion } : pieza);

/**
 * Una pieza `sobre` un padre SIN globos donde se apoya (o lejos de sus globos): `sobre` no encuentra cuerpos y deja su
 * espalda a `HUNDIMIENTO_SOBRE_CM` antes del punto, así que el origen de la pieza queda exactamente en `origen`
 * (espacio local del padre), con su +y hacia `normal`. Si debajo (contra la normal) hay globos del padre, se apoya en
 * ellos: es lo que se quiere cuando la pieza descansa sobre la estructura.
 */
function sobreEn(id: string, nombre: string, padreId: string, pieza: Pieza, origen: Vec3, normal: Vec3 = ARRIBA, giroGrados = 0): NodoEscena {
  const n = unitario(normal);
  const punto = mas(origen, por(n, armarPieza(comoSobre(pieza)).caja.min.y + HUNDIMIENTO_SOBRE_CM));
  return { id, nombre, pieza, colocacion: { en: "sobre", padreId, puntoCm: redondo(punto), normal: redondo(n), giroGrados } };
}

/**
 * Como `sobreEn`, con el centro de la caja de la pieza en `centro` (espacio local del padre). Solo para normales sin
 * giro del padre (padres de pie, sin girar): con la normal hacia arriba la caja no gira; con la normal al frente, su
 * +y va a +z y su +z a −y (el marco de `escena.ts`).
 */
function sobreCentrada(id: string, nombre: string, padreId: string, pieza: Pieza, centro: Vec3, normal: Vec3 = ARRIBA, giroGrados = 0): NodoEscena {
  const c = armarPieza(comoSobre(pieza)).caja;
  const medio = por(mas(c.min, c.max), 0.5);
  const n = unitario(normal);
  // El marco de `sobre`: +y local hacia la normal; x local horizontal (cruz de un auxiliar con la normal).
  const aux = Math.abs(n.y) < 0.9 ? ARRIBA : v(1, 0, 0);
  const xL = unitario(cruz(aux, n));
  const zL = cruz(n, xL);
  const cG = Math.cos(rad(giroGrados)), sG = Math.sin(rad(giroGrados));
  const mx = medio.x * cG - medio.z * sG, mz = medio.x * sG + medio.z * cG;
  const enMundo = mas(mas(por(xL, mx), por(n, medio.y)), por(zL, mz));
  return sobreEn(id, nombre, padreId, pieza, menos(centro, enMundo), normal, giroGrados);
}

/** Una caja de escenografía. */
const caja = (centro: Vec3, tamano: Vec3, hex: string, acabado: ElementoEscenografia["acabado"] = "mate", giroGrados = 0): ElementoEscenografia =>
  ({ forma: "caja", centro: redondo(centro), tamano: redondo(tamano), hex, acabado, ...(giroGrados ? { giroGrados } : {}) });
const cilindro = (base: Vec3, radioCm: number, altoCm: number, hex: string, acabado: ElementoEscenografia["acabado"] = "mate", radioArribaCm?: number): ElementoEscenografia =>
  ({ forma: "cilindro", base: redondo(base), radioCm: r2(radioCm), altoCm: r2(altoCm), hex, acabado, ...(radioArribaCm !== undefined ? { radioArribaCm: r2(radioArribaCm) } : {}) });
/** Una bola (flor, fruta, cupcake) hecha de cilindros apilados. */
function bola(centro: Vec3, radioCm: number, hex: string, acabado: ElementoEscenografia["acabado"] = "papel", tramos = 6): ElementoEscenografia[] {
  const salida: ElementoEscenografia[] = [];
  for (let i = 0; i < tramos; i++) {
    const a0 = -Math.PI / 2 + (Math.PI * i) / tramos, a1 = -Math.PI / 2 + (Math.PI * (i + 1)) / tramos;
    salida.push(cilindro(v(centro.x, centro.y + radioCm * Math.sin(a0), centro.z), Math.max(0.3, radioCm * Math.cos(a0)), radioCm * (Math.sin(a1) - Math.sin(a0)), hex, acabado, Math.max(0.3, radioCm * Math.cos(a1))));
  }
  return salida;
}
/** Un tablón inclinado (brazo, cinta): una caja con su propio marco, de `desde` a `hasta`. */
function tablon(desde: Vec3, hasta: Vec3, anchoCm: number, gruesoCm: number, hex: string, acabado: ElementoEscenografia["acabado"] = "mate"): ElementoEscenografia {
  const d = menos(hasta, desde);
  const x = unitario(d);
  const y = unitario(Math.abs(x.y) < 0.95 ? cruz(AL_FRENTE, x) : cruz(x, v(1, 0, 0)));
  return { forma: "caja", centro: v(r2(largo(d) / 2), 0, 0), tamano: v(r2(largo(d)), r2(gruesoCm), r2(anchoCm)), hex, acabado, en: { origen: redondo(desde), ejeX: redondo(x), ejeY: redondo(y) } };
}
/** Un disco de frente (cara de un recorte, plato colgado): panel circular de radio `radioCm` en el plano z. */
const disco = (cx: number, cy: number, radioCm: number, zCm: number, hex: string, acabado: ElementoEscenografia["acabado"] = "papel", motivo?: ElementoEscenografia["motivo"], achatado = 1): ElementoEscenografia =>
  ({ forma: "panel", contorno: Array.from({ length: 32 }, (_, i) => ({ x: r2(cx + radioCm * Math.cos((2 * Math.PI * i) / 32)), y: r2(cy + radioCm * achatado * Math.sin((2 * Math.PI * i) / 32)) })), zCm: r2(zCm), grosorCm: 1, hex, acabado, ...(motivo ? { motivo } : {}) });
/** Cortina de flecos metalizados: tiras finas de `desde` (x) a `hasta`, de `arriba` a `abajo`, en el plano z. */
function flecos(desdeX: number, hastaX: number, arriba: number, abajo: number, zCm: number, hex: string, pasoCm = 2.2): ElementoEscenografia[] {
  const n = Math.max(1, Math.round((hastaX - desdeX) / pasoCm));
  return Array.from({ length: n }, (_, i) => {
    const x = desdeX + (i + 0.5) * ((hastaX - desdeX) / n);
    const corto = (i * 37) % 7; // las puntas desparejas
    return caja(v(x, (arriba + abajo + corto) / 2, zCm + ((i % 3) - 1) * 0.6), v(1.6, arriba - abajo - corto, 0.2), hex, "foil");
  });
}
const escenografia = (elementos: ElementoEscenografia[]): Pieza => ({ tipo: "escenografia", elementos });

/** Colores de una pieza orgánica (pesos relativos; `formatos` limita en qué globos va cada color). */
const colorOrg = (codigo: string, peso: number, formatos?: string[]): ColorOrganico => ({ codigo, peso, ...(formatos ? { formatos } : {}) });
const organico = (opciones: OpcionesOrganico, impresos?: ImpresoEnPieza[]): Pieza => ({ tipo: "organico", opciones, flores: null, ...(impresos?.length ? { impresos } : {}) });
const constante = (pesos: Readonly<Record<string, number>>): PuntoMezcla[] => [{ t: 0, pesos }, { t: 1, pesos }];

/**
 * Los colores de una pieza orgánica por fracción DENTRO de cada formato (lo contado en la foto: «7 de cada 90 R-12 son
 * impresos rojizos»). El motor reparte por cuotas sobre el total de globos; como la geometría no depende de los colores,
 * se arma una vez para contar cuántos globos salen de cada formato y cada fracción se vuelve un peso sobre el total.
 */
function coloresPorFormato(opciones: OpcionesOrganico, reparto: Readonly<Record<string, ReadonlyArray<readonly [string, number]>>>): ColorOrganico[] {
  const cuenta = new Map<string, number>();
  for (const g of armarPieza({ tipo: "organico", opciones: { ...opciones, colores: [colorOrg("005", 1)] }, flores: null }).globos) cuenta.set(g.formatoId, (cuenta.get(g.formatoId) ?? 0) + 1);
  return Object.entries(reparto).flatMap(([formatoId, colores]) => {
    const total = colores.reduce((s, [, f]) => s + f, 0);
    return colores.map(([codigo, f]) => colorOrg(codigo, r2(((cuenta.get(formatoId) ?? 0) * f) / total) || 0.01, [formatoId]));
  });
}

/** Ojos de calcomanía (blanco con pupila negra) de los globos-ojo. */
const OJO_SALTON: EstiloOjo = { iris: null, pupila: { hex: "#111111", proporcion: 0.42 }, brillo: true, venas: null };

// ----------------------------------------------------------------------------------------------------------
// Productos
// ----------------------------------------------------------------------------------------------------------

const quitarOrigen = (url: string) => url.replace(/^https:\/\/sempertex\.com/, "");

/** El liso de la tienda para un formato y un código (nombre y url relativa exactos), con la cantidad contada. */
function liso(formatoId: string, codigo: string, cantidad: number): ProductoDeIdea {
  const tipo = formatoPorId(formatoId)?.tipo ?? "redondo";
  const fila = GLOBOS_TIENDA.find((p) => p.tipo === tipo && p.codigo === codigo);
  const p = fila ? { nombre: fila.nombre, url: fila.url } : (() => { const x = productoDeGlobo(formatoId, codigo); return { nombre: x.nombre, url: quitarOrigen(x.url) }; })();
  return { nombre: p.nombre, url: p.url, formato: formatoId, codigo, cantidad, contada: true };
}

/** Un producto que la idea publica (nombre, url y código tal cual; el formato, el de la foto). */
type Publicado = { nombre: string; url: string; formato: string | null; codigo: string | null };

const clave = (formatoId: string, codigo: string) => `${formatoId}|${codigo}`;

/**
 * Los productos de lo armado: primero los que publica la idea (con la cantidad del 3D, que es la contada en la foto; sin
 * cantidad si la foto no los muestra), luego los impresos de la tienda que lleva el 3D y los lisos del resto. Un impreso
 * va con el formato y el código de su látex (el color del globo), así cada línea del 3D cuadra con un producto. Una
 * pieza puede llevar varios impresos (el ramo de año nuevo): se cuenta cada pedido por separado.
 */
function productosDe(contenido: IdeaDigitalizada["contenido"], publicados: readonly Publicado[] = []): ProductoDeIdea[] {
  const escena: Escena = contenido.tipo === "escena" ? contenido.escena : { sala: structuredClone(SALA_INICIAL), nodos: [{ id: "pieza", nombre: "pieza", pieza: contenido.pieza, colocacion: PISO }] };
  const armada = armarEscena(escena);
  const total = new Map<string, number>();
  for (const m of armada.materiales) total.set(clave(m.formatoId, m.codigo), (total.get(clave(m.formatoId, m.codigo)) ?? 0) + m.cantidad);
  // Los globos impresos, por impreso y por látex: cada pedido de cada pieza, armado solo, dice qué globos toma.
  const impresos = new Map<string, Map<string, number>>();
  for (const nodo of escena.nodos) {
    const copias = armada.porNodo.find((n) => n.id === nodo.id)?.copias ?? 0;
    for (const pedido of nodo.pieza.impresos ?? []) {
      const sola = armarPieza({ ...nodo.pieza, impresos: [pedido] });
      const porLatex = impresos.get(pedido.impresoId) ?? new Map<string, number>();
      for (const g of sola.globos.filter((x) => x.estampado?.impreso)) porLatex.set(clave(g.formatoId, g.codigo), (porLatex.get(clave(g.formatoId, g.codigo)) ?? 0) + copias);
      impresos.set(pedido.impresoId, porLatex);
    }
  }
  const impresosPorClave = new Map<string, number>();
  for (const porLatex of impresos.values()) for (const [k, n] of porLatex) impresosPorClave.set(k, (impresosPorClave.get(k) ?? 0) + n);
  const lisos = new Map<string, number>();
  for (const [k, n] of total) { const resto = Math.ceil(n - 1e-9) - (impresosPorClave.get(k) ?? 0); if (resto > 0) lisos.set(k, resto); }

  const salida: ProductoDeIdea[] = [];
  const usados = new Set<string>();
  for (const p of publicados) {
    if (p.codigo === null) {
      const i = impresoPorUrl(p.url);
      const porLatex = i ? impresos.get(i.id) : undefined;
      if (i && porLatex?.size) {
        for (const [k, n] of porLatex) { const [f, c] = k.split("|") as [string, string]; salida.push({ nombre: p.nombre, url: p.url, formato: f, codigo: c, cantidad: n, contada: true }); }
        impresos.delete(i.id);
      } else salida.push({ nombre: p.nombre, url: p.url, formato: p.formato, codigo: null, cantidad: null });
      continue;
    }
    const k = p.formato ? clave(p.formato, p.codigo) : "";
    const n = lisos.get(k);
    if (n && !usados.has(k)) { salida.push({ nombre: p.nombre, url: p.url, formato: p.formato, codigo: p.codigo, cantidad: n, contada: true }); usados.add(k); }
    else salida.push({ nombre: p.nombre, url: p.url, formato: p.formato, codigo: p.codigo, cantidad: null });
  }
  for (const [impresoId, porLatex] of impresos) {
    const i = impresoPorId(impresoId)!;
    for (const [k, n] of porLatex) { const [f, c] = k.split("|") as [string, string]; salida.push({ nombre: i.nombre, url: i.url, formato: f, codigo: c, cantidad: n, contada: true }); }
  }
  for (const [k, n] of lisos) if (!usados.has(k)) { const [f, c] = k.split("|") as [string, string]; salida.push(liso(f, c, n)); }
  return salida;
}

const FOTO = (archivo: string) => `https://sempertex.com/cdn/shop/articles/${archivo}`;
const ESCENA = (escena: Escena): IdeaDigitalizada["contenido"] => ({ tipo: "escena", escena });

/**
 * Base de una idea: id «idea:<slug>» y productos del 3D (con los publicados primero). Perezosa (ver `tipos.ts`): la
 * escena se arma y los productos se cuentan la primera vez que se piden; todas las del lote son escenas.
 */
type Base = Omit<IdeaDigitalizada, "id" | "productos" | "contenido" | "clase"> & { contenido: () => IdeaDigitalizada["contenido"]; publicados?: Publicado[] };
function idea(b: Base): IdeaDigitalizada {
  const { publicados, contenido, ...resto } = b;
  return ideaPerezosa({ id: `idea:${b.slug}`, ...resto, clase: "escena" }, contenido, (c) => productosDe(c, publicados ?? []));
}

// Impresos de la tienda que usa el lote.
const CORAZONES = "infinity-corazones-brillantes-fashion-metal-surtido";
const FELIZ_ANO_R24 = "infinity-feliz-ano-estrellas-fashion-negro";
const FELIZ_ANO_REFLEX = "2-caras-feliz-ano-estrellas-reflex-surtido";
const FELIZ_ANO_ESTRELLAS = "infinity-feliz-ano-estrellas-satin-y-metal-surtido-deluxe";
const BALON = "infinity-balon-de-futbol-fashion-blanco";
const FUTBOLMANIA = "globo-redondo-infinity-futbolmania-blanco";
const ARANA_METALINK = "infinity-arana-metalink-fashion-negro";
const HALLOWEEN_NOCHE = "infinity-happy-halloween-noche-fashion-surtido";

// ----------------------------------------------------------------------------------------------------------
// 458 · Cumpleaños de M&M (escena: malla sobre la mesa de dulces)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 740 × 570: la mesa mide 710 px de largo y 137 px de alto al frente (76 cm: 1,75 px/cm; las baldosas de 40 cm
 * dan lo mismo): 4 m. Detrás, a la altura de las caras de los M&M, la malla: rombos de globos frambuesa con un nudo
 * amarillo en cada cruce (las manchas amarillas: 3 filas a la vista, a 17,5 px una de otra y a 35 px dentro de la fila;
 * el globo mide ~17 px). Va un 12 % más lejos que el frente de la mesa (1,55 px/cm): eslabones de ~11 cm (R-5) y
 * nudos de ~5,5 cm, 4,4 m × ~46 cm, de 1,28 a 1,75 m del piso (con la cámara a ~1,6 m). Los M&M son recortes.
 */
const escena458 = (): Escena => {
  const malla: Pieza = { tipo: "pared_malla", formatoId: "R-5", infladoCm: 11, anchoCm: 440, altoCm: 46, patron: "un_color", colores: ["014"], union: { infladoCm: 5.5, codigo: "020" } };
  const NEGRO = "#2a1712", AMARILLO = "#f2d21a", ALTO = 78;
  // El faldón amarillo con las gotas negras que bajan: el borde de arriba ondula entre 64 cm (entre gotas) y 26 cm (la
  // punta de cada gota); 8 gotas a lo largo de los 4 m (contadas en la foto).
  const gotas = [-176, -128, -78, -24, 32, 92, 140, 186];
  const borde: Array<{ x: number; y: number }> = [];
  for (let x = -202; x <= 202; x += 4) {
    const d = Math.min(...gotas.map((g) => Math.abs(x - g)));
    borde.push({ x, y: r2(d < 14 ? 26 + 38 * (d / 14) ** 2 : 64 - (Math.abs(x * 7) % 5)) });
  }
  const mesa: ElementoEscenografia[] = [
    ...mesaConMantel({ anchoCm: 405, fondoCm: 80, altoCm: ALTO, mantel: NEGRO }),
    { forma: "panel", contorno: [{ x: 202, y: 3 }, ...borde.slice().reverse(), { x: -202, y: 3 }], zCm: 41.2, grosorCm: 0.4, hex: AMARILLO, acabado: "tela" },
    // Los dispensadores de dulces (tubos de colores de ~60 cm) y la fila de dulces del frente.
    ...([[-114, "#f3d22b"], [-76, "#e8402e"], [-23, "#58b947"], [62, "#2d86d6"], [123, "#8b4fb3"], [195, "#3dae49"]] as const).flatMap(([x, hex]) => [
      cilindro(v(x, ALTO, -18), 10, 60, hex, "brillante"), cilindro(v(x, ALTO + 60, -18), 10.5, 4, "#d8d8d8", "metal"),
    ]),
    ...Array.from({ length: 34 }, (_, i) => caja(v(-195 + i * 11.8, ALTO + 3, 22 + (i % 3) * 5), v(8, 6, 6), ["#e8402e", "#f3d22b", "#2d86d6", "#58b947", "#f07a1a", "#6b3a2a"][i % 6]!, "papel")),
    caja(v(-188, ALTO + 15, -5), v(26, 30, 14), "#d8262e", "papel"),
  ];
  // Los dos M&M gigantes (recortes de cartón sobre un palo): el rojo a la izquierda y el naranja a la derecha.
  const mm = (cx: number, cy: number, ancho: number, alto: number, hex: string, brazos: Array<[Vec3, Vec3]>): ElementoEscenografia[] => [
    disco(cx, cy, ancho / 2, 0, hex, "papel", { dibujo: "texto", texto: "m", hex: "#ffffff", escala: 0.35 }, alto / ancho),
    disco(cx - ancho * 0.16, cy + alto * 0.18, ancho * 0.12, 1.2, "#ffffff"), disco(cx + ancho * 0.16, cy + alto * 0.18, ancho * 0.12, 1.2, "#ffffff"),
    cilindro(v(cx, 0, -2), 2.5, cy - alto / 2, "#cfcfcf", "metal"),
    ...brazos.map(([a, b]) => tablon(a, b, 9, 2, "#ffffff", "papel")),
  ];
  const figuras: ElementoEscenografia[] = [
    ...mm(-141, 146, 94, 106, "#e2412a", [[v(-100, 165, 0.5), v(-66, 190, 0.5)], [v(-182, 160, 0.5), v(-222, 168, 0.5)]]),
    ...mm(169, 177, 100, 115, "#f39a1c", [[v(124, 158, 0.5), v(82, 140, 0.5)], [v(214, 185, 0.5), v(232, 190, 0.5)]]),
  ];
  return {
    sala: sala(600, 450, 300, { piso: "#9d421b", paredes: "#b0d6ee", techo: "#e6f1f8" }),
    nodos: [
      { id: "malla", nombre: "Malla de R-5 frambuesa con nudos amarillos", pieza: malla, colocacion: { en: "pared", pared: "fondo", aLoLargoCm: 0, alturaCm: 128 } },
      { id: "mesa", nombre: "Mesa de dulces con faldón negro y gotas amarillas", pieza: escenografia(mesa), colocacion: enPiso(0, -182) },
      { id: "mm", nombre: "M&M gigantes de cartón", pieza: escenografia(figuras), colocacion: libre(0, 0, -205) },
    ],
  };
};

// ----------------------------------------------------------------------------------------------------------
// 471 · Decoración Corazones Brillantes (escena: arco rectangular orgánico)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 1080 × 1080 (pared blanca medida #d1d1c8: se corrige el balance): los R-24 rosados miden 130–160 px y los R-12
 * ~68–75 px: 2,75 px/cm. Arco rectangular de 3,7 × 2,8 m: patas de ~1,2 m de ancho (ejes a 2,27 m) que suben hasta un
 * travesaño de ~67 cm de grueso, en Pastel Mate Rosado con tríos de R-5 Palo de Rosa por todo el arco (≈ 60), unos
 * R-12 Palo de Rosa arriba y 23 impresos Corazones Brillantes (7 rojizos, 5 dorados, 8 caqui y 3 durazno). Dentro, la
 * cortina de flecos dorada en tres paños, dos huacales de pie con el banderín «FELIZ DÍA», el plato, los vasos y las
 * servilletas de corazones; tapete rosado.
 */
const escena471 = (): Escena => {
  const opciones = opcionesArcoRectangular({
    anchoEjeCm: 227, altoEjeCm: 242, radioEsquinaCm: 45, radioBaseCm: 50, radioPataCm: 42, radioArribaCm: 31, hueco: null,
    mezcla: { base: { "R-12": 5, "R-9": 1.5, "R-5": 1.2 }, pata: { "R-12": 5, "R-9": 1.5, "R-5": 1.2 }, arriba: { "R-12": 5, "R-9": 1.5, "R-5": 2 } },
    colores: [colorOrg("609", 1)],
    semilla: 471,
  });
  const base471: OpcionesOrganico = { ...opciones, inflados: { "R-12": 25, "R-9": 18, "R-5": 10 }, relleno: [], densidad: 1.2 };
  // Lo contado de frente: de ~95 R-12, 65 rosados, 5 palo de rosa y 7 + 13 + 3 impresos (cada uno en el color del surtido
  // más cercano al medido); los R-9 de relleno, rosados; los R-5, todos palo de rosa.
  const arco: OpcionesOrganico = { ...base471, colores: coloresPorFormato(base471, { "R-12": [["609", 65], ["010", 5], ["568", 7], ["570", 13], ["009", 3]], "R-9": [["609", 1]], "R-5": [["010", 1]] }) };
  const impresos: ImpresoEnPieza[] = [{ impresoId: CORAZONES, codigo: "568" }, { impresoId: CORAZONES, codigo: "570" }, { impresoId: CORAZONES, codigo: "009" }];
  // Los 3 R-24 rosados, medidos en la foto (x desde el centro, y desde el piso), por delante del arco.
  const grandes: Array<[string, Vec3]> = [["arriba a la izquierda", v(-65, 202, 12)], ["arriba a la derecha", v(87, 231, 12)], ["abajo a la izquierda", v(-152, 52, 14)]];
  const MADERA = "#c99a5b", DORADO = "#d9b23a";
  const cortina: ElementoEscenografia[] = [...flecos(-47, -22, 214, 24, 0, DORADO), ...flecos(4, 22, 236, 145, 0, DORADO), ...flecos(51, 73, 220, 20, 0, DORADO)];
  const huacales: ElementoEscenografia[] = [-18.5, 18.5].flatMap((x) => [
    caja(v(x, 47, 0), v(36, 94, 40), MADERA, "madera"),
    ...[20, 47, 74].map((y) => caja(v(x, y, 20.3), v(34, 1, 0.6), "#a87a42", "madera")),
  ]);
  const letras = (texto: string[]) => texto.map((t) => ({ dibujo: "texto" as const, texto: t, hex: "#d24f8f" }));
  const banderinFeliz = banderin({
    recorrido: { tipo: "recto", desde: v(-30, 0, 0), hasta: v(30, 0, 0) }, caidaCm: 3, cantidad: 5, forma: "rectangulo", anchoCm: 10, altoCm: 15,
    colores: ["#f3d3df"], motivos: letras(["F", "E", "L", "I", "Z"]), cordon: "#e9c46a", productoId: "cartel-decorativo-letras-metalizado-corazones-brillantes",
  });
  const banderinDia = banderin({
    recorrido: { tipo: "recto", desde: v(-30, 0, 0), hasta: v(30, 0, 0) }, caidaCm: 4, cantidad: 4, forma: "rectangulo", anchoCm: 11, altoCm: 15,
    colores: ["#f3d3df"], motivos: letras(["♥", "D", "Í", "A"]), cordon: "#e9c46a", productoId: "cartel-decorativo-letras-metalizado-corazones-brillantes",
  });
  const MESA = 94, Z = -65; // la tapa de los huacales y su centro (a 35 cm del arco)
  const vasos471 = () => vasos({ cantidad: 2, altoCm: 11, diametroCm: 8, hex: "#f6dbe4", motivo: { dibujo: "texto", texto: "♥", hex: "#d24f8f" }, servilleta: "#f2c9d6", productoId: "vaso-desechable-corazones-brillantes", servilletaProductoId: "servilleta-corazones-brillantes" });
  return {
    sala: sala(500, 420, 320, { piso: "#e6e1d8", paredes: "#f4f3ee", techo: "#fbfaf8" }),
    nodos: [
      { id: "arco", nombre: "Arco orgánico rosado con Corazones Brillantes", pieza: organico(arco, impresos), colocacion: enPiso(0, -100) },
      ...grandes.map(([donde, p], i) => sobreEn(`grande-${i + 1}`, `R-24 Pastel Mate Rosado (${donde})`, "arco", globo(R("R-24", 50, "609")), p, AL_FRENTE)),
      { id: "cortina", nombre: "Cortina de flecos dorada", pieza: escenografia(cortina), colocacion: libre(0, 0, -128) },
      { id: "huacales", nombre: "Dos huacales de pie", pieza: escenografia(huacales), colocacion: enPiso(0, Z) },
      { id: "banderin-feliz", nombre: "Banderín «FELIZ»", pieza: banderinFeliz, colocacion: libre(0, MESA - 6, Z + 21) },
      { id: "banderin-dia", nombre: "Banderín «♥ DÍA»", pieza: banderinDia, colocacion: libre(0, MESA - 30, Z + 21) },
      { id: "plato", nombre: "Plato metalizado Corazones Brillantes de pie", pieza: platos({ cantidad: 1, diametroCm: 23, hex: "#f2c9d6", motivo: { dibujo: "texto", texto: "♥", hex: "#d24f8f" }, dePie: true, productoId: "plato-desechable-metalizado-corazones-brillantes" }), colocacion: libre(0, MESA, Z - 8) },
      { id: "vasos", nombre: "Vasos Corazones Brillantes con servilletas (izquierda)", pieza: vasos471(), colocacion: libre(-22, MESA, Z + 2) },
      { id: "vasos-2", nombre: "Vasos Corazones Brillantes con servilletas (derecha)", pieza: vasos471(), colocacion: libre(22, MESA, Z + 2) },
      { id: "servilletas", nombre: "Servilletas Corazones Brillantes", pieza: servilletas({ cantidad: 6, ladoCm: 12.5, hex: "#f2c9d6", productoId: "servilleta-corazones-brillantes" }), colocacion: libre(0, MESA, Z + 10) },
      { id: "tapete", nombre: "Tapete rosado", pieza: escenografia(tapete({ anchoCm: 330, fondoCm: 150, hex: "#cd607a" })), colocacion: enPiso(0, 20) },
    ],
  };
};

// ----------------------------------------------------------------------------------------------------------
// 473 · Decoración Corazones Surtidos (escena: aro orgánico y ramo)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 1080 × 1080: los R-12 del aro miden 60–65 px (≈ 24 cm: 2,6 px/cm); el aro mide 785 × 730 px (≈ 2,9 m de fuera a
 * fuera, apoyado en el piso) con una banda de ~80 cm: Reflex Fucsia (cromado magenta), Reflex Dorado (cobrizo),
 * frambuesa intenso, Pastel Mate Rosado y los impresos Corazones Brillantes rosados (claros y fuertes), un R-18
 * cromado a la derecha. A la izquierda el ramo con helio: 3 corazones metalizados fucsia y uno rosa oro, 2 R-12 Latte y
 * 2 R-12 cobrizos, amarrados a un peso de globos (un R-24 rosado, magentas y frambuesas). Escalera repisa blanca,
 * pedestal con espirales moradas, letrero LOVE, cajita LOVE y tapete de lentejuelas fucsia.
 */
const escena473 = (): Escena => {
  const opciones = opcionesAroOrganico({
    diametroCm: 290, exterior: { formatoId: "R-12", radioCm: 17 }, interior: { pesos: { "R-12": 3, "R-18": 0.25, "R-9": 0.8 }, radioCm: 34, adelanteCm: 10 },
    colores: [
      colorOrg("912", 30, ["R-18", "R-12", "R-5"]), colorOrg("970", 22, ["R-18", "R-12", "R-9"]), colorOrg("014", 15, ["R-12", "R-9", "R-5"]), colorOrg("609", 20),
      colorOrg("009", 4, ["R-12"]), colorOrg("409", 1.5, ["R-12"]),
    ],
    semilla: 473,
  });
  const aro: OpcionesOrganico = { ...opciones, inflados: { "R-18": 40, "R-12": 24, "R-9": 17, "R-5": 11 }, relleno: [{ formatoId: "R-9", infladoCm: 17, trios: false }], suelo: true };
  const impresos: ImpresoEnPieza[] = [{ impresoId: CORAZONES, codigo: "009" }, { impresoId: CORAZONES, codigo: "409" }];
  // El ramo: el peso de globos en el piso y, amarrados a él, los 4 R-12 con helio (cintas) y los 4 corazones.
  const ramo: Pieza = deco({ tipo: "ramo_helio", propiedades: { globos: [R("R-12", 28, "073"), R("R-12", 28, "073"), R("R-12", 28, "970"), R("R-12", 28, "970")], alturaCm: 250, cinta: { hex: "#e9d9e4" }, peso: { hex: "#c43b78" } } });
  // Los corazones (de la foto: su base, en el espacio del ramo; giro −90 = de frente).
  const corazones: Array<[ColorMetalizado, Vec3, number]> = [["fucsia", v(14, 252, -10), -84], ["fucsia", v(10, 216, 4), -94], ["rosa_oro", v(-14, 168, 8), -80], ["fucsia", v(42, 168, 6), -100]];
  const BLANCO = "#f5f3f1", MORADO = "#8e2f9e";
  const escalera: ElementoEscenografia[] = [
    tablon(v(-28, 0, 0), v(-10, 168, 0), 4, 3, BLANCO, "madera"), tablon(v(28, 0, 0), v(10, 168, 0), 4, 3, BLANCO, "madera"),
    ...[22, 62, 102, 140].map((y, k) => caja(v(0, y, 4), v(52 - k * 9, 2.5, 22), BLANCO, "madera")),
    // Lo que va en las repisas: el plato de corazones, vasos y servilletas.
    disco(0, 125, 10, 6, "#e874a8", "papel"), cilindro(v(-6, 103.3, 4), 3.5, 9, "#f2b7cc", "papel"), cilindro(v(6, 103.3, 4), 3.5, 9, "#f2b7cc", "papel"),
    caja(v(-4, 70.3, 5), v(8, 14, 4), "#e3c2d6", "papel"), cilindro(v(-10, 23.3, 6), 3.5, 9, "#f2b7cc", "papel"), cilindro(v(10, 23.3, 6), 3.5, 9, "#f2b7cc", "papel"),
  ];
  const pedestal: ElementoEscenografia[] = [
    caja(v(0, 42, 0), v(45, 84, 45), BLANCO, "mate"),
    // Las espirales moradas que cuelgan del frente, con su corazón.
    ...[-11, 11].flatMap((x) => [...Array.from({ length: 6 }, (_, k) => cilindro(v(x + (k % 2 ? 2.5 : -2.5), 74 - k * 7, 23), 0.5, 7.5, MORADO, "foil")), disco(x, 26, 5, 23, MORADO, "foil")]),
    // Encima: el plato y los vasos de corazones.
    disco(-6, 96, 11, -12, "#e46a9e", "papel"), cilindro(v(10, 84, 6), 3.5, 10, "#f2b7cc", "papel"), cilindro(v(-12, 84, 8), 3.5, 10, "#f2b7cc", "papel"),
  ];
  const cajita: ElementoEscenografia[] = [
    caja(v(0, 9, 0), v(42, 18, 26), BLANCO, "madera"), caja(v(0, 33, -10), v(40, 14, 1), "#1d1d1d", "mate", 0),
    cilindro(v(-19, 0, -11), 0.8, 40, BLANCO, "madera"), cilindro(v(19, 0, -11), 0.8, 40, BLANCO, "madera"), disco(0, 21, 10, 2, "#d38a63", "metal"),
  ];
  return {
    sala: sala(520, 440, 340, { piso: "#efeae3", paredes: "#f1f0ec", techo: "#fbfaf8" }),
    nodos: [
      { id: "aro", nombre: "Aro orgánico de corazones surtidos", pieza: organico(aro, impresos), colocacion: enPiso(38, -130) },
      sobreEn("cromado-grande", "R-18 Reflex Fucsia (derecha)", "aro", globo(R("R-18", 40, "912")), v(130, 172, 14), v(0.5, 0, 0.87)),
      // El ramo de pie en el piso (su espacio, el de la sala) y lo amarrado a él: el peso de globos al pie y los corazones.
      { id: "ramo", nombre: "Ramo con helio: 2 R-12 Latte y 2 cobrizos", pieza: ramo, colocacion: enPiso(-140, 40) },
      sobreEn("peso", "Peso del ramo: R-24 Pastel Mate Rosado", "ramo", globo(R("R-24", 45, "609")), v(8, 33, 0), AL_FRENTE),
      sobreEn("peso-1", "R-12 Reflex Fucsia del peso", "ramo", globo(R("R-12", 24, "912")), v(-26, 22, 2), v(-0.9, -0.2, 0.3)),
      sobreEn("peso-2", "R-12 frambuesa del peso (abajo)", "ramo", globo(R("R-12", 24, "014")), v(-14, 14, 16), v(-0.4, -0.3, 0.86)),
      sobreEn("peso-3", "R-12 frambuesa del peso (al frente)", "ramo", globo(R("R-12", 24, "014")), v(4, 12, 24), v(0, -0.2, 1)),
      sobreEn("peso-4", "R-12 Reflex Fucsia del peso (detrás)", "ramo", globo(R("R-12", 24, "912")), v(-22, 36, -12), v(-0.7, 0.2, -0.7)),
      ...corazones.map(([color, p, giro], i) => sobreEn(`corazon-${i + 1}`, `Corazón metalizado ${color === "fucsia" ? "fucsia" : "rosa oro"} ${i + 1}`, "ramo", metalizado({ tipo: "corazon" }, 18, color), p, ARRIBA, giro)),
      { id: "banderin", nombre: "Banderín «FELIZ ♥ DÍA» sobre el aro", pieza: banderin({ recorrido: { tipo: "recto", desde: v(-62, 0, 0), hasta: v(62, 14, 0) }, caidaCm: 16, cantidad: 9, forma: "rectangulo", anchoCm: 11, altoCm: 16, colores: ["#f6f1e9"], motivos: ["F", "E", "L", "I", "Z", "♥", "D", "Í", "A"].map((t) => ({ dibujo: "texto" as const, texto: t, hex: "#d23b4a" })), cordon: "#e2c25a", productoId: "cartel-decorativo-letras-metalizado-corazones-brillantes" }), colocacion: libre(38, 216, -88) },
      { id: "escalera", nombre: "Escalera repisa blanca", pieza: escenografia(escalera), colocacion: enPiso(-40, -20) },
      { id: "pedestal", nombre: "Pedestal blanco con espirales moradas", pieza: escenografia(pedestal), colocacion: enPiso(146, -20) },
      { id: "cajita", nombre: "Cajita LOVE con platos", pieza: escenografia(cajita), colocacion: enPiso(74, 30) },
      { id: "letrero", nombre: "Letrero LOVE", pieza: letrero({ forma: "rectangulo", anchoCm: 38, altoCm: 14, hex: "#f7f1ea", motivo: { dibujo: "texto", texto: "LOVE", hex: "#c8202e" }, apoyo: "atril", productoId: null, descripcion: "letrero LOVE de madera" }), colocacion: enPiso(-25, 45) },
      { id: "tapete", nombre: "Tapete de lentejuelas fucsia", pieza: escenografia([caja(v(0, 0.3, 0), v(400, 0.6, 190), "#d65a9a", "lentejuelas")]), colocacion: enPiso(10, 70) },
    ],
  };
};

// ----------------------------------------------------------------------------------------------------------
// 476 · Decoración Feliz Año Nuevo (escena: guirnalda en L invertida y ramo)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 1080 × 1080: el R-24 negro impreso «Feliz Año» mide 242 px (≈ 60 cm: 4 px/cm). La guirnalda orgánica entra por
 * arriba a la izquierda, cruza todo lo alto (eje a ~1,8 m, banda de ~60 cm) y baja por la derecha hasta el piso, en
 * Reflex Plata, Fashion Negro, Gris y Arena (los publicados) con racimos de R-5 Reflex Dorado diminutos (~6 cm) y algún
 * R-12 dorado; abajo a la derecha un R-18 plata y uno arena. A la izquierda, un ramo con helio de 6 R-12 (dos «Feliz
 * Año» dorado y plata, uno negro de estrellas, uno negro de lunares dorados y uno blanco de estrellas) y un metalizado
 * redondo, amarrado a un peso orgánico (dorados, arena, gris, plata y negro). Cortina de flecos dorada, el cartel «Feliz
 * Año», 3 mesas de marco plateado (de 60, 87 y 80 cm) con flores, cupcakes, platos y vasos, y 5 toppers «Feliz Año».
 */
const escena476 = (): Escena => {
  const eje: Vec3[] = [
    v(-150, 186, 0), v(-105, 192, 0), v(-77, 190, 0), v(-52, 182, 0), v(-22, 177, 0), v(5, 172, 0), v(30, 177, 0), v(55, 188, 0),
    v(78, 176, 0), v(86, 150, 0), v(80, 120, 0), v(77, 90, 0), v(83, 60, 0), v(92, 32, 0), v(104, 14, 0),
  ];
  const mezcla: PuntoMezcla[] = [{ t: 0, pesos: { "R-12": 4, "R-9": 1, "R-5": 2.4 } }, { t: 0.55, pesos: { "R-12": 4, "R-9": 1, "R-5": 2.4 } }, { t: 0.8, pesos: { "R-12": 4, "R-9": 1, "R-5": 2, "R-18": 0.5 } }, { t: 1, pesos: { "R-12": 3, "R-9": 1, "R-5": 1.5, "R-18": 1 } }];
  const racimos: RacimoLibre[] = [{ id: "guirnalda", nombre: "Guirnalda", puntos: eje, radioInicioCm: 29, radioFinCm: 36, mezcla, tapas: { inicio: false, fin: true } }];
  const base476: OpcionesOrganico = { ...opcionesRacimosLibres({ racimos, colores: [colorOrg("981", 1)], semilla: 476, suelo: true, relleno: [{ formatoId: "R-9", infladoCm: 15, trios: false }] }), inflados: { "R-18": 34, "R-12": 21, "R-9": 15, "R-5": 7 } };
  // Lo contado de frente: de los R-12, plata 30, gris 22, arena 18, negro 18 y dorado 4; los R-5, sobre todo dorados.
  const guirnalda: OpcionesOrganico = {
    ...base476,
    colores: coloresPorFormato(base476, { "R-12": [["981", 30], ["081", 22], ["071", 18], ["080", 18], ["970", 4]], "R-9": [["981", 2], ["081", 1], ["071", 1], ["080", 1]], "R-5": [["970", 12], ["981", 6], ["080", 3]], "R-18": [["071", 1], ["981", 1]] }),
  };
  // El peso del ramo: un montículo orgánico de ~55 cm (2 R-12 dorados abajo, arena, gris, plata y negro).
  const pesoOpciones: OpcionesOrganico = {
    semilla: 4761, tramos: [{ ...formaColumna({ id: "peso", nombre: "Peso", altoCm: 55, radioBaseCm: 23, radioMedioCm: 20, radioPuntaCm: 16, mezcla: constante({ "R-12": 1, "R-9": 1, "R-5": 1.6 }) }), tapas: { fin: true } }],
    inflados: { "R-12": 23, "R-9": 15, "R-5": 9 }, variacionInflado: 0.06, relleno: [], colores: [colorOrg("071", 1)], suelo: true, huecosFlores: 0, vista: AL_FRENTE,
  };
  const peso: OpcionesOrganico = { ...pesoOpciones, colores: coloresPorFormato(pesoOpciones, { "R-12": [["970", 2], ["071", 3]], "R-9": [["081", 3], ["071", 1]], "R-5": [["981", 6], ["080", 2]] }) };
  // El ramo: el de arriba al centro (dorado «Feliz Año»), los de los lados y los negros abajo; impresos por índice.
  const ramo: Pieza = {
    ...deco({ tipo: "ramo_helio", propiedades: { globos: [R("R-12", 29, "970"), R("R-12", 29, "981"), R("R-12", 29, "005"), R("R-12", 29, "080"), R("R-12", 29, "080")], alturaCm: 95, cinta: { hex: "#e8e2d6" }, peso: { hex: "#c9b27a" } } }),
    impresos: [{ impresoId: FELIZ_ANO_REFLEX, globos: [0, 1] }, { impresoId: FELIZ_ANO_ESTRELLAS, globos: [3] }],
  };
  const PLATA = "#cfd2d6", DORADO = "#d8b24a";
  const marco = (ancho: number, alto: number): ElementoEscenografia[] => [
    ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => cilindro(v((sx * ancho) / 2, 0, (sz * ancho) / 2), 1, alto, PLATA, "metal"))),
    ...[2, alto - 1].flatMap((y) => [caja(v(0, y, ancho / 2), v(ancho, 2, 2), PLATA, "metal"), caja(v(0, y, -ancho / 2), v(ancho, 2, 2), PLATA, "metal"), caja(v(ancho / 2, y, 0), v(2, 2, ancho), PLATA, "metal"), caja(v(-ancho / 2, y, 0), v(2, 2, ancho), PLATA, "metal")]),
    caja(v(0, alto, 0), v(ancho, 1, ancho), "#e9eef0", "brillante"),
  ];
  const mesas: ElementoEscenografia[] = [
    ...marco(40, 60).map((e) => mover(e, v(-43, 0, 0))),
    ...marco(42, 87).map((e) => mover(e, v(1, 0, -12))),
    ...marco(48, 80).map((e) => mover(e, v(64, 0, 22))),
    // Encima: hortensias blancas en un florero con bolas doradas y negras, cupcakes; plato dorado de pie, servilleta y
    // vaso negro; plato plateado de pie y vasos.
    cilindro(v(1, 88, -12), 6, 22, "#eef3f4", "brillante"), ...bola(v(1, 118, -12), 14, "#f6f6f2", "papel"),
    ...[-9, -3, 3, 9].map((x) => cilindro(v(1 + x, 88, -2), 2.6, 4, "#e2c79a", "papel")),
    disco(-43, 72, 11, 2, DORADO, "metal"), cilindro(v(-52, 61, -6), 4, 10, "#1d1d1d", "papel"), cilindro(v(-52, 71, -6), 5, 6, DORADO, "papel"),
    disco(64, 98, 13, 28, "#dcdfe2", "metal"), cilindro(v(52, 81, 18), 4, 10, "#c8ccd0", "papel"), cilindro(v(58, 81, 12), 4, 10, "#c8ccd0", "papel"),
  ];
  const cortina = flecos(-106, 45, 162, 4, 0, DORADO, 2.4).map((e, i) => (i % 5 === 2 && e.forma === "caja" ? { ...e, hex: PLATA } : e));
  // Los toppers «Feliz Año» clavados en la guirnalda de la derecha (de la foto).
  const toppers: Array<[number, number]> = [[49, 81], [72, 77], [91, 75], [100, 64], [117, 34]];
  return {
    sala: sala(440, 380, 300, { piso: "#ddd1c1", paredes: "#cdbfae", techo: "#f2eee8" }),
    nodos: [
      { id: "guirnalda", nombre: "Guirnalda orgánica negra, plata, gris y arena", pieza: organico(guirnalda), colocacion: libre(0, 0, -150) },
      sobreEn("impreso-gigante", "R-24 negro Infinity Feliz Año Estrellas", "guirnalda", globo(R("R-24", 60, "080"), FELIZ_ANO_R24), v(-96, 157, 14), AL_FRENTE),
      { id: "peso", nombre: "Peso del ramo (dorados, arena, gris, plata y negro)", pieza: organico(peso), colocacion: enPiso(-91, 40) },
      sobreEn("ramo", "Ramo con helio Feliz Año", "peso", ramo, v(0, 62, 0), AL_FRENTE),
      sobreEn("metalizado", "Metalizado redondo negro y plata", "peso", metalizado({ tipo: "redondo" }, 18, "negro_mate", { impreso: { dibujo: "estrellas", hex: "#d8d8d8" } }), v(30, 80, -6), ARRIBA, -90),
      { id: "cortina", nombre: "Cortina de flecos dorada", pieza: escenografia(cortina), colocacion: libre(0, 0, -168) },
      { id: "cartel", nombre: "Cartel «Feliz Año» negro y dorado", pieza: letrero({ forma: "rectangulo", anchoCm: 110, altoCm: 26, hex: "#16161a", motivo: { dibujo: "texto", texto: "Feliz Año", hex: DORADO }, apoyo: "colgado", productoId: "cartel-metalizado-jumbo-feliz-ano-dorado" }), colocacion: libre(-22, 125, -165) },
      { id: "mesas", nombre: "Mesas de marco plateado con flores, cupcakes, platos y vasos", pieza: escenografia(mesas), colocacion: libre(0, 0, -60) },
      ...toppers.map(([x, y], i) => ({ id: `topper-${i + 1}`, nombre: `Topper «Feliz Año» ${i + 1}`, pieza: letrero({ forma: "circulo", anchoCm: 12, altoCm: 12, hex: "#16161a", motivo: { dibujo: "texto", texto: "Feliz Año", hex: DORADO }, apoyo: "palito", productoId: null, descripcion: "topper redondo «Feliz Año»" }), colocacion: libre(x, y - 7, -112) })),
    ],
  };
};

/** Un elemento de escenografía corrido `d` (para repetir un mueble en otro sitio). */
function mover(e: ElementoEscenografia, d: Vec3): ElementoEscenografia {
  if (e.en) return { ...e, en: { ...e.en, origen: redondo(mas(e.en.origen, d)) } };
  if (e.forma === "caja") return { ...e, centro: redondo(mas(e.centro, d)) };
  if (e.forma === "cilindro") return { ...e, base: redondo(mas(e.base, d)) };
  return { ...e, contorno: e.contorno.map((p) => ({ x: r2(p.x + d.x), y: r2(p.y + d.y) })), zCm: r2(e.zCm + d.z) };
}

// ----------------------------------------------------------------------------------------------------------
// 478 · Decoración mesa (escena de Halloween: columnas colgadas del techo, arañas y columnas de la mesa)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 740 × 570: los R-12 negros miden ~52 px (≈ 25 cm: 2,1 px/cm), el piso queda en y ≈ 560 px y lo alto de la
 * foto a 2,67 m. Cuatro columnas cuelgan del techo: módulos de un R-12 negro y un collar de 4 R-5 amarillo miel
 * (la de fuera a la izquierda), de R-9 negros con collares de R-5 naranja (la de dentro), la del centro, y la de la
 * derecha de pares de R-12 negros y pares de R-5; cada una acaba en una araña grande (R-12 de cuerpo, R-9 de cabeza con
 * ojos bravos rojos y 8 patas de T-260). Bajo la del centro, 3 arañitas colgando. A los lados de la mesa, 2 columnas
 * de cuartetos negros y naranjas impresos (5 niveles, ~1,1 m) con aros de tubito violeta y 5 arañitas trepando; en la
 * mesa (faldón naranja, tapa morada) 8 calabacitas de R-5 con tallo de tubito verde en una torre de 3 pisos.
 */
const escena478 = (): Escena => {
  const TECHO = 290;
  const negro = (formatoId: string, d: number): Pieza => globo(R(formatoId, d, "080"));
  const collar = (codigo: string, d: number): Pieza => deco(anillo(R("R-5", d, codigo), 4, 0, 45));
  const grande = (giro: number): Pieza => deco(arana({ cuerpo: R("R-12", 25, "080"), cabeza: R("R-9", 16, "080"), ojos: { hexIris: "#c62828" }, patas: { formatoId: "T-260", grosorCm: 3.5, codigo: "080", largoCm: 50, estilo: "articuladas" }, giroGrados: giro }));
  const chica = (giro: number): Pieza => deco(arana({ cuerpo: R("R-9", 15, "080"), cabeza: R("R-5", 9, "080"), ojos: { hexIris: "#c62828" }, patas: { formatoId: "T-260", grosorCm: 3, codigo: "080", largoCm: 32, estilo: "articuladas" }, giroGrados: giro }));
  /**
   * Una columna de techo. La raíz es su último collar (un cuarteto de R-5, colgado del techo por su hilo); los módulos de
   * encima se apilan uno `sobre` otro (cada uno se apoya en el de abajo, como en la columna real: la altura medida solo
   * los acerca) y el de debajo cuelga de la raíz (normal hacia abajo). La araña va de frente al pie, colgada de la raíz.
   * Un módulo con `par` son dos globos lado a lado (cada uno sobre el suyo de abajo).
   */
  type Modulo = { y: number; pieza: Pieza; nombre: string; par?: boolean; abajo?: boolean };
  const colgante = (id: string, nombre: string, x: number, z: number, raiz: { y: number; codigo: string; d: number }, modulos: Modulo[], aranaY: number, extra: Array<{ id: string; nombre: string; pieza: Pieza; en: Vec3 }> = []): NodoEscena[] => {
    const pieza = columna("R-5", raiz.d, 1, [raiz.codigo]);
    const c = armarPieza(pieza).caja;
    const cuelga = TECHO - (raiz.y + (c.max.y - c.min.y) / 2);
    const y0 = TECHO - cuelga - c.max.y; // el y del mundo del origen de la raíz
    const minusculo = nombre.charAt(0).toLowerCase() + nombre.slice(1);
    const salida: NodoEscena[] = [{ id, nombre, pieza, colocacion: enTecho(x, z, cuelga) }];
    // Los de encima, de abajo arriba, y los de debajo, de arriba abajo: cada uno sobre el anterior de su cadena.
    const encima = modulos.filter((m) => !m.abajo).sort((p, q) => p.y - q.y);
    const debajo = modulos.filter((m) => m.abajo).sort((p, q) => q.y - p.y);
    for (const [cadena, sentido] of [[encima, 1], [debajo, -1]] as const) {
      let previo: { ids: string[]; y: number } = { ids: [id, id], y: raiz.y };
      cadena.forEach((m, i) => {
        const lados = m.par ? [-1, 1] : [0];
        const ids = lados.map((lado) => `${id}-${sentido > 0 ? "arriba" : "abajo"}-${i + 1}${m.par ? (lado < 0 ? "a" : "b") : ""}`);
        lados.forEach((lado, k) => {
          const d = m.pieza.tipo === "globo" ? m.pieza.infladoCm : 0;
          const deLaRaiz = previo.ids[0] === id;
          // Sobre la raíz (marco de la sala): a su altura y a un lado si va en par; sobre un módulo (su +y sigue la cadena):
          // justo encima (o debajo) de él.
          const punto = deLaRaiz ? v(r2(lado * d * 0.48), r2(m.y - y0), 0) : v(0, r2(Math.abs(m.y - previo.y)), 0);
          const normal = deLaRaiz && sentido < 0 ? v(0, -1, 0) : ARRIBA;
          salida.push(sobreCentrada(ids[k]!, `${m.nombre} (${minusculo}, ${sentido > 0 ? "arriba" : "abajo"} ${i + 1}${m.par ? (lado < 0 ? "a" : "b") : ""})`, m.par && !deLaRaiz ? previo.ids[k]! : previo.ids[0]!, m.pieza, punto, normal));
        });
        previo = { ids: m.par ? ids : [ids[0]!, ids[0]!], y: m.y };
      });
    }
    salida.push(sobreCentrada(`${id}-arana`, `Araña grande (${minusculo})`, id, grande(0), v(0, r2(aranaY - y0), 4), AL_FRENTE));
    for (const e of extra) salida.push(sobreCentrada(e.id, e.nombre, id, e.pieza, v(e.en.x - x, r2(e.en.y - y0), e.en.z - z), AL_FRENTE));
    return salida;
  };
  const MIEL = "021", NARANJA = "061";
  const N = (y: number, pieza: Pieza, extra: Partial<Modulo> = {}): Modulo => ({ y, pieza, nombre: extra.par ? "Globo negro del par" : "Globo negro", ...extra });
  const C = (y: number, pieza: Pieza, extra: Partial<Modulo> = {}): Modulo => ({ y, pieza, nombre: extra.par ? "Globo del par de R-5" : "Collar de R-5", ...extra });
  // Alturas medidas (cm del piso) de arriba abajo; la raíz es el último collar.
  const R12 = () => negro("R-12", 25), R9 = () => negro("R-9", 18);
  const fueraIzq = colgante("colgante-izquierda", "Columna colgante de fuera, izquierda", -114, -40, { y: 182, codigo: MIEL, d: 12 },
    [C(278, collar(MIEL, 12)), N(264, R12()), C(250, collar(MIEL, 12)), N(236, R12()), C(217, collar(MIEL, 12)), N(202, R12()), N(166, R12(), { abajo: true })], 140);
  const dentroIzq = colgante("colgante-dentro", "Columna colgante de dentro, izquierda", -83, -70, { y: 183, codigo: NARANJA, d: 9 },
    [C(233, collar(NARANJA, 9)), N(221, R9()), C(208, collar(NARANJA, 9)), N(195, R9()), N(172, R9(), { abajo: true })], 150);
  const centro = colgante("colgante-centro", "Columna colgante del centro", 0, -90, { y: 245, codigo: MIEL, d: 12 },
    [C(276, collar(MIEL, 12)), N(262, R12()), N(229, R12(), { abajo: true })], 203,
    [{ id: "arana-chica-1", nombre: "Arañita colgando 1", pieza: chica(20), en: v(-21, 152, -80) }, { id: "arana-chica-2", nombre: "Arañita colgando 2", pieza: chica(-10), en: v(19, 131, -80) }, { id: "arana-chica-3", nombre: "Arañita colgando 3", pieza: chica(-30), en: v(52, 143, -80) }]);
  const R5 = () => globo(R("R-5", 12, MIEL));
  const fueraDer = colgante("colgante-derecha", "Columna colgante de fuera, derecha", 117, -40, { y: 187, codigo: NARANJA, d: 12 },
    [N(268, R12(), { par: true }), C(254, R5(), { par: true }), N(240, R12(), { par: true }), C(221, R5(), { par: true }), N(205, R12(), { par: true }), N(170, R12(), { par: true, abajo: true })], 142);
  // Las columnas de la mesa: cuartetos negros y naranjas impresos en espiral, con aros de tubito violeta.
  const base = columna("R-12", 25, 5, ["080", NARANJA, "080", NARANJA], "espiral", [{ impresoId: HALLOWEEN_NOCHE, codigo: NARANJA }]);
  const aro = deco(florTubito(lazos("T-260", 4, ["051"], 1, 30, 22, 0, 0)));
  const columnaMesa = (id: string, nombre: string, x: number, lado: number, aranas: Array<[Vec3, number]>): NodoEscena[] => [
    { id, nombre, pieza: base, colocacion: enPiso(x, -40) },
    ...[24, 56, 84].map((y, k) => sobreEn(`${id}-aro-${k + 1}`, `Aro de tubito violeta (${nombre.toLowerCase()}, ${k + 1})`, id, aro, v(lado * 22, y, 6), v(lado, 0.2, 0.5))),
    ...aranas.map(([p, giro], k) => sobreCentrada(`${id}-arana-${k + 1}`, `Arañita trepando (${nombre.toLowerCase()}, ${k + 1})`, id, chica(giro), p, AL_FRENTE)),
  ];
  const izquierda = columnaMesa("columna-mesa-izquierda", "Columna de la mesa, izquierda", -72, -1, [[v(5, 110, 14), 30], [v(39, 33, 30), 0]]);
  const derecha = columnaMesa("columna-mesa-derecha", "Columna de la mesa, derecha", 112, 1, [[v(-41, 114, 14), -30], [v(-64, 48, 34), 10], [v(-22, 43, 30), -20]]);
  const MESA = 71;
  const mesa: ElementoEscenografia[] = [
    ...mesaConMantel({ anchoCm: 117, fondoCm: 60, altoCm: MESA, mantel: "#f2681c" }),
    caja(v(0, MESA + 1, 0), v(121, 2, 64), "#6c3fa0", "satinado"),
    // La torre de las calabacitas (3 pisos) y unos dulces.
    cilindro(v(-8, MESA + 2, -4), 24, 1.5, "#e9e2f2", "brillante"), cilindro(v(-8, MESA + 13, -4), 15, 1.5, "#e9e2f2", "brillante"), cilindro(v(-8, MESA + 2, -4), 1.2, 22, "#e9e2f2", "brillante"),
    ...[-45, 38, 46].map((x) => cilindro(v(x, MESA + 2, 8), 5, 6, "#7b4fb0", "papel")),
  ];
  const calabacita: PropiedadesCalabaza = { globo: R("R-5", 11, NARANJA), cara: null, tallo: { formatoId: "T-260", grosorCm: 2.5, codigo: "029", lazos: 3, largoLazoCm: 6, zarcillos: false } };
  // De la foto, respecto al centro de la mesa: 5 abajo, 2 en medio y 1 arriba.
  const calabazas: Vec3[] = [v(-44, MESA + 8, 4), v(-27, MESA + 8, 0), v(-6, MESA + 8, 6), v(13, MESA + 8, 0), v(32, MESA + 8, 4), v(-20, MESA + 19, -4), v(9, MESA + 19, -4), v(-3, MESA + 31, -4)];
  return {
    sala: sala(400, 360, TECHO, { piso: "#efefef", paredes: "#f7f7f7", techo: "#fbfbfb" }),
    nodos: [
      ...fueraIzq, ...dentroIzq, ...centro, ...fueraDer, ...izquierda, ...derecha,
      { id: "mesa", nombre: "Mesa con faldón naranja y tapa morada", pieza: escenografia(mesa), colocacion: enPiso(20, -40) },
      ...calabazas.map((p, i) => ({ id: `calabaza-${i + 1}`, nombre: `Calabacita de R-5 ${i + 1}`, pieza: deco({ tipo: "calabaza", propiedades: calabacita }), colocacion: libre(20 + p.x, p.y, -44 + p.z) })),
    ],
  };
};

// ----------------------------------------------------------------------------------------------------------
// 479 · Decoración Mundialista (arco asimétrico)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 740 × 570 sobre fondo blanco: los 3 balones R-24 miden 115–120 px (≈ 55 cm: 2,15 px/cm), el piso en y ≈ 548 px.
 * Arco de ~2,2 × 2,45 m. Pata izquierda: un montículo de ~8 R-12 verde lima, los 3 balones apilados en curva con un
 * trébol de 4 burbujas de T-260 verde lima entre cada uno; corona orgánica verde lima (R-12 y R-5) que cruza arriba;
 * pata derecha negra (R-12 y R-5) que pasa a blanca hasta el piso, con 7 R-12 Futbolmanía (2 en la corona, 2 en lo
 * negro y 3 en lo blanco) y un trébol suelto en el hueco del arco. Tres estructuras (el motor reparte los colores en
 * toda la pieza): lo verde (corona y montículo, con los balones y los tréboles), lo negro y lo blanco.
 */
const escena479 = (): Escena => {
  const px = (x: number, y: number, z = 0) => v(r2((x - 375) / 2.15), r2((548 - y) / 2.15), z);
  const mezclaFina = constante({ "R-12": 3, "R-5": 2.6 });
  const inflados = { "R-12": 21, "R-9": 15, "R-5": 10 };
  // Sin relleno: la foto deja ver el fondo entre globos y los R-5 que lleva van en la mezcla.
  const relleno: RellenoOrganico[] = [];
  const verde: OpcionesOrganico = {
    ...opcionesRacimosLibres({
      racimos: [
        { id: "corona", nombre: "Corona", puntos: [px(318, 128), px(360, 100), px(420, 92), px(480, 115), px(548, 150)], radioInicioCm: 21, radioFinCm: 20, mezcla: mezclaFina, tapas: { inicio: true, fin: true } },
        { id: "monticulo", nombre: "Montículo de la pata izquierda", puntos: [px(160, 520), px(200, 505), px(240, 520)], radioInicioCm: 22, radioFinCm: 22, mezcla: constante({ "R-12": 1 }), tapas: { inicio: true, fin: true } },
      ],
      colores: [colorOrg("031", 1)], semilla: 479, suelo: true, relleno,
    }),
    inflados,
  };
  const tramo = (id: string, nombre: string, puntos: Vec3[], radio: number, codigo: string, semilla: number): Pieza => organico({
    ...opcionesRacimosLibres({ racimos: [{ id, nombre, puntos, radioInicioCm: radio, radioFinCm: radio, mezcla: mezclaFina, tapas: { inicio: true, fin: true } }], colores: [colorOrg(codigo, 1)], semilla, suelo: true, relleno }),
    inflados,
  });
  // Lo negro y lo blanco: el motor reparte los colores en toda la pieza, así que cada tramo es su propia estructura.
  const negro = tramo("negro", "Tramo negro", [px(500, 165), px(490, 240), px(484, 345)], 26, "080", 4791);
  const blanco = tramo("blanco", "Tramo blanco", [px(486, 352), px(498, 440), px(508, 548)], 33, "005", 4792);
  const balon = globo(R("R-24", 55, "005"), BALON);
  const trebol = deco(florTubito(burbujas("T-260", 4.5, ["031"], 4, 7.5, 0, 45)));
  const futbolmania = globo(R("R-12", 24, "005"), FUTBOLMANIA);
  const impresos: Array<[number, number, string]> = [[370, 50, "corona"], [525, 80, "corona"], [580, 175, "negro"], [570, 270, "negro"], [545, 395, "blanco"], [450, 425, "blanco"], [545, 500, "blanco"]];
  return {
    sala: sala(420, 340, 300, { piso: "#f2f2f2", paredes: "#ffffff", techo: "#ffffff" }),
    nodos: [
      { id: "arco", nombre: "Arco mundialista: corona y montículo verde lima", pieza: organico(verde), colocacion: libre(0, 0, 0) },
      { id: "negro", nombre: "Arco mundialista: tramo negro de la pata derecha", pieza: negro, colocacion: libre(0, 0, 0) },
      { id: "blanco", nombre: "Arco mundialista: tramo blanco de la pata derecha", pieza: blanco, colocacion: libre(0, 0, 0) },
      // Los balones, de abajo arriba: el de abajo se apoya en el montículo, el del medio queda donde se mide y el de
      // arriba se apoya en la punta de la corona (la normal, de la corona hacia él). Los tréboles, entre ellos.
      sobreCentrada("balon-1", "Balón R-24 (abajo)", "arco", balon, px(195, 405)),
      sobreCentrada("trebol-1", "Trébol de tubito verde lima (entre los balones de abajo)", "arco", trebol, px(186, 340, 4), AL_FRENTE),
      sobreCentrada("balon-2", "Balón R-24 (medio)", "arco", balon, px(205, 272)),
      sobreCentrada("trebol-2", "Trébol de tubito verde lima (entre los balones de arriba)", "arco", trebol, px(238, 220, 4), AL_FRENTE),
      sobreCentrada("balon-3", "Balón R-24 (arriba)", "arco", balon, px(282, 168), v(-0.62, -0.78, 0)),
      sobreCentrada("trebol-suelto", "Trébol de tubito verde lima suelto (en el hueco)", "arco", trebol, px(353, 263, 0), AL_FRENTE),
      ...impresos.map(([x, y, donde], i) => sobreCentrada(`futbolmania-${i + 1}`, `R-12 Futbolmanía ${i + 1} (${donde === "corona" ? "en la corona" : donde === "negro" ? "en lo negro" : "en lo blanco"})`, donde === "corona" ? "arco" : donde, futbolmania, px(x, y, 12), AL_FRENTE)),
    ],
  };
};

// ----------------------------------------------------------------------------------------------------------
// 498 · Día del Árbol
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 1000 × 1000 sobre blanco: los R-12 de la copa miden 75–80 px y el tubito ~16 px (T-260 a 5 cm): 3,2 px/cm; el
 * piso en y ≈ 945 px. Árbol de ~2,8 m: base de ~1,1 m de R-12 chocolate (a ~19 cm), tronco de ~55 cm de grueso de R-12
 * chocolate a ~18 cm con 4 tubitos café enrollados y una copa de ~1,8 × 1,45 m de R-12 en 4 verdes (contados de frente:
 * 22 verde, 16 verde selva, 16 eucalipto y 14 verde lima). La raíz es el tronco con su base; la copa (sus colores son
 * otros: el motor reparte los colores en toda la pieza) y los tubitos van `sobre` él.
 */
const escena498 = (): Escena => {
  const tronco: OpcionesOrganico = {
    ...opcionesTroncoConBase({
      base: { radioAnilloCm: 32, radioCm: 24, mezcla: { "R-12": 1 } },
      tronco: { desdeCm: 42, altoCm: 140, radioCm: 22, radioCopaCm: 24, mezcla: { "R-12": 1 } },
      colores: [colorOrg("076", 1)], inflados: { "R-12": 18.5 }, relleno: [], semilla: 498,
    }),
  };
  const copa: Pieza = { tipo: "forma", forma: { clase: "esfera", diametroCm: 180, globo: { formatoId: "R-12", infladoCm: 25 }, colores: { codigos: ["030", "032", "027", "031"], patron: "mezcla", pesos: [22, 16, 16, 14], semilla: 498 }, achatado: 0.8 } };
  const espiral = (giro: number): Pieza => deco(rizo({ forma: "resorte", tubito: { formatoId: "T-260", grosorCm: 5, codigo: "074" }, vueltas: 1.25, radioCm: 27, largoCm: 92, eje: "frente", giroGrados: giro }));
  return {
    sala: sala(380, 320, 320, { piso: "#f2f2f2", paredes: "#ffffff", techo: "#ffffff" }),
    nodos: [
      { id: "tronco", nombre: "Tronco y base de R-12 chocolate", pieza: organico(tronco), colocacion: PISO },
      // La copa se apoya en lo alto del tronco; los tubitos, en la base (se enroscan subiendo).
      sobreEn("copa", "Copa de R-12 verdes", "tronco", copa, v(-2, 128, 0)),
      ...[0, 90, 180, 270].map((g, i) => sobreEn(`tubito-${i + 1}`, `Tubito café enrollado ${i + 1}`, "tronco", espiral(g), v(0, 44, 0))),
    ],
  };
};

// ----------------------------------------------------------------------------------------------------------
// 515 · El Principito (escena: pared de globos azules y estrellas)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 740 × 570: la mesa mide 377 px de ancho y 130 px de alto (≈ 81 cm hasta el piso: 1,6 px/cm). Detrás, la pared de
 * globos azules: una retícula de R-9 (~25 px ≈ 16 cm) con un R-5 en cada hueco, de 570 × 365 px (≈ 3,56 × 2,28 m). Las
 * 11 estrellas metalizadas doradas (manchas amarillas de ~50 px ≈ 31 cm) con sus cintas, la mesa de mantel rojo con el
 * paño azul y el banderín «MICAEL», el pastel de maletas, los dulceros y 2 estrellas blancas recortadas.
 */
const escena515 = (): Escena => {
  const pared: Pieza = {
    tipo: "forma",
    forma: {
      clase: "rellena", contorno: { tipo: "libre", puntos: [{ x: -178, y: 0 }, { x: 178, y: 0 }, { x: 178, y: 228 }, { x: -178, y: 228 }] },
      tecnica: { tipo: "celdas", formatoId: "R-9", infladoCm: 16.5, celda: "cuadrada" }, colores: { codigos: ["040"], patron: "un_color" },
      acento: { formatoId: "R-5", infladoCm: 8, codigos: ["040"], cada: 1 },
    },
  };
  // Las estrellas: centro de cada mancha amarilla (px) a la pared (cm desde el centro y desde el piso).
  const estrellas: Array<[number, number]> = [[85, 87], [84, 139], [184, 207], [125, 255], [273, 175], [368, 156], [447, 177], [521, 191], [636, 103], [633, 156], [595, 280]];
  const enPared = (x: number, y: number) => v(r2((x - 370) / 1.6), r2((415 - y) / 1.6), 4);
  const estrella: Pieza = { tipo: "metalizado", metalizado: { forma: { tipo: "estrella" }, pulgadas: 13, color: "oro", acostado: true } };
  const ROJO = "#f2102c", AZUL = "#24489e", MESA = 81;
  const cintas: ElementoEscenografia[] = estrellas.map(([x, y]) => { const p = enPared(x, y); return cilindro(v(p.x, MESA, 6), 0.25, r2(p.y - 15 - MESA), "#e9d2e8", "satinado"); });
  const mesa: ElementoEscenografia[] = [
    ...mesaConMantel({ anchoCm: 235, fondoCm: 70, altoCm: MESA, mantel: ROJO }),
    caja(v(-17, MESA / 2 + 1, 36.5), v(116, MESA - 2, 1), AZUL, "tela"), caja(v(-17, MESA + 0.6, 0), v(116, 1, 72), AZUL, "tela"),
    // El pastel de maletas (3 pisos) con su sombrero de rayas y la vela «1».
    caja(v(16, MESA + 7, -10), v(34, 14, 26), "#7b4a2b", "mate"), caja(v(16, MESA + 20, -10), v(28, 12, 22), "#8a5a35", "mate"), caja(v(16, MESA + 31, -10), v(22, 10, 18), "#2f5fb3", "mate"),
    cilindro(v(16, MESA + 36, -10), 9, 9, "#f4f4f4", "mate"), cilindro(v(16, MESA + 45, -10), 6, 3, "#2f5fb3", "mate"), cilindro(v(16, MESA + 48, -10), 0.6, 6, "#e3262f", "mate"),
    // Dulceros, frascos y las 2 estrellas blancas recortadas.
    ...[-95, -78, -58, 66, 88, 104].map((x, k) => cilindro(v(x, MESA, -14 + (k % 2) * 8), 6, 14 + (k % 3) * 4, ["#d8ecf8", "#f6c33c", "#e9f4fb"][k % 3]!, "brillante")),
    ...[-46, 52].map((x) => ({ forma: "panel" as const, contorno: Array.from({ length: 10 }, (_, k) => ({ x: r2(x + (k % 2 ? 6 : 14) * Math.sin((Math.PI * k) / 5)), y: r2(MESA + 14 + (k % 2 ? 6 : 14) * Math.cos((Math.PI * k) / 5)) })), zCm: -6, grosorCm: 1, hex: "#f7f7f7", acabado: "papel" as const })),
  ];
  const micael = banderin({
    recorrido: { tipo: "recto", desde: v(-50, 0, 0), hasta: v(26, 0, 0) }, caidaCm: 8, cantidad: 6, forma: "rectangulo", anchoCm: 11, altoCm: 14,
    colores: ["#46b4e6"], motivos: ["M", "I", "C", "A", "E", "L"].map((t) => ({ dibujo: "texto" as const, texto: t, hex: "#d8262e" })), cordon: "#f2f2f2", productoId: null, descripcion: "banderín de papel con el nombre",
  });
  return {
    sala: sala(460, 380, 280, { piso: "#dfe3e8", paredes: "#f4f6f8", techo: "#fafbfc" }),
    nodos: [
      { id: "pared", nombre: "Pared de globos azules (R-9 y R-5)", pieza: pared, colocacion: { en: "pared", pared: "fondo", aLoLargoCm: 0, alturaCm: 0 } },
      ...estrellas.map(([x, y], i) => sobreCentrada(`estrella-${i + 1}`, `Estrella metalizada dorada ${i + 1}`, "pared", estrella, enPared(x, y), AL_FRENTE)),
      { id: "cintas", nombre: "Cintas de las estrellas", pieza: escenografia(cintas), colocacion: libre(0, 0, -186) },
      { id: "mesa", nombre: "Mesa de mantel rojo y paño azul", pieza: escenografia(mesa), colocacion: enPiso(-3, -140) },
      { id: "banderin", nombre: "Banderín «MICAEL»", pieza: micael, colocacion: libre(-3, MESA - 4, -103) },
    ],
  };
};

// ----------------------------------------------------------------------------------------------------------
// 539 · Fantasía metalizada (columna orgánica)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 740 × 570 sobre blanco: el R-24 frambuesa de arriba mide 145 px (≈ 56 cm: 2,6 px/cm), el piso en y ≈ 565 px;
 * alto total ~2,1 m. Base orgánica ancha (~1,2 m × 80 cm) y un racimo arriba (~60 cm), en frambuesa, cromado plata
 * (los publicados) y cromado cobre; entre los dos, un tallo de R-5 en espiral de los tres colores (~25 cm de grueso,
 * de 63 a 110 cm) y el R-24 frambuesa encima. Tubito plata: 3 tirabuzones arriba a la izquierda, 3 capullos y un moño
 * de 3 lazos grandes en la base con un moñito de tubito cobre.
 */
const escena539 = (): Escena => {
  const px = (x: number, y: number, z = 0) => v(r2((x - 375) / 2.6), r2((565 - y) / 2.6), z);
  const base539: OpcionesOrganico = {
    densidad: 1.3,
    ...opcionesTroncoConBase({
      base: { radioAnilloCm: 26, radioCm: 36, mezcla: { "R-12": 3, "R-9": 0.5, "R-5": 1 } },
      tronco: { desdeCm: 116, altoCm: 176, radioCm: 26, radioCopaCm: 24, mezcla: { "R-12": 3, "R-9": 0.5, "R-5": 1 } },
      colores: [colorOrg("014", 1)], inflados: { "R-12": 26, "R-9": 18, "R-5": 11 }, relleno: [], semilla: 539,
    }),
  };
  const columna539: OpcionesOrganico = { ...base539, densidad: 1.3, colores: coloresPorFormato(base539, { "R-12": [["014", 35], ["981", 35], ["968", 30]], "R-9": [["014", 1], ["981", 1]], "R-5": [["014", 1], ["981", 2]] }) };
  const tallo = columna("R-5", 10.5, 6, ["014", "981", "968", "981"], "espiral");
  const tirabuzon = (vueltas: number): Pieza => deco(rizo({ forma: "tirabuzon", tubito: { formatoId: "T-260", grosorCm: 3, codigo: "981" }, vueltas, radioInicialCm: 5, radioFinalCm: 3, largoCm: 34, eje: "frente" }));
  const capullo = deco(florTubito(burbujas("T-260", 3, ["981"], 3, 6, 35, 0)));
  return {
    sala: sala(380, 320, 280, { piso: "#f2f2f2", paredes: "#ffffff", techo: "#ffffff" }),
    nodos: [
      { id: "columna", nombre: "Columna orgánica frambuesa, plata y cobre", pieza: organico(columna539), colocacion: PISO },
      // El tallo se apoya en la base; el R-24, en el racimo de arriba.
      sobreEn("tallo", "Tallo de R-5 en espiral (frambuesa, plata y cobre)", "columna", tallo, v(0, 60, 0)),
      sobreEn("remate", "R-24 Fashion Frambuesa", "columna", globo(R("R-24", 56, "014")), px(388, 140)),
      sobreEn("tirabuzon-1", "Tirabuzón de tubito plata (arriba)", "columna", tirabuzon(4), px(320, 160, 0), v(-1, 0.55, 0.2)),
      sobreEn("tirabuzon-2", "Tirabuzón de tubito plata (medio)", "columna", tirabuzon(5), px(318, 190, 4), v(-1, 0.05, 0.3)),
      sobreEn("tirabuzon-3", "Tirabuzón de tubito plata (abajo)", "columna", tirabuzon(4), px(325, 215, 6), v(-0.8, -0.45, 0.35)),
      sobreEn("capullo-1", "Capullo de tubito plata (izquierda)", "columna", capullo, px(325, 235, 18), v(-0.5, 0.2, 0.85)),
      sobreEn("capullo-2", "Capullo de tubito plata (derecha)", "columna", capullo, px(412, 250, 18), v(0.4, 0.2, 0.9)),
      sobreEn("capullo-3", "Capullo de tubito plata (base)", "columna", capullo, px(470, 365, 18), v(0.6, 0.5, 0.6)),
      sobreEn("mono-plata", "Moño de 3 lazos de tubito plata (base)", "columna", deco(florTubito(lazos("T-260", 3, ["981"], 3, 40, 24, 0, 20))), px(270, 425, 22), v(-0.55, 0.15, 0.82)),
      sobreEn("mono-cobre", "Moñito de tubito cobre (base)", "columna", deco(florTubito(lazos("T-260", 3, ["968"], 4, 14, 8, 0, 45))), px(265, 410, 30), v(-0.55, 0.15, 0.82)),
    ],
  };
};

// ----------------------------------------------------------------------------------------------------------
// 573 · Fiesta en Halloween (escena: arco de cuartetos sobre la mesa)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 740 × 570: la mesa mide 375 px de ancho y 180 px de alto (76 cm: 2,37 px/cm), el piso en y ≈ 555 px. El arco de
 * cuartetos de R-12 verde lima (~55–60 px ≈ 25 cm) sube desde lo alto de dos postes naranjas (~1,5 m) hasta ~2,3 m, con
 * un collar de 4 R-5 violeta entre cada cuarteto (12 cuartetos y 11 collares); en cada pie, 3 R-12 negros de Araña
 * Metalink. Al pie de los postes, R-12 violeta y globos-ojo verdes. Fondo verde oscuro de telarañas, mesa de faldón
 * naranja con el esqueleto de papel, la bruja de la esquina y dulces.
 */
const escena573 = (): Escena => {
  const px = (x: number, y: number, z = 0) => v(r2((x - 370) / 2.37), r2((555 - y) / 2.37), z);
  // El eje: media elipse de los postes (y = 150) a lo alto (centro de los cuartetos a ~2,2 m).
  const A = 80, B = 72, Y0 = 150;
  const elipse = Array.from({ length: 41 }, (_, i) => { const t = Math.PI - (Math.PI * i) / 40; return { x: r2(A * Math.cos(t)), y: r2(Y0 + B * Math.sin(t)) }; });
  const guirnalda: Pieza = { tipo: "guirnalda", guirnalda: { formatoId: "R-12", infladoCm: 25, patron: "un_color", colores: ["031"], anchoCm: 0, caidaCm: 0, recorrido: elipse } };
  // Los collares violeta, a medio paso entre cuartetos, con la normal a lo largo del eje (el armado reparte los niveles
  // de punta a punta).
  const largoEje = elipse.slice(1).reduce((s, p, i) => s + Math.hypot(p.x - elipse[i]!.x, p.y - elipse[i]!.y), 0);
  const niveles = Math.max(2, Math.round(largoEje / 20) + 1);
  const enEje = (sCm: number): { p: Vec3; t: Vec3 } => {
    let resto = sCm;
    for (let i = 1; i < elipse.length; i++) {
      const a = elipse[i - 1]!, b = elipse[i]!;
      const l = Math.hypot(b.x - a.x, b.y - a.y);
      if (resto <= l || i === elipse.length - 1) { const f = Math.min(1, resto / l); return { p: v(r2(a.x + (b.x - a.x) * f), r2(a.y + (b.y - a.y) * f), 0), t: unitario(v(b.x - a.x, b.y - a.y, 0)) }; }
      resto -= l;
    }
    return { p: v(0, 0, 0), t: v(1, 0, 0) };
  };
  const collar = deco(anillo(R("R-5", 10, "051"), 4, 0, 45));
  const collares = Array.from({ length: niveles - 1 }, (_, k) => enEje(((k + 0.5) * largoEje) / (niveles - 1)));
  const metalink = globo(R("R-12", 25, "080"), ARANA_METALINK);
  const pies: Array<[number, number]> = [[160, 175], [195, 200], [248, 205], [600, 190], [570, 200], [522, 200]];
  const ojo = (giro: number): Pieza => deco({ tipo: "ojo", propiedades: { globo: R("R-12", 25, "031"), estilo: OJO_SALTON, miradaGrados: giro } });
  const NARANJA = "#fb7a0a", ESQUELETO = "#f6f3ea";
  const postes: ElementoEscenografia[] = [-82, 80].flatMap((x) => [
    cilindro(v(x, 0, 0), 8, 150, NARANJA, "brillante"),
    // La telaraña de algodón que envuelve cada poste.
    cilindro(v(x + (x < 0 ? -6 : 6), 30, 4), 14, 110, "#f4f4f4", "tela", 6),
  ]);
  const MESA = 76;
  const mesa: ElementoEscenografia[] = [
    ...mesaConMantel({ anchoCm: 158, fondoCm: 70, altoCm: MESA, mantel: "#f6a24a" }),
    // El esqueleto de papel colgado al frente y la guirnalda de murciélagos.
    caja(v(0, 52, 36.5), v(14, 14, 0.5), ESQUELETO, "papel"), caja(v(0, 30, 36.5), v(10, 28, 0.5), ESQUELETO, "papel"),
    tablon(v(-5, 40, 36.8), v(-18, 22, 36.8), 2.5, 0.4, ESQUELETO, "papel"), tablon(v(5, 40, 36.8), v(18, 22, 36.8), 2.5, 0.4, ESQUELETO, "papel"),
    tablon(v(-3, 16, 36.8), v(-7, -4, 36.8), 2.5, 0.4, ESQUELETO, "papel"), tablon(v(3, 16, 36.8), v(7, -4, 36.8), 2.5, 0.4, ESQUELETO, "papel"),
    ...Array.from({ length: 12 }, (_, k) => caja(v(-75 + k * 13.6, 64 - 10 * Math.sin((Math.PI * k) / 11), 36.8), v(9, 3, 0.4), "#1a1a1a", "papel")),
    // Dulces y adornos de la mesa: calabazas de dulces, sombreros de bruja, cupcakes.
    ...[-60, -35, 30, 55].map((x, k) => cilindro(v(x, MESA, -10 + (k % 2) * 12), 9, 12, ["#f07a1a", "#f5a33a"][k % 2]!, "brillante")),
    ...[-18, 18].map((x) => cilindro(v(x, MESA, -18), 8, 18, "#1f1f1f", "mate", 0.5)),
    ...[-10, 0, 10, 20].map((x) => cilindro(v(x, MESA, 12), 3, 5, "#6b3f2a", "papel")),
  ];
  const fondo: ElementoEscenografia[] = [
    caja(v(4, 95, 0), v(130, 190, 2), "#394b33", "tela"),
    // Los círculos de papel y las calabazas colgadas.
    disco(42, 168, 7, 1.5, "#f2782a", "papel", { dibujo: "calabaza", hex: "#1a1a1a" }), disco(42, 135, 7, 1.5, "#f2782a", "papel", { dibujo: "calabaza", hex: "#1a1a1a" }),
    disco(42, 112, 5, 1.5, "#f4c13a"), disco(4, 128, 4, 1.5, "#7c3fa8"), disco(-28, 143, 4, 1.5, "#58c03a"), disco(4, 145, 7, 1.5, "#b39adb"),
  ];
  const bruja: ElementoEscenografia[] = [disco(0, 0, 12, 0, "#e9e4dc", "papel"), { forma: "panel", contorno: [{ x: -18, y: 8 }, { x: 18, y: 8 }, { x: 0, y: 34 }], zCm: 0.5, grosorCm: 1, hex: "#1d1d1d", acabado: "papel" }];
  return {
    sala: sala(420, 360, 280, { piso: "#9a958e", paredes: "#e8e8e6", techo: "#f4f4f2" }),
    nodos: [
      { id: "arco", nombre: "Arco de cuartetos verde lima", pieza: guirnalda, colocacion: libre(0, 0, -95) },
      ...collares.map(({ p, t }, k) => sobreEn(`collar-${k + 1}`, `Collar de R-5 violeta ${k + 1}`, "arco", collar, p, t)),
      ...pies.map(([x, y], k) => sobreCentrada(`metalink-${k + 1}`, `R-12 negro Araña Metalink (pie ${k < 3 ? "izquierdo" : "derecho"} ${(k % 3) + 1})`, "arco", metalink, px(x, y, 12), AL_FRENTE)),
      { id: "postes", nombre: "Postes naranjas con telaraña", pieza: escenografia(postes), colocacion: libre(0, 0, -95) },
      { id: "fondo", nombre: "Fondo de telarañas con círculos de papel", pieza: escenografia(fondo), colocacion: libre(0, 0, -150) },
      { id: "mesa", nombre: "Mesa de faldón naranja con el esqueleto", pieza: escenografia(mesa), colocacion: enPiso(-7, -100) },
      { id: "bruja", nombre: "Bruja de papel", pieza: escenografia(bruja), colocacion: libre(72, 156, -82) },
      // Al pie de los postes: R-12 violeta y globos-ojo verdes.
      { id: "pie-izquierdo", nombre: "R-12 violeta al pie del poste izquierdo", pieza: globo(R("R-12", 25, "051")), colocacion: libre(-100, 17, -70) },
      sobreEn("pie-izquierdo-2", "R-12 violeta al pie del poste izquierdo (detrás)", "pie-izquierdo", globo(R("R-12", 25, "051")), v(-16, 2, -10), v(-0.6, 0.2, -0.7)),
      sobreEn("ojo-izquierdo", "Globo-ojo verde (izquierda)", "pie-izquierdo", ojo(-20), v(4, 22, 6), v(0.1, 0.8, 0.6)),
      { id: "pie-derecho", nombre: "R-12 violeta al pie del poste derecho", pieza: globo(R("R-12", 25, "051")), colocacion: libre(68, 17, -70) },
      sobreEn("pie-derecho-2", "R-12 violeta al pie del poste derecho (detrás)", "pie-derecho", globo(R("R-12", 25, "051")), v(-6, 4, -14), v(-0.3, 0.3, -0.9)),
      sobreEn("ojo-derecho-1", "Globo-ojo verde (derecha, abajo)", "pie-derecho", ojo(200), v(22, 0, 8), v(0.9, 0.1, 0.4)),
      sobreEn("ojo-derecho-2", "Globo-ojo verde (derecha, arriba)", "pie-derecho", ojo(160), v(12, 26, 4), v(0.4, 0.8, 0.4)),
    ],
  };
};

// ----------------------------------------------------------------------------------------------------------
// Las 10 ideas
// ----------------------------------------------------------------------------------------------------------

/** Ideas de fiesta de sempertex.com digitalizadas: lote 11. */
export const LOTE_11: readonly IdeaDigitalizada[] = [
  idea({
    numero: 458, slug: "cumpleano-de-m-ms", nombre: "Cumpleaños de M&M: malla frambuesa sobre la mesa de dulces", ocasiones: ["general"],
    fotoUrl: FOTO("4ce80d1140bd93b3c6f363923394e863.jpg"),
    contenido: () => ESCENA(escena458()),
    nota: "Igual: la malla en rombos de R-5 Fashion Frambuesa 014 (medido #c51048, ΔE 9) con un nudo de R-5 Fashion Amarillo 020 en cada cruce (medido #d5d405), de 4,4 m × 46 cm a la altura de las caras de los M&M (3 filas de nudos a la vista a 17,5 px; globo de ~17 px a 1,55 px/cm ≈ 11 cm), detrás de la mesa de dulces de 4 m (baldosas de 40 cm y mesa de 76 cm: 1,75 px/cm) con faldón negro y 8 gotas sobre el amarillo, los 6 dispensadores de colores, la fila de dulces y los dos M&M gigantes de cartón (rojo a la izquierda, naranja a la derecha) con sus brazos; piso de terracota y pared celeste. No publica productos: colores medidos. Distinto: la malla es la de Link-O-Loon de Sempertex hecha con R-5 (la foto usa redondos: el frambuesa no se fabrica en Link-O-Loon) y lleva una pareja de R-5 amarilla por nudo (en la foto se ve uno; algunos nudos parecen verde lima); la altura de la malla se dedujo de la perspectiva (~1,3–1,75 m); los M&M, dispensadores y dulces son escenografía sencilla (sin caras dibujadas).",
  }),
  idea({
    numero: 471, slug: "decoracion-corazones-brillantes", nombre: "Corazones Brillantes: arco rosado con cortina dorada", ocasiones: ["san-valentin"],
    fotoUrl: FOTO("Decoracion-Corazones-Brillantes.jpg"),
    publicados: [
      { nombre: "GLOBO REDONDO INFINITY® CORAZONES BRILLANTES", url: "/products/globo-para-fiesta-latex-redondo-infinity-corazones-brillantes-fashion-metal-surtido", formato: "R-12", codigo: null },
      { nombre: "GLOBO REDONDO FASHION PALO DE ROSA", url: "/products/globo-para-fiesta-latex-redondo-fashion-palo-de-rosa", formato: "R-12", codigo: "010" },
      { nombre: "GLOBO REDONDO PASTEL MATE ROSADO", url: "/products/globo-para-fiesta-latex-redondo-pastel-mate-rosado", formato: "R-12", codigo: "609" },
    ],
    contenido: () => ESCENA(escena471()),
    nota: "Igual: arco rectangular orgánico de ~3,2 × 2,6 m (R-24 de 130–160 px y R-12 de ~70 px: 2,75 px/cm) en los publicados —Pastel Mate Rosado 609 de fondo, Palo de Rosa 010 en los R-5 y en unos R-12 de arriba— con los impresos Infinity® Corazones Brillantes en la proporción contada (de ~95 R-12 de frente, 23 impresos), 3 R-24 rosados donde la foto, la cortina de flecos dorada en tres paños, dos huacales de pie con el banderín «FELIZ ♥ DÍA» (cartel de letras Corazones Brillantes), el plato, los vasos y las servilletas Corazones Brillantes de la tienda y el tapete rosado. Distinto: el surtido de la tienda trae rosado, dorado rosa, dorado y satín rosado: los rojizos van en Metal Dorado Rosa 568 (el más cercano, ΔE 18), los caqui y los dorados en Metal Dorado 570 y los durazno en Fashion Rosado 009; la foto lleva los R-5 en tríos y aquí van sueltos por el arco (el relleno en tríos daba cientos); las patas de la foto son más anchas y planas (~1,2 m) que el tubo del motor; el motor da los globos para el grosor medido (no se cuentan uno a uno).",
  }),
  idea({
    numero: 473, slug: "decoracion-corazones-surtidos", nombre: "Corazones surtidos: aro orgánico y ramo de corazones", ocasiones: ["san-valentin"],
    fotoUrl: FOTO("Decoracion-Corazones-Surtidos.jpg"),
    publicados: [
      { nombre: "GLOBO REDONDO FASHION FRAMBUESA", url: "/products/globo-para-fiesta-latex-redondo-fashion-frambuesa", formato: "R-12", codigo: "014" },
      { nombre: "GLOBO LATEX REDONDO REFLEX DORADO", url: "/products/globo-para-fiesta-latex-redondo-reflex-dorado", formato: "R-12", codigo: "970" },
      { nombre: "GLOBO REDONDO FASHION LATTE", url: "/products/globo-para-fiesta-latex-redondo-fashion-latte", formato: "R-12", codigo: "073" },
    ],
    contenido: () => ESCENA(escena473()),
    nota: "Igual: aro orgánico de ~2,9 m apoyado en el piso (R-12 de 60–65 px: 2,6 px/cm) con banda de ~80 cm en cromado magenta (Reflex Fucsia 912), cobrizo (el Reflex Dorado 970 publicado), frambuesa (el 014 publicado), Pastel Mate Rosado 609 (medido #f3d8de, ΔE 3,8) e impresos Infinity® Corazones Brillantes rosados claros (009) y fuertes (409), un R-18 cromado a la derecha y el banderín «FELIZ ♥ DÍA»; el ramo con helio de 2 R-12 Latte 073 (publicado) y 2 cobrizos con 4 corazones metalizados de 18 pulgadas (3 fucsia y uno rosa oro), amarrado a su peso (R-24 rosado, 2 magentas y 2 frambuesas); escalera repisa blanca con platos y vasos, pedestal blanco con espirales moradas, la cajita LOVE, el letrero LOVE y el tapete de lentejuelas fucsia. Distinto: los cromados engañan (reflejan): el cobrizo mide como Reflex Dorado Rosa 968 y va el Reflex Dorado publicado, y el frambuesa de la foto mide como Neón Fucsia (#e450a0) y va el Frambuesa publicado; los corazones del ramo son de látex cromado (no hay corazón Reflex en la tabla): van como metalizados; faltan las calcomanías de corazón pegadas en los globos; el motor da los globos del aro (no se cuentan uno a uno).",
  }),
  idea({
    numero: 476, slug: "decoracion-feliz-ano-nuevo", nombre: "Feliz Año Nuevo: guirnalda negra y plata con ramo", ocasiones: ["navidad"],
    fotoUrl: FOTO("Decoracion_Feliz_Ano_Nuevo.png"),
    publicados: [
      { nombre: "GLOBO LATEX REDONDO REFLEX PLATA", url: "/products/globo-para-fiesta-latex-redondo-reflex-plata", formato: "R-12", codigo: "981" },
      { nombre: "GLOBO REDONDO FASHION NEGRO", url: "/products/globo-para-fiesta-latex-redondo-fashion-negro", formato: "R-12", codigo: "080" },
      { nombre: "GLOBO LATEX REDONDO REFLEX DORADO", url: "/products/globo-para-fiesta-latex-redondo-reflex-dorado", formato: "R-5", codigo: "970" },
      { nombre: "GLOBO REDONDO FASHION ARENA", url: "/products/globo-para-fiesta-latex-redondo-fashion-arena", formato: "R-12", codigo: "071" },
      { nombre: "GLOBO REDONDO FASHION GRIS", url: "/products/globo-para-fiesta-latex-redondo-fashion-gris", formato: "R-12", codigo: "081" },
    ],
    contenido: () => ESCENA(escena476()),
    nota: "Igual: la guirnalda orgánica en L invertida (R-24 impreso de 242 px ≈ 60 cm: 4 px/cm) que cruza lo alto y baja por la derecha hasta el piso, en los publicados —Reflex Plata 981, Fashion Negro 080, Gris 081, Arena 071 y racimos de R-5 Reflex Dorado 970 diminutos (~7 cm)— con R-18 plata y arena abajo a la derecha; el R-24 negro Infinity® Feliz Año Estrellas de la tienda arriba a la izquierda; el ramo de 5 R-12 con helio —Feliz Año Estrellas dorado y plata, uno negro de estrellas, uno negro y uno blanco— con un metalizado redondo, sobre su peso orgánico de dorados, arena, gris, plata y negro; la cortina de flecos dorada, el cartel «Feliz Año», las 3 mesas de marco plateado (60, 87 y 80 cm) con hortensias, cupcakes, platos y vasos, y 5 toppers «Feliz Año». Distinto: el negro de lunares dorados y el blanco de estrellas doradas del ramo no están en la tienda (van lisos) y el negro de estrellas lleva el «Feliz Año» de su impreso; el Reflex Dorado se publica como R-12 y en la foto son R-5 (y 4 R-12); el motor da los globos de la guirnalda (no se cuentan uno a uno) y sus R-9 de relleno.",
  }),
  idea({
    numero: 478, slug: "decoracion-mesa", nombre: "Mesa de Halloween: columnas de techo con arañas", ocasiones: ["halloween"],
    fotoUrl: FOTO("78d91cba2ceba7999de7029ff1b63408_95f329c1-7fb3-468f-bc21-bbee8fed1e86.jpg"),
    contenido: () => ESCENA(escena478()),
    nota: "Igual: las 4 columnas que cuelgan del techo (R-12 negros de ~52 px: 2,1 px/cm), con sus módulos contados de la foto —la de fuera a la izquierda, R-12 negros entre collares de R-5 Amarillo Miel 021 (medido #ffac06); la de dentro, R-9 negros con collares de R-5 Fashion Naranja 061 (#fe7f06); la del centro, y la de la derecha de pares de R-12 negros y pares de R-5—, cada una con su araña grande (cuerpo R-12, cabeza R-9 con ojos rojos y 8 patas de T-260 negro), 3 arañitas colgando bajo la del centro, las 2 columnas de 5 cuartetos de la mesa (~1,1 m) en espiral de negro y naranja impreso Infinity® Happy Halloween (el más parecido de la tienda) con 3 aros de tubito Fashion Violeta 051 cada una y 5 arañitas trepando, la mesa de faldón naranja y tapa morada y las 8 calabacitas de R-5 naranja con tallo de T-260 verde en una torre de 3 pisos. No publica productos: colores medidos. Distinto: los impresos naranjas de la foto llevan puntitos y arañitas negras (aquí el Happy Halloween, con su letrero); los módulos de las columnas se apoyan unos en otros (la altura total sale igual a ±5 cm); en la foto hay más arañitas por la mesa y los pisos de la torre no se ven; el techo de la foto no sale (se supuso a 2,9 m).",
  }),
  idea({
    numero: 479, slug: "decoracion-mundialista", nombre: "Arco mundialista con balones", ocasiones: ["general"],
    fotoUrl: FOTO("MUNDIAL_JPG_ea70eebc-33c9-44d2-8c97-50a652e00d6a.jpg"),
    publicados: [
      { nombre: "GLOBO REDONDO INFINITY FUTBOLMANÍA BLANCO", url: "/products/globo-redondo-infinity-futbolmania-blanco", formato: "R-12", codigo: null },
      { nombre: "GLOBO INFINITY® BALÓN DE FUTBOL", url: "/products/globo-para-fiesta-latex-redondo-infinity-balon-de-futbol-fashion-blanco", formato: "R-24", codigo: null },
      { nombre: "GLOBO REDONDO FASHION VERDE LIMA", url: "/products/globo-para-fiesta-latex-redondo-fashion-verde-lima", formato: "R-12", codigo: "031" },
      { nombre: "GLOBO REDONDO FASHION NEGRO", url: "/products/globo-para-fiesta-latex-redondo-fashion-negro", formato: "R-12", codigo: "080" },
      { nombre: "GLOBO REDONDO FASHION BLANCO", url: "/products/globo-para-fiesta-latex-redondo-fashion-blanco", formato: "R-12", codigo: "005" },
      { nombre: "GLOBO TUBITO FASHION VERDE LIMA", url: "/products/globo-para-fiesta-latex-tubito-fashion-verde-lima", formato: "T-260", codigo: "031" },
    ],
    contenido: () => ESCENA(escena479()),
    nota: "Igual: el arco asimétrico de ~2 × 2,3 m (balones de 115–120 px ≈ 55 cm: 2,15 px/cm) con los productos publicados: la pata izquierda de 3 balones R-24 Infinity® Balón de Fútbol apilados en curva sobre un montículo de R-12 Verde Lima 031, con un trébol de 4 burbujas de T-260 Verde Lima entre balón y balón y otro suelto en el hueco; la corona orgánica verde lima (R-12 y R-5), la pata derecha negra (080) que pasa a blanca (005) hasta el piso y los 7 R-12 Infinity Futbolmanía repartidos como en la foto (2 en la corona, 2 en lo negro y 3 en lo blanco). Distinto: el verde de la foto mide más neón (#abec5b → Neón Verde 230) y va el Verde Lima publicado; el arco son tres estructuras (verde, negro y blanco), no una, porque el motor orgánico reparte los colores en toda la pieza; el motor da los globos de cada tramo (no se cuentan uno a uno); el impreso de balón de la tienda se cataloga en R-12 y aquí va en R-24 (la tienda también lo vende en R-24).",
  }),
  idea({
    numero: 498, slug: "dia-del-arbol", nombre: "Día del Árbol: árbol de globos", ocasiones: ["general"],
    fotoUrl: FOTO("Dia_del_Arbol.jpg"),
    publicados: [
      { nombre: "GLOBO REDONDO FASHION EUCALIPTO", url: "/products/globo-para-fiesta-latex-redondo-fashion-eucalipto", formato: "R-12", codigo: "027" },
      { nombre: "GLOBO REDONDO FASHION VERDE", url: "/products/globo-para-fiesta-latex-redondo-fashion-verde", formato: "R-12", codigo: "030" },
      { nombre: "GLOBO REDONDO FASHION VERDE LIMA", url: "/products/globo-para-fiesta-latex-redondo-fashion-verde-lima", formato: "R-12", codigo: "031" },
      { nombre: "GLOBO REDONDO FASHION VERDE SELVA", url: "/products/globo-para-fiesta-latex-redondo-fashion-verde-selva", formato: "R-12", codigo: "032" },
      { nombre: "GLOBO REDONDO FASHION CHOCOLATE", url: "/products/globo-para-fiesta-latex-redondo-fashion-chocolate", formato: "R-12", codigo: "076" },
      { nombre: "GLOBO REDONDO FASHION CAFÉ", url: "/products/globo-para-fiesta-latex-redondo-fashion-cafe", formato: "R-12", codigo: "074" },
    ],
    contenido: () => ESCENA(escena498()),
    nota: "Igual: árbol de ~2,7 m (R-12 de la copa de 75–80 px y tubito de ~16 px: 3,2 px/cm) con base de ~1,1 m y tronco de ~1,3 m de R-12 Fashion Chocolate 076 a ~18 cm (el publicado más cercano: medido #564228, ΔE 11), 4 tubitos café enroscados al tronco desde la base y la copa de ~1,7 × 1,4 m de R-12 en los 4 verdes publicados en la proporción contada de frente —Verde 030 (22), Verde Selva 032 (16), Eucalipto 027 (16) y Verde Lima 031 (14)—. Distinto: el café publicado es el R-12 y en la foto el café está en los tubitos: van T-260 Fashion Café 074 (el R-12 café queda sin cantidad); la copa es una esfera achatada (en la foto, más plana abajo e irregular); los tubitos de la foto se cruzan sueltos y aquí son 4 espirales de vuelta y cuarto; el verde vivo de la foto (#00ba4f) es más trébol que el Verde 030 publicado.",
  }),
  idea({
    numero: 515, slug: "el-principito", nombre: "El Principito: pared azul con estrellas doradas", ocasiones: ["cumpleanos"],
    fotoUrl: FOTO("9afe2a8b2e488642399e9d17fdda4224.jpg"),
    contenido: () => ESCENA(escena515()),
    nota: "Igual: la pared de globos de 3,56 × 2,28 m (mesa de 81 cm a 1,6 px/cm) en retícula de R-9 a 16,5 cm (~25 px) con un R-5 en cada hueco, en Fashion Azul 040, las 11 estrellas metalizadas doradas de ~31 cm contadas y puestas donde la foto (manchas amarillas) con sus cintas hasta la mesa, la mesa de mantel rojo con el paño azul y el banderín «MICAEL», el pastel de maletas con su vela, los dulceros y 2 estrellas blancas recortadas. No publica productos: colores medidos. Distinto: el azul medido (#0186d5) queda entre Metal Azul 540 y Fashion Azul 040 (ΔE 15–26: la luz de fondo lo vuelve cian en el centro) y se tomó el Fashion, de pared; la foto parece llevar los R-9 en filas algo desordenadas; las estrellas son de 13 pulgadas (la tienda las vende de 18); el pastel y los dulces son escenografía sencilla.",
  }),
  idea({
    numero: 539, slug: "fantasia-metalizada", nombre: "Fantasía metalizada: columna orgánica con tubitos plata", ocasiones: ["general"],
    fotoUrl: FOTO("Fantasia-Metalizada_82c97ad6-f62c-4643-8513-7efe07956bcd.jpg"),
    publicados: [
      { nombre: "GLOBO REDONDO FASHION FRAMBUESA", url: "/products/globo-para-fiesta-latex-redondo-fashion-frambuesa", formato: "R-12", codigo: "014" },
      { nombre: "GLOBO LATEX REDONDO REFLEX PLATA", url: "/products/globo-para-fiesta-latex-redondo-reflex-plata", formato: "R-12", codigo: "981" },
    ],
    contenido: () => ESCENA(escena539()),
    nota: "Igual: columna de ~2 m (R-24 de 145 px ≈ 56 cm: 2,6 px/cm): base orgánica ancha (~1,2 m) y racimo arriba en Fashion Frambuesa 014 y Reflex Plata 981 (los publicados) y cromado cobre, el tallo de R-5 en espiral de los tres colores (6 niveles, de ~60 a 115 cm), el R-24 frambuesa encima, 3 tirabuzones de T-260 plata arriba a la izquierda (finos, como T-160: el plata no se fabrica en T-160), 3 capullos de tubito plata y el moño de 3 lazos de T-260 plata con su moñito cobre en la base. Distinto: el cobre no está entre los productos publicados: medido #d28467 → Reflex Dorado Rosa 968; el motor da los globos de la base y del racimo (no se cuentan uno a uno); el R-24 queda ~10 cm más bajo (se apoya en el racimo); falta el bichito de tubito plata de la derecha.",
  }),
  idea({
    numero: 573, slug: "fiesta-en-halloween", nombre: "Fiesta en Halloween: arco verde lima sobre la mesa", ocasiones: ["halloween"],
    fotoUrl: FOTO("fb4d3a1893de65f5c86d1e2e7be84aad_4d6a9247-d977-469a-842a-dab0ee3dfe11.jpg"),
    contenido: () => ESCENA(escena573()),
    nota: "Igual: el arco de 13 cuartetos de R-12 Fashion Verde Lima 031 (~25 cm: mesa de 76 cm a 2,37 px/cm) con un collar de 4 R-5 Fashion Violeta 051 entre cuarteto y cuarteto (12), de lo alto de los dos postes naranjas (~1,5 m) a ~2,3 m; 3 R-12 negros con el impreso Infinity® Araña Metalink de la tienda en cada pie; al pie de los postes, R-12 violeta y 3 globos-ojo verdes; el fondo verde oscuro de telarañas con círculos de papel, la mesa de faldón naranja con el esqueleto y los murciélagos de papel, la bruja de la esquina, las telarañas de algodón de los postes y dulces. No publica productos: colores medidos (el verde de la foto sale quemado: #bafda7 → Verde Lima, el más cercano; violeta #231c86 → Violeta 051). Distinto: los postes, la bruja, las telarañas y lo de la mesa son escenografía sencilla; los ojos de la foto son calcomanías sobre globos verdes (aquí, ojos saltones impresos); la trenza gira 1/8 por nivel.",
  }),
];
