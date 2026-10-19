import { TALLER_RAG_ENABLED } from "@/lib/ia/nucleo/feature-flags";
import { buscarEnTaller, type EntradaBusqueda, type FiltrosTaller, type RespuestaBusquedaTaller, type ResultadoTaller } from "@/lib/taller/buscar";
import { clasificacionDe } from "@/lib/taller/clasificacion-biblioteca";
import { celebracionPorId, idsCelebracionCanonicos, OCASION_GENERAL, tematicaPorId } from "@/lib/taller/taxonomia-celebraciones";
import { interpretarTerminos } from "./glosario-taller";
import type { Escena } from "./escena";
import { ESQUEMA_BUSCAR_EN_BIBLIOTECA, aplicarHerramienta, type ResultadoHerramienta } from "./herramientas-escena";
import { codigosDePedido } from "./herramientas-escena-colores";
import { TIPO_DE_FUENTE, celebracionesDePedido, tematicasDePedido } from "./herramientas-escena-biblioteca-filtros";

/**
 * `buscar_en_biblioteca` de la IA del taller 3D con la búsqueda de la biblioteca en Postgres (REQ-002 paso 6).
 * `aplicarHerramienta` es síncrona (la usan las pruebas y otros que llaman): la ruta `/api/escena-ia` pasa por
 * `aplicarHerramientaAsincrona`, que solo atiende esta herramienta y solo con `TALLER_RAG_ENABLED`; todo lo demás, y
 * cualquier problema (argumentos que no valen, la búsqueda falla o responde desde memoria), lo resuelve la herramienta
 * de siempre, así que con la bandera apagada el comportamiento es el de antes.
 */

export const BUSQUEDA_IA = "buscar_en_biblioteca";
/** Tope de líneas que ve el modelo (el resultado va en su contexto en cada vuelta). */
const MAX_RESULTADOS_IA = 10;
const LIMITE_POR_DEFECTO_IA = 8;
/** «Alto aproximado»: se buscan los items de ±25 % de lo pedido. */
const TOLERANCIA_MEDIDA = 0.25;

type Argumentos = ReturnType<typeof ESQUEMA_BUSCAR_EN_BIBLIOTECA.parse>;

export type DependenciasBibliotecaIA = {
  /** Por defecto `TALLER_RAG_ENABLED`. */
  habilitado?: boolean;
  /** Por defecto `buscarEnTaller`. */
  buscar?: (entrada: EntradaBusqueda) => Promise<RespuestaBusquedaTaller>;
};

/** Lo que queda en el registro de una búsqueda: quién respondió, qué se preguntó y qué salió. */
export type RegistroBusquedaIA = { fuente: "rag" | "memoria"; ids: string[]; entrada: EntradaBusqueda | null; avisos: string[]; motivo?: string };

export type HechoAsincrono = { resultado: ResultadoHerramienta; busqueda: RegistroBusquedaIA | null };

// ----------------------------------------------------------------------------------------------------------
// Argumentos del modelo → filtros de la base
// ----------------------------------------------------------------------------------------------------------

const unicos = (xs: readonly string[]) => [...new Set(xs)];

/** Los argumentos del modelo como entrada de `buscarEnTaller`; `null` si algún color no existe (lo explica la herramienta de siempre). */
export function entradaDeBusqueda(a: Argumentos): { entrada: EntradaBusqueda; notas: string[] } | null {
  const notas: string[] = [];
  const palabras: string[] = a.texto ? [a.texto] : [];
  const filtros: FiltrosTaller = {};

  if (a.tipo) filtros.tipos = [a.tipo];
  if (a.tipo_pieza) filtros.tiposPieza = [a.tipo_pieza];
  if (a.fuente) filtros.fuente = [TIPO_DE_FUENTE[a.fuente]];

  const celebraciones = unicos([
    ...(a.ocasion && a.ocasion !== OCASION_GENERAL ? idsCelebracionCanonicos(a.ocasion) : []),
    ...(a.celebracion ? celebracionesDePedido(a.celebracion) : []),
  ]);
  if (celebraciones.length) filtros.celebraciones = celebraciones;
  else if (a.celebracion) { palabras.push(a.celebracion); notas.push(`celebración «${a.celebracion}» sin id conocido: se buscó como palabra`); }

  const tematicas = a.tematica ? tematicasDePedido(a.tematica) : [];
  if (tematicas.length) filtros.tematicas = tematicas;
  else if (a.tematica) { palabras.push(a.tematica); notas.push(`temática «${a.tematica}» sin id conocido: se buscó como palabra`); }

  if (a.colores?.length) {
    const codigos = a.colores.map(codigosDePedido);
    if (codigos.some((c) => !c.length)) return null;
    filtros.colores = unicos(codigos.flat());
  }

  // El glosario separa los formatos exactos («R-24») de las familias («LOL-*») y las partes; lo que no entiende va como palabra.
  if (a.formato) {
    const exactos = interpretarTerminos(a.formato).formatos.filter((f) => !f.includes("*"));
    if (exactos.length) filtros.formatos = exactos;
    else { palabras.push(a.formato); notas.push(`formato «${a.formato}» sin id exacto: se buscó como palabra`); }
  }
  if (a.parte) {
    const partes = interpretarTerminos(a.parte).partes;
    if (partes.length) filtros.partes = partes;
    else { palabras.push(a.parte); notas.push(`parte «${a.parte}» sin parte conocida: se buscó como palabra`); }
  }
  if (a.alto_cm !== undefined) { filtros.altoMin = Math.round(a.alto_cm * (1 - TOLERANCIA_MEDIDA)); filtros.altoMax = Math.round(a.alto_cm * (1 + TOLERANCIA_MEDIDA)); }
  if (a.ancho_cm !== undefined) { filtros.anchoMin = Math.round(a.ancho_cm * (1 - TOLERANCIA_MEDIDA)); filtros.anchoMax = Math.round(a.ancho_cm * (1 + TOLERANCIA_MEDIDA)); }

  const texto = palabras.join(" ").trim();
  return { entrada: { ...(texto ? { texto } : {}), filtros, limite: Math.min(a.limite ?? LIMITE_POR_DEFECTO_IA, MAX_RESULTADOS_IA) }, notas };
}

