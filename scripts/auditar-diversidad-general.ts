// Auditoría de DIVERSIDAD del set que va a entrenar el LoRA base.
//
// Motivación, del propio plan de entrenamiento (§2.1): "si el 80% de las imágenes comparten
// cuarto/luz/ángulo, el LoRA sobreajusta a esas condiciones en vez de aprender el concepto".
// Ese chequeo estaba pendiente. La hipótesis de riesgo era que dominaran las fotos del blog de
// Sempertex (tomas de estudio sobre fondo blanco): si esas mandan, el LoRA aprende "fondo blanco
// de estudio" como si fuera parte del estilo y lo mete en cada generación.
//
// La hipótesis resultó FALSA para "general": la primera corrida dio 98% órdenes reales en sitio
// y solo 2% del blog, cero escenas visualmente repetidas, y buen reparto de tipo de estructura.
// Se deja el script igual porque el chequeo hay que rehacerlo cada vez que crece el set -- y el
// pool que queda para crecer SÍ es mayoritariamente del blog, así que el riesgo vuelve a aparecer
// en cuanto se promuevan esas fotos.
//
// Mide cuatro ejes y, además, busca fotos VISUALMENTE parecidas (no solo idénticas byte a byte,
// que es lo que ya cubre auditar-calidad-imagenes.ts) con un hash perceptual dHash: dos tomas de
// la misma decoración desde un ángulo apenas distinto cuentan como una sola muestra a efectos de
// aprendizaje, pero inflan el conteo del dataset.
//
// Uso: npx tsx scripts/auditar-diversidad-general.ts [--categoria=general] [--umbral=10]

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const RUTA_ORDENES = "C:\\Users\\davidt\\Downloads\\ordenes-decoracion";

function arg(nombre: string, defecto: string): string {
  const m = process.argv.find((a) => a.startsWith(`--${nombre}=`));
  return m ? m.split("=")[1] : defecto;
}

const CATEGORIA = arg("categoria", "general");
// Distancia de Hamming máxima entre dos dHash de 64 bits para considerarlas "la misma escena".
// 10/64 es un umbral conservador: por debajo de ~6 solo agarra recortes casi idénticos; por
// encima de ~14 empieza a unir decoraciones distintas que comparten paleta.
const UMBRAL_HAMMING = Number(arg("umbral", "10"));

type Item = {
  orden: string;
  indice: number;
  esBlog: boolean;
  tipoEstructura: string;
  texto: string;
  hash: number[];
};

/**
 * dHash 8x8: compara cada píxel con su vecino derecho sobre una miniatura en gris. El resultado
 * son 64 bits, guardados como 8 bytes en vez de un BigInt porque el tsconfig del proyecto apunta
 * por debajo de ES2020 y los literales BigInt no compilan ahí.
 */
async function dHash(ruta: string): Promise<number[]> {
  const datos = await sharp(await readFile(ruta)).grayscale().resize(9, 8, { fit: "fill" }).raw().toBuffer();
  const bytes: number[] = [];
  for (let fila = 0; fila < 8; fila += 1) {
    let byte = 0;
    for (let col = 0; col < 8; col += 1) {
      const izq = datos[fila * 9 + col]!;
      const der = datos[fila * 9 + col + 1]!;
      byte = (byte << 1) | (izq > der ? 1 : 0);
    }
    bytes.push(byte);
  }
  return bytes;
}

function hamming(a: number[], b: number[]): number {
  let n = 0;
  for (let i = 0; i < a.length; i += 1) {
    let x = a[i]! ^ b[i]!;
    while (x) {
      n += x & 1;
      x >>= 1;
    }
  }
  return n;
}

/** Clasificadores por palabras clave. El primero que matchea gana, así que el orden importa. */
const ESCENARIO: Array<[string, RegExp]> = [
  ["estudio fondo blanco", /white (studio )?background|studio backdrop|plain white background/i],
  ["backdrop montado", /backdrop|sequin|panel|curtain|arch stand|mesh wall/i],
  ["pared / interior doméstico", /\bwall\b|living room|bedroom|indoor room/i],
  ["exterior", /outdoor|patio|garden|terrace|daylight outside|street/i],
  ["salón / local comercial", /venue|hall|salon|shop|store|restaurant|office/i],
];

const LUZ: Array<[string, RegExp]> = [
  ["estudio / uniforme", /studio lighting|even indoor lighting|bright,? even/i],
  ["natural / diurna", /natural (day)?light|daylight|sunlight/i],
  ["cálida / tenue", /warm|dim|ambient|evening/i],
  ["interior brillante", /bright indoor|indoor lighting/i],
];

function clasificar(texto: string, tabla: Array<[string, RegExp]>): string {
  for (const [etiqueta, re] of tabla) if (re.test(texto)) return etiqueta;
  return "(sin clasificar)";
}

