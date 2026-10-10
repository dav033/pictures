import { createHash } from "node:crypto";
import type { EntradaCatalogo, Repositorio } from "./repositorio";

/**
 * La **huella del contenido** de un repositorio (REQ-013, AC-12) y su lock (`repositorios/<id>/lock.json`: versión, huella e
 * historial; el manifiesto lee de ahí su versión). Solo para pruebas y scripts (usa node:crypto).
 *
 * Qué cubre: lo que el repositorio OFRECE, de sus datos de origen: por cada entrada, en orden, su id local, clase, nombre,
 * descripción y procedencia; en un item de la biblioteca, su tipo, ocasiones y fuente; en lo demás, el JSON de su carga (un
 * formato, un color, un producto, un plan guardado, una entrada de `FONDOS_CATALOGO` sin sus funciones).
 * Qué NO cubre, a propósito: la escena o la pieza que arma cada item (`contenido`) ni los sólidos de un mueble. Son salida del
 * motor y del compilador de lecturas: un arreglo del motor cambiaría la huella de Sempertex sin que cambie lo que el repositorio
 * ofrece. Esa forma la vigilan `test-armado-escena-dorado` y `test-catalogo-dorado`, y el texto buscable de cada item, el `hash`
 * de sus fichas del RAG.
 */

export type LockRepositorio = { version: string; huella: string; historial: ReadonlyArray<{ version: string; nota: string }> };

function datosDeEntrada(e: EntradaCatalogo): string {
  if (e.clase !== "item-biblioteca") return JSON.stringify(e.dato);
  const item = e.dato;
  return JSON.stringify({ tipo: item.tipo, ocasiones: item.ocasiones, fuente: item.fuente ?? null });
}

export function huellaRepositorio(repositorio: Repositorio): string {
  const hash = createHash("sha256");
  for (const e of repositorio.entradas()) hash.update(`${e.idLocal}\t${e.clase}\t${e.nombre}\t${e.descripcion}\t${JSON.stringify(e.procedencia)}\t${datosDeEntrada(e)}\n`);
  return hash.digest("hex");
}

/** El lock con una huella nueva: el mismo si no cambió; si cambió, sube el parche de la versión y el historial suma su línea. */
export function lockActualizado(lock: LockRepositorio, huella: string, nota: string): LockRepositorio {
  if (lock.huella === huella) return lock;
  const [mayor, menor, parche] = lock.version.split(".").map(Number);
  const version = `${mayor}.${menor}.${parche + 1}`;
  return { version, huella, historial: [...lock.historial, { version, nota }] };
}
