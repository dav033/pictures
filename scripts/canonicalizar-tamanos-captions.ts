// Canonicaliza cómo se ESCRIBE un tamaño de globo en los captions del dataset. No cambia qué
// tamaño dice cada caption (eso ya lo audita scripts/auditar-tamanos-captions.ts y dio 0
// inventados) -- solo unifica la forma de escribirlo, que hoy mezcla "R-12", "18 in" y
// "12-inch" entre captions y a veces dentro del mismo caption.
//
// Por qué importa, y no es cosmético: en INFERENCIA la app nunca dice "R-12". El prompt de
// imagen se arma en src/lib/ia/tamano-fisico.ts, que traduce el SKU a pulgadas+cm antes de
// mandarlo ("12-inch (30.5 cm) round latex balloon") justamente porque -- como dice el
// comentario de ese archivo -- "un modelo de imagen no sabe qué es R-12". Si el LoRA se
// entrena con captions que dicen `R-12` a secas, aprende a asociar el estilo a un token que
// después NUNCA aparece en el prompt de generación. La glosa alinea el vocabulario de
// entrenamiento con el de inferencia.
//
// Forma canónica: primera mención de cada código en un campo -> `R-N (N-inch)`; menciones
// siguientes pueden quedar como `R-N`. Nunca `N in` / `N"` (ambiguas: "in" choca con la
// preposición inglesa). El mapeo código->pulgadas NO se hardcodea acá: sale de
// decodificarTamano(), la misma función que usa el resto del pipeline.
//
// Es idempotente: correrlo dos veces no duplica glosas.
//
// Uso: npx tsx scripts/canonicalizar-tamanos-captions.ts [--aplicar] [--detalle]
//      (sin --aplicar es dry-run: reporta pero no escribe nada)

import { readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { decodificarTamano } from "../src/lib/shopify/derivar";

const RUTA_ORDENES = "C:\\Users\\davidt\\Downloads\\ordenes-decoracion";
const APLICAR = process.argv.includes("--aplicar");
const DETALLE = process.argv.includes("--detalle");

// Campos del caption que van (o pueden ir) al texto de entrenamiento. `caption` es el que
// seguro se exporta; `proporcion_relativa_descripcion` todavía no tiene consumidor de export,
// pero se canonicaliza igual para que la decisión de anexarlo quede libre más adelante.
const CAMPOS_TEXTO = ["caption", "proporcion_relativa_descripcion"] as const;

type Caption = Record<string, unknown> & { caption?: string; proporcion_relativa_descripcion?: string };

/** ¿El texto ya expresa el diámetro N en pulgadas, en cualquier forma? */
function yaTienePulgadas(texto: string, pulgadas: number): boolean {
  return new RegExp(`\\b${pulgadas}\\s*(?:-\\s*)?(?:inch|inches|in)\\b|\\b${pulgadas}"`, "i").test(texto);
}

/**
 * Devuelve el texto canonicalizado. Dos pasadas:
 *  1. `(N in)` -> `(N-inch)` -- solo dentro de paréntesis, para no tocar nunca la preposición
 *     "in" de una frase normal ("balloons in the arch").
 *  2. glosa la primera aparición de cada código R-N que todavía no tenga su equivalencia en
 *     pulgadas en ese mismo campo.
 */
export function canonicalizar(texto: string): { texto: string; cambios: string[] } {
  const cambios: string[] = [];
  let salida = texto;

  salida = salida.replace(/\((\d{1,2})\s*in\)/gi, (_m, n: string) => {
    cambios.push(`(${n} in) -> (${n}-inch)`);
    return `(${n}-inch)`;
  });

  const codigos = [...new Set([...salida.matchAll(/\bR-\d+\b/g)].map((m) => m[0]))];
  for (const codigo of codigos) {
    const decodificado = decodificarTamano(codigo);
    const pulgadas = decodificado?.diamPulg;
    if (pulgadas == null) continue;
    // La idempotencia sale de este check: si la glosa ya existe, el campo contiene "N-inch"
    // y no se vuelve a tocar.
    if (yaTienePulgadas(salida, pulgadas)) continue;

    // Muchos captions ya listan el código entre paréntesis al final del producto
    // ("round balloons (R-12)"). Ahí la glosa va DENTRO del paréntesis existente, si no queda
    // anidado y feo: "(R-12 (12-inch))".
    const enParentesis = new RegExp(`\\(${codigo}\\)`);
    if (enParentesis.test(salida)) {
      salida = salida.replace(enParentesis, `(${codigo}, ${pulgadas}-inch)`);
      cambios.push(`(${codigo}) -> (${codigo}, ${pulgadas}-inch)`);
      continue;
    }

    let reemplazado = false;
    salida = salida.replace(new RegExp(`\\b${codigo}\\b`), (m) => {
      if (reemplazado) return m;
      reemplazado = true;
      return `${codigo} (${pulgadas}-inch)`;
    });
    if (reemplazado) cambios.push(`${codigo} -> ${codigo} (${pulgadas}-inch)`);
  }

  return { texto: salida, cambios };
}

async function main() {
  const carpetas = (await readdir(RUTA_ORDENES, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  let archivosVistos = 0;
  let archivosTocados = 0;
  const journal: Array<{ archivo: string; campo: string; antes: string; despues: string }> = [];
  const porCambio = new Map<string, number>();

  for (const carpeta of carpetas) {
    const dir = path.join(RUTA_ORDENES, carpeta);
    const archivos = (await readdir(dir)).filter((f) => /^caption-\d+\.json$/.test(f)).sort();

    for (const archivo of archivos) {
      const ruta = path.join(dir, archivo);
      let doc: Caption;
      try {
        doc = JSON.parse(await readFile(ruta, "utf-8")) as Caption;
      } catch {
        console.warn(`  ! ${carpeta}/${archivo}: JSON ilegible, se salta`);
        continue;
      }
      archivosVistos += 1;

      let tocado = false;
      for (const campo of CAMPOS_TEXTO) {
        const original = doc[campo];
        if (typeof original !== "string" || original.length === 0) continue;
        const { texto, cambios } = canonicalizar(original);
        if (texto === original) continue;
        doc[campo] = texto;
        tocado = true;
        journal.push({ archivo: `${carpeta}/${archivo}`, campo, antes: original, despues: texto });
        for (const c of cambios) porCambio.set(c, (porCambio.get(c) ?? 0) + 1);
        if (DETALLE) console.log(`  ${carpeta}/${archivo} [${campo}] ${cambios.join("; ")}`);
      }

      if (!tocado) continue;
      archivosTocados += 1;
      if (APLICAR) await writeFile(ruta, `${JSON.stringify(doc, null, 2)}\n`, "utf-8");
    }
  }

  console.log(`\ncarpetas de orden:        ${carpetas.length}`);
  console.log(`archivos de caption:      ${archivosVistos}`);
  console.log(`archivos que cambian:     ${archivosTocados}`);
  console.log(`campos que cambian:       ${journal.length}`);
  console.log(`\ncambios por tipo:`);
  for (const [cambio, n] of [...porCambio].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${cambio}`);
  }

  if (!APLICAR) {
    console.log(`\nDRY-RUN: no se escribió nada. Volvé a correr con --aplicar para escribir.`);
    return;
  }

  const rutaJournal = path.join(
    process.cwd(),
    "data",
    "processed",
    `canonicalizacion-tamanos-${new Date().toISOString().slice(0, 10)}.json`,
  );
  await writeFile(rutaJournal, `${JSON.stringify(journal, null, 2)}\n`, "utf-8");
  console.log(`\nAPLICADO. Journal reversible (antes/después de cada campo): ${rutaJournal}`);
}

// Solo corre el barrido cuando se ejecuta el script directamente: `canonicalizar` se importa
// desde los tests/preview y ahí no debe tocar disco.
if (/canonicalizar-tamanos-captions\.ts$/.test(process.argv[1] ?? "")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
