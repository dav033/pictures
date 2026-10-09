import { medidaTexto, type CambioNodo, type CambioSala, type CampoCambiado, type DiffEscena } from "./diff-escenas";
import type { NodoEscena } from "./escena";
import type { TurnoIA } from "./cuerpo-escena-ia";

/**
 * Los **turnos** de la conversación con la IA del taller (D-021): cada pedido y lo que hizo (respuesta, pasos, qué cambió
 * en la escena, coste, tiempo) como tarjeta. Se guardan con la escena (`guardado-escena.ts`) para que la conversación y sus
 * «Deshacer turno» sobrevivan a recargar. Aquí: el tipo, su lectura desde lo guardado (que se valida: el navegador puede
 * traer cualquier cosa) y lo que se deriva de los turnos (historial para el modelo, tiempo típico). Puro.
 */

export type PasoTurno = { herramienta: string; resumen: string; consulta: boolean };
export type PreguntaTurno = { texto: string; opciones: string[] };
export type EstadoTurno = "aplicado" | "sin_cambios" | "error" | "detenido";
/** Dónde trabajó la IA: `escena` (la entera) o `pieza:<id de la raíz>` (esa pieza en el editor solitario). */
export type AmbitoTurno = string;

export type TurnoPanel = {
  id: string;
  numero: number;
  pedido: string;
  /** «sobre «Columna izquierda»», «escena entera», «con foto»: a qué se refería el pedido. */
  contexto: string;
  ambito: AmbitoTurno;
  /** De qué escena es el turno (cambia al reemplazarla por una plantilla, una sala vacía o una idea de la biblioteca): un turno solo actúa sobre la suya. */
  clave: string;
  foto: boolean;
  respuesta: string;
  pasos: PasoTurno[];
  /** Qué cambió en la escena; `null` si el turno no la tocó (error, detenido). */
  diff: DiffEscena | null;
  pregunta: PreguntaTurno | null;
  costeUsd: number | null;
  ms: number;
  estado: EstadoTurno;
  /** Lo que se le dijo a la persona después (el error, lo que se conservó al deshacer). */
  nota: string | null;
};

/** Cuántos turnos se guardan con la escena y cuánto pueden pesar (el navegador da unos 5 MB para todo). */
export const MAX_TURNOS_GUARDADOS = 20;
const MAX_BYTES_TURNOS = 600_000;

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const texto = (v: unknown): v is string => typeof v === "string";
const numero = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const lista = <T>(v: unknown, esT: (x: unknown) => x is T): v is T[] => Array.isArray(v) && v.every(esT);

/** Lo mínimo para que una pieza guardada se pueda volver a poner en la escena (como `guardado-escena.ts` con la escena). */
function esNodo(v: unknown): v is NodoEscena {
  return esObjeto(v) && texto(v.id) && texto(v.nombre) && esObjeto(v.pieza) && texto(v.pieza.tipo) && esObjeto(v.colocacion) && texto(v.colocacion.en);
}
const esCampo = (v: unknown): v is CampoCambiado => esObjeto(v) && texto(v.clase) && texto(v.etiqueta) && texto(v.antes) && texto(v.despues);
const esSala = (v: unknown) => esObjeto(v) && numero(v.anchoCm) && numero(v.fondoCm) && numero(v.altoCm) && esObjeto(v.tonos) && esObjeto(v.mostrar);

function esCambioNodo(v: unknown): v is CambioNodo {
  if (!esObjeto(v) || !texto(v.id) || !texto(v.nombre) || !(v.tipo === "nueva" || v.tipo === "quitada" || v.tipo === "cambiada")) return false;
  if (!lista(v.campos, esCampo) || !numero(v.globosAntes) || !numero(v.globosDespues) || !numero(v.indice)) return false;
  const antes = v.antes === null || esNodo(v.antes), despues = v.despues === null || esNodo(v.despues);
  return antes && despues && (v.tipo === "nueva" ? v.despues !== null : v.tipo === "quitada" ? v.antes !== null : v.antes !== null && v.despues !== null);
}
const esCambioSala = (v: unknown): v is CambioSala => esObjeto(v) && lista(v.campos, esCampo) && esSala(v.antes) && esSala(v.despues);

function esDiff(v: unknown): v is DiffEscena {
  return esObjeto(v) && lista(v.nodos, esCambioNodo) && (v.sala === null || esCambioSala(v.sala))
    && numero(v.globosAntes) && numero(v.globosDespues);
}
const esPaso = (v: unknown): v is PasoTurno => esObjeto(v) && texto(v.herramienta) && texto(v.resumen) && typeof v.consulta === "boolean";
const esPregunta = (v: unknown): v is PreguntaTurno => esObjeto(v) && texto(v.texto) && lista(v.opciones, texto);
const ESTADOS: readonly EstadoTurno[] = ["aplicado", "sin_cambios", "error", "detenido"];

function esTurno(v: unknown): v is TurnoPanel {
  return esObjeto(v) && texto(v.id) && numero(v.numero) && texto(v.pedido) && texto(v.contexto) && texto(v.ambito) && texto(v.clave)
    && typeof v.foto === "boolean" && texto(v.respuesta) && lista(v.pasos, esPaso) && (v.diff === null || esDiff(v.diff))
    && (v.pregunta === null || esPregunta(v.pregunta)) && (v.costeUsd === null || numero(v.costeUsd)) && numero(v.ms)
    && ESTADOS.includes(v.estado as EstadoTurno) && (v.nota === null || texto(v.nota));
}

