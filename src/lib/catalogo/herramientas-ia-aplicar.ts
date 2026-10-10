import type { Escena } from "@/lib/globos3d/escena";
import { aplicarHerramientaAsincrona, BUSQUEDA_IA, type DependenciasBibliotecaIA, type HechoAsincrono } from "@/lib/globos3d/escena-ia-biblioteca";
import { aplicarHerramienta } from "@/lib/globos3d/herramientas-escena";
import type { EntradaBusqueda, RespuestaBusquedaTaller } from "@/lib/taller/buscar";
import { ASIGNACION_FONDOS, GENERADORES_MOBILIARIO, idCortoDeFondo } from "./asignacion-fondos";
import { herramientaDeclarada, parsearRepositorio, type PoliticaIA } from "./herramientas-ia";
import { parsearIdCatalogo, repositorioDeIdLocal } from "./indice";

/**
 * **Aplicar las herramientas de la IA de escena con la política del catálogo** (REQ-013 fase 4). `herramientas-ia.ts` decide qué se
 * declara; aquí el servidor no se fía de eso: una herramienta que no se declara o un mueble de un repositorio oculto se rechazan
 * aunque el modelo los nombre. Con la política por defecto es `aplicarHerramientaAsincrona` tal cual, salvo que
 * `insertar_de_biblioteca` entiende también el id calificado (`sempertex:idea:x`).
 * - `buscar_en_biblioteca` con `repositorio` (solo con `CATALOGO_FILTRO_IA`): la misma búsqueda acotada a ese repositorio;
 * - `insertar_de_biblioteca` con un id de mobiliario o escenografía que la búsqueda ve: lo pone como `agregar_mobiliario`.
 */

const INSERTAR = "insertar_de_biblioteca";
const MOBILIARIO = "agregar_mobiliario";

export type DependenciasAplicarIA = {
  /** La búsqueda ya con la visibilidad del RAG (`buscarVisible`). */
  buscar: (entrada: EntradaBusqueda) => Promise<RespuestaBusquedaTaller>;
  /** Por defecto `TALLER_RAG_ENABLED`. */
  habilitado?: DependenciasBibliotecaIA["habilitado"];
};

type Argumentos = Readonly<Record<string, unknown>>;
const comoObjeto = (valor: unknown): Argumentos | null => (typeof valor === "object" && valor !== null && !Array.isArray(valor) ? (valor as Argumentos) : null);
const fallo = (escena: Escena, error: string): HechoAsincrono => ({ resultado: { ok: false, escena, error }, busqueda: null });

/** El motivo por el que la política no deja aplicar esta herramienta con estos argumentos, o `null`. */
function rechazo(nombre: string, argumentos: Argumentos | null, politica: PoliticaIA): string | null {
  if (!herramientaDeclarada(politica, nombre)) return `La herramienta «${nombre}» no está disponible: el repositorio de ese mobiliario no está habilitado para la IA del taller.`;
  if (nombre !== MOBILIARIO || typeof argumentos?.id !== "string") return null;
  const id = idCortoDeFondo(argumentos.id);
  const repositorio = id === null ? undefined : ASIGNACION_FONDOS.get(id);
  return id !== null && repositorio && !politica.ia.includes(repositorio) ? `«${id}» no está disponible: el repositorio «${repositorio}» no está habilitado para la IA del taller.` : null;
}

async function buscarEnRepositorio(escena: Escena, argumentos: Argumentos | null, original: unknown, politica: PoliticaIA, deps: DependenciasAplicarIA): Promise<HechoAsincrono> {
  if (!politica.filtro || !argumentos || !("repositorio" in argumentos)) return aplicarHerramientaAsincrona(escena, BUSQUEDA_IA, original, deps);
  const { repositorio: pedido, ...resto } = argumentos;
  const elegido = parsearRepositorio(pedido, politica.busqueda);
  if (!elegido.ok) return fallo(escena, elegido.error);
  const hecho = await aplicarHerramientaAsincrona(escena, BUSQUEDA_IA, resto, {
    ...deps,
    buscar: (entrada) => deps.buscar({ ...entrada, filtros: { ...entrada.filtros, repositorios: [elegido.repositorio] } }),
  });
  // La memoria solo conoce la biblioteca de Sempertex: si la base no respondió, devolver eso como si fuera de otro repositorio sería mentir.
  // Pero un error (argumentos que no valen, un color que no existe) es de la petición y no de la base: ese se devuelve tal cual.
  if (elegido.repositorio !== "sempertex" && hecho.busqueda?.fuente !== "rag" && hecho.resultado.ok) {
    return fallo(escena, `No pude buscar en «${elegido.repositorio}»: esa búsqueda necesita la base de datos de la biblioteca y no respondió. Si ya sabes qué mueble o fondo es, ponlo con agregar_mobiliario.`);
  }
  return hecho;
}

