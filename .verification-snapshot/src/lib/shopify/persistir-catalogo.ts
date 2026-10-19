import "server-only";
import type { DatabaseSync } from "node:sqlite";
import type { ProductoCanonico } from "./tipos";

export function persistirCatalogo(db: DatabaseSync, productos: ProductoCanonico[], actualizadoEn: string): void {
  db.exec("BEGIN");
  try {
    db.exec("DELETE FROM shopify_variante");
    db.exec("DELETE FROM shopify_producto");
    db.exec("DELETE FROM shopify_fts");

    const insertarProducto = db.prepare(`
      INSERT INTO shopify_producto
        (id, handle, titulo, titulo_limpio, tipo, tags, descripcion_txt, descripcion_datos, categoria,
         colores, ocasiones, imagen_principal, imagenes, disponible, precio_min, precio_max, actualizado_en)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertarVariante = db.prepare(`
      INSERT INTO shopify_variante
        (id, producto_id, sku, titulo, option1, option2, precio, disponible, inventario,
         inventario_fuente, gramos, tamano_codigo, forma, diam_pulg, largo_pulg, ancho_cm, alto_cm,
         unidades_paq, unidades_inferidas)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertarFts = db.prepare(`
      INSERT INTO shopify_fts (id, titulo_limpio, descripcion_txt, tags, colores, ocasiones)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (const p of productos) {
      insertarProducto.run(
        p.id,
        p.handle,
        p.titulo,
        p.tituloLimpio,
        p.tipo,
        JSON.stringify(p.tags),
        p.descripcionTxt,
        JSON.stringify(p.descripcionDatos),
        p.categoria,
        JSON.stringify(p.colores),
        JSON.stringify(p.ocasiones),
        p.imagenPrincipal,
        JSON.stringify(p.imagenes),
        p.disponible ? 1 : 0,
        p.precioMin,
        p.precioMax,
        actualizadoEn,
      );
      insertarFts.run(
        p.id,
        p.tituloLimpio,
        p.descripcionTxt ?? "",
        p.tags.join(" "),
        p.colores.join(" "),
        p.ocasiones.join(" "),
      );
      for (const v of p.variantes) {
        insertarVariante.run(
          v.id,
          p.id,
          v.sku,
          v.titulo,
          v.option1,
          v.option2,
          v.precio,
          v.disponible ? 1 : 0,
          v.inventario,
          v.inventarioFuente,
          v.gramos,
          v.tamanoCodigo,
          v.forma,
          v.diamPulg,
          v.largoPulg,
          v.anchoCm,
          v.altoCm,
          v.unidadesPaq,
          v.unidadesInferidas ? 1 : 0,
        );
      }
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
