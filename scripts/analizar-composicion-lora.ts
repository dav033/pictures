import fs from "node:fs";
import path from "node:path";

/**
 * Extrae de qué está hecho el dataset del LoRA v004 y con qué peso.
 *
 * Es fiable porque los 154 captions se reescribieron con vocabulario
 * controlado (`scripts/recaption-v004.ts`): acabados de una lista cerrada,
 * tamaños large/small, sustantivos de estructura desambiguados y cierre
 * obligatorio en "set against <superficie>". Contar sobre texto libre habría
 * sido adivinar; sobre este corpus es leer.
 *
 * Cuenta CAPTIONS que mencionan cada elemento, no ocurrencias: lo que importa
 * es en cuántas de las 154 fotos aparece, no cuántas veces se nombra en una.
 *
 * Escribe data/processed/lora-v004-composicion.json, que consume la pantalla
 * de Configuración LoRA.
 *
 *   npx tsx scripts/analizar-composicion-lora.ts
 */

const CAPTIONS = path.join(process.cwd(), "data/staging/recaption-v004/nuevo");
const ORIGINAL = path.join(process.cwd(), "data/staging/recaption-v004/original");
const DATASET = path.join(process.cwd(), "data/processed/export-general-2026-08-27.json");
const PROCEDENCIA = path.join(process.cwd(), "data/lora-backup/PROCEDENCIA-v004-1000.json");
const ORDENES = process.env.ORDENES_DECORACION_DIR ?? "C:\\Users\\davidt\\Downloads\\ordenes-decoracion";
const SALIDA = path.join(process.cwd(), "data/processed/lora-v004-composicion.json");

type Termino = { nombre: string; patron: RegExp };
type Conteo = { nombre: string; captions: number; pct: number; imagenes?: string[] };
type LineaShopify = { producto: string; variante: string | null; sku: string | null };
type ElementoShopify = {
  producto: string;
  variante: string | null;
  sku: string | null;
  fotos: number;
  pct: number;
};
type Procedencia = {
  etiqueta?: string;
  trigger?: string;
  url_fal?: string;
  rank?: number;
  entrenamiento?: {
    steps?: number;
    learning_rate?: number;
    epocas_aprox?: number;
    costo_usd?: number;
  };
};

const grupo = (nombre: string, terminos: Array<[string, string]>) => ({
  nombre,
  terminos: terminos.map(([n, p]): Termino => ({ nombre: n, patron: new RegExp(p, "i") })),
});

/** Cada patrón sale del vocabulario realmente observado, no de una lista a priori. */
const GRUPOS = [
  grupo("Estructuras", [
    ["Arco de guirnalda", "\\bballoon garland arch\\b"],
    ["Guirnalda orgánica", "\\bballoon garland\\b(?! arch)"],
    ["Marquesina / letras", "\\bmarquee\\b"],
    ["Panel de fondo", "\\bbackdrop panel\\b"],
    ["Columna", "\\bballoon column\\b"],
    ["Muro de globos", "\\bballoon wall\\b"],
    ["Racimo", "\\bballoon cluster\\b"],
    ["Aro metálico", "\\bring frame\\b"],
    ["Centro de mesa", "\\bcenterpiece\\b"],
    ["Bouquet", "\\bballoon bouquet\\b"],
    ["Escultura", "\\bballoon sculpture\\b"],
  ]),
  grupo("Tamaños", [
    ["Grandes", "\\blarge\\b"],
    ["Pequeños", "\\bsmall\\b"],
    ["Altos (columna/panel)", "\\btall\\b"],
    ["Bajos (centro de mesa)", "\\blow\\b"],
  ]),
  grupo("Relaciones espaciales", [
    ["Cierre «set against»", "\\bset against\\b"],
    ["Detrás de", "\\bbehind\\b"],
    ["Flanqueado por", "\\bflanked\\b"],
    ["Al lado de", "\\bbeside\\b"],
    ["Encima de", "\\babove\\b"],
    ["Delante de", "\\bin front of\\b"],
    ["A ambos lados (bilateral)", "\\b(either side|both sides|each end)\\b"],
    ["En esquina", "\\bcorner\\b"],
  ]),
  grupo("Objetos del entorno", [
    ["Pared", "\\bwall\\b"], ["Piso", "\\bfloor\\b"], ["Mesa", "\\btable\\b"],
    ["Cartel / letrero", "\\bsign\\b"], ["Torta", "\\bcake\\b"], ["Techo", "\\bceiling\\b"],
    ["Cortina", "\\bcurtain\\b"], ["Atril / soporte", "\\bstand\\b"], ["Escenario", "\\bstage\\b"],
  ]),
];

