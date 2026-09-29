/**
 * Runs the real production recognizer on ONE photo and prints what the plan gets
 * from it: observed palette, per-element colors, dominant colors and the official
 * structure each balloon structure maps to. Diagnosis only — it writes nothing.
 *
 * One vision call per run. Telemetry is off, like the other non-production runners.
 *
 * Uso: NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server \
 *        scripts/ops/diagnosticar-foto.ts --foto <ruta.jpg>
 */
import { existsSync, readFileSync } from "node:fs";

const argumento = (nombre: string) => {
  const indice = process.argv.indexOf(nombre);
  return indice >= 0 ? process.argv[indice + 1] : undefined;
};

async function main(): Promise<void> {
  const ruta = argumento("--foto");
  if (!ruta || !existsSync(ruta)) throw new Error("Falta --foto <ruta a una imagen existente>.");

  for (const archivo of [".env.local", ".env"]) if (existsSync(archivo)) process.loadEnvFile(archivo);
  // Not an evaluation, but the same guard: these calls stay out of the production series.
  delete process.env.DATABASE_URL;
  await import("../../src/lib/ia/nucleo/telemetria-llamadas");
  const { configurarPersistenciaTelemetria } = await import("@sempertex/agente-core");
  configurarPersistenciaTelemetria(undefined);

  const { analizarReferenciasV2 } = await import("../../src/lib/ia/amaterasu/analizar-referencias-v2");
  const { VARIANTE_PRODUCCION } = await import("../../src/lib/ia/referencia/reference-structure");
  const { chatDe } = await import("../../src/lib/ia/nucleo/registro");
  const { cuerpoExito, referenciasEtiquetadas } = await import("../../src/app/api/references/analyze/analisis-http");
  const { coloresDominantesReferencia, coloresFotoCliente, coloresFotoParaBusqueda } = await import("../../src/lib/plan/colores-referencia");

  const base64 = readFileSync(ruta).toString("base64");
  const mime = ruta.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
  const referencias = referenciasEtiquetadas([{ base64, mime, ancho: 0, alto: 0, originalAncho: 0, originalAlto: 0 }]);

  const chat = await chatDe("gemini");
  const analisis = await analizarReferenciasV2(
    chat, referencias, [], "perceptual",
    { superficie: "scripts/ops/diagnosticar-foto" }, undefined, { forzarNuevoAnalisis: true },
  );
  const { blueprint, metadata } = cuerpoExito(analisis, referencias, "diagnosticar-foto", "gemini") as {
    blueprint: Parameters<typeof coloresFotoCliente>[0] & { elements: readonly Record<string, never>[] };
    metadata: Record<string, unknown>;
  };

  const bp = blueprint as unknown as {
    palette: { observed: string[] };
    elements: Array<{
      element_id: string; category: string; approved: boolean; label?: string;
      appearance: { observed_colors?: string[] } & Record<string, unknown>;
    } & Record<string, unknown>>;
  };

  console.log("variante:", VARIANTE_PRODUCCION, "| uso:", JSON.stringify(metadata.usage ?? metadata));
  console.log("\npalette.observed:", JSON.stringify(bp.palette?.observed ?? []));
  console.log("coloresFotoCliente  :", JSON.stringify(coloresFotoCliente(blueprint)));
  console.log("coloresFotoParaBusqueda:", JSON.stringify(coloresFotoParaBusqueda(blueprint)));

  for (const el of bp.elements ?? []) {
    console.log(`\n--- ${el.element_id} [${el.category}] approved=${el.approved} ${el.label ?? ""}`);
    console.log("   observed_colors:", JSON.stringify(el.appearance?.observed_colors ?? []));
    console.log("   dominantes     :", JSON.stringify(coloresDominantesReferencia(el.appearance as never)));
    for (const clave of ["structure_type", "shape", "density", "official_structure_id", "pattern", "measured_colors"]) {
      if (el.appearance?.[clave] !== undefined) console.log(`   appearance.${clave}:`, JSON.stringify(el.appearance[clave]));
      if ((el as Record<string, unknown>)[clave] !== undefined) console.log(`   ${clave}:`, JSON.stringify((el as Record<string, unknown>)[clave]));
    }
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
