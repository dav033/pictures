import type { ArmadoBouquetResuelto } from "@/lib/plan/armado-bouquet";
import type { Posicion } from "./borrador-armado";

/**
 * Geometría de la gráfica numerada por niveles de un bouquet (ADR-0030,
 * formato aprobado): el nivel 1 abajo, cada nivel con sus unidades una al
 * lado de la otra (un cuarteto son cuatro círculos apretados), el remate
 * arriba y los números donde dice `disposicion`. Con helio, cintas hasta una
 * pesa; con base de aire, la base y varillas. Solo coordenadas de dibujo: los
 * niveles, los códigos y los grupos son los que devolvió Python.
 */

export type EntradaDibujoBouquet = Pick<ArmadoBouquetResuelto, "armado" | "niveles" | "remate" | "numero" | "grupos" | "leyenda">;

export type GloboBouquet = {
  clave: string;
  x: number;
  y: number;
  /** Radio de un globo; en un número, la mitad del alto del rectángulo. */
  r: number;
  codigo: number;
  posicion: Posicion;
  forma: "globo" | "numero";
  digito: string | null;
  grupo: number;
  /** Puesto en el orden de foco de la gráfica; `null` si no se puede elegir (los grupos repetidos). */
  orden: number | null;
};

export type Segmento = { x1: number; y1: number; x2: number; y2: number };

export type DibujoBouquet = {
  caja: { x: number; y: number; ancho: number; alto: number };
  globos: GloboBouquet[];
  /** Cintas (helio) o varillas (base de aire), detrás de los globos. */
  lineas: Segmento[];
  pesas: Array<{ x: number; y: number }>;
  bases: Array<{ x: number; y: number; ancho: number }>;
  /** Con helio: cintas; con base: varillas. */
  soporte: "helio" | "base";
};

/** Radio de un globo de látex en la gráfica. */
export const RADIO = 10;
const HUECO = RADIO * 0.5;
const MARGEN = RADIO * 1.6;
const RADIO_REMATE = RADIO * 1.3;
const RADIO_NUMERO = RADIO * 1.5;
const ANCHO_NUMERO = RADIO * 2.4;

/** Dónde va cada globo de una unidad respecto de su centro, en radios (racimo apretado). */
const RACIMOS: Readonly<Record<number, ReadonlyArray<readonly [number, number]>>> = {
  1: [[0, 0]],
  2: [[-1, 0], [1, 0]],
  3: [[-1, 0.58], [1, 0.58], [0, -1.15]],
  4: [[-0.95, -0.95], [0.95, -0.95], [-0.95, 0.95], [0.95, 0.95]],
};

function racimo(globos: number): ReadonlyArray<readonly [number, number]> {
  const fijo = RACIMOS[globos];
  if (fijo) return fijo;
  const radio = globos <= 5 ? 1.7 : 1.95 + Math.max(0, globos - 6) * 0.3;
  return Array.from({ length: globos }, (_, indice) => {
    const angulo = -Math.PI / 2 + (indice / globos) * Math.PI * 2;
    return [Math.cos(angulo) * radio, Math.sin(angulo) * radio] as const;
  });
}

function extension(puntos: ReadonlyArray<readonly [number, number]>): { medioAncho: number; medioAlto: number } {
  return {
    medioAncho: (Math.max(...puntos.map(([x]) => Math.abs(x))) + 1) * RADIO,
    medioAlto: (Math.max(...puntos.map(([, y]) => Math.abs(y))) + 1) * RADIO,
  };
}

type Grupo = { globos: GloboBouquet[]; lineas: Segmento[]; pesa: { x: number; y: number } | null; base: { x: number; y: number; ancho: number } | null };

function digitoDe(entrada: EntradaDibujoBouquet, codigo: number): string | null {
  return entrada.leyenda.find((material) => material.codigo === codigo)?.digito ?? null;
}

