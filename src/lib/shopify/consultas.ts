import "server-only";
import { getDb } from "@/lib/db";
import type { Producto } from "@/lib/types";
import { nombreCategoria, nombreForma, nombreOcasion } from "./derivar";
import { enriquecerDescripcion, type DescripcionEnriquecida } from "./enriquecer-descripcion";

type FilaCatalogo = {
  producto_id: string;
  handle: string;
  titulo_limpio: string;
  categoria: string | null;
  /** product_type crudo de Shopify (ej. "E-DECORS", "FIESTAS PREDISEÑADAS") —
   * distinto de `categoria` (taxonomía de negocio derivada). Se necesita
   * para distinguir un kit ya armado y con look propio de un globo suelto
   * al decidir cómo compone la escena la generación de imagen. */
  tipo: string | null;
  descripcion_txt: string | null;
  colores: string;
  ocasiones: string;
  tags: string;
  imagen_principal: string | null;
  variante_id: string;
  sku: string | null;
  tamano_codigo: string | null;
  forma: string | null;
  diam_pulg: number | null;
  precio: number;
  unidades_paq: number;
  disponible_variante: number;
  disponible_producto: number;
  inventario: number | null;
  inventario_fuente: string | null;
};

export type ResultadoCatalogo = {
  productoId: string;
  varianteId: string;
  sku: string | null;
  handle: string;
  nombre: string;
  /** Ver comentario de `FilaCatalogo.tipo`. */
  tipoProducto: string | null;
  categoria: string | null;
  categoriaNombre: string;
  tamano: string | null;
  /** Forma física del globo (redondo, corazon, link, modelar) — plan de tamaños F4. */
  forma: string | null;
  /** Diámetro real en pulgadas (solo globo redondo) — la señal física que necesita el prompt de imagen para no mezclar tamaños a ciegas. */
  diamPulg: number | null;
  colores: string[];
  ocasiones: string[];
  descripcion: string | null;
  /** Tags crudos del producto en Shopify — temas/personajes que colores/ocasiones no capturan (ej. "BARBIE", "ANIMALES DE LA GRANJA"). */
  tags: string[];
  precio: number;
  unidadesPaquete: number;
  disponible: boolean;
  imagen: string | null;
};

function filaAResultado(f: FilaCatalogo): ResultadoCatalogo {
  return {
    productoId: f.producto_id,
    varianteId: f.variante_id,
    sku: f.sku,
    handle: f.handle,
    nombre: f.tamano_codigo ? `${f.titulo_limpio} — ${f.tamano_codigo}` : f.titulo_limpio,
    tipoProducto: f.tipo,
    categoria: f.categoria,
    categoriaNombre: nombreCategoria(f.categoria),
    tamano: f.tamano_codigo,
    forma: f.forma,
    diamPulg: f.diam_pulg,
    colores: JSON.parse(f.colores || "[]"),
    ocasiones: JSON.parse(f.ocasiones || "[]"),
    descripcion: f.descripcion_txt,
    tags: JSON.parse(f.tags || "[]"),
    precio: f.precio,
    unidadesPaquete: f.unidades_paq,
    disponible: Boolean(f.disponible_variante && f.disponible_producto),
    imagen: f.imagen_principal,
  };
}

function candidatas(): FilaCatalogo[] {
  return getDb()
    .prepare(
      `SELECT
         p.id AS producto_id, p.handle, p.titulo_limpio, p.categoria, p.tipo, p.colores, p.ocasiones, p.tags,
         p.descripcion_txt,
         p.imagen_principal, p.disponible AS disponible_producto,
         v.id AS variante_id, v.sku, v.tamano_codigo, v.forma, v.diam_pulg, v.precio, v.unidades_paq,
         v.disponible AS disponible_variante, v.inventario, v.inventario_fuente
       FROM shopify_variante v
       JOIN shopify_producto p ON p.id = v.producto_id
       WHERE v.precio > 0
         -- Decoraciones ya armadas (paquete/kit, tipo E-DECORS) con diseño de
         -- arco o bouquet quedan fuera del catálogo a pedido explícito: ese
         -- diseño quedó revisado y rechazado internamente como desactualizado
         -- (§7 del plan de entrenamiento, 2026-08-21). Guirnalda y semi arco
         -- del mismo tipo de producto SÍ siguen saliendo — el rechazo fue
         -- puntual a esos dos formatos, no al tipo de producto completo.
         AND NOT (p.tipo = 'E-DECORS' AND UPPER(COALESCE(v.option1, '')) IN ('ARCO', 'BOUQUET'))`,
    )
    .all() as unknown as FilaCatalogo[];
}

