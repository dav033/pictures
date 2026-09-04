// Scraper del blog público "Ideas de Fiesta" de sempertex.com -- cada idea trae foto real
// instalada + carrusel "Adquiere los productos de este Blog" (nombre + link a /products/<handle>,
// que matchea EXACTO el handle sincronizado en shopify_producto) + tags de ocasión/estructura.
// Mismo patrón que el pipeline de órdenes reales (foto + desglose + feedback + caption), pero la
// fuente es contenido oficial de marca en vez de una orden de cliente -- no requiere sesión ni
// Chrome, todo el contenido está en el HTML plano (confirmado con curl).
//
// Uso: npx tsx scripts/scrape-ideas-fiesta.ts --paginas=1-3 [--limite=10] [--sin-caption]
//      [--particion=k/n] para repartir el trabajo entre n procesos en paralelo (ver main).

import { DatabaseSync } from "node:sqlite";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { generarCaption } from "../src/lib/ordenes/generarCaption";
import type { CategoriaEntrenamiento, Desglose, FeedbackFoto, LineaDesglose } from "../src/lib/ordenes/tipos";

const RUTA_ORDENES = "C:\\Users\\davidt\\Downloads\\ordenes-decoracion";
const BASE_URL = "https://sempertex.com";
const LISTADO_URL = `${BASE_URL}/blogs/idea-de-fiesta`;
// Rango numérico reservado para no chocar con números de orden reales (4-6 dígitos) ni con IDs
// de "Agregar imagen" manual (timestamps de 13 dígitos, siempre arrancan en "17...").
const ID_BASE = 950_000_000;

const db = new DatabaseSync(path.join(process.cwd(), "data", "demo.sqlite"));

type ProductoDesglose = {
  handle: string;
  titulo: string;
  precioListado: number;
};

type IdeaScrapeada = {
  slug: string;
  titulo: string;
  imagenUrl: string | null;
  productos: ProductoDesglose[];
  tags: string[];
};

const TIPOS_ESTRUCTURA = new Set(["arco", "semiarco", "guirnalda", "columna", "pared", "bouquet", "centro_mesa", "otro"]);
// Los tags de "DISEÑO" del blog no calzan 1:1 con nuestro enum -- mapeo a criterio, todo lo que
// no matchea cae en "otro" en vez de forzar una categoría incorrecta.
const MAPA_ESTRUCTURA: Record<string, string> = {
  arco: "arco",
  bouquet: "bouquet",
  "centro de mesa": "centro_mesa",
  columna: "columna",
  pared: "pared",
  "murales & mallas": "pared",
  murales: "pared",
  techo: "otro",
  figuras: "otro",
};

// Las MOTIVOS/FESTIVIDADES del blog a veces nombran el tema casi literal ("Amor y Amistad",
// "Halloween", "Navidad") -- aprovechar eso para no dejar todo en "general" a mano.
const MAPA_CATEGORIA: Array<{ patron: RegExp; categoria: CategoriaEntrenamiento }> = [
  { patron: /amor y amistad|san valent/i, categoria: "amor_y_amistad" },
  { patron: /halloween/i, categoria: "halloween" },
  { patron: /navidad|año nuevo/i, categoria: "navidad" },
  { patron: /quince|xv años/i, categoria: "xv_anos" },
  { patron: /infantil|baby shower|bautizo/i, categoria: "fiesta_infantil" },
  { patron: /cumplea/i, categoria: "fiesta_generica" },
];

function categoriaDesdeTags(tags: string[], titulo: string): CategoriaEntrenamiento {
  const textoCompleto = [...tags, titulo].join(" ").toLowerCase();
  for (const { patron, categoria } of MAPA_CATEGORIA) {
    if (patron.test(textoCompleto)) return categoria;
  }
  return "no_asignada";
}

