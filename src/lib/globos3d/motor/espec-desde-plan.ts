import { identificarEstructuraOficial, type EstructuraOficialId } from "@/lib/plan/estructuras-oficiales";
import type { EstructuraPlan, PlanDecoracion } from "@/lib/plan/tipos";
import { MAX_PIEZAS_PLAN, recortarCantidades } from "@/lib/plan/piezas-individuales";
import { coloresDeMaterial, coloresDePalabra, colorConPesos, type ColorResuelto, type MaterialDePlan } from "./colores-espec";
import { FORMATOS_REMATE, MAX_COLORES_PIEZA, MAX_PETALOS, MIN_PETALOS, VERSION_ESPEC, type EspecClienteV1, type FloresEspec, type LugarEspec, type OrigenEspec, type PiezaEspec } from "./espec-cliente-v1";
import type { ResultadoEspec } from "./espec-desde-propuesta";
import { UNIDADES_POR_DEFECTO } from "./medidas-espec";

/**
 * **Plan guardado de una idea → espec.** El plan trae las estructuras, medidas, densidad, mezcla y materiales
 * (producto, color, participación) tal como los resolvió Python; aquí se leen sin Python ni modelo: `participacion` pasa
 * a `peso`, `mezcla` a `tamanos`, y los materiales a códigos Sempertex por el título de su producto
 * (`colores-espec.ts`). Lo que el plan guarda y el motor no usa (los mandos del armado de Python, los cambios de
 * variante por talla) está declarado, con su motivo, en `consumo-conversiones.ts`.
 */
export type ProductoDelPlan = MaterialDePlan;
/** De un material del plan (producto y, si lo trae, variante) a lo que dice su título, color y acabado. */
export type ResolverProducto = (material: { product_id: string; variant_id?: string }) => ProductoDelPlan | null;
export type OpcionesEspecDesdePlan = { resolverProducto?: ResolverProducto; origen?: { tipo: Exclude<OrigenEspec, "propuesta">; ideaIds?: string[] } };

const LUGAR_POR_UBICACION: Readonly<Record<string, LugarEspec>> = {
  lateral_izquierdo: "izquierda", lateral_derecho: "derecha", fondo_pared: "fondo", techo: "techo", techo_multipunto: "techo",
  sobre_mesa_principal: "mesa", mesas_invitados: "mesa",
};
const POR_UNIDADES: ReadonlySet<EstructuraOficialId> = new Set<EstructuraOficialId>(["bouquet", "racimo_pared", "centro_mesa"]);
const SUFIJOS = "BCDEFGH";

function oficialDe(estructura: EstructuraPlan): EstructuraOficialId {
  return estructura.estructura_oficial ?? identificarEstructuraOficial({ tipo: estructura.tipo, densidad: estructura.densidad, ubicacion: estructura.ubicacion, nombre: estructura.nombre })?.id ?? "figura";
}

function lugarDe(estructura: EstructuraPlan, copia: number, copias: number): LugarEspec {
  if (copias === 2) return copia === 0 ? "izquierda" : "derecha";
  return LUGAR_POR_UBICACION[estructura.ubicacion] ?? "centro";
}

function coloresDeMateriales(estructura: EstructuraPlan, resolver: ResolverProducto | undefined, avisos: string[]): Array<ColorResuelto & { peso: number }>[] {
  return estructura.materiales.map((material) => {
    const producto = resolver?.({ product_id: material.product_id, ...(material.variant_id ? { variant_id: material.variant_id } : {}) });
    const colores = coloresDeMaterial({ titulo: producto?.titulo, color: material.color ?? producto?.color, acabado: material.acabado ?? producto?.acabado });
    if (!colores.length) avisos.push(`No reconocí el color del material ${material.product_id} de «${estructura.nombre}»: no se usó.`);
    return colores.map((c) => ({ ...c, peso: material.participacion / colores.length }));
  });
}

function floresDe(estructura: EstructuraPlan, resolver: ResolverProducto | undefined, avisos: string[]): FloresEspec | null {
  const flores = estructura.flores;
  if (!flores) return null;
  const codigoDe = (material: { product_id: string; color?: string | undefined }): string | undefined => {
    const producto = resolver?.({ product_id: material.product_id });
    const colores = coloresDeMaterial({ titulo: producto?.titulo, color: material.color ?? producto?.color, acabado: producto?.acabado });
    return (colores[0] ?? coloresDePalabra(material.color ?? "")[0])?.codigo;
  };
  const petalo = codigoDe(flores.petalo);
  if (!petalo) { avisos.push(`No reconocí el color de las flores de «${estructura.nombre}»: se omitieron.`); return null; }
  const centro = flores.centro ? codigoDe(flores.centro) : undefined;
  return { cantidad: flores.cantidad, petalos: Math.min(MAX_PETALOS, Math.max(MIN_PETALOS, flores.petalos ?? MIN_PETALOS)), codigo: petalo, ...(centro ? { centro } : {}) };
}

