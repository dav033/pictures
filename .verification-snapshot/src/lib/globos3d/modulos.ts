import type { FormatoGlobo } from "./formatos";
import { centroCuerpo, nudoCm } from "./geometria";

/**
 * Los módulos básicos de Sempertex («Conceptos y técnicas · Cómo unir globos»), armados en 3D:
 * - pareja: dos globos inflados y medidos, anudados entre sí;
 * - trío: un globo anudado a una pareja;
 * - cuarteto: dos parejas entrelazadas;
 * - quinteto: una pareja y un trío entrelazados;
 * - sexteto: dos tríos entrelazados.
 *
 * Todos los nudos (los «pitones») quedan amarrados juntos en el centro, como en un módulo real (un solo nudo por punto de amarre), y los
 * cuerpos apenas se tocan (se admite aplastar un 12 % del diámetro, dueño 2026-10-07):
 * - la pareja (`armarParejaAtada`) es una V en el plano horizontal con los dos cuellos en un solo nudo;
 * - de tres a seis globos (`armarAnillo`) se reparten en anillo alrededor de los nudos; si los vecinos quedarían con aire, TODOS se
 *   inclinan hacia arriba por igual, en un cono (el trío, un globo atado a una pareja, se sienta así), y si se montaran más de lo
 *   admitido el nudo NO se mueve: se estira el cuello. Cuarteto, quinteto y sexteto alternan una leve inclinación arriba/abajo: son
 *   dos parejas (o una pareja y un trío, o dos tríos) cruzadas, una apenas por encima de la otra.
 * Unidades: centímetros; y hacia arriba; el centro del módulo (los nudos) en el origen.
 */
export type TipoModulo = "pareja" | "trio" | "cuarteto" | "quinteto" | "sexteto";

/** `inclinacion` (radianes): cuánto sube o baja cada globo, alternando; en cuarteto y sexteto son las dos parejas o los dos tríos cruzados. */
export type Modulo = { id: TipoModulo; nombre: string; globos: number; armado: string; inclinacion: number };

export const MODULOS: readonly Modulo[] = [
  { id: "pareja", nombre: "Pareja (dúo)", globos: 2, armado: "Infla y mide dos globos y anúdalos entre sí.", inclinacion: 0 },
  { id: "trio", nombre: "Trío", globos: 3, armado: "Infla y mide un globo y anúdalo a una pareja.", inclinacion: 0 },
  { id: "cuarteto", nombre: "Cuarteto", globos: 4, armado: "Toma dos parejas y entrelázalas en cruz.", inclinacion: 0.12 },
  { id: "quinteto", nombre: "Quinteto", globos: 5, armado: "Toma una pareja y un trío y entrelázalos.", inclinacion: 0.15 },
  { id: "sexteto", nombre: "Sexteto", globos: 6, armado: "Toma dos tríos y entrelázalos.", inclinacion: 0.45 },
];

export type Vec3 = { x: number; y: number; z: number };

/** Un globo colocado: dónde queda su nudo, hacia dónde apunta (nudo → cuerpo) y cuánto se estira su cuello, en cm. */
/** `parte`: ver `GloboDecoracion.parte` (decoraciones.ts). */
export type GloboColocado = { indice: number; nudo: Vec3; direccion: Vec3; cuelloExtraCm: number; parte?: string };

/** Un punto donde se puede colgar una decoración hija (una flor, un moño): por ahora el centro y los huecos. */
export type Ancla = { tipo: "centro" | "hueco"; posicion: Vec3; normal: Vec3 };

export type ModuloArmado = { globos: GloboColocado[]; anclas: Ancla[]; anchoCm: number; altoCm: number };

const normalizar = (v: Vec3): Vec3 => {
  const n = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / n, y: v.y / n, z: v.z / n };
};

export function moduloPorId(id: string): Modulo | undefined {
  return MODULOS.find((m) => m.id === id);
}

export type OpcionesArmado = {
  /**
   * Con `false` no se cierra el aire entre los cuerpos con el cono hacia arriba (ver `armarAnillo`): quien arma sus propios cuerpos
   * a su radio (la trenza y el mural de trenzas) solo toma las direcciones del cuarteto y no debe cambiar.
   */
  cerrarHuecos?: boolean;
};

