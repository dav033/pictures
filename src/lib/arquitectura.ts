import "server-only";
import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db";

export type NivelElemento = "component" | "module" | "composition";
export type NivelPresupuesto = "low" | "mid" | "high";

export type CategoriaArquitectura = {
  id: string;
  slug: string;
  nombre: string;
  descripcion: string | null;
  color: string;
  activa: boolean;
  orden: number;
  elementos: number;
};

export type TipoArquitectura = {
  id: string;
  slug: string;
  nombre: string;
  nivel: NivelElemento;
  descripcion: string | null;
  activo: boolean;
  orden: number;
  elementos: number;
};

export type ElementoArquitectura = {
  id: string;
  shopifyProductoId: string;
  handle: string;
  nombre: string;
  imagenUrl: string | null;
  tipoId: string;
  tipoNombre: string;
  nivel: NivelElemento;
  categoriaIds: string[];
  categorias: Array<{ id: string; nombre: string; color: string }>;
  presupuestos: NivelPresupuesto[];
  notas: string | null;
  activo: boolean;
  disponible: boolean;
  precioMin: number | null;
  precioMax: number | null;
  colores: string[];
};

export type ProductoShopifyArquitectura = {
  id: string;
  handle: string;
  nombre: string;
  imagenUrl: string | null;
  tipoShopify: string | null;
  categoriaShopify: string | null;
  disponible: boolean;
  precioMin: number | null;
  precioMax: number | null;
  colores: string[];
  ocasiones: string[];
  agregado: boolean;
};

