import { armarEscena, idNuevo, type Colocacion, type Escena, type EscenaArmada, type NodoArmado, type NodoEscena } from "./escena";
import { armarPieza, type Pieza } from "./piezas";
import { DECORACIONES_PREDEFINIDAS, decoracionPredefinida } from "./figuras";
import { esDePie } from "./halloween";
import { crearEstructura } from "./herramientas-escena-estructuras";
import { recolorearConPaleta } from "./herramientas-escena-recolor";
import { referenciaDePedido } from "./herramientas-escena-colores";
import { aceptaDecoraciones, colocacionSobre, radioLateral, sitioDescrito } from "./lienzo-escena";
import { colocarOtro, type LugarOtro } from "./lectura-otro-colocar";
import { ALTO_RELLENO_CM, ALTO_RELLENO_GIGANTE_CM, type FiguraOtro } from "./lectura-otro-figura";
import type { FondoFijo } from "./mobiliario-tipos";

/**
 * **Las figuras de una lectura, armadas** (`lectura-otro-figura.ts` dice cuáles son): cada una con la pieza que el taller ya tiene, la
 * misma que le daría la IA de escena con `agregar_pieza` (una decoración de la biblioteca por su id; una forma rellena con el texto):
 * - las decoraciones que van sobre la estructura (rizos, flores de globos) se apoyan en la superficie de la que más globos tiene,
 *   repartidas a lo ancho y a distintas alturas; si no hay estructura con globos, en la pared del fondo;
 * - lo que va en el piso (calabazas, un número relleno de globos) cae en un hueco del piso, del lado que diga la descripción, y si
 *   son varias y no dice lado, repartidas a los dos lados (`colocarOtro`, como las piezas del catálogo que el lector escribió como «otro»);
 * - lo que no sale de la descripción (la altura de un número, el color de una calabaza) es el de la biblioteca o el de siempre, y la nota
 *   lo dice para que se ajuste. Lo que la foto lleva y el taller no arma (la caja del mosaico, las flores de tela) queda dicho en la nota.
 */

export type FiguraPorColocar = { indice: number; descripcion: string; figuras: readonly FiguraOtro[]; lugar: Pick<LugarOtro, "lado" | "profundidad"> };

/** Nombres de color que dice el lector y la tabla Sempertex no tiene, con el que se les parece. */
const COLOR_PARECIDO: Readonly<Record<string, string>> = { malva: "lila", salvia: "verde menta", "verde salvia": "verde menta", "verde oliva": "verde", "verde limon": "verde menta", beige: "nude", champan: "crema", terracota: "coral", vino: "rojo" };
/** Sin color dicho, un número relleno va blanco. */
const COLOR_DE_SIEMPRE = "blanco";
const ALTURA_EN_PARED_CM = 140;
const SEPARACION_EN_PARED_CM = 70;

const medidasDe = (pieza: Pieza) => { const { min, max } = armarPieza(pieza).caja; return { anchoCm: max.x - min.x, fondoCm: max.z - min.z, altoCm: max.y - min.y }; };
const r1 = (n: number) => Math.round(n * 10) / 10;

/** Los colores dichos que la tabla conoce (con su parecido si no: `parecidos` dice cuál por cuál) y los que no se pudieron resolver. */
function coloresConocidos(dichos: readonly string[]): { colores: string[]; parecidos: string[]; sinColor: string[] } {
  const colores: string[] = [], parecidos: string[] = [], sinColor: string[] = [];
  for (const dicho of dichos) {
    const exacto = Boolean(referenciaDePedido(dicho));
    const nombre = exacto ? dicho : COLOR_PARECIDO[dicho];
    if (nombre && referenciaDePedido(nombre)) {
      if (!colores.includes(nombre)) colores.push(nombre);
      if (!exacto) parecidos.push(`${dicho} → ${nombre}`);
    } else sinColor.push(dicho);
  }
  return { colores, parecidos, sinColor };
}

/** Las estructuras que sirven de lienzo a lo que «va pegado»: no los números ni las formas del piso, ni las decoraciones. */
const ESTRUCTURAS_LIENZO: ReadonlySet<string> = new Set(["organico", "arco_organico", "columna", "arco", "guirnalda", "pared_malla", "pared_trenzas"]);