/**
 * Coloca los globos del módulo. `diametroCm` es el inflado; el tipo de globo (redondo o Link-O-Loon) decide
 * cuánto cuello hay entre el nudo y el cuerpo.
 */
export function armarModulo(modulo: Modulo, formato: FormatoGlobo, diametroCm: number, opciones: OpcionesArmado = {}): ModuloArmado {
  const n = modulo.globos;
  const natural = centroCuerpo(formato.tipo === "link" ? "link" : "redondo", diametroCm);
  const amarre = nudoCm(diametroCm);
  if (n === 2) return armarParejaAtada(natural, amarre, diametroCm);
  return armarAnillo(modulo, natural, amarre, diametroCm, opciones.cerrarHuecos !== false);
}

/**
 * Cuántos diámetros, de centro a centro, es «aire» entre cuerpos vecinos: hasta 1,08 (un 8 % de aire, dentro del 12 % que admite el
 * dueño) se dejan como están; más allá se cierra con el cono. El umbral está lejos de donde caen los módulos planos (el cuarteto a
 * ~1,0): cerca de él, un cambio mínimo del inflado movería el cono a saltos (la respuesta del cono al aire es de raíz cuadrada).
 */
const AIRE_MAXIMO = 1.08;
/** A cuántos diámetros quedan los vecinos cuando el cono los cierra: apenas aplastados (un 10 %), no al máximo que admite el látex. */
const CONTACTO_ANILLO = 0.9;
/** Los pitones de un módulo de tres o más globos quedan en un anillo de este radio (en nudos): tan juntos que se leen como un solo nudo. */
const RADIO_NUDOS = 0.35;

/**
 * A cuántos diámetros se cierran los vecinos según el aire que tenían (`aire0`, en diámetros de centro a centro, mayor que
 * `AIRE_MAXIMO`): con poco aire solo se quita el exceso (así no hay salto en el umbral) y con el del trío (~1,2) se llega a
 * `CONTACTO_ANILLO`; entre los dos, una rampa recta.
 */
/** El aire (diámetros de centro a centro) de tres globos planos a su cuello natural (~1,2): con él se llega al contacto pleno. */
const AIRE_TRIO = 1.2;
export const objetivoDeContacto = (aire0: number): number => Math.max(CONTACTO_ANILLO, AIRE_MAXIMO - (aire0 - AIRE_MAXIMO) * ((AIRE_MAXIMO - CONTACTO_ANILLO) / (AIRE_TRIO - AIRE_MAXIMO)));

/**
 * Cuánto del cono se aplica según el aire: el cono responde al aire como una raíz cuadrada (con 1 % menos de aire pide ~0,2 rad), así que
 * entra poco a poco, de 0 en `AIRE_MAXIMO` a todo 0,1 diámetros más allá (suavizado): al mover el inflado, que cambia un poco el aire
 * (el globo chico es más alargado), el módulo cambia de forma sin saltos. Entre medias queda a lo sumo un 12 % de aire.
 */
const ANCHO_ENTRADA_CONO = 0.1;
export function entradaDelCono(aire0: number): number {
  const t = Math.min(1, Math.max(0, (aire0 - AIRE_MAXIMO) / ANCHO_ENTRADA_CONO));
  return t * t * (3 - 2 * t);
}

const distancia3 = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/**
 * Trío a sexteto: los globos repartidos en anillo alrededor de los nudos amarrados al centro, cada uno a su cuello natural.
 * - El trío (un globo atado a una pareja) y todo módulo cuyos vecinos queden con aire entre sí (> 1,08 diámetros de centro a
 *   centro: el cuarteto de Link-O-Loon) se cierran inclinando TODOS los globos hacia arriba, igual,
 *   en un cono, hasta `objetivoDeContacto`: 1,08 cuando el aire era poco y apenas aplastados (0,9) cuando era mucho, con una
 *   rampa entre los dos, para que al mover el inflado el módulo cambie de forma poco a poco y no a saltos.
 * - Si aun así (o por el cuello) se montaran más del 12 %, el cuello se estira (el nudo no se mueve), como siempre.
 * - Las dos parejas del cuarteto (o los dos tríos del sexteto) siguen cruzadas, una apenas por encima de la otra (`inclinacion`).
 */
