import { z } from "zod";
import { paraGoogleSchema } from "@/lib/ia/nucleo/esquema-google";
import { featureEnabled } from "@/lib/ia/nucleo/feature-flags";
import { FONDOS_CATALOGO } from "@/lib/globos3d/fondos-escenografia";
import { ESQUEMA_BUSCAR_EN_BIBLIOTECA, type DeclaracionHerramienta } from "@/lib/globos3d/herramientas-escena";
import { campoRepositorio } from "@/lib/globos3d/herramientas-escena-biblioteca-filtros";
import { esquemaMobiliarioPara } from "@/lib/globos3d/herramientas-escena-mobiliario";
import { HERRAMIENTAS_MESAS } from "@/lib/globos3d/herramientas-escena-mesas";
import { ASIGNACION_FONDOS, type RepositorioDeFondos } from "./asignacion-fondos";
import { esIdRepositorio } from "./ids";
import type { IdRepositorio } from "./tipos";
import { reposVisiblesVigentes } from "./visibilidad";

/**
 * **El catálogo en las herramientas de la IA de escena** (REQ-013 fase 4): qué declara la IA según los repositorios que ve. La
 * política: `ia_taller` dice qué repositorios puede tocar y `rag` cuáles devuelve la búsqueda; la IA solo busca en los dos
 * (`busqueda`). Las declaraciones por defecto —todo visible, sin `CATALOGO_FILTRO_IA`— son `DECLARACIONES_ESCENA` tal cual, la
 * misma lista: ni un byte de diferencia. Solo cuando la política difiere se arman las que cambian, y se guardan por conjunto de
 * visibles (no se recalculan en cada petición).
 * - `CATALOGO_FILTRO_IA`: `buscar_en_biblioteca` declara `repositorio`, un **texto** (no una enumeración: a Gemini le quedan pocos
 *   valores de enumeración, `test-esquema-gemini`) cuya descripción lista los visibles; el servidor lo valida (`parsearRepositorio`).
 * - `agregar_mobiliario` lista solo los muebles y fondos de los repositorios que ve la IA (mismo orden); sin ninguno, no se declara.
 * - Las herramientas de mesas (`agregar_mesas`, `cambiar_sillas`, `cambiar_mesas`) son del repositorio de mobiliario: sin él, no se declaran.
 * Aplicar la herramienta con esa misma política está en `herramientas-ia-aplicar.ts`.
 */

export type PoliticaIA = {
  /** `CATALOGO_FILTRO_IA`: `buscar_en_biblioteca` lleva el parámetro `repositorio`. */
  filtro: boolean;
  /** Los repositorios que la IA de escena puede tocar (`reposVisibles("ia_taller")`). */
  ia: readonly IdRepositorio[];
  /** Donde puede buscar e insertar: los que ve la IA y además devuelve el RAG (`reposVisibles("rag")`). */
  busqueda: readonly IdRepositorio[];
};

/** La política a partir de las dos visibilidades y la bandera, sin leer nada (las pruebas la arman a mano). */
export function politicaDe(entradas: { filtro: boolean; ia: readonly IdRepositorio[]; rag: readonly IdRepositorio[] }): PoliticaIA {
  return { filtro: entradas.filtro, ia: entradas.ia, busqueda: entradas.ia.filter((id) => entradas.rag.includes(id)) };
}

/** La política de ahora (filas de `ajustes_runtime`, variables y manifiestos). Una por petición. */
export async function politicaIA(): Promise<PoliticaIA> {
  const [ia, rag] = await Promise.all([reposVisiblesVigentes("ia_taller"), reposVisiblesVigentes("rag")]);
  return politicaDe({ filtro: featureEnabled("CATALOGO_FILTRO_IA"), ia, rag });
}

// ----------------------------------------------------------------------------------------------------------
// El parámetro `repositorio`
// ----------------------------------------------------------------------------------------------------------

export type RepositorioPedido = { ok: true; repositorio: IdRepositorio } | { ok: false; error: string };

/** El repositorio que pidió el modelo, si es uno de los visibles para buscar; si no, un error que lista los que sí. */
export function parsearRepositorio(valor: unknown, visibles: readonly IdRepositorio[]): RepositorioPedido {
  const lista = visibles.join(", ");
  const texto = typeof valor === "string" ? valor.trim().toLowerCase() : "";
  if (!texto || !esIdRepositorio(texto)) return { ok: false, error: `«${typeof valor === "string" ? valor : String(valor)}» no es un repositorio del catálogo. Los de esta búsqueda: ${lista || "ninguno"}.` };
  if (!visibles.includes(texto)) return { ok: false, error: `El repositorio «${texto}» no está disponible para esta búsqueda. Los de esta búsqueda: ${lista || "ninguno"}.` };
  return { ok: true, repositorio: texto };
}

// ----------------------------------------------------------------------------------------------------------
// Las declaraciones
// ----------------------------------------------------------------------------------------------------------

const REPOSITORIOS_DE_FONDOS: readonly RepositorioDeFondos[] = ["mobiliario", "escenografia"];
const HERRAMIENTAS_DE_MESAS: readonly string[] = Object.keys(HERRAMIENTAS_MESAS);
const BUSCAR = "buscar_en_biblioteca";
const MOBILIARIO = "agregar_mobiliario";