// ----------------------------------------------------------------------------------------------------------
// Resultados de la base → texto para el modelo
// ----------------------------------------------------------------------------------------------------------

const corto = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

function medidasDe(m: ResultadoTaller["medidas"]): string {
  const partes = [m.altoCm !== null ? `alto ${Math.round(m.altoCm)}` : null, m.anchoCm !== null ? `ancho ${Math.round(m.anchoCm)}` : null, m.fondoCm !== null ? `fondo ${Math.round(m.fondoCm)}` : null].filter(Boolean);
  return partes.length ? `${partes.join(" × ")} cm` : "";
}

/** Una línea por item: id, tipo, nombre, celebración y temática principales, medidas y por qué salió. */
export function describirResultado(r: ResultadoTaller): string {
  const clase = clasificacionDe(r.id);
  const celebracion = clase?.celebraciones[0] ?? r.celebraciones[0];
  const tematica = clase?.tematicas[0] ?? r.tematicas[0];
  const campos = [
    r.id, r.tipo, `«${r.nombre}»`,
    celebracion ? `celebración: ${celebracionPorId(celebracion)?.nombre ?? celebracion}` : "",
    tematica ? `temática: ${tematicaPorId(tematica)?.nombre ?? tematica}` : "",
    medidasDe(r.medidas),
    r.razones[0] ? `salió porque: ${corto(r.razones[0], 90)}` : "",
  ];
  return `- ${campos.filter(Boolean).join(" · ")}`;
}

function resumenDeRag(resp: RespuestaBusquedaTaller, entrada: EntradaBusqueda, notas: readonly string[]): string {
  const f = entrada.filtros ?? {};
  const aplicados = (Object.entries(f) as Array<[string, unknown]>).filter(([, v]) => (Array.isArray(v) ? v.length : v !== undefined)).map(([k, v]) => `${k}=${Array.isArray(v) ? v.join("|") : String(v)}`);
  const pie = [...notas, ...resp.avisos];
  if (!resp.resultados.length) {
    return `No hay nada en la biblioteca con eso (filtros: ${aplicados.join(", ") || "ninguno"}): prueba sin los filtros de formato, parte o medidas, con menos palabras o con otro tipo.${pie.length ? ` (${pie.join("; ")})` : ""}`;
  }
  const lineas = resp.resultados.slice(0, MAX_RESULTADOS_IA).map(describirResultado);
  return `${lineas.length} de la biblioteca (ponlo con insertar_de_biblioteca y su id):\n${lineas.join("\n")}${pie.length ? `\n(${pie.join("; ")})` : ""}`;
}

// ----------------------------------------------------------------------------------------------------------
// Entrada principal
// ----------------------------------------------------------------------------------------------------------

const idsDeResumen = (resumen: string) => [...resumen.matchAll(/^- (\S+) ·/gm)].map((m) => m[1]!);

/** La herramienta de siempre (en memoria), con el motivo en el registro cuando se llegó aquí por una búsqueda con base de datos. */
function enMemoria(escena: Escena, argumentos: unknown, entrada: EntradaBusqueda | null, motivo?: string): HechoAsincrono {
  const resultado = aplicarHerramienta(escena, BUSQUEDA_IA, argumentos);
  return { resultado, busqueda: { fuente: "memoria", ids: resultado.ok ? idsDeResumen(resultado.resumen) : [], entrada, avisos: [], ...(motivo ? { motivo } : {}) } };
}

/**
 * Como `aplicarHerramienta`, pero `buscar_en_biblioteca` usa la búsqueda de la biblioteca con la bandera encendida.
 * `busqueda` va al registro (`null` si la herramienta no era esa o la bandera está apagada).
 */
export async function aplicarHerramientaAsincrona(escena: Escena, nombre: string, argumentos: unknown, dependencias: DependenciasBibliotecaIA = {}): Promise<HechoAsincrono> {
  if (nombre !== BUSQUEDA_IA || !(dependencias.habilitado ?? TALLER_RAG_ENABLED)) return { resultado: aplicarHerramienta(escena, nombre, argumentos), busqueda: null };

  const validados = ESQUEMA_BUSCAR_EN_BIBLIOTECA.safeParse(argumentos ?? {});
  if (!validados.success) return enMemoria(escena, argumentos, null, "argumentos inválidos");
  const armada = entradaDeBusqueda(validados.data);
  if (!armada) return enMemoria(escena, argumentos, null, "color desconocido");

  let respuesta: RespuestaBusquedaTaller;
  try {
    respuesta = await (dependencias.buscar ?? buscarEnTaller)(armada.entrada);
  } catch (error) {
    return enMemoria(escena, argumentos, armada.entrada, `la búsqueda falló: ${corto(error instanceof Error ? error.message : String(error), 200)}`);
  }
  if (respuesta.fuente !== "rag") return enMemoria(escena, argumentos, armada.entrada, respuesta.avisos[0] ?? "la base respondió desde memoria");
  return {
    resultado: { ok: true, escena, consulta: true, resumen: resumenDeRag(respuesta, armada.entrada, armada.notas) },
    busqueda: { fuente: "rag", ids: respuesta.ids, entrada: armada.entrada, avisos: respuesta.avisos },
  };
}