/** La estructura que más globos tiene y admite decoraciones encima: el lienzo de lo que «va pegado». */
function lienzoDe(escena: Escena, armada: EscenaArmada): NodoArmado | null {
  const candidatos = escena.nodos.flatMap((n) => { const armado = armada.porNodo.find((a) => a.id === n.id); return ESTRUCTURAS_LIENZO.has(n.pieza.tipo) && armado && aceptaDecoraciones(n, armado) ? [armado] : []; });
  return candidatos.sort((a, b) => b.globos.length - a.globos.length)[0] ?? null;
}

/** El sitio de la copia `k` de `n` en la superficie del lienzo: repartida a lo ancho (el 70 % central) y a alturas que se alternan; `null` si por ahí no hay globos. */
function sitioSobre(padre: NodoArmado, pieza: Pieza, k: number, n: number): Colocacion | null {
  const { min, max } = padre.caja;
  const xCm = ((k + 0.5) / n - 0.5) * (max.x - min.x) * 0.7;
  const radio = radioLateral(pieza);
  const alturas = [min.y + (max.y - min.y) * (0.35 + 0.4 * ((k * 0.618) % 1)), (min.y + max.y) / 2];
  for (const alturaCm of alturas) {
    const sitio = sitioDescrito(padre, { alturaCm, lado: "frente", xCm }, radio);
    if (!("error" in sitio)) return colocacionSobre(padre, sitio, 0);
  }
  return null;
}

/** Cuántas decoraciones como esta caben en la cara de una estructura sin encimarse: una por cada cuadrado de 1,3 diámetros de lado de lo que se ve de frente (al menos dos). */
function capacidadDe(padre: NodoArmado, pieza: Pieza): number {
  const { min, max } = padre.caja;
  const { min: desde, max: hasta } = armarPieza(pieza).caja;
  const diametro = Math.max(10, hasta.x - desde.x, hasta.z - desde.z);
  return Math.max(2, Math.floor(((max.x - min.x) * (max.y - min.y)) / (1.3 * diametro) ** 2));
}

/** El sitio de la copia `k` en la pared del fondo: del centro hacia los lados (0, +70, −70…) sin salirse de la sala, y otra hilera más arriba cuando se acaba el ancho. */
function sitioEnPared(sala: Escena["sala"], k: number): { aLoLargoCm: number; alturaCm: number } {
  const columnas = Math.max(1, Math.floor((sala.anchoCm - 80) / SEPARACION_EN_PARED_CM));
  const columna = k % columnas;
  const desfase = columna === 0 ? 0 : (columna % 2 === 1 ? 1 : -1) * Math.ceil(columna / 2);
  return { aLoLargoCm: r1(desfase * SEPARACION_EN_PARED_CM), alturaCm: Math.min(Math.max(0, sala.altoCm - 60), ALTURA_EN_PARED_CM + Math.floor(k / columnas) * SEPARACION_EN_PARED_CM / 2) };
}

/** El lado de la copia `k` de `n`: el que dice la descripción; si no dice y son varias, a un lado y al otro. */
const ladoDe = (k: number, n: number, lado: LugarOtro["lado"]): LugarOtro["lado"] => (lado !== 0 || n === 1 ? lado : k % 2 === 0 ? -1 : 1);

/** Una entrada vacía del catálogo de fondos, solo para que `colocarOtro` busque hueco en el piso a una pieza que no es del catálogo. */
const entradaDePiso = (id: string, nombre: string): FondoFijo => ({ clase: "fondo", id, nombre, descripcion: nombre, lugar: "piso", elementos: () => [] });

function agregar(escena: Escena, base: string, nombre: string, pieza: Pieza, colocacion: Colocacion): { escena: Escena; id: string } {
  const id = idNuevo(escena, base);
  const nodo: NodoEscena = { id, nombre, pieza, colocacion };
  return { escena: { ...escena, nodos: [...escena.nodos, nodo] }, id };
}

/**
 * Lo que comparten todas las figuras de la lectura: los sitios de la estructura (uno por copia, repartidos entre todas las descripciones
 * para que no se encimen), cuántas cayeron en la pared por falta de estructura y lo que ya está puesto en el piso.
 */
