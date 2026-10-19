/**
 * Compila las lecturas de las fotos de referencia del dueño (`referencias-dueno.ts`) y escribe cada escena guardada del
 * taller (para mirarlas en el visor al lado de su foto). Sin coste. Run: npx tsx scripts/exp/escenas-referencias.ts <carpeta>
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { REFERENCIAS_DUENO } from "@/lib/globos3d/referencias-dueno";
import { LecturaFotoSchema } from "@/lib/globos3d/lectura-foto";
import { compilarLectura } from "@/lib/globos3d/compilar-lectura";
import { armarEscena } from "@/lib/globos3d/escena";

for (const r of REFERENCIAS_DUENO) {
  LecturaFotoSchema.parse(r.lectura);
  const t0 = Date.now();
  const { escena, notas, omitidas } = compilarLectura(r.lectura);
  const armada = armarEscena(escena);
  const globos = armada.materiales.reduce((s, m) => s + m.cantidad, 0);
  writeFileSync(join(process.argv[2]!, `ref-${String(r.numero).padStart(2, "0")}.json`), JSON.stringify({ nombre: r.nombre, escena }));
  console.log(`${r.numero}. ${r.nombre}: ${escena.nodos.length} piezas, ${globos} globos, ${Date.now() - t0} ms${armada.avisos.length ? ` · AVISOS: ${armada.avisos.join(" | ")}` : ""}`);
  for (const n of notas) console.log(`   nota: ${n}`);
  for (const o of omitidas.filter((x) => /Pieza \d/.test(x))) console.log(`   OMITIDA: ${o}`);
}
