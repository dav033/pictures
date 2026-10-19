/**
 * Análisis de huecos recurrentes de la IA (REQ-010) para un cron del VPS o de la máquina: lo mismo que
 * GET /api/feedback-ia/analisis-cron, sin pasar por HTTP. Guarda el resultado en ai_feedback_analisis, que el panel
 * de administración muestra arriba.
 *
 *   npm run feedback:analizar -- [--dias 7] [--resumen]
 *
 * También aplica la retención: borra lo que nunca se valoró en 30 días y las imágenes huérfanas.
 * `--resumen` añade un resumen de Gemini Flash (entrada y salida acotadas, menos de US$0,02). Necesita DATABASE_URL y,
 * con `--resumen`, GEMINI_API_KEY. Ejemplo de cron semanal (lunes 06:00):
 *   0 6 * * 1  cd /ruta/app && npm run feedback:analizar -- --resumen
 */
import { getRagPool } from "@/lib/rag/db";
import { configuracionAlmacen, crearClienteAlmacen } from "@/lib/almacen/objetos-s3";
import { aplicarRetencion } from "@/lib/feedback-ia/retencion";
import { ejecutarAnalisis, type DependenciasAnalisis } from "@/lib/feedback-ia/servicio-analisis";

function leerOpciones(argv: string[]): { dias: number; conResumen: boolean } {
  const opciones = { dias: 7, conResumen: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--resumen") opciones.conResumen = true;
    else if (argv[i] === "--dias") {
      const dias = Number(argv[++i]);
      if (!Number.isInteger(dias) || dias < 1 || dias > 365) throw new Error("--dias debe ser un entero entre 1 y 365.");
      opciones.dias = dias;
    } else throw new Error(`Opción desconocida: ${argv[i]}. Válidas: --dias <n>, --resumen.`);
  }
  return opciones;
}

async function main(): Promise<void> {
  const { dias: diasDelPeriodo, conResumen } = leerOpciones(process.argv.slice(2));
  const resumir: DependenciasAnalisis["resumir"] = conResumen ? async (resultado, dias) => (await import("@/lib/feedback-ia/resumen-gemini")).resumirConGemini(resultado, dias) : null;
  const pool = getRagPool();
  try {
    const analisis = await ejecutarAnalisis({ db: pool, resumir, avisar: (evento, datos) => console.warn(evento, datos) }, { dias: diasDelPeriodo, origen: "script" });
    console.log(`Análisis #${analisis.id}: ${analisis.totalCalificados} calificados de ${analisis.totalTurnos} turnos, promedio ${analisis.promedio ?? "—"}.`);
    for (const motivo of analisis.metricas.porMotivo.slice(0, 5)) console.log(`  motivo ${motivo.clave}: ${motivo.total} (promedio ${motivo.promedio ?? "—"})`);
    const config = configuracionAlmacen();
    const retencion = await aplicarRetencion({ db: pool, almacen: config ? crearClienteAlmacen(config) : null });
    console.log(`Retención: ${retencion.filasBorradas} turnos sin valorar borrados, ${retencion.imagenesBorradas + retencion.huerfanasBorradas} imágenes, ${retencion.filasPendientes} pendientes.`);
    if (analisis.resumen) console.log(`\nResumen (${analisis.resumenModelo}, US$${analisis.resumenCosteUsd}):\n${analisis.resumen}`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
