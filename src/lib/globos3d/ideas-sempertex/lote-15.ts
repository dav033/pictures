import type { IdeaDigitalizada, ProductoDeIdea } from "./tipos";
import { fuenteIdea, type FuenteIdea } from "./fuentes";
import { ocasionesDeEtiquetas } from "./index";
import { armarEscena, HUNDIMIENTO_SOBRE_CM, SALA_INICIAL, type Colocacion, type Escena, type NodoEscena, type Sala } from "../escena";
import { armarPieza, type Pieza } from "../piezas";
import { centroCuerpo } from "../geometria";
import { formatoPorId } from "../formatos";
import { sumarMateriales } from "../mezcla";
import { GLOBOS_TIENDA, productoDeGlobo } from "../productos-tienda";
import { tapete, type ElementoEscenografia } from "../escenografia";
import { opcionesArcoRectangular, opcionesRacimosLibres, type RacimoLibre } from "../estructuras-organicas";
import type { ColorOrganico, OpcionesOrganico, PuntoMezcla, RellenoOrganico } from "../organico";
import type { PatronColumna } from "../columnas";
import type { ParteGlobo, PropiedadesFlor } from "../decoraciones";
import type { AnilloTubito, Decoracion } from "../figuras";
import type { EstiloOjo, PropiedadesArana } from "../halloween";
import type { PropiedadesRizo } from "../rizos";
import type { InteriorBurbuja } from "../burbujas";
import { metalizadoDeTienda, type OpcionesMetalizado } from "../metalizados";
import { impresoPorId, type ImpresoEnPieza } from "../impresos-catalogo";
import type { Vec3 } from "../modulos";

/**
 * Ideas de fiesta de sempertex.com digitalizadas: **lote 15** (los números de `clasif/lote-15.json`): estructuras que
 * antes quedaban «a medias» y que ahora cubren los generadores nuevos —tres árboles (#35 de corazones, #45 cono de
 * cuartetos, #57 silvestre), el árbol de Navidad con guirnalda en espiral (#41), nueve arcos (#76 corazones, #78 amor y
 * flores, #91 feliz cumpleaños, #92 feliz día, #98 Halloween, #114 navideño, #127 orgánico rosa, #134 y #135 primera
 * comunión), el aro de arañas (#149) y el arreglo de calabaza (#152)—, todas como escena con su sala.
 *
 * Cómo se hizo (2026-10-08), idea por idea, con su foto (`fotos/<slug>--0.*`) abierta, recortada y ampliada con rejilla:
 * - **Escala**: la de un globo de tamaño conocido en la misma foto (R-5 ≈ 12 cm, R-9 ≈ 18–22 cm, R-12 ≈ 25–28 cm, el
 *   Link-O-Loon de nudo a nudo 1,47 × su inflado, la estrella metalizada de 18" ≈ 45 cm, la flor metalizada de 27") y con
 *   ella alturas, anchos, tamaños y posiciones (px → cm, dichas en el comentario de cada idea).
 * - **Conteo**: niveles de cuartetos, eslabones, racimos, acentos, ojos, adornos y corazones contados uno a uno. Ninguna
 *   idea del lote publica «Materiales» con cantidades: todo lo contado va con `contada: true`. En lo orgánico el motor da
 *   los globos para el grosor y el largo medidos (no se cuentan uno a uno: la nota lo dice).
 * - **Niveles**: en las fotos los cuartetos van casi siempre más juntos que el paso del taller (0,8 diámetros). Para
 *   respetar los niveles contados Y la medida real, cada nivel es su propia columna de un nivel puesta a la altura (o en
 *   el punto del camino) medida en la foto, girada 1/8 de vuelta sobre el anterior, como en el lote 05. Cuando la foto
 *   va al paso del taller (el tronco de #35), es una sola columna.
 * - **Colores**: si la idea publica productos, se usan ESOS códigos (aunque la foto mida otra cosa: la nota lo dice). Si
 *   no, se midió en la foto (Python/PIL: mediana de un parche sin brillos, ΔE76 en Lab contra `hexGlobo` de la tabla
 *   oficial) y se tomó el código más cercano que se fabrica en ese formato; si un Fashion queda a ≤ 6 ΔE del más
 *   cercano, el Fashion. Las fotos viejas (740 × 570) vienen sobresaturadas: se dice cuando pesa.
 * - **Impresos y metalizados**: los de la tienda (`impresos-catalogo.ts`, `metalizados.ts`) cuando la foto los tiene;
 *   si la tienda no trae ese impreso (lunares, «1», arañas sobre verde, «Mi Primera Comunión» Reflex Dorado), va el liso
 *   de su color de fondo; si no trae el metalizado (Linky, Papá Noel), el más parecido o uno genérico sin producto. La
 *   nota lo dice.
 * - **Jerarquía**: cada estructura de globos es un nodo raíz (suelto, en su sitio) y lo suyo cuelga de ella por un
 *   **amarre** (un disquito de cinta, escenografía sin globos, `sobre` la raíz): lo que cuelga del amarre queda
 *   exactamente donde lo pone la foto, sin que el contacto con los globos lo corra. Así la biblioteca saca «esta
 *   estructura con sus decoraciones» (niveles, acentos, eslabones, metalizados, figuras). La escenografía (el pino de
 *   #41, su tapete) va aparte.
 * Unidades: cm. Mundo: y arriba desde el piso, x a la derecha de quien mira, +z hacia quien mira.
 */

// ----------------------------------------------------------------------------------------------------------
// Geometría
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
const ABAJO = v(0, -1, 0);
const AL_FRENTE = v(0, 0, 1);
/** Una dirección en el plano de la foto (x, y) con un poco de frente. */
const enPlano = (x: number, y: number, z = 0): Vec3 => unitario(v(x, y, z));

const R = (formatoId: string, infladoCm: number, codigo: string): ParteGlobo => ({ formatoId, infladoCm, codigo });
const libre = (xCm: number, yCm: number, zCm: number): Colocacion => ({ en: "libre", xCm: r2(xCm), yCm: r2(yCm), zCm: r2(zCm), giroGrados: 0 });
const sala = (anchoCm: number, fondoCm: number, altoCm: number, tonos?: Partial<Sala["tonos"]>): Sala =>
  ({ ...structuredClone(SALA_INICIAL), anchoCm, fondoCm, altoCm, tonos: { ...SALA_INICIAL.tonos, ...tonos } });

/**
 * El marco de una pieza puesta `sobre` con la normal `n` (en el mundo): su +y local mira hacia la normal, su x local
 * queda horizontal (o a lo largo de x si la normal es vertical) y `giroGrados` la gira sobre la normal (el marco de
 * `escena.ts`). Devuelve cómo pasa un vector local al mundo.
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

/** Puntos a lo largo de una polilínea, a las distancias `s` (cm) desde su inicio, con su tangente. */
function aLoLargo(puntos: readonly Vec3[], s: readonly number[]): Array<{ p: Vec3; t: Vec3 }> {
  const tramos = puntos.slice(1).map((b, i) => ({ a: puntos[i]!, b, l: largo(menos(b, puntos[i]!)) }));
  return s.map((d) => {
    let resto = d;
    for (const [k, tr] of tramos.entries()) {
      if (resto <= tr.l || k === tramos.length - 1) {
        const f = tr.l > 0 ? Math.min(1, Math.max(0, resto / tr.l)) : 0;
        return { p: mas(tr.a, por(menos(tr.b, tr.a), f)), t: unitario(menos(tr.b, tr.a)) };
      }
      resto -= tr.l;
    }
    return { p: puntos[0]!, t: v(0, 1, 0) };
  });
}
const largoPolilinea = (puntos: readonly Vec3[]): number => puntos.slice(1).reduce((s, b, i) => s + largo(menos(b, puntos[i]!)), 0);

/** Una elipse del plano de la foto (centro, semiejes) de `desde` a `hasta` grados (0° = derecha, 90° = arriba). */
function elipse(centro: Vec3, a: number, b: number, desde: number, hasta: number, n = 96): Vec3[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = rad(desde + ((hasta - desde) * i) / n);
    return v(centro.x + a * Math.cos(t), centro.y + b * Math.sin(t), centro.z);
  });
}

// ----------------------------------------------------------------------------------------------------------
// Piezas
// ----------------------------------------------------------------------------------------------------------

/** Un globo suelto (el centro de su cuerpo en el origen, el cuerpo hacia +y); con `impresoId`, con su impreso. */
const globo = (g: ParteGlobo, impresoId?: string): Pieza =>
  ({ tipo: "globo", formatoId: g.formatoId, infladoCm: g.infladoCm, codigo: g.codigo, ...(impresoId ? { impresos: [{ impresoId, globos: [0] }] } : {}) });
/** Un nivel de cuarteto: una columna de un nivel (su origen es el centro del cuarteto). */
const cuarteto = (g: ParteGlobo, colores: string[], patron: PatronColumna = "un_color", impresos?: ImpresoEnPieza[]): Pieza =>
  ({ tipo: "columna", formatoId: g.formatoId, infladoCm: g.infladoCm, alturaCm: r2(g.infladoCm * 0.8), patron, colores, ...(impresos?.length ? { impresos } : {}) });
const deco = (decoracion: Decoracion): Pieza => ({ tipo: "decoracion", decoracion });
const flor = (p: PropiedadesFlor): Decoracion => ({ tipo: "flor", propiedades: p });
/** Un anillo de `cantidad` globos iguales alrededor de un centro (racimo de 4 R-5, pareja de R-5). */
const anillo = (g: ParteGlobo, cantidad: number, aperturaGrados = 0, giroGrados = 0): Decoracion =>
  flor({ petalos: { ...g, cantidad, aperturaGrados, giroGrados }, centro: null });
const lazos = (formatoId: string, grosorCm: number, codigos: string[], cantidad: number, largoCm: number, anchoCm: number, aperturaGrados: number, giroGrados: number): AnilloTubito =>
  ({ formatoId, grosorCm, codigos, cantidad, estilo: "lazo", largoCm, anchoCm, aperturaGrados, giroGrados });
const burbujasTubito = (formatoId: string, grosorCm: number, codigos: string[], cantidad: number, largoCm: number, aperturaGrados: number, giroGrados: number): AnilloTubito =>
  ({ formatoId, grosorCm, codigos, cantidad, estilo: "burbuja", largoCm, anchoCm: grosorCm, aperturaGrados, giroGrados });
const florTubito = (petalos: AnilloTubito, interior: AnilloTubito | null = null, centro: ParteGlobo | null = null): Decoracion =>
  ({ tipo: "flor_tubito", propiedades: { petalos, interior, corona: null, centro } });
const rizo = (p: PropiedadesRizo): Decoracion => ({ tipo: "rizo", propiedades: p });
const arana = (p: PropiedadesArana): Decoracion => ({ tipo: "arana", propiedades: p });
const ojo = (g: ParteGlobo, estilo: EstiloOjo, miradaGrados: number): Decoracion => ({ tipo: "ojo", propiedades: { globo: g, estilo, miradaGrados } });
const burbuja = (exterior: ParteGlobo, interiores: InteriorBurbuja[], semilla: number): Decoracion =>
  ({ tipo: "burbuja", propiedades: { exterior, interiores, relleno: null, semilla } });
const metalizado = (m: OpcionesMetalizado): Pieza => ({ tipo: "metalizado", metalizado: m });

/** La pieza como la arma `sobre`: una decoración, sin «de frente». */
const comoSobre = (pieza: Pieza): Pieza => (pieza.tipo === "decoracion" && pieza.deFrente ? { tipo: "decoracion", decoracion: pieza.decoracion } : pieza);

const cilindro = (base: Vec3, radioCm: number, altoCm: number, hex: string, acabado: ElementoEscenografia["acabado"] = "mate", radioArribaCm?: number): ElementoEscenografia =>
  ({ forma: "cilindro", base: redondo(base), radioCm: r2(radioCm), altoCm: r2(altoCm), hex, acabado, ...(radioArribaCm !== undefined ? { radioArribaCm: r2(radioArribaCm) } : {}) });
const escenografia = (elementos: ElementoEscenografia[]): Pieza => ({ tipo: "escenografia", elementos });

// Orgánico.
const colorOrg = (codigo: string, peso: number, formatos?: string[]): ColorOrganico => ({ codigo, peso, ...(formatos ? { formatos } : {}) });
const constante = (pesos: Readonly<Record<string, number>>): PuntoMezcla[] => [{ t: 0, pesos }, { t: 1, pesos }];
const organico = (opciones: OpcionesOrganico, impresos?: ImpresoEnPieza[]): Pieza => ({ tipo: "organico", opciones, flores: null, ...(impresos?.length ? { impresos } : {}) });
type Racimo = { puntos: Vec3[]; radio: number; radioFin?: number; tapas?: { inicio: boolean; fin: boolean } };
/** Racimos orgánicos (tramos de guirnalda) con sus inflados, su mezcla y su relleno. */
function racimos(o: { racimos: Racimo[]; mezcla: Readonly<Record<string, number>>; colores: ColorOrganico[]; semilla: number; inflados: Readonly<Record<string, number>>; relleno: RellenoOrganico[]; suelo?: boolean; densidad?: number }, impresos?: ImpresoEnPieza[]): Pieza {
  const libres: RacimoLibre[] = o.racimos.map((r, k) => ({
    id: `racimo_${k + 1}`, nombre: `Racimo ${k + 1}`, puntos: r.puntos.map(redondo), radioInicioCm: r.radio, radioFinCm: r.radioFin ?? r.radio,
    mezcla: constante(o.mezcla), tapas: r.tapas ?? { inicio: true, fin: true },
  }));
  const opciones = opcionesRacimosLibres({ racimos: libres, colores: o.colores, semilla: o.semilla, suelo: o.suelo ?? true, relleno: o.relleno });
  return organico({ ...opciones, inflados: { ...o.inflados }, ...(o.densidad ? { densidad: o.densidad } : {}) }, impresos);
}

/**
 * Los colores de una pieza orgánica por fracción DENTRO de cada formato (lo contado en la foto: «los grandes, cristal;
 * los R-12, 40 % naranja…»). El motor reparte por cuotas sobre el total; como la geometría no depende de los colores, se
 * arma una vez para contar los globos de cada formato y cada fracción se vuelve un peso sobre el total (como el lote 11).
 */
