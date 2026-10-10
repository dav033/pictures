import type { DetalleIdea } from "@/lib/biblioteca-sempertex/detalle-idea-esquema";
import type { DecoracionSempertex } from "@/lib/biblioteca-sempertex/esquemas";
import type { ItemBiblioteca } from "@/lib/globos3d/biblioteca";
import type { FormatoGlobo } from "@/lib/globos3d/formatos";
import type { LIMITES_MESA, TipoMesa, TipoSilla } from "@/lib/globos3d/mobiliario-conjunto-tipos";
import type { FondoFijo, MuebleCatalogo } from "@/lib/globos3d/mobiliario-tipos";
import type { Modulo } from "@/lib/globos3d/modulos";
import type { ProductoCatalogo } from "@/lib/globos3d/utileria-catalogo";
import type { PlanIdeaGuardado } from "@/lib/plan/plan-de-idea";
import type { ReferenciaSempertex } from "@/lib/plan/referencia-sempertex";
import type { ClaseEntrada, IdRepositorio, ManifiestoRepositorio, Procedencia } from "./tipos";

/**
 * El contrato de un **repositorio de catálogo** y de sus entradas (REQ-013, SPEC §4.1–4.2). Aparte de `tipos.ts` porque la carga
 * de cada clase son tipos del motor y de la biblioteca guiada, y `tipos.ts` es hoja (regla R8). Solo tipos.
 */

/** Los generadores de mobiliario (REQ-012): qué tipos arman y sus límites. */
export type GeneradorMobiliario =
  | { id: "mesa_param"; tipos: readonly TipoMesa[]; limites: typeof LIMITES_MESA }
  | { id: "sillas_param"; tipos: readonly TipoSilla[]; maxPorMesa: number };

/** Una idea de la biblioteca guiada: su plan guardado (`planes-ideas.json`) y su detalle (`detalles-ideas.json`), si los tiene. */
export type PlanDeIdea = { idIdea: string; plan: PlanIdeaGuardado | null; detalle: DetalleIdea | null };

export type DatoDeClase = {
  "item-biblioteca": ItemBiblioteca;
  formato: FormatoGlobo;
  color: ReferenciaSempertex;
  "producto-tienda": ProductoCatalogo;
  "plan-idea": PlanDeIdea;
  "decoracion-guiada": DecoracionSempertex;
  modulo: Modulo;
  mueble: MuebleCatalogo;
  "mueble-fijo": FondoFijo;
  generador: GeneradorMobiliario;
  fondo: FondoFijo;
  decorado: MuebleCatalogo;
};

/** Una entrada: `dato` (y `descripcion`) se calculan al pedirlos (D-001), el resto se lee sin armar nada. */
export type EntradaCatalogo<C extends ClaseEntrada = ClaseEntrada> = {
  [K in C]: {
    /** Calificado: `${repositorio}:${idLocal}`. */
    id: string;
    /** El id de siempre, congelado: el que se guarda. */
    idLocal: string;
    repositorio: IdRepositorio;
    clase: K;
    nombre: string;
    descripcion: string;
    procedencia: Procedencia;
    dato: DatoDeClase[K];
  };
}[C];

export type Repositorio = {
  manifiesto: ManifiestoRepositorio;
  /** Perezoso: importar no arma ninguna entrada (D-001). En el orden de hoy (R3). */
  entradas(): readonly EntradaCatalogo[];
  porIdLocal(idLocal: string): EntradaCatalogo | undefined;
};
