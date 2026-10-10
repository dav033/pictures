import { avisoDicho, type AvisoUsuario } from "./avisos-usuario";
import type { ProblemaEscena } from "./problemas-escena";

/**
 * **La respuesta final no puede mentir por omisión** (2026-10-09): en la conversación 3d-20261009-103125-92b58a el modelo contestó
 * cuatro veces «Coloqué un centro de mesa sobre cada una de las mesas» / «Confirmado» con las herramientas fallando. Aquí, en el servidor
 * y sin depender de que el modelo quiera decirlo: se juntan los pasos que fallaron y no se rehicieron, y si el texto del modelo no lo
 * admite se le agrega una lista factual «No pude: …». Lo mismo con lo que quedó mal puesto en la escena final. Puro.
 */

/** Lo que la ruta responde cuando la IA no puede atender el pedido (D-023: un «No pude:» en palabras de cliente). */
export const TEXTO_CUOTA_IA = "No pude: la IA no tiene cuota disponible ahora. Inténtalo en un rato.";
export const TEXTO_IA_CAIDA = "No pude: no logré hablar con la IA ahora. Vuelve a intentarlo.";
export const TEXTO_SIN_IA = "No pude: la IA no está configurada en este servidor.";
export const TEXTO_FOTO_NO_CLARA = "No pude: la IA no pudo leer la foto con claridad. Prueba con otra foto o más cercana.";
export const TEXTO_FOTO_NO_LEIDA = "No pude: no logré leer la foto con la IA ahora. Vuelve a intentarlo.";
/** El tope por hora de pedidos a la IA de la escena (la ruta lo dice con su número). */
export const textoTopeHora = (tope: number): string => `No pude: se alcanzó el límite de ${tope} pedidos por hora a la IA de la escena. Inténtalo más tarde.`;

/** `objetivo`: la pieza sobre la que actuó la herramienta (la mesa de un `poner_sobre`), para no dar por resuelta la mesa 1 con un éxito en la mesa 2. */
export type Intento = { herramienta: string; ok: boolean; error?: string; objetivo?: string };
export type FalloPendiente = { herramienta: string; error: string; veces: number };

const MAX_ITEMS = 4;
const MAX_ERROR = 170;

/** Las herramientas del salón no llevan un id de pieza: su objetivo es la zona que tocan o, si no, el salón (la clave de su registro). */
const DEL_SALON: ReadonlySet<string> = new Set(["armar_salon", "ajustar_salon", "mover_zona", "quitar_zona", "planificar_evento"]);

/**
 * La pieza que una llamada toca, de sus argumentos: la estructura o mesa (`padre_id`), el `id` de la pieza o, si pide varias, sus `ids` ordenados (un éxito
 * sobre otras mesas no cancela el fallo de estas). Las herramientas del salón apuntan a su zona o a «salon».
 */
export function objetivoDe(argumentos: unknown, herramienta?: string): string | undefined {
  const a = typeof argumentos === "object" && argumentos !== null ? argumentos as Record<string, unknown> : {};
  if (herramienta && DEL_SALON.has(herramienta)) return typeof a.zona === "string" && a.zona ? `salon:${a.zona}` : "salon";
  for (const clave of ["padre_id", "alrededor_de", "id"]) if (typeof a[clave] === "string" && a[clave]) return a[clave] as string;
  const ids = Array.isArray(a.ids) ? a.ids.filter((x): x is string => typeof x === "string" && x !== "") : [];
  return ids.length ? [...ids].sort().join(",") : undefined;
}

/**
 * Los fallos que quedaron sin resolver, agrupados por herramienta y motivo. Un éxito posterior de la MISMA herramienta sobre el MISMO objetivo
 * (o, si no tiene objetivo, de la misma herramienta) cancela el fallo pendiente más antiguo: el modelo corrigió y reintentó. Más fallos que éxitos
 * dejan el resto pendiente.
 */
export function fallosPendientes(intentos: readonly Intento[]): FalloPendiente[] {
  const pendientes = new Map<string, { herramienta: string; errores: string[] }>();
  for (const i of intentos) {
    const clave = `${i.herramienta}|${i.objetivo ?? ""}`;
    const actual = pendientes.get(clave) ?? { herramienta: i.herramienta, errores: [] };
    if (i.ok) actual.errores.shift(); else actual.errores.push(i.error ?? "sin detalle");
    pendientes.set(clave, actual);
  }
  const porClave = new Map<string, FalloPendiente>();
  for (const { herramienta, errores } of pendientes.values()) {
    for (const e of errores) {
      const error = primeraFrase(e);
      const k = `${herramienta}|${error}`;
      const previo = porClave.get(k);
      if (previo) previo.veces += 1; else porClave.set(k, { herramienta, error, veces: 1 });
    }
  }
  return [...porClave.values()];
}

