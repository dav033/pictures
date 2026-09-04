// Congela la muestra del chequeo visual de proporción descrito en
// reports/protocolo-chequeo-visual-proporcion-v001.md.
//
// El punto de este script es que la muestra sea REPRODUCIBLE y no re-tirable: PRNG con semilla
// fija en el código, no Math.random(). Si alguien no queda conforme con la muestra que salió,
// tiene que cambiar la semilla en el repo y que se vea en el diff -- que es exactamente la
// fricción que se busca.
//
// Uso: npx tsx scripts/muestrear-chequeo-proporcion.ts [--n=30] [--semilla=20260826]

import { readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";

const RUTA_ORDENES = "C:\\Users\\davidt\\Downloads\\ordenes-decoracion";

function arg(nombre: string, defecto: number): number {
  const m = process.argv.find((a) => a.startsWith(`--${nombre}=`));
  return m ? Number(m.split("=")[1]) : defecto;
}

const N = arg("n", 30);
const SEMILLA = arg("semilla", 20260826);

// Órdenes ya tocadas o ya usadas como ejemplo del consejo -- ver §1 del protocolo.
const EXCLUIDAS = new Set(["13223", "13599", "950000024", "950000021", "7953", "950000192", "950000116"]);

/** mulberry32: PRNG determinístico y corto, suficiente para muestreo. */
function mulberry32(semilla: number) {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Candidato = { orden: string; archivo: string; foto: string; descripcion: string };

async function main() {
  const carpetas = (await readdir(RUTA_ORDENES, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  const candidatos: Candidato[] = [];
  let conProporcion = 0;
  let excluidasVistas = 0;

  for (const carpeta of carpetas) {
    const dir = path.join(RUTA_ORDENES, carpeta);
    const archivos = (await readdir(dir)).filter((f) => /^caption-\d+\.json$/.test(f)).sort();

    for (const archivo of archivos) {
      const indice = archivo.match(/^caption-(\d+)\.json$/)![1];
      let caption: Record<string, unknown>;
      try {
        caption = JSON.parse(await readFile(path.join(dir, archivo), "utf-8"));
      } catch {
        continue;
      }
      if (caption.proporcion_relativa_presente !== true) continue;
      const descripcion = typeof caption.proporcion_relativa_descripcion === "string" ? caption.proporcion_relativa_descripcion : "";
      if (descripcion.trim().length === 0) continue;
      conProporcion += 1;

      // Solo entra lo que realmente se va a entrenar.
      let apto = false;
      try {
        const fb = JSON.parse(await readFile(path.join(dir, `feedback-${indice}.json`), "utf-8"));
        apto = fb.aptoParaEntrenamiento === true;
      } catch {
        apto = false;
      }
      if (!apto) continue;

      if (EXCLUIDAS.has(carpeta)) {
        excluidasVistas += 1;
        continue;
      }

      candidatos.push({
        orden: carpeta,
        archivo,
        foto: typeof caption.foto === "string" ? caption.foto : `foto-${indice}.jpg`,
        descripcion,
      });
    }
  }

  // Fisher-Yates con el PRNG sembrado.
  const rnd = mulberry32(SEMILLA);
  const barajado = candidatos.slice();
  for (let i = barajado.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    [barajado[i], barajado[j]] = [barajado[j]!, barajado[i]!];
  }
  const muestra = barajado.slice(0, N);

  console.log(`captions con proporcion_relativa_presente=true: ${conProporcion}`);
  console.log(`  de esos, aptos para entrenamiento y no excluidos: ${candidatos.length}`);
  console.log(`  descartados por estar en la lista de exclusión:   ${excluidasVistas}`);
  console.log(`muestra: n=${N}, semilla=${SEMILLA}\n`);
  muestra.forEach((c, i) => console.log(`${String(i + 1).padStart(2)}. ${c.orden}/${c.foto}`));

  const salida = path.join(process.cwd(), "reports", `muestra-chequeo-proporcion-v001.json`);

  // Una muestra congelada es el REGISTRO de qué se evaluó: si se pisa, el informe de resultados
  // deja de ser auditable. Y se pisa fácil sin querer -- pasó: al desactivar 2 fotos duplicadas
  // la población bajó de 107 a 105, y una corrida de rutina rebarajó las 30 y borró la lista
  // original. Por eso ahora hay que pedir el sobreescrito de forma explícita.
  if (!process.argv.includes("--rehacer")) {
    try {
      await readFile(salida, "utf-8");
      console.log(`\nYA EXISTE una muestra congelada en ${salida} -- no se sobrescribe.`);
      console.log(`Si de verdad querés rebarajar (y perder el registro de lo ya evaluado), usá --rehacer.`);
      return;
    } catch {
      // no existe todavía: se escribe normalmente
    }
  }

  await writeFile(
    salida,
    `${JSON.stringify({ generado: new Date().toISOString(), semilla: SEMILLA, n: N, poblacion: candidatos.length, muestra }, null, 2)}\n`,
    "utf-8",
  );
  console.log(`\nMuestra congelada en: ${salida}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
