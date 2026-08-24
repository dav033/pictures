/**
 * Motor geométrico del §3 del plan. Todo esto es un modelo, no una medición:
 * cada resultado sale marcado "preliminar": la calibración de densidad y
 * sección visual todavía necesita validarse con más montajes reales.
 */

export type Figura = "arco" | "semiarco" | "guirnalda" | "columna" | "pared" | "centro_mesa";
export type Densidad = "sencilla" | "media" | "lujosa";
export type Mezcla = "clasica" | "organica_fina" | "organica_gruesa" | "solo_grandes";

/** El globo se infla por debajo del nominal a propósito (forma de gota, no esfera). */
const F_INFLADO = 0.92;

/**
 * λ (factor de densidad): una guirnalda orgánica no es una superficie plana,
 * los globos se apilan en profundidad. sencilla/lujosa son extrapolaciones
 * proporcionales y necesitan calibración con montajes reales antes de usarse
 * en firme.
 */
const LAMBDA_POR_DENSIDAD: Record<Densidad, number> = {
  sencilla: 2.8,
  media: 3.6,
  lujosa: 4.5,
};

type ProporcionTamano = { pulgadas: number; proporcion: number };

/**
 * "organica_fina" refleja un orgánico de referencia de cobertura media: R-12
 * domina el volumen, R-5/R-9 llenan huecos y R-18/R-24 son acentos visibles.
 * Las demás son variaciones razonables que requieren su propia calibración.
 */
const MEZCLAS: Record<Mezcla, ProporcionTamano[]> = {
  clasica: [{ pulgadas: 12, proporcion: 1 }],
  organica_fina: [
    { pulgadas: 5, proporcion: 0.21 },
    { pulgadas: 9, proporcion: 0.18 },
    { pulgadas: 12, proporcion: 0.54 },
    { pulgadas: 18, proporcion: 0.05 },
    { pulgadas: 24, proporcion: 0.02 },
  ],
  organica_gruesa: [
    { pulgadas: 9, proporcion: 0.25 },
    { pulgadas: 12, proporcion: 0.45 },
    { pulgadas: 18, proporcion: 0.2 },
    { pulgadas: 24, proporcion: 0.1 },
  ],
  solo_grandes: [
    { pulgadas: 18, proporcion: 0.6 },
    { pulgadas: 24, proporcion: 0.4 },
  ],
};

/**
 * La banda 1.3×R-12 asumía una guirnalda completamente forrada. El orgánico
 * fino de referencia deja soporte y espacio negativo visibles, por eso mide
 * una sección efectiva menor. No afecta las demás mezclas.
 */
const ANCHO_BANDA_POR_MEZCLA: Record<Mezcla, number> = {
  clasica: 1.3,
  organica_fina: 1.02,
  organica_gruesa: 1.3,
  solo_grandes: 1.3,
};

function diametroEfectivoCm(pulgadas: number): number {
  return pulgadas * 2.54 * F_INFLADO;
}

/**
 * Longitud del eje según la figura. El arco usa la aproximación de Ramanujan
 * al perímetro de una elipse (a = ancho/2, b = alto) — es lo que hace que un
 * arco de "3 metros" salga con ~6,38 m de eje real, no 3.
 */
export function calcularEje(figura: Figura, medidas: { anchoM?: number; altoM?: number; largoM?: number }): number {
  const ancho = medidas.anchoM ?? 0;
  const alto = medidas.altoM ?? 0;
  const largo = medidas.largoM ?? 0;

  switch (figura) {
    case "guirnalda":
    case "semiarco":
      return largo || ancho;
    case "columna":
      return alto;
    case "arco": {
      const a = ancho / 2;
      const b = alto;
      const perimetro = Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
      return perimetro / 2;
    }
    case "pared":
      return 0;
    case "centro_mesa":
      return Math.max(ancho, alto, largo);
    default:
      return 0;
  }
}

export type LineaDespiece = { tamano: string; pulgadas: number; cantidad: number; color?: string };

export type ResultadoMedidas = {
  figura: Figura;
  anchoM?: number;
  altoM?: number;
  largoM?: number;
  ejeM: number;
  despiece: LineaDespiece[];
  totalGlobos: number;
  supuestos: string[];
  confianza: "preliminar";
  aviso: string;
};

type CeldaDespiece = { pulgadas: number; color?: string; cuota: number; ordenColor: string };

/** Reparte unidades enteras con el método del mayor resto (Hamilton). */
function repartirHamilton(total: number, celdas: CeldaDespiece[]): Array<{ pulgadas: number; color?: string; cantidad: number }> {
  if (total <= 0 || celdas.length === 0) return celdas.map((celda) => ({ pulgadas: celda.pulgadas, color: celda.color, cantidad: 0 }));
  const pisos = celdas.map((celda) => Math.floor(celda.cuota));
  let faltan = total - pisos.reduce((sum, value) => sum + value, 0);
  const orden = celdas.map((celda, index) => ({ index, resto: celda.cuota - pisos[index]! })).sort((a, b) => {
    if (b.resto !== a.resto) return b.resto - a.resto;
    const porTamano = celdas[b.index]!.pulgadas - celdas[a.index]!.pulgadas;
    if (porTamano !== 0) return porTamano;
    return celdas[a.index]!.ordenColor.localeCompare(celdas[b.index]!.ordenColor);
  });
  for (const item of orden) {
    if (faltan <= 0) break;
    pisos[item.index]! += 1;
    faltan -= 1;
  }
  return celdas.map((celda, index) => ({ pulgadas: celda.pulgadas, color: celda.color, cantidad: pisos[index]! }));
}