function coloresPorFormato(opciones: OpcionesOrganico, reparto: Readonly<Record<string, ReadonlyArray<readonly [string, number]>>>): ColorOrganico[] {
  const cuenta = new Map<string, number>();
  for (const g of armarPieza({ tipo: "organico", opciones: { ...opciones, colores: [colorOrg("005", 1)] }, flores: null }).globos) cuenta.set(g.formatoId, (cuenta.get(g.formatoId) ?? 0) + 1);
  return Object.entries(reparto).flatMap(([formatoId, colores]) => {
    const total = colores.reduce((s, [, f]) => s + f, 0);
    return colores.map(([codigo, f]) => colorOrg(codigo, r2(((cuenta.get(formatoId) ?? 0) * f) / total) || 0.01, [formatoId]));
  });
}

// ----------------------------------------------------------------------------------------------------------
// Montaje: la raíz suelta, su amarre y lo que cuelga de él
// ----------------------------------------------------------------------------------------------------------

type Montaje = {
  nodos: NodoEscena[];
  /** Una pieza con su origen en `origen` (mundo), su +y local hacia `normal` (mundo) y girada `giroGrados` sobre ella. */
  pieza: (id: string, nombre: string, pieza: Pieza, origen: Vec3, normal?: Vec3, giroGrados?: number) => void;
  /** Lo mismo con el centro de su caja en `centro` (mundo). */
  centrada: (id: string, nombre: string, pieza: Pieza, centro: Vec3, normal?: Vec3, giroGrados?: number) => void;
  /** Un globo con el centro de su cuerpo en `centro` y el cuerpo hacia `direccion`. */
  globo: (id: string, nombre: string, g: ParteGlobo, centro: Vec3, direccion?: Vec3, impresoId?: string) => void;
  /** Un eslabón (Link-O-Loon) de nudo a nudo: su nudo en `desde`, hacia `hasta`. */
  eslabon: (id: string, nombre: string, g: ParteGlobo, desde: Vec3, hasta: Vec3) => void;
  /** Un nivel de cuarteto con su centro en `centro`, su eje hacia `eje` y girado `giroGrados` sobre él. */
  nivel: (id: string, nombre: string, g: ParteGlobo, colores: string[], centro: Vec3, eje?: Vec3, giroGrados?: number, patron?: PatronColumna, impresos?: ImpresoEnPieza[]) => void;
  /** Un metalizado de frente (su cara hacia quien mira) con el centro de su caja en `centro`, inclinado `inclinacion` grados. */
  metalizado: (id: string, nombre: string, m: OpcionesMetalizado, centro: Vec3, inclinacionGrados?: number) => void;
};

/**
 * La raíz va suelta en `raiz.en` (mundo), sin girar: su espacio local es el del mundo corrido a ese punto. El amarre va
 * `sobre` ella en `amarreEn` (mundo, en el piso y lejos de sus globos: debajo y encima no puede tener ninguno), con la
 * normal arriba y girado 90°: su espacio queda como el del mundo con z al revés. Lo demás cuelga del amarre.
 */