function armarAnillo(modulo: Modulo, natural: number, amarre: number, diametroCm: number, cerrarHuecos: boolean): ModuloArmado {
  const n = modulo.globos;
  const azimut = (i: number) => (2 * Math.PI * i) / n + Math.PI / n;
  const radioNudos = amarre * RADIO_NUDOS;
  const nudos: Vec3[] = Array.from({ length: n }, (_, i) => ({ x: Math.cos(azimut(i)) * radioNudos, y: 0, z: Math.sin(azimut(i)) * radioNudos }));
  const direccionesCon = (cono: number): Vec3[] => Array.from({ length: n }, (_, i) => {
    const signo = i % 2 === 0 ? 1 : -1;
    // Sin cono, la misma cuenta de siempre (bit a bit): la trenza y el mural de trenzas eligen entre huecos casi iguales por estas
    // direcciones, y un error de 1e-16 cambiaba cuál escoge una flor de la biblioteca.
    if (cono === 0) return normalizar({ x: Math.cos(azimut(i)) * Math.cos(modulo.inclinacion), y: Math.sin(modulo.inclinacion) * signo, z: Math.sin(azimut(i)) * Math.cos(modulo.inclinacion) });
    const elevacion = signo * modulo.inclinacion + cono;
    return { x: Math.cos(elevacion) * Math.cos(azimut(i)), y: Math.sin(elevacion), z: Math.cos(elevacion) * Math.sin(azimut(i)) };
  });
  const centros = (dirs: Vec3[], largo: number): Vec3[] => dirs.map((d, i) => ({ x: nudos[i]!.x + d.x * largo, y: nudos[i]!.y + d.y * largo, z: nudos[i]!.z + d.z * largo }));
  const vecinos = (c: Vec3[]): number[] => c.map((p, i) => distancia3(p, c[(i + 1) % n]!));

  let cono = 0;
  const aire0 = Math.max(...vecinos(centros(direccionesCon(0), natural))) / diametroCm;
  if (cerrarHuecos && aire0 > AIRE_MAXIMO) {
    // El cono no pasa de la vertical (el globo más alto lleva además su inclinación): más allá los vecinos volverían a separarse.
    const tope = Math.PI / 2 - Math.abs(modulo.inclinacion) - 0.05;
    const objetivo = diametroCm * objetivoDeContacto(aire0);
    let bajo = 0, alto = tope;
    for (let i = 0; i < 40; i++) {
      const medio = (bajo + alto) / 2;
      if (Math.max(...vecinos(centros(direccionesCon(medio), natural))) > objetivo) bajo = medio; else alto = medio;
    }
    // Si ni en el tope se cierra el aire (un inflado fuera de rango), el anillo queda plano: mejor aire que un cono absurdo.
    if (Math.max(...vecinos(centros(direccionesCon(alto), natural))) <= diametroCm * AIRE_MAXIMO + 1e-9) cono = alto * entradaDelCono(aire0);
  }
  const direcciones = direccionesCon(cono);
  // Si los vecinos se montaran más de lo que admite el látex, el cuello se estira (el nudo NO se mueve) hasta que apenas se toquen.
  let largo = natural;
  for (let i = 0; i < 8; i++) {
    const minima = Math.min(...vecinos(centros(direcciones, largo)));
    if (minima >= diametroCm * CONTACTO_CUERPOS - 1e-9) break;
    largo *= (diametroCm * CONTACTO_CUERPOS) / minima;
  }
  const globos: GloboColocado[] = direcciones.map((direccion, i) => ({ indice: i, nudo: nudos[i]!, direccion, cuelloExtraCm: Math.max(0, largo - natural), parte: "modulo" }));
  const cuerpos = centros(direcciones, largo);
  const alturas = cuerpos.map((c) => c.y);
  const centroY = alturas.reduce((a, b) => a + b, 0) / n;
  const anclas: Ancla[] = [{ tipo: "centro", posicion: { x: 0, y: centroY + diametroCm * 0.35, z: 0 }, normal: { x: 0, y: 1, z: 0 } }];
  if (n >= 3) {
    for (let i = 0; i < n; i++) {
      const a = cuerpos[i]!, b = cuerpos[(i + 1) % n]!;
      const medio = (2 * Math.PI * (i + 0.5)) / n + Math.PI / n;
      const radioMedio = Math.hypot((a.x + b.x) / 2, (a.z + b.z) / 2) + diametroCm * 0.15;
      anclas.push({ tipo: "hueco", posicion: { x: Math.cos(medio) * radioMedio, y: (a.y + b.y) / 2, z: Math.sin(medio) * radioMedio }, normal: normalizar({ x: Math.cos(medio), y: 0, z: Math.sin(medio) }) });
    }
  }
  const alcance = Math.max(...cuerpos.map((c) => Math.hypot(c.x, c.z))) + diametroCm / 2;
  return { globos, anclas, anchoCm: Math.round(alcance * 2), altoCm: Math.round(Math.max(...alturas) - Math.min(...alturas) + diametroCm) };
}