const CAMPOS_DE_DONDE = ["x_cm", "z_cm", "giro_grados", "a_lo_largo_cm", "altura_cm"] as const;

/** Un item de mobiliario o escenografía se pone con `agregar_mobiliario`: el mismo id y, de `donde`, lo que esa herramienta entiende. */
function comoMobiliario(escena: Escena, idLocal: string, argumentos: Argumentos, tipo: "mobiliario" | "escenografia"): HechoAsincrono {
  if ((GENERADORES_MOBILIARIO as readonly string[]).includes(idLocal)) return fallo(escena, `«${idLocal}» no es una pieza sino el generador de mesas y sillas a medida: usa agregar_mesas.`);
  const donde = comoObjeto(argumentos.donde);
  const nombre = typeof argumentos.nombre === "string" ? { nombre: argumentos.nombre } : {};
  if (donde && ((donde.en !== undefined && donde.en !== "piso" && donde.en !== "pared") || (donde.pared !== undefined && donde.pared !== "fondo"))) {
    return fallo(escena, `«${idLocal}» es ${tipo === "mobiliario" ? "mobiliario" : "escenografía"}: va en el piso o en la pared del fondo (donde.en = piso o pared), no en el techo ni colgada de otra pieza.`);
  }
  const lugar = Object.fromEntries(CAMPOS_DE_DONDE.flatMap((campo) => (typeof donde?.[campo] === "number" ? [[campo, donde[campo]]] : [])));
  return { resultado: aplicarHerramienta(escena, MOBILIARIO, { id: idLocal, ...nombre, ...lugar }), busqueda: null };
}

async function insertarDelCatalogo(escena: Escena, argumentos: Argumentos | null, original: unknown, politica: PoliticaIA, deps: DependenciasAplicarIA): Promise<HechoAsincrono> {
  const parseado = typeof argumentos?.id === "string" ? parsearIdCatalogo(argumentos.id.trim()) : null;
  // Un id calificado con el repositorio equivocado (`escenografia:silla_tiffany`) o de algo que ese repositorio no tiene es un id desconocido.
  if (!argumentos || !parseado || "error" in parseado || repositorioDeIdLocal(parseado.idLocal) !== parseado.repositorio) return aplicarHerramientaAsincrona(escena, INSERTAR, original, deps);
  if (parseado.repositorio === "sempertex") return aplicarHerramientaAsincrona(escena, INSERTAR, parseado.forma === "calificada" ? { ...argumentos, id: parseado.idLocal } : original, deps);
  // Un mueble que la búsqueda no puede mostrar tampoco se inserta: el error es el de siempre («no hay ningún item»).
  if ((parseado.repositorio !== "mobiliario" && parseado.repositorio !== "escenografia") || !politica.busqueda.includes(parseado.repositorio)) return aplicarHerramientaAsincrona(escena, INSERTAR, original, deps);
  return comoMobiliario(escena, parseado.idLocal, argumentos, parseado.repositorio);
}

export async function aplicarHerramientaIA(escena: Escena, nombre: string, argumentos: unknown, politica: PoliticaIA, deps: DependenciasAplicarIA): Promise<HechoAsincrono> {
  const objeto = comoObjeto(argumentos);
  const cerrado = rechazo(nombre, objeto, politica);
  if (cerrado) return fallo(escena, cerrado);
  if (nombre === BUSQUEDA_IA) return buscarEnRepositorio(escena, objeto, argumentos, politica, deps);
  if (nombre === INSERTAR) return insertarDelCatalogo(escena, objeto, argumentos, politica, deps);
  return aplicarHerramientaAsincrona(escena, nombre, argumentos, deps);
}