export type FiltrosCatalogo = {
  texto?: string;
  categorias?: string[];
  colores?: string[];
  ocasiones?: string[];
  /**
   * redondo, corazon, link, modelar — la forma física del globo, no el
   * tamaño exacto. No incluye "metalizado" (es acabado/categoría, ver
   * `categorias: globo_metalizado`) ni "plano" (es empaque, no un globo).
   */
  formas?: string[];
  tamanos?: string[];
  /**
   * Tags crudos de Shopify (case-insensitive) para temas/personajes que
   * colores/ocasiones/categorias no capturan — ej. "BARBIE", "ANIMALES DE LA
   * GRANJA", "VIRGEN DEL CARMEN". El modelo los descubre viendo los `tags`
   * que trae cada producto en una búsqueda previa, no de una lista fija.
   */
  tags?: string[];
  precio_min?: number;
  precio_max?: number;
  solo_disponibles?: boolean;
  limite?: number;
};

export type ResultadoBusqueda = {
  resultados: ResultadoCatalogo[];
  total: number;
  filtroRelajado?: string;
};

/** IDs de producto cuyo FTS5 hace match con el texto libre — maneja tildes y varias palabras. */
function idsPorTexto(texto: string): Set<string> {
  const consulta = texto
    .trim()
    .split(/\s+/)
    .map((palabra) => `"${palabra.replace(/"/g, '""')}"*`)
    .join(" ");
  if (!consulta) return new Set();
  try {
    const filas = getDb()
      .prepare("SELECT id FROM shopify_fts WHERE shopify_fts MATCH ?")
      .all(consulta) as unknown as { id: string }[];
    return new Set(filas.map((f) => f.id));
  } catch {
    // Sintaxis FTS5 inválida (ej. solo signos de puntuación) — sin resultados, no un error.
    return new Set();
  }
}

function aplicarFiltros(filas: FilaCatalogo[], f: FiltrosCatalogo, idsTexto?: Set<string>): FilaCatalogo[] {
  const soloDisponibles = f.solo_disponibles ?? true;

  return filas.filter((fila) => {
    if (idsTexto && !idsTexto.has(fila.producto_id)) return false;
    if (soloDisponibles && !(fila.disponible_variante && fila.disponible_producto)) return false;
    if (f.categorias?.length && !f.categorias.includes(fila.categoria ?? "")) return false;
    if (f.precio_max && fila.precio > f.precio_max) return false;
    if (f.precio_min && fila.precio < f.precio_min) return false;
    if (f.tamanos?.length) {
      const codigo = (fila.tamano_codigo ?? "").toUpperCase();
      if (!f.tamanos.some((t) => codigo === t.toUpperCase())) return false;
    }
    if (f.formas?.length && !f.formas.includes(fila.forma ?? "")) return false;
    if (f.colores?.length) {
      const colores: string[] = JSON.parse(fila.colores || "[]");
      if (!f.colores.some((c) => colores.includes(c.toLowerCase()))) return false;
    }
    if (f.ocasiones?.length) {
      const ocasiones: string[] = JSON.parse(fila.ocasiones || "[]");
      if (!f.ocasiones.some((o) => ocasiones.includes(o))) return false;
    }
    if (f.tags?.length) {
      const tags: string[] = JSON.parse(fila.tags || "[]").map((t: string) => t.toUpperCase());
      if (!f.tags.some((t) => tags.includes(t.toUpperCase()))) return false;
    }
    return true;
  });
}

/**
 * Una vez que se suelta el filtro de ocasión porque la pedida no tiene
 * productos etiquetados, esto evita colar piezas con diseño impreso para una
 * ocasión *distinta y conflictiva* (ej. "Feliz Día Mami" o "Te Amo" para un
 * XV años) — solo deja pasar piezas genéricas (sin ocasión marcada) o que sí
 * coincidan con lo pedido. Sin este filtro, soltar "ocasiones" en
 * `aplicarFiltros` reabre la puerta a cualquier ocasión, no solo a lo neutro.
 */
