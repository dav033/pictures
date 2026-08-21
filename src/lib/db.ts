import "server-only";
import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { CATALOGO_SEED } from "./catalog-data";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "demo.sqlite");

// En dev, Next.js puede reevaluar este módulo entre requests; guardamos la
// conexión en globalThis para no reabrir el archivo ni recorrer la semilla
// en cada hot-reload.
declare global {
  var __db: DatabaseSync | undefined;
}

// Mapeo de las 3 franjas viejas a las 4 nuevas (PLAN_RAG_FRANJAS_PRESUPUESTO.md
// §5.2). "low" pierde alcance real de "escena" hacia abajo porque la franja
// nueva `detalle` es más angosta que el "low" viejo (no incluye arco); se
// prefiere subestimar el rango a inventar un rango que el catálogo real no
// puede sostener (§1.5 del plan: un arco no cabe en $0–50.000).
const MAPA_PRESUPUESTO_LEGADO: Record<string, string[]> = {
  low: ["detalle", "focal"],
  mid: ["focal", "escena"],
  high: ["escena", "escena_completa"],
};

/** Reescribe `arquitectura_elementos.presupuestos` de low/mid/high a las 4
 * franjas nuevas, una sola vez por fila — `presupuestos_v1` marca cuáles ya
 * se migraron sin depender de que la tabla esté vacía hoy. */
function migrarPresupuestosLegado(db: DatabaseSync): void {
  const filas = db
    .prepare(
      `SELECT id, presupuestos FROM arquitectura_elementos
       WHERE presupuestos_v1 IS NULL
         AND (presupuestos LIKE '%low%' OR presupuestos LIKE '%mid%' OR presupuestos LIKE '%high%')`,
    )
    .all() as Array<{ id: string; presupuestos: string }>;
  if (filas.length === 0) return;

  const actualizar = db.prepare("UPDATE arquitectura_elementos SET presupuestos = ?, presupuestos_v1 = ? WHERE id = ?");
  for (const fila of filas) {
    let viejos: string[];
    try {
      viejos = JSON.parse(fila.presupuestos);
    } catch {
      continue; // valor corrupto: se deja para revisión manual, no se inventa un default
    }
    const nuevos = [...new Set(viejos.flatMap((v) => MAPA_PRESUPUESTO_LEGADO[v] ?? [v]))];
    actualizar.run(JSON.stringify(nuevos), fila.presupuestos, fila.id);
  }
}

// Puente con el retrieval por rol (§5.3) — sólo informativo hoy (0 filas en
// arquitectura_tipos usan esto todavía en producción), pero sin asignarlo
// una vez el admin cure elementos no habría forma de preferirlos sobre los
// inferidos por categoría sin otra migración.
const ROL_PRESUPUESTO_POR_TIPO_SLUG: Record<string, string> = {
  "globo-latex": "relleno",
  "globo-metalizado": "acento",
  "fondo-cortina": "soporte",
  "estructura-soporte": "soporte",
  "mesa-vajilla": "servicio",
  "accesorio-tematico": "acento",
  iluminacion: "acento",
  arco: "focal",
  guirnalda: "focal",
  bouquet: "acento",
  "mesa-decorada": "servicio",
  "setup-completo": "focal",
};

function asignarRolesPresupuestoATipos(db: DatabaseSync): void {
  const actualizar = db.prepare("UPDATE arquitectura_tipos SET rol_presupuesto = ? WHERE slug = ? AND rol_presupuesto IS NULL");
  for (const [slug, rol] of Object.entries(ROL_PRESUPUESTO_POR_TIPO_SLUG)) actualizar.run(rol, slug);
}