/** Un grupo (un bouquet) en coordenadas propias: el centro de la base en (0, 0), hacia arriba en negativo. */
function dibujarGrupo(entrada: EntradaDibujoBouquet, grupo: number, siguienteOrden: () => number): Grupo {
  const variante = entrada.armado.variante;
  const helio = variante !== "base_aire";
  const escalonado = variante === "helio_escalonado";
  const elegible = grupo === 0;
  const globos: GloboBouquet[] = [];
  const lineas: Segmento[] = [];
  let techo = 0;
  let anchoMaximo = 0;

  entrada.niveles.forEach((nivel, indice) => {
    const puntos = racimo(nivel.codigos.length);
    const { medioAncho, medioAlto } = extension(puntos);
    const paso = medioAncho * 2 + HUECO;
    anchoMaximo = Math.max(anchoMaximo, paso * nivel.cantidad - HUECO);
    const centroY = techo - medioAlto - (indice === 0 ? HUECO : 0);
    for (let unidad = 0; unidad < nivel.cantidad; unidad += 1) {
      const centroX = (unidad - (nivel.cantidad - 1) / 2) * paso;
      // Escalonado: alturas distintas dentro del nivel (y entre niveles cuando hay una sola unidad).
      const desnivel = escalonado ? ((nivel.cantidad > 1 ? unidad : indice) % 2 === 0 ? -0.45 : 0.45) * medioAlto : 0;
      nivel.codigos.forEach((codigo, globo) => {
        const [dx, dy] = puntos[globo]!;
        globos.push({
          clave: `g${grupo}-n${indice}-u${unidad}-b${globo}`,
          x: centroX + dx * RADIO,
          y: centroY + desnivel + dy * RADIO,
          r: RADIO,
          codigo,
          posicion: { nivel: indice, unidad, globo },
          forma: "globo",
          digito: null,
          grupo,
          orden: elegible ? siguienteOrden() : null,
        });
      });
    }
    techo = centroY - medioAlto - (escalonado ? medioAlto * 0.45 : 0) - HUECO;
  });
  const techoNiveles = techo;

  // Remate: arriba, uno al lado del otro.
  if (entrada.remate.length > 0) {
    const paso = RADIO_REMATE * 2 + HUECO;
    const centroY = techo - RADIO_REMATE;
    entrada.remate.forEach((codigo, indice) => {
      globos.push({
        clave: `g${grupo}-r${indice}`,
        x: (indice - (entrada.remate.length - 1) / 2) * paso,
        y: centroY,
        r: RADIO_REMATE,
        codigo,
        posicion: { remate: indice },
        forma: "globo",
        digito: digitoDe(entrada, codigo),
        grupo,
        orden: elegible ? siguienteOrden() : null,
      });
    });
    techo = centroY - RADIO_REMATE - HUECO;
  }

  // Números: al centro (delante), arriba del remate, o uno por grupo a los lados.
  if (entrada.numero) {
    const { codigos, disposicion } = entrada.numero;
    const propios = disposicion === "lados" && entrada.grupos > 1
      ? codigos.map((codigo, indice) => ({ codigo, indice })).filter(({ indice }) => indice === grupo)
      : codigos.map((codigo, indice) => ({ codigo, indice }));
    const paso = ANCHO_NUMERO + HUECO;
    const centroY = disposicion === "arriba" ? techo - RADIO_NUMERO : techoNiveles / 2;
    propios.forEach(({ codigo, indice }, posicion) => {
      globos.push({
        clave: `g${grupo}-d${indice}`,
        x: (posicion - (propios.length - 1) / 2) * paso,
        y: centroY,
        r: RADIO_NUMERO,
        codigo,
        posicion: { digito: indice },
        forma: "numero",
        digito: digitoDe(entrada, codigo),
        grupo,
        // Cada número se elige una sola vez: en el grupo que lo lleva.
        orden: elegible || disposicion === "lados" ? siguienteOrden() : null,
      });
    });
    if (disposicion === "arriba" && propios.length) techo = centroY - RADIO_NUMERO - HUECO;
  }

  if (helio) {
    const pesa = { x: 0, y: RADIO * 3.2 };
    for (const globo of globos) lineas.push({ x1: globo.x, y1: globo.y + globo.r, x2: pesa.x, y2: pesa.y - RADIO * 0.6 });
    return { globos, lineas, pesa, base: null };
  }
  const base = { x: 0, y: RADIO * 0.4, ancho: Math.max(anchoMaximo, RADIO * 4) + RADIO * 1.5 };
  // Varillas: del remate y de los números hasta el nivel más alto.
  for (const globo of globos) {
    if ("nivel" in globo.posicion) continue;
    lineas.push({ x1: globo.x, y1: globo.y + globo.r, x2: globo.x, y2: techoNiveles + RADIO * 1.2 });
  }
  return { globos, lineas, pesa: null, base };
}

