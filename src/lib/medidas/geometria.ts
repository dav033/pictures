/**
 * Motor geométrico del §3 del plan. Todo esto es un modelo, no una medición:
 * cada resultado sale marcado "preliminar": la calibración de densidad y
 * sección visual todavía necesita validarse con más montajes reales.
 */

import { esEstructuraOficialId, ESTRUCTURAS_OFICIALES, type GeometriaEstructuraOficial } from "@/lib/plan/estructuras-oficiales";

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

/** Diámetros (pulgadas) que pide cada mezcla, de menor a mayor. */
export function pulgadasDeMezcla(mezcla: Mezcla): number[] {
  return MEZCLAS[mezcla].map((tamano) => tamano.pulgadas);
}

export const MEZCLAS_DISPONIBLES = Object.keys(MEZCLAS) as Mezcla[];

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
export function calcularEje(figura: Figura, medidas: { anchoM?: number; altoM?: number; largoM?: number }, geometria?: GeometriaEstructuraOficial): number {
  const ancho = medidas.anchoM ?? 0;
  const alto = medidas.altoM ?? 0;
  const largo = medidas.largoM ?? 0;
  if (geometria?.eje === "circunferencia") {
    // Aro circular: círculo completo inscrito en la caja ancho × alto.
    const diametro = ancho && alto ? Math.min(ancho, alto) : ancho || alto;
    return Math.PI * diametro;
  }

  switch (figura) {
    case "guirnalda":
      return largo || ancho;
    case "semiarco": {
      // Un semiarco sube `alto` y avanza `ancho` en horizontal: su eje es un
      // cuarto de elipse (a = ancho, b = alto), no el ancho. El chat manda
      // `largo_m` como profundidad (0,5 m daba un semiarco de 9 globos), así
      // que el largo solo cuenta cuando faltan ancho y alto.
      if (!ancho && !alto) return largo;
      if (!ancho || !alto) return ancho || alto;
      const perimetro = Math.PI * (3 * (ancho + alto) - Math.sqrt((3 * ancho + alto) * (ancho + 3 * alto)));
      return perimetro / 4;
    }
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

/** Invariante roto en el reparto entero: no se devuelve un conteo inventado. */
export class ErrorRepartoGlobos extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ErrorRepartoGlobos";
  }
}

/** Tolerancia del invariante de cuotas (ADR 0022); solo absorbe error de coma flotante. */
const TOLERANCIA_CUOTAS = 1e-6;

/**
 * Reparte unidades enteras con el método del mayor resto (Hamilton). El
 * desempate es: mayor resto, mayor `desempate` (diámetro en el margen de
 * tamaños, 0 en el de materiales) y por último menor índice. El nombre del
 * color ya no participa: `localeCompare` en TypeScript y el orden por punto de
 * código en Python daban repartos distintos para el mismo plan.
 *
 * Las cuotas tienen que sumar el total: si no, el reparto sería un conteo
 * inventado (el caso de los tamaños obligatorios sin renormalizar).
 */
function repartirHamilton(total: number, cuotas: readonly number[], desempates: readonly number[]): number[] {
  if (cuotas.length === 0) return [];
  const suma = cuotas.reduce((acumulado, valor) => acumulado + valor, 0);
  if (Math.abs(suma - total) > TOLERANCIA_CUOTAS) {
    throw new ErrorRepartoGlobos(`las cuotas suman ${suma} y el total a repartir es ${total}`);
  }
  if (total <= 0) return cuotas.map(() => 0);
  const pisos = cuotas.map((cuota) => Math.floor(cuota));
  let faltan = total - pisos.reduce((acumulado, valor) => acumulado + valor, 0);
  const orden = cuotas
    .map((cuota, index) => ({ index, resto: cuota - pisos[index]! }))
    .sort((a, b) => (b.resto - a.resto) || (desempates[b.index]! - desempates[a.index]!) || (a.index - b.index));
  for (const item of orden) {
    if (faltan <= 0) break;
    pisos[item.index]! += 1;
    faltan -= 1;
  }
  return pisos;
}

/**
 * Reparto entero con los dos márgenes de una instancia (ADR 0022): el total
 * por tamaño sale de la mezcla efectiva y el total por material de
 * `participacion`, y la matriz tamaño × material respeta los dos.
 *
 * Un único Hamilton sobre las celdas conservaba el total pero no los márgenes:
 * los acentos R-18/R-24 desaparecían al añadir un segundo color y el reparto
 * por color se desviaba en piezas pequeñas repetidas.
 *
 * La matriz es completa (existe toda celda tamaño × material) y ninguna celda
 * tiene tope, así que mientras queden déficit de fila y de columna hay una
 * celda que puede recibir la unidad; los dos déficits, que suman lo mismo, se
 * agotan a la vez. Por eso el barrido codicioso basta y no hace falta un
 * camino de aumento; si aun así quedara déficit se falla en vez de devolver
 * una matriz que no cuadra.
 */
