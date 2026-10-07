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
import { HEX_COLORES_V2, PALETA_COLORES_V2 } from "@/lib/rag/taxonomy/v2";
import type { CandidatoDelServidor, ColorCatalogo } from "@/components/plan/ajuste/ajuste-propuesta";
import { colorCliente, colorEnPlural, conMayuscula } from "../formato";

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
/** Paso de «Achicar» / «Agrandar», en metros. */
export const PASO_TAMANO_M = 0.5;
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
};

const LineaSchema = z.object({
  product_id: z.string(),
  variant_id: z.string(),
  color: z.string().nullish(),
  unidades: z.number().nonnegative(),
  acabado: z.string().nullish(),
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

export function hexDeColor(color: string): string {
  if (color.startsWith("#")) return color;
  return HEX_COLORES_V2[normal(color) as keyof typeof HEX_COLORES_V2] ?? "#9ca3af";
}

export function etiquetaColor(color: string): string {
  return conMayuscula(colorCliente(color));
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

/** El paso siguiente de una medida dentro de su rango, o null si ya está en el borde. */
function conPaso(valor: number, direccion: 1 | -1, minimo: number, maximo: number): number | null {
  const siguiente = Math.min(maximo, Math.max(minimo, Math.round((valor + direccion * PASO_TAMANO_M) * 100) / 100));
  return Math.abs(siguiente - valor) < 0.01 ? null : siguiente;
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
    const colores = estructura.materiales.map((material, indice): ColorPieza => {
      const color = material.color ?? "otro color";
      return {
        indice,
        color,
        etiqueta: etiquetaColor(color),
        fondo: hexDeColor(color),
        globos: globos[indice] ?? 0,
        porcentaje: porcentajes[indice] ?? 0,
        puedeMas: edicionProtagonismo(plan, estructura.estructura_id, indice, 1) !== null,
        puedeMenos: edicionProtagonismo(plan, estructura.estructura_id, indice, -1) !== null,
        puedeQuitar: edicionQuitarColor(plan, estructura.estructura_id, indice) !== null,
      };
    });
    const medidas = medidasCortas(estructura.medidas);
    const agrandar = edicionTamano(plan, estructura.estructura_id, 1) !== null;
    const achicar = edicionTamano(plan, estructura.estructura_id, -1) !== null;
    return {
      estructuraId: estructura.estructura_id,
      titulo: `${estructura.repeticiones > 1 ? `${estructura.repeticiones} × ` : ""}${estructura.nombre}`,
      conArticulo: piezaConArticulo(estructura),
      modoColores: modo,
      motivoFijo: motivo,
      colores,
      tamano: medidas && (agrandar || achicar) ? { texto: medidas, puedeAgrandar: agrandar, puedeAchicar: achicar } : null,
      puedeQuitarPieza: planSinPieza(plan.plan, estructura.estructura_id) !== null,
    };
  });
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

/** «Agrandar» (1) o «Achicar» (-1) medio metro: en el armado si un motor la cuenta, en sus medidas si no. */
export function edicionTamano(plan: PlanGuiado, estructuraId: string, direccion: 1 | -1): EdicionPlan | null {
  const estructura = plan.plan.estructuras.find((item) => item.estructura_id === estructuraId);
  if (!estructura) return null;
  const motor = motorDe(estructura);
  if (motor) {
    switch (motor.tipo) {
      case "arco_organico": {
        const ancho = conPaso(motor.armado.forma.anchoM, direccion, 1.5, 10);
        const alto = conPaso(motor.armado.forma.altoM, direccion, 1, 6);
        if (ancho === null && alto === null) return null;
        return edicionDeArmado(estructuraId, { tipo: motor.tipo, armado: { ...motor.armado, forma: { ...motor.armado.forma, anchoM: ancho ?? motor.armado.forma.anchoM, altoM: alto ?? motor.armado.forma.altoM } } });
      }
      case "columna_organica": {
        const alto = conPaso(motor.armado.forma.altoM, direccion, 0.5, 6);
        return alto === null ? null : edicionDeArmado(estructuraId, { tipo: motor.tipo, armado: { ...motor.armado, forma: { ...motor.armado.forma, altoM: alto } } });
      }
      case "guirnalda_organica": {
        const largo = conPaso(motor.armado.forma.largoM, direccion, 0.8, 10);
        return largo === null ? null : edicionDeArmado(estructuraId, { tipo: motor.tipo, armado: { ...motor.armado, forma: { ...motor.armado.forma, largoM: largo } } });
      }
      case "arco": {
        const geometria = motor.armado.geometria;
        const ancho = conPaso(geometria.anchoM, direccion, 0.8, 10);
        // El arco «semi» deduce el alto del ancho.
        const alto = geometria.forma === "semi" ? null : conPaso(geometria.altoM, direccion, 0.8, 6);
        if (ancho === null && alto === null) return null;
        return edicionDeArmado(estructuraId, { tipo: "arco", armado: { ...motor.armado, geometria: { ...geometria, anchoM: ancho ?? geometria.anchoM, altoM: alto ?? geometria.altoM } } });
      }
      case "columna": {
        const alto = conPaso(motor.armado.cuerpo.alto_m, direccion, 0.5, 6);
        return alto === null ? null : edicionDeArmado(estructuraId, { tipo: "columna", armado: { ...motor.armado, cuerpo: { ...motor.armado.cuerpo, alto_m: alto } } });
      }
    }
  }
  // Un bouquet no se mide en metros.
  if (estructura.armado_bouquet || estructura.estructura_oficial === "bouquet") return null;
  const medidas: { ancho_m?: number; alto_m?: number; largo_m?: number } = {};
  for (const campo of ["ancho_m", "alto_m", "largo_m"] as const) {
    const actual = estructura.medidas[campo];
    if (actual === undefined) continue;
    const siguiente = conPaso(actual, direccion, 0.5, 100);
    if (siguiente !== null) medidas[campo] = siguiente;
  }
  return Object.keys(medidas).length ? { accion: "propiedades", estructura_id: estructuraId, medidas } : null;
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

/** Un toque del panel. `agregar-color` es del plan entero; los demás, de una pieza. */
export type CambioPlan =
  | { tipo: "protagonismo"; estructuraId: string; indice: number; direccion: 1 | -1 }
  | { tipo: "tamano"; estructuraId: string; direccion: 1 | -1 }
  | { tipo: "quitar-color"; estructuraId: string; indice: number }
  | { tipo: "agregar-color"; color: string }
  | { tipo: "quitar-pieza"; estructuraId: string };

/** El cambio toca todas las piezas (añadir un color): todas esperan el plan nuevo. Los demás tocan una sola. */
export function cambiaTodasLasPiezas(cambio: CambioPlan): boolean {
  return cambio.tipo === "agregar-color";
}

/** La pieza que toca el cambio, o null si es del plan entero. */
export function piezaDelCambio(cambio: CambioPlan): string | null {
  return cambio.tipo === "agregar-color" ? null : cambio.estructuraId;
}

/**
 * «más rosado en el semiarco orgánico», «sin la columna»: la línea corta del historial («Ajusté: …») y de los avisos.
 * Sin verbo en primera persona, para que se lea igual en «Listo: …» y en «Último ajuste: …».
 */
export function describirCambio(plan: PlanGuiado, cambio: CambioPlan): string {
  if (cambio.tipo === "agregar-color") return `con ${colorCliente(cambio.color)}`;
  const estructura = plan.plan.estructuras.find((item) => item.estructura_id === cambio.estructuraId);
  const pieza = estructura ? piezaConArticulo(estructura) : "la pieza";
  const colorDe = (indice: number) => colorCliente(estructura?.materiales[indice]?.color ?? "ese color");
  switch (cambio.tipo) {
    case "protagonismo": return `${cambio.direccion > 0 ? "más" : "menos"} ${colorDe(cambio.indice)} en ${pieza}`;
    case "tamano": return `${pieza} ${cambio.direccion > 0 ? ((estructura?.repeticiones ?? 1) > 1 ? "más grandes" : "más grande") : "de menor tamaño"}`;
    case "quitar-color": return `sin ${colorDe(cambio.indice)} en ${pieza}`;
    case "quitar-pieza": return `sin ${pieza}`;
  }
}

/**
 * Lo que se ve mientras el cambio se calcula: dice qué pasa y qué NO cambia («Quito la columna derecha; lo demás queda
 * igual…»). Ningún ajuste pasa por el modelo: todos tardan unos segundos, lo que tarda Python.
 */
export function avisoEnCurso(plan: PlanGuiado, cambio: CambioPlan): string {
  if (cambio.tipo === "agregar-color") return `Añado ${colorCliente(cambio.color)} a tus piezas; sus tamaños quedan igual…`;
  if (cambio.tipo === "quitar-pieza") {
    const estructura = plan.plan.estructuras.find((item) => item.estructura_id === cambio.estructuraId);
    return `Quito ${estructura ? piezaConArticulo(estructura) : "la pieza"}; lo demás queda igual…`;
  }
  return `Calculando: ${describirCambio(plan, cambio)}…`;
}

/**
 * La confirmación del cambio hecho, con lo que se conservó: «Quité la columna derecha; lo demás quedó igual.».
 * `piezasConColor`: las piezas que recibieron el color nuevo (el servidor puede dejar fuera alguna que el catálogo no
 * cubre o que no admite otro color).
 */
export function confirmacionDelCambio(plan: PlanGuiado, cambio: CambioPlan, piezasConColor?: readonly string[]): string {
  if (cambio.tipo === "agregar-color") {
    const total = plan.plan.estructuras.length;
    const con = piezasConColor?.length ?? total;
    const donde = con >= total ? "a tus piezas" : `a ${con} de tus ${total} piezas`;
    return `Listo: añadí ${colorCliente(cambio.color)} ${donde}; sus tamaños quedaron igual.`;
  }
  if (cambio.tipo === "quitar-pieza") {
    const estructura = plan.plan.estructuras.find((item) => item.estructura_id === cambio.estructuraId);
    return `Listo: quité ${estructura ? piezaConArticulo(estructura) : "la pieza"}; lo demás quedó igual.`;
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