function sinOcasionAjena(filas: FilaCatalogo[], ocasionesPedidas?: string[]): FilaCatalogo[] {
  if (!ocasionesPedidas?.length) return filas;
  return filas.filter((f) => {
    const ocasiones: string[] = JSON.parse(f.ocasiones || "[]");
    return ocasiones.length === 0 || ocasionesPedidas.some((o) => ocasiones.includes(o));
  });
}

/**
 * Búsqueda con límite duro y relajación progresiva (§2.6 del plan): si los
 * filtros no dan nada, se sueltan en orden texto → ocasión → color → tamaño →
 * forma → categoría, y se informa cuál se soltó para que el modelo se lo diga
 * al cliente.
 *
 * Texto va primero: el modelo suele mandar ahí vocabulario descriptivo del
 * evento ("XV años glamour") que no es literal en ningún título/tag de
 * Shopify, así que un match FTS vacío no debe bloquear el resto de filtros
 * estructurados para siempre. Ocasión va justo después porque depende de tags
 * de Shopify sueltos y poco exhaustivos (§ derivarOcasiones) — sin soltarla,
 * una ocasión sin productos etiquetados (ej. "XV años") deja la búsqueda en 0
 * sin importar qué más se relaje. Una vez soltada, `sinOcasionAjena` se aplica
 * en todos los pasos siguientes para no recomendar piezas de otra ocasión.
 */
export function buscarCatalogoShopify(filtros: FiltrosCatalogo): ResultadoBusqueda {
  const limite = Math.min(filtros.limite ?? 8, 20);
  const todas = candidatas();
  let idsTexto = filtros.texto?.trim() ? idsPorTexto(filtros.texto) : undefined;
  const ocasionesPedidas = filtros.ocasiones;

  let filas = aplicarFiltros(todas, filtros, idsTexto);
  let filtroRelajado: string | undefined;

  if (filas.length === 0 && idsTexto) {
    idsTexto = undefined;
    filas = aplicarFiltros(todas, filtros, idsTexto);
    filtroRelajado = "texto";
  }
  if (filas.length === 0 && ocasionesPedidas?.length) {
    filas = sinOcasionAjena(
      aplicarFiltros(todas, { ...filtros, ocasiones: undefined }, idsTexto),
      ocasionesPedidas,
    );
    filtroRelajado = "ocasiones";
  }
  if (filas.length === 0 && filtros.colores?.length) {
    filas = sinOcasionAjena(
      aplicarFiltros(todas, { ...filtros, ocasiones: undefined, colores: undefined }, idsTexto),
      ocasionesPedidas,
    );
    filtroRelajado = "colores";
  }
  if (filas.length === 0 && filtros.tags?.length) {
    filas = sinOcasionAjena(
      aplicarFiltros(todas, { ...filtros, ocasiones: undefined, colores: undefined, tags: undefined }, idsTexto),
      ocasionesPedidas,
    );
    filtroRelajado = "tags";
  }
  if (filas.length === 0 && filtros.tamanos?.length) {
    filas = sinOcasionAjena(
      aplicarFiltros(
        todas,
        { ...filtros, ocasiones: undefined, colores: undefined, tags: undefined, tamanos: undefined },
        idsTexto,
      ),
      ocasionesPedidas,
    );
    filtroRelajado = "tamanos";
  }
  if (filas.length === 0 && filtros.formas?.length) {
    filas = sinOcasionAjena(
      aplicarFiltros(
        todas,
        { ...filtros, ocasiones: undefined, colores: undefined, tags: undefined, tamanos: undefined, formas: undefined },
        idsTexto,
      ),
      ocasionesPedidas,
    );
    filtroRelajado = "formas";
  }
  if (filas.length === 0 && filtros.categorias?.length) {
    filas = sinOcasionAjena(
      aplicarFiltros(
        todas,
        {
          ...filtros,
          ocasiones: undefined,
          colores: undefined,
          tags: undefined,
          tamanos: undefined,
          formas: undefined,
          categorias: undefined,
        },
        idsTexto,
      ),
      ocasionesPedidas,
    );
    filtroRelajado = "categorias";
  }

  return {
    resultados: filas.slice(0, limite).map(filaAResultado),
    total: filas.length,
    filtroRelajado,
  };
}

/**
 * Desglose por tipo de producto de una búsqueda (mismos filtros que
 * `buscarCatalogoShopify` menos `categorias`), para cuando hay demasiados
 * resultados como para tirárselos todos de una al cliente: en vez de una
 * lista plana, se le ofrece elegir el tipo primero (§ ejecutar.ts,
 * `buscar_catalogo`).
 */