function tipoEstructuraDesdeTags(tags: string[], titulo: string): string | null {
  for (const tag of tags) {
    const m = MAPA_ESTRUCTURA[tag.trim().toLowerCase()];
    if (m) return m;
  }
  // Los tags de una nota no siempre incluyen la categoría de DISEÑO (estructura) -- muchas
  // veces solo traen ocasión/motivo (ej. "Amor", "Amor y Amistad"). Como fallback, el título
  // de la nota suele nombrar la estructura directo ("BOUQUET CORAZON", "ARCO DE FLORES...").
  // \b de límite de palabra es necesario -- sin eso "MARCO" (frame) matchea "arco" por
  // substring y clasifica mal.
  const textoTitulo = titulo.toLowerCase();
  for (const [clave, valor] of Object.entries(MAPA_ESTRUCTURA)) {
    const regex = new RegExp(`\\b${clave.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
    if (regex.test(textoTitulo)) return valor;
  }
  return null;
}

const ENTIDADES_HTML: Record<string, string> = {
  "&ndash;": "–",
  "&mdash;": "—",
  "&amp;": "&",
  "&aacute;": "á",
  "&eacute;": "é",
  "&iacute;": "í",
  "&oacute;": "ó",
  "&uacute;": "ú",
  "&ntilde;": "ñ",
  "&Aacute;": "Á",
  "&Eacute;": "É",
  "&Iacute;": "Í",
  "&Oacute;": "Ó",
  "&Uacute;": "Ú",
  "&Ntilde;": "Ñ",
  "&#39;": "'",
  "&quot;": '"',
};

function decodificarEntidades(texto: string): string {
  return texto.replace(/&[a-zA-Z#0-9]+;/g, (m) => ENTIDADES_HTML[m] ?? m);
}

async function obtenerSlugsDePagina(pagina: number): Promise<string[]> {
  const res = await fetch(`${LISTADO_URL}?page=${pagina}`);
  if (!res.ok) return [];
  const html = await res.text();
  const matches = [...html.matchAll(/href="\/blogs\/idea-de-fiesta\/([a-z0-9-]+)"/g)];
  return [...new Set(matches.map((m) => m[1]))];
}

async function scrapearIdea(slug: string): Promise<IdeaScrapeada | null> {
  const res = await fetch(`${LISTADO_URL}/${slug}`);
  if (!res.ok) return null;
  const html = await res.text();

  const tituloCrudo = html.match(/<title>([^<]+)<\/title>/)?.[1] ?? slug;
  const titulo = decodificarEntidades(tituloCrudo)
    .replace(/[–—]?\s*Sempertex\s*$/i, "")
    .trim();

  // La imagen principal de la nota (cdn.shopify.com/.../articles/...) -- se toma la primera de
  // mayor resolución, evitando thumbnails chicos que Shopify a veces linkea antes en el HTML.
  const imgs = [...html.matchAll(/https:\/\/(?:sempertex\.com|cdn\.shopify\.com)\/cdn\/shop\/articles\/[^\s"?]+\.(?:jpg|jpeg|png|webp)/gi)];
  const imagenUrl = imgs[0]?.[0] ?? null;

  const bloques = [...html.matchAll(/href="\/products\/([a-z0-9-]+)"[^>]*>[\s\S]{0,300}?<\/a>/g)];
  const productosMap = new Map<string, ProductoDesglose>();
  for (const bloque of bloques) {
    const handle = bloque[1];
    if (productosMap.has(handle)) continue;
    const bloqueTexto = bloque[0];
    const tituloProducto = bloqueTexto.match(/>([^<>]{4,120})<\/a>/)?.[1]?.trim();
    const precio = Number((bloqueTexto.match(/\$\s?([\d.,]+)/)?.[1] ?? "0").replace(/\./g, "").replace(",", "."));
    if (tituloProducto) productosMap.set(handle, { handle, titulo: tituloProducto, precioListado: precio || 0 });
  }

  const tags = [...html.matchAll(/href="\/blogs\/idea-de-fiesta\/tagged\/[a-z0-9-]+">([^<]+)</g)].map((m) =>
    decodificarEntidades(m[1]).trim(),
  );

  return { slug, titulo, imagenUrl, productos: [...productosMap.values()], tags };
}

type FilaCatalogo = {
  id: string;
  titulo_limpio: string;
  imagen_principal: string | null;
};
type FilaVariante = {
  sku: string | null;
  precio: number;
  tamano_codigo: string | null;
  option1: string | null;
};

function catalogoPorHandle(handle: string): { producto: FilaCatalogo; variante: FilaVariante } | null {
  const producto = db.prepare(`SELECT id, titulo_limpio, imagen_principal FROM shopify_producto WHERE handle = ?`).get(handle) as
    | FilaCatalogo
    | undefined;
  if (!producto) return null;
  const variante = db
    .prepare(`SELECT sku, precio, tamano_codigo, option1 FROM shopify_variante WHERE producto_id = ? AND disponible = 1 ORDER BY precio ASC LIMIT 1`)
    .get(producto.id) as FilaVariante | undefined;
  if (!variante) return null;
  return { producto, variante };
}

async function descargarImagen(url: string, destino: string): Promise<boolean> {
  const res = await fetch(url);
  if (!res.ok) return false;
  const buffer = Buffer.from(await res.arrayBuffer());
  await writeFile(destino, buffer);
  return true;
}

function parsearRangoPaginas(spec: string): number[] {
  const [ini, fin] = spec.split("-").map(Number);
  const paginas: number[] = [];
  for (let p = ini; p <= (fin || ini); p++) paginas.push(p);
  return paginas;
}

async function main(): Promise<void> {
  const args = Object.fromEntries(
    process.argv.slice(2).map((a) => {
      const [k, v] = a.replace(/^--/, "").split("=");
      return [k, v ?? "true"];
    }),
  );
  const paginas = parsearRangoPaginas(String(args.paginas ?? "1"));
  const limite = args.limite ? Number(args.limite) : Infinity;
  const sinCaption = Boolean(args["sin-caption"]);
  // Partición para correr varias instancias a la vez sin que se pisen: TODAS recorren la misma
  // lista global de slugs -- el número de orden sale del índice en esa lista, no de un contador
  // propio de cada proceso, así que la numeración queda idéntica a una corrida secuencial y dos
  // procesos nunca escriben la misma carpeta. Cada uno se queda con uno de cada `totalPartes`.
  const [parteStr, totalStr] = String(args.particion ?? "1/1").split("/");
  const parte = Number(parteStr);
  const totalPartes = Number(totalStr || 1);
  if (!Number.isInteger(parte) || !Number.isInteger(totalPartes) || parte < 1 || parte > totalPartes) {
    throw new Error(`--particion inválida: "${args.particion}" (formato k/n con 1 <= k <= n)`);
  }

  console.log(`Recorriendo páginas ${paginas[0]}-${paginas.at(-1)} del listado...`);
  const slugs: string[] = [];
  for (const p of paginas) {
    const s = await obtenerSlugsDePagina(p);
    slugs.push(...s);
    console.log(`  página ${p}: ${s.length} ideas`);
  }
  const slugsUnicos = [...new Set(slugs)].slice(0, limite);
  const propias = slugsUnicos.filter((_, i) => i % totalPartes === parte - 1).length;
  console.log(
    totalPartes > 1
      ? `Total ideas: ${slugsUnicos.length} -- esta partición (${parte}/${totalPartes}) procesa ${propias}`
      : `Total ideas a procesar: ${slugsUnicos.length}`,
  );

  let ok = 0;
  let sinProductosMapeables = 0;
  let sinImagen = 0;
  let errores = 0;

  for (const [indice, slug] of slugsUnicos.entries()) {
    if (indice % totalPartes !== parte - 1) continue;
    const numero = String(ID_BASE + indice + 1);
    try {
      const idea = await scrapearIdea(slug);
      if (!idea || !idea.imagenUrl) {
        sinImagen += 1;
        console.log(`[${slug}] sin imagen, salto`);
        continue;
      }

      const lineas: LineaDesglose[] = [];
      for (const p of idea.productos) {
        const match = catalogoPorHandle(p.handle);
        if (!match) continue;
        lineas.push({
          producto: match.producto.titulo_limpio,
          variante: match.variante.tamano_codigo ?? match.variante.option1,
          sku: match.variante.sku,
          cantidad: 1,
          precioUnitario: match.variante.precio,
        });
      }
      if (lineas.length === 0) {
        sinProductosMapeables += 1;
        console.log(`[${slug}] ningún producto del carrusel matchea el catálogo local, salto`);
        continue;
      }

      const carpetaOrden = path.join(RUTA_ORDENES, numero);
      await mkdir(carpetaOrden, { recursive: true });

      const extension = idea.imagenUrl.match(/\.(jpg|jpeg|png|webp)/i)?.[1]?.toLowerCase() ?? "jpg";
      const archivoFoto = `foto-1.${extension === "jpeg" ? "jpg" : extension}`;
      const rutaFoto = path.join(carpetaOrden, archivoFoto);
      const bajada = await descargarImagen(idea.imagenUrl, rutaFoto);
      if (!bajada) {
        sinImagen += 1;
        console.log(`[${slug}] no se pudo descargar la imagen, salto`);
        continue;
      }

      const desglose: Desglose = { orden: numero, cliente: null, fecha: null, lineas };
      await writeFile(path.join(carpetaOrden, "desglose.json"), JSON.stringify(desglose, null, 2), "utf-8");

      const tipoEstructura = tipoEstructuraDesdeTags(idea.tags, idea.titulo);

      const feedback: FeedbackFoto = {
        orden: numero,
        foto: archivoFoto,
        esDecoracion: true,
        decoracionCompleta: true,
        elementoPrincipal: idea.titulo,
        fidelidadImagen: "alta",
        productosRepresentados: lineas.map((l) => ({
          producto: `${l.producto}${l.variante ? ` (${l.variante})` : ""}`,
          representado: true,
        })),
        // El blog mezcla piezas de estudio con fondo blanco (sin venue) y escenas de showroom
        // instaladas de verdad -- no hay forma barata de distinguirlas por metadata, así que
        // arranca en false hasta que alguien la revise a mano en Lista/Galería (a diferencia de
        // las órdenes reales, donde casi siempre es escena real aunque sea casera).
        aptoParaEntrenamiento: false,
        categoria: categoriaDesdeTags(idea.tags, idea.titulo),
        notas: `Fuente: blog oficial Sempertex "Ideas de Fiesta" (${LISTADO_URL}/${slug}), no es una orden real de cliente. Productos = carrusel "Adquiere los productos de este Blog" de esa nota, cruzados contra el catálogo local. Pendiente confirmar a mano si es escena real instalada o pieza de estudio con fondo blanco.`,
        revisadoEn: new Date().toISOString(),
        fuente: "ia_automatica",
      };
      await writeFile(path.join(carpetaOrden, "feedback-1.json"), JSON.stringify(feedback, null, 2), "utf-8");

      if (!sinCaption) {
        const resultado = generarCaption(numero, archivoFoto, rutaFoto, desglose, feedback, tipoEstructura);
        await writeFile(path.join(carpetaOrden, "caption-1.json"), JSON.stringify(resultado.caption, null, 2), "utf-8");
      }

      ok += 1;
      console.log(`[${slug}] -> orden #${numero} OK (${lineas.length} materiales, tipo=${tipoEstructura ?? "sin determinar"})`);
    } catch (error) {
      errores += 1;
      console.error(`[${slug}] error:`, error instanceof Error ? error.message : error);
    }
  }

  console.log(`\nListo (partición ${parte}/${totalPartes}). OK: ${ok} | sin productos mapeables: ${sinProductosMapeables} | sin imagen: ${sinImagen} | errores: ${errores}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
