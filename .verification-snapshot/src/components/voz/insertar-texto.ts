export type Seleccion = { inicio: number; fin: number };

export type Insercion = { valor: string; cursor: number };

/** ¿Hace falta un espacio entre este carácter y el texto dictado? No, si no hay carácter, ya es un espacio o es una apertura. */
const necesitaEspacioAntes = (anterior: string | undefined) => anterior !== undefined && !/[\s(¿¡«“"'\[]/.test(anterior);
const necesitaEspacioDespues = (siguiente: string | undefined) => siguiente !== undefined && !/[\s.,;:!?)»”"'\]]/.test(siguiente);

/**
 * Pone `dictado` en `valor` donde está la selección (reemplazándola) con los espacios justos a cada lado; sin selección
 * (`null`: el campo nunca tuvo el foco) lo añade al final. Respeta `maxLength` recortando el dictado, no lo ya escrito.
 * Devuelve el texto nuevo y dónde queda el cursor: justo después de lo dictado.
 */
export function insertarEnCursor(valor: string, dictado: string, seleccion: Seleccion | null, maxLength?: number): Insercion {
  const limpio = dictado.trim().replace(/\s+/g, " ");
  if (!limpio) return { valor, cursor: seleccion?.fin ?? valor.length };
  const inicio = seleccion ? Math.min(seleccion.inicio, seleccion.fin, valor.length) : valor.length;
  const fin = seleccion ? Math.min(Math.max(seleccion.inicio, seleccion.fin), valor.length) : valor.length;
  const antes = valor.slice(0, inicio);
  const despues = valor.slice(fin);
  const conAntes = necesitaEspacioAntes(antes.at(-1)) ? ` ${limpio}` : limpio;
  const relleno = necesitaEspacioDespues(despues[0]) ? " " : "";
  let nuevo = `${antes}${conAntes}${relleno}`;
  if (maxLength !== undefined && maxLength > 0 && nuevo.length + despues.length > maxLength) {
    nuevo = nuevo.slice(0, Math.max(antes.length, maxLength - despues.length));
  }
  return { valor: `${nuevo}${despues}`, cursor: nuevo.length };
}