export function categoriasDeCatalogo(filtros: FiltrosCatalogo): Faceta[] {
  const todas = candidatas();
  const idsTexto = filtros.texto?.trim() ? idsPorTexto(filtros.texto) : undefined;
  const filas = sinOcasionAjena(
    aplicarFiltros(todas, { ...filtros, categorias: undefined }, idsTexto),
    filtros.ocasiones,
  );

  const conteo = new Map<string, number>();
  for (const f of filas) {
    const clave = f.categoria ?? "sin_categoria";
    conteo.set(clave, (conteo.get(clave) ?? 0) + 1);
  }

  return [...conteo.entries()]
    .map(([valor, total]) => ({
      valor,
      etiqueta: valor === "sin_categoria" ? "Otros" : nombreCategoria(valor),
      total,
    }))
    .sort((a, b) => b.total - a.total);
}

/**
 * Mejor coincidencia real para una línea de despiece: tamaño exacto, color
 * si se pidió, disponible primero, y entre iguales el menor precio unitario
 * (precio del paquete / unidades) — así una cotización no queda cara solo
 * por elegir al azar entre dos paquetes del mismo tamaño (§3.5 del plan).
 */
export function mejorVarianteParaTamano(tamano: string, color?: string): ResultadoCatalogo | null {
  const coincidencias = candidatas().filter(
    (f) => (f.tamano_codigo ?? "").toUpperCase() === tamano.toUpperCase(),
  );
  if (coincidencias.length === 0) return null;

  const conColor = color
    ? coincidencias.filter((f) => (JSON.parse(f.colores || "[]") as string[]).includes(color.toLowerCase()))
    : [];
  const grupo = conColor.length > 0 ? conColor : coincidencias;

  grupo.sort((a, b) => {
    const aDisp = a.disponible_variante && a.disponible_producto ? 0 : 1;
    const bDisp = b.disponible_variante && b.disponible_producto ? 0 : 1;
    if (aDisp !== bDisp) return aDisp - bDisp;
    return a.precio / a.unidades_paq - b.precio / b.unidades_paq;
  });

  return filaAResultado(grupo[0]);
}

export function variantesPorIds(ids: string[]): ResultadoCatalogo[] {
  if (ids.length === 0) return [];
  const db = getDb();
  const marcadores = ids.map(() => "?").join(",");
  const filas = db
    .prepare(
      `SELECT
         p.id AS producto_id, p.handle, p.titulo_limpio, p.categoria, p.tipo, p.colores, p.ocasiones, p.tags,
         p.descripcion_txt,
         p.imagen_principal, p.disponible AS disponible_producto,
         v.id AS variante_id, v.sku, v.tamano_codigo, v.forma, v.diam_pulg, v.precio, v.unidades_paq,
         v.disponible AS disponible_variante, v.inventario, v.inventario_fuente
       FROM shopify_variante v
       JOIN shopify_producto p ON p.id = v.producto_id
       WHERE v.id IN (${marcadores})`,
    )
    .all(...ids) as unknown as FilaCatalogo[];
  return filas.map(filaAResultado);
}

/** Adapta un resultado del catálogo Shopify al tipo `Producto` que ya consumen las tarjetas del chat y la generación de imagen. */
export function aProducto(r: ResultadoCatalogo): Producto {
  return {
    id: r.varianteId,
    nombre: r.nombre,
    tipoProducto: r.tipoProducto ?? undefined,
    categoria: r.categoriaNombre,
    estilos: [],
    colores: r.colores,
    descripcion: r.descripcion ?? r.nombre,
    precio: r.precio,
    unidadesPaquete: r.unidadesPaquete,
    foto: r.imagen ?? undefined,
    tamanoCodigo: r.tamano ?? undefined,
    forma: r.forma ?? undefined,
    diamPulg: r.diamPulg ?? undefined,
    familiaId: r.productoId,
    catalogSku: r.sku ?? undefined,
  };
}

/** Catálogo compacto para que el modelo resuelva sustitutos de referencias sin intervención del cliente. */
export function productosParaMatchingReferencia(): Producto[] {
  return candidatas()
    .filter((fila) => Boolean(fila.disponible_producto && fila.disponible_variante))
    .map(filaAResultado)
    .map(aProducto);
}

