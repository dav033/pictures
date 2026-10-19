import type { AmbienteRender } from "@/lib/globos3d/render-ia";

/**
 * Las fotos hechas con IA en el taller, guardadas en ESTE navegador (IndexedDB, no en el servidor): siguen ahí al
 * recargar /3d. IndexedDB y no localStorage porque cada foto pesa 0,5–2 MB y localStorage se llena con ~5 MB.
 * Se guardan las últimas `MAXIMO`; si el navegador no deja (privado, almacenamiento bloqueado) el taller sigue igual
 * y la foto solo vive en la página.
 */
export type ImagenGuardada = { id: number; imagen: string; ambiente: AmbienteRender; escena: string; creada: string };

const BASE = "taller3d";
const ALMACEN = "imagenes-ia";
export const MAXIMO = 40;

function abrir(): Promise<IDBDatabase> {
  return new Promise((resolver, rechazar) => {
    if (typeof indexedDB === "undefined") { rechazar(new Error("Sin IndexedDB")); return; }
    const pedido = indexedDB.open(BASE, 1);
    pedido.onupgradeneeded = () => { if (!pedido.result.objectStoreNames.contains(ALMACEN)) pedido.result.createObjectStore(ALMACEN, { keyPath: "id" }); };
    pedido.onsuccess = () => resolver(pedido.result);
    pedido.onerror = () => rechazar(pedido.error ?? new Error("No se pudo abrir IndexedDB"));
  });
}

function enTransaccion<T>(modo: IDBTransactionMode, hacer: (almacen: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return abrir().then((db) => new Promise<T>((resolver, rechazar) => {
    const tx = db.transaction(ALMACEN, modo);
    const pedido = hacer(tx.objectStore(ALMACEN));
    tx.oncomplete = () => { db.close(); resolver(pedido.result); };
    tx.onerror = tx.onabort = () => { db.close(); rechazar(tx.error ?? new Error("Falló IndexedDB")); };
  }));
}

const esImagen = (v: unknown): v is ImagenGuardada => {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.id === "number" && typeof o.imagen === "string" && o.imagen.startsWith("data:image/") && typeof o.ambiente === "string" && typeof o.escena === "string" && typeof o.creada === "string";
};

/** Todas, de la más nueva a la más vieja; vacío si el navegador no deja leer. */
export async function leerImagenes(): Promise<ImagenGuardada[]> {
  try {
    const todas = await enTransaccion<unknown[]>("readonly", (a) => a.getAll());
    return todas.filter(esImagen).sort((a, b) => b.id - a.id);
  } catch {
    return [];
  }
}

/** Guarda una y borra las que pasen de `MAXIMO`; `false` si el navegador no dejó (lleno o bloqueado). */
export async function guardarImagen(imagen: ImagenGuardada): Promise<boolean> {
  try {
    await enTransaccion("readwrite", (a) => a.put(imagen));
    const sobran = (await leerImagenes()).slice(MAXIMO);
    for (const vieja of sobran) await borrarImagen(vieja.id);
    return true;
  } catch {
    return false;
  }
}

export async function borrarImagen(id: number): Promise<void> {
  try { await enTransaccion("readwrite", (a) => a.delete(id)); } catch { /* sin almacenamiento: nada que borrar */ }
}
