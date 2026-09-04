// Preselecciona fotos del BLOG para sumar a la categoría "general" (LoRA base), maximizando lo
// que aportan y minimizando el daño a la composición del set.
//
// Contexto: `general` hoy es 98% fotos de órdenes reales tomadas en sitio. El pool del blog son
// tomas de producto, muchas sobre fondo blanco de estudio. Meterlas de golpe daría vuelta la
// composición y le enseñaría al LoRA "fondo blanco" como parte del estilo Sempertex. Por eso la
// preselección:
//   1. descarta las de fondo blanco de estudio MIRANDO LOS PIXELES del borde (quedan 46 de 167),
//   2. descarta las visualmente casi iguales a algo que YA está en general, o entre sí (dHash),
//   3. ordena para repartir tipos de estructura, priorizando los que hoy están flojos en general
//      (centro_mesa 2%, semiarco 2%, bouquet 7%).
//
// NO marca nada como apta: solo imprime la lista para revisión visual. Marcar 50 fotos como
// aptas sin mirarlas sería repetir el error que ya se detectó en el pool de órdenes reales,
// donde 61 de 65 "usables" eran en realidad paquetes sin abrir.
//
// Uso: npx tsx scripts/seleccionar-blog-para-general.ts [--n=50] [--umbral=10] [--incluir-estudio]

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const RUTA_ORDENES = "C:\\Users\\davidt\\Downloads\\ordenes-decoracion";

function argNum(nombre: string, defecto: number): number {
  const m = process.argv.find((a) => a.startsWith(`--${nombre}=`));
  return m ? Number(m.split("=")[1]) : defecto;
}

const N = argNum("n", 50);
const UMBRAL = argNum("umbral", 10);
const INCLUIR_ESTUDIO = process.argv.includes("--incluir-estudio");
const MIN_PX = 800;
const ESTUDIO = /white (studio )?background|studio backdrop|plain white background|white background/i;

type Foto = { orden: string; indice: number; px: number; tipo: string; estudio: boolean; hash: number[]; caption: string };

/**
 * ¿La foto está recortada sobre fondo blanco de estudio? Se mide en los PÍXELES del borde, no en
 * el texto del caption: la primera versión de este filtro buscaba "white background" en el
 * caption y dejaba pasar tomas de estudio evidentes (#950000045 entre otras) simplemente porque
 * su caption no nombraba el fondo. El texto describe lo que la IA decidió mencionar; los píxeles
 * describen la foto.
 */
