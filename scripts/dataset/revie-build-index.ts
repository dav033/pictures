// Construye un índice local {numero_de_orden -> [fotos reales del cliente]} recorriendo
// las reseñas publicadas en Revie (app.revie.ai). Necesario porque el buscador propio de
// Revie no busca de forma confiable por número de orden (confirmado a mano: buscar "19204"
// o "17948" en Reviews/Ordenes no encuentra reseñas que sabemos que existen) — así que en
// vez de buscar en vivo por cada orden, se recorre una sola vez y se cachea localmente.
//
// Revie es una app embebida de Shopify sin login propio: solo autentica cuando se entra vía
// Shopify, y su pantalla de login normal (accounts.shopify.com) bloquea el botón "Continuar"
// cuando detecta un Chromium controlado por automatización (protección anti-bot legítima de
// Shopify — no se debe intentar sortear). Por eso este script NO abre un navegador nuevo: se
// conecta por CDP a un Chrome real ya abierto y ya logueado por el usuario (ver instrucciones
// de arranque en README de este script / mensaje del asistente), y opera sobre esa sesión
// humana tal cual está.
//
// Distingue foto real de cliente vs foto de producto por dominio: las fotos de reseña salen
// de media.revie.lat, las de producto de cdn.shopify.com/.../products/.

import { chromium, type Page } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const CDP_URL = "http://localhost:9222";
const INDEX_PATH = path.resolve("data/manifests/revie-reviews-index.json");
const REVIEWS_URL = "https://app.revie.ai/admin/es/reviews";
const MAX_SCROLLS = 400; // tope de clics en "Cargar más" (20 reseñas por clic) — más que suficiente para las ~3200 actuales

type IndiceOrden = Record<string, { fotos: string[]; cliente: string | null; producto: string | null }>;

async function cargarIndiceExistente(): Promise<IndiceOrden> {
  try {
    const raw = await readFile(INDEX_PATH, "utf-8");
    return JSON.parse(raw) as IndiceOrden;
  } catch {
    return {};
  }
}

/**
 * Revie no redirige a una URL de login distinta cuando no hay sesión — el shell de la SPA
 * carga igual y se queda en skeletons de carga para siempre porque las llamadas a su API
 * fallan en silencio. Por eso la única señal confiable de "sí hay sesión" es ver un número
 * real (formato "3.190", con separador de miles) reemplazar el skeleton de "TOTAL RESEÑAS".
 */
async function hayDatosReales(page: Page): Promise<boolean> {
  try {
    const texto = await page.evaluate(() => document.body.innerText);
    return /TOTAL RESE[ÑN]AS[\s\S]{0,20}?\d{1,3}(\.\d{3})*/i.test(texto);
  } catch {
    // La página puede estar navegando justo en este instante (ej. el usuario acaba de
    // iniciar sesión) — no es un fallo real, solo hay que reintentar en la próxima vuelta.
    return false;
  }
}

async function esperarLogin(page: Page): Promise<void> {
  if (await hayDatosReales(page)) return;
  console.log("La página cargó pero no aparecen datos reales todavía — puede ser lentitud de red. Esperando hasta 1 minuto...");
  const limite = Date.now() + 60_000;
  while (Date.now() < limite) {
    await page.waitForTimeout(3000);
    if (await hayDatosReales(page)) {
      console.log("Datos detectados, continuando.");
      return;
    }
  }
  throw new Error(
    "No se detectaron datos reales de Revie tras 1 minuto. Verificá que en esa pestaña de tu Chrome real ya estés " +
      "logueado en Shopify y hayas entrado a Revie al menos una vez (Apps > Revie), luego volvé a correr el script.",
  );
}