function repartirPorMargenes(
  total: number,
  tamanos: readonly ProporcionTamano[],
  participaciones: readonly number[],
): number[][] {
  if (tamanos.length === 0 || participaciones.length === 0) return [];
  const sumaParticipacion = participaciones.reduce((acumulado, valor) => acumulado + valor, 0);
  // El esquema del plan ya exige participaciones que suman 1 (±0,001).
  // Renormalizar aquí mantiene el invariante de márgenes si llegan sin sumar 1.
  const cuotasMaterial = sumaParticipacion > 0
    ? participaciones.map((participacion) => participacion / sumaParticipacion)
    : participaciones.map(() => 1 / participaciones.length);
  const totalPorTamano = repartirHamilton(
    total,
    tamanos.map((tamano) => total * tamano.proporcion),
    tamanos.map((tamano) => tamano.pulgadas),
  );
  const totalPorMaterial = repartirHamilton(
    total,
    cuotasMaterial.map((cuota) => total * cuota),
    cuotasMaterial.map(() => 0),
  );
  const matriz = totalPorTamano.map((unidades) => cuotasMaterial.map((cuota) => Math.floor(unidades * cuota)));
  const faltanPorTamano = totalPorTamano.map((unidades, fila) => unidades - matriz[fila]!.reduce((suma, valor) => suma + valor, 0));
  const faltanPorMaterial = totalPorMaterial.map((unidades, columna) => unidades - matriz.reduce((suma, fila) => suma + fila[columna]!, 0));
  const celdas = totalPorTamano.flatMap((unidades, fila) => cuotasMaterial.map((cuota, columna) => ({
    fila,
    columna,
    resto: unidades * cuota - Math.floor(unidades * cuota),
  })));
  celdas.sort((a, b) =>
    (b.resto - a.resto)
    || (tamanos[b.fila]!.pulgadas - tamanos[a.fila]!.pulgadas)
    || (a.columna - b.columna));
  let progreso = true;
  while (progreso) {
    progreso = false;
    for (const celda of celdas) {
      if (faltanPorTamano[celda.fila]! <= 0 || faltanPorMaterial[celda.columna]! <= 0) continue;
      matriz[celda.fila]![celda.columna]! += 1;
      faltanPorTamano[celda.fila]! -= 1;
      faltanPorMaterial[celda.columna]! -= 1;
      progreso = true;
    }
  }
  if (faltanPorTamano.some((valor) => valor !== 0) || faltanPorMaterial.some((valor) => valor !== 0)) {
    throw new ErrorRepartoGlobos(`la matriz de reparto no cerró los márgenes de ${total} globos`);
  }
  return matriz;
}

/**
 * Mezcla efectiva cuando el cliente fija tamaños (`restricciones.tamanos`
 * obligatorios, que el resolutor aplica a TODAS las estructuras geométricas
 * del plan): los tamaños de la mezcla que están en el conjunto pedido,
 * renormalizados a 1; si ninguno está, partes iguales entre los pedidos.
 *
 * Antes se filtraba sin renormalizar y el total seguía saliendo de la mezcla
 * completa, así que un arco "solo R-12" cotizaba la mitad de los globos y un
 * tamaño fuera de la mezcla multiplicaba el total.
 */
export function proporcionesEfectivas(mezcla: Mezcla, tamanos?: readonly number[]): { proporciones: ProporcionTamano[]; sinUbicar: number[] } {
  const pedidos = [...new Set((tamanos ?? []).filter((pulgadas) => Number.isFinite(pulgadas)))].sort((a, b) => a - b);
  if (pedidos.length === 0) return { proporciones: MEZCLAS[mezcla], sinUbicar: [] };
  const permitidos = new Set(pedidos);
  const filtradas = MEZCLAS[mezcla].filter((tamano) => permitidos.has(tamano.pulgadas));
  const suma = filtradas.reduce((acumulado, tamano) => acumulado + tamano.proporcion, 0);
  if (filtradas.length > 0 && suma > 0) {
    const colocados = new Set(filtradas.map((tamano) => tamano.pulgadas));
    return {
      proporciones: filtradas.map((tamano) => ({ pulgadas: tamano.pulgadas, proporcion: tamano.proporcion / suma })),
      sinUbicar: pedidos.filter((pulgadas) => !colocados.has(pulgadas)),
    };
  }
  return { proporciones: pedidos.map((pulgadas) => ({ pulgadas, proporcion: 1 / pedidos.length })), sinUbicar: [] };
}

