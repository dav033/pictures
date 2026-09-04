// Saca del texto de los captions el vocabulario de PROCEDENCIA que se filtró desde el prompt.
//
// El caption y la descripción de proporción se usan tal cual como texto de entrenamiento junto a
// la foto, así que solo pueden describir lo que se VE. Frases como "(no confirmed inch sizes for
// this order)" o "…since the purchased item was a training course, not balloon goods" no
// describen nada de la imagen: son la IA razonando en voz alta sobre la instrucción que recibió.
// Se detectaron 12 captions contaminados así (chequeo 2b de auditar-tamanos-captions.ts).
//
// La fuente ya está arreglada en src/lib/ordenes/generarCaption.ts; esto es el backfill.
//
// Uso: npx tsx scripts/limpiar-meta-comentario-captions.ts [--aplicar]
//      (sin --aplicar es dry-run: muestra el antes/después y no escribe nada)

import { readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";

const RUTA_ORDENES = "C:\\Users\\davidt\\Downloads\\ordenes-decoracion";
const APLICAR = process.argv.includes("--aplicar");

const CAMPOS = ["caption", "proporcion_relativa_descripcion"] as const;

/**
 * Reglas de limpieza, en orden. Son quirúrgicas a propósito: cada una borra una construcción
 * concreta y deja intacto el contenido visual de la frase. Nada de reescribir con IA.
 */
const REGLAS: Array<{ nombre: string; aplicar: (t: string) => string }> = [
  // "(no confirmed inch sizes for this order)" pegado al final de la frase.
  { nombre: "parentesis-sin-tamanos", aplicar: (t) => t.replace(/\s*\((?:no|sin)[^)]*confirm[^)]*\)/gi, "") },

  // Cláusula final tras punto y coma que habla del pedido en vez de la imagen.
  {
    nombre: "clausula-final-procedencia",
    aplicar: (t) => t.replace(/;\s*[^;]*\b(?:confirmed|purchased|the order)\b[^;]*$/i, "."),
  },

  // ", whose exact sizes are not confirmed in the order" y variantes con coma.
  {
    nombre: "clausula-coma-procedencia",
    aplicar: (t) => t.replace(/,\s*whose[^,.]*\bnot confirmed\b[^,.]*/gi, ""),
  },

  // "not listed in the order" dentro de una enumeración visual: se borra solo la coletilla.
  { nombre: "no-listado-en-pedido", aplicar: (t) => t.replace(/\s+not listed in the order\b/gi, "") },

  // "confirmed" usado como adjetivo ("the confirmed R-5 balloons"): es vocabulario del prompt.
  { nombre: "adjetivo-confirmed", aplicar: (t) => t.replace(/\b(the|all three|all)?\s*\bconfirmed\s+/gi, (m, det) => (det ? `${det} ` : "")) },
];

function limpiar(texto: string): { texto: string; aplicadas: string[] } {
  const aplicadas: string[] = [];
  let salida = texto;
  for (const regla of REGLAS) {
    const antes = salida;
    salida = regla.aplicar(salida);
    if (salida !== antes) aplicadas.push(regla.nombre);
  }
  // Normalizar espacios dobles y espacio antes de puntuación que puedan quedar tras los borrados.
  salida = salida.replace(/\s{2,}/g, " ").replace(/\s+([.,;])/g, "$1").replace(/\.\s*\.$/, ".").trim();
  return { texto: salida, aplicadas };
}

async function main() {
  const carpetas = (await readdir(RUTA_ORDENES, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  const journal: Array<{ archivo: string; campo: string; antes: string; despues: string; reglas: string[] }> = [];

  for (const carpeta of carpetas) {
    const dir = path.join(RUTA_ORDENES, carpeta);
    const archivos = (await readdir(dir)).filter((f) => /^caption-\d+\.json$/.test(f)).sort();

    for (const archivo of archivos) {
      const ruta = path.join(dir, archivo);
      let doc: Record<string, unknown>;
      try {
        doc = JSON.parse(await readFile(ruta, "utf-8"));
      } catch {
        continue;
      }

      let tocado = false;
      for (const campo of CAMPOS) {
        const original = doc[campo];
        if (typeof original !== "string" || original.length === 0) continue;
        // Solo se toca lo que el chequeo marca como contaminado; el resto ni se roza.
        if (!/\b(?:confirmed|purchased|not listed in the order|the order)\b/i.test(original)) continue;
        const { texto, aplicadas } = limpiar(original);
        if (texto === original) continue;
        doc[campo] = texto;
        tocado = true;
        journal.push({ archivo: `${carpeta}/${archivo}`, campo, antes: original, despues: texto, reglas: aplicadas });
      }

      if (tocado && APLICAR) await writeFile(ruta, `${JSON.stringify(doc, null, 2)}\n`, "utf-8");
    }
  }

  for (const e of journal) {
    console.log(`\n### ${e.archivo} [${e.campo}]  (${e.reglas.join(", ")})`);
    console.log(`ANTES:   ${e.antes}`);
    console.log(`DESPUES: ${e.despues}`);
  }
  console.log(`\ncampos limpiados: ${journal.length}`);

  if (!APLICAR) {
    console.log("DRY-RUN: no se escribió nada. Volvé a correr con --aplicar.");
    return;
  }
  const rutaJournal = path.join(process.cwd(), "data", "processed", `limpieza-meta-comentario-${new Date().toISOString().slice(0, 10)}.json`);
  await writeFile(rutaJournal, `${JSON.stringify(journal, null, 2)}\n`, "utf-8");
  console.log(`APLICADO. Journal reversible: ${rutaJournal}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