function montaje(raiz: { id: string; nombre: string; pieza: Pieza; en: Vec3 }, amarreEn: Vec3): Montaje {
  const amarreId = `${raiz.id}-amarre`;
  const nodos: NodoEscena[] = [
    { id: raiz.id, nombre: raiz.nombre, pieza: raiz.pieza, colocacion: libre(raiz.en.x, raiz.en.y, raiz.en.z) },
    {
      id: amarreId, nombre: `Amarre de ${raiz.nombre.charAt(0).toLowerCase()}${raiz.nombre.slice(1)} (no se ve)`,
      pieza: escenografia([{ ...cilindro(v(0, 0, 0), 2, 0.5, "#d6d6d6", "satinado"), oculto: true }]),
      colocacion: { en: "sobre", padreId: raiz.id, puntoCm: redondo(mas(menos(amarreEn, raiz.en), v(0, HUNDIMIENTO_SOBRE_CM, 0))), normal: ARRIBA, giroGrados: 90 },
    },
  ];
  const aAmarre = (p: Vec3): Vec3 => v(p.x - amarreEn.x, p.y - amarreEn.y, -(p.z - amarreEn.z));
  const dirAAmarre = (d: Vec3): Vec3 => v(d.x, d.y, -d.z);
  const pieza = (id: string, nombre: string, p: Pieza, origen: Vec3, normal: Vec3 = ARRIBA, giroGrados = 0) => {
    const n = unitario(normal);
    const punto = mas(origen, por(n, armarPieza(comoSobre(p)).caja.min.y + HUNDIMIENTO_SOBRE_CM));
    nodos.push({ id, nombre, pieza: p, colocacion: { en: "sobre", padreId: amarreId, puntoCm: redondo(aAmarre(punto)), normal: redondo(dirAAmarre(n)), giroGrados: r2(giroGrados) } });
  };
  const centrada = (id: string, nombre: string, p: Pieza, centro: Vec3, normal: Vec3 = ARRIBA, giroGrados = 0) => {
    const c = armarPieza(comoSobre(p)).caja;
    const medio = por(mas(c.min, c.max), 0.5);
    pieza(id, nombre, p, menos(centro, marcoNormal(normal, giroGrados)(medio)), normal, giroGrados);
  };
  return {
    nodos, pieza, centrada,
    globo: (id, nombre, g, centro, direccion = ARRIBA, impresoId) => pieza(id, nombre, globo(g, impresoId), centro, direccion),
    // La pieza `globo` pone el nudo a un medio cuerpo de redondo bajo su origen.
    eslabon: (id, nombre, g, desde, hasta) => { const d = unitario(menos(hasta, desde)); pieza(id, nombre, globo(g), mas(desde, por(d, centroCuerpo("redondo", g.infladoCm))), d); },
    nivel: (id, nombre, g, colores, centro, eje = ARRIBA, giroGrados = 0, patron = "un_color", impresos) => pieza(id, nombre, cuarteto(g, colores, patron, impresos), centro, eje, giroGrados),
    // Con la normal arriba y girado −90°, el frente del metalizado (+z) mira a quien mira y su arriba queda arriba.
    metalizado: (id, nombre, m, centro, inclinacionGrados = 0) => centrada(id, nombre, metalizado(m), centro, v(-Math.sin(rad(inclinacionGrados)), Math.cos(rad(inclinacionGrados)), 0), -90),
  };
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

const clave = (formatoId: string, codigo: string) => `${formatoId}|${codigo}`;

/**
 * Los productos de lo armado (que es lo contado en la foto): los metalizados de la tienda por las veces que quedaron
 * puestos; los impresos de la tienda por producto y por látex (cada pedido de cada pieza, armado solo, dice qué globos
 * toma); y los lisos del resto por formato y código. Lo que la idea publica sale con su nombre y url tal cual (un liso
 * publicado se reconoce por el tipo de globo y el código: el producto de la tienda es uno por color para sus tallas); si
 * la foto no lo tiene, sin cantidad.
 */
function productosDe(escena: Escena, publicados: readonly Publicado[]): ProductoDeIdea[] {
  const armada = armarEscena(escena);
  const salida: ProductoDeIdea[] = [];
  const usados = new Set<Publicado>();
  // Metalizados de la tienda.
  const metalizados = new Map<string, { nombre: string; url: string; cantidad: number }>();
  // Impresos: id → látex → cuántos.
  const impresos = new Map<string, Map<string, number>>();
  for (const nodo of escena.nodos) {
    const copias = armada.porNodo.find((n) => n.id === nodo.id)?.copias ?? 0;
    if (copias === 0) continue;
    if (nodo.pieza.tipo === "metalizado" && nodo.pieza.metalizado.producto) {
      const m = nodo.pieza.metalizado.producto;
      const previo = metalizados.get(m.url) ?? { nombre: m.nombre, url: m.url, cantidad: 0 };
      previo.cantidad += copias;
      metalizados.set(m.url, previo);
    }
    for (const pedido of nodo.pieza.impresos ?? []) {
      const sola = armarPieza({ ...nodo.pieza, impresos: [pedido] });
      const porLatex = impresos.get(pedido.impresoId) ?? new Map<string, number>();
      for (const g of sola.globos.filter((x) => x.estampado?.impreso)) porLatex.set(clave(g.formatoId, g.codigo), (porLatex.get(clave(g.formatoId, g.codigo)) ?? 0) + copias);
      impresos.set(pedido.impresoId, porLatex);
    }
  }
  for (const m of metalizados.values()) {
    const p = publicados.find((x) => x.url === m.url);
    if (p) usados.add(p);
    salida.push({ nombre: p?.nombre ?? m.nombre, url: m.url, formato: null, codigo: null, cantidad: m.cantidad, contada: true });
  }
  const impresosPorClave = new Map<string, number>();
  for (const [impresoId, porLatex] of impresos) {
    const i = impresoPorId(impresoId)!;
    const p = publicados.find((x) => x.url === i.url);
    if (p) usados.add(p);
    for (const [k, n] of porLatex) {
      const [f, c] = k.split("|") as [string, string];
      salida.push({ nombre: p?.nombre ?? i.nombre, url: i.url, formato: f, codigo: c, cantidad: n, contada: true });
      impresosPorClave.set(k, (impresosPorClave.get(k) ?? 0) + n);
    }
  }
  for (const m of sumarMateriales(armada.materiales)) {
    const cantidad = Math.ceil(m.cantidad - 1e-9) - (impresosPorClave.get(clave(m.formatoId, m.codigo)) ?? 0);
    if (cantidad <= 0) continue;
    const tipo = formatoPorId(m.formatoId)?.tipo;
    const p = publicados.find((x) => x.formato !== null && x.codigo === m.codigo && formatoPorId(x.formato)?.tipo === tipo);
    if (p) { usados.add(p); salida.push({ nombre: p.nombre, url: p.url, formato: m.formatoId, codigo: m.codigo, cantidad, contada: true }); }
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
 * La idea con su número y foto de su fuente; sus ocasiones (de sus etiquetas, con `ocasionesDeEtiquetas`, que vive en
 * `index.ts`, que importa este lote: se calculan al leerlas) y sus productos (salen de armar la escena) se calculan la
 * primera vez que se piden.
 */
function idea(slug: string, nombre: string, escena: Escena, nota: string, publicados: readonly Publicado[] = []): IdeaDigitalizada {
  const f = fuente(slug);
  let hechos: ProductoDeIdea[] | null = null;
  return {
    id: `idea:${slug}`, numero: f.numero, slug, nombre, fotoUrl: f.fotoUrl, contenido: { tipo: "escena", escena }, nota,
    get ocasiones() { return ocasionesDeEtiquetas(f.etiquetas); },
    get productos() { return (hechos ??= productosDe(escena, publicados)); },
  };
}

// Impresos de la tienda que usa el lote (ids de `impresos-catalogo.ts`).
const GRAFFITI_INVIERNO = "infinity-graffiti-invierno-fashion-transparente";
const CORAZONES_POR_SIEMPRE = "infinity-corazones-por-siempre-fashion-surtido-rojo-blanco";
const CORAZONES_BRILLANTES = "infinity-corazones-brillantes-fashion-metal-surtido";
const MAMI_ROSA = "infinity-feliz-dia-mami-flores-fashion-surtido-rosa-silvestre";
const MAMI_ROJO = "infinity-feliz-dia-mami-flores-fashion-surtido-rojo-blanco";
const GRAFFITI_ROSA = "infinity-graffiti-rosa-fashion-transparente";
const HAPPY_HALLOWEEN = "2-caras-happy-halloween-noche-reflex-surtido";

/** Que un impreso del lote esté en el catálogo (si no, el error sale al cargar, no en la tienda). */
for (const id of [GRAFFITI_INVIERNO, CORAZONES_POR_SIEMPRE, CORAZONES_BRILLANTES, MAMI_ROSA, MAMI_ROJO, GRAFFITI_ROSA, HAPPY_HALLOWEEN]) if (!impresoPorId(id)) throw new Error(`Impreso desconocido: ${id}`);

// ----------------------------------------------------------------------------------------------------------
// 35 · Árbol de corazones rosado
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 740 × 570 (sin piso: la base del tronco en y = 553 px, el eje en x = 372 px). El tronco son 7 cuartetos marrón de
 * ~50 px (R-5 a 12 cm: 4,2 px/cm), a ~41 px por nivel (9,7 cm: el paso del taller, 0,8 diámetros), de 553 a 262 px
 * (69 cm). La copa es un hongo ancho de corazones rosados de ~90–95 px (C-12 a ~22 cm): 450 px de ancho (107 cm), de
 * 15 a ~300 px (68 cm de alto, más ancha que alta). Se ven 31 corazones; con los de atrás, 48 sobre la copa (sin la
 * parte de abajo, por donde entra el tronco). Colores medidos (no publica productos): marrón #866658 → Fashion
 * Chocolate 076 (ΔE 11; Café 074 a 14); rosado #ff92bc → en C-12 solo se fabrican blanco, rosado, rojo y cristal:
 * Fashion Rosado 009 (los demás quedan a más de 50).
 */
const escena35 = ((): Escena => {
  const TRONCO = R("R-5", 12, "076");
  const CORAZON = R("C-12", 22, "009");
  const m = montaje({ id: "tronco", nombre: "Tronco de 7 cuartetos R-5 Fashion Chocolate", pieza: { tipo: "columna", formatoId: "R-5", infladoCm: 12, alturaCm: r2(7 * 0.8 * TRONCO.infladoCm), patron: "un_color", colores: [TRONCO.codigo] }, en: v(0, 6.62, 0) }, v(0, 0, -32));
  // La copa: un elipsoide de 43 cm de radio (al centro de los corazones), 27 cm hacia arriba y 22 hacia abajo, con el
  // centro a 92 cm; los corazones en puntos de Fibonacci, sin el casquete de abajo (y < −0,45).
  const C = v(0, 92, 0), A = 43, ARR = 27, ABA = 22, CORAZONES = 48;
  const dentro = (total: number) => Array.from({ length: total }, (_, i) => 1 - (2 * (i + 0.5)) / total).filter((y) => y > -0.45).length;
  let n = CORAZONES;
  while (dentro(n) < CORAZONES) n++;
  const oro = Math.PI * (3 - Math.sqrt(5));
  let k = 0;
  for (let i = 0; i < n && k < CORAZONES; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;
    if (y <= -0.45) continue;
    const rr = Math.sqrt(1 - y * y), a = i * oro;
    const u = v(Math.cos(a) * rr, y, Math.sin(a) * rr);
    const b = y > 0 ? ARR : ABA;
    k++;
    m.globo(`corazon-${k}`, `Corazón C-12 Fashion Rosado de la copa ${k}`, CORAZON, mas(C, v(A * u.x, b * u.y, A * u.z)), unitario(v(u.x / A, u.y / b, u.z / A)));
  }
  return { sala: sala(320, 300, 260), nodos: m.nodos };
})();
const idea35 = idea("arbol-corazones-rosado", "Árbol de corazones rosado", escena35,
  "Igual: árbol de ~1,3 m con el tronco de 7 cuartetos R-5 marrón (al paso del taller, como la foto: 69 cm) y la copa en hongo, más ancha (~1,07 m) que alta (~68 cm), de 48 corazones C-12 rosados que miran hacia fuera. La idea no publica productos; medidos: marrón #866658 → Fashion Chocolate 076; rosado #ff92bc → Fashion Rosado 009 (el único rosado que se fabrica en C-12). Distinto: se ven 31 corazones; los 17 de atrás no se ven y se suponen para cerrar la copa; en la foto se montan unos sobre otros en dos capas y aquí van en una sola capa ordenada; la escala sale del tronco (R-5 a 12 cm): si el tronco fuera de R-9, el árbol mediría ~2 m.");

// ----------------------------------------------------------------------------------------------------------
// 45 · Árbol de Navidad (cono de cuartetos)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 740 × 570: la base en y = 553 px, el eje en x = 366 px. El cono son 10 cuartetos verdes que se achican: 85 px
 * abajo (R-12 a 28 cm: 3,04 px/cm) y 35 px arriba; centros a 510, 450, 405, 365, 320, 278, 245, 215, 188 y 165 px
 * (cada nivel a ~0,7 diámetros del de abajo: más juntos que el paso del taller). Por tamaño: 3 niveles de R-12 (28, 26
 * y 23 cm) y 7 de R-9 (20 → 11,5 cm). En las muescas de los 7 primeros entrecruzados van R-5 rojos y dorados (cuatro
 * por muesca, dos a la vista), de 12,5 a 10 cm. Arriba, la estrella metalizada dorada de 18" (140 px: 46 cm, la escala
 * cuadra). Colores medidos (no publica productos): verde #007e6b → Reflex Verde Aurora 932 (ΔE 9–15) y Fashion Verde
 * Selva 032 (14–22): va el Selva, porque el Verde Aurora no se fabrica en R-9; rojo #f73233 → Fashion Rojo 015;
 * dorado #b59f47 → Metal Dorado 570 (Reflex Dorado 970 a 15).
 */
const escena45 = ((): Escena => {
  const VERDE = "032";
  const NIVELES: ReadonlyArray<readonly [number, ParteGlobo]> = [
    [15.4, R("R-12", 28, VERDE)], [33.9, R("R-12", 26.3, VERDE)], [48.7, R("R-12", 23, VERDE)], [61.8, R("R-9", 19.7, VERDE)], [76.6, R("R-9", 18, VERDE)],
    [90.5, R("R-9", 16.4, VERDE)], [101.3, R("R-9", 14.8, VERDE)], [111.2, R("R-9", 13.2, VERDE)], [120.1, R("R-9", 11.5, VERDE)], [127.6, R("R-9", 11.5, VERDE)],
  ];
  const [y0, g0] = NIVELES[0]!;
  const m = montaje({ id: "cono", nombre: "Árbol de Navidad de cuartetos verde selva", pieza: cuarteto(g0, [VERDE]), en: v(0, y0, 0) }, v(0, 0, -48));
  NIVELES.slice(1).forEach(([y, g], i) => m.nivel(`nivel-${i + 2}`, `Cuarteto ${g.formatoId} Fashion Verde Selva (nivel ${i + 2})`, g, [VERDE], v(0, y, 0), ARRIBA, 45 * (i + 1)));
  // Las muescas: encima de cada globo del nivel de abajo, entre los dos de arriba (los ángulos de la foto: 90° = al frente).
  const ROJO = "015", DORADO = "570";
  const COLORES_MUESCA: ReadonlyArray<ReadonlyArray<readonly [number, string]>> = [
    [[45, DORADO], [135, DORADO], [225, ROJO], [315, ROJO]], [[90, ROJO], [180, DORADO], [270, ROJO], [0, DORADO]], [[45, ROJO], [135, DORADO], [225, ROJO], [315, DORADO]],
    [[90, DORADO], [180, ROJO], [270, DORADO], [0, ROJO]], [[45, ROJO], [135, ROJO], [225, DORADO], [315, DORADO]], [[90, DORADO], [0, ROJO], [180, ROJO], [270, DORADO]],
    [[45, ROJO], [135, ROJO], [225, DORADO], [315, DORADO]],
  ];
  COLORES_MUESCA.forEach((muesca, k) => {
    const [ya] = NIVELES[k]!, [yb, gb] = NIVELES[k + 1]!;
    const da = r2(12.5 - (2.5 * k) / 6);
    const y = ya + 0.8 * (yb - ya);
    // En la ranura entre dos globos de arriba (a 0,62 diámetros del eje y a ±45° del ángulo), tocando a ambos.
    const rho = 0.62 * gb.infladoCm, toque = (gb.infladoCm / 2 + da / 2) * 0.94;
    const r = rho * Math.cos(rad(45)) + Math.sqrt(Math.max(0, toque * toque - (rho * Math.sin(rad(45))) ** 2));
    for (const [angulo, codigo] of muesca) {
      const a = rad(angulo);
      const nombre = codigo === ROJO ? "R-5 Fashion Rojo" : "R-5 Metal Dorado";
      m.globo(`muesca-${k + 1}-${angulo}`, `${nombre} (muesca ${k + 1}, ${angulo}°)`, R("R-5", da, codigo), v(r2(r * Math.cos(a)), r2(y), r2(r * Math.sin(a))), unitario(v(Math.cos(a), 0.25, Math.sin(a))));
    }
  });
  m.metalizado("estrella", "Estrella metalizada dorada de remate", metalizadoDeTienda("estrella-dorado-mate"), v(0, 154, -2));
  return { sala: sala(300, 300, 260), nodos: m.nodos };
})();
const idea45 = idea("arbol-de-navidad", "Árbol de Navidad de cuartetos con estrella", escena45,
  "Igual: árbol cónico de ~1,8 m: 10 cuartetos verdes que se achican (3 de R-12 de 28 a 23 cm y 7 de R-9 de 20 a 11,5 cm), cada uno a la altura medida en la foto (a ~0,7 diámetros del de abajo: más juntos que el paso del taller), girados 1/8 de vuelta; 28 R-5 en las muescas de los 7 primeros (14 Fashion Rojo y 14 Metal Dorado, cuatro por muesca, con los de delante del color de la foto) y la estrella metalizada de 18\" arriba. La idea no publica productos; medidos: verde #007e6b → entre Reflex Verde Aurora 932 y Fashion Verde Selva 032: va el Selva (el Verde Aurora no se fabrica en R-9); rojo → Fashion Rojo 015; dorado #b59f47 → Metal Dorado 570. Distinto: la estrella de la foto es dorada brillante y la de la tienda es la Estrella Dorado Mate (la única dorada de 18\"); los R-5 de la cara de atrás no se ven (sus colores se suponen).");

// ----------------------------------------------------------------------------------------------------------
// 57 · Arbolito silvestre
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 740 × 570: la base en y = 553 px, el eje en x = 350 px. Las flores de 5 pétalos R-5 rojos (~45–50 px) con su
 * centro amarillo (~40 px) dan la escala (R-5 a 11–12 cm: 4 px/cm). Abajo un cuarteto verde de ~75 px (R-9 a 19 cm);
 * el tronco café, de 5 niveles que se afinan de 65 a 45 px (R-9 de 16 a 11 cm), de 470 a ~300 px (42 cm); la copa,
 * de globos de ~90–95 px (R-12 a 23 cm), mide 350 px de ancho (88 cm) y 290 de alto (73 cm), centrada a ~97 cm del
 * piso, con 13 verdes oscuros y 7 verde lima a la vista. Tres flores: al frente arriba, a la izquierda y a la derecha.
 * Colores: los publicados (Verde 030, Verde Lima 031, Café 074, Rojo 015, Amarillo 020); la base verde oscura, el
 * mismo Verde 030 de la copa.
 */
const escena57 = ((): Escena => {
  const arbol: Pieza = {
    tipo: "arbol_globos",
    arbol: {
      tronco: { formatoId: "R-9", infladoBaseCm: 16, infladoPuntaCm: 11.5, altoCm: 50, colores: ["074"], curvaCm: 0, base: { formatoId: "R-9", infladoCm: 19, codigo: "030", cantidad: 4 } },
      copa: { tipo: "racimos", diametroCm: 108, achatado: 0.78, globo: { formatoId: "R-12", infladoCm: 23 }, colores: ["030", "031"], pesos: [13, 7], semilla: 5, frutas: null },
    },
  };
  const m = montaje({ id: "arbol", nombre: "Arbolito de tronco café y copa de racimos verdes", pieza: arbol, en: v(0, 0, 0) }, v(0, 0, -62));
  const florRoja = deco(flor({ petalos: { ...R("R-5", 11, "015"), cantidad: 5, aperturaGrados: 0, giroGrados: 0 }, centro: { ...R("R-5", 9.5, "020"), cantidad: 1 } }));
  m.centrada("flor-frente", "Flor de 5 R-5 rojos con centro amarillo (frente)", florRoja, v(-5, 100, 46), AL_FRENTE);
  m.centrada("flor-izquierda", "Flor de 5 R-5 rojos con centro amarillo (izquierda)", florRoja, v(-37, 72, 21), enPlano(-0.8, 0, 0.6));
  m.centrada("flor-derecha", "Flor de 5 R-5 rojos con centro amarillo (derecha)", florRoja, v(39, 75, 21), enPlano(0.8, 0, 0.6));
  return { sala: sala(300, 300, 260), nodos: m.nodos };
})();
const idea57 = idea("arbolito-silvestre", "Arbolito silvestre con flores rojas", escena57,
  "Igual: arbolito de ~1,3 m con base de un cuarteto R-9 verde, tronco café de cuartetos R-9 que se afinan (16 → 11,5 cm), copa redonda y algo achatada (~95 × 80 cm) de 9 racimos de 4 R-12 verdes y verde lima en la proporción de la foto (13 : 7) y las tres flores de 5 R-5 rojos con centro amarillo (al frente arriba, a la izquierda y a la derecha), con los productos que publica la idea: Fashion Verde 030 y Verde Lima 031 en la copa (y el verde de la base), Café 074 en el tronco, Rojo 015 y Amarillo 020 en las flores. Distinto: la idea los publica como R-12; en la foto el tronco y la base son R-9 (más chicos que la copa) y los pétalos R-5; la copa de la foto es de globos sueltos y aquí de racimos de cuatro (el generador); la clasificación cuenta 4 flores, en la foto se ven 3.",
  [
    P("GLOBO REDONDO FASHION VERDE LIMA", "/products/globo-para-fiesta-latex-redondo-fashion-verde-lima", "R-12", "031"),
    P("GLOBO REDONDO FASHION VERDE", "/products/globo-para-fiesta-latex-redondo-fashion-verde", "R-12", "030"),
    P("GLOBO REDONDO FASHION CAFÉ", "/products/globo-para-fiesta-latex-redondo-fashion-cafe", "R-12", "074"),
    P("GLOBO REDONDO FASHION ROJO", "/products/globo-para-fiesta-latex-redondo-fashion-rojo", "R-12", "015"),
    P("GLOBO REDONDO FASHION AMARILLO", "/products/globo-para-fiesta-latex-redondo-fashion-amarillo", "R-12", "020"),
  ]);

/** Con la normal arriba y girada 90° (como el amarre), una pieza colgada queda con el espacio del mundo y z al revés. */
const zAlReves = (p: Vec3): Vec3 => v(p.x, p.y, -p.z);
const ORIGEN = v(0, 0, 0);

// ----------------------------------------------------------------------------------------------------------
// 41 · Árbol de Navidad Graffiti Invierno (pino con guirnalda en espiral)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 1000 × 1000 (fondo transparente): el tapete rojo en y = 925 px, el eje en x = 480 px. Es un pino de verdad
 * (utilería) de 740 px hasta la punta (185 px), con globos encima. Los globos miden 50–60 px: la idea publica solo R-12,
 * así que son R-12 poco inflados (~14 cm: 3,9 px/cm): el pino mide ~1,9 m y su copa ~1,5 m de ancho abajo. Lo de globos:
 * una guirnalda orgánica que da 5 vueltas en espiral alrededor del pino (5 franjas cruzan el frente, bajando hacia la
 * derecha), de ~26 cm de grueso; 18 adornos sueltos (un R-12 colgado con una tapita de burbujas de T-260 dorado: las
 * 18 tapitas doradas se contaron por color en la foto); y arriba un moño de lazos de T-260 plateados y blancos (260 ×
 * 150 px: 67 × 38 cm). Colores: los publicados —Satín Plata 481, Satín Perla 406, Reflex Dorado 970 (los cromados color
 * bronce, medidos #a39c91 → Reflex Champaña 971 a ΔE 7: va el publicado) y el impreso Graffiti Invierno sobre cristal—;
 * las tapitas en T-260 Reflex Dorado 970 y el moño en T-260 Satín Plata 481 y Fashion Blanco 005.
 */
const escena41 = ((): Escena => {
  const D = 14;
  /** El radio del pino a la altura y (su silueta en la foto, con las ramas). */
  const radioPino = (y: number) => 76 - 0.3 * y;
  // La espiral: de 180 cm a 20 cm, 5 vueltas, por la cara del pino; de frente baja hacia la derecha.
  const espiral: Vec3[] = [];
  for (let i = 0; i <= 150; i++) {
    const t = i / 150, y = 180 - 160 * t, a = rad(150) - 2 * Math.PI * 5 * t, r = radioPino(y) + 4;
    espiral.push(v(r * Math.cos(a), y, r * Math.sin(a)));
  }
  const guirnalda = racimos({
    racimos: [{ puntos: espiral, radio: 13 }], mezcla: { "R-12": 1 }, inflados: { "R-12": D }, relleno: [], semilla: 41,
    colores: [colorOrg("481", 35), colorOrg("406", 30), colorOrg("390", 20), colorOrg("970", 15)],
  }, [{ impresoId: GRAFFITI_INVIERNO, codigo: "390" }]);
  const m = montaje({ id: "guirnalda", nombre: "Guirnalda en espiral plata, perla, bronce y graffiti", pieza: guirnalda, en: ORIGEN }, v(128, 0, 0));
  // Los 18 adornos: la tapita dorada (px de la foto) y el globo colgando debajo, en la cara del pino.
  const TAPITAS: ReadonlyArray<readonly [number, number]> = [
    [422, 198], [568, 205], [572, 341], [398, 348], [316, 468], [438, 470], [578, 479], [649, 504], [692, 615],
    [309, 629], [372, 650], [634, 675], [268, 719], [230, 786], [725, 802], [611, 843], [305, 847], [415, 860],
  ];
  const tapita = deco(florTubito(burbujasTubito("T-260", 3.5, ["970"], 3, 4.5, 55, 0)));
  TAPITAS.forEach(([px, py], k) => {
    const x = (px - 480) / 3.9, y = (925 - py) / 3.9, r = radioPino(y) + 9;
    const z = Math.sqrt(Math.max(0, r * r - x * x));
    const grafiti = k % 2 === 1;
    m.centrada(`tapita-${k + 1}`, `Tapita de burbujas de T-260 Reflex Dorado (adorno ${k + 1})`, tapita, v(r2(x), r2(y), r2(z)), ARRIBA);
    m.globo(`adorno-${k + 1}`, `Adorno R-12 ${grafiti ? "Graffiti Invierno" : "Satín Perla"} ${k + 1}`, R("R-12", D, grafiti ? "390" : "406"), v(r2(x), r2(y - 9), r2(z)), ABAJO, grafiti ? GRAFFITI_INVIERNO : undefined);
  });
  const mono = deco(florTubito(lazos("T-260", 4.5, ["481", "481", "005"], 9, 31, 14, 20, 0), lazos("T-260", 4.5, ["005"], 5, 18, 10, 40, 36)));
  m.centrada("mono", "Moño de lazos de T-260 plata y blanco (remate)", mono, v(-4, 212, 0), enPlano(0, 0.8, 0.6));
  const pino = escenografia([
    cilindro(v(0, 0, 0), 4, 12, "#5a3d22", "madera"),
    cilindro(v(0, 8, 0), 78, 74, "#2f4f24", "mate", 50),
    cilindro(v(0, 66, 0), 60, 74, "#335527", "mate", 34),
    cilindro(v(0, 124, 0), 40, 70, "#2f4f24", "mate", 3),
  ]);
  return {
    sala: sala(420, 340, 280),
    nodos: [
      ...m.nodos,
      { id: "pino", nombre: "Pino de Navidad (utilería)", pieza: pino, colocacion: libre(0, 0, 0) },
      { id: "tapete", nombre: "Tapete rojo", pieza: escenografia(tapete({ anchoCm: 172, fondoCm: 130, hex: "#c4161c" })), colocacion: libre(0, 0, 8) },
    ],
  };
})();
const idea41 = idea("arbol-de-navidad-graffiti-invierno", "Árbol de Navidad Graffiti Invierno", escena41,
  "Igual: pino de ~1,9 m (utilería) sobre un tapete rojo, con una guirnalda orgánica de R-12 que le da 5 vueltas en espiral (como las 5 franjas de la foto), 18 adornos sueltos (un R-12 colgado con su tapita de 3 burbujas de T-260 Reflex Dorado, uno Satín Perla y uno Graffiti Invierno alternados) donde la foto pone las 18 tapitas doradas, y el moño de lazos de T-260 plata y blanco arriba, con los productos que publica la idea: Graffiti Invierno sobre cristal, Satín Plata 481, Satín Perla 406 y Reflex Dorado 970 (los cromados color bronce; la foto los mide Reflex Champaña 971). Distinto: los globos de la foto miden ~14 cm (R-12 poco inflados: la idea solo publica R-12); la guirnalda se cuenta con el motor orgánico (no globo a globo); la mezcla de colores es la proporción a ojo (35 % plata, 30 % perla, 20 % graffiti, 15 % bronce); los adornos de la cara de atrás no se ven y no se ponen; el pino es un cono de tres pisos, sin agujas.",
  [
    P("GLOBO REDONDO INFINITY® GRAFFITI INVIERNO FASHION TRANSPARENTE", "/products/globo-para-fiesta-latex-redondo-infinity-graffiti-invierno-fashion-transparente", "R-12", null),
    P("GLOBO REDONDO SATIN PLATA", "/products/globo-para-fiesta-latex-redondo-satin-plata", "R-12", "481"),
    P("GLOBO LATEX REDONDO REFLEX DORADO", "/products/globo-para-fiesta-latex-redondo-reflex-dorado", "R-12", "970"),
    P("GLOBO REDONDO SATIN PERLA", "/products/globo-para-fiesta-latex-redondo-satin-perla", "R-12", "406"),
  ]);

// ----------------------------------------------------------------------------------------------------------
// 76 · Arco de corazones
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 740 × 570: el piso en y = 550 px, el centro en x = 370 px. El texto: «dos columnas con cuartetos de R-12
 * Infinity y R-12 lisos a diferentes tamaños, unidas con dos globos metalizados de corazón Linky». Cada columna sube
 * recta con 8 niveles alternados —blanco liso de ~55 px (R-12 a 26 cm: 2,1 px/cm) e impreso de corazones rojos de ~45
 * px (R-12 a 21 cm)—, a 34,6 px por nivel (16,5 cm: 0,7 diámetros), de 520 a 278 px; luego se curva hacia el centro
 * con otros 8 más chicos (blancos de ~42 px, 20 cm, e impresos de ~30 px, 15 cm) hasta los corazones, en x = 335 px y
 * y = 150 px. Los dos corazones metalizados rojos (115 px: ~50 cm) se enlazan arriba al centro, un poco inclinados.
 * El impreso: corazones rojos sobre blanco, el «Corazones por siempre» rojo-blanco de la tienda (no publica productos).
 */
const escena76 = ((): Escena => {
  const px = (x: number, y: number): Vec3 => v(r2((x - 370) / 2.1), r2((550 - y) / 2.1), 0);
  // El camino de la columna izquierda: recto de (205, 520) a (205, 280) px y luego un cuarto de círculo (centro (335,
  // 280) px, radio 130 px) hasta (335, 150) px.
  const camino: Vec3[] = [px(205, 520), px(205, 280)];
  for (let i = 1; i <= 24; i++) { const t = rad(180 - (90 * i) / 24); camino.push(px(335 + 130 * Math.cos(t), 280 - 130 * Math.sin(t))); }
  const recto = largo(menos(camino[1]!, camino[0]!)), curva = largoPolilinea(camino) - recto;
  const s = [...Array.from({ length: 8 }, (_, k) => (recto * k) / 7), ...Array.from({ length: 8 }, (_, k) => recto + (curva * (k + 1)) / 8)];
  const puntos = aLoLargo(camino, s);
  const BLANCO = "005";
  const nivel = (k: number): { g: ParteGlobo; impreso: boolean } => {
    const impreso = k % 2 === 1, curvo = k >= 8;
    return { g: R("R-12", curvo ? (impreso ? 15 : 20) : impreso ? 21 : 26, BLANCO), impreso };
  };
  const nombre = (k: number, lado: string) => `${nivel(k).impreso ? "Cuarteto R-12 Corazones por siempre" : "Cuarteto R-12 Fashion Blanco"} (${lado}, nivel ${k + 1})`;
  const corazones: ImpresoEnPieza[] = [{ impresoId: CORAZONES_POR_SIEMPRE, codigo: BLANCO }];
  const p0 = puntos[0]!;
  const m = montaje({ id: "columna-izquierda", nombre: "Arco de corazones: cuarteto blanco de la base izquierda", pieza: cuarteto(nivel(0).g, [BLANCO]), en: v(p0.p.x, 14.4, 0) }, v(0, 0, -40));
  puntos.forEach(({ p, t }, k) => {
    const { g, impreso } = nivel(k);
    const imp = impreso ? corazones : undefined;
    if (k > 0) m.nivel(`izquierda-${k + 1}`, nombre(k, "izquierda"), g, [BLANCO], p, t, 45 * k, "un_color", imp);
    m.nivel(`derecha-${k + 1}`, nombre(k, "derecha"), g, [BLANCO], v(-p.x, k === 0 ? 14.4 : p.y, p.z), v(-t.x, t.y, t.z), 45 * k, "un_color", imp);
  });
  m.metalizado("corazon-izquierdo", "Corazón metalizado rojo (izquierdo)", metalizadoDeTienda("corazon-rojo-2"), mas(px(300, 75), v(0, 0, -2)), 15);
  m.metalizado("corazon-derecho", "Corazón metalizado rojo (derecho)", metalizadoDeTienda("corazon-rojo-2"), mas(px(440, 75), v(0, 0, 2)), -15);
  return { sala: sala(420, 300, 300), nodos: m.nodos };
})();
const idea76 = idea("arco-corazones", "Arco de corazones con columnas de cuartetos", escena76,
  "Igual: arco de ~2,5 m de alto y ~2,1 m de ancho: dos columnas de 16 cuartetos R-12 alternados —8 blancos lisos y 8 impresos de corazones rojos—, rectas con 8 niveles (blancos a 26 cm, impresos a 21) y curvadas hacia el centro con otros 8 más chicos (20 y 15 cm), cada nivel donde lo pone la foto (a ~0,7 diámetros: más juntos que el paso del taller), y los dos corazones metalizados rojos que las unen arriba, inclinados, como dice el texto. La idea no publica productos: el impreso es el «Corazones por siempre» rojo-blanco de la tienda sobre su blanco (005), los lisos Fashion Blanco 005. Distinto: los corazones de la foto son «Linky» (calados, con colita para enlazarse), que la tienda no vende: va el Corazón metalizado rojo de 18\" de la tienda, macizo; en la foto miden ~50 cm.");

// ----------------------------------------------------------------------------------------------------------
// 78 · Arco de amor y flores
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 1000 × 1000: el piso en y = 810 px, el centro en x = 470 px. La flor metalizada de 27" (425 px: 65 cm) da la
 * escala (6,5 px/cm), y cuadra con los impresos de la base (~200 px: R-12 llenos, 30 cm). Base: 4 impresos de Corazones
 * Brillantes al frente (los dos de la izquierda dorado rosa, los dos de la derecha rosados) y 2 detrás (dorado rosa);
 * encima, a la izquierda, 3 R-12 fucsia (130, 135 y 100 px: 20, 21 y 15 cm) y 2 R-5 Reflex Dorado (75 px: 11,5 cm); a
 * la derecha la flor metalizada. Arco: sale de la izquierda (y = 445 px), sube a 105 px y baja detrás de la flor; por
 * fuera una fila de R-5 fucsia de ~80 px (12,5 cm) y por dentro una de R-5 rosados de ~55–60 px (9 cm): ~90 cm de
 * ancho, ~1,07 m de alto en total. Colores: los publicados (Fashion Rosado 009, Fashion Fucsia 012, Reflex Dorado 970,
 * la flor rosada y Corazones Brillantes); medidos: los impresos #cb9188 → Metal Dorado Rosa 568 (del surtido) y
 * #e0aeb4 → Fashion Rosado 009 (del surtido); fucsia #e94883 → Fashion Fucsia 012 (ΔE 3).
 */
const escena78 = ((): Escena => {
  const px = (x: number, y: number, z = 0): Vec3 => v(r2((x - 470) / 6.5), r2((810 - y) / 6.5), z);
  const fucsia = racimos({
    racimos: [{ puntos: [px(215, 445), px(190, 350), px(215, 250), px(290, 175), px(390, 130), px(490, 130), px(580, 160), px(650, 200), px(700, 250)], radio: 7 }],
    mezcla: { "R-5": 1 }, inflados: { "R-5": 12.5 }, relleno: [], semilla: 78, colores: [colorOrg("012", 1)], suelo: false,
  });
  const m = montaje({ id: "arco-fucsia", nombre: "Arco de R-5 fucsia", pieza: fucsia, en: ORIGEN }, v(0, 0, -40));
  const rosado = racimos({
    racimos: [{ puntos: [px(270, 440, -3), px(250, 350, -3), px(275, 265, -3), px(340, 210, -3), px(430, 190, -3), px(520, 205, -3), px(590, 240, -3), px(640, 275, -3)].map(zAlReves), radio: 5 }],
    mezcla: { "R-5": 1 }, inflados: { "R-5": 9 }, relleno: [], semilla: 79, colores: [colorOrg("009", 1)], suelo: false,
  });
  m.pieza("arco-rosado", "Fila de R-5 rosados por dentro del arco", rosado, ORIGEN, ARRIBA, 90);
  const IMPRESOS: ReadonlyArray<readonly [string, Vec3, string]> = [
    ["frente-1", v(-50.8, 15, 8), "568"], ["frente-2", v(-20, 15, 10), "568"], ["frente-3", v(13.1, 15, 10), "009"], ["frente-4", v(44.6, 15, 8), "009"],
    ["atras-1", v(-10.8, 15, -20), "568"], ["atras-2", v(61.5, 15, -14), "568"],
  ];
  // Apoyados en el piso de costado, con el nudo hacia el centro de la base (hacia fuera, el cuerpo).
  for (const [id, c, codigo] of IMPRESOS) m.globo(`impreso-${id}`, `R-12 Corazones Brillantes ${codigo === "568" ? "dorado rosa" : "rosado"} de la base (${id})`, R("R-12", 30, codigo), c, enPlano(c.x / 60, 0, c.z >= 0 ? 1 : -1), CORAZONES_BRILLANTES);
  m.globo("fucsia-1", "R-12 Fashion Fucsia de la base 1", R("R-12", 20, "012"), px(115, 560, 2), enPlano(-0.4, 1, 0.3));
  m.globo("fucsia-2", "R-12 Fashion Fucsia de la base 2", R("R-12", 21, "012"), px(235, 580, 4), enPlano(0, 1, 0.4));
  m.globo("fucsia-3", "R-12 Fashion Fucsia de la base 3", R("R-12", 15, "012"), px(340, 550, 0), enPlano(0.4, 1, 0.3));
  m.globo("dorado-1", "R-5 Reflex Dorado de la base 1", R("R-5", 11.5, "970"), px(190, 500, -2), enPlano(-0.3, 1, 0.3));
  m.globo("dorado-2", "R-5 Reflex Dorado de la base 2", R("R-5", 11.5, "970"), px(270, 495, -2), enPlano(0.3, 1, 0.3));
  m.metalizado("flor", "Flor metalizada rosada de 27\"", metalizadoDeTienda("flor-rosada"), px(685, 470, 6), -6);
  return { sala: sala(260, 220, 220), nodos: m.nodos };
})();
const idea78 = idea("arco-de-amor-y-flores", "Arco de amor y flores", escena78,
  "Igual: pieza de mesa o piso de ~1 m: arco de R-5 fucsia por fuera (12,5 cm) y rosados por dentro (9 cm) que sale de la base izquierda, sube a ~1,05 m y baja detrás de la flor; base de 6 impresos Corazones Brillantes (4 al frente —dos dorado rosa y dos rosados— y 2 detrás), 3 R-12 fucsia y 2 R-5 Reflex Dorado a la izquierda, y la flor metalizada rosada de 27\" de la tienda a la derecha, con los productos que publica la idea. Distinto: la idea publica los lisos como R-12; en la foto el arco es de R-5 y los dorados también; el arco se arma con el motor orgánico (no globo a globo); la flor de la foto va algo inclinada y metida entre los impresos.",
  [
    P("GLOBO REDONDO FASHION ROSADO", "/products/globo-para-fiesta-latex-redondo-fashion-rosado", "R-12", "009"),
    P("GLOBO REDONDO FASHION FUCSIA", "/products/globo-para-fiesta-latex-redondo-fashion-fucsia", "R-12", "012"),
    P("GLOBO LATEX REDONDO REFLEX DORADO", "/products/globo-para-fiesta-latex-redondo-reflex-dorado", "R-12", "970"),
    P("GLOBO METALIZADO FLOR ROSADA", "/products/globo-metalizado-flor-rosada", null, null),
    P("GLOBO REDONDO INFINITY® CORAZONES BRILLANTES", "/products/globo-para-fiesta-latex-redondo-infinity-corazones-brillantes-fashion-metal-surtido", "C-12", null),
  ]);

// ----------------------------------------------------------------------------------------------------------
// 91 · Arco feliz cumpleaños (1 año)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 740 × 570: el piso en y = 530 px, el centro en x = 380 px. Los eslabones Link-O-Loon amarillos miden ~70 px de
 * nudo a nudo y ~45 de grueso (LOL-12: 2,3 px/cm). Cada columna (ejes en x = 145 y 615 px): 4 cuartetos R-9 de ~42 px
 * (18 cm) en espiral de cuatro colores (los dos de abajo azul, violeta, amarillo con un «1» impreso y verde; los dos de
 * arriba con naranja en vez de azul), a 34 px por nivel (el paso del taller); encima un globo cristal R-18 de ~80 px (35
 * cm) con 7 R-5 de colores dentro, un cuarteto R-9 (naranja, verde con «1», azul y violeta) y un racimo de 4 R-5
 * naranja donde arranca el arco. El arco: de cada lado 4 eslabones amarillos y, en cada unión, un racimo de 4 R-5
 * (naranja, verde, azul, violeta, naranja); arriba al centro otro cristal R-18 (~95 px: 41 cm) con 7 R-5 dentro. Del
 * arco cuelga un «1» de cuartetos de R-5 verdes (170 px: 74 cm). Colores medidos (no publica productos): amarillo
 * #d5cb18 → Fashion Amarillo 020; naranja #fe5700 → Naranja 061; verde #02c048 → Verde Trébol 029 (ΔE 9); violeta
 * #642791 → Violeta 051; azul #00afde → Azul 040 (ΔE 4); el amarillo de los impresos #ccbb08 → Amarillo Miel 021.
 */
const escena91 = ((): Escena => {
  const px = (x: number, y: number, z = 0): Vec3 => v(r2((x - 380) / 2.3), r2((530 - y) / 2.3), z);
  const EJE = 102.2;
  const NIVELES: ReadonlyArray<readonly [number, string[]]> = [[10, ["040", "051", "021", "029"]], [24.8, ["040", "051", "021", "029"]], [39.6, ["061", "051", "021", "029"]], [54.4, ["061", "051", "021", "029"]]];
  const L = R("R-9", 18, "021");
  const m = montaje({ id: "columna-izquierda", nombre: "Arco feliz cumpleaños: cuarteto espiral de la base izquierda", pieza: cuarteto(L, NIVELES[0]![1], "espiral"), en: v(-EJE, NIVELES[0]![0], 0) }, v(0, 0, -30));
  const INTERIOR: InteriorBurbuja[] = [{ formatoId: "R-5", infladoCm: 9, codigos: ["029", "040", "012", "021", "061", "051"], cantidad: 7 }];
  for (const [lado, x] of [["izquierda", -EJE], ["derecha", EJE]] as const) {
    NIVELES.forEach(([y, colores], k) => {
      if (lado === "izquierda" && k === 0) return;
      m.nivel(`${lado}-${k + 1}`, `Cuarteto R-9 en espiral (${lado}, nivel ${k + 1})`, L, colores, v(x, y, 0), ARRIBA, 45 * k, "espiral");
    });
    m.pieza(`${lado}-burbuja`, `Globo cristal R-18 con 7 R-5 dentro (columna ${lado})`, deco(burbuja(R("R-18", 35, "390"), INTERIOR, lado === "izquierda" ? 3 : 4)), v(x, 64.3, 0), AL_FRENTE);
    m.nivel(`${lado}-arriba`, `Cuarteto R-9 naranja, verde, azul y violeta (${lado}, arriba)`, R("R-9", 19, "061"), ["061", "029", "040", "051"], v(x, 112, 0), ARRIBA, 0, "espiral");
  }
  // Las uniones del arco sobre una elipse (centro a 124 cm, semiejes 102,2 × 80 cm): de cada lado, del pie (180°) a 102°.
  const ANGULOS = [180, 160.5, 141, 121.5, 102];
  const COLORES_UNION = ["061", "029", "040", "051", "061"];
  for (const [nombreLado, lado] of [["izquierda", 1], ["derecha", -1]] as const) {
    const juntas = ANGULOS.map((a) => v(r2(lado * EJE * Math.cos(rad(a))), r2(124 + 80 * Math.sin(rad(a))), 0));
    juntas.forEach((p, k) => m.centrada(`union-${nombreLado}-${k + 1}`, `Racimo de 4 R-5 en la unión del arco (${nombreLado}, ${k + 1})`, deco(anillo(R("R-5", 11, COLORES_UNION[k]!), 4, 10, 45)), p, AL_FRENTE));
    for (let k = 0; k < 4; k++) {
      const a = juntas[k]!, b = juntas[k + 1]!;
      m.eslabon(`eslabon-${nombreLado}-${k + 1}`, `Eslabón LOL-12 Fashion Amarillo (${nombreLado}, ${k + 1})`, R("LOL-12", r2(largo(menos(b, a)) / 1.47), "020"), a, b);
    }
  }
  m.pieza("burbuja-arriba", "Globo cristal R-18 con 7 R-5 dentro (arriba del arco)", deco(burbuja(R("R-18", 41, "390"), [{ ...INTERIOR[0]!, infladoCm: 10 }], 5)), v(0, 174, 0), AL_FRENTE);
  const uno: Pieza = { tipo: "letras", letras: { texto: "1", altoCm: 70, grosorCm: 9, disposicion: "fila", tecnica: "cuartetos", formatoId: "R-5", infladoCm: 9, colores: ["029"], patron: "un_color" } };
  return {
    sala: sala(360, 260, 280),
    nodos: [...m.nodos, { id: "uno", nombre: "Número 1 de cuartetos de R-5 verdes (colgado del arco)", pieza: uno, colocacion: libre(px(365, 0).x, 100, 0) }],
  };
})();
const idea91 = idea("arco-feliz-cumpleanos", "Arco feliz cumpleaños con el número 1", escena91,
  "Igual: arco de ~2,2 m de alto y ~2,8 m de ancho: dos columnas de 4 cuartetos R-9 en espiral de cuatro colores (abajo azul, violeta, amarillo y verde; arriba naranja en vez de azul) al paso de la foto, un globo cristal R-18 con 7 R-5 de colores dentro, un cuarteto naranja, verde, azul y violeta y, encima, el arco: de cada lado 4 eslabones Link-O-Loon amarillos de nudo a nudo con un racimo de 4 R-5 en cada unión (naranja, verde, azul, violeta y naranja), y arriba al centro otro cristal R-18 con 7 R-5 dentro; del arco cuelga un «1» de cuartetos de R-5 verdes de ~70 cm. La idea no publica productos; medidos: amarillo → Fashion Amarillo 020, naranja → 061, verde → Verde Trébol 029, violeta → 051, azul → Azul 040, el amarillo de los impresos → Amarillo Miel 021. Distinto: los globos con un «1» impreso (amarillos y verdes) no están en la tienda: van lisos de su color de fondo; el «1» es su propia estructura (cuelga de un hilo en la foto) y no lleva la patita de abajo; los R-5 de dentro de los cristales se acomodan solos.");

// ----------------------------------------------------------------------------------------------------------
// 92 · Arco feliz día
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 740 × 570: el piso en y = 495 px, el centro en x = 367 px. Los eslabones Link-O-Loon de la cima miden ~46 px de
 * nudo a nudo y ~27 de grueso (LOL-12 a 22 cm: 1,43 px/cm); las columnas (ejes en x = 82 y 652 px) son de cuartetos
 * R-12 de ~38 px (26,6 cm), 8 niveles a 28,5 px (20 cm: 0,75 diámetros), de 490 a 255 px, en espiral de cuatro colores:
 * rosa, verde con flores blancas, naranja y amarillo con lunares blancos. La cima es una sola fila de 13 eslabones de
 * colores (verde, naranja, verde, rosa, amarillo, naranja, verde, naranja, amarillo, rosa, verde, naranja, amarillo),
 * con una cinta rizada en cada unión. Colores medidos (no publica productos): rosa #e33f96 → Fashion Rosa 011 (Neón
 * Fucsia a 1,2 ΔE menos: va el Fashion); verde de las columnas #2ba26c → Fashion Verde 030; naranja #ff5302 → Naranja
 * 061; amarillo con lunares #f4c154 → Fashion Mostaza 023 (los lunares blancos aclaran la medida); los eslabones: verde
 * #21b855 → Verde Trébol 029, amarillo #d2c101 → Amarillo 020 (Amarillo Miel a 3 ΔE menos: va el de las columnas de la
 * clasificación, el Amarillo), rosa #e24a91 → Fashion Rosa 011.
 */
const escena92 = ((): Escena => {
  const px = (x: number, y: number): Vec3 => v(r2((x - 367) / 1.43), r2((495 - y) / 1.43), 0);
  const EJE = 199.3;
  const G = R("R-12", 26.6, "011");
  const COLORES = ["011", "030", "061", "023"];
  const m = montaje({ id: "columna-izquierda", nombre: "Arco feliz día: cuarteto espiral de la base izquierda", pieza: cuarteto(G, COLORES, "espiral"), en: v(-EJE, 14.7, 0) }, v(0, 0, -40));
  for (const [lado, x] of [["izquierda", -EJE], ["derecha", EJE]] as const) {
    for (let k = 0; k < 8; k++) {
      if (lado === "izquierda" && k === 0) continue;
      m.nivel(`${lado}-${k + 1}`, `Cuarteto R-12 rosa, verde, naranja y mostaza (${lado}, nivel ${k + 1})`, G, COLORES, v(x, r2(14.7 + 20 * k), 0), ARRIBA, 45 * k, "espiral");
    }
  }
  // Los 13 eslabones (centros medidos en la foto): las uniones son los puntos medios y las puntas se prolongan.
  const CENTROS: ReadonlyArray<readonly [number, number]> = [[105, 225], [137, 190], [175, 150], [217, 128], [262, 105], [310, 90], [357, 83], [407, 88], [455, 105], [505, 128], [545, 160], [585, 193], [620, 228]];
  const COLOR_ESLABON = ["029", "061", "029", "011", "020", "061", "029", "061", "020", "011", "029", "061", "020"];
  const NOMBRE: Readonly<Record<string, string>> = { "029": "Fashion Verde Trébol", "061": "Fashion Naranja", "011": "Fashion Rosa", "020": "Fashion Amarillo" };
  const c = CENTROS.map(([x, y]) => px(x, y));
  const medios = c.slice(1).map((b, i) => por(mas(c[i]!, b), 0.5));
  const uniones = [menos(por(c[0]!, 2), medios[0]!), ...medios, menos(por(c[12]!, 2), medios[11]!)];
  for (let k = 0; k < 13; k++) {
    const a = uniones[k]!, b = uniones[k + 1]!;
    m.eslabon(`eslabon-${k + 1}`, `Eslabón LOL-12 ${NOMBRE[COLOR_ESLABON[k]!]} ${k + 1}`, R("LOL-12", r2(largo(menos(b, a)) / 1.47), COLOR_ESLABON[k]!), a, b);
  }
  return { sala: sala(500, 260, 320), nodos: m.nodos };
})();
const idea92 = idea("arco-feliz-dia", "Arco feliz día de columnas en espiral y cima de eslabones", escena92,
  "Igual: arco de ~2,9 m de alto y ~4,3 m de ancho: dos columnas de 8 cuartetos R-12 en espiral de cuatro colores (rosa, verde, naranja y mostaza) a la altura de la foto (a 0,75 diámetros: más juntos que el paso del taller; 1,7 m), y la cima de una sola fila de 13 eslabones Link-O-Loon de colores, de nudo a nudo, en el orden de la foto. La idea no publica productos; medidos: rosa → Fashion Rosa 011, verde de las columnas → Fashion Verde 030, naranja → 061, amarillo con lunares → Mostaza 023, eslabones verdes → Verde Trébol 029, amarillos → Amarillo 020. Distinto: los verdes con flores blancas y los amarillos con lunares blancos son impresos que la tienda no trae en esos colores (el lunar blanco lo vende sobre verde lima y rojo): van lisos; las cintas rizadas de las uniones no se modelan.");

// ----------------------------------------------------------------------------------------------------------
// 98 · Arco de Halloween de varios tamaños
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 740 × 570: el piso en y = 548 px, el centro en x = 355 px. Los R-5 miden ~25 px (12 cm: 2,1 px/cm), los R-12
 * ~50 px (24 cm) y los cristales grandes ~75 px (R-18 a 36 cm). Es un arco orgánico de patas rectas y esquinas
 * redondeadas (una U al revés): ejes de las patas en x = 170 y 540 px (1,76 m), el eje de arriba en y ≈ 100 px (2,12
 * m), de ~90 px de grueso (radio ~21 cm). A la vista: ~26 naranja (lisos y con lunares negros), ~14 negros (lisos y con
 * dibujo naranja), ~8 violeta, ~14 verde lima y ~8 cristal (3 grandes); 3 ojos (R-5 blanco con pupila negra) y arriba
 * a la izquierda una araña negra (cuerpo R-12, cabeza con ojos verdes, patas de T-260). Colores medidos (no publica
 * productos; la foto, sobresaturada): naranja #fe7c00 → Fashion Naranja 061 (ΔE 17, el más cercano); negro → Negro 080;
 * violeta #422084 → Fashion Violeta 051 (ΔE 9); verde lima #80c61a → Neón Verde 230 a 14 y Fashion Verde Lima 031 a 23:
 * va el Fashion, como el naranja (que también mide de más); cristal → Cristal Transparente 390.
 */
const escena98 = ((): Escena => {
  const px = (x: number, y: number, z: number): Vec3 => v(r2((x - 355) / 2.1), r2((548 - y) / 2.1), z);
  const mezcla = { "R-18": 0.12, "R-12": 1, "R-5": 0.45 };
  const forma = { ...opcionesArcoRectangular({
    anchoEjeCm: 176, altoEjeCm: 212, radioEsquinaCm: 45, radioBaseCm: 25, radioPataCm: 22, radioArribaCm: 21, hueco: null,
    mezcla: { base: mezcla, pata: mezcla, arriba: mezcla }, semilla: 98, colores: [],
  }), relleno: [], densidad: 1.5 };
  // Lo contado en la foto, por tamaño: los grandes, cristal; los R-12, sobre todo naranja; los R-5, sobre todo verde lima.
  const arco = organico({ ...forma, colores: coloresPorFormato(forma, {
    "R-18": [["390", 1]],
    "R-12": [["061", 40], ["080", 20], ["031", 15], ["051", 12], ["390", 13]],
    "R-5": [["031", 30], ["051", 25], ["061", 25], ["080", 20]],
  }) });
  const m = montaje({ id: "arco", nombre: "Arco orgánico de Halloween", pieza: arco, en: v(0, 0.5, 0) }, v(0, 0, -45));
  m.centrada("arana", "Araña negra de patas de T-260 (arriba a la izquierda)", deco(arana({
    cuerpo: R("R-12", 24, "080"), cabeza: R("R-9", 16, "080"), ojos: { hexIris: "#46c24a" },
    patas: { formatoId: "T-260", grosorCm: 3.5, codigo: "080", largoCm: 42, estilo: "articuladas" }, giroGrados: 200,
  })), px(205, 100, 22), AL_FRENTE);
  const SALTON: EstiloOjo = { iris: null, pupila: { hex: "#111111", proporcion: 0.42 }, brillo: true, venas: null };
  for (const [k, [x, y]] of ([[352, 118], [500, 282], [545, 415]] as const).entries()) m.centrada(`ojo-${k + 1}`, `Ojo R-5 blanco con pupila negra ${k + 1}`, deco(ojo(R("R-5", 11, "005"), SALTON, 200 + 40 * k)), px(x, y, 21), AL_FRENTE);
  return { sala: sala(320, 260, 300), nodos: m.nodos };
})();
const idea98 = idea("arco-halloween-de-varios-tamanos", "Arco de Halloween de varios tamaños con araña", escena98,
  "Igual: arco orgánico de ~2,4 m de alto y ~2,2 m de ancho, de patas rectas y esquinas redondeadas como el de la foto, con R-18, R-12 y R-5 en naranja, negro, violeta, verde lima y cristal en la proporción a la vista por tamaño (los grandes, solo cristal; los R-12, 40 % naranja, 20 % negro, 15 % verde lima, 12 % violeta y 13 % cristal; los R-5, sobre todo verde lima y violeta), 3 ojos de R-5 blanco con pupila negra y la araña negra arriba a la izquierda (cuerpo R-12, cabeza R-9 con ojos verdes y patas de T-260). La idea no publica productos; medidos: naranja → Fashion Naranja 061, violeta → Violeta 051, verde lima → Fashion Verde Lima 031 (la foto, sobresaturada, lo acerca al Neón Verde), cristal → 390. Distinto: los naranja con lunares negros y los negros con dibujo naranja no están en la tienda: van lisos; el arco se cuenta con el motor orgánico (no globo a globo); la araña de la foto lleva una sonrisa impresa y patas peludas (de T-260 lisas aquí).");

// ----------------------------------------------------------------------------------------------------------
// 114 · Arco navideño foil
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 740 × 570: el piso en y = 545 px, el centro en x = 365 px. Los R-12 verdes miden ~50–55 px (26 cm: 2 px/cm). Es
 * una herradura de cuartetos: el eje sigue una elipse (centro a ~84 cm del piso, semiejes 142,5 × 110 cm) de 215° a
 * −35°, y los pies se cierran hacia dentro. Por fuera, en cada unión de cuartetos, una pareja de R-5 dorados (22, a ~62
 * px una de otra); por dentro, una cadena de 21 eslabones rojos (Link-O-Loon 6, ~35 × 30 px) con una pareja de R-5
 * dorados en cada unión. Encima, tres metalizados: Papá Noel al centro (~120 px: 60 cm) y dos redondos verdes «Feliz
 * Navidad» de borde rojo (~70 px: 35 cm). Colores medidos (no publica productos): verde jade #007669 → Reflex Verde
 * Aurora 932 (ΔE 9–20; Verde Selva a 21–27); rojo #dd1912 → Fashion Rojo 015; dorado #a38130 → Reflex Dorado 970.
 */
const escena114 = ((): Escena => {
  const CENTRO = v(0, 84, 0), A = 142.5, B = 110, D = 26;
  const eje = elipse(CENTRO, A, B, 215, -35, 160);
  const guirnalda: Pieza = { tipo: "guirnalda", guirnalda: { formatoId: "R-12", infladoCm: D, patron: "un_color", colores: ["932"], anchoCm: 0, caidaCm: 0, recorrido: eje.map((p) => ({ x: r2(p.x), y: r2(p.y) })) } };
  const m = montaje({ id: "arco", nombre: "Arco en herradura de cuartetos verde jade", pieza: guirnalda, en: ORIGEN }, v(0, 0, -42));
  // Las 22 uniones, repartidas a lo largo del eje; «fuera», la normal de la elipse en ese punto.
  const L = largoPolilinea(eje);
  const uniones = aLoLargo(eje, Array.from({ length: 22 }, (_, j) => L * (0.02 + (0.96 * j) / 21))).map(({ p }) => {
    const fuera = unitario(v((p.x - CENTRO.x) / (A * A), (p.y - CENTRO.y) / (B * B), 0));
    return { p, fuera };
  });
  // Cada pareja: dos R-5 lado a lado a lo largo del arco, mirando hacia fuera (o hacia dentro), un poco abiertos.
  const DORADO = R("R-5", 9, "970");
  uniones.forEach(({ p, fuera }, j) => {
    const largoArco = v(-fuera.y, fuera.x, 0);
    for (const [donde, signo] of [["fuera", 1], ["dentro", -1]] as const) {
      const c = mas(p, por(fuera, 27 * signo));
      for (const [lado, s] of [["a", 1], ["b", -1]] as const) {
        m.globo(`pareja-${donde}-${j + 1}${lado}`, `R-5 Reflex Dorado de la pareja de ${donde} ${j + 1}${lado}`, DORADO, mas(c, por(largoArco, 4.5 * s)), unitario(mas(por(fuera, signo), por(largoArco, 0.35 * s))));
      }
    }
  });
  for (let j = 0; j < 21; j++) {
    const a = mas(uniones[j]!.p, por(uniones[j]!.fuera, -31)), b = mas(uniones[j + 1]!.p, por(uniones[j + 1]!.fuera, -31));
    m.eslabon(`eslabon-${j + 1}`, `Eslabón LOL-6 Fashion Rojo por dentro ${j + 1}`, R("LOL-6", r2(Math.min(15, largo(menos(b, a)) / 1.47)), "015"), a, b);
  }
  const FELIZ_NAVIDAD: OpcionesMetalizado = { forma: { tipo: "redondo" }, pulgadas: 14, color: "verde_vibrante", impreso: { dibujo: "texto", texto: "Feliz\nNavidad", hex: "#ffffff" } };
  m.metalizado("papa-noel", "Metalizado de Papá Noel (genérico: rojo con letrero)", { forma: { tipo: "redondo" }, pulgadas: 22, color: "rojo", impreso: { dibujo: "texto", texto: "Papá\nNoel", hex: "#ffffff" } }, v(0, 238, -4));
  m.metalizado("feliz-navidad-izquierda", "Metalizado redondo «Feliz Navidad» (izquierda)", FELIZ_NAVIDAD, v(-72.5, 220, -5), 10);
  m.metalizado("feliz-navidad-derecha", "Metalizado redondo «Feliz Navidad» (derecha)", FELIZ_NAVIDAD, v(70, 222.5, -5), -10);
  return { sala: sala(400, 260, 300), nodos: m.nodos };
})();
const idea114 = idea("arco-navideno-foil", "Arco navideño en herradura con metalizados", escena114,
  "Igual: herradura de ~2,6 m de alto y ~3,4 m de ancho de cuartetos R-12 verde jade cuyos pies se cierran hacia dentro, con una pareja de R-5 dorados por fuera en cada una de las 22 uniones, por dentro una cadena de 21 eslabones Link-O-Loon 6 rojos con su pareja dorada en cada unión, y encima tres metalizados: Papá Noel al centro y dos redondos verdes «Feliz Navidad». La idea no publica productos; medidos: verde jade → Reflex Verde Aurora 932, rojo → Fashion Rojo 015, dorado → Reflex Dorado 970. Distinto: en la foto los cuartetos van a ~1 diámetro (21 tramos) y el taller los pone a 0,8 a lo largo del mismo eje (más niveles); la tienda no vende el Papá Noel ni el «Feliz Navidad» redondo: van metalizados genéricos sin producto (un redondo rojo de 22\" con el letrero y dos verdes de 14\"), no se cotizan.");

// ----------------------------------------------------------------------------------------------------------
// 127 · Arco orgánico rosa
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 1000 × 1000: el piso en y = 975 px, el centro en x = 470 px. Los R-5 miden ~45 px (12 cm: 3,75 px/cm), los R-12
 * ~100 px (27 cm) y el grande de la base ~175 px (R-18 a 45 cm). Es medio arco orgánico contra la pared, por tramos de
 * color: un montículo de Reflex Rosado en el piso (con el R-18 arriba a la izquierda), un tramo de Arena que sube por la
 * izquierda (de 760 a 540 px), uno de Palo de Rosa (540 a 380 px), uno de Frambuesa que dobla arriba (de 380 px a la
 * derecha) y el brazo de Rosado claro que sigue horizontal hasta x = 850 px: ~2,3 m de alto y ~2,1 m de ancho. Siete
 * impresos «Feliz Día Mami» con flores blancas: cuatro rosados y fucsia (el surtido Rosa Silvestre) y tres rojos (el
 * surtido rojo-blanco). Colores: los publicados (Rosado 009, Frambuesa 014, Palo de Rosa 010, Arena 071, Reflex Rosado
 * 909); los impresos medidos: #ffc5c6 → Rosado 009, #f7849f y #fa81a9 → Fashion Rosa 011, #f36787 → Fucsia 012 (los del
 * Rosa Silvestre), #e24b56 → Rojo 015 (el del rojo-blanco).
 */
