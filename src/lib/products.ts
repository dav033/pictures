import "server-only";
import { aProducto, variantesPorIds } from "./shopify/consultas";
import { filtrarProductos, seleccionarProductos } from "./catalog-data";
import { getDb } from "./db";
import { borrarImagen, nuevoId } from "./store";
import type { Categoria, Producto } from "./types";

type FilaProducto = {
  id: string;
  nombre: string;
  categoria: Categoria;
  descripcion: string;
  precio: number;
  estilos: string;
  colores: string;
  emoji: string | null;
  tono: string | null;
  foto: string | null;
};

function filaAProducto(fila: FilaProducto): Producto {
  return {
    id: fila.id,
    nombre: fila.nombre,
    categoria: fila.categoria,
    descripcion: fila.descripcion,
    precio: fila.precio,
    estilos: JSON.parse(fila.estilos),
    colores: JSON.parse(fila.colores),
    emoji: fila.emoji ?? undefined,
    tono: fila.tono ?? undefined,
    foto: fila.foto ?? undefined,
  };
}

export function obtenerProductos(): Producto[] {
  const filas = getDb()
    .prepare("SELECT * FROM productos ORDER BY rowid")
    .all() as unknown as FilaProducto[];
  return filas.map(filaAProducto);
}

export function buscarProductos(filtros: Parameters<typeof filtrarProductos>[1]): Producto[] {
  return filtrarProductos(obtenerProductos(), filtros);
}

/**
 * Resuelve ids tanto del catálogo curado a mano (tabla `productos`) como del
 * catálogo real de Shopify (`shopify_variante`), en el orden en que llegaron
 * — necesario porque el chat puede recomendar piezas de las dos fuentes en
 * la misma conversación y la selección del cliente las mezcla sin distinguir
 * de dónde salió cada una.
 */
export function productosPorId(ids: string[]): Producto[] {
  const delCatalogoMock = seleccionarProductos(obtenerProductos(), ids);
  const idsResueltos = new Set(delCatalogoMock.map((p) => p.id));
  const idsRestantes = ids.filter((id) => !idsResueltos.has(id));

  const deShopify = idsRestantes.length
    ? variantesPorIds(idsRestantes).map(aProducto)
    : [];
  const porId = new Map([...delCatalogoMock, ...deShopify].map((p) => [p.id, p]));

  return ids.map((id) => porId.get(id)).filter((p): p is Producto => Boolean(p));
}

export function crearProducto(datos: Omit<Producto, "id">): Producto {
  const producto: Producto = { ...datos, id: nuevoId() };
  getDb()
    .prepare(
      `INSERT INTO productos (id, nombre, categoria, descripcion, precio, estilos, colores, emoji, tono, foto)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      producto.id,
      producto.nombre,
      producto.categoria,
      producto.descripcion,
      producto.precio,
      JSON.stringify(producto.estilos),
      JSON.stringify(producto.colores),
      producto.emoji ?? null,
      producto.tono ?? null,
      producto.foto ?? null,
    );
  return producto;
}

export function actualizarProducto(
  id: string,
  cambios: Partial<Omit<Producto, "id">>,
): Producto {
  const db = getDb();
  const fila = db.prepare("SELECT * FROM productos WHERE id = ?").get(id) as unknown as
    | FilaProducto
    | undefined;
  if (!fila) throw new Error("Producto no encontrado.");

  const previo = filaAProducto(fila);
  if (cambios.foto && previo.foto && cambios.foto !== previo.foto) {
    borrarImagen(previo.foto);
  }

  const actualizado: Producto = { ...previo, ...cambios, id };
  db.prepare(
    `UPDATE productos
     SET nombre = ?, categoria = ?, descripcion = ?, precio = ?, estilos = ?, colores = ?, emoji = ?, tono = ?, foto = ?
     WHERE id = ?`,
  ).run(
    actualizado.nombre,
    actualizado.categoria,
    actualizado.descripcion,
    actualizado.precio,
    JSON.stringify(actualizado.estilos),
    JSON.stringify(actualizado.colores),
    actualizado.emoji ?? null,
    actualizado.tono ?? null,
    actualizado.foto ?? null,
    id,
  );
  return actualizado;
}

export function eliminarProducto(id: string): void {
  const db = getDb();
  const fila = db.prepare("SELECT foto FROM productos WHERE id = ?").get(id) as unknown as
    | { foto: string | null }
    | undefined;
  // ON DELETE CASCADE limpia decoracion_elementos automáticamente.
  db.prepare("DELETE FROM productos WHERE id = ?").run(id);
  if (fila?.foto) borrarImagen(fila.foto);
}

export function eliminarTodosLosProductos(): void {
  const db = getDb();
  const filas = db
    .prepare("SELECT foto FROM productos WHERE foto IS NOT NULL")
    .all() as unknown as { foto: string }[];
  // ON DELETE CASCADE limpia decoracion_elementos de todas las decoraciones.
  db.prepare("DELETE FROM productos").run();
  for (const fila of filas) borrarImagen(fila.foto);
}