async function fondoBlanco(ruta: string): Promise<boolean> {
  const img = sharp(await readFile(ruta));
  const meta = await img.metadata();

  // Recorte con canal alfa: es un PNG de producto sin fondo. Se detecta aparte porque el chequeo
  // de blanco no lo ve -- al aplanar la transparencia queda NEGRO, no blanco (caso #950000110).
  // Para entrenar es incluso peor que el fondo blanco: bordes duros y cero contexto de escena.
  if (meta.hasAlpha) {
    const { data, info } = await sharp(await readFile(ruta)).resize(64, 64, { fit: "fill" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let transparentes = 0;
    const total = info.width * info.height;
    for (let i = 3; i < data.length; i += info.channels) if (data[i]! < 200) transparentes += 1;
    if (transparentes / total >= 0.15) return true;
  }

  const lado = 64;
  const datos = await img.grayscale().resize(lado, lado, { fit: "fill" }).raw().toBuffer();
  const borde: number[] = [];
  for (let i = 0; i < lado; i += 1) {
    borde.push(datos[i]!, datos[(lado - 1) * lado + i]!, datos[i * lado]!, datos[i * lado + lado - 1]!);
  }
  const casiBlancos = borde.filter((v) => v >= 240).length;
  return casiBlancos / borde.length >= 0.9;
}

async function dHash(ruta: string): Promise<number[]> {
  const datos = await sharp(await readFile(ruta)).grayscale().resize(9, 8, { fit: "fill" }).raw().toBuffer();
  const bytes: number[] = [];
  for (let fila = 0; fila < 8; fila += 1) {
    let byte = 0;
    for (let col = 0; col < 8; col += 1) byte = (byte << 1) | ((datos[fila * 9 + col]! > datos[fila * 9 + col + 1]!) ? 1 : 0);
    bytes.push(byte);
  }
  return bytes;
}

function hamming(a: number[], b: number[]): number {
  let n = 0;
  for (let i = 0; i < a.length; i += 1) {
    let x = a[i]! ^ b[i]!;
    while (x) { n += x & 1; x >>= 1; }
  }
  return n;
}

async function main() {
  const carpetas = (await readdir(RUTA_ORDENES, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name).sort();

  const yaEnGeneral: number[][] = [];
  const candidatas: Foto[] = [];
  const tiposEnGeneral = new Map<string, number>();

  for (const carpeta of carpetas) {
    const dir = path.join(RUTA_ORDENES, carpeta);
    const archivos = await readdir(dir).catch(() => [] as string[]);
    let esBlog = false;
    try {
      esBlog = !JSON.parse(await readFile(path.join(dir, "desglose.json"), "utf-8")).cliente;
    } catch { /* sin desglose */ }

    for (const a of archivos.filter((f) => /^feedback-\d+\.json$/.test(f))) {
      const indice = Number(a.match(/\d+/)![0]);
      let fb: { aptoParaEntrenamiento?: boolean; categoria?: string; esDecoracion?: boolean };
      try {
        fb = JSON.parse(await readFile(path.join(dir, a), "utf-8"));
      } catch { continue; }

      let hash: number[] | null = null;
      let px = 0;
      let estudioPorPixeles = false;
      for (const ext of ["jpg", "jpeg", "png", "webp"]) {
        const ruta = path.join(dir, `foto-${indice}.${ext}`);
        try {
          const meta = await sharp(await readFile(ruta)).metadata();
          px = Math.min(meta.width ?? 0, meta.height ?? 0);
          hash = await dHash(ruta);
          estudioPorPixeles = await fondoBlanco(ruta);
          break;
        } catch { /* siguiente */ }
      }
      if (!hash) continue;

      if (fb.aptoParaEntrenamiento === true && fb.categoria === "general") {
        yaEnGeneral.push(hash);
        let c: { tipo_estructura?: string } = {};
        try { c = JSON.parse(await readFile(path.join(dir, `caption-${indice}.json`), "utf-8")); } catch { /* */ }
        const t = c.tipo_estructura ?? "(sin tipo)";
        tiposEnGeneral.set(t, (tiposEnGeneral.get(t) ?? 0) + 1);
        continue;
      }

      if (!esBlog || fb.aptoParaEntrenamiento === true || fb.esDecoracion === false || px < MIN_PX) continue;

      let c: { tipo_estructura?: string; caption?: string; elementos_no_comprados?: string[] } = {};
      try { c = JSON.parse(await readFile(path.join(dir, `caption-${indice}.json`), "utf-8")); } catch { /* */ }
      const texto = `${c.caption ?? ""} ${(c.elementos_no_comprados ?? []).join(" ")}`;
      candidatas.push({
        orden: carpeta,
        indice,
        px,
        tipo: c.tipo_estructura ?? "(sin tipo)",
        estudio: estudioPorPixeles || ESTUDIO.test(texto),
        hash,
        caption: c.caption ?? "",
      });
    }
  }

  // Estrategia de mezcla. Las escenas reales van primero porque no mueven la composición del set
  // (hoy 98% en sitio). Después, si hace falta llegar a N, se completan con tomas de estudio pero
  // SOLO las que nombran el fondo en su caption: con el fondo descrito, el modelo puede tratarlo
  // como una variable más y no absorberlo dentro del token de estilo -- que es el principio de
  // captioning que cita el plan ("el caption describe todo excepto el concepto que se enseña").
  // Las 48 tomas de estudio cuyo caption NO nombra el fondo se dejan fuera: ahí el riesgo de que
  // "fondo blanco" se pegue al estilo es real y no hay nada que lo separe.
  const NOMBRA_FONDO = /white background|studio background|plain background|white backdrop|isolated|no background|transparent background|white surface/i;
  const escenasReales = candidatas.filter((c) => !c.estudio);
  const estudioDescrito = candidatas.filter((c) => c.estudio && NOMBRA_FONDO.test(c.caption));
  const filtradas = INCLUIR_ESTUDIO ? candidatas : [...escenasReales, ...estudioDescrito];
  console.log(`  escenas reales: ${escenasReales.length}   |   estudio con fondo descrito en el caption: ${estudioDescrito.length}`);

  // Descartar las casi iguales a algo ya presente en general.
  const noRepetidas = filtradas.filter((c) => !yaEnGeneral.some((h) => hamming(c.hash, h) <= UMBRAL));
  const chocanConGeneral = filtradas.length - noRepetidas.length;

  // Descartar las casi iguales entre sí, quedándose con la primera de cada grupo.
  const unicas: Foto[] = [];
  let duplicadasEntreSi = 0;
  for (const c of noRepetidas) {
    if (unicas.some((u) => hamming(c.hash, u.hash) <= UMBRAL)) { duplicadasEntreSi += 1; continue; }
    unicas.push(c);
  }

  // Round-robin por tipo, empezando por los tipos más flojos en general.
  const porTipo = new Map<string, Foto[]>();
  for (const c of unicas) porTipo.set(c.tipo, [...(porTipo.get(c.tipo) ?? []), c]);
  const tiposOrdenados = [...porTipo.keys()].sort((a, b) => (tiposEnGeneral.get(a) ?? 0) - (tiposEnGeneral.get(b) ?? 0));

  const elegidas: Foto[] = [];
  for (let ronda = 0; elegidas.length < N; ronda += 1) {
    let agrego = false;
    for (const t of tiposOrdenados) {
      const lista = porTipo.get(t)!;
      if (ronda >= lista.length) continue;
      elegidas.push(lista[ronda]!);
      agrego = true;
      if (elegidas.length >= N) break;
    }
    if (!agrego) break;
  }

  console.log(`candidatas del blog (decoración, >=${MIN_PX}px): ${candidatas.length}`);
  console.log(`  tras excluir fondo blanco de estudio: ${filtradas.length}`);
  console.log(`  descartadas por parecerse a algo ya en general: ${chocanConGeneral}`);
  console.log(`  descartadas por parecerse entre sí: ${duplicadasEntreSi}`);
  console.log(`  disponibles únicas: ${unicas.length}   -> se proponen ${elegidas.length}\n`);

  console.log(`tipo de estructura -- reparto propuesto (entre paréntesis, lo que ya hay en general):`);
  const repartoElegidas = new Map<string, number>();
  for (const e of elegidas) repartoElegidas.set(e.tipo, (repartoElegidas.get(e.tipo) ?? 0) + 1);
  for (const [t, n] of [...repartoElegidas].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(3)}  ${t.padEnd(14)} (general ya tiene ${tiposEnGeneral.get(t) ?? 0})`);
  }

  const excluidas = new Set((process.argv.find((a) => a.startsWith("--excluir=")) ?? "").replace("--excluir=", "").split(",").filter(Boolean));
  const finales = elegidas.filter((e) => !excluidas.has(e.orden));
  if (excluidas.size) console.log(`\nexcluidas a mano tras revisión visual: ${[...excluidas].join(", ")}`);

  console.log(`\nlista (${finales.length}):`);
  finales.forEach((e, i) => console.log(`${String(i + 1).padStart(3)}. ${e.orden}/foto-${e.indice}  ${e.px}px  ${e.tipo.padEnd(12)} ${e.caption.slice(0, 80)}...`));

  if (!process.argv.includes("--aplicar")) {
    console.log(`\nDRY-RUN: no se escribió nada. Volvé a correr con --aplicar para marcarlas aptas y ponerlas en "general".`);
    return;
  }

  for (const e of finales) {
    const ruta = path.join(RUTA_ORDENES, e.orden, `feedback-${e.indice}.json`);
    const fb = JSON.parse(await readFile(ruta, "utf-8"));
    const nota = `Promovida a "general" para el LoRA base tras revisión visual (contact sheet). Origen: blog. Criterios: es decoración, >=${MIN_PX}px, no duplica nada ya presente (dHash), y o bien es escena real o bien su caption nombra el fondo de estudio.`;
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      ruta,
      JSON.stringify({ ...fb, aptoParaEntrenamiento: true, categoria: "general", notas: fb.notas ? `${fb.notas}\n${nota}` : nota, revisadoEn: new Date().toISOString() }, null, 2),
      "utf-8",
    );
    console.log(`  ${e.orden}/foto-${e.indice} -> apta, general`);
  }
  console.log(`\nAPLICADO: ${finales.length} fotos.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
