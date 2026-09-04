// Separa la categoría "no_asignada" (nadie decidió esto todavía) del "general" viejo, que hasta
// ahora cumplía las dos funciones a la vez -- ver el comentario en src/lib/ordenes/tipos.ts.
//
// Regla de migración: un feedback-N.json que hoy dice categoria="general" (o no tiene el campo,
// para datos de antes de que existiera) pasa a "no_asignada" salvo que un humano lo haya puesto
// en "general" a propósito desde el selector del panel. No hay flag explícito para eso, así que
// se infiere: fuente="humano" Y las notas no empiezan con el texto fijo que pone el endpoint de
// "Agregar imagen manual" (ese default también es un default de código, no una decisión real).
//
// Idempotente: correrlo de nuevo no cambia nada (ya no quedan "general" no deliberados).

import { readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { FeedbackFoto } from "../src/lib/ordenes/tipos";

const RUTA_ORDENES = "C:\\Users\\davidt\\Downloads\\ordenes-decoracion";
const NOTA_AGREGADA_A_MANO = "Agregada a mano desde el panel de admin";

function fueCategoriaDeliberada(feedback: FeedbackFoto): boolean {
  if (feedback.fuente !== "humano") return false;
  if ((feedback.notas ?? "").startsWith(NOTA_AGREGADA_A_MANO)) return false;
  return true;
}

async function main(): Promise<void> {
  const carpetas = (await readdir(RUTA_ORDENES, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  let escaneados = 0;
  let migrados = 0;
  let generalDeliberado = 0;
  let yaNoAsignada = 0;
  let otraCategoria = 0;

  for (const numero of carpetas) {
    const carpetaOrden = path.join(RUTA_ORDENES, numero);
    const archivos = await readdir(carpetaOrden).catch(() => [] as string[]);
    const archivosFeedback = archivos.filter((f) => /^feedback-\d+\.json$/.test(f));

    for (const archivo of archivosFeedback) {
      const rutaArchivo = path.join(carpetaOrden, archivo);
      let feedback: FeedbackFoto;
      try {
        feedback = JSON.parse(await readFile(rutaArchivo, "utf-8"));
      } catch {
        continue;
      }
      escaneados += 1;

      const categoriaActual = feedback.categoria ?? "general";
      if (categoriaActual === "no_asignada") {
        yaNoAsignada += 1;
        continue;
      }
      if (categoriaActual !== "general") {
        otraCategoria += 1;
        continue;
      }
      if (fueCategoriaDeliberada(feedback)) {
        generalDeliberado += 1;
        continue;
      }

      const feedbackMigrado: FeedbackFoto = { ...feedback, categoria: "no_asignada" };
      await writeFile(rutaArchivo, JSON.stringify(feedbackMigrado, null, 2), "utf-8");
      migrados += 1;
      console.log(`  migrada -> no_asignada: ${numero}/${archivo}`);
    }
  }

  console.log(`\nEscaneados: ${escaneados}`);
  console.log(`Migrados a no_asignada: ${migrados}`);
  console.log(`Ya estaban en no_asignada: ${yaNoAsignada}`);
  console.log(`Se quedaron en general (deliberado por un humano): ${generalDeliberado}`);
  console.log(`En otra categoría temática (sin tocar): ${otraCategoria}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