const escena127 = ((): Escena => {
  const R18 = { "R-18": 45, "R-12": 26, "R-5": 11 };
  const base = racimos({
    racimos: [{ puntos: [v(-92, 22, 0), v(-60, 18, 0), v(-25, 18, 0), v(0, 24, 0)], radio: 24 }, { puntos: [v(-88, 30, 0), v(-85, 62, 0)], radio: 22 }],
    mezcla: { "R-18": 0.3, "R-12": 2, "R-5": 3 }, inflados: R18, relleno: [], semilla: 127, colores: [colorOrg("909", 1)],
  });
  const m = montaje({ id: "base", nombre: "Montículo de Reflex Rosado del arco orgánico", pieza: base, en: v(0, 3, 0) }, v(55, 0, 0));
  const tramo = (id: string, nombre: string, codigo: string, puntos: Vec3[], radio: number, semilla: number) =>
    m.pieza(id, nombre, racimos({ racimos: [{ puntos: puntos.map(zAlReves), radio }], mezcla: { "R-12": 1, "R-5": 2.5 }, inflados: R18, relleno: [], semilla, colores: [colorOrg(codigo, 1)] }), ORIGEN, ARRIBA, 90);
  tramo("arena", "Tramo de Fashion Arena", "071", [v(-45.3, 57.3, 0), v(-48, 89.3, 0), v(-42.7, 116, 0)], 20, 128);
  tramo("palo-de-rosa", "Tramo de Fashion Palo de Rosa", "010", [v(-42.7, 116, 0), v(-42.7, 140, 0), v(-34.7, 158.7, 0)], 19, 129);
  tramo("frambuesa", "Tramo de Fashion Frambuesa", "014", [v(-34.7, 158.7, 0), v(-18.7, 182.7, 0), v(2.7, 193.3, 0), v(24, 178, 0)], 21, 130);
  tramo("rosado", "Brazo de Fashion Rosado", "009", [v(24, 180, 0), v(48, 190.7, 0), v(74.7, 193.3, 0), v(98.7, 185.3, 0)], 24, 131);
  const px = (x: number, y: number, z: number): Vec3 => v(r2((x - 470) / 3.75), r2((975 - y) / 3.75), z);
  const IMPRESOS: ReadonlyArray<readonly [Vec3, string, string]> = [
    [px(380, 225, 18), MAMI_ROSA, "009"], [px(260, 425, 18), MAMI_ROSA, "011"], [px(435, 530, 18), MAMI_ROSA, "012"], [px(830, 220, 18), MAMI_ROSA, "011"],
    [px(655, 160, 15), MAMI_ROJO, "015"], [px(230, 770, 22), MAMI_ROJO, "015"], [px(400, 720, 22), MAMI_ROJO, "015"],
  ];
  IMPRESOS.forEach(([c, impreso, codigo], k) => m.globo(`impreso-${k + 1}`, `R-12 Feliz Día Mami ${impreso === MAMI_ROJO ? "rojo" : "rosa silvestre"} ${k + 1}`, R("R-12", 26, codigo), c, enPlano(c.x / 150, 0.3, 1), impreso));
  return { sala: sala(320, 220, 280), nodos: m.nodos };
})();
const idea127 = idea("arco-organico", "Arco orgánico rosa con impresos Feliz Día Mami", escena127,
  "Igual: medio arco orgánico de ~2,3 m de alto que sale de un montículo de Reflex Rosado en el piso (con el R-18 arriba a la izquierda), sube por tramos de Arena y Palo de Rosa, dobla arriba en Frambuesa y sigue en un brazo horizontal de Rosado claro hasta ~2,1 m de ancho, con R-12 y R-5 en cada tramo, y los 7 impresos «Feliz Día Mami» de flores blancas donde los pone la foto (4 del surtido Rosa Silvestre en rosado, rosa y fucsia, y 3 del rojo-blanco en rojo), con los productos que publica la idea. Distinto: cada tramo es de un solo color (en la foto se mezclan un poco en las uniones); se cuenta con el motor orgánico (no globo a globo); la idea no publica los impresos: son los dos «Feliz Día Mami» de la tienda.",
  [
    P("GLOBO REDONDO FASHION ROSADO", "/products/globo-para-fiesta-latex-redondo-fashion-rosado", "R-12", "009"),
    P("GLOBO REDONDO FASHION FRAMBUESA", "/products/globo-para-fiesta-latex-redondo-fashion-frambuesa", "R-12", "014"),
    P("GLOBO REDONDO FASHION PALO DE ROSA", "/products/globo-para-fiesta-latex-redondo-fashion-palo-de-rosa", "R-12", "010"),
    P("GLOBO REDONDO FASHION ARENA", "/products/globo-para-fiesta-latex-redondo-fashion-arena", "R-12", "071"),
    P("GLOBO REDONDO REFLEX ROSADO", "/products/globo-para-fiesta-latex-redondo-reflex-rosado", "R-12", "909"),
  ]);

