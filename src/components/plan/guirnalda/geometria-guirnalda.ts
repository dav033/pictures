import type { ArmadoGuirnaldaResuelto, FormaGuirnalda, SoporteGuirnalda } from "@/lib/plan/armado-guirnalda";
import {
  ANILLO,
  curvaGuirnalda,
  dibujarPatron,
  escalaEnCurva,
  R,
  repartirEnCurva,
  type CurvaGuirnalda,
  type Punto,
} from "../patron/geometria-dibujo";
import { formaConArqueo, formaConCaida } from "./leyenda-guirnalda";

/**
 * Dónde DIBUJAR cada globo del armado de una guirnalda que devolvió Python
 * (ADR-0032). Solo geometría de pantalla: qué código va en cada racimo, el
 * relleno, los remates (y junto a qué racimo) y los sueltos llegan resueltos;
 * aquí no se decide ni se cuenta ninguno.
 *
 * Los racimos son las filas de la rejilla del patrón y se dibujan con la
 * misma geometría (`dibujarPatron`, pseudo-3D), repartidos a igual distancia
 * sobre la curva real de la pieza (`curvaGuirnalda`): recta, curva, ondulada,
 * U invertida o arco caído, con la caída (hacia abajo), el arqueo (hacia
 * arriba) y el desnivel entre los extremos a escala del largo (ADR-0032,
 * decisiones 27 y 28). El tamaño de
 * cada globo sigue su tamaño comprado respecto del racimo (un 5″ se ve chico,
 * un 24″ grande). Puro: sin React.
 */

export type PapelGlobo = "racimo" | "relleno" | "remate" | "suelto";

export type GloboGuirnalda = {
  clave: string;
  x: number;
  y: number;
  r: number;
  /** Profundidad para pintar: lo de atrás primero, los remates encima de todo. */
  z: number;
  codigo: number;
  papel: PapelGlobo;
  /** Racimo al que pertenece (o junto al que va); `null` para relleno y sueltos. */
  racimo: number | null;
};

export type RacimoDibujo = {
  numero: number;
  centro: Punto;
  /** Dónde va su número (del lado contrario a los remates). */
  etiqueta: Punto;
  /** Radio de la zona que lo elige en el editor. */
  alcance: number;
};

export type DibujoGuirnalda = {
  caja: { x: number; y: number; ancho: number; alto: number };
  globos: GloboGuirnalda[];
  racimos: RacimoDibujo[];
  /** La tira sobre la que se arma: el camino de la curva (atributo `d` de un `<path>`). */
  tira: string;
  soporte: SoporteGuirnalda;
  /** Puntos de anclaje declarados, sobre la curva. */
  anclajes: Punto[];
  /** Piso o mesa bajo la guirnalda; pared detrás; la pieza anfitriona a lo largo. */
  apoyo: { x1: number; x2: number; y: number } | null;
  /** La forma cuelga pero no tiene caída declarada: se dibuja una de muestra, no a escala. */
  caidaDeMuestra: boolean;
};

type EntradaGuirnalda = Pick<ArmadoGuirnaldaResuelto, "armado" | "largo_m" | "racimos" | "relleno" | "remates" | "sueltos" | "leyenda">;

function redondear(valor: number): number {
  return Math.round(valor * 100) / 100;
}

/**
 * La curva del armado para `geometria-dibujo`: la caída solo en las formas que
 * cuelgan, el arqueo solo en las que se arquean hacia arriba (decisión 28); el
 * desnivel, en cualquiera.
 */
export function curvaDeArmado(resuelto: Pick<ArmadoGuirnaldaResuelto, "armado" | "largo_m">): CurvaGuirnalda {
  const { armado } = resuelto;
  return {
    forma: armado.forma,
    largo_m: resuelto.largo_m,
    ...(armado.caida_m !== undefined && formaConCaida(armado.forma) ? { caida_m: armado.caida_m } : {}),
    ...(armado.arqueo_m !== undefined && formaConArqueo(armado.forma) ? { arqueo_m: armado.arqueo_m } : {}),
    ...(armado.desnivel_m ? { desnivel_m: armado.desnivel_m } : {}),
    ...(armado.puntos_de_anclaje !== undefined ? { puntos_de_anclaje: armado.puntos_de_anclaje } : {}),
  };
}