function remateDe(estructura: EstructuraPlan, porMaterial: ReadonlyArray<ReadonlyArray<ColorResuelto>>, avisos: string[]): PiezaEspec["remate"] {
  const remate = estructura.armado_columna?.remate;
  if (!remate || remate.tipo === "ninguno") return null;
  const formatoId = FORMATOS_REMATE.find((f) => f === `R-${remate.tamano}`);
  const codigo = porMaterial[remate.material]?.[0]?.codigo;
  if (remate.tipo !== "globo" || !formatoId || !codigo) {
    avisos.push(`El remate de «${estructura.nombre}» (${remate.tipo}) no se arma: solo un globo grande arriba.`);
    return null;
  }
  return { formatoId, codigo };
}

/** Los niveles de una columna por capas de cuartetos de R-12 (lo que arma la trenza clásica); otro armado no se traduce. */
function capasDe(estructura: EstructuraPlan, avisos: string[]): number | undefined {
  const armado = estructura.armado_columna;
  if (armado?.modo !== "capas" || !armado.capas.length) return undefined;
  if (armado.capas.some((capa) => capa.tamano !== 12 || capa.materiales.length !== 4)) {
    avisos.push(`Las capas de «${estructura.nombre}» no son todas cuartetos de R-12: la columna se arma por su alto.`);
    return undefined;
  }
  return armado.capas.length;
}

function piezaDe(estructura: EstructuraPlan, copia: number, copias: number, opciones: OpcionesEspecDesdePlan, avisos: string[]): PiezaEspec {
  const oficial = oficialDe(estructura);
  const porMaterial = coloresDeMateriales(estructura, opciones.resolverProducto, avisos);
  const colores = porMaterial.length ? colorConPesos(porMaterial.flat(), MAX_COLORES_PIEZA, avisos) : [];
  const flores = floresDe(estructura, opciones.resolverProducto, avisos);
  const remate = remateDe(estructura, porMaterial, avisos);
  const { ancho_m: anchoM, alto_m: altoM, largo_m: largoM } = estructura.medidas;
  const capas = capasDe(estructura, avisos);
  const unidades = POR_UNIDADES.has(oficial) ? estructura.unidades_declaradas ?? UNIDADES_POR_DEFECTO[oficial] : undefined;
  return {
    id: copia === 0 ? estructura.estructura_id : `${estructura.estructura_id}_${SUFIJOS[copia - 1] ?? "Z"}`,
    oficial,
    nombre: estructura.nombre,
    lugar: lugarDe(estructura, copia, copias),
    medidas: { ...(anchoM ? { anchoM } : {}), ...(altoM ? { altoM } : {}), ...(largoM ? { largoM } : {}) },
    colores: colores.length ? colores : [{ codigo: "005", nombre: "blanco", peso: 1 }],
    tamanos: estructura.mezcla,
    densidad: estructura.densidad,
    ...(estructura.forma ? { forma: estructura.forma } : {}),
    ...(flores ? { flores } : {}),
    ...(remate ? { remate } : {}),
    ...(capas ? { capas } : {}),
    ...(unidades ? { unidades } : {}),
  };
}

export function especDesdePlan(plan: PlanDecoracion, opciones: OpcionesEspecDesdePlan = {}): ResultadoEspec {
  const avisos: string[] = [];
  const { piezas: acotadas, recortadas } = recortarCantidades(plan.estructuras.map((estructura) => ({ estructura, cantidad: estructura.repeticiones })));
  if (recortadas > 0) avisos.push(`El plan lleva como máximo ${MAX_PIEZAS_PLAN} piezas: se quitaron ${recortadas} repeticiones.`);
  const piezas = acotadas.flatMap(({ estructura, cantidad }) => Array.from({ length: cantidad }, (_, copia) => piezaDe(estructura, copia, cantidad, opciones, avisos)));
  const espec: EspecClienteV1 = {
    version: VERSION_ESPEC,
    origen: { tipo: opciones.origen?.tipo ?? "idea", ...(opciones.origen?.ideaIds ? { ideaIds: opciones.origen.ideaIds } : {}) },
    piezas,
  };
  return { espec, avisos: [...new Set(avisos)] };
}