// ----------------------------------------------------------------------------------------------------------
// 134 · Arco de primera comunión (franjas de globos sueltos y pies de racimos dorados)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 1000 × 1000: el piso en y = 830 px, el centro en x = 490 px. Los impresos dorados «Mi Primera Comunión» miden
 * ~75 × 95 px (R-12 a 28 cm: 2,7 px/cm). Es un arco bajo de tres franjas de globos sueltos (no cuartetos), sobre
 * elipses con centro a 1 m del piso: por fuera 9 impresos dorados parados hacia fuera (semiejes 144 × 128 cm, de 167° a
 * 13°), en medio 19 globos champaña oscuro de ~60 px (22 cm; semiejes 131,5 × 100 cm) y por dentro 16 champaña claro
 * de ~50 px (18,5 cm; semiejes 111 × 81,5 cm). Los pies, dos racimos de dorados de R-5 a R-18 (~30 a 110 px: 11 a 40
 * cm), de x = 20 a 360 px y de 610 a 940 px: ~3,3 m de ancho y ~2,4 m de alto en total. Colores: los publicados (el
 * impreso, Reflex Champaña 971 y Reflex Dorado 970); medidos: la franja oscura #ba9282 → Reflex Champaña 971 (ΔE 8);
 * la clara #e6d9c9 → Satín Perla 406 (ΔE 4; no es la champaña publicada); los dorados de los pies #ddbe74 → Metal Dorado
 * 570 (ΔE 10; va el Reflex Dorado publicado).
 */