async function extraerTarjetasVisibles(page: Page): Promise<Array<{ orden: string; foto: string; cliente: string | null; producto: string | null }>> {
  return page.evaluate(() => {
    const resultados: Array<{ orden: string; foto: string; cliente: string | null; producto: string | null }> = [];
    const imgs = Array.from(document.querySelectorAll("img")).filter((img) =>
      (img as HTMLImageElement).src.includes("media.revie.lat"),
    ) as HTMLImageElement[];

    for (const img of imgs) {
      let nodo: HTMLElement | null = img.parentElement;
      let tarjeta: HTMLElement | null = null;
      let texto = "";
      for (let nivel = 0; nivel < 8 && nodo; nivel += 1) {
        texto = nodo.innerText ?? "";
        if (/#\d{3,7}/.test(texto)) {
          tarjeta = nodo;
          break;
        }
        nodo = nodo.parentElement;
      }
      if (!tarjeta) continue;

      const matchOrden = texto.match(/#(\d{3,7})/);
      if (!matchOrden) continue;
      const orden = matchOrden[1];

      const lineas = texto.split("\n").map((l) => l.trim()).filter(Boolean);
      const cliente = lineas[0] ?? null;
      const producto = lineas.find((l) => l === l.toUpperCase() && l.length > 3 && !l.startsWith("#")) ?? null;

      resultados.push({ orden, foto: img.src, cliente, producto });
    }
    return resultados;
  });
}

/**
 * La lista de Revie NO tiene scroll infinito — carga las primeras 20 y exige clic explícito
 * en un botón "Cargar más" para traer las siguientes 20 (confirmado a mano: hacer scroll no
 * dispara ninguna carga nueva). Devuelve false cuando ya no hay botón (fin real de la lista).
 */
async function cargarMas(page: Page): Promise<{ encontrado: boolean; botonesVistos?: string[] }> {
  return page.evaluate(() => {
    const botones = Array.from(document.querySelectorAll("button"));
    const boton = botones.find((b) => /cargar\s*m[aá]s/i.test(b.textContent ?? ""));
    if (!boton) {
      return { encontrado: false, botonesVistos: botones.map((b) => (b.textContent ?? "").trim()).filter(Boolean) };
    }
    boton.scrollIntoView();
    (boton as HTMLButtonElement).click();
    return { encontrado: true };
  });
}

async function main(): Promise<void> {
  const indice = await cargarIndiceExistente();
  const totalInicial = Object.keys(indice).length;

  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
  } catch {
    throw new Error(
      `No se pudo conectar a Chrome en ${CDP_URL}. Cerrá todas las ventanas de Chrome y volvelo a abrir con:\n` +
        `  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=9222\n` +
        `y volvé a correr este script (con la sesión de Shopify/Revie ya abierta en una pestaña).`,
    );
  }
  const contexto = browser.contexts()[0] ?? (await browser.newContext());
  const existente = contexto.pages().find((p) => p.url().includes("revie.ai"));
  const page = existente ?? (await contexto.newPage());

  try {
    await page.goto(REVIEWS_URL, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    await esperarLogin(page);
    // El shell puede haber quedado con llamadas fallidas de antes del login — recargar
    // asegura que la carga inicial de datos parta de una sesión ya válida.
    await page.goto(REVIEWS_URL, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);

    await page.getByText("Publicados", { exact: false }).first().click({ timeout: 10_000 });
    await page.waitForTimeout(1500);

    // El filtro "Con imágenes" combinado con scroll profundo choca con un muro de "Mejorar a
    // PRO" del plan gratuito de Revie (confirmado: se detiene ~30 reseñas adentro). Sin el
    // filtro, recorrer todo "Publicados" con "Cargar más" NO tiene ese límite — más lento
    // (hay que revisar reseñas sin foto también) pero sin techo artificial.

    const vistos = new Set<string>();

    for (let intento = 0; intento < MAX_SCROLLS; intento += 1) {
      const tarjetas = await extraerTarjetasVisibles(page);
      for (const t of tarjetas) {
        vistos.add(t.orden);
        const entrada = indice[t.orden] ?? { fotos: [], cliente: t.cliente, producto: t.producto };
        if (!entrada.fotos.includes(t.foto)) entrada.fotos.push(t.foto);
        indice[t.orden] = entrada;
      }

      // El botón puede desaparecer momentáneamente mientras Revie carga la siguiente tanda
      // (queda un spinner en su lugar) — reintentar un par de veces antes de asumir que de
      // verdad no hay más páginas evita cortar la lista a mitad de camino.
      let resultadoBoton = await cargarMas(page);
      for (let reintento = 0; !resultadoBoton.encontrado && reintento < 3; reintento += 1) {
        await page.waitForTimeout(1500);
        resultadoBoton = await cargarMas(page);
      }
      if (!resultadoBoton.encontrado) {
        console.log(`No hay más botón 'Cargar más' tras reintentar. Botones visibles: ${JSON.stringify(resultadoBoton.botonesVistos)}`);
        break;
      }
      await page.waitForTimeout(1000);

      if (intento % 10 === 0) {
        console.log(`[carga ${intento}] órdenes con foto encontradas hasta ahora: ${vistos.size}`);
        await mkdir(path.dirname(INDEX_PATH), { recursive: true });
        await writeFile(INDEX_PATH, JSON.stringify(indice, null, 2), "utf-8");
      }
    }

    await mkdir(path.dirname(INDEX_PATH), { recursive: true });
    await writeFile(INDEX_PATH, JSON.stringify(indice, null, 2), "utf-8");

    console.log(
      JSON.stringify(
        {
          indexPath: INDEX_PATH,
          ordenesAntes: totalInicial,
          ordenesAhora: Object.keys(indice).length,
          nuevas: Object.keys(indice).length - totalInicial,
        },
        null,
        2,
      ),
    );
  } finally {
    // No cerrar `browser`/`contexto` — es tu Chrome real conectado por CDP, cerrarlo te
    // cerraría las pestañas de verdad. Pero el proceso de Node sí hay que forzarlo a salir:
    // la conexión CDP deja un socket abierto que si no, mantiene vivo el proceso para
    // siempre aunque el script ya haya terminado (confirmado: dejaba node.exe colgado).
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