/**
 * Los racimos del armado como filas de la rejilla del patrón: el material
 * (índice de `materiales`, el número de la leyenda del patrón menos uno) de
 * cada código de cada racimo, del 1 al último. Con patrón y armado es lo que
 * se dibuja: el racimo `i` es la fila `i` del patrón expandido sobre los
 * racimos que de verdad se arman (`filas_de_racimos`, E5), no la rejilla
 * completa, que cuenta también el relleno y los remates. Un código que la
 * leyenda no conoce (no debería pasar) queda en gris (`-1`), nunca en otro color.
 */
export function celdasDeArmado(resuelto: Pick<ArmadoGuirnaldaResuelto, "racimos" | "leyenda">): number[][] {
  const materialDe = new Map(resuelto.leyenda.map((entrada) => [entrada.codigo, entrada.material]));
  return [...resuelto.racimos].sort((a, b) => a.numero - b.numero).map((racimo) => racimo.codigos.map((codigo) => materialDe.get(codigo) ?? -1));
}

/** El patrón aplicado de una guirnalda con armado, dibujado sobre los racimos del armado (sin centros de flor de la rejilla completa). */
export function patronSobreArmado<P extends { celdas: readonly (readonly number[])[]; extras: readonly unknown[] }>(patron: P, resuelto: Pick<ArmadoGuirnaldaResuelto, "racimos" | "leyenda">): P {
  return { ...patron, celdas: celdasDeArmado(resuelto), extras: [] };
}

/** Radio de un globo según su tamaño comprado, relativo al del racimo. */
function factorTamano(tamanos: ReadonlyMap<number, number>, codigo: number, base: number): number {
  const tamano = tamanos.get(codigo);
  if (!tamano || !base) return 1;
  return Math.min(2.2, Math.max(0.4, (tamano / base) ** 0.85));
}

/** Los códigos de una lista `{codigo, cantidad}`, intercalados para que los colores se mezclen al dibujarlos. */
function intercalar(codigos: ReadonlyArray<{ codigo: number; cantidad: number }>): number[] {
  const quedan = codigos.map((item) => ({ ...item }));
  const salida: number[] = [];
  while (quedan.some((item) => item.cantidad > 0)) {
    for (const item of quedan) {
      if (item.cantidad <= 0) continue;
      salida.push(item.codigo);
      item.cantidad -= 1;
    }
  }
  return salida;
}

type Eje = { centro: Punto; normal: Punto; tangente: Punto };

/** Entre el racimo `hueco` y el siguiente (o alrededor del único): el punto medio y su orientación. */
function enHueco(ejes: readonly Eje[], hueco: number): Eje {
  const a = ejes[Math.min(hueco, ejes.length - 1)]!;
  const b = ejes[Math.min(hueco + 1, ejes.length - 1)]!;
  if (a === b) return { ...a, centro: { x: a.centro.x + a.tangente.x * ANILLO, y: a.centro.y + a.tangente.y * ANILLO } };
  const normal = { x: (a.normal.x + b.normal.x) / 2, y: (a.normal.y + b.normal.y) / 2 };
  const largo = Math.hypot(normal.x, normal.y) || 1;
  return { centro: { x: (a.centro.x + b.centro.x) / 2, y: (a.centro.y + b.centro.y) / 2 }, normal: { x: normal.x / largo, y: normal.y / largo }, tangente: a.tangente };
}

/**
 * Globos repartidos en los huecos entre racimos (relleno o sueltos): el
 * `j`-ésimo va al hueco `j · huecos / total`, alternando de lado. Dónde va
 * cada uno en la guirnalda real lo decide quien arma; esto es solo el dibujo.
 */
function enHuecos(codigos: readonly number[], ejes: readonly Eje[], opciones: { papel: PapelGlobo; desplazamiento: number; z: number; radio: (codigo: number) => number; desfase: number }): GloboGuirnalda[] {
  const huecos = Math.max(1, ejes.length - 1);
  const porHueco = new Map<number, number>();
  return codigos.map((codigo, indice) => {
    const hueco = Math.min(huecos - 1, Math.floor(((indice + opciones.desfase) * huecos) / codigos.length));
    const puesto = porHueco.get(hueco) ?? 0;
    porHueco.set(hueco, puesto + 1);
    const eje = enHueco(ejes, hueco);
    const r = opciones.radio(codigo);
    const lado = puesto % 2 === 0 ? 1 : -1;
    const corrimiento = Math.floor(puesto / 2) * r * 1.5;
    return {
      clave: `${opciones.papel}:${indice}`,
      x: eje.centro.x + eje.normal.x * lado * opciones.desplazamiento + eje.tangente.x * corrimiento * lado,
      y: eje.centro.y + eje.normal.y * lado * opciones.desplazamiento + eje.tangente.y * corrimiento * lado,
      r,
      z: opciones.z,
      codigo,
      papel: opciones.papel,
      racimo: null,
    };
  });
}