export type ProductoExplorador = {
  productoId: string;
  handle: string;
  nombre: string;
  categoria: string | null;
  categoriaNombre: string;
  colores: string[];
  imagen: string | null;
  precioMin: number;
  precioMax: number;
  disponible: boolean;
};

/**
 * Para el explorador `/catalogo`: a diferencia de `buscarCatalogoShopify`
 * (una fila por variante, pensada para que el chat ofrezca piezas concretas),
 * esto agrupa por producto — un producto puede tener hasta 50 variantes y la
 * grilla necesita una tarjeta por producto, no una por talla/color.
 */
export function explorarCatalogo(
  filtros: FiltrosCatalogo,
  pagina: number,
  porPagina: number,
): { productos: ProductoExplorador[]; total: number } {
  const todas = candidatas();
  const idsTexto = filtros.texto?.trim() ? idsPorTexto(filtros.texto) : undefined;
  const filas = aplicarFiltros(todas, filtros, idsTexto);

  const porProducto = new Map<string, FilaCatalogo[]>();
  for (const fila of filas) {
    const lista = porProducto.get(fila.producto_id);
    if (lista) lista.push(fila);
    else porProducto.set(fila.producto_id, [fila]);
  }

  const productos: ProductoExplorador[] = [...porProducto.values()]
    .map((filasProd) => {
      const primera = filasProd[0];
      const precios = filasProd.map((f) => f.precio);
      return {
        productoId: primera.producto_id,
        handle: primera.handle,
        nombre: primera.titulo_limpio,
        categoria: primera.categoria,
        categoriaNombre: nombreCategoria(primera.categoria),
        colores: JSON.parse(primera.colores || "[]"),
        imagen: primera.imagen_principal,
        precioMin: Math.min(...precios),
        precioMax: Math.max(...precios),
        disponible: Boolean(primera.disponible_producto),
      };
    })
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

  const inicio = (pagina - 1) * porPagina;
  return { productos: productos.slice(inicio, inicio + porPagina), total: productos.length };
}

export type Faceta = { valor: string; etiqueta: string; total: number };

/**
 * Conteos globales (no dependen de los filtros activos) — una versión más
 * simple que el "cada faceta muestra su conteo según lo demás filtrado" del
 * plan, suficiente para orientar al cliente sin recalcular todo en cada
 * combinación de filtros.
 */
export function facetasCatalogo(): {
  categorias: Faceta[];
  colores: Faceta[];
  formas: Faceta[];
  ocasiones: Faceta[];
  precioMin: number;
  precioMax: number;
} {
  const db = getDb();

  const categorias = db
    .prepare(
      `SELECT categoria AS valor, COUNT(*) AS total
       FROM shopify_producto
       WHERE categoria IS NOT NULL AND disponible = 1
       GROUP BY categoria ORDER BY total DESC`,
    )
    .all() as { valor: string; total: number }[];

  const colores = db
    .prepare(
      `SELECT je.value AS valor, COUNT(DISTINCT p.id) AS total
       FROM shopify_producto p, json_each(p.colores) je
       WHERE p.disponible = 1
       GROUP BY je.value ORDER BY total DESC`,
    )
    .all() as { valor: string; total: number }[];

  const formas = db
    .prepare(
      `SELECT v.forma AS valor, COUNT(DISTINCT v.producto_id) AS total
       FROM shopify_variante v
       JOIN shopify_producto p ON p.id = v.producto_id
       WHERE v.forma IS NOT NULL AND v.precio > 0 AND p.disponible = 1
       GROUP BY v.forma ORDER BY total DESC`,
    )
    .all() as { valor: string; total: number }[];

  const ocasiones = db
    .prepare(
      `SELECT je.value AS valor, COUNT(DISTINCT p.id) AS total
       FROM shopify_producto p, json_each(p.ocasiones) je
       WHERE p.disponible = 1
       GROUP BY je.value ORDER BY total DESC`,
    )
    .all() as { valor: string; total: number }[];

  const rango = db
    .prepare("SELECT MIN(precio) AS min, MAX(precio) AS max FROM shopify_variante WHERE precio > 0")
    .get() as { min: number | null; max: number | null };

  return {
    categorias: categorias.map((c) => ({ valor: c.valor, etiqueta: nombreCategoria(c.valor), total: c.total })),
    colores: colores.map((c) => ({ valor: c.valor, etiqueta: c.valor, total: c.total })),
    formas: formas.map((f) => ({ valor: f.valor, etiqueta: nombreForma(f.valor), total: f.total })),
    ocasiones: ocasiones.map((o) => ({ valor: o.valor, etiqueta: nombreOcasion(o.valor), total: o.total })),
    precioMin: rango.min ?? 0,
    precioMax: rango.max ?? 0,
  };
}