function normalizarProducto(texto: string): string {
  return texto
    .replace(/®/g, "")
    .replace(/\s+x\d+\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function claveLinea(linea: LineaShopify): string {
  return normalizarProducto(`${linea.producto}${linea.variante ? ` (${linea.variante})` : ""}`);
}

function encontrarLinea(
  productoFeedback: string,
  lineas: LineaShopify[],
  porClave: Map<string, LineaShopify>,
): LineaShopify | undefined {
  const normalizado = normalizarProducto(productoFeedback);
  const exacta = porClave.get(normalizado);
  if (exacta) return exacta;

  // Feedback a veces omite " / PAQUETE X N" de la variante.
  const partes = normalizado.match(/^(.*)\s\(([^()]*)\)$/);
  if (!partes) return undefined;
  const nombre = partes[1]!;
  const variante = partes[2]!;
  const candidatas = lineas.filter(
    (linea) =>
      normalizarProducto(linea.producto) === nombre &&
      normalizarProducto(linea.variante ?? "").startsWith(variante),
  );
  return candidatas.length === 1 ? candidatas[0] : undefined;
}

function main(): void {
  if (!fs.existsSync(CAPTIONS)) throw new Error(`Faltan los captions en ${CAPTIONS}`);
  const archivos = fs.readdirSync(CAPTIONS).filter((f) => f.endsWith(".txt")).sort();
  const imagenesOriginales = fs.existsSync(ORIGINAL)
    ? fs.readdirSync(ORIGINAL).filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
    : [];
  const imagenPorBase = new Map(
    imagenesOriginales.map((f) => [path.parse(f).name.toLowerCase(), f]),
  );
  const registros = archivos.map((f) => ({
    nombre: f.replace(/\.txt$/i, ""),
    texto: fs.readFileSync(path.join(CAPTIONS, f), "utf8").replace(/^eventdecor_style_v2,\s*/i, "").toLowerCase(),
    imagen: imagenPorBase.get(path.parse(f).name.toLowerCase()),
  }));
  const captions = registros.map(({ texto }) => texto);
  const total = captions.length;
  const pct = (n: number) => Math.round((100 * n) / total);

  const composicion = GRUPOS.map((g) => ({
    grupo: g.nombre,
    elementos: g.terminos
      .map((t): Conteo => {
        const coinciden = registros.filter(({ texto }) => t.patron.test(texto));
        const asociados = coinciden
          .map(({ imagen }) => imagen)
          .filter((imagen): imagen is string => Boolean(imagen))
          .sort();
        const n = coinciden.length;
        return { nombre: t.nombre, captions: n, pct: pct(n), imagenes: asociados };
      })
      .filter((e) => e.captions > 0)
      .sort((a, b) => b.captions - a.captions),
  }));

  const shopifyPorClave = new Map<string, { producto: string; variante: string | null; sku: string | null; fotos: Set<string> }>();
  for (const registro of registros) {
    const identificador = registro.nombre.match(/^(\d+)-(\d+)$/);
    const orden = identificador?.[1];
    const indice = identificador?.[2];
    if (!orden || !indice) continue;

    try {
      const carpeta = path.join(ORDENES, orden);
      const desglose = JSON.parse(fs.readFileSync(path.join(carpeta, "desglose.json"), "utf8")) as { lineas?: LineaShopify[] };
      const feedback = JSON.parse(fs.readFileSync(path.join(carpeta, `feedback-${indice}.json`), "utf8")) as {
        productosRepresentados?: Array<{ producto: string; representado: boolean }>;
      };
      const lineas = desglose.lineas ?? [];
      const porClave = new Map(lineas.map((linea) => [claveLinea(linea), linea]));

      for (const producto of feedback.productosRepresentados ?? []) {
        if (!producto.representado) continue;
        const linea = encontrarLinea(producto.producto, lineas, porClave);
        if (!linea) continue;
        const clave = linea.sku ?? claveLinea(linea);
        const existente = shopifyPorClave.get(clave);
        if (existente) {
          existente.fotos.add(registro.nombre);
        } else {
          shopifyPorClave.set(clave, {
            producto: linea.producto,
            variante: linea.variante,
            sku: linea.sku,
            fotos: new Set([registro.nombre]),
          });
        }
      }
    } catch {
      // No inventar productos si falta desglose o feedback de la orden.
    }
  }

  const shopify = [...shopifyPorClave.values()]
    .map((elemento): ElementoShopify => ({
      producto: elemento.producto,
      variante: elemento.variante,
      sku: elemento.sku,
      fotos: elemento.fotos.size,
      pct: pct(elemento.fotos.size),
    }))
    .sort((a, b) => b.fotos - a.fotos || a.producto.localeCompare(b.producto, "es"));

  // Encuadre: sale de las dimensiones reales de cada foto, no del caption.
  const encuadre: Record<string, number> = {};
  if (fs.existsSync(DATASET)) {
    const entradas = (JSON.parse(fs.readFileSync(DATASET, "utf8")) as { entradas: Array<{ px: string }> }).entradas;
    for (const { px } of entradas) {
      const [w, h] = px.split("x").map(Number);
      const r = (w ?? 1) / (h ?? 1);
      const k = r > 1.5 ? "Panorámico ≥3:2" : r > 1.2 ? "Apaisado ~4:3" : r > 0.95 ? "Cuadrado 1:1" : r > 0.7 ? "Vertical 3:4" : "Vertical alto";
      encuadre[k] = (encuadre[k] ?? 0) + 1;
    }
  }

  const palabras = captions.map((c) => c.split(/\s+/).length).sort((a, b) => a - b);
  const proc: Procedencia = fs.existsSync(PROCEDENCIA)
    ? (JSON.parse(fs.readFileSync(PROCEDENCIA, "utf8")) as Procedencia)
    : {};

  const salida = {
    generado: new Date().toISOString(),
    fuente: "data/staging/recaption-v004/nuevo (154 captions recaptionados)",
    lora: {
      etiqueta: proc.etiqueta ?? "v004-1000",
      trigger: proc.trigger ?? "eventdecor_style_v2",
      url: proc.url_fal ?? null,
      steps: proc.entrenamiento?.steps ?? 1000,
      learning_rate: proc.entrenamiento?.learning_rate ?? 0.00005,
      epocas: proc.entrenamiento?.epocas_aprox ?? Number((1000 / total).toFixed(1)),
      costo_usd: proc.entrenamiento?.costo_usd ?? 6.4,
      rank: proc.rank ?? 16,
    },
    dataset: {
      imagenes: total,
      con_imagen_en_disco: imagenesOriginales.length || null,
      palabras_mediana: palabras[Math.floor(total / 2)] ?? 0,
      palabras_min: palabras[0] ?? 0,
      palabras_max: palabras[total - 1] ?? 0,
    },
    composicion,
    shopify: {
      fotos_analizadas: total,
      elementos_representados: shopify.length,
      elementos: shopify,
    },
    encuadre: Object.entries(encuadre).map(([nombre, n]) => ({ nombre, captions: n, pct: pct(n) })).sort((a, b) => b.captions - a.captions),
  };

  fs.mkdirSync(path.dirname(SALIDA), { recursive: true });
  fs.writeFileSync(SALIDA, JSON.stringify(salida, null, 2));

  console.log(`${total} captions · ${path.relative(process.cwd(), SALIDA)}\n`);
  for (const g of composicion) {
    console.log(g.grupo);
    for (const e of g.elementos) console.log(`  ${e.nombre.padEnd(26)}${String(e.captions).padStart(4)}  ${String(e.pct).padStart(3)}%`);
  }
}

main();