/**
 * Hacia dónde van los números de cada racimo: por fuera de la curva. En una
 * guirnalda que se arquea hacia arriba (U invertida, curva) es el lado de su
 * normal; en las demás, hacia abajo en la pantalla (bajo una recta, una onda
 * o los tramos de un arco caído), así quedan en fila y no se amontonan.
 */
function haciaLosNumeros(forma: FormaGuirnalda, eje: Eje): Punto {
  return forma === "u_invertida" || forma === "curva" ? eje.normal : { x: 0, y: 1 };
}

/** Los remates, junto al racimo que dijo Python: en los extremos, hacia afuera; si no, del lado contrario a los números. */
function rematesJuntoASuRacimo(remates: EntradaGuirnalda["remates"], racimos: EntradaGuirnalda["racimos"], ejes: readonly Eje[], radio: (codigo: number) => number, forma: FormaGuirnalda): GloboGuirnalda[] {
  const porRacimo = new Map<number, number>();
  const globos: GloboGuirnalda[] = [];
  remates.forEach((remate, indiceRemate) => {
    remate.racimos.forEach((numero, indice) => {
      const eje = ejes[racimos.findIndex((racimo) => racimo.numero === numero)];
      if (!eje) return;
      const r = radio(remate.codigo);
      const puesto = porRacimo.get(numero) ?? 0;
      porRacimo.set(numero, puesto + 1);
      const haciaAfuera = remate.posicion === "extremo_izq" ? -1 : remate.posicion === "extremo_der" ? 1 : 0;
      const numeros = haciaLosNumeros(forma, eje);
      const direccion = haciaAfuera ? { x: eje.tangente.x * haciaAfuera, y: eje.tangente.y * haciaAfuera } : { x: -numeros.x, y: -numeros.y };
      const distancia = ANILLO + r * 0.7 + puesto * r * 1.1;
      globos.push({ clave: `remate:${indiceRemate}:${indice}`, x: eje.centro.x + direccion.x * distancia, y: eje.centro.y + direccion.y * distancia, r, z: 3, codigo: remate.codigo, papel: "remate", racimo: numero });
    });
  });
  return globos;
}

/** La caja del dibujo (globos, números, anclajes y soporte) y, sobre piso o mesa, la línea de apoyo. */
function limites(globos: readonly GloboGuirnalda[], racimos: readonly RacimoDibujo[], anclajes: readonly Punto[], soporte: SoporteGuirnalda): Pick<DibujoGuirnalda, "caja" | "apoyo"> {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const incluir = (x: number, y: number, rx: number, ry = rx) => {
    minX = Math.min(minX, x - rx);
    maxX = Math.max(maxX, x + rx);
    minY = Math.min(minY, y - ry);
    maxY = Math.max(maxY, y + ry);
  };
  for (const globo of globos) incluir(globo.x, globo.y, globo.r, globo.r * 1.08);
  for (const racimo of racimos) incluir(racimo.etiqueta.x, racimo.etiqueta.y, R * 0.75);
  for (const anclaje of anclajes) incluir(anclaje.x, anclaje.y, R * 0.6);
  if (!Number.isFinite(minX)) incluir(0, 0, R * 2);
  // Colgada: la cuerda sube de cada anclaje hasta arriba del dibujo.
  if (soporte === "colgada" && anclajes.length) minY -= R * 2.2;
  const apoyo = soporte === "piso" || soporte === "mesa" ? { x1: minX - R, x2: maxX + R, y: maxY + R * (soporte === "mesa" ? 0.8 : 0.4) } : null;
  if (apoyo) maxY = apoyo.y + R * (soporte === "mesa" ? 1.2 : 0.5);
  const margen = R * 0.6;
  return {
    caja: { x: redondear(minX - margen - (apoyo ? R : 0)), y: redondear(minY - margen), ancho: redondear(maxX - minX + margen * 2 + (apoyo ? R * 2 : 0)), alto: redondear(maxY - minY + margen * 2) },
    apoyo: apoyo ? { x1: redondear(apoyo.x1), x2: redondear(apoyo.x2), y: redondear(apoyo.y) } : null,
  };
}