/** Lo que una política cambia de las declaraciones: los parámetros nuevos de unas y las que no se declaran. */
type Cambios = { parametros: ReadonlyMap<string, Record<string, unknown>>; quitadas: ReadonlySet<string> };
const SIN_CAMBIOS: Cambios = { parametros: new Map(), quitadas: new Set() };

const parametrosDe = (esquema: z.ZodType) => paraGoogleSchema(z.toJSONSchema(esquema, { target: "draft-7" })) as Record<string, unknown>;

/** Los fondos y muebles de `FONDOS_CATALOGO` que ve la IA, en su orden. Uno sin repositorio asignado no se ofrece (falla cerrado). */
const fondosDeLaIA = (ia: readonly IdRepositorio[]) => FONDOS_CATALOGO.filter((f) => {
  const repositorio = ASIGNACION_FONDOS.get(f.id);
  return repositorio !== undefined && ia.includes(repositorio);
});

function calcularCambios(politica: PoliticaIA): Cambios {
  const parametros = new Map<string, Record<string, unknown>>();
  const quitadas = new Set<string>();

  const fondos = fondosDeLaIA(politica.ia);
  if (!fondos.length) quitadas.add(MOBILIARIO);
  else if (fondos.length < FONDOS_CATALOGO.length) parametros.set(MOBILIARIO, parametrosDe(esquemaMobiliarioPara(fondos)));
  if (!politica.ia.includes("mobiliario")) for (const nombre of HERRAMIENTAS_DE_MESAS) quitadas.add(nombre);

  if (politica.filtro && politica.busqueda.length) parametros.set(BUSCAR, parametrosDe(ESQUEMA_BUSCAR_EN_BIBLIOTECA.extend({ repositorio: campoRepositorio(politica.busqueda) })));
  return { parametros, quitadas };
}

/** Lo único de la política que cambia las declaraciones: dos políticas con las mismas declaraciones comparten el cálculo. */
const claveDe = (politica: PoliticaIA) => [
  politica.filtro && politica.busqueda.length ? politica.busqueda.join(",") : "-",
  REPOSITORIOS_DE_FONDOS.filter((id) => politica.ia.includes(id)).join(","),
].join("|");
const CLAVE_POR_DEFECTO = claveDe(politicaDe({ filtro: false, ia: REPOSITORIOS_DE_FONDOS, rag: [] }));

const memoria = new Map<string, Cambios>();
function cambiosDe(politica: PoliticaIA): Cambios {
  const clave = claveDe(politica);
  if (clave === CLAVE_POR_DEFECTO) return SIN_CAMBIOS;
  let cambios = memoria.get(clave);
  if (!cambios) { cambios = calcularCambios(politica); memoria.set(clave, cambios); }
  return cambios;
}

/**
 * Las declaraciones que recibe la IA de escena con esta política. Con la política por defecto devuelve `base` (la misma lista, sin
 * copiar); si no, `base` con `buscar_en_biblioteca` y `agregar_mobiliario` rehechos y las herramientas ocultas quitadas, en el mismo
 * orden. `base` puede ser cualquier subconjunto de `DECLARACIONES_ESCENA` (el refinado declara menos).
 */
export function declaracionesIA(base: readonly DeclaracionHerramienta[], politica: PoliticaIA): readonly DeclaracionHerramienta[] {
  const cambios = cambiosDe(politica);
  if (cambios === SIN_CAMBIOS) return base;
  const { parametros, quitadas } = cambios;
  return base.filter((d) => !quitadas.has(d.name)).map((d) => { const nuevos = parametros.get(d.name); return nuevos ? { ...d, parametersJsonSchema: nuevos } : d; });
}

/** ¿Declara esta política la herramienta? (Una que no se declara tampoco se aplica: `herramientas-ia-aplicar.ts`.) */
export const herramientaDeclarada = (politica: PoliticaIA, nombre: string): boolean => !cambiosDe(politica).quitadas.has(nombre);

/**
 * La frase que se suma a las reglas del sistema de la IA de escena cuando la `buscar_en_biblioteca` que recibe declara `repositorio` y
 * hay otro repositorio que Sempertex donde buscar: sin ella el modelo no sabe cuándo usarlo. Con la política por defecto (o en una
 * ronda que no declara la búsqueda) es `""`: el prompt es el de siempre, byte a byte.
 */
export function reglaCatalogoIA(politica: PoliticaIA, declaraciones: readonly DeclaracionHerramienta[]): string {
  const propiedades = (declaraciones.find((d) => d.name === BUSCAR)?.parametersJsonSchema.properties ?? {}) as Record<string, unknown>;
  if (!politica.filtro || !politica.busqueda.some((id) => id !== "sempertex") || !("repositorio" in propiedades)) return "";
  return `\n\nCATÁLOGO: si el pedido es de mobiliario (sillas, mesas, sofás) o de escenografía (paneles, cortinas, aros, pedestales, pastel), o si los resultados de buscar_en_biblioteca mezclan tipos, pásale repositorio (${politica.busqueda.join(", ")}) para buscar solo ahí; sin repositorio busca en todos.`;
}