function limites(grupo: Grupo): { izquierda: number; derecha: number; arriba: number; abajo: number } {
  const xs = grupo.globos.flatMap((globo) => [globo.x - Math.max(globo.r, ANCHO_NUMERO / 2), globo.x + Math.max(globo.r, ANCHO_NUMERO / 2)]);
  const ys = grupo.globos.flatMap((globo) => [globo.y - globo.r, globo.y + globo.r]);
  if (grupo.base) {
    xs.push(grupo.base.x - grupo.base.ancho / 2, grupo.base.x + grupo.base.ancho / 2);
    ys.push(grupo.base.y + RADIO * 0.9);
  }
  if (grupo.pesa) {
    xs.push(grupo.pesa.x - RADIO, grupo.pesa.x + RADIO);
    ys.push(grupo.pesa.y + RADIO * 0.8);
  }
  return { izquierda: Math.min(0, ...xs), derecha: Math.max(0, ...xs), arriba: Math.min(0, ...ys), abajo: Math.max(0, ...ys) };
}

function desplazar(grupo: Grupo, dx: number): Grupo {
  return {
    globos: grupo.globos.map((globo) => ({ ...globo, x: globo.x + dx })),
    lineas: grupo.lineas.map((linea) => ({ ...linea, x1: linea.x1 + dx, x2: linea.x2 + dx })),
    pesa: grupo.pesa ? { ...grupo.pesa, x: grupo.pesa.x + dx } : null,
    base: grupo.base ? { ...grupo.base, x: grupo.base.x + dx } : null,
  };
}

/**
 * El dibujo completo: un grupo por bouquet (`grupos`), uno al lado del otro,
 * y la caja que los contiene. Los globos que se pueden elegir en el editor
 * llevan `orden`: los del primer grupo y cada número una vez.
 */
export function dibujarBouquet(entrada: EntradaDibujoBouquet): DibujoBouquet {
  let contador = 0;
  const siguienteOrden = () => contador++;
  const grupos = Array.from({ length: Math.max(1, entrada.grupos) }, (_, grupo) => dibujarGrupo(entrada, grupo, siguienteOrden));
  const cajas = grupos.map(limites);
  const anchos = cajas.map((caja) => caja.derecha - caja.izquierda);
  const total = anchos.reduce((suma, ancho) => suma + ancho, 0) + HUECO * 3 * (grupos.length - 1);
  let cursor = -total / 2;
  const colocados = grupos.map((grupo, indice) => {
    const caja = cajas[indice]!;
    const dx = cursor - caja.izquierda;
    cursor += anchos[indice]! + HUECO * 3;
    return desplazar(grupo, dx);
  });
  const arriba = Math.min(...cajas.map((caja) => caja.arriba));
  const abajo = Math.max(...cajas.map((caja) => caja.abajo));
  return {
    caja: { x: -total / 2 - MARGEN, y: arriba - MARGEN, ancho: total + MARGEN * 2, alto: abajo - arriba + MARGEN * 2 },
    // Los números "al centro" van delante: se dibujan al final.
    globos: colocados.flatMap((grupo) => grupo.globos).sort((a, b) => Number(a.forma === "numero") - Number(b.forma === "numero")),
    lineas: colocados.flatMap((grupo) => grupo.lineas),
    pesas: colocados.flatMap((grupo) => (grupo.pesa ? [grupo.pesa] : [])),
    bases: colocados.flatMap((grupo) => (grupo.base ? [grupo.base] : [])),
    soporte: entrada.armado.variante === "base_aire" ? "base" : "helio",
  };
}