function jsonArray<T>(value: string | null | undefined): T[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

export function obtenerArquitectura(): {
  categorias: CategoriaArquitectura[];
  tipos: TipoArquitectura[];
  elementos: ElementoArquitectura[];
} {
  const db = getDb();
  const categorias = db.prepare(`
    SELECT c.*, COUNT(ec.elemento_id) AS elementos
    FROM arquitectura_categorias c
    LEFT JOIN arquitectura_elemento_categorias ec ON ec.categoria_id = c.id
    GROUP BY c.id ORDER BY c.orden, c.nombre
  `).all() as unknown as Array<{
    id: string; slug: string; nombre: string; descripcion: string | null; color: string;
    activa: number; orden: number; elementos: number;
  }>;

  const tipos = db.prepare(`
    SELECT t.*, COUNT(e.id) AS elementos
    FROM arquitectura_tipos t
    LEFT JOIN arquitectura_elementos e ON e.tipo_id = t.id
    GROUP BY t.id ORDER BY
      CASE t.nivel WHEN 'component' THEN 0 WHEN 'module' THEN 1 ELSE 2 END,
      t.orden, t.nombre
  `).all() as unknown as Array<{
    id: string; slug: string; nombre: string; nivel: NivelElemento; descripcion: string | null;
    activo: number; orden: number; elementos: number;
  }>;

  const rows = db.prepare(`
    SELECT e.*, t.nombre AS tipo_nombre, t.nivel,
      p.handle, p.disponible, p.precio_min, p.precio_max, p.colores
    FROM arquitectura_elementos e
    JOIN arquitectura_tipos t ON t.id = e.tipo_id
    JOIN shopify_producto p ON p.id = e.shopify_producto_id
    ORDER BY e.actualizado_en DESC, e.nombre
  `).all() as unknown as Array<{
    id: string; shopify_producto_id: string; nombre: string; imagen_url: string | null;
    tipo_id: string; tipo_nombre: string; nivel: NivelElemento; presupuestos: string;
    notas: string | null; activo: number; handle: string; disponible: number;
    precio_min: number | null; precio_max: number | null; colores: string;
  }>;

  const categoriasPorElemento = db.prepare(`
    SELECT ec.elemento_id, c.id, c.nombre, c.color
    FROM arquitectura_elemento_categorias ec
    JOIN arquitectura_categorias c ON c.id = ec.categoria_id
    ORDER BY c.orden, c.nombre
  `).all() as unknown as Array<{ elemento_id: string; id: string; nombre: string; color: string }>;
  const categoryMap = new Map<string, Array<{ id: string; nombre: string; color: string }>>();
  for (const category of categoriasPorElemento) {
    const list = categoryMap.get(category.elemento_id) ?? [];
    list.push({ id: category.id, nombre: category.nombre, color: category.color });
    categoryMap.set(category.elemento_id, list);
  }

  return {
    categorias: categorias.map((category) => ({ ...category, activa: Boolean(category.activa) })),
    tipos: tipos.map((type) => ({ ...type, activo: Boolean(type.activo) })),
    elementos: rows.map((row) => {
      const itemCategories = categoryMap.get(row.id) ?? [];
      return {
        id: row.id,
        shopifyProductoId: row.shopify_producto_id,
        handle: row.handle,
        nombre: row.nombre,
        imagenUrl: row.imagen_url,
        tipoId: row.tipo_id,
        tipoNombre: row.tipo_nombre,
        nivel: row.nivel,
        categoriaIds: itemCategories.map((category) => category.id),
        categorias: itemCategories,
        presupuestos: jsonArray<NivelPresupuesto>(row.presupuestos),
        notas: row.notas,
        activo: Boolean(row.activo),
        disponible: Boolean(row.disponible),
        precioMin: row.precio_min,
        precioMax: row.precio_max,
        colores: jsonArray<string>(row.colores),
      };
    }),
  };
}

export function buscarProductosShopifyArquitectura(texto = "", limite = 24): ProductoShopifyArquitectura[] {
  const db = getDb();
  const query = `%${texto.trim().toLowerCase()}%`;
  const rows = db.prepare(`
    SELECT p.id, p.handle, p.titulo_limpio, p.imagen_principal, p.tipo, p.categoria,
      p.disponible, p.precio_min, p.precio_max, p.colores, p.ocasiones,
      CASE WHEN e.id IS NULL THEN 0 ELSE 1 END AS agregado
    FROM shopify_producto p
    LEFT JOIN arquitectura_elementos e ON e.shopify_producto_id = p.id
    WHERE (? = '%%' OR lower(p.titulo_limpio) LIKE ? OR lower(p.handle) LIKE ?
      OR lower(COALESCE(p.tipo, '')) LIKE ? OR lower(COALESCE(p.categoria, '')) LIKE ? OR lower(p.tags) LIKE ?)
    ORDER BY agregado ASC, p.disponible DESC, p.titulo_limpio
    LIMIT ?
  `).all(query, query, query, query, query, query, Math.min(Math.max(limite, 1), 60)) as unknown as Array<{
    id: string; handle: string; titulo_limpio: string; imagen_principal: string | null;
    tipo: string | null; categoria: string | null; disponible: number; precio_min: number | null;
    precio_max: number | null; colores: string; ocasiones: string; agregado: number;
  }>;
  return rows.map((row) => ({
    id: row.id,
    handle: row.handle,
    nombre: row.titulo_limpio,
    imagenUrl: row.imagen_principal,
    tipoShopify: row.tipo,
    categoriaShopify: row.categoria,
    disponible: Boolean(row.disponible),
    precioMin: row.precio_min,
    precioMax: row.precio_max,
    colores: jsonArray<string>(row.colores),
    ocasiones: jsonArray<string>(row.ocasiones),
    agregado: Boolean(row.agregado),
  }));
}

export function crearCategoria(input: { nombre: string; descripcion?: string; color?: string }): void {
  const slug = slugify(input.nombre);
  if (!slug) throw new Error("Nombre de categoría inválido.");
  const db = getDb();
  const max = db.prepare("SELECT COALESCE(MAX(orden), -1) + 1 AS orden FROM arquitectura_categorias").get() as { orden: number };
  db.prepare(`INSERT INTO arquitectura_categorias (id, slug, nombre, descripcion, color, orden)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .run(`cat-${randomUUID()}`, slug, input.nombre.trim(), input.descripcion?.trim() || null, input.color ?? "#63d8c5", max.orden);
}

export function actualizarCategoria(input: { id: string; nombre: string; descripcion?: string; color?: string; activa?: boolean }): void {
  const slug = slugify(input.nombre);
  getDb().prepare(`UPDATE arquitectura_categorias
    SET slug = ?, nombre = ?, descripcion = ?, color = ?, activa = ? WHERE id = ?`)
    .run(slug, input.nombre.trim(), input.descripcion?.trim() || null, input.color ?? "#63d8c5", input.activa === false ? 0 : 1, input.id);
}

export function eliminarCategoria(id: string): void {
  getDb().prepare("DELETE FROM arquitectura_categorias WHERE id = ?").run(id);
}

export function crearTipo(input: { nombre: string; nivel: NivelElemento; descripcion?: string }): void {
  const slug = slugify(input.nombre);
  if (!slug) throw new Error("Nombre de tipo inválido.");
  const db = getDb();
  const max = db.prepare("SELECT COALESCE(MAX(orden), -1) + 1 AS orden FROM arquitectura_tipos").get() as { orden: number };
  db.prepare(`INSERT INTO arquitectura_tipos (id, slug, nombre, nivel, descripcion, orden)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .run(`type-${randomUUID()}`, slug, input.nombre.trim(), input.nivel, input.descripcion?.trim() || null, max.orden);
}

export function actualizarTipo(input: { id: string; nombre: string; nivel: NivelElemento; descripcion?: string; activo?: boolean }): void {
  getDb().prepare(`UPDATE arquitectura_tipos
    SET slug = ?, nombre = ?, nivel = ?, descripcion = ?, activo = ? WHERE id = ?`)
    .run(slugify(input.nombre), input.nombre.trim(), input.nivel, input.descripcion?.trim() || null, input.activo === false ? 0 : 1, input.id);
}

export function eliminarTipo(id: string): void {
  getDb().prepare("DELETE FROM arquitectura_tipos WHERE id = ?").run(id);
}

function reemplazarCategorias(elementoId: string, categoryIds: string[]): void {
  const db = getDb();
  db.prepare("DELETE FROM arquitectura_elemento_categorias WHERE elemento_id = ?").run(elementoId);
  const insert = db.prepare("INSERT INTO arquitectura_elemento_categorias (elemento_id, categoria_id) VALUES (?, ?)");
  for (const categoryId of [...new Set(categoryIds)]) insert.run(elementoId, categoryId);
}

export function guardarElemento(input: {
  id?: string;
  shopifyProductoId: string;
  tipoId: string;
  nombre?: string;
  categoriaIds: string[];
  presupuestos: NivelPresupuesto[];
  notas?: string;
  activo?: boolean;
}): void {
  const db = getDb();
  const product = db.prepare("SELECT titulo_limpio, imagen_principal FROM shopify_producto WHERE id = ?")
    .get(input.shopifyProductoId) as { titulo_limpio: string; imagen_principal: string | null } | undefined;
  if (!product) throw new Error("Producto Shopify no encontrado. Sincroniza el catálogo e inténtalo de nuevo.");
  const budgets = input.presupuestos.length ? [...new Set(input.presupuestos)] : ["low", "mid", "high"];
  const id = input.id ?? `element-${randomUUID()}`;

  db.exec("BEGIN");
  try {
    db.prepare(`INSERT INTO arquitectura_elementos
      (id, shopify_producto_id, tipo_id, nombre, imagen_url, presupuestos, notas, activo, actualizado_en)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(shopify_producto_id) DO UPDATE SET
        tipo_id = excluded.tipo_id, nombre = excluded.nombre, imagen_url = excluded.imagen_url,
        presupuestos = excluded.presupuestos, notas = excluded.notas, activo = excluded.activo,
        actualizado_en = CURRENT_TIMESTAMP`)
      .run(id, input.shopifyProductoId, input.tipoId, input.nombre?.trim() || product.titulo_limpio,
        product.imagen_principal, JSON.stringify(budgets), input.notas?.trim() || null, input.activo === false ? 0 : 1);
    const actual = db.prepare("SELECT id FROM arquitectura_elementos WHERE shopify_producto_id = ?")
      .get(input.shopifyProductoId) as { id: string };
    reemplazarCategorias(actual.id, input.categoriaIds);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function eliminarElemento(id: string): void {
  getDb().prepare("DELETE FROM arquitectura_elementos WHERE id = ?").run(id);
}