/** Los turnos de lo guardado: los que no cuadran se descartan uno a uno (nunca se rompe la escena por la conversación). */
export function leerTurnos(v: unknown): TurnoPanel[] {
  return Array.isArray(v) ? v.filter(esTurno).slice(-MAX_TURNOS_GUARDADOS) : [];
}

/** Los turnos que se guardan: los que hicieron algo, los últimos, y menos aún si pesan demasiado (los más viejos se sueltan primero). */
export function turnosParaGuardar(turnos: readonly TurnoPanel[]): TurnoPanel[] {
  let salida = turnos.filter((t) => t.estado !== "error" && t.estado !== "detenido").slice(-MAX_TURNOS_GUARDADOS);
  while (salida.length > 1 && JSON.stringify(salida).length > MAX_BYTES_TURNOS) salida = salida.slice(1);
  return salida;
}

/** El número del próximo turno (sigue contando aunque los viejos se hayan soltado). */
export const siguienteNumero = (turnos: readonly TurnoPanel[]): number => turnos.reduce((m, t) => Math.max(m, t.numero), 0) + 1;

/** Lo que se le recuerda al modelo de la conversación: los últimos pedidos y lo que contestó. */
export function historialParaModelo(turnos: readonly TurnoPanel[], max = 3): TurnoIA[] {
  return turnos.filter((t) => t.estado !== "error" && t.estado !== "detenido").slice(-max).flatMap((t): TurnoIA[] => [
    { rol: "usuario", texto: t.foto ? `${t.pedido} (con foto)` : t.pedido },
    { rol: "asistente", texto: t.respuesta.slice(0, 1400) },
  ]);
}

/** Cuánto suele tardar la IA, según los turnos que ya hizo: «unos 12 s». `null` mientras no haya ninguno. */
export function tiempoTipico(turnos: readonly TurnoPanel[]): string | null {
  const tiempos = turnos.filter((t) => t.estado === "aplicado" || t.estado === "sin_cambios").map((t) => t.ms).sort((a, b) => a - b);
  const mediana = tiempos[Math.floor(tiempos.length / 2)];
  return mediana === undefined ? null : `unos ${Math.max(1, Math.round(mediana / 1000))} s`;
}

export const segundos = (ms: number): string => `${Math.max(1, Math.round(ms / 1000))} s`;

/** «US$0,003». Cuando es muy poco, no se redondea a cero. */
export function costeTexto(usd: number): string {
  return `US$${usd.toLocaleString("es-CO", { minimumFractionDigits: 2, maximumFractionDigits: usd < 0.01 ? 4 : 3 })}`;
}

/** ¿El turno es de esta escena y de este editor? Solo entonces puede deshacerse, rehacerse o mostrarse «antes». */
export const esDeEstaEscena = (t: Pick<TurnoPanel, "clave" | "ambito">, clave: string, ambito: AmbitoTurno): boolean => t.clave === clave && t.ambito === ambito;

const NOMBRE_HERRAMIENTA: Readonly<Record<string, string>> = {
  ver_escena: "Miró la escena", ver_pieza: "Miró una pieza", buscar_en_escena: "Buscó en la escena", listar_colores: "Miró los colores", contar_globos: "Contó globos",
  seleccionar_grupo: "Eligió un grupo de piezas", usar_preset: "Partió de una escena armada", agregar_pieza: "Agregó una pieza", agregar_del_catalogo: "Agregó del catálogo",
  agregar_mobiliario: "Agregó mobiliario", mover_pieza: "Movió una pieza", girar_pieza: "Giró una pieza", cambiar_pieza: "Cambió una pieza", quitar_pieza: "Quitó una pieza",
  duplicar_pieza: "Copió una pieza", reemplazar_pieza: "Reemplazó una pieza", cambiar_sala: "Cambió la sala", poner_sobre: "Colgó una decoración", mover_sobre: "Movió una decoración",
  separar_copia: "Separó una copia", recolorear_escena: "Cambió colores", ajustar_tamanos: "Ajustó tamaños de globos", editar_globos: "Cambió globos por formato o color",
  buscar_en_biblioteca: "Buscó en la biblioteca", insertar_de_biblioteca: "Puso una idea de la biblioteca", alinear: "Alineó piezas", distribuir: "Repartió piezas",
  espejar: "Espejó piezas", poner_remate: "Puso un globo de remate", pintar_en_malla: "Pintó la malla", preguntar_usuario: "Te hizo una pregunta", modelar_desde_foto: "Armó la escena desde la foto",
  reportar_comparacion: "Comparó con la foto",
};

/** Un paso de la IA en palabras de persona, con las medidas en la misma unidad que el resto de la tarjeta («alto 220 cm» → «alto 2,2 m»). */
export function pasoLegible(p: PasoTurno): string {
  const nombre = NOMBRE_HERRAMIENTA[p.herramienta] ?? `${p.herramienta.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())}`;
  const detalle = p.resumen
    .split("\n")[0]!
    .replace(/(\d+(?:[.,]\d+)?)\s*cm\b/g, (_, n: string) => medidaTexto(Number(n.replace(",", "."))));
  if (!detalle) return nombre;
  return detalle.toLowerCase().startsWith(nombre.toLowerCase()) ? detalle : `${nombre} · ${detalle}`;
}