const escena134 = ((): Escena => {
  const INFLADOS = { "R-18": 40, "R-12": 25, "R-5": 11 };
  const pies = racimos({
    racimos: [
      { puntos: [v(-150, 30, 0), v(-105, 35, 0), v(-65, 30, 0)], radio: 34 }, { puntos: [v(-112, 55, 4), v(-97, 85, 0)], radio: 22 },
      { puntos: [v(65, 30, 0), v(110, 35, 0), v(158, 30, 0)], radio: 34 }, { puntos: [v(112, 55, 4), v(97, 85, 0)], radio: 22 },
    ],
    mezcla: { "R-18": 1, "R-12": 2, "R-5": 2 }, inflados: INFLADOS, relleno: [], semilla: 134, colores: [colorOrg("970", 1)],
  });
  const m = montaje({ id: "pies", nombre: "Pies de racimos Reflex Dorado del arco de primera comunión", pieza: pies, en: v(0, 1, 0) }, v(0, 0, -45));
  const C = v(0, 100, 0);
  const fila = (n: number, a: number, b: number, desde: number, hasta: number) => Array.from({ length: n }, (_, k) => {
    const t = rad(desde + ((hasta - desde) * k) / (n - 1));
    return { p: v(r2(C.x + a * Math.cos(t)), r2(C.y + b * Math.sin(t)), 0), fuera: unitario(v(Math.cos(t) / a, Math.sin(t) / b, 0)) };
  });
  fila(19, 131.5, 100, 184, -4).forEach(({ p, fuera }, k) => m.globo(`oscuro-${k + 1}`, `R-12 Reflex Champaña de la franja del medio ${k + 1}`, R("R-12", 22, "971"), p, fuera));
  fila(16, 111, 81.5, 186, -6).forEach(({ p, fuera }, k) => m.globo(`claro-${k + 1}`, `R-12 Satín Perla de la franja de dentro ${k + 1}`, R("R-12", 18.5, "406"), mas(p, v(0, 0, 4)), fuera));
  fila(9, 144, 128, 167, 13).forEach(({ p, fuera }, k) => m.globo(`impreso-${k + 1}`, `R-12 Reflex Dorado de la franja de fuera (el impreso «Mi Primera Comunión») ${k + 1}`, R("R-12", 28, "970"), mas(p, v(0, 0, -6)), fuera));
  return { sala: sala(420, 260, 300), nodos: m.nodos };
})();
const idea134 = idea("arco-primera-comunion-1", "Arco de primera comunión por franjas con pies dorados", escena134,
  "Igual: arco bajo de ~2,4 m de alto y ~3,3 m de ancho de tres franjas de globos sueltos, donde los pone la foto: por fuera 9 R-12 dorados parados hacia fuera, en medio 19 R-12 champaña oscuro (22 cm) y por dentro 16 champaña claro (18,5 cm); los pies, dos racimos de Reflex Dorado de R-18, R-12 y R-5, con los productos que publica la idea (Reflex Champaña 971 y Reflex Dorado 970). Distinto: el impreso «Mi Primera Comunión» Reflex Dorado de la tienda no está en el catálogo de impresos del taller: los 9 de fuera van lisos en Reflex Dorado 970 (el impreso publicado se lista sin cantidad); la franja clara mide Satín Perla 406 (la idea publica una sola champaña); los pies se cuentan con el motor orgánico (no globo a globo).",
  [
    P("GLOBO REDONDO MI PRIMERA COMUNIÓN PALOMAS", "/products/globo-para-fiesta-latex-redondo-2-caras-mi-primera-comunion-palomas-reflex-dorado", "R-12", null),
    P("GLOBO REDONDO REFLEX CHAMPAÑA", "/products/globo-para-fiesta-latex-redondo-reflex-champana", "R-12", "971"),
    P("GLOBO LATEX REDONDO REFLEX DORADO", "/products/globo-para-fiesta-latex-redondo-reflex-dorado", "R-12", "970"),
  ]);

