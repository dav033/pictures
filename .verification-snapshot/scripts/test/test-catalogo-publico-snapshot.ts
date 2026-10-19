/**
 * El catálogo público (/catalogo, su ficha y `/api/catalogo/piezas`) en una instancia de Vercel: su SQLite vive en /tmp, arranca
 * VACÍA y nadie la llena, y la página decía «0 productos». Aquí se reproduce: se apunta el directorio temporal a una carpeta
 * nueva y VERCEL=1 antes de abrir la base (src/lib/db.ts), y se comprueba que, vacía, la instancia se siembra sola con el
 * snapshot del código (`datos/catalogo-publico.json`) y lista productos, facetas y fichas. Sin coste, sin red, sin Neon.
 *
 * Run: NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-catalogo-publico-snapshot.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const carpetaTemporal = mkdtempSync(path.join(tmpdir(), "catalogo-publico-"));
// Antes de importar `db.ts`: lee VERCEL y `tmpdir()` al cargarse, igual que una instancia nueva de Vercel.
process.env.VERCEL = "1";
process.env.TMPDIR = carpetaTemporal;
process.env.TEMP = carpetaTemporal;
process.env.TMP = carpetaTemporal;

let pruebas = 0;
async function prueba(nombre: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  pruebas += 1;
  console.log(`  ✓ ${nombre}`);
}

async function main(): Promise<void> {
  const { getDb } = await import("../../src/lib/db");
  const { asegurarCatalogo } = await import("../../src/lib/shopify/catalogo-vigente");
  const { buscarCatalogoShopify, estadoSync, explorarCatalogo, facetasCatalogo, productoPorHandle } = await import("../../src/lib/shopify/consultas");
  const { leerSnapshotCatalogo, SnapshotCatalogoInvalidoError } = await import("../../src/lib/shopify/snapshot-esquema");
  const { POST: piezasPOST } = await import("../../src/app/api/catalogo/piezas/route");

  const snapshot = leerSnapshotCatalogo(JSON.parse(readFileSync(new URL("../../src/lib/shopify/datos/catalogo-publico.json", import.meta.url), "utf8")));
  const db = getDb();

  await prueba("una instancia nueva (SQLite vacía) no tiene catálogo: así salía «0 productos»", () => {
    assert.equal(explorarCatalogo({ solo_disponibles: true }, 1, 40).total, 0);
    assert.equal(estadoSync().productos, 0);
  });

  await prueba("llamadas a la vez comparten una sola siembra con el snapshot completo", async () => {
    await Promise.all(Array.from({ length: 8 }, () => asegurarCatalogo()));
    const { productos, variantes, ultimoSync } = estadoSync();
    assert.equal(productos, snapshot.productos.length);
    assert.equal(variantes, snapshot.productos.reduce((n, p) => n + p.variantes.length, 0));
    const filasDeSync = db.prepare("SELECT COUNT(*) AS n FROM shopify_sync").get() as { n: number };
    assert.equal(filasDeSync.n, 1, "una sola siembra, no una por llamada");
    assert.equal(ultimoSync?.terminadoEn, snapshot.generadoEn, "el último sync dice de cuándo son los datos");
    assert.equal(ultimoSync?.error, null);
  });

  await prueba("/catalogo lista productos con handle, nombre, imagen y precio, y pagina", () => {
    const primera = explorarCatalogo({ solo_disponibles: true }, 1, 40);
    assert.ok(primera.total > 1000, `solo ${primera.total} productos`);
    assert.equal(primera.productos.length, 40);
    for (const producto of primera.productos) {
      assert.ok(producto.handle && producto.nombre, "tarjeta sin handle o nombre");
      assert.ok(producto.precioMin > 0 && producto.precioMax >= producto.precioMin, `${producto.handle}: precio ${producto.precioMin}–${producto.precioMax}`);
    }
    assert.ok(primera.productos.some((p) => p.imagen), "ninguna tarjeta trae imagen");
    const segunda = explorarCatalogo({ solo_disponibles: true }, 2, 40);
    assert.notEqual(segunda.productos[0]?.handle, primera.productos[0]?.handle);
  });

  await prueba("los filtros del catálogo (texto, categoría, color) responden con la base sembrada", () => {
    const facetas = facetasCatalogo();
    assert.ok(facetas.categorias.length > 3 && facetas.colores.length > 3 && facetas.formas.length > 0, "facetas vacías");
    assert.ok(facetas.precioMin > 0 && facetas.precioMax > facetas.precioMin);
    const porCategoria = explorarCatalogo({ categorias: [facetas.categorias[0]!.valor], solo_disponibles: true }, 1, 40);
    assert.ok(porCategoria.total > 0);
    const porColor = explorarCatalogo({ colores: [facetas.colores[0]!.valor], solo_disponibles: true }, 1, 40);
    assert.ok(porColor.total > 0);
    assert.ok(explorarCatalogo({ texto: "globo", solo_disponibles: true }, 1, 40).total > 0, "la búsqueda de texto (FTS5) no encontró «globo»");
  });

  await prueba("/catalogo/[handle]: la ficha trae variantes con precio, y un handle que no existe no inventa nada", () => {
    const { productos } = explorarCatalogo({ solo_disponibles: true }, 1, 5);
    for (const tarjeta of productos) {
      const ficha = productoPorHandle(tarjeta.handle);
      assert.ok(ficha, tarjeta.handle);
      assert.equal(ficha.nombre, tarjeta.nombre);
      assert.ok(ficha.variantes.length > 0 && ficha.variantes.every((v) => v.precio > 0), `${tarjeta.handle}: variantes sin precio`);
    }
    assert.equal(productoPorHandle("b2b-globo-que-no-existe"), null);
  });

  /** Una instancia de Vercel recién arrancada: sin catálogo y sin rastro de sincronizaciones. */
  const vaciarComoInstanciaNueva = () => {
    db.exec("DELETE FROM shopify_variante; DELETE FROM shopify_producto; DELETE FROM shopify_fts; DELETE FROM shopify_sync;");
    assert.equal(estadoSync().productos, 0);
  };

  await prueba("/api/catalogo/piezas, en una instancia vacía, responde con piezas reales (se siembra sola)", async () => {
    vaciarComoInstanciaNueva();
    const respuesta = await piezasPOST(new Request("https://app.test/api/catalogo/piezas", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ texto: "globo", limite: 5 }) }));
    assert.equal(respuesta.status, 200);
    const cuerpo = (await respuesta.json()) as { productos: Array<{ id: string; precio: number }>; total: number };
    assert.ok(cuerpo.total > 0 && cuerpo.productos.length === 5, `total ${cuerpo.total}`);
    assert.ok(cuerpo.productos.every((p) => p.id && p.precio > 0));
    assert.equal(buscarCatalogoShopify({ texto: "globo", limite: 5 }).resultados.length, 5);
  });

  await prueba("las páginas del catálogo siembran antes de leer (una página de servidor no se puede montar fuera de Next)", () => {
    const orden: Array<[archivo: string, lectura: string]> = [
      ["../../src/app/catalogo/page.tsx", "explorarCatalogo("],
      ["../../src/app/catalogo/[handle]/page.tsx", "productoPorHandle("],
    ];
    for (const [archivo, lectura] of orden) {
      const fuente = readFileSync(new URL(archivo, import.meta.url), "utf8");
      const siembra = fuente.indexOf("await asegurarCatalogo()");
      const lee = fuente.indexOf(lectura);
      assert.ok(siembra > 0 && lee > siembra, `${archivo}: tiene que hacer «await asegurarCatalogo()» antes de ${lectura}`);
    }
  });

  await prueba("una base que ya tiene catálogo (un sync en vivo, el disco del PC) no se vuelve a sembrar", async () => {
    db.prepare("UPDATE shopify_producto SET titulo_limpio = 'Editado por un sync en vivo' WHERE id = (SELECT id FROM shopify_producto LIMIT 1)").run();
    await asegurarCatalogo();
    const editados = db.prepare("SELECT COUNT(*) AS n FROM shopify_producto WHERE titulo_limpio = 'Editado por un sync en vivo'").get() as { n: number };
    assert.equal(editados.n, 1);
  });

  await prueba("el snapshot es el catálogo público (B2C): sin handles b2b-, handles únicos y todo con precio", () => {
    const handles = snapshot.productos.map((p) => p.handle);
    assert.equal(new Set(handles).size, handles.length, "handles repetidos");
    assert.deepEqual(handles.filter((h) => h.startsWith("b2b-")), [], "el catálogo B2B no es el de esta página (precios mayoristas, handles que la tienda pública no tiene)");
    assert.ok(snapshot.productos.every((p) => p.variantes.some((v) => v.precio > 0)));
    assert.ok(Date.parse(snapshot.generadoEn) <= new Date().getTime(), "el snapshot es del futuro");
  });

  await prueba("un snapshot dañado se rechaza con un error tipado, sin sembrar basura", () => {
    for (const malo of [null, {}, { version: 2, generadoEn: snapshot.generadoEn, productos: snapshot.productos }, { version: 1, generadoEn: "ayer", productos: snapshot.productos }, { version: 1, generadoEn: snapshot.generadoEn, productos: [] }]) {
      assert.throws(() => leerSnapshotCatalogo(malo), (error: unknown) => error instanceof SnapshotCatalogoInvalidoError && error.code === "SNAPSHOT_CATALOGO_INVALIDO");
    }
  });

  console.log(`test-catalogo-publico-snapshot: ${pruebas} pruebas ok`);
}

main()
  .catch((error: unknown) => { console.error(error); process.exitCode = 1; })
  .finally(() => {
    (globalThis as { __db?: { close: () => void } }).__db?.close();
    rmSync(carpetaTemporal, { recursive: true, force: true });
  });