function primeraFrase(error: string): string {
  const limpia = error.replace(/\s+/g, " ").trim();
  const corte = limpia.search(/[.!?](\s|$)/);
  const frase = corte > 20 ? limpia.slice(0, corte + 1) : limpia;
  return frase.length > MAX_ERROR ? `${frase.slice(0, MAX_ERROR - 1)}…` : frase;
}

/**
 * El texto del modelo ya admite que algo no salió. Con /u y límites de letra de Unicode (`\b` de JS no cuenta las vocales con tilde como letras: «falló»,
 * «logré», «quedó» no se reconocían).
 */
const ADMITE = /(?<!\p{L})(?:no\s+(?:pude|pudo|puedo|logr[ée]|logró|se\s+pudo|fue\s+posible|es\s+posible|alcanc[ée]|qued[óo]|quedaron|sali[óo]|salieron)|fall[óoé]|fallaron|sin\s+[ée]xito)(?!\p{L})/iu;

/** Cómo se dice, a una persona, lo que intentaba cada herramienta (las que no están, con su nombre sin guiones bajos). */
const VERBO: Readonly<Record<string, string>> = {
  poner_sobre: "poner algo sobre una pieza", mover_sobre: "mover una decoración", agregar_mobiliario: "agregar el mobiliario", agregar_pieza: "agregar una pieza",
  cambiar_pieza: "cambiar una pieza", mover_pieza: "mover una pieza", quitar_pieza: "quitar una pieza", duplicar_pieza: "copiar una pieza",
  reemplazar_pieza: "reemplazar una pieza", insertar_de_biblioteca: "poner una idea de la biblioteca", cambiar_sala: "cambiar la sala",
  recolorear_escena: "cambiar colores", ajustar_tamanos: "ajustar tamaños", editar_globos: "cambiar globos",
};
const verboDe = (herramienta: string) => VERBO[herramienta] ?? herramienta.replace(/_/g, " ");

const plural = (n: number) => (n === 1 ? "" : ` (${n} veces)`);

/**
 * La respuesta con lo que falló dicho de frente. Sin fallos ni problemas, igual. Con fallos y un texto que no admite nada, se agrega
 * «No pude: …»; con una decoración que quedó dentro de una mesa y el texto sin mencionarla, «Quedó mal: …». Nunca quita lo que dijo el modelo.
 */
export function conHonestidad(respuesta: string, fallos: readonly FalloPendiente[], problemas: readonly ProblemaEscena[], avisos: readonly AvisoUsuario[] = []): string {
  const partes: string[] = [];
  if (fallos.length && !ADMITE.test(respuesta)) {
    const items = fallos.slice(0, MAX_ITEMS).map((f) => `${verboDe(f.herramienta)}${plural(f.veces)}: ${f.error}`);
    if (fallos.length > MAX_ITEMS) items.push(`y ${fallos.length - MAX_ITEMS} más`);
    partes.push(`No pude: ${items.join(" · ")}`);
  }
  const sinDecir = problemas.filter((p) => !respuesta.includes(p.nodoId));
  if (sinDecir.length) {
    const items = sinDecir.slice(0, MAX_ITEMS).map((p) => primeraFrase(p.texto));
    partes.push(`Quedó mal: ${items.join(" · ")}`);
  }
  const avisosSinDecir = [...new Map(avisos.map((a) => [a.texto, a])).values()].filter((a) => !avisoDicho(respuesta, a)).map((a) => a.texto.length > 320 ? `${a.texto.slice(0, 319)}…` : a.texto).slice(0, MAX_ITEMS);
  if (!partes.length && !avisosSinDecir.length) return respuesta;
  const ojo = partes.length ? `Ojo, no todo salió como se cuenta: ${partes.join(". ")}`.replace(/\.\.$/, ".") : "";
  const aviso = avisosSinDecir.length ? `Aviso: ${avisosSinDecir.join(" · ")}` : "";
  return `${respuesta ? `${respuesta}\n\n` : ""}${[ojo, aviso].filter(Boolean).join("\n\n")}`;
}