export function calcularDespieceEstructura(input: {
  tipo: Figura;
  medidas: { anchoM?: number; altoM?: number; largoM?: number };
  repeticiones: number;
  densidad: Densidad;
  mezcla: Mezcla;
  tamanos?: number[];
  materiales: Array<{ color?: string; participacion: number }>;
  /** `estructura_oficial` del plan; cambia la geometría solo en las variantes que la definen. */
  estructuraOficial?: string;
}): {
  ejeM: number;
  totalGlobos: number;
  despiece: Array<{ tamano: string; pulgadas: number; color?: string; cantidad: number; materialIndex: number }>;
  /** Tamaños obligatorios que la mezcla efectiva no puede ubicar (aviso visible). */
  tamanosSinUbicar: number[];
} {
  const { proporciones, sinUbicar } = proporcionesEfectivas(input.mezcla, input.tamanos);
  const resultado = calcularMedidas({
    figura: input.tipo,
    ...input.medidas,
    densidad: input.densidad,
    mezcla: input.mezcla,
    estructuraOficial: input.estructuraOficial,
    proporciones,
  });
  const materiales = input.materiales.length ? input.materiales : [{ participacion: 1 }];
  const matriz = repartirPorMargenes(resultado.totalGlobos, proporciones, materiales.map((material) => material.participacion));
  const repeticiones = Math.max(1, Math.round(input.repeticiones));
  // Material de cada celda por posición: dos materiales del mismo color
  // (reflex y pastel) son dos productos, no uno (antes se unían por color).
  const despiece = proporciones.flatMap((tamano, fila) => materiales.map((material, columna) => ({
    tamano: `R-${tamano.pulgadas}`,
    pulgadas: tamano.pulgadas,
    color: material.color,
    cantidad: (matriz[fila]?.[columna] ?? 0) * repeticiones,
    materialIndex: columna,
  })));
  return {
    ejeM: resultado.ejeM,
    totalGlobos: despiece.reduce((sum, linea) => sum + linea.cantidad, 0),
    despiece,
    tamanosSinUbicar: sinUbicar,
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
  estructuraOficial?: string;
  /**
   * Mezcla efectiva cuando el cliente fija tamaños. Decide el área ponderada
   * del globo y el diámetro dominante; el ancho de banda y el perfil de la
   * estructura oficial siguen saliendo de la mezcla del plan.
   */
  proporciones?: readonly ProporcionTamano[];
}): ResultadoMedidas {
  const densidad = opts.densidad ?? "media";
  const geometria = esEstructuraOficialId(opts.estructuraOficial) ? ESTRUCTURAS_OFICIALES[opts.estructuraOficial].geometria : undefined;
  const factorPerfilBanda = geometria?.anchoFinalBanda === undefined ? 1 : (1 + geometria.anchoFinalBanda) / 2;
  const mezcla = opts.mezcla ?? "organica_fina";
  const lambda = LAMBDA_POR_DENSIDAD[densidad];
  const proporciones = opts.proporciones?.length ? opts.proporciones : MEZCLAS[mezcla];
  const anchoBanda = ANCHO_BANDA_POR_MEZCLA[mezcla];

  const ejeM = calcularEje(opts.figura, opts, geometria);
  const dominante = proporciones.reduce((a, b) => (b.proporcion > a.proporcion ? b : a));
  const dDominanteCm = diametroEfectivoCm(dominante.pulgadas);

  // Modelo de área de fachada con factor de traslape (§3.3): pared usa área
  // real, el resto usa el eje por un "ancho" de banda proporcional al tamaño
  // dominante del globo.
  const area =
    opts.figura === "pared"
      ? (opts.anchoM ?? 0) * (opts.altoM ?? 0)
      : ejeM * ((anchoBanda * dDominanteCm) / 100) * factorPerfilBanda;

  const areaGloboPonderada = proporciones.reduce((suma, m) => {
    const dCm = diametroEfectivoCm(m.pulgadas);
    const areaGlobo = Math.PI * (dCm / 100 / 2) ** 2;
    return suma + m.proporcion * areaGlobo;
  }, 0);

  const totalGlobos = areaGloboPonderada > 0 ? Math.ceil((lambda * area) / areaGloboPonderada) : 0;

  // Ruta heredada sin plan: el color se reparte por partes iguales, con el
  // mismo reparto en dos márgenes que usa el despiece del plan.
  const colores = opts.colores?.length ? opts.colores : [undefined];
  const matriz = repartirPorMargenes(totalGlobos, proporciones, colores.map(() => 1 / colores.length));
  const despiece: LineaDespiece[] = proporciones.flatMap((m, fila) => colores.map((color, columna) => ({
    tamano: `R-${m.pulgadas}`,
    pulgadas: m.pulgadas,
    cantidad: matriz[fila]?.[columna] ?? 0,
    color,
  })));

  return {
    figura: opts.figura,
    anchoM: opts.anchoM,
    altoM: opts.altoM,
    largoM: opts.largoM,
    ejeM: Math.round(ejeM * 100) / 100,
    despiece,
    totalGlobos: despiece.reduce((suma, d) => suma + d.cantidad, 0),
    supuestos: [
      `densidad ${densidad} (λ=${lambda})`,
      "inflado al 92%",
      `mezcla ${mezcla}`,
      ...(geometria?.eje === "circunferencia" ? ["aro circular: eje = circunferencia inscrita en ancho × alto"] : []),
      ...(geometria?.anchoFinalBanda !== undefined ? [`asimétrico: banda afinada al ${Math.round(geometria.anchoFinalBanda * 100)}% (volumen ×${factorPerfilBanda})`] : []),
    ],
    confianza: "preliminar",
    aviso:
      "Estimado sin calibrar con montajes reales — confírmalo con el equipo de decoración antes de cotizar en firme.",
  };
}
