import { z } from "zod";
import type { PlanGuiadoSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
import { piezaEnPalabras } from "@/lib/ia/guiado/propuesta-composicion";
import { planAdmiteColorNuevo, planSinPieza } from "@/lib/plan/ajuste-estructural";
import { ArmadoArcoOrganicoV1Schema, type ArmadoArcoOrganicoV1 } from "@/lib/plan/armado-arco-organico";
import { ArmadoArcoV1Schema, type ArmadoArcoV1 } from "@/lib/plan/armado-arco";
import { ArmadoColumnaOrganicaV1Schema, type ArmadoColumnaOrganicaV1 } from "@/lib/plan/armado-columna-organica";
import { ArmadoColumnaV1Schema, type ArmadoColumnaV1 } from "@/lib/plan/armado-columna";
import { ArmadoGuirnaldaOrganicaV1Schema, type ArmadoGuirnaldaOrganicaV1 } from "@/lib/plan/armado-guirnalda-organica";
import { PARTICIPACION_MINIMA_REPARTO, type EdicionPlan } from "@/lib/plan/edicion-esquemas";
import { ESTRUCTURAS_OFICIALES_IDS, OFICIALES_SIN_MOTOR, type EstructuraOficialId } from "@/lib/plan/estructuras-oficiales";
import { FEMENINAS } from "@/lib/plan/piezas-individuales";
import { PALETA_COLORES_V2 } from "@/lib/rag/taxonomy/v2";
import type { CandidatoDelServidor, ColorCatalogo } from "@/components/plan/ajuste/ajuste-propuesta";
import { colorSempertex } from "../color-sempertex";
import { colorCliente, colorEnPlural } from "../formato";

/**
 * «Ajustar mi plan» de la vista guiada, sin React ni red: qué se puede tocar de cada pieza (colores, tamaño, quitarla)
 * y el cuerpo de la edición que entiende `/api/plan-editar` (el mismo que usa la propuesta clásica). Aquí NO se
 * cuenta ningún globo: se elige un peso de color, una posición del patrón o una medida, y Python vuelve a resolver
 * y a firmar el plan. Los porcentajes que se muestran salen de las líneas que Python ya resolvió.
 *
 * Una pieza que arma un motor (arco y columna de patrón, arco/columna/guirnalda orgánicos) no acepta `repartir`,
 * `mezcla` ni `propiedades` (Python responde `armado_*_activo`): sus colores y su tamaño se cambian dentro de su
 * armado, igual que en los editores de la clásica (`conForma`, `conAlto`, `conColor`…).
 */

export type PlanGuiado = z.infer<typeof PlanGuiadoSchema>;
type EstructuraPlan = PlanGuiado["plan"]["estructuras"][number];
type MaterialPlan = EstructuraPlan["materiales"][number];

/** Cuánto cambia la parte de un color con cada toque de «+» o «−» (10 puntos). */
export const PASO_PROTAGONISMO = 0.1;
/** La parte más chica y la más grande que un toque deja a un color. */
export const PARTE_MINIMA = PARTICIPACION_MINIMA_REPARTO;
export const PARTE_MAXIMA = 0.85;
/** Posiciones de color que admite un patrón de arco o de columna (`materiales` del armado). */
const MAX_POSICIONES = 8;

/** Piezas que solo cambian su reparto con el deslizador de la clásica (`TIPOS_GEOMETRICOS` de DetalleEstructura). */
const TIPOS_CON_REPARTO = new Set(["arco", "semiarco", "guirnalda", "columna", "pared", "centro_mesa"]);

/** Lo que no es un globo liso de un color (impresos, Infinity, dos caras, figuras, letras) no se ofrece al añadir un color. */
const NO_LISO = /impres|estampad|2 caras|dos caras|feliz|cumplea|happy|birthday|infinity|bal[oó]n|f[uú]tbol|\bcopa\b|letra|n[uú]mero|coraz[oó]n|estrella|figura|metalizad|foil/i;

// --- El motor que cuenta la pieza ---------------------------------------------------------------------------------

type Motor =
  | { tipo: "arco_organico"; armado: ArmadoArcoOrganicoV1 }
  | { tipo: "columna_organica"; armado: ArmadoColumnaOrganicaV1 }
  | { tipo: "guirnalda_organica"; armado: ArmadoGuirnaldaOrganicaV1 }
  | { tipo: "arco"; armado: ArmadoArcoV1 }
  | { tipo: "columna"; armado: ArmadoColumnaV1 };

/** El armado que cuenta la pieza, con la misma precedencia que Python: el clásico manda sobre el orgánico. */
function motorDe(estructura: EstructuraPlan): Motor | null {
  if (estructura.estructura_oficial && OFICIALES_SIN_MOTOR.has(estructura.estructura_oficial)) return null;
  if (estructura.armado_columna) return { tipo: "columna", armado: estructura.armado_columna };
  if (estructura.armado_arco && estructura.tipo === "arco") return { tipo: "arco", armado: estructura.armado_arco };
  if (estructura.armado_arco_organico) return { tipo: "arco_organico", armado: estructura.armado_arco_organico };
  if (estructura.armado_columna_organica) return { tipo: "columna_organica", armado: estructura.armado_columna_organica };
  if (estructura.armado_guirnalda_organica) return { tipo: "guirnalda_organica", armado: estructura.armado_guirnalda_organica };
  return null;
}

/** La edición que guarda un armado cambiado. Todo cambio es una decisión del cliente: `origen: "decorador"`, como en la clásica. */
function edicionDeArmado(estructuraId: string, motor: Motor): EdicionPlan | null {
  switch (motor.tipo) {
    case "arco_organico": {
      const armado = ArmadoArcoOrganicoV1Schema.safeParse({ ...motor.armado, origen: "decorador" });
      return armado.success ? { accion: "armado_arco_organico", estructura_id: estructuraId, armado_arco_organico: armado.data } : null;
    }
    case "columna_organica": {
      const armado = ArmadoColumnaOrganicaV1Schema.safeParse({ ...motor.armado, origen: "decorador" });
      return armado.success ? { accion: "armado_columna_organica", estructura_id: estructuraId, armado_columna_organica: armado.data } : null;
    }
    case "guirnalda_organica": {
      const armado = ArmadoGuirnaldaOrganicaV1Schema.safeParse({ ...motor.armado, origen: "decorador" });
      return armado.success ? { accion: "armado_guirnalda_organica", estructura_id: estructuraId, armado_guirnalda_organica: armado.data } : null;
    }
    case "arco": {
      const armado = ArmadoArcoV1Schema.safeParse({ ...motor.armado, origen: "decorador" });
      return armado.success ? { accion: "armado_arco", estructura_id: estructuraId, armado_arco: armado.data } : null;
    }
    case "columna": {
      const armado = ArmadoColumnaV1Schema.safeParse({ ...motor.armado, origen: "decorador" });
      return armado.success ? { accion: "armado_columna", estructura_id: estructuraId, armado_columna: armado.data } : null;
    }
  }
}

// --- Lo que se ve de cada pieza ------------------------------------------------------------------------------------

/**
 * Qué hace «+» / «−» en una pieza:
 * - `paleta`: pesos de la paleta de un armado orgánico (arco, columna y guirnalda del diseñador).
 * - `posiciones`: posiciones de color del patrón de un arco o una columna (un color en más posiciones lleva más globos).
 * - `reparto`: participación de cada color en una pieza sin armado (la barra «Colores de la pieza» de la clásica).
 * - `fijo`: la pieza no deja cambiar cuánto lleva de cada color (bouquet, patrón por capas, patrón de colores fijo).
 */
export type ModoColores = "paleta" | "posiciones" | "reparto" | "fijo";

export type ColorPieza = {
  /** Índice en `materiales` de la pieza. */
  indice: number;
  /** Color del catálogo, como lo guarda el plan («dorado rosa»). */
  color: string;
  /** «Dorado rosa», «Palo de rosa». */
  etiqueta: string;
  fondo: string;
  globos: number;
  porcentaje: number;
  puedeMas: boolean;
  puedeMenos: boolean;
  puedeQuitar: boolean;
  /** Producto del catálogo que se compra para este color (el que «Cambiar» reemplaza). */
  productId: string;
  /** «Reflex Plata», «Fashion Rosado»: el globo como se pide en Sempertex, o null si no se sabe. */
  producto: string | null;
  /** Globos de este color por tamaño, de Python (de menor a mayor). */
  tamanos: Array<{ pulgadas: number; unidades: number }>;
  /** Se puede escribir cuántos globos lleva (pieza con paleta o reparto) y entre qué cifras (las de Python acotan). */
  cantidad: { minimo: number; maximo: number } | null;
};

export type TamanoPieza = { texto: string; puedeAgrandar: boolean; puedeAchicar: boolean };

export type PiezaAjustable = {
  estructuraId: string;
  /** «Semiarco orgánico», «Columna derecha» (un plan viejo con repeticiones: «2 × Columna»). */
  titulo: string;
  /** «el semiarco orgánico», «la columna derecha»: para decir qué se quita. */
  conArticulo: string;
  modoColores: ModoColores;
  /** Por qué no se reparten los colores (solo con `fijo`). */
  motivoFijo: string | null;
  colores: ColorPieza[];
  tamano: TamanoPieza | null;
  puedeQuitarPieza: boolean;
  /** Globos de la pieza (los de Python; con repeticiones, de todas). */
  globos: number;
  /** Medidas que se pueden escribir (las de la tarjeta). */
  medidas: MedidaEditable[];
  /** La pieza pareja (columna izquierda ↔ derecha): sus cambios se ofrecen «a las dos». */
  pareja: { estructuraId: string; titulo: string } | null;
};

const LineaSchema = z.object({
  product_id: z.string(),
  variant_id: z.string(),
  color: z.string().nullish(),
  unidades: z.number().nonnegative(),
  acabado: z.string().nullish(),
  diam_pulg: z.number().nullish(),
  titulo: z.string().nullish(),
}).passthrough();
type Linea = z.infer<typeof LineaSchema>;

function lineasDe(plan: PlanGuiado, estructuraId: string): Linea[] {
  const estructura = plan.estructuras.find((item) => item.estructura_id === estructuraId);
  return (estructura?.lineas ?? []).flatMap((linea) => {
    const leida = LineaSchema.safeParse(linea);
    return leida.success ? [leida.data] : [];
  });
}

function normal(texto: string | null | undefined): string {
  return (texto ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLocaleLowerCase("es");
}

/** La línea salió de este material: misma variante, o mismo producto y color (`indice_material_para_linea` de Python). */
function deMaterial(material: MaterialPlan, linea: Linea): boolean {
  if (material.product_id !== linea.product_id) return false;
  if (material.variant_id && material.variant_id === linea.variant_id) return true;
  return !material.color || normal(material.color) === normal(linea.color);
}

/** Fracciones a porcentajes enteros que suman 100 (mayor resto). Solo para mostrar. */
function aPorcentajes(valores: readonly number[]): number[] {
  const total = valores.reduce((suma, valor) => suma + valor, 0);
  if (total <= 0) return valores.map(() => 0);
  const exactos = valores.map((valor) => (valor / total) * 100);
  const enteros = exactos.map(Math.floor);
  let resto = 100 - enteros.reduce((suma, valor) => suma + valor, 0);
  for (const { indice } of exactos.map((valor, indice) => ({ indice, fraccion: valor - Math.floor(valor) })).sort((a, b) => b.fraccion - a.fraccion)) {
    if (resto <= 0) break;
    enteros[indice]! += 1;
    resto -= 1;
  }
  return enteros;
}

/**
 * Tono y nombre de un color del plan: los de la fuente única de la guiada (`color-sempertex`), los mismos de los chips,
 * la tabla, el editor y los materiales. Antes, la paleta de la taxonomía: el «Azul» 040 (azul claro) se veía azul rey
 * aquí y celeste en la tarjeta (probador, 2026-10-06).
 */
export function hexDeColor(color: string, opciones: { titulo?: string | null; acabado?: string | null } = {}): string {
  if (color.startsWith("#")) return color;
  return colorSempertex(color, opciones).hex;
}

export function etiquetaColor(color: string, opciones: { titulo?: string | null; acabado?: string | null } = {}): string {
  return colorSempertex(color, opciones).nombre;
}

function idOficial(valor: unknown): EstructuraOficialId | null {
  return typeof valor === "string" && (ESTRUCTURAS_OFICIALES_IDS as readonly string[]).includes(valor) ? valor as EstructuraOficialId : null;
}

/** Nombre individual que pone el servidor («Columna izquierda», «Centro de mesa con globos 2»): ver piezas-individuales.ts. */
const NOMBRE_INDIVIDUAL = /\s(?:izquierd[ao]|derech[ao]|\d+)$/i;

/**
 * «el semiarco orgánico», «la columna derecha», «las dos columnas» (un plan viejo con repeticiones); sin pieza
 * oficial, «la pieza Arco principal». Una pieza individual se nombra por su nombre: así «Quitar» dice cuál.
 */
export function piezaConArticulo(estructura: Pick<EstructuraPlan, "estructura_oficial" | "nombre" | "repeticiones">): string {
  const oficial = idOficial(estructura.estructura_oficial);
  if (!oficial) return `la pieza ${estructura.nombre}`;
  const femenina = FEMENINAS.has(oficial);
  if (estructura.repeticiones <= 1 && NOMBRE_INDIVIDUAL.test(estructura.nombre.trim())) return `${femenina ? "la" : "el"} ${estructura.nombre.trim().toLocaleLowerCase("es")}`;
  const singular = piezaEnPalabras(oficial, 1);
  if (estructura.repeticiones <= 1) return `${femenina ? "la" : "el"} ${singular.replace(/^una? /, "")}`;
  return `${femenina ? "las" : "los"} ${piezaEnPalabras(oficial, estructura.repeticiones)}`;
}

function numero(valor: number): string {
  return String(Math.round(valor * 100) / 100).replace(".", ",");
}

/** «1,6 × 2,2 m», «2 m de alto», «3 m de largo». */
export function medidasCortas(medidas: EstructuraPlan["medidas"]): string | null {
  const { ancho_m: ancho, alto_m: alto, largo_m: largo } = medidas;
  if (ancho && alto) return `${numero(ancho)} × ${numero(alto)} m`;
  if (alto) return `${numero(alto)} m de alto`;
  if (largo) return `${numero(largo)} m de largo`;
  if (ancho) return `${numero(ancho)} m de ancho`;
  return null;
}

function modoColoresDe(estructura: EstructuraPlan, motor: Motor | null): { modo: ModoColores; motivo: string | null } {
  if (motor?.tipo === "arco_organico" || motor?.tipo === "columna_organica" || motor?.tipo === "guirnalda_organica") return { modo: "paleta", motivo: null };
  if (motor?.tipo === "columna") {
    return motor.armado.modo === "altura" ? { modo: "posiciones", motivo: null } : { modo: "fijo", motivo: "Esta columna lleva sus colores capa por capa: cada color va donde está." };
  }
  if (motor?.tipo === "arco") {
    return motor.armado.capas.length === 0 && motor.armado.secciones.length === 0
      ? { modo: "posiciones", motivo: null }
      : { modo: "fijo", motivo: "Este arco lleva sus colores por franjas: cada color va donde está." };
  }
  if (estructura.armado_bouquet || estructura.estructura_oficial === "bouquet") return { modo: "fijo", motivo: "En un bouquet cada globo tiene su lugar: cada color lleva su parte." };
  if (estructura.patron_color && estructura.patron_color.base.modo !== "aleatorio") return { modo: "fijo", motivo: "Esta pieza sigue un patrón de colores: cada color va donde está." };
  if (!TIPOS_CON_REPARTO.has(estructura.tipo)) return { modo: "fijo", motivo: "En esta pieza cada color lleva su parte." };
  return { modo: "reparto", motivo: null };
}

/** Lo que el panel muestra de cada pieza, con qué se puede tocar. */
export function piezasAjustables(plan: PlanGuiado): PiezaAjustable[] {
  const estructuras = plan.plan.estructuras;
  return estructuras.map((estructura) => {
    const motor = motorDe(estructura);
    const { modo, motivo } = modoColoresDe(estructura, motor);
    const lineas = lineasDe(plan, estructura.estructura_id);
    const globos = estructura.materiales.map((material) => lineas.filter((linea) => deMaterial(material, linea)).reduce((suma, linea) => suma + linea.unidades, 0));
    const porcentajes = aPorcentajes(globos);
    const total = globos.reduce((suma, valor) => suma + valor, 0);
    const conCantidad = (modo === "paleta" || modo === "reparto") && estructura.materiales.length > 1 && total > 0;
    const colores = estructura.materiales.map((material, indice): ColorPieza => {
      const color = material.color ?? "otro color";
      const propias = lineas.filter((linea) => deMaterial(material, linea));
      // Con el producto que se compra (su título), el mismo nombre y tono que el chip de la pieza («Plata cromado»).
      const titulo = propias.map((linea) => linea.titulo).find((valor): valor is string => typeof valor === "string") ?? null;
      const comoSeCompra = { titulo, acabado: material.acabado ?? null };
      const porTamano = new Map<number, number>();
      for (const linea of propias) if (linea.diam_pulg) porTamano.set(linea.diam_pulg, (porTamano.get(linea.diam_pulg) ?? 0) + linea.unidades);
      const rango = conCantidad ? rangoCantidad(modo, total, estructura.materiales.length) : null;
      return {
        indice,
        color,
        etiqueta: etiquetaColor(color, comoSeCompra),
        fondo: hexDeColor(color, comoSeCompra),
        globos: globos[indice] ?? 0,
        porcentaje: porcentajes[indice] ?? 0,
        puedeMas: edicionProtagonismo(plan, estructura.estructura_id, indice, 1) !== null,
        puedeMenos: edicionProtagonismo(plan, estructura.estructura_id, indice, -1) !== null,
        puedeQuitar: edicionQuitarColor(plan, estructura.estructura_id, indice) !== null,
        productId: material.product_id,
        producto: colorSempertex(color, comoSeCompra).producto,
        tamanos: [...porTamano.entries()].sort((a, b) => a[0] - b[0]).map(([pulgadas, unidades]) => ({ pulgadas, unidades })),
        cantidad: rango,
      };
    });
    const medidas = medidasCortas(estructura.medidas);
    const agrandar = edicionTamano(plan, estructura.estructura_id, 1) !== null;
    const achicar = edicionTamano(plan, estructura.estructura_id, -1) !== null;
    const pareja = parejaDe(plan, estructura.estructura_id);
    return {
      estructuraId: estructura.estructura_id,
      titulo: `${estructura.repeticiones > 1 ? `${estructura.repeticiones} × ` : ""}${estructura.nombre}`,
      conArticulo: piezaConArticulo(estructura),
      modoColores: modo,
      motivoFijo: motivo,
      colores,
      tamano: medidas && (agrandar || achicar) ? { texto: medidas, puedeAgrandar: agrandar, puedeAchicar: achicar } : null,
      puedeQuitarPieza: planSinPieza(plan.plan, estructura.estructura_id) !== null,
      globos: total,
      medidas: medidasEditables(plan, estructura.estructura_id),
      pareja: pareja ? { estructuraId: pareja.estructura_id, titulo: pareja.nombre } : null,
    };
  });
}

// --- Cuántos globos de un color ------------------------------------------------------------------------------------

/**
 * Entre qué cifras se puede escribir cuántos globos lleva un color: al menos 1 (para ninguno, «Quitar») y dejando al
 * menos un globo a cada otro color. En una pieza con reparto, el piso del reparto (5 %).
 */
function rangoCantidad(modo: ModoColores, total: number, colores: number): { minimo: number; maximo: number } {
  const piso = modo === "reparto" ? Math.max(1, Math.ceil(total * PARTE_MINIMA)) : 1;
  return { minimo: piso, maximo: Math.max(piso, total - piso * (colores - 1)) };
}

/** Globos por material de la pieza, de las líneas que resolvió Python. */
function globosPorMaterial(plan: PlanGuiado, estructura: EstructuraPlan): number[] {
  const lineas = lineasDe(plan, estructura.estructura_id);
  return estructura.materiales.map((material) => lineas.filter((linea) => deMaterial(material, linea)).reduce((suma, linea) => suma + linea.unidades, 0));
}

/**
 * Las partes de cada material para que uno lleve `objetivo` globos de `total`: los demás conservan su proporción entre
 * sí. Null si no se puede (cifra fuera del rango o sin cambio).
 */
function partesParaCantidad(globos: readonly number[], indice: number, objetivo: number): number[] | null {
  const total = globos.reduce((suma, valor) => suma + valor, 0);
  const deseada = Math.round(objetivo);
  if (total <= 0 || globos.length < 2 || deseada < 1 || deseada >= total || deseada === globos[indice]) return null;
  const parte = deseada / total;
  const otros = total - (globos[indice] ?? 0);
  return globos.map((valor, posicion) => (posicion === indice ? parte : otros > 0 ? (valor / otros) * (1 - parte) : (1 - parte) / (globos.length - 1)));
}

/** Pesos enteros (1–100) de una paleta con la escala más fina posible: el mayor vale 100. */
function pesosFinos(partes: readonly number[]): number[] {
  const mayor = Math.max(...partes, 1e-9);
  return partes.map((parte) => Math.min(100, Math.max(1, Math.round((parte / mayor) * 100))));
}

/**
 * «Que lleve N globos de este color»: la edición que pide a Python esa cifra. No cuenta nada: convierte la cifra en la
 * parte del color (paleta de un motor orgánico, o reparto de una pieza sin motor) y Python arma y cuenta; la cifra que
 * se ve después es la suya (puede diferir en uno por redondeo, y el panel lo dice). Null en piezas cuyo patrón fija
 * dónde va cada color, o si la cifra no cambia.
 */
export function edicionCantidad(plan: PlanGuiado, estructuraId: string, indice: number, objetivo: number): EdicionPlan | null {
  const estructura = plan.plan.estructuras.find((item) => item.estructura_id === estructuraId);
  if (!estructura || !estructura.materiales[indice]) return null;
  const motor = motorDe(estructura);
  const { modo } = modoColoresDe(estructura, motor);
  if (modo !== "paleta" && modo !== "reparto") return null;
  const globos = globosPorMaterial(plan, estructura);
  const total = globos.reduce((suma, valor) => suma + valor, 0);
  const rango = rangoCantidad(modo, total, globos.length);
  if (Math.round(objetivo) < rango.minimo || Math.round(objetivo) > rango.maximo) return null;
  const partes = partesParaCantidad(globos, indice, objetivo);
  if (!partes) return null;
  if (modo === "reparto") {
    const participaciones = partes.map((parte) => Math.max(PARTE_MINIMA, Math.round(parte * 10_000) / 10_000));
    const suma = participaciones.reduce((acumulado, parte) => acumulado + parte, 0);
    const normalizadas = participaciones.map((parte) => Math.round((parte / suma) * 10_000) / 10_000);
    return normalizadas.every((parte) => parte >= PARTE_MINIMA && parte < 1) ? { accion: "repartir", estructura_id: estructuraId, participaciones: normalizadas } : null;
  }
  if (!motor || (motor.tipo !== "arco_organico" && motor.tipo !== "columna_organica" && motor.tipo !== "guirnalda_organica")) return null;
  const paleta = motor.armado.colores.paleta;
  // Cada entrada de la paleta toma la parte de su material (dos entradas del mismo material se la reparten por peso).
  const pesoDeMaterial = new Map<number, number>();
  for (const color of paleta) pesoDeMaterial.set(color.material, (pesoDeMaterial.get(color.material) ?? 0) + color.peso);
  const entradas = paleta.map((color) => (partes[color.material] ?? 0) * (color.peso / (pesoDeMaterial.get(color.material) || 1)));
  const conColor = pesoDeMaterial.has(indice)
    ? { paleta, entradas }
    : { paleta: [...paleta, { material: indice, peso: 1, acabado: paleta[0]?.acabado ?? "mate", rol: "normal" as const }], entradas: [...entradas, partes[indice]!] };
  const pesos = pesosFinos(conColor.entradas);
  const nueva = conColor.paleta.map((color, posicion) => ({ ...color, peso: pesos[posicion]! }));
  if (nueva.length === paleta.length && nueva.every((color, posicion) => color.peso === paleta[posicion]!.peso)) return null;
  const colores = { ...motor.armado.colores, paleta: nueva };
  switch (motor.tipo) {
    case "arco_organico": return edicionDeArmado(estructuraId, { tipo: motor.tipo, armado: { ...motor.armado, colores } });
    case "columna_organica": return edicionDeArmado(estructuraId, { tipo: motor.tipo, armado: { ...motor.armado, colores } });
    case "guirnalda_organica": return edicionDeArmado(estructuraId, { tipo: motor.tipo, armado: { ...motor.armado, colores } });
  }
}

/** Cuántos globos de un color lleva una pieza en este plan (los de Python); el color se busca por nombre. */
export function globosDeColor(plan: PlanGuiado, estructuraId: string, color: string): number {
  const estructura = plan.plan.estructuras.find((item) => item.estructura_id === estructuraId);
  if (!estructura) return 0;
  const globos = globosPorMaterial(plan, estructura);
  return estructura.materiales.reduce((suma, material, indice) => (normal(material.color) === normal(color) ? suma + (globos[indice] ?? 0) : suma), 0);
}

/** El índice del material de un color en una pieza (por nombre), o -1. */
export function indiceDeColor(plan: PlanGuiado, estructuraId: string, color: string): number {
  const estructura = plan.plan.estructuras.find((item) => item.estructura_id === estructuraId);
  return estructura ? estructura.materiales.findIndex((material) => normal(material.color) === normal(color)) : -1;
}

// --- Piezas pareja -------------------------------------------------------------------------------------------------

const LADO = /\s+(izquierd[ao]|derech[ao])$/i;

/**
 * La pieza pareja de otra: misma pieza oficial (o tipo) y mismo nombre salvo el lado («Columna izquierda» ↔ «Columna
 * derecha»), como las separa `piezas-individuales.ts`. Sus cambios se ofrecen «a las dos» para que no queden distintas.
 */
export function parejaDe(plan: PlanGuiado, estructuraId: string): EstructuraPlan | null {
  const estructura = plan.plan.estructuras.find((item) => item.estructura_id === estructuraId);
  const lado = estructura ? LADO.exec(estructura.nombre.trim()) : null;
  if (!estructura || !lado) return null;
  const base = normal(estructura.nombre.trim().replace(LADO, ""));
  const propio = normal(lado[1]).startsWith("izquierd") ? "izquierd" : "derech";
  return plan.plan.estructuras.find((otra) => {
    if (otra.estructura_id === estructuraId || (otra.estructura_oficial ?? otra.tipo) !== (estructura.estructura_oficial ?? estructura.tipo)) return false;
    const suyo = LADO.exec(otra.nombre.trim());
    return Boolean(suyo) && normal(otra.nombre.trim().replace(LADO, "")) === base && !normal(suyo![1]).startsWith(propio);
  }) ?? null;
}

// --- Más o menos de un color --------------------------------------------------------------------------------------

/**
 * Las partes de todos los colores con `indice` en `objetivo` y los demás conservando su proporción entre sí. Null si
 * algún otro color quedaría por debajo de la parte mínima y no queda margen para el cambio.
 */
function partesConObjetivo(partes: readonly number[], indice: number, objetivo: number): number[] | null {
  const otros = partes.reduce((suma, parte, posicion) => (posicion === indice ? suma : suma + parte), 0);
  const cuantosOtros = partes.length - 1;
  if (cuantosOtros <= 0) return null;
  const siguientes = partes.map((parte, posicion) => (posicion === indice ? objetivo : otros > 0 ? (parte / otros) * (1 - objetivo) : (1 - objetivo) / cuantosOtros));
  if (siguientes.every((parte, posicion) => posicion === indice || parte >= PARTE_MINIMA - 1e-9)) return siguientes;
  // Algún otro color se quedaría casi sin globos: se queda en el mínimo y el objetivo toma lo que sobra.
  const acotadas = siguientes.map((parte, posicion) => (posicion === indice ? parte : Math.max(PARTE_MINIMA, parte)));
  const resto = 1 - acotadas.reduce((suma, parte, posicion) => (posicion === indice ? suma : suma + parte), 0);
  const actual = partes[indice]! / (partes.reduce((suma, parte) => suma + parte, 0) || 1);
  if (resto <= actual + 0.01) return null;
  acotadas[indice] = resto;
  return acotadas;
}

function objetivoDe(actual: number, direccion: 1 | -1): number | null {
  const objetivo = Math.min(PARTE_MAXIMA, Math.max(PARTE_MINIMA, actual + direccion * PASO_PROTAGONISMO));
  return Math.abs(objetivo - actual) < 0.01 ? null : objetivo;
}

/** Pesos enteros (1–100) de la paleta de un armado orgánico a partir de las partes. */
function pesosEnteros(partes: readonly number[]): number[] {
  return partes.map((parte) => Math.min(100, Math.max(1, Math.round(parte * 100))));
}

type Paleta = ArmadoArcoOrganicoV1["colores"]["paleta"];

function paletaConProtagonismo(paleta: Paleta, material: number, direccion: 1 | -1): Paleta | null {
  const posicion = paleta.findIndex((color) => color.material === material);
  const total = paleta.reduce((suma, color) => suma + color.peso, 0) || 1;
  if (posicion < 0) {
    // El color está en la pieza pero el armado no lo usa: «+» lo pone con una parte pequeña.
    if (direccion < 0) return null;
    const partes = partesConObjetivo([...paleta.map((color) => color.peso / total), 0], paleta.length, 0.15);
    if (!partes) return null;
    const pesos = pesosEnteros(partes);
    const base = paleta[0];
    return [...paleta.map((color, indice) => ({ ...color, peso: pesos[indice]! })), { material, peso: pesos[paleta.length]!, acabado: base?.acabado ?? "mate", rol: "normal" }];
  }
  const partesActuales = paleta.map((color) => color.peso / total);
  const objetivo = objetivoDe(partesActuales[posicion]!, direccion);
  if (objetivo === null) return null;
  const partes = partesConObjetivo(partesActuales, posicion, objetivo);
  if (!partes) return null;
  const pesos = pesosEnteros(partes);
  if (pesos.every((peso, indice) => peso === paleta[indice]!.peso)) return null;
  return paleta.map((color, indice) => ({ ...color, peso: pesos[indice]! }));
}

/** Posiciones del patrón con un color más (o menos) presente. El sólido solo mira la primera. */
function posicionesConProtagonismo(materiales: readonly number[], patron: string, material: number, direccion: 1 | -1, coloresPieza: number): number[] | null {
  if (patron === "solido") {
    if (direccion > 0) return materiales[0] === material ? null : [material, ...materiales.filter((indice) => indice !== material)];
    if (materiales[0] !== material) return null;
    const otro = materiales.find((indice) => indice !== material) ?? Array.from({ length: coloresPieza }, (_, indice) => indice).find((indice) => indice !== material);
    return otro === undefined ? null : [otro, ...materiales.filter((indice) => indice !== otro)];
  }
  const veces = materiales.filter((indice) => indice === material).length;
  if (direccion > 0) {
    if (materiales.length >= MAX_POSICIONES) return null;
    const ultima = materiales.lastIndexOf(material);
    // Junto a la que ya tiene, para que un degradado no se corte en dos.
    return ultima < 0 ? [...materiales, material] : [...materiales.slice(0, ultima + 1), material, ...materiales.slice(ultima + 1)];
  }
  if (veces === 0) return null;
  if (veces > 1) {
    const ultima = materiales.lastIndexOf(material);
    return [...materiales.slice(0, ultima), ...materiales.slice(ultima + 1)];
  }
  // Una sola posición: los demás colores ganan una cada uno, si caben.
  const otros = [...new Set(materiales.filter((indice) => indice !== material))];
  if (!otros.length || materiales.length + otros.length > MAX_POSICIONES) return null;
  let siguientes = [...materiales];
  for (const otro of otros) {
    const ultima = siguientes.lastIndexOf(otro);
    siguientes = [...siguientes.slice(0, ultima + 1), otro, ...siguientes.slice(ultima + 1)];
  }
  return siguientes;
}

function participacionesConProtagonismo(materiales: readonly MaterialPlan[], indice: number, direccion: 1 | -1): number[] | null {
  if (materiales.length < 2) return null;
  const total = materiales.reduce((suma, material) => suma + material.participacion, 0) || 1;
  const partesActuales = materiales.map((material) => material.participacion / total);
  const objetivo = objetivoDe(partesActuales[indice]!, direccion);
  if (objetivo === null) return null;
  const partes = partesConObjetivo(partesActuales, indice, objetivo);
  if (!partes) return null;
  const redondeadas = partes.map((parte) => Math.round(parte * 10_000) / 10_000);
  return redondeadas.every((parte) => parte >= PARTE_MINIMA && parte < 1) ? redondeadas : null;
}

/** «+» (1) o «−» (-1) en un color de una pieza: la edición, o null si ese toque no cambia nada o no se puede. */
export function edicionProtagonismo(plan: PlanGuiado, estructuraId: string, indice: number, direccion: 1 | -1): EdicionPlan | null {
  const estructura = plan.plan.estructuras.find((item) => item.estructura_id === estructuraId);
  if (!estructura || !estructura.materiales[indice]) return null;
  const motor = motorDe(estructura);
  const { modo } = modoColoresDe(estructura, motor);
  if (modo === "fijo") return null;
  if (modo === "reparto") {
    const participaciones = participacionesConProtagonismo(estructura.materiales, indice, direccion);
    return participaciones ? { accion: "repartir", estructura_id: estructuraId, participaciones } : null;
  }
  if (!motor) return null;
  if (motor.tipo === "columna" || motor.tipo === "arco") {
    const materiales = posicionesConProtagonismo(motor.armado.materiales, motor.armado.patron, indice, direccion, estructura.materiales.length);
    if (!materiales) return null;
    return motor.tipo === "columna"
      ? edicionDeArmado(estructuraId, { tipo: "columna", armado: { ...motor.armado, materiales } })
      : edicionDeArmado(estructuraId, { tipo: "arco", armado: { ...motor.armado, materiales } });
  }
  const paleta = paletaConProtagonismo(motor.armado.colores.paleta, indice, direccion);
  if (!paleta) return null;
  const colores = { ...motor.armado.colores, paleta };
  switch (motor.tipo) {
    case "arco_organico": return edicionDeArmado(estructuraId, { tipo: motor.tipo, armado: { ...motor.armado, colores } });
    case "columna_organica": return edicionDeArmado(estructuraId, { tipo: motor.tipo, armado: { ...motor.armado, colores } });
    case "guirnalda_organica": return edicionDeArmado(estructuraId, { tipo: motor.tipo, armado: { ...motor.armado, colores } });
  }
}

// --- Tamaño de la pieza ------------------------------------------------------------------------------------------

export type CampoMedida = "ancho_m" | "alto_m" | "largo_m";
export type MedidasObjetivo = Partial<Record<CampoMedida, number>>;

/**
 * Una medida que el cliente puede escribir: la que se ve en la tarjeta (`valor`, la que Python dejó en el plan tras
 * armar la pieza globo a globo) y el rango del motor, en metros. `pedida`: lo que el armado le pide al motor; la pieza
 * armada sale un poco distinta (2,5 m pedidos, 2,36 m armados) y por eso se corrige con esa misma razón al pedir otra.
 */
export type MedidaEditable = { campo: CampoMedida; etiqueta: "Ancho" | "Alto" | "Largo"; valor: number; pedida: number; minimo: number; maximo: number };

const ETIQUETA_MEDIDA: Readonly<Record<CampoMedida, MedidaEditable["etiqueta"]>> = { ancho_m: "Ancho", alto_m: "Alto", largo_m: "Largo" };

function redondear2(valor: number): number {
  return Math.round(valor * 100) / 100;
}

/** Las medidas que se pueden escribir de una pieza (vacío: un bouquet, o una pieza sin medidas). */
export function medidasEditables(plan: PlanGuiado, estructuraId: string): MedidaEditable[] {
  const estructura = plan.plan.estructuras.find((item) => item.estructura_id === estructuraId);
  if (!estructura) return [];
  const motor = motorDe(estructura);
  const real = estructura.medidas;
  const medida = (campo: CampoMedida, pedida: number, minimo: number, maximo: number): MedidaEditable => ({ campo, etiqueta: ETIQUETA_MEDIDA[campo], valor: redondear2(real[campo] ?? pedida), pedida, minimo, maximo });
  if (motor) {
    switch (motor.tipo) {
      case "arco_organico": return [medida("ancho_m", motor.armado.forma.anchoM, 1.5, 10), medida("alto_m", motor.armado.forma.altoM, 1, 6)];
      case "columna_organica": return [medida("alto_m", motor.armado.forma.altoM, 0.5, 6)];
      case "guirnalda_organica": return [medida("largo_m", motor.armado.forma.largoM, 0.8, 10)];
      case "arco": {
        const geometria = motor.armado.geometria;
        // El arco «semi» deduce el alto del ancho: solo se escribe el ancho.
        return geometria.forma === "semi" ? [medida("ancho_m", geometria.anchoM, 0.8, 10)] : [medida("ancho_m", geometria.anchoM, 0.8, 10), medida("alto_m", geometria.altoM, 0.8, 6)];
      }
      case "columna": return [medida("alto_m", motor.armado.cuerpo.alto_m, 0.5, 6)];
    }
  }
  // Un bouquet no se mide en metros.
  if (estructura.armado_bouquet || estructura.estructura_oficial === "bouquet") return [];
  return (["ancho_m", "alto_m", "largo_m"] as const).flatMap((campo) => {
    const actual = real[campo];
    return actual === undefined ? [] : [medida(campo, actual, 0.5, 100)];
  });
}

/**
 * Lo que se le pide al motor para que la pieza armada mida `objetivo`: la medida pedida corregida con la razón entre
 * lo pedido y lo armado (si se pidieron 2,5 m y salieron 2,36, para 3 m se piden 3 × 2,5 / 2,36), dentro del rango.
 */
function pedidaPara(medida: MedidaEditable, objetivo: number): number {
  const razon = medida.valor > 0 ? medida.pedida / medida.valor : 1;
  return redondear2(Math.min(medida.maximo, Math.max(medida.minimo, objetivo * razon)));
}

/**
 * La pieza con las medidas que el cliente escribió (en metros), en su armado si un motor la cuenta o en sus medidas si
 * no. Solo cambian las medidas que se escriben; null si ninguna cambia. Python arma la pieza y la cuenta.
 */
export function edicionMedidas(plan: PlanGuiado, estructuraId: string, objetivo: MedidasObjetivo): EdicionPlan | null {
  const estructura = plan.plan.estructuras.find((item) => item.estructura_id === estructuraId);
  if (!estructura) return null;
  const editables = medidasEditables(plan, estructuraId);
  const pedidas = new Map<CampoMedida, number>();
  for (const medida of editables) {
    const deseada = objetivo[medida.campo];
    if (deseada === undefined || !Number.isFinite(deseada) || deseada <= 0) continue;
    if (Math.abs(redondear2(deseada) - medida.valor) < 0.01) continue;
    const pedida = pedidaPara(medida, deseada);
    if (Math.abs(pedida - medida.pedida) >= 0.01) pedidas.set(medida.campo, pedida);
  }
  if (!pedidas.size) return null;
  const motor = motorDe(estructura);
  if (motor) {
    switch (motor.tipo) {
      case "arco_organico": {
        const forma = motor.armado.forma;
        return edicionDeArmado(estructuraId, { tipo: motor.tipo, armado: { ...motor.armado, forma: { ...forma, anchoM: pedidas.get("ancho_m") ?? forma.anchoM, altoM: pedidas.get("alto_m") ?? forma.altoM } } });
      }
      case "columna_organica":
        return edicionDeArmado(estructuraId, { tipo: motor.tipo, armado: { ...motor.armado, forma: { ...motor.armado.forma, altoM: pedidas.get("alto_m") ?? motor.armado.forma.altoM } } });
      case "guirnalda_organica":
        return edicionDeArmado(estructuraId, { tipo: motor.tipo, armado: { ...motor.armado, forma: { ...motor.armado.forma, largoM: pedidas.get("largo_m") ?? motor.armado.forma.largoM } } });
      case "arco": {
        const geometria = motor.armado.geometria;
        return edicionDeArmado(estructuraId, { tipo: "arco", armado: { ...motor.armado, geometria: { ...geometria, anchoM: pedidas.get("ancho_m") ?? geometria.anchoM, altoM: pedidas.get("alto_m") ?? geometria.altoM } } });
      }
      case "columna":
        return edicionDeArmado(estructuraId, { tipo: "columna", armado: { ...motor.armado, cuerpo: { ...motor.armado.cuerpo, alto_m: pedidas.get("alto_m") ?? motor.armado.cuerpo.alto_m } } });
    }
  }
  return { accion: "propiedades", estructura_id: estructuraId, medidas: Object.fromEntries(pedidas) };
}

/** Cuánto cambia la pieza con «Agrandar» / «Achicar»: un 10 % (al menos 10 cm), todas sus medidas a la vez. */
export const PASO_TAMANO_RELATIVO = 0.1;
const PASO_TAMANO_MINIMO_M = 0.1;

/** Las medidas que dejaría un toque de «Agrandar» (1) o «Achicar» (-1), dentro del rango; null si ya está en el borde. */
export function medidasConPaso(plan: PlanGuiado, estructuraId: string, direccion: 1 | -1): MedidasObjetivo | null {
  const editables = medidasEditables(plan, estructuraId);
  const objetivo: MedidasObjetivo = {};
  for (const medida of editables) {
    const paso = Math.max(PASO_TAMANO_MINIMO_M, medida.valor * PASO_TAMANO_RELATIVO);
    const siguiente = Math.round((medida.valor + direccion * paso) * 20) / 20;
    // El borde se mira en lo que se le pediría al motor, que es lo que tiene rango.
    const pedida = pedidaPara(medida, siguiente);
    if (Math.abs(pedida - medida.pedida) >= 0.01) objetivo[medida.campo] = siguiente;
  }
  return Object.keys(objetivo).length ? objetivo : null;
}

/** «Agrandar» (1) o «Achicar» (-1) un 10 %: en el armado si un motor la cuenta, en sus medidas si no. */
export function edicionTamano(plan: PlanGuiado, estructuraId: string, direccion: 1 | -1): EdicionPlan | null {
  const objetivo = medidasConPaso(plan, estructuraId, direccion);
  return objetivo ? edicionMedidas(plan, estructuraId, objetivo) : null;
}

// --- Quitar y añadir colores --------------------------------------------------------------------------------------

/** Quitar un color de la pieza: la edición `quitar` de la clásica con una línea de ese color. Nunca el único color. */
export function edicionQuitarColor(plan: PlanGuiado, estructuraId: string, indice: number): EdicionPlan | null {
  const estructura = plan.plan.estructuras.find((item) => item.estructura_id === estructuraId);
  const material = estructura?.materiales[indice];
  if (!estructura || !material || estructura.materiales.length < 2) return null;
  // Python quita el material de la línea que se le nombra: tiene que ser una línea de ESTE color.
  const linea = lineasDe(plan, estructuraId).find((item) => deMaterial(material, item) && estructura.materiales.findIndex((otro) => deMaterial(otro, item)) === indice);
  return linea ? { accion: "quitar", estructura_id: estructuraId, objetivo_variant_id: linea.variant_id } : null;
}

/** El globo liso elegido: su variante preferida (12″) y TODAS las de ese color, para que cada pieza tenga sus tamaños. */
export type GloboElegido = { productId: string; variantId: string; variantIds: string[]; color: string };

const PREFERENCIA_ACABADO: ReadonlyArray<RegExp> = [/fashion/i, /pastel|mate/i, /satin|sat[ií]n/i];

/**
 * Si el catálogo tiene un globo liso de un color, de lo que devolvió la búsqueda: redondo, de un solo color,
 * disponible y sin impresos. Prefiere el liso «Fashion» de siempre (o el acabado que se le pida) y el de 12″. Antes
 * de rehacer el plan con un color nuevo se comprueba que exista: así no se gasta un plan en un color sin globos lisos.
 */
export function elegirGloboLiso(candidatos: readonly CandidatoDelServidor[], color: string, acabadoPieza: string | null): GloboElegido | null {
  const buscado = normal(color);
  const opciones = candidatos.flatMap((candidato) => {
    if (NO_LISO.test(candidato.titulo)) return [];
    const variantes = candidato.variantes.filter((variante) => variante.disponible && (variante.forma ?? "redondo") === "redondo" && variante.colores.length === 1 && normal(variante.colores[0]) === buscado);
    if (!variantes.length) return [];
    const preferida = [...variantes].sort((a, b) => Math.abs((a.diamPulg ?? 99) - 12) - Math.abs((b.diamPulg ?? 99) - 12) || a.variantId.localeCompare(b.variantId))[0]!;
    const titulo = candidato.titulo;
    const rango = acabadoPieza && titulo.toLocaleLowerCase("es").includes(acabadoPieza.toLocaleLowerCase("es")) ? -1 : (() => {
      const posicion = PREFERENCIA_ACABADO.findIndex((patron) => patron.test(titulo));
      return posicion < 0 ? PREFERENCIA_ACABADO.length : posicion;
    })();
    return [{ rango, eleccion: { productId: candidato.productId, variantId: preferida.variantId, variantIds: variantes.map((variante) => variante.variantId).slice(0, 24), color: preferida.colores[0]! } }];
  });
  opciones.sort((a, b) => a.rango - b.rango);
  return opciones[0]?.eleccion ?? null;
}

/**
 * Los colores que se pueden añadir al plan: los de la paleta de la guiada que el catálogo vende (`modo: "colores"` de
 * `/api/plan-editar`), del más vendido al menos, sin los que el plan ya lleva ni los que resultaron sin globo liso. Que
 * haya un globo LISO de ese color se comprueba al elegirlo.
 */
export function coloresParaAgregar(catalogo: readonly ColorCatalogo[], presentes: readonly string[], descartados: readonly string[] = []): string[] {
  const totales = new Map(catalogo.filter((color) => color.total > 0).map((color) => [normal(color.valor), color.total]));
  const fuera = new Set([...presentes, ...descartados].map(normal));
  return PALETA_COLORES_V2
    .filter((color) => color !== "multicolor" && totales.has(normal(color)) && !fuera.has(normal(color)))
    .sort((a, b) => (totales.get(normal(b)) ?? 0) - (totales.get(normal(a)) ?? 0));
}

/** Colores del plan, como los dice el catálogo y sin repetir, en el orden de las piezas. */
export function coloresDelPlan(plan: PlanGuiado): string[] {
  return [...new Set(plan.plan.estructuras.flatMap((estructura) => estructura.materiales.map((material) => normal(material.color)).filter(Boolean)))];
}

/** Tope de colores de una propuesta de la guiada (`PropuestaComposicionSchema`). */
export const MAX_COLORES_PLAN = 5;

// --- Quitar una pieza o añadir un color (sin modelo: `ajuste-plan-entero.ts` en el servidor) -----------------------

/**
 * Se puede añadir un color si el plan tiene menos de cinco y alguna pieza lo admite. El color entra en la paleta de
 * cada pieza con todas sus medidas intactas (`planConColor`); Python vuelve a resolver y a firmar.
 */
export function admiteColorNuevo(plan: PlanGuiado): boolean {
  return coloresDelPlan(plan).length < MAX_COLORES_PLAN && planAdmiteColorNuevo(plan.plan);
}

/**
 * Por qué no se puede añadir un color, con la causa real (antes decía «ya tiene cinco colores» en un plan de dos cuyas
 * columnas llevan un patrón fijo); null si se puede.
 */
export function motivoSinColorNuevo(plan: PlanGuiado): string | null {
  if (admiteColorNuevo(plan)) return null;
  const cuantos = coloresDelPlan(plan).length;
  if (cuantos >= MAX_COLORES_PLAN) return `Tu plan ya tiene ${cuantos} colores, el máximo: quita uno de una pieza o cámbialo por otro con «Cambiar».`;
  return "Tus piezas llevan sus colores en un orden fijo y no admiten uno más. Puedes cambiar cualquier color por otro globo con «Cambiar».";
}

export type ColorDelPlan = { color: string; etiqueta: string; fondo: string; porcentaje: number };

/** Los colores del plan con su parte de todos los globos (de las líneas que resolvió Python), para la cabecera del panel. */
export function coloresDelPlanVista(plan: PlanGuiado): ColorDelPlan[] {
  const colores = coloresDelPlan(plan);
  // Las líneas ya cuentan las repeticiones de la pieza (dos columnas: los globos de las dos).
  const lineas = plan.plan.estructuras.flatMap((estructura) => lineasDe(plan, estructura.estructura_id).map((linea) => ({ color: normal(linea.color), unidades: linea.unidades })));
  const porcentajes = aPorcentajes(colores.map((color) => lineas.filter((linea) => linea.color === color).reduce((suma, linea) => suma + linea.unidades, 0)));
  return colores.map((color, indice) => ({ color, etiqueta: etiquetaColor(color), fondo: hexDeColor(color), porcentaje: porcentajes[indice] ?? 0 }));
}


// --- Lo que se dice del cambio ------------------------------------------------------------------------------------

/** Un globo del catálogo elegido en el selector: su producto, su color y todas sus variantes (tamaños). */
export type GloboParaPlan = { productId: string; color: string; variantIds: string[]; nombre: string };

/**
 * Un toque del panel. `pareja`: el mismo cambio también en la pieza pareja (columna izquierda ↔ derecha), para que
 * las dos sigan iguales. `agregar-color`, `reemplazar-color` sin piezas y `tamano-todo` son del plan entero.
 */
export type CambioPlan =
  | { tipo: "protagonismo"; estructuraId: string; indice: number; direccion: 1 | -1; pareja?: boolean }
  | { tipo: "cantidad"; estructuraId: string; indice: number; objetivo: number; desde: number; pareja?: boolean }
  | { tipo: "tamano"; estructuraId: string; direccion: 1 | -1; pareja?: boolean }
  | { tipo: "medidas"; estructuraId: string; medidas: MedidasObjetivo; pareja?: boolean }
  | { tipo: "quitar-color"; estructuraId: string; indice: number; pareja?: boolean }
  | { tipo: "agregar-color"; color: string; globo?: GloboParaPlan; /** Solo en estas piezas (pedido por chat: «agrégale dorado a las columnas»). */ estructuraIds?: string[] }
  | { tipo: "reemplazar-color"; color: string; productIdAnterior?: string; estructuraIds?: string[]; globo: GloboParaPlan }
  | { tipo: "tamano-todo"; direccion: 1 | -1 }
  | { tipo: "quitar-pieza"; estructuraId: string };

/** El cambio toca todas las piezas (añadir o cambiar un color en todo el plan, agrandarlo entero). */
export function cambiaTodasLasPiezas(cambio: CambioPlan): boolean {
  return (cambio.tipo === "agregar-color" && !cambio.estructuraIds?.length) || cambio.tipo === "tamano-todo" || (cambio.tipo === "reemplazar-color" && !cambio.estructuraIds?.length);
}

/** La pieza que toca el cambio (donde se ve «Calculando…»), o null si es del plan entero. */
export function piezaDelCambio(cambio: CambioPlan): string | null {
  if (cambio.tipo === "tamano-todo") return null;
  if (cambio.tipo === "reemplazar-color" || cambio.tipo === "agregar-color") return cambio.estructuraIds?.[0] ?? null;
  return cambio.estructuraId;
}

/** Las piezas que esperan el plan nuevo: la del cambio y, con `pareja`, también su pareja; null = todas. */
export function piezasDelCambio(plan: PlanGuiado, cambio: CambioPlan): string[] | null {
  if (cambiaTodasLasPiezas(cambio)) return null;
  if (cambio.tipo === "reemplazar-color" || cambio.tipo === "agregar-color") return cambio.estructuraIds ?? null;
  const propia = piezaDelCambio(cambio);
  if (!propia) return null;
  const pareja = "pareja" in cambio && cambio.pareja ? parejaDe(plan, propia) : null;
  return pareja ? [propia, pareja.estructura_id] : [propia];
}

function piezaConPareja(plan: PlanGuiado, estructuraId: string, conPareja: boolean | undefined): string {
  const estructura = plan.plan.estructuras.find((item) => item.estructura_id === estructuraId);
  const pieza = estructura ? piezaConArticulo(estructura) : "la pieza";
  const pareja = conPareja ? parejaDe(plan, estructuraId) : null;
  return pareja ? `${pieza} y ${piezaConArticulo(pareja)}` : pieza;
}

/** «84 globos», «1 globo». */
export function globosEnTexto(cantidad: number): string {
  return `${cantidad.toLocaleString("es-CO")} ${cantidad === 1 ? "globo" : "globos"}`;
}

/** «84 globos rosados», «1 globo rosado», «12 globos dorado rosa». */
export function globosDeColorEnTexto(cantidad: number, color: string): string {
  const nombre = colorCliente(color);
  return `${globosEnTexto(cantidad)} ${cantidad === 1 ? nombre : colorEnPlural(nombre)}`;
}

/**
 * «más rosado en el semiarco orgánico», «sin la columna»: la línea corta del historial («Ajusté: …») y de los avisos.
 * Sin verbo en primera persona, para que se lea igual en «Listo: …» y en «Último ajuste: …».
 */
export function describirCambio(plan: PlanGuiado, cambio: CambioPlan): string {
  if (cambio.tipo === "agregar-color") return `con ${cambio.globo?.nombre ?? colorCliente(cambio.color)}${cambio.estructuraIds?.length ? ` en ${cambio.estructuraIds.map((id) => piezaConPareja(plan, id, false)).join(" y ")}` : ""}`;
  if (cambio.tipo === "tamano-todo") return cambio.direccion > 0 ? "todas las piezas un poco más grandes" : "todas las piezas un poco más pequeñas";
  if (cambio.tipo === "reemplazar-color") {
    const donde = cambio.estructuraIds?.length ? ` en ${cambio.estructuraIds.map((id) => piezaConPareja(plan, id, false)).join(" y ")}` : "";
    return `${cambio.globo.nombre} en lugar de ${colorCliente(cambio.color)}${donde}`;
  }
  const estructura = plan.plan.estructuras.find((item) => item.estructura_id === cambio.estructuraId);
  const conPareja = "pareja" in cambio && cambio.pareja === true && parejaDe(plan, cambio.estructuraId) !== null;
  const pieza = piezaConPareja(plan, cambio.estructuraId, conPareja);
  const colorDe = (indice: number) => colorCliente(estructura?.materiales[indice]?.color ?? "ese color");
  switch (cambio.tipo) {
    case "protagonismo": return `${cambio.direccion > 0 ? "más" : "menos"} ${colorDe(cambio.indice)} en ${pieza}`;
    case "cantidad": return `${globosDeColorEnTexto(Math.round(cambio.objetivo), estructura?.materiales[cambio.indice]?.color ?? "ese color")} en ${pieza}`;
    case "tamano": return `${pieza} ${cambio.direccion > 0 ? ((estructura?.repeticiones ?? 1) > 1 || conPareja ? "más grandes" : "más grande") : "de menor tamaño"}`;
    case "medidas": {
      const medidas = medidasCortas({ ...(estructura?.medidas ?? {}), ...cambio.medidas });
      return `${pieza} de ${medidas ?? "otra medida"}`;
    }
    case "quitar-color": return `sin ${colorDe(cambio.indice)} en ${pieza}`;
    case "quitar-pieza": return `sin ${pieza}`;
  }
}

/**
 * Lo que se ve mientras el cambio se calcula: dice qué pasa y qué NO cambia («Quito la columna derecha; lo demás queda
 * igual…»). Ningún ajuste pasa por el modelo: todos tardan unos segundos, lo que tarda Python.
 */
export function avisoEnCurso(plan: PlanGuiado, cambio: CambioPlan): string {
  if (cambio.tipo === "agregar-color") return `Añado ${cambio.globo?.nombre ?? colorCliente(cambio.color)} a tus piezas; sus tamaños quedan igual…`;
  if (cambio.tipo === "reemplazar-color") return `Cambio ${colorCliente(cambio.color)} por ${cambio.globo.nombre}; medidas y demás colores quedan igual…`;
  if (cambio.tipo === "quitar-pieza") {
    const estructura = plan.plan.estructuras.find((item) => item.estructura_id === cambio.estructuraId);
    return `Quito ${estructura ? piezaConArticulo(estructura) : "la pieza"}; lo demás queda igual…`;
  }
  return `Calculando: ${describirCambio(plan, cambio)}…`;
}

/**
 * La confirmación del cambio hecho, con lo que se conservó: «Quité la columna derecha; lo demás quedó igual.».
 * `piezasConColor`: las piezas que recibieron el color nuevo (el servidor puede dejar fuera alguna que el catálogo no
 * cubre o que no admite otro color). `nuevo`: el plan que resolvió Python, para decir la cifra que quedó de verdad.
 */
export function confirmacionDelCambio(plan: PlanGuiado, cambio: CambioPlan, piezasConColor?: readonly string[], nuevo?: PlanGuiado): string {
  if (cambio.tipo === "agregar-color") {
    const total = plan.plan.estructuras.length;
    const con = piezasConColor?.length ?? total;
    const donde = con >= total ? "a tus piezas" : `a ${con} de tus ${total} piezas`;
    return `Listo: añadí ${cambio.globo?.nombre ?? colorCliente(cambio.color)} ${donde}; sus tamaños quedaron igual.`;
  }
  if (cambio.tipo === "reemplazar-color") return `Listo: ${cambio.globo.nombre} en lugar de ${colorCliente(cambio.color)}; medidas y demás colores quedaron igual.`;
  if (cambio.tipo === "quitar-pieza") {
    const estructura = plan.plan.estructuras.find((item) => item.estructura_id === cambio.estructuraId);
    return `Listo: quité ${estructura ? piezaConArticulo(estructura) : "la pieza"}; lo demás quedó igual.`;
  }
  if (cambio.tipo === "cantidad" && nuevo) {
    const color = plan.plan.estructuras.find((item) => item.estructura_id === cambio.estructuraId)?.materiales[cambio.indice]?.color ?? "";
    const quedo = globosDeColor(nuevo, cambio.estructuraId, color);
    const pedido = Math.round(cambio.objetivo);
    const pieza = piezaConArticulo(plan.plan.estructuras.find((item) => item.estructura_id === cambio.estructuraId) ?? { estructura_oficial: undefined, nombre: "pieza", repeticiones: 1 });
    const pareja = cambio.pareja ? parejaDe(plan, cambio.estructuraId) : null;
    const tambien = pareja ? ` (y lo mismo en ${piezaConArticulo(pareja)})` : "";
    if (quedo && quedo !== pedido) return `Listo: ${pieza} lleva ${globosDeColorEnTexto(quedo, color)}${tambien}; pediste ${pedido} y al armarla globo a globo quedó así. Los demás colores tomaron la diferencia y la medida no cambió.`;
    return `Listo: ${pieza} lleva ${globosDeColorEnTexto(pedido, color)}${tambien}. Los demás colores tomaron la diferencia y la medida no cambió.`;
  }
  if ((cambio.tipo === "medidas" || cambio.tipo === "tamano") && nuevo) {
    // La medida que quedó de verdad (la pieza se arma globo a globo), no la pedida.
    const estructura = nuevo.plan.estructuras.find((item) => item.estructura_id === cambio.estructuraId);
    const medidas = estructura ? medidasCortas(estructura.medidas) : null;
    const pareja = cambio.pareja ? parejaDe(plan, cambio.estructuraId) : null;
    if (estructura && medidas) return `Listo: ${piezaConArticulo(estructura)} mide ahora ${medidas}${pareja ? ` (y ${piezaConArticulo(pareja)} también)` : ""}; lleva ${globosEnTexto(globosPorMaterial(nuevo, estructura).reduce((suma, valor) => suma + valor, 0))}.`;
  }
  return `Listo: ${describirCambio(plan, cambio)}.`;
}

/** El mensaje del plan en el historial: el resumen de siempre y los últimos ajustes, para que el chat sepa qué hay. */
export function contenidoPlanAjustado(resumen: string, ajustes: readonly string[]): string {
  if (!ajustes.length) return resumen;
  return `${resumen}\nAjusté: ${ajustes.join("; ")}.`.slice(0, 1200);
}

/** «No encontré globos lisos rosados disponibles». */
export function sinGloboLiso(color: string): string {
  return `No encontré globos lisos ${colorEnPlural(colorCliente(color))} disponibles. Prueba con otro color.`;
}
