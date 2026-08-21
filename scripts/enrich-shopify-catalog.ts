import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { enriquecerDescripcion } from "../src/lib/shopify/enriquecer-descripcion";
import type { ProductoPublico } from "../src/lib/shopify/tipos";

const INPUT_PREDETERMINADO = path.join("data", "raw", "shopify-products.snapshot.json");
const OUTPUT_PREDETERMINADO = path.join("data", "processed", "shopify-products.enriched.json");
const URL_TIENDA = "https://sempertex.com";

type Snapshot = {
  productos?: ProductoPublico[];
  products?: ProductoPublico[];
};

function argumento(nombre: string, predeterminado?: string): string | undefined {
  const indice = process.argv.indexOf(nombre);
  return indice >= 0 ? process.argv[indice + 1] : predeterminado;
}

function leerProductos(ruta: string): ProductoPublico[] {
  if (!existsSync(ruta)) throw new Error(`No existe archivo de entrada: ${ruta}`);
  const contenido = JSON.parse(readFileSync(ruta, "utf-8")) as Snapshot | ProductoPublico[];
  const productos = Array.isArray(contenido)
    ? contenido
    : contenido.productos ?? contenido.products ?? [];
  if (productos.length === 0) throw new Error("Archivo no contiene productos.");
  return productos;
}

function hash(texto: string | null): string | null {
  return texto ? createHash("sha256").update(texto, "utf-8").digest("hex") : null;
}

function actualizarSqlite(rutaDb: string, productos: ReturnType<typeof enriquecerProductos>): number {
  if (!existsSync(rutaDb)) throw new Error(`No existe base SQLite: ${rutaDb}`);
  const db = new DatabaseSync(rutaDb);
  const columnas = db.prepare("PRAGMA table_info(shopify_producto)").all() as Array<{ name: string }>;
  if (columnas.length === 0) throw new Error("Base SQLite no contiene tabla shopify_producto.");
  if (!columnas.some((columna) => columna.name === "descripcion_datos")) {
    db.exec("ALTER TABLE shopify_producto ADD COLUMN descripcion_datos TEXT NOT NULL DEFAULT '{}'");
  }

  const actualizar = db.prepare(
    "UPDATE shopify_producto SET descripcion_txt = ?, descripcion_datos = ? WHERE id = ?",
  );
  let actualizados = 0;
  db.exec("BEGIN");
  try {
    for (const producto of productos) {
      const resultado = actualizar.run(
        producto.descripcion.textoCompleto,
        JSON.stringify(producto.descripcion),
        producto.id,
      );
      actualizados += Number(resultado.changes);
    }
    db.exec("DELETE FROM shopify_fts");
    db.exec(`
      INSERT INTO shopify_fts (id, titulo_limpio, descripcion_txt, tags, colores, ocasiones)
      SELECT id, titulo_limpio, COALESCE(descripcion_txt, ''), tags, colores, ocasiones
      FROM shopify_producto
    `);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.close();
  }
  return actualizados;
}

function enriquecerProductos(productos: ProductoPublico[]) {
  return productos.map((producto) => ({
    id: String(producto.id),
    handle: producto.handle,
    titulo: producto.title,
    tipo: producto.product_type ?? null,
    tags: producto.tags ?? [],
    urlFuente: `${URL_TIENDA}/products/${producto.handle}.js`,
    actualizadoEn: producto.updated_at ?? null,
    hashDescripcionFuente: hash(producto.body_html),
    descripcion: enriquecerDescripcion(producto.body_html),
  }));
}

function main() {
  const entrada = path.resolve(argumento("--input", INPUT_PREDETERMINADO)!);
  const salida = path.resolve(argumento("--output", OUTPUT_PREDETERMINADO)!);
  const baseDatos = argumento("--database");
  const filtroHandles = argumento("--handles")
    ?.split(",")
    .map((handle) => handle.trim())
    .filter(Boolean);

  const productosCrudos = leerProductos(entrada);
  const seleccionados = filtroHandles?.length
    ? productosCrudos.filter((producto) => filtroHandles.includes(producto.handle))
    : productosCrudos;
  if (filtroHandles?.length && seleccionados.length !== filtroHandles.length) {
    const encontrados = new Set(seleccionados.map((producto) => producto.handle));
    const faltantes = filtroHandles.filter((handle) => !encontrados.has(handle));
    throw new Error(`Handles no encontrados: ${faltantes.join(", ")}`);
  }

  const productos = enriquecerProductos(seleccionados);
  const estadisticas = {
    productos: productos.length,
    conDescripcion: productos.filter((producto) => producto.descripcion.descripcion).length,
    conEspecificaciones: productos.filter(
      (producto) => producto.descripcion.especificaciones.length > 0,
    ).length,
    conMedidas: productos.filter((producto) => producto.descripcion.medidas.length > 0).length,
    kitsConContenido: productos.filter((producto) => producto.descripcion.contenidoKit.length > 0)
      .length,
  };
  const documento = {
    versionEsquema: 1,
    generadoEn: new Date().toISOString(),
    fuente: {
      archivo: entrada,
      endpointCatalogo: `${URL_TIENDA}/products.json?limit=250&page={pagina}`,
      nota: "Derivado reproducible. RAW permanece sin modificar.",
    },
    estadisticas,
    productos,
  };

  mkdirSync(path.dirname(salida), { recursive: true });
  writeFileSync(salida, `${JSON.stringify(documento, null, 2)}\n`, "utf-8");

  const actualizados = baseDatos
    ? actualizarSqlite(path.resolve(baseDatos), productos)
    : null;
  console.log(
    JSON.stringify(
      {
        salida,
        ...estadisticas,
        productosActualizadosEnDb: actualizados,
      },
      null,
      2,
    ),
  );
}

main();