/** Cómo va la guirnalda dibujada: racimos sobre la curva real, relleno, sueltos, remates, números y soporte. */
export function dibujarGuirnalda(resuelto: EntradaGuirnalda): DibujoGuirnalda {
  const curva = curvaDeArmado(resuelto);
  const racimos = [...resuelto.racimos].sort((a, b) => a.numero - b.numero);
  const cantidad = racimos.length;
  const base = resuelto.armado.racimo.tamano_pulg_base;
  const tamanos = new Map(resuelto.leyenda.map((entrada) => [entrada.codigo, entrada.tamano_pulg]));
  const radio = (codigo: number) => R * factorTamano(tamanos, codigo, base);

  // Los racimos: la rejilla del patrón (una fila por racimo) sobre la curva del armado.
  const patron = dibujarPatron({ geometria: "racimos", tipo: "guirnalda", celdas: racimos.map((racimo) => racimo.codigos), extras: [], guirnalda: curva });
  const globos: GloboGuirnalda[] = patron.globos.map((globo) => ({
    clave: `racimo:${globo.clave}`,
    x: globo.x,
    y: globo.y,
    r: globo.r * factorTamano(tamanos, globo.material, base),
    z: globo.z,
    codigo: globo.material,
    papel: "racimo",
    racimo: racimos[globo.fila]?.numero ?? null,
  }));

  const funcion = curvaGuirnalda(curva);
  const ejes: Eje[] = repartirEnCurva(funcion, Math.max(1, cantidad), false).map(({ punto, normal }) => ({
    centro: punto,
    normal,
    tangente: { x: -normal.y, y: normal.x },
  }));

  if (resuelto.relleno) {
    globos.push(...enHuecos(intercalar(resuelto.relleno.codigos), ejes, { papel: "relleno", desplazamiento: ANILLO * 0.72, z: 0, radio, desfase: 0 }));
  }
  if (resuelto.sueltos.length) {
    globos.push(...enHuecos(intercalar(resuelto.sueltos), ejes, { papel: "suelto", desplazamiento: 0, z: 0.9, radio, desfase: 0.5 }));
  }

  globos.push(...rematesJuntoASuRacimo(resuelto.remates, racimos, ejes, radio, curva.forma));

  const racimosDibujo: RacimoDibujo[] = racimos.map((racimo, indice) => {
    const eje = ejes[indice]!;
    const lejos = ANILLO + R * 1.45;
    return {
      numero: racimo.numero,
      centro: eje.centro,
      etiqueta: { x: eje.centro.x + haciaLosNumeros(curva.forma, eje).x * lejos, y: eje.centro.y + haciaLosNumeros(curva.forma, eje).y * lejos },
      alcance: ANILLO + R * 0.4,
    };
  });

  // Anclajes declarados, repartidos de extremo a extremo (en un arco caído, donde se juntan sus tramos).
  const escala = escalaEnCurva(funcion, Math.max(1, cantidad), false);
  const puntos = resuelto.armado.puntos_de_anclaje ?? (resuelto.armado.soporte === "colgada" ? 2 : 0);
  const anclajes = Array.from({ length: puntos }, (_, indice) => {
    const punto = funcion(puntos === 1 ? 0.5 : indice / (puntos - 1));
    return { x: punto.x * escala, y: punto.y * escala };
  });
  const muestras = 64;
  const tira = Array.from({ length: muestras + 1 }, (_, indice) => {
    const punto = funcion(indice / muestras);
    return `${indice === 0 ? "M" : "L"} ${redondear(punto.x * escala)} ${redondear(punto.y * escala)}`;
  }).join(" ");

  const soporte = resuelto.armado.soporte;
  const { caja, apoyo } = limites(globos, racimosDibujo, anclajes, soporte);
  const conCaida = formaConCaida(resuelto.armado.forma);
  return {
    caja,
    globos: globos
      .map((globo) => ({ ...globo, x: redondear(globo.x), y: redondear(globo.y), r: redondear(globo.r) }))
      .sort((a, b) => a.z - b.z || a.x - b.x),
    racimos: racimosDibujo.map((racimo) => ({
      ...racimo,
      centro: { x: redondear(racimo.centro.x), y: redondear(racimo.centro.y) },
      etiqueta: { x: redondear(racimo.etiqueta.x), y: redondear(racimo.etiqueta.y) },
      alcance: redondear(racimo.alcance),
    })),
    tira,
    soporte,
    anclajes: anclajes.map((punto) => ({ x: redondear(punto.x), y: redondear(punto.y) })),
    apoyo,
    caidaDeMuestra: conCaida && curva.caida_m === undefined,
  };
}