function crearConexion(): DatabaseSync {
  mkdirSync(DATA_DIR, { recursive: true });
  const db = new DatabaseSync(DB_PATH);

  // SQLite no aplica ON DELETE CASCADE a menos que se active por conexión.
  db.exec("PRAGMA foreign_keys = ON;");

  db.exec(`
    CREATE TABLE IF NOT EXISTS productos (
      id TEXT PRIMARY KEY,
      nombre TEXT NOT NULL,
      categoria TEXT NOT NULL,
      descripcion TEXT NOT NULL,
      precio REAL NOT NULL,
      estilos TEXT NOT NULL DEFAULT '[]',
      colores TEXT NOT NULL DEFAULT '[]',
      emoji TEXT,
      tono TEXT,
      foto TEXT
    );

    CREATE TABLE IF NOT EXISTS decoraciones (
      id TEXT PRIMARY KEY,
      nombre TEXT NOT NULL,
      descripcion TEXT,
      imagen TEXT NOT NULL
    );

    -- Relación muchos-a-muchos: si se borra un producto o una decoración,
    -- las filas de esta tabla se limpian solas. Así nunca queda una
    -- decoración apuntando a un producto que ya no existe.
    CREATE TABLE IF NOT EXISTS decoracion_elementos (
      decoracion_id TEXT NOT NULL REFERENCES decoraciones(id) ON DELETE CASCADE,
      producto_id TEXT NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
      PRIMARY KEY (decoracion_id, producto_id)
    );

    -- Marca si ya se sembró el catálogo alguna vez. Sin esto, borrar todos
    -- los productos a propósito haría que se resembraran solos en el
    -- siguiente reinicio, porque la tabla volvería a estar "vacía".
    CREATE TABLE IF NOT EXISTS meta (
      clave TEXT PRIMARY KEY,
      valor TEXT
    );

    -- Catálogo real de Sempertex, importado de la tienda pública. Tablas
    -- aparte de "productos": el catálogo curado a mano sigue funcionando
    -- igual junto al importado.
    CREATE TABLE IF NOT EXISTS shopify_producto (
      id                TEXT PRIMARY KEY,
      handle            TEXT NOT NULL UNIQUE,
      titulo            TEXT NOT NULL,
      titulo_limpio     TEXT NOT NULL,
      tipo              TEXT,
      tags              TEXT NOT NULL DEFAULT '[]',
      descripcion_txt   TEXT,
      descripcion_datos TEXT NOT NULL DEFAULT '{}',
      categoria         TEXT,
      colores           TEXT NOT NULL DEFAULT '[]',
      ocasiones         TEXT NOT NULL DEFAULT '[]',
      imagen_principal  TEXT,
      imagenes          TEXT NOT NULL DEFAULT '[]',
      disponible        INTEGER NOT NULL DEFAULT 0,
      precio_min        REAL,
      precio_max        REAL,
      actualizado_en    TEXT
    );

    CREATE TABLE IF NOT EXISTS shopify_variante (
      id                TEXT PRIMARY KEY,
      producto_id       TEXT NOT NULL REFERENCES shopify_producto(id) ON DELETE CASCADE,
      sku               TEXT,
      titulo            TEXT,
      option1           TEXT,
      option2           TEXT,
      precio            REAL NOT NULL,
      disponible        INTEGER NOT NULL DEFAULT 0,
      inventario        INTEGER,
      inventario_fuente TEXT,
      gramos            INTEGER,
      -- decodificado de option1/option2 (gramática de tamaños del catálogo)
      tamano_codigo     TEXT,
      forma             TEXT,
      diam_pulg         REAL,
      largo_pulg        REAL,
      ancho_cm          REAL,
      alto_cm           REAL,
      unidades_paq      INTEGER NOT NULL DEFAULT 1,
      unidades_inferidas INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS ix_shvar_producto ON shopify_variante(producto_id);
    CREATE INDEX IF NOT EXISTS ix_shvar_sku      ON shopify_variante(sku);
    CREATE INDEX IF NOT EXISTS ix_shprod_tipo    ON shopify_producto(tipo);
    CREATE INDEX IF NOT EXISTS ix_shprod_disp    ON shopify_producto(disponible);

    -- Búsqueda de texto: sin esto, "globo dorado corazón" sobre 1700+
    -- productos es un LIKE que recorre toda la tabla en cada turno del chat.
    CREATE VIRTUAL TABLE IF NOT EXISTS shopify_fts USING fts5(
      id UNINDEXED, titulo_limpio, descripcion_txt, tags, colores, ocasiones,
      tokenize = "unicode61 remove_diacritics 2"
    );

    CREATE TABLE IF NOT EXISTS shopify_sync (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      iniciado_en    TEXT NOT NULL,
      terminado_en   TEXT,
      productos      INTEGER,
      variantes      INTEGER,
      inventario_cruzado INTEGER,
      error          TEXT
    );

    -- Biblioteca visual para construir datasets y propuestas. Categorías
    -- representan ocasiones; tipos representan el papel visual del elemento.
    CREATE TABLE IF NOT EXISTS arquitectura_categorias (
      id          TEXT PRIMARY KEY,
      slug        TEXT NOT NULL UNIQUE,
      nombre      TEXT NOT NULL,
      descripcion TEXT,
      color       TEXT NOT NULL DEFAULT '#63d8c5',
      activa      INTEGER NOT NULL DEFAULT 1,
      orden       INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS arquitectura_tipos (
      id          TEXT PRIMARY KEY,
      slug        TEXT NOT NULL UNIQUE,
      nombre      TEXT NOT NULL,
      nivel       TEXT NOT NULL CHECK(nivel IN ('component', 'module', 'composition')),
      descripcion TEXT,
      activo      INTEGER NOT NULL DEFAULT 1,
      orden       INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS arquitectura_elementos (
      id                  TEXT PRIMARY KEY,
      shopify_producto_id TEXT NOT NULL UNIQUE REFERENCES shopify_producto(id) ON DELETE CASCADE,
      tipo_id             TEXT NOT NULL REFERENCES arquitectura_tipos(id),
      nombre              TEXT NOT NULL,
      imagen_url          TEXT,
      presupuestos        TEXT NOT NULL DEFAULT '["low","mid","high"]',
      notas               TEXT,
      activo              INTEGER NOT NULL DEFAULT 1,
      creado_en           TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      actualizado_en      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS arquitectura_elemento_categorias (
      elemento_id  TEXT NOT NULL REFERENCES arquitectura_elementos(id) ON DELETE CASCADE,
      categoria_id TEXT NOT NULL REFERENCES arquitectura_categorias(id) ON DELETE CASCADE,
      PRIMARY KEY (elemento_id, categoria_id)
    );

    CREATE INDEX IF NOT EXISTS ix_arq_elementos_tipo ON arquitectura_elementos(tipo_id);
    CREATE INDEX IF NOT EXISTS ix_arq_elemento_categoria ON arquitectura_elemento_categorias(categoria_id);
  `);

  // Migración ligera: la tabla puede existir de una sincronización anterior
  // a que se agregara esta columna. SQLite no tiene "ADD COLUMN IF NOT
  // EXISTS", así que se intenta y se ignora el error de columna duplicada.
  try {
    db.exec("ALTER TABLE shopify_producto ADD COLUMN imagenes TEXT NOT NULL DEFAULT '[]'");
  } catch {
    // ya existe
  }
  try {
    db.exec("ALTER TABLE shopify_producto ADD COLUMN descripcion_datos TEXT NOT NULL DEFAULT '{}'");
  } catch {
    // ya existe
  }

  // 4 franjas de presupuesto (PLAN_RAG_FRANJAS_PRESUPUESTO.md §5.2/§5.3):
  // `presupuestos_v1` guarda el valor original low/mid/high como respaldo
  // ANTES de reescribirlo — así la migración se puede auditar o revertir sin
  // necesitar un backup completo de la base. `rol_presupuesto` conecta cada
  // tipo de arquitectura visual con el vocabulario de roles del retrieval
  // (focal/soporte/relleno/acento/servicio) para que el admin pueda preferir
  // elementos curados sobre los inferidos por categoría (§5.3).
  try {
    db.exec("ALTER TABLE arquitectura_elementos ADD COLUMN presupuestos_v1 TEXT");
  } catch {
    // ya existe
  }
  try {
    db.exec("ALTER TABLE arquitectura_tipos ADD COLUMN rol_presupuesto TEXT");
  } catch {
    // ya existe
  }
  migrarPresupuestosLegado(db);

  const yaSembrado = db.prepare("SELECT 1 FROM meta WHERE clave = 'catalogo_sembrado'").get();

  if (!yaSembrado) {
    // Migración: una base creada antes de que existiera esta marca puede ya
    // tener productos. En ese caso solo se registra la marca, sin reinsertar
    // (chocaría con la llave primaria). Solo se siembra si de verdad está vacía.
    const { total } = db.prepare("SELECT COUNT(*) AS total FROM productos").get() as {
      total: number;
    };

    if (total === 0) {
      const insertar = db.prepare(
        `INSERT INTO productos (id, nombre, categoria, descripcion, precio, estilos, colores, emoji, tono, foto)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const p of CATALOGO_SEED) {
        insertar.run(
          p.id,
          p.nombre,
          p.categoria,
          p.descripcion,
          p.precio,
          JSON.stringify(p.estilos),
          JSON.stringify(p.colores),
          p.emoji ?? null,
          p.tono ?? null,
          p.foto ?? null,
        );
      }
    }

    db.prepare("INSERT INTO meta (clave, valor) VALUES ('catalogo_sembrado', '1')").run();
  }

  const categoriasIniciales = [
    ["cat-boda", "boda", "Boda", "Ceremonias, recepciones y celebraciones de pareja", "#d9b8a5"],
    ["cat-cumple-infantil", "cumpleanos-infantil", "Cumpleaños infantil", "Cumpleaños para niños con tema definido", "#f6a6c8"],
    ["cat-cumple-adulto", "cumpleanos-adulto", "Cumpleaños adulto", "Celebraciones de cumpleaños para adultos", "#d7a45b"],
    ["cat-quince", "quince-anos", "Quince años", "Fiestas de quince años y celebraciones juveniles", "#c6a6ef"],
    ["cat-halloween", "halloween", "Halloween", "Decoraciones de Halloween", "#f28a45"],
    ["cat-navidad", "navidad", "Navidad", "Eventos y montajes navideños", "#78b68a"],
    ["cat-fiesta-infantil", "fiesta-infantil", "Fiesta infantil", "Fiestas infantiles no limitadas a cumpleaños", "#79b9e8"],
    ["cat-graduacion", "graduacion", "Graduación", "Grados, ceremonias y celebraciones académicas", "#8fa4d8"],
    ["cat-generico", "generico", "Genérico", "Montajes reutilizables entre ocasiones", "#8fa7a3"],
  ] as const;
  const insertarCategoria = db.prepare(
    "INSERT OR IGNORE INTO arquitectura_categorias (id, slug, nombre, descripcion, color, orden) VALUES (?, ?, ?, ?, ?, ?)",
  );
  categoriasIniciales.forEach((categoria, orden) => insertarCategoria.run(...categoria, orden));

  const tiposIniciales = [
    ["type-globo-latex", "globo-latex", "Globo de látex", "component", "Globos redondos, modelables y especiales de látex"],
    ["type-globo-metalizado", "globo-metalizado", "Globo metalizado", "component", "Globos foil, figuras y globos impresos"],
    ["type-fondo", "fondo-cortina", "Fondo o cortina", "component", "Cortinas, paneles, fondos y telas"],
    ["type-estructura", "estructura-soporte", "Estructura o soporte", "component", "Bases, marcos y soportes físicos"],
    ["type-mesa", "mesa-vajilla", "Mesa y vajilla", "component", "Manteles, platos, vasos y servicio de mesa"],
    ["type-accesorio", "accesorio-tematico", "Accesorio temático", "component", "Letreros, festones, figuras y detalles"],
    ["type-iluminacion", "iluminacion", "Iluminación", "component", "Luces y elementos luminosos"],
    ["type-arco", "arco", "Arco", "module", "Arcos orgánicos y estructurados"],
    ["type-guirnalda", "guirnalda", "Guirnalda", "module", "Guirnaldas y tramos decorativos"],
    ["type-bouquet", "bouquet", "Bouquet", "module", "Bouquets y grupos de globos"],
    ["type-mesa-decorada", "mesa-decorada", "Mesa decorada", "module", "Mesa focal con productos y accesorios"],
    ["type-setup", "setup-completo", "Setup completo", "composition", "Decoración terminada dentro de un espacio real"],
  ] as const;
  const insertarTipo = db.prepare(
    "INSERT OR IGNORE INTO arquitectura_tipos (id, slug, nombre, nivel, descripcion, orden) VALUES (?, ?, ?, ?, ?, ?)",
  );
  tiposIniciales.forEach((tipo, orden) => insertarTipo.run(...tipo, orden));
  // Después de sembrar los tipos iniciales: si se asignara antes, un primer
  // arranque en limpio no tendría filas todavía y la asignación sería un
  // no-op silencioso para siempre.
  asignarRolesPresupuestoATipos(db);

  return db;
}

export function getDb(): DatabaseSync {
  if (!globalThis.__db) globalThis.__db = crearConexion();
  return globalThis.__db;
}

/** Ajustes globales de una sola fila (ej. proveedor de IA activo). */
export function obtenerMeta(clave: string): string | undefined {
  const fila = getDb().prepare("SELECT valor FROM meta WHERE clave = ?").get(clave) as
    | { valor: string }
    | undefined;
  return fila?.valor;
}

export function guardarMeta(clave: string, valor: string): void {
  getDb()
    .prepare(
      "INSERT INTO meta (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor",
    )
    .run(clave, valor);
}
