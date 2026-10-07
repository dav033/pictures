/**
 * Las imágenes generadas de la guiada se guardan SOLO en el navegador (IndexedDB), nunca en el servidor (pedido del
 * dueño, 2026-10-07: «que nada se guarde en Vercel sino en el local storage»). Clave = id del mensaje del plan; así una
 * recarga de la página vuelve a mostrar la imagen. Todo tolera fallos: sin IndexedDB (modo privado, cuota llena) la
 * imagen se sigue viendo en esta pestaña y simplemente no sobrevive a la recarga.
 */
const BASE = "demo-decoracion-guiada";
const ALMACEN = "imagenes";
const MAXIMO = 20;

function abrir(): Promise<IDBDatabase> {
  return new Promise((resolver, rechazar) => {
    if (typeof indexedDB === "undefined") { rechazar(new Error("IndexedDB no disponible")); return; }
    const peticion = indexedDB.open(BASE, 1);
    peticion.onupgradeneeded = () => {
      if (!peticion.result.objectStoreNames.contains(ALMACEN)) peticion.result.createObjectStore(ALMACEN);
    };
    peticion.onsuccess = () => resolver(peticion.result);
    peticion.onerror = () => rechazar(peticion.error ?? new Error("No se pudo abrir IndexedDB"));
  });
}

function terminar(transaccion: IDBTransaction): Promise<void> {
  return new Promise((resolver, rechazar) => {
    transaccion.oncomplete = () => resolver();
    transaccion.onerror = () => rechazar(transaccion.error ?? new Error("Transacción fallida"));
    transaccion.onabort = () => rechazar(transaccion.error ?? new Error("Transacción abortada"));
  });
}

type Guardada = { imagen: string; guardada: number };

/** Guarda la imagen (data URL) del mensaje; conserva solo las últimas `MAXIMO`. Devuelve si se guardó. */
export async function guardarImagenNavegador(mensajeId: string, imagen: string): Promise<boolean> {
  try {
    const db = await abrir();
    const todas = await leerTodas(db);
    const transaccion = db.transaction(ALMACEN, "readwrite");
    const almacen = transaccion.objectStore(ALMACEN);
    almacen.put({ imagen, guardada: Date.now() } satisfies Guardada, mensajeId);
    const sobrantes = Object.entries(todas).sort(([, a], [, b]) => b.guardada - a.guardada).slice(MAXIMO - 1);
    for (const [id] of sobrantes) if (id !== mensajeId) almacen.delete(id);
    await terminar(transaccion);
    db.close();
    return true;
  } catch (causa) {
    console.warn("[asistente-guiado] la imagen se ve en esta pestaña, pero no se pudo guardar en el navegador.", causa);
    return false;
  }
}

async function leerTodas(db: IDBDatabase): Promise<Record<string, Guardada>> {
  const transaccion = db.transaction(ALMACEN, "readonly");
  const almacen = transaccion.objectStore(ALMACEN);
  const salida: Record<string, Guardada> = {};
  await new Promise<void>((resolver, rechazar) => {
    const cursor = almacen.openCursor();
    cursor.onsuccess = () => {
      const actual = cursor.result;
      if (!actual) { resolver(); return; }
      const valor = actual.value as Partial<Guardada> | null;
      if (valor && typeof valor.imagen === "string" && valor.imagen.startsWith("data:image/")) {
        salida[String(actual.key)] = { imagen: valor.imagen, guardada: typeof valor.guardada === "number" ? valor.guardada : 0 };
      }
      actual.continue();
    };
    cursor.onerror = () => rechazar(cursor.error ?? new Error("No se pudo leer IndexedDB"));
  });
  return salida;
}

/** Imágenes guardadas, por id de mensaje (vacío si no hay o si IndexedDB no está disponible). */
export async function leerImagenesNavegador(): Promise<Record<string, string>> {
  try {
    const db = await abrir();
    const todas = await leerTodas(db);
    db.close();
    return Object.fromEntries(Object.entries(todas).map(([id, valor]) => [id, valor.imagen]));
  } catch {
    return {};
  }
}

/** «Empezar de nuevo»: borra las imágenes guardadas. */
export async function borrarImagenesNavegador(): Promise<void> {
  try {
    const db = await abrir();
    const transaccion = db.transaction(ALMACEN, "readwrite");
    transaccion.objectStore(ALMACEN).clear();
    await terminar(transaccion);
    db.close();
  } catch {
    // Sin IndexedDB no hay nada que borrar.
  }
}
