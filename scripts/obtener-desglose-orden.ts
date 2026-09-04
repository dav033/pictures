// Fase 2 (parte 1): dado un número de orden, busca la orden real en Shopify Admin y guarda
// desglose.json en su carpeta con los line items tal cual (producto, variante, sku, cantidad,
// precio). Esta es la fuente de verdad de materiales — reemplaza adivinar colores/acabados
// por visión (ver docs/data/PLAN-ENTRENAMIENTO-SEMPERTEX-v002.md y la discusión sobre
// precisión de captions).
//
// La URL de una orden no se puede construir desde su número (#20772 no mapea a un ID interno
// de forma predecible, confirmado a mano) — hay que buscarla desde el listado de órdenes.
//
// Shopify Admin usa shadow DOM (Polaris) — `document.querySelectorAll` normal desde
// page.evaluate no ve nada útil ahí (confirmado a mano). page.locator(...) de Playwright sí
// atraviesa shadow DOM porque resuelve el selector con su propio motor antes de tocar el DOM,
// y `locator.ariaSnapshot()` da un árbol de accesibilidad en texto plano — de ahí se parsea
// todo con regex normales, sin pelear con shadow roots.
//
// Reusa el mismo Chrome dedicado y CDP que revie-build-index.ts.

import { chromium, type Page } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const CDP_URL = "http://localhost:9222";
const RUTA_ORDENES = "C:\\Users\\davidt\\Downloads\\ordenes-decoracion";
const ORDERS_URL = "https://admin.shopify.com/store/sempertexcolombia/orders";

type LineaDesglose = {
  producto: string;
  variante: string | null;
  sku: string | null;
  cantidad: number;
  precioUnitario: number;
};

type Desglose = {
  orden: string;
  cliente: string | null;
  fecha: string | null;
  lineas: LineaDesglose[];
};

async function buscarUrlOrden(page: Page, numeroOrden: string): Promise<string | null> {
  await page.goto(`${ORDERS_URL}?query=${numeroOrden}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  const link = page.locator("a", { hasText: `#${numeroOrden}` }).first();
  if ((await link.count()) === 0) return null;
  const href = await link.getAttribute("href");
  if (!href) return null;
  return new URL(href, "https://admin.shopify.com").toString();
}

function parsearLineas(snapshot: string): LineaDesglose[] {
  const lineas: LineaDesglose[] = [];
  // El ":" al final de la línea del heading es un artefacto de YAML que ariaSnapshot() solo
  // agrega cuando el heading tiene hijos anidados en el árbol de accesibilidad -- algunos
  // productos (ej. inscripciones a curso, sin variante anidada bajo el heading) no lo tienen,
  // así que exigirlo dejaba esas líneas sin detectar. Opcional en vez de obligatorio.
  const bloques = snapshot.split(/(?=- heading "[^"]+" \[level=3\]:?\s*$)/m);

  for (const bloque of bloques) {
    const producto = bloque.match(/- heading "([^"]+)" \[level=3\]:?\s*$/m)?.[1];
    if (!producto) continue;

    const variante = bloque.match(/- button "([^"]+)":\s*\n\s*- paragraph: /)?.[1] ?? null;
    const sku = bloque.match(/- text: SKU\s*\n\s*- button "([^"]+)"/)?.[1] ?? null;
    // "$8,775.00": coma es separador de miles, el punto es de centavos — quitar la coma y
    // truncar en el punto (no strippear ambos, o "8,775.00" se vuelve "877500"). La etiqueta
    // cambia entre "Sale price" (con descuento) y "Unit price" (sin descuento).
    const precioUnitario =
      Number((bloque.match(/(?:Sale price|Unit price) \$?([\d.,]+)/)?.[1] ?? "0").replace(/,/g, "").split(".")[0]) || 0;
    const cantidad = Number(bloque.match(/paragraph: ×\s*\n\s*- paragraph: "(\d+)"/)?.[1] ?? "1") || 1;

    // Con el ":" del heading opcional, cualquier heading nivel 3 de la página entra al split
    // (Timeline, Additional details, Contact information, ...) -- un producto real siempre
    // trae SKU o precio, esas secciones nunca, así que sirve para descartarlas.
    if (!sku && precioUnitario === 0) continue;

    lineas.push({ producto, variante, sku, cantidad, precioUnitario });
  }
  return lineas;
}

async function extraerDesglose(page: Page, numeroOrden: string): Promise<Desglose> {
  const snapshot = await page.locator("main.page").ariaSnapshot();
  const lineas = parsearLineas(snapshot);

  const fecha = snapshot.match(/(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}/)?.[0] ?? null;

  // Puede haber más de un link a /customers/ (ej. avatar + nombre) — nos quedamos con el
  // primero que realmente tenga texto visible.
  const textosCliente = await page.locator('[href*="/customers/"]').allInnerTexts();
  const cliente = textosCliente.map((t) => t.trim()).find((t) => t.length > 0) ?? null;

  return { orden: numeroOrden, cliente, fecha, lineas };
}

async function main(): Promise<void> {
  const numeroOrden = process.argv[2]?.replace(/^#/, "").trim();
  if (!numeroOrden || !/^\d+$/.test(numeroOrden)) {
    console.error("Uso: tsx scripts/obtener-desglose-orden.ts <numero_de_orden>");
    process.exit(1);
  }

  const browser = await chromium.connectOverCDP(CDP_URL);
  const contexto = browser.contexts()[0];
  const page = contexto.pages().find((p) => p.url().includes("admin.shopify.com")) ?? (await contexto.newPage());

  const urlOrden = await buscarUrlOrden(page, numeroOrden);
  if (!urlOrden) {
    console.log(JSON.stringify({ orden: numeroOrden, estado: "orden_no_encontrada_en_shopify" }, null, 2));
    process.exit(0);
  }

  await page.goto(urlOrden, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);

  // Órdenes con más contenido (ej. inscripciones a curso con datos de asistentes) a veces
  // siguen renderizando sus line items pasada la espera inicial -- reintentar la lectura del
  // ariaSnapshot unas cuantas veces antes de darse por vencido. getByRole("heading") no sirve
  // acá para esperar: los headings de Polaris no siempre exponen su nivel de forma que
  // getByRole los detecte, aunque ariaSnapshot() sí los reporta bien (visto a mano).
  let desglose = await extraerDesglose(page, numeroOrden);
  for (let intento = 0; desglose.lineas.length === 0 && intento < 4; intento++) {
    await page.waitForTimeout(1500);
    desglose = await extraerDesglose(page, numeroOrden);
  }
  if (desglose.lineas.length === 0) {
    console.log(JSON.stringify({ orden: numeroOrden, estado: "sin_lineas_extraidas", urlOrden }, null, 2));
    process.exit(0);
  }

  const carpetaOrden = path.join(RUTA_ORDENES, numeroOrden);
  await mkdir(carpetaOrden, { recursive: true });
  await writeFile(path.join(carpetaOrden, "desglose.json"), JSON.stringify(desglose, null, 2), "utf-8");

  console.log(JSON.stringify({ estado: "ok", urlOrden, ...desglose }, null, 2));
  process.exit(0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
