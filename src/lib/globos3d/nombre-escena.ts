import type { Escena } from "./escena";
import { muebleDeMesa, muebleDeNodo } from "./descripcion-mobiliario";
import { ESCENAS_PREDEFINIDAS } from "./escenas-presets";
import type { TipoPieza } from "./piezas";

/**
 * **El nombre de la escena sigue a la escena** (2026-10-09): al abrir /3d la escena se llama como su plantilla («Arco orgánico, columnas y
 * guirnalda») y seguía llamándose así cuando la IA la rehacía con 6 mesas, 24 sillas y un arco con letrero, así que el pie de la foto
 * realista decía el nombre de la plantilla. Aquí: qué nombres son «de partida» (los que puso el taller, no la persona), cómo se
 * describe una escena en pocas palabras y qué nombre toma una escena que cambió. Un nombre que escribió la persona nunca se toca. Puro.
 */

const NOMBRES_GENERICOS: readonly string[] = ["Mi escena", "Escena nueva"];

/** ¿El nombre es uno que puso el taller (una plantilla o el genérico) y no uno que escribió la persona? */
export const esNombreDePartida = (nombre: string): boolean => NOMBRES_GENERICOS.includes(nombre) || ESCENAS_PREDEFINIDAS.some((p) => p.nombre === nombre);

const ESTRUCTURAS: Readonly<Partial<Record<TipoPieza, readonly [string, string]>>> = {
  columna: ["columna", "columnas"], arco: ["arco", "arcos"], arco_organico: ["arco orgánico", "arcos orgánicos"], organico: ["pieza orgánica", "piezas orgánicas"],
  guirnalda: ["guirnalda", "guirnaldas"], pared_malla: ["pared de globos", "paredes de globos"], pared_trenzas: ["pared de trenzas", "paredes de trenzas"],
  forma: ["forma de globos", "formas de globos"], letras: ["letras de globos", "letras de globos"], metalizado: ["globo metalizado", "globos metalizados"],
  arbol_globos: ["árbol de globos", "árboles de globos"], mural: ["mural", "murales"], techo: ["techo de globos", "techos de globos"],
};

const cuenta = (n: number, [uno, varios]: readonly [string, string]) => `${n} ${n === 1 ? uno : varios}`;
const MAX_PARTES = 3;

const NOMBRES_AUTOMATICOS = [...Object.values(ESTRUCTURAS).flatMap((v) => (v ? [...v] : [])), "mesa", "mesas"];
const PARTE_AUTOMATICA = new RegExp(String.raw`^\d+ (?:${NOMBRES_AUTOMATICOS.join("|")})(?: con \d+ sillas?)?(?: y \d+ centros?)?$|^\d+ sillas?$`, "i");

/**
 * ¿El nombre lo armó `nombreSegunEscena` (y no la persona)? Sin esto, tras el primer turno de la IA el nombre dejaba de ser «de partida» y los turnos
 * siguientes (o «Deshacer turno») ya no lo seguían: la escena volvía a salir con el nombre de la plantilla o con el de otra escena.
 */
export const esNombreAutomatico = (nombre: string): boolean => nombre !== "" && nombre.split(", ").every((parte) => PARTE_AUTOMATICA.test(parte));

/** La escena en pocas palabras, por lo que tiene: «6 mesas con 24 sillas y 6 centros, 1 arco orgánico». «Escena nueva» si está vacía. */
export function nombreSegunEscena(escena: Escena): string {
  const mesas = escena.nodos.filter((n) => muebleDeMesa(n) !== null).length;
  const sillas = escena.nodos.reduce((s, n) => s + (muebleDeNodo(n)?.asientos ?? 0), 0);
  const centros = escena.nodos.filter((n) => n.colocacion.en === "sobre" && n.colocacion.encima === true).length;
  const partes: string[] = [];
  if (mesas) partes.push(`${cuenta(mesas, ["mesa", "mesas"])}${sillas ? ` con ${cuenta(sillas, ["silla", "sillas"])}` : ""}${centros ? ` y ${cuenta(centros, ["centro", "centros"])}` : ""}`);
  else if (sillas) partes.push(cuenta(sillas, ["silla", "sillas"]));
  const porTipo = new Map<TipoPieza, number>();
  for (const n of escena.nodos) if (ESTRUCTURAS[n.pieza.tipo]) porTipo.set(n.pieza.tipo, (porTipo.get(n.pieza.tipo) ?? 0) + 1);
  for (const [tipo, n] of [...porTipo].sort((a, b) => b[1] - a[1])) partes.push(cuenta(n, ESTRUCTURAS[tipo]!));
  if (!partes.length) return escena.nodos.length ? "Mi escena" : "Escena nueva";
  const texto = partes.slice(0, MAX_PARTES).join(", ");
  return texto[0]!.toUpperCase() + texto.slice(1);
}

/** El nombre que sigue a una escena nueva: el de la persona se queda; uno de partida pasa a describir la escena. */
export const nombreQueSigue = (actual: string, escena: Escena): string => (esNombreDePartida(actual) || esNombreAutomatico(actual) ? nombreSegunEscena(escena) : actual);

/**
 * El nombre para el pie de la foto: el que tiene la escena, salvo que sea el de una plantilla y la escena ya no sea esa plantilla
 * (la persona la cambió a mano), en cuyo caso se describe lo que hay.
 */
export function nombreParaFoto(nombre: string, escena: Escena): string {
  const plantilla = ESCENAS_PREDEFINIDAS.find((p) => p.nombre === nombre);
  if (plantilla) return JSON.stringify(plantilla.escena) === JSON.stringify(escena) ? nombre : nombreSegunEscena(escena);
  return nombre === "Mi escena" || esNombreAutomatico(nombre) ? nombreSegunEscena(escena) : nombre;
}