export type VarianteDetalle = {
  id: string;
  tamano: string | null;
  unidadesPaquete: number;
  precio: number;
  disponible: boolean;
  inventario: number | null;
  inventarioFuente: string | null;
};

export type ProductoDetalle = {
  id: string;
  handle: string;
  nombre: string;
  categoriaNombre: string;
  descripcion: string | null;
  descripcionDatos: DescripcionEnriquecida;
  colores: string[];
  ocasiones: string[];
  imagenPrincipal: string | null;
  imagenes: string[];
  disponible: boolean;
  variantes: VarianteDetalle[];
};

type FilaProductoDb = {
  id: string;
  handle: string;
  titulo_limpio: string;
  categoria: string | null;
  descripcion_txt: string | null;
  descripcion_datos: string;
  colores: string;
  ocasiones: string;
  imagen_principal: string | null;
  imagenes: string;
  disponible: number;
};

type FilaVarianteDb = {
  id: string;
  tamano_codigo: string | null;
  unidades_paq: number;
  precio: number;
  disponible: number;
  inventario: number | null;
  inventario_fuente: string | null;
};

export function productoPorHandle(handle: string): ProductoDetalle | null {
  const db = getDb();
  const producto = db.prepare("SELECT * FROM shopify_producto WHERE handle = ?").get(handle) as
    | FilaProductoDb
    | undefined;
  if (!producto) return null;

  const variantes = db
    .prepare("SELECT * FROM shopify_variante WHERE producto_id = ? AND precio > 0 ORDER BY precio ASC")
    .all(producto.id) as unknown as FilaVarianteDb[];

  let descripcionDatos = enriquecerDescripcion(null);
  try {
    const candidata = JSON.parse(producto.descripcion_datos || "{}") as Partial<DescripcionEnriquecida>;
    if (Array.isArray(candidata.tablas)) descripcionDatos = candidata as DescripcionEnriquecida;
  } catch {
    // Una fila antigua o manual no debe romper la ficha completa.
  }

  return {
    id: producto.id,
    handle: producto.handle,
    nombre: producto.titulo_limpio,
    categoriaNombre: nombreCategoria(producto.categoria),
    descripcion: producto.descripcion_txt,
    descripcionDatos,
    colores: JSON.parse(producto.colores || "[]"),
    ocasiones: JSON.parse(producto.ocasiones || "[]"),
    imagenPrincipal: producto.imagen_principal,
    imagenes: JSON.parse(producto.imagenes || "[]"),
    disponible: Boolean(producto.disponible),
    variantes: variantes.map((v) => ({
      id: v.id,
      tamano: v.tamano_codigo,
      unidadesPaquete: v.unidades_paq,
      precio: v.precio,
      disponible: Boolean(v.disponible),
      inventario: v.inventario,
      inventarioFuente: v.inventario_fuente,
    })),
  };
}

export type EstadoSync = {
  productos: number;
  variantes: number;
  ultimoSync: {
    terminadoEn: string | null;
    productos: number | null;
    variantes: number | null;
    inventarioCruzado: number | null;
    error: string | null;
  } | null;
};

export function estadoSync(): EstadoSync {
  const db = getDb();
  const { productos } = db.prepare("SELECT COUNT(*) AS productos FROM shopify_producto").get() as {
    productos: number;
  };
  const { variantes } = db.prepare("SELECT COUNT(*) AS variantes FROM shopify_variante").get() as {
    variantes: number;
  };
  const ultimo = db
    .prepare("SELECT terminado_en, productos, variantes, inventario_cruzado, error FROM shopify_sync ORDER BY id DESC LIMIT 1")
    .get() as
    | {
        terminado_en: string | null;
        productos: number | null;
        variantes: number | null;
        inventario_cruzado: number | null;
        error: string | null;
      }
    | undefined;

  return {
    productos,
    variantes,
    ultimoSync: ultimo
      ? {
          terminadoEn: ultimo.terminado_en,
          productos: ultimo.productos,
          variantes: ultimo.variantes,
          inventarioCruzado: ultimo.inventario_cruzado,
          error: ultimo.error,
        }
      : null,
  };
}