export function calcularDespieceEstructura(input: {
  tipo: Figura;
  medidas: { anchoM?: number; altoM?: number; largoM?: number };
  repeticiones: number;
  densidad: Densidad;
  mezcla: Mezcla;
  tamanos?: number[];
  materiales: Array<{ color?: string; participacion: number }>;
}): { ejeM: number; totalGlobos: number; despiece: Array<{ tamano: string; pulgadas: number; color?: string; cantidad: number }> } {
  const resultado = calcularMedidas({
    figura: input.tipo,
    ...input.medidas,
    densidad: input.densidad,
    mezcla: input.mezcla,
  });
  const materiales = input.materiales.length ? input.materiales : [{ participacion: 1 }];
  const celdas: CeldaDespiece[] = [];
  const tamanosPermitidos = input.tamanos?.length ? new Set(input.tamanos) : null;
  const proporciones = tamanosPermitidos
    ? MEZCLAS[input.mezcla].filter((tamano) => tamanosPermitidos.has(tamano.pulgadas))
    : MEZCLAS[input.mezcla];
  const tamanosEfectivos = proporciones.length ? proporciones : input.tamanos?.map((pulgadas) => ({ pulgadas, proporcion: 1 })) ?? MEZCLAS[input.mezcla];
  for (const tamano of tamanosEfectivos) {
    for (const material of materiales) {
      celdas.push({
        pulgadas: tamano.pulgadas,
        color: material.color,
        cuota: resultado.totalGlobos * tamano.proporcion * material.participacion,
        ordenColor: material.color ?? "",
      });
    }
  }
  const repartido = repartirHamilton(resultado.totalGlobos, celdas);
  const repeticiones = Math.max(1, Math.round(input.repeticiones));
  const despiece = repartido.map((linea) => ({
    tamano: `R-${linea.pulgadas}`,
    pulgadas: linea.pulgadas,
    color: linea.color,
    cantidad: linea.cantidad * repeticiones,
  }));
  return {
    ejeM: resultado.ejeM,
    totalGlobos: despiece.reduce((sum, linea) => sum + linea.cantidad, 0),
    despiece,
  };
}

export function calcularMedidas(opts: {
  figura: Figura;
  anchoM?: number;
  altoM?: number;
  largoM?: number;
  densidad?: Densidad;
  colores?: string[];
  mezcla?: Mezcla;
}): ResultadoMedidas {
  const densidad = opts.densidad ?? "media";
  const mezcla = opts.mezcla ?? "organica_fina";
  const lambda = LAMBDA_POR_DENSIDAD[densidad];
  const proporciones = MEZCLAS[mezcla];
  const anchoBanda = ANCHO_BANDA_POR_MEZCLA[mezcla];

  const ejeM = calcularEje(opts.figura, opts);
  const dominante = proporciones.reduce((a, b) => (b.proporcion > a.proporcion ? b : a));
  const dDominanteCm = diametroEfectivoCm(dominante.pulgadas);

  // Modelo de área de fachada con factor de traslape (§3.3): pared usa área
  // real, el resto usa el eje por un "ancho" de banda proporcional al tamaño
  // dominante del globo.
  const area =
    opts.figura === "pared"
      ? (opts.anchoM ?? 0) * (opts.altoM ?? 0)
      : ejeM * ((anchoBanda * dDominanteCm) / 100);

  const areaGloboPonderada = proporciones.reduce((suma, m) => {
    const dCm = diametroEfectivoCm(m.pulgadas);
    const areaGlobo = Math.PI * (dCm / 100 / 2) ** 2;
    return suma + m.proporcion * areaGlobo;
  }, 0);

  const totalGlobos = areaGloboPonderada > 0 ? Math.ceil((lambda * area) / areaGloboPonderada) : 0;

  const colores = opts.colores?.length ? opts.colores : [undefined];
  const celdas: CeldaDespiece[] = proporciones.flatMap((m) => colores.map((color) => ({
    pulgadas: m.pulgadas,
    color,
    cuota: totalGlobos * m.proporcion * (1 / colores.length),
    ordenColor: color ?? "",
  })));
  const despiece: LineaDespiece[] = repartirHamilton(totalGlobos, celdas).map((linea) => ({
    tamano: `R-${linea.pulgadas}`,
    pulgadas: linea.pulgadas,
    cantidad: linea.cantidad,
    color: linea.color,
  }));

  return {
    figura: opts.figura,
    anchoM: opts.anchoM,
    altoM: opts.altoM,
    largoM: opts.largoM,
    ejeM: Math.round(ejeM * 100) / 100,
    despiece,
    totalGlobos: despiece.reduce((suma, d) => suma + d.cantidad, 0),
    supuestos: [`densidad ${densidad} (λ=${lambda})`, "inflado al 92%", `mezcla ${mezcla}`],
    confianza: "preliminar",
    aviso:
      "Estimado sin calibrar con montajes reales — confírmalo con el equipo de decoración antes de cotizar en firme.",
  };
}