function reparto(titulo: string, valores: string[]): void {
  const cuenta = new Map<string, number>();
  for (const v of valores) cuenta.set(v, (cuenta.get(v) ?? 0) + 1);
  const orden = [...cuenta].sort((a, b) => b[1] - a[1]);
  const total = valores.length;
  console.log(`\n--- ${titulo} ---`);
  for (const [k, n] of orden) {
    const pct = (n / total) * 100;
    const barra = "█".repeat(Math.round(pct / 3));
    console.log(`  ${String(n).padStart(4)}  ${pct.toFixed(0).padStart(3)}%  ${k.padEnd(28)} ${barra}`);
  }
  const dominante = orden[0];
  if (dominante && dominante[1] / total >= 0.5) {
    console.log(`  ⚠  "${dominante[0]}" concentra el ${((dominante[1] / total) * 100).toFixed(0)}% del set.`);
  }
}

async function main() {
  const carpetas = (await readdir(RUTA_ORDENES, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  const items: Item[] = [];

  for (const carpeta of carpetas) {
    const dir = path.join(RUTA_ORDENES, carpeta);
    const archivos = await readdir(dir).catch(() => [] as string[]);

    for (const a of archivos.filter((f) => /^feedback-\d+\.json$/.test(f))) {
      const indice = Number(a.match(/\d+/)![0]);
      let fb: { aptoParaEntrenamiento?: boolean; categoria?: string };
      try {
        fb = JSON.parse(await readFile(path.join(dir, a), "utf-8"));
      } catch {
        continue;
      }
      if (fb.aptoParaEntrenamiento !== true || fb.categoria !== CATEGORIA) continue;

      let caption: { caption?: string; elementos_no_comprados?: string[]; tipo_estructura?: string } = {};
      try {
        caption = JSON.parse(await readFile(path.join(dir, `caption-${indice}.json`), "utf-8"));
      } catch {
        // sin caption: igual cuenta para el hash y la fuente
      }
      let desgloseCliente: unknown = null;
      try {
        desgloseCliente = JSON.parse(await readFile(path.join(dir, "desglose.json"), "utf-8")).cliente;
      } catch {
        // sin desglose
      }

      let hash: number[] | null = null;
      for (const ext of ["jpg", "jpeg", "png", "webp"]) {
        try {
          hash = await dHash(path.join(dir, `foto-${indice}.${ext}`));
          break;
        } catch {
          // siguiente extensión
        }
      }
      if (hash === null) continue;

      items.push({
        orden: carpeta,
        indice,
        esBlog: !desgloseCliente,
        tipoEstructura: caption.tipo_estructura ?? "(sin tipo)",
        texto: `${caption.caption ?? ""} ${(caption.elementos_no_comprados ?? []).join(" ")}`,
        hash,
      });
    }
  }

  console.log(`Set auditado: categoría "${CATEGORIA}", aptas para entrenamiento — ${items.length} fotos`);

  reparto("fuente", items.map((i) => (i.esBlog ? "blog (estudio Sempertex)" : "orden real (en sitio)")));
  reparto("escenario / fondo", items.map((i) => clasificar(i.texto, ESCENARIO)));
  reparto("iluminación", items.map((i) => clasificar(i.texto, LUZ)));
  reparto("tipo de estructura", items.map((i) => i.tipoEstructura));

  // Agrupado por cercanía perceptual (unión simple por umbral).
  const grupo = new Map<number, number>();
  const raiz = (i: number): number => (grupo.get(i) === i || grupo.get(i) === undefined ? i : raiz(grupo.get(i)!));
  items.forEach((_, i) => grupo.set(i, i));
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      if (hamming(items[i]!.hash, items[j]!.hash) <= UMBRAL_HAMMING) grupo.set(raiz(j), raiz(i));
    }
  }
  const clusters = new Map<number, Item[]>();
  items.forEach((it, i) => {
    const r = raiz(i);
    clusters.set(r, [...(clusters.get(r) ?? []), it]);
  });
  const repetidas = [...clusters.values()].filter((c) => c.length > 1);

  console.log(`\n--- escenas visualmente casi iguales (dHash, distancia <= ${UMBRAL_HAMMING}/64) ---`);
  if (repetidas.length === 0) {
    console.log("  ninguna: no hay tomas duplicadas de la misma escena.");
  } else {
    for (const c of repetidas) {
      console.log(`  ${c.map((i) => `${i.orden}/foto-${i.indice}`).join("  ~  ")}`);
    }
    const exceso = repetidas.reduce((s, c) => s + c.length - 1, 0);
    console.log(`  ${repetidas.length} grupos, ${exceso} fotos que aportan poca información nueva.`);
    console.log(`  muestras visualmente distintas: ${items.length - exceso} de ${items.length}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