// ----------------------------------------------------------------------------------------------------------
// 135 · Arco de primera comunión (cuartetos dobles y burbujas)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 740 × 570 (de Cecilia González): el piso en y = 545 px, el centro en x = 370 px. Los cuartetos miden ~45 px de
 * globo (R-12 a 23 cm: 2,05 px/cm). Arco de semielipse (ejes de las patas en x = 95 y 645 px: semiejes 134 × 220 cm)
 * de 25 cuartetos de un color cada uno —verde, lila, blanco perlado y rosado— y 4 globos cristal grandes con globitos
 * dentro (~80 px: R-18 a 38 cm) que ocupan dos niveles cada uno, en este orden (de la pata izquierda a la derecha):
 * verde, lila, blanco, rosado, verde, cristal, verde, lila, blanco, rosado, verde, cristal, verde, lila, blanco | rosado
 * (arriba) | verde, cristal, verde, lila, blanco, rosado, verde, cristal, verde, lila, blanco, rosado, verde. Los verdes
 * y lilas son «globo dentro de globo»: el borde de color y el centro pálido (un cristal con un globo de color dentro).
 * Colores medidos (no publica productos): el borde verde #08ae02 → Fashion Verde Trébol 029 y su centro #c1e9cc → Pastel
 * Dusk Té Verde 126; el lila #bb7eb6 → Satín Lila 450 y su borde morado → Fashion Lila 050 (ΔE 16) dentro de un cristal;
 * el blanco perlado #e7dfe8 → Satín Perla 406; el rosado, con vetas fucsia y blancas, es el Graffiti Rosa sobre cristal
 * de la tienda.
 */
const escena135 = ((): Escena => {
  const A = 134, B = 220, Y0 = 12.7, D = 23;
  const SECUENCIA = "GLWPGBGLWPGBGLWPGBGLWPGBGLWPG";
  const ranuras = [...SECUENCIA].reduce((s, c) => s + (c === "B" ? 2 : 1), 0);
  // El eje baja medio paso para que el centro del primer cuarteto quede a Y0 (apoyado en el piso).
  const paso = largoPolilinea(elipse(v(0, 0, 0), A, B, 180, 0, 160)) / ranuras;
  const eje = elipse(v(0, Y0 - paso / 2, 0), A, B, 180, 0, 160);
  const CRISTAL = R("R-12", D, "390");
  const DENTRO: Readonly<Record<string, ParteGlobo>> = { G: R("R-12", 22.5, "029"), L: R("R-12", 22.5, "050") };
  const NOMBRE: Readonly<Record<string, string>> = { G: "verde (Verde Trébol dentro de un cristal)", L: "lila (Fashion Lila dentro de un cristal)", W: "Satín Perla", P: "Graffiti Rosa" };
  let m: Montaje | null = null;
  let s = 0, nivel = 0, cristal = 0;
  for (const c of SECUENCIA) {
    const ancho = c === "B" ? 2 : 1;
    const [{ p, t }] = aLoLargo(eje, [s + (ancho * paso) / 2]) as [{ p: Vec3; t: Vec3 }];
    s += ancho * paso;
    if (c === "B") {
      cristal++;
      m!.centrada(`cristal-${cristal}`, `Globo cristal R-18 con globitos dentro ${cristal}`, deco(burbuja(R("R-18", 38, "390"), [{ formatoId: "R-5", infladoCm: 9, codigos: ["029", "050", "009", "406"], cantidad: 8 }], 135 + cristal)), p, AL_FRENTE);
      continue;
    }
    nivel++;
    const giro = 45 * nivel;
    const exterior = c === "W" ? R("R-12", D, "406") : CRISTAL;
    const impresos: ImpresoEnPieza[] | undefined = c === "P" ? [{ impresoId: GRAFFITI_ROSA, codigo: "390" }] : undefined;
    const nombre = `Cuarteto R-12 ${NOMBRE[c]} (nivel ${nivel})`;
    if (!m) m = montaje({ id: "arco", nombre: `Arco de primera comunión: ${nombre.charAt(0).toLowerCase()}${nombre.slice(1)}`, pieza: cuarteto(exterior, [exterior.codigo]), en: redondo(p) }, v(0, 0, -40));
    else m.nivel(`nivel-${nivel}`, nombre, exterior, [exterior.codigo], p, t, giro, "un_color", impresos);
    const dentro = DENTRO[c];
    if (dentro) m.nivel(`nivel-${nivel}-dentro`, `Cuarteto R-12 ${dentro.codigo === "029" ? "Fashion Verde Trébol" : "Fashion Lila"} dentro de los cristales (nivel ${nivel})`, dentro, [dentro.codigo], p, t, giro);
  }
  return { sala: sala(380, 260, 300), nodos: m!.nodos };
})();
const idea135 = idea("arco-primera-comunion", "Arco de primera comunión de cuartetos dobles y cristales", escena135,
  "Igual: arco de semielipse de ~2,5 m de alto y ~3,2 m de ancho con 25 cuartetos R-12 de un color cada uno (verde, lila, blanco perlado y rosado) y 4 globos cristal R-18 con 8 R-5 dentro (verde, lila, rosado y perla) en el orden de la foto, cada uno en su punto del arco (a ~0,74 diámetros: más juntos que el paso del taller); los verdes y lilas son globo dentro de globo (un cuarteto de cristal con otro de color dentro, ocho R-12 por nivel) y los rosados el Graffiti Rosa de la tienda. La idea no publica productos; medidos: verde → Verde Trébol 029 dentro de cristal 390, lila → Fashion Lila 050 dentro de cristal, blanco → Satín Perla 406. Distinto: el orden de la mitad derecha se lee mal en la foto (puede no ser simétrico); los globitos de dentro de los cristales grandes se acomodan solos; el lila medido queda entre Satín Lila y Fashion Lila.");