type Compartido = { sitios: ReadonlyMap<FiguraOtro, readonly number[]>; totalSitios: number; enPared: number; otrosPuestos: Set<string>; notas: string[] };
type Contexto = { indice: number; descripcion: string; lugar: FiguraPorColocar["lugar"] };

function ponerDecoracion(escena: Escena, figura: Extract<FiguraOtro, { clase: "decoracion" }>, c: Contexto, comun: Compartido): Escena {
  const { notas } = comun;
  const nombre = DECORACIONES_PREDEFINIDAS.find((d) => d.id === figura.id)?.nombre ?? "Decoración";
  const decoracion = structuredClone(decoracionPredefinida(figura.id));
  const dePie = esDePie(decoracion);
  let pieza: Pieza = { tipo: "decoracion", decoracion };
  const { colores, parecidos, sinColor } = coloresConocidos(figura.colores);
  if (colores.length) pieza = recolorearConPaleta(pieza, colores, notas).pieza;
  const deFrente = (p: Pieza): Pieza => (p.tipo === "decoracion" ? { ...p, deFrente: true } : p);
  const padre = figura.sobreEstructura ? lienzoDe(escena, armarEscena(escena)) : null;
  const capacidad = padre ? capacidadDe(padre, pieza) : 0;
  const medidas = figura.sobreEstructura ? null : medidasDe(dePie ? deFrente(pieza) : pieza);
  const sitios = comun.sitios.get(figura) ?? [];
  let actual = escena;
  let sobreLaEstructura = 0, enLaPared = 0;
  for (let k = 0; k < figura.cantidad; k++) {
    const base = figura.id.replace(/_/g, "-");
    if (figura.sobreEstructura) {
      const sitio = sitios[k] ?? k;
      const sobre = padre && sitio < capacidad ? sitioSobre(padre, pieza, sitio, comun.totalSitios) : null;
      if (sobre) { actual = agregar(actual, base, nombre, pieza, sobre).escena; sobreLaEstructura++; }
      else {
        const colocacion: Colocacion = { en: "pared", pared: "fondo", ...sitioEnPared(actual.sala, comun.enPared++) };
        actual = agregar(actual, base, nombre, deFrente(pieza), colocacion).escena;
        enLaPared++;
      }
    } else {
      const sitio = colocarOtro(actual, entradaDePiso(figura.id, nombre), medidas!, { lado: ladoDe(k, figura.cantidad, c.lugar.lado), profundidad: c.lugar.profundidad }, comun.otrosPuestos);
      const puesta = agregar(sitio.escena, base, nombre, dePie ? deFrente(pieza) : pieza, sitio.colocacion);
      actual = puesta.escena;
      comun.otrosPuestos.add(puesta.id);
      if (sitio.aviso) notas.push(sitio.aviso);
    }
  }
  const donde = !figura.sobreEstructura ? "puesta en el piso"
    : !enLaPared ? `puesta sobre «${padre!.nombre}»`
      : !sobreLaEstructura ? "puesta en la pared del fondo (no hay estructura de globos donde apoyarla)"
        : `${sobreLaEstructura} sobre «${padre!.nombre}» y ${enLaPared} en la pared del fondo (donde la estructura no tiene globos)`;
  const cuenta = figura.cantidad > 1 ? ` (${figura.cantidad} copias${figura.cantidadSupuesta ? ": la descripción solo dice el plural, y se supuso esa cuenta" : ""})` : "";
  const dePlastico = /\binflables?\b/i.test(c.descripcion) ? " La de la foto es inflable; esta se arma de globos." : /\bfoil\b/i.test(c.descripcion) ? " Lo de la foto es de foil; esto se arma de globos de látex." : "";
  const color = colores.length ? ` Colores: ${colores.join(", ")}${parecidos.length ? ` (${parecidos.join(", ")}: la tabla no tiene el primero)` : ""}.` : "";
  const sinTabla = sinColor.length ? ` No encontré en la tabla Sempertex: ${sinColor.join(", ")}.` : "";
  notas.push(`Pieza ${c.indice + 1} (otro): «${c.descripcion}» se armó con ${nombre} de la biblioteca${cuenta}, ${donde}: ${colores.length ? "su medida es la" : "su medida y su color son los"} de la biblioteca, no ${colores.length ? "la" : "los"} de la foto.${color}${sinTabla}${dePlastico} Ajústala.`);
  return actual;
}

