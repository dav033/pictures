/**
 * Motor geométrico del §3 del plan. Todo esto es un modelo, no una medición:
 * cada resultado sale marcado "preliminar" porque solo hay UN dato oficial
 * de densidad real en todo el catálogo (el kit DIY guirnalda fútbol, usado
 * para calibrar λ_organica_fina más abajo) — un punto no valida una curva.
 */

export type Figura = "arco" | "semiarco" | "guirnalda" | "columna" | "pared" | "centro_mesa";
export type Densidad = "sencilla" | "media" | "lujosa";
export type Mezcla = "clasica" | "organica_fina" | "organica_gruesa" | "solo_grandes";

/** El globo se infla por debajo del nominal a propósito (forma de gota, no esfera). */
const F_INFLADO = 0.92;

/**
 * λ (factor de densidad): una guirnalda orgánica no es una superficie plana,
 * los globos se apilan en profundidad. Solo "media" está anclada a un dato
 * real (§3.3 del plan); sencilla/lujosa son extrapolaciones proporcionales
 * — todas necesitan calibración con montajes reales antes de usarse en firme.
 */
const LAMBDA_POR_DENSIDAD: Record<Densidad, number> = {
  sencilla: 2.8,
  media: 3.6,
  lujosa: 4.5,
};

type ProporcionTamano = { pulgadas: number; proporcion: number };

/**
 * "organica_fina" es la mezcla real del KIT DIY GUIRNALDA FÚTBOL (§0.6 del
 * plan) — el único despiece oficial publicado. Las demás son variaciones
 * razonables sin dato real detrás; que no se calibren igual.
 */
const MEZCLAS: Record<Mezcla, ProporcionTamano[]> = {
  clasica: [{ pulgadas: 12, proporcion: 1 }],
  organica_fina: [
    { pulgadas: 5, proporcion: 0.313 },
    { pulgadas: 9, proporcion: 0.224 },
    { pulgadas: 12, proporcion: 0.403 },
    { pulgadas: 18, proporcion: 0.06 },
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
    case "centro_mesa":
      return 0;
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

  const ejeM = calcularEje(opts.figura, opts);
  const dominante = proporciones.reduce((a, b) => (b.proporcion > a.proporcion ? b : a));
  const dDominanteCm = diametroEfectivoCm(dominante.pulgadas);

  // Modelo de área de fachada con factor de traslape (§3.3): pared usa área
  // real, el resto usa el eje por un "ancho" de banda proporcional al tamaño
  // dominante del globo.
  const area =
    opts.figura === "pared"
      ? (opts.anchoM ?? 0) * (opts.altoM ?? 0)
      : ejeM * ((1.3 * dDominanteCm) / 100);

  const areaGloboPonderada = proporciones.reduce((suma, m) => {
    const dCm = diametroEfectivoCm(m.pulgadas);
    const areaGlobo = Math.PI * (dCm / 100 / 2) ** 2;
    return suma + m.proporcion * areaGlobo;
  }, 0);

  const totalGlobos = areaGloboPonderada > 0 ? Math.ceil((lambda * area) / areaGloboPonderada) : 0;

  const despiece: LineaDespiece[] = proporciones.map((m, i) => ({
    tamano: `R-${m.pulgadas}`,
    pulgadas: m.pulgadas,
    cantidad: Math.ceil(m.proporcion * totalGlobos),
    color: opts.colores?.length ? opts.colores[i % opts.colores.length] : undefined,
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