// ----------------------------------------------------------------------------------------------------------
// 149 · Aro de arañas
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 1600 × 1600 (de Paola Tamayo, fondo transparente): el aro mide 1460 px de lado a lado. Por fuera, 22 R-12 de
 * ~185 px con telarañas y arañas negras impresas (R-12 a 25 cm: 7,4 px/cm): ~1,97 m. Por dentro, una corona orgánica
 * de R-9 de 120–170 px (16–23 cm) y R-5 en eucalipto, verde, durazno, naranja y café, y arriba 16 ojos (R-9 blancos de
 * ~110 px, 15 cm, con iris rojo y venitas); el hueco del centro mide ~540 px (73 cm). Dos arañas negras de T-260: la
 * grande abajo a la derecha (cuerpo de ~190 px: R-12 a 26 cm, patas de ~55 cm) y la chica en el hueco (cuerpo R-5 de 12
 * cm, patas de ~30 cm). Colores: los publicados (Durazno 060, Café 074, Naranja 061, Eucalipto 027, Negro 080, Blanco
 * 005); medidos: los de fuera #a7c284 → Reflex Verde Lima 931 a ΔE 14 y Eucalipto 027 a 15 (va el publicado); el verde
 * esmeralda de dentro #28bf77 → Fashion Verde 030 (no publicado); el beige #d2d29e mide Arena 071: va el Durazno
 * publicado.
 */
const escena149 = ((): Escena => {
  const D = 197, CY = 60 + D / 2;
  // La corona de dentro: un anillo orgánico cerrado (eje a 55 cm del centro, 8 cm por delante de la fila de fuera).
  const circulo = Array.from({ length: 29 }, (_, i) => { const a = -Math.PI / 2 + (i / 28) * 2 * Math.PI; return v(r2(55 * Math.cos(a)), r2(CY + 55 * Math.sin(a)), 8); });
  const forma: OpcionesOrganico = {
    ...opcionesRacimosLibres({ racimos: [{ id: "corona", nombre: "Corona de dentro", puntos: circulo, radioInicioCm: 21, radioFinCm: 21, mezcla: constante({ "R-9": 3, "R-5": 1 }), tapas: { inicio: false, fin: false } }], colores: [], semilla: 149, suelo: false, relleno: [] }),
    inflados: { "R-9": 19, "R-5": 11 },
  };
  const corona = organico({ ...forma, colores: coloresPorFormato(forma, {
    "R-9": [["027", 8], ["030", 9], ["060", 6], ["061", 7], ["074", 9]],
    "R-5": [["027", 1], ["030", 1], ["060", 1], ["061", 1], ["074", 1]],
  }) });
  const m = montaje({ id: "aro", nombre: "Corona orgánica de Halloween eucalipto, verde, durazno, naranja y café", pieza: corona, en: v(0, 0, -20) }, v(125, 0, -20));
  // La fila de fuera: 22 R-12 eucalipto (los de la foto, con telarañas impresas), con el nudo hacia el centro.
  for (let k = 0; k < 22; k++) {
    const a = Math.PI / 2 + (2 * Math.PI * k) / 22;
    m.globo(`fuera-${k + 1}`, `R-12 Fashion Eucalipto de la fila de fuera ${k + 1}`, R("R-12", 25, "027"), v(r2(86 * Math.cos(a)), r2(CY + 86 * Math.sin(a)), -20), v(Math.cos(a), Math.sin(a), 0));
  }
  const px = (x: number, y: number, z: number): Vec3 => v(r2((x - 800) / 7.4), r2(CY + (800 - y) / 7.4), z);
  const VENAS: EstiloOjo = { iris: { hex: "#c8102e", proporcion: 0.3 }, pupila: { hex: "#111111", proporcion: 0.16 }, brillo: true, venas: { hex: "#b0303a", cantidad: 6 } };
  const OJOS: ReadonlyArray<readonly [number, number]> = [
    [285, 230], [335, 250], [372, 212], [410, 218], [458, 210], [510, 238], [566, 242], [578, 290],
    [530, 292], [437, 256], [390, 262], [300, 282], [255, 300], [212, 340], [255, 338], [200, 397],
  ];
  OJOS.forEach(([x, y], k) => m.centrada(`ojo-${k + 1}`, `Ojo R-9 blanco con venas ${k + 1}`, deco(ojo(R("R-9", 14.5, "005"), VENAS, (k * 47) % 360)), px(2 * x, 2 * y, 8), AL_FRENTE));
  m.centrada("arana-grande", "Araña grande de patas de T-260 negro (abajo a la derecha)", deco(arana({
    cuerpo: R("R-12", 26, "080"), cabeza: R("R-9", 14, "080"), ojos: { hexIris: "#8a1c1c" },
    patas: { formatoId: "T-260", grosorCm: 3.5, codigo: "080", largoCm: 55, estilo: "articuladas" }, giroGrados: 135,
  })), px(1200, 1160, 10), AL_FRENTE);
  m.centrada("arana-chica", "Araña chica de patas de T-260 negro (en el hueco)", deco(arana({
    cuerpo: R("R-5", 12, "080"), cabeza: R("R-5", 8, "080"), ojos: { hexIris: "#8a1c1c" },
    patas: { formatoId: "T-260", grosorCm: 2.5, codigo: "080", largoCm: 30, estilo: "articuladas" }, giroGrados: 150,
  })), px(740, 880, -8), AL_FRENTE);
  return { sala: sala(380, 200, 300), nodos: m.nodos };
})();
const idea149 = idea("aro-de-aranas", "Aro de arañas con ojos", escena149,
  "Igual: aro de pared de ~1,97 m con la fila de fuera de 22 R-12 contados uno a uno (con el nudo hacia el centro) y por dentro una corona orgánica de R-9 y R-5 en eucalipto, verde, durazno, naranja y café (en la proporción a la vista), 16 ojos R-9 blancos con iris rojo y venitas arriba, y las dos arañas negras de T-260 (la grande abajo a la derecha con cuerpo R-12 y la chica en el hueco), con los productos que publica la idea. Distinto: los de fuera llevan telarañas y arañas negras impresas sobre un verde metalizado que la tienda no vende: van lisos en Fashion Eucalipto 027 (publicado; la foto los mide más cerca del Reflex Verde Lima); el verde esmeralda de dentro no está publicado (medido: Fashion Verde 030); en la foto los ojos van todos arriba y los colores por zonas, el motor los reparte; las patas de la araña grande llevan rayitas blancas pintadas.",
  [
    P("GLOBO REDONDO FASHION DURAZNO", "/products/globo-para-fiesta-latex-redondo-fashion-durazno", "R-12", "060"),
    P("GLOBO REDONDO FASHION CAFÉ", "/products/globo-para-fiesta-latex-redondo-fashion-cafe", "R-12", "074"),
    P("GLOBO REDONDO FASHION NARANJA", "/products/globo-para-fiesta-latex-redondo-fashion-naranja", "R-12", "061"),
    P("GLOBO REDONDO FASHION EUCALIPTO", "/products/globo-para-fiesta-latex-redondo-fashion-eucalipto", "R-12", "027"),
    P("GLOBO REDONDO FASHION NEGRO", "/products/globo-para-fiesta-latex-redondo-fashion-negro", "R-12", "080"),
    P("GLOBO REDONDO FASHION BLANCO", "/products/globo-para-fiesta-latex-redondo-fashion-blanco", "R-12", "005"),
  ]);

// ----------------------------------------------------------------------------------------------------------
// 152 · Arreglo calabaza
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 1600 × 1560 (fondo transparente): la base en y = 1540 px, el centro en x = 800 px. El impreso «Happy Halloween»
 * (R-12, ~600 px de ancho) y los R-5 negros (~90 px) dan la escala con los verdes de la base (~360 px): 18 px/cm, R-12
 * verdes a ~21 cm, el impreso lleno (30 cm), los negros a ~5,5 cm. Base de dos anillos de R-12 verde lima (8 abajo y 6
 * arriba: al frente se ven 3 y los bordes) con racimos de 4 R-5 negros entre ellos (4 a la vista, 6 alrededor); encima,
 * a la izquierda, una calabaza naranja de ~660 px (37 cm) con un anillo de 5 R-5 verdes y un tallo de T-260 verde; a la
 * derecha el impreso violeta sobre un racimo de 4 R-5 morados y dos rizos de T-260 morado (una espiral al frente y un
 * gancho a la derecha): ~89 cm de ancho y ~87 cm de alto. Colores: los publicados (el impreso Happy Halloween —su
 * violeta es el Reflex Violeta 951 del surtido—, Naranja 061, Negro 080, Verde Lima 031); el morado de los rizos y del
 * racimo #2a254a → Fashion Azul Naval 044 (ΔE 9; el violeta más cercano, Reflex Violeta, a 25).
 */
const escena152 = ((): Escena => {
  const px = (x: number, y: number, z: number): Vec3 => v(r2((x - 800) / 18), r2((1540 - y) / 18), z);
  const base: Pieza = { tipo: "forma", forma: { clase: "cono", altoCm: 40, tecnica: "anillos", formatoId: "R-12", infladoBaseCm: 22, infladoPuntaCm: 21, globosBase: 8, globosPunta: 4, colores: { codigos: ["031"], patron: "un_color" } } };
  const m = montaje({ id: "base", nombre: "Base de dos anillos de R-12 verde lima", pieza: base, en: ORIGEN }, v(0, 0, -45));
  const NEGRO = deco(anillo(R("R-5", 5.5, "080"), 4, 10, 45));
  for (let k = 0; k < 6; k++) {
    const a = rad(90 + 30 + 60 * k);
    m.centrada(`negros-${k + 1}`, `Racimo de 4 R-5 Fashion Negro ${k + 1}`, NEGRO, v(r2(33 * Math.cos(a)), 22, r2(33 * Math.sin(a))), unitario(v(Math.cos(a), 0.2, Math.sin(a))));
  }
  m.centrada("calabaza", "Calabaza R-18 Fashion Naranja", deco({ tipo: "calabaza", propiedades: { globo: R("R-18", 37, "061"), cara: null, tallo: null } }), v(-18, 46, 0), AL_FRENTE);
  m.centrada("calabaza-tapa", "Anillo de 5 R-5 Fashion Verde Lima (tapa de la calabaza)", deco(anillo(R("R-5", 6, "031"), 5, 25)), v(-19, 77, 0), ARRIBA);
  m.pieza("calabaza-tallo", "Tallo de T-260 Fashion Verde Lima", deco(rizo({ forma: "burbujas", formatoId: "T-260", grosorCm: 3, codigos: ["031"], largosCm: [15], recorrido: "recta", cantidad: 1 })), v(-17, 94, 0), AL_FRENTE);
  m.centrada("impreso-racimo", "Racimo de 4 R-5 Fashion Azul Naval (bajo el impreso)", deco(anillo(R("R-5", 6, "044"), 4, 20, 45)), px(1010, 850, 6), ARRIBA);
  m.globo("impreso", "R-12 Happy Halloween Reflex Violeta", R("R-12", 30, "951"), px(1040, 500, 6), enPlano(0.1, 1, 0.1), HAPPY_HALLOWEEN);
  m.centrada("rizo-espiral", "Rizo en espiral de T-260 Fashion Azul Naval (al frente)", deco(rizo({ forma: "voluta", tubito: { formatoId: "T-260", grosorCm: 3.5, codigo: "044" }, vueltas: 1.6, radioInicialCm: 2, radioFinalCm: 9 })), px(860, 1080, 32), AL_FRENTE);
  m.centrada("rizo-gancho", "Rizo en gancho de T-260 Fashion Azul Naval (a la derecha)", deco(rizo({ forma: "voluta", tubito: { formatoId: "T-260", grosorCm: 3.5, codigo: "044" }, vueltas: 0.7, radioInicialCm: 15, radioFinalCm: 9, giroGrados: 200 })), px(1330, 820, 10), AL_FRENTE);
  return { sala: sala(220, 200, 200), nodos: m.nodos };
})();
const idea152 = idea("arreglo-calabaza", "Arreglo de calabaza con impreso Happy Halloween", escena152,
  "Igual: centro de mesa de ~90 cm de alto: base de dos anillos de R-12 verde lima (8 y 6) con 6 racimos de 4 R-5 negros entre ellos; encima la calabaza naranja (R-18 de 37 cm) con su tapa de 5 R-5 verde lima y el tallo de T-260 verde lima, y a la derecha el R-12 Happy Halloween violeta de la tienda sobre un racimo de 4 R-5 morados con dos rizos de T-260 morado (una espiral al frente y un gancho), con los productos que publica la idea. Distinto: la calabaza de la foto es de gajos (varios globos) y aquí un R-18 con sus gajos dibujados; el tallo de la foto se dobla en la punta (aquí recto); el morado de los rizos y del racimo mide Fashion Azul Naval 044 (no publicado); la idea publica los lisos como R-12: la calabaza va en R-18 y los negros en R-5.",
  [
    P("GLOBO REDONDO HAPPY HALLOWEEN", "/products/globo-para-fiesta-latex-redondo-2-caras-happy-halloween-noche-reflex-surtido", "R-12", null),
    P("GLOBO REDONDO FASHION NARANJA", "/products/globo-para-fiesta-latex-redondo-fashion-naranja", "R-12", "061"),
    P("GLOBO REDONDO FASHION NEGRO", "/products/globo-para-fiesta-latex-redondo-fashion-negro", "R-12", "080"),
    P("GLOBO REDONDO FASHION VERDE LIMA", "/products/globo-para-fiesta-latex-redondo-fashion-verde-lima", "R-12", "031"),
  ]);

/** Ideas de fiesta de sempertex.com digitalizadas: lote 15 (en el orden de `clasif/lote-15.json`). */
export const LOTE_15: readonly IdeaDigitalizada[] = [idea35, idea41, idea45, idea57, idea76, idea78, idea91, idea92, idea98, idea114, idea127, idea134, idea135, idea149, idea152];