/** Cuánto se acercan los cuerpos que se tocan: el látex se aplasta hasta un 12 % del diámetro (dueño, 2026-10-07). */
const CONTACTO_CUERPOS = 0.88;

/**
 * La pareja de verdad: los dos cuellos atados en UN solo nudo y los cuerpos apenas tocándose. Un par a 180° dejaba entre los
 * cuerpos casi medio globo de aire (a 1,45 diámetros de centro a centro) y dos nudos separados. Aquí el cuello no se acorta (no
 * puede ser menor que el natural): se cierra el ángulo entre los dos globos, en el plano horizontal, con el vértice (el nudo)
 * hacia el frente (+z) y los cuerpos hacia el fondo, hasta que los centros quedan a `CONTACTO_CUERPOS` diámetros. Los dos pitones
 * quedan pegados (a medio nudo del centro, uno a cada lado) y se leen como un solo nudo.
 */
function armarParejaAtada(natural: number, amarre: number, diametroCm: number): ModuloArmado {
  const medioNudo = amarre / 2;
  const seno = Math.min(1, Math.max(0, (CONTACTO_CUERPOS * diametroCm / 2 - medioNudo) / natural));
  const mitadAngulo = Math.asin(seno);
  const globos: GloboColocado[] = [1, -1].map((lado, indice) => ({
    indice,
    nudo: { x: lado * medioNudo, y: 0, z: 0 },
    direccion: { x: lado * Math.sin(mitadAngulo), y: 0, z: -Math.cos(mitadAngulo) },
    cuelloExtraCm: 0,
    parte: "modulo",
  }));
  const alcance = Math.max(...globos.map((g) => Math.hypot(g.nudo.x + g.direccion.x * natural, g.nudo.z + g.direccion.z * natural))) + diametroCm / 2;
  return {
    globos,
    // Los nudos quedan en el origen (como en todo módulo) y el ancla del centro, entre los dos cuerpos.
    anclas: [{ tipo: "centro", posicion: { x: 0, y: diametroCm * 0.35, z: (globos[0]!.direccion.z + globos[1]!.direccion.z) * natural / 2 }, normal: { x: 0, y: 1, z: 0 } }],
    anchoCm: Math.round(alcance * 2),
    altoCm: Math.round(diametroCm),
  };
}

/** Lista de materiales del módulo: cuántos globos de cada color (por código Sempertex), en orden de aparición. */
export function materialesModulo(colores: readonly string[]): Array<{ codigo: string; cantidad: number }> {
  const cuenta = new Map<string, number>();
  for (const codigo of colores) cuenta.set(codigo, (cuenta.get(codigo) ?? 0) + 1);
  return [...cuenta.entries()].map(([codigo, cantidad]) => ({ codigo, cantidad }));
}
