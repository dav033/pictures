import type { AvisoUsuario } from "./avisos-usuario";
import type { Escena } from "./escena";
import { armarOrganico } from "./organico";
import { esPiezaOrganica, opcionesDe } from "./organico-ajustes";
import { idsTocados } from "./verificacion-escena";

/**
 * **Avisos de color de lo que acaba de cambiar** (2026-10-08): el motor orgánico no puede poner un color en un tamaño
 * donde no se fabrica (el Reflex Azul no viene en R-9) y usa el más parecido de ese tamaño, pero antes lo callaba. Aquí
 * se arma cada pieza orgánica tocada y se devuelve, para el resumen de la herramienta, lo que el motor avisó que
 * sustituyó, con el remedio (quitar ese tamaño). Puro y sin red.
 */

const ES_DE_COLOR = /no se fabrica|Ningún color/;

function avisosDe(p: Escena["nodos"][number]["pieza"]): string[] {
  if (!esPiezaOrganica(p)) return [];
  try { return armarOrganico(opcionesDe(p)).avisos.filter((a) => ES_DE_COLOR.test(a)); } catch { return []; }
}

/** Los avisos de color nuevos de lo que cambió entre `antes` y `despues` («“Arco”: …»): solo lo que las piezas nuevas o cambiadas no tenían ya. */
function avisosNuevos(antes: Escena, despues: Escena): string[] {
  const t = idsTocados(antes, despues);
  const nuevos: string[] = [];
  for (const id of [...t.nuevos, ...t.cambiados]) {
    const ahora = despues.nodos.find((n) => n.id === id);
    if (!ahora) continue;
    const previos = new Set(antes.nodos.find((n) => n.id === id) ? avisosDe(antes.nodos.find((n) => n.id === id)!.pieza) : []);
    for (const a of avisosDe(ahora.pieza)) if (!previos.has(a)) nuevos.push(`«${ahora.nombre}»: ${a}`);
  }
  return [...new Set(nuevos)];
}

/** El texto para el modelo en el resumen (vacío si no hay nada que avisar). */
export function avisosDeColor(antes: Escena, despues: Escena): string {
  const nuevos = avisosNuevos(antes, despues);
  if (!nuevos.length) return "";
  const formatos = [...new Set(nuevos.flatMap((a) => [...a.matchAll(/ en (R-\d+)/g)].map((m) => m[1]!)))];
  const remedio = formatos.length ? ` Si el usuario quiere solo esos colores, quita ese tamaño (ajustar_tamanos, accion quitar: ${formatos.join(", ")}) o dilo en la respuesta.` : "";
  return `AVISO DE COLOR (el motor puso el más parecido que sí se fabrica en ese tamaño; dilo al usuario): ${nuevos.slice(0, 4).join(" ")}${remedio}`;
}

/** Los mismos avisos como datos para el usuario: la respuesta los da por dichos si dice que no se fabrica / el más parecido, o nombra alguno de sus códigos de color. */
export function avisosDeColorParaElUsuario(antes: Escena, despues: Escena): AvisoUsuario[] {
  return avisosNuevos(antes, despues).slice(0, 4).map((texto) => ({ texto: texto.length > 320 ? `${texto.slice(0, 319)}…` : texto, palabras: ["no se fabrica", "más parecid", "mas parecid", "sustitu", ...(texto.match(/\d{3}/g) ?? [])] }));
}