function ponerTexto(escena: Escena, figura: Extract<FiguraOtro, { clase: "texto" }>, c: Contexto, comun: Compartido): Escena {
  const { notas } = comun;
  const alto = figura.gigante ? ALTO_RELLENO_GIGANTE_CM : ALTO_RELLENO_CM;
  const { colores, parecidos, sinColor } = coloresConocidos(figura.colores);
  const notasDeLaHerramienta: string[] = [];
  const hecho = crearEstructura("forma", { texto: figura.texto, alto_cm: alto, tecnica: "organico", colores: colores.length ? colores : [COLOR_DE_SIEMPRE] }, notasDeLaHerramienta);
  const sitio = colocarOtro(escena, entradaDePiso("forma", hecho.nombre), medidasDe(hecho.pieza), { lado: c.lugar.lado, profundidad: c.lugar.profundidad }, comun.otrosPuestos);
  const puesta = agregar(sitio.escena, /^\d/.test(figura.texto) ? "numero-globos" : "letra-globos", hecho.nombre, hecho.pieza, sitio.colocacion);
  comun.otrosPuestos.add(puesta.id);
  if (sitio.aviso) notas.push(sitio.aviso);
  const usados = colores.length ? colores.join(", ") : figura.colores.length ? `${COLOR_DE_SIEMPRE} (los colores que dice no están en la tabla)` : `${COLOR_DE_SIEMPRE} (la descripción no dice el color)`;
  const cambiados = parecidos.length ? ` Colores que la tabla no tiene, con el que se les parece: ${parecidos.join(", ")}.` : "";
  const fuera = sinColor.length ? ` Sin color en la tabla Sempertex: ${sinColor.join(", ")}.` : "";
  notas.push(`Pieza ${c.indice + 1} (otro): «${c.descripcion}» se armó como el ${hecho.nombre} (colores: ${usados}), de ${alto} cm de alto y de pie en el piso: solo se arman los globos del número; su caja, o lo que lleve encima (flores, cintas), no.${cambiados}${fuera} Ajústala.`);
  notas.push(...notasDeLaHerramienta.map((n) => `Pieza ${c.indice + 1} (otro): ${n}`));
  return puesta.escena;
}

/** Los sitios de la estructura de cada figura que va sobre ella: uno por copia, de una en una entre las figuras (rizo, flor, rizo…) y entre todas las descripciones. */
function repartirSitios(pendientes: readonly FiguraPorColocar[]): { sitios: Map<FiguraOtro, number[]>; total: number } {
  const copias = pendientes.flatMap((p) => p.figuras.flatMap((figura, orden) => (figura.clase === "decoracion" && figura.sobreEstructura ? Array.from({ length: figura.cantidad }, (_, copia) => ({ figura, copia, orden })) : [])));
  copias.sort((a, b) => a.copia - b.copia || a.orden - b.orden);
  const sitios = new Map<FiguraOtro, number[]>();
  copias.forEach(({ figura }, k) => sitios.set(figura, [...(sitios.get(figura) ?? []), k]));
  return { sitios, total: Math.max(1, copias.length) };
}

/** Arma las figuras que la lectura escribió como «otro» y las pone en la escena. Una que falla al armarse queda en `omitidas`, como las piezas del catálogo. */
export function colocarFiguras(escena: Escena, pendientes: readonly FiguraPorColocar[], otrosPuestos: Set<string>, notas: string[], omitidas: string[]): Escena {
  const { sitios, total } = repartirSitios(pendientes);
  const comun: Compartido = { sitios, totalSitios: total, enPared: 0, otrosPuestos, notas };
  let actual = escena;
  for (const { indice, descripcion, figuras, lugar } of pendientes) {
    for (const figura of figuras) {
      try {
        actual = figura.clase === "texto" ? ponerTexto(actual, figura, { indice, descripcion, lugar }, comun) : ponerDecoracion(actual, figura, { indice, descripcion, lugar }, comun);
      } catch (error) {
        omitidas.push(`Pieza ${indice + 1} (otro): ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  return actual;
}
