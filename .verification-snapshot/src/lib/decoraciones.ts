import "server-only";
import type { DatabaseSync } from "node:sqlite";
import { getDb } from "./db";
import { borrarImagen, nuevoId } from "./store";
import type { Decoracion } from "./types";

type FilaDecoracion = {
  id: string;
  nombre: string;
  descripcion: string | null;
  imagen: string;
};

function elementosDe(db: DatabaseSync, decoracionId: string): string[] {
  const filas = db
    .prepare("SELECT producto_id FROM decoracion_elementos WHERE decoracion_id = ?")
    .all(decoracionId) as unknown as { producto_id: string }[];
  return filas.map((f) => f.producto_id);
}

function filaADecoracion(db: DatabaseSync, fila: FilaDecoracion): Decoracion {
  return {
    id: fila.id,
    nombre: fila.nombre,
    descripcion: fila.descripcion ?? undefined,
    imagen: fila.imagen,
    elementos: elementosDe(db, fila.id),
  };
}

function reemplazarElementos(db: DatabaseSync, decoracionId: string, productoIds: string[]): void {
  db.prepare("DELETE FROM decoracion_elementos WHERE decoracion_id = ?").run(decoracionId);
  const insertar = db.prepare(
    "INSERT INTO decoracion_elementos (decoracion_id, producto_id) VALUES (?, ?)",
  );
  for (const productoId of productoIds) insertar.run(decoracionId, productoId);
}

export function obtenerDecoraciones(): Decoracion[] {
  const db = getDb();
  const filas = db
    .prepare("SELECT * FROM decoraciones ORDER BY rowid")
    .all() as unknown as FilaDecoracion[];
  return filas.map((fila) => filaADecoracion(db, fila));
}

export function crearDecoracion(datos: Omit<Decoracion, "id">): Decoracion {
  const db = getDb();
  const decoracion: Decoracion = { ...datos, id: nuevoId() };
  db.prepare(
    "INSERT INTO decoraciones (id, nombre, descripcion, imagen) VALUES (?, ?, ?, ?)",
  ).run(decoracion.id, decoracion.nombre, decoracion.descripcion ?? null, decoracion.imagen);
  reemplazarElementos(db, decoracion.id, decoracion.elementos);
  return decoracion;
}

export function actualizarDecoracion(
  id: string,
  cambios: Partial<Omit<Decoracion, "id">>,
): Decoracion {
  const db = getDb();
  const fila = db.prepare("SELECT * FROM decoraciones WHERE id = ?").get(id) as unknown as
    | FilaDecoracion
    | undefined;
  if (!fila) throw new Error("Decoración no encontrada.");

  if (cambios.imagen && cambios.imagen !== fila.imagen) {
    borrarImagen(fila.imagen);
  }

  const nombre = cambios.nombre ?? fila.nombre;
  const descripcion = "descripcion" in cambios ? (cambios.descripcion ?? null) : fila.descripcion;
  const imagen = cambios.imagen ?? fila.imagen;

  db.prepare("UPDATE decoraciones SET nombre = ?, descripcion = ?, imagen = ? WHERE id = ?").run(
    nombre,
    descripcion,
    imagen,
    id,
  );

  if (cambios.elementos) reemplazarElementos(db, id, cambios.elementos);

  return filaADecoracion(db, { id, nombre, descripcion, imagen });
}

export function eliminarDecoracion(id: string): void {
  const db = getDb();
  const fila = db.prepare("SELECT imagen FROM decoraciones WHERE id = ?").get(id) as unknown as
    | { imagen: string }
    | undefined;
  // ON DELETE CASCADE limpia decoracion_elementos automáticamente.
  db.prepare("DELETE FROM decoraciones WHERE id = ?").run(id);
  if (fila) borrarImagen(fila.imagen);
}
