import { calcularEstadisticasOrdenes, rutaOrdenes, type EstadisticasOrdenes } from "@/lib/ordenes/estadisticas";
import { readLocalSnapshot } from "@/lib/lora/snapshot";

export type { Alerta, ConteoEtiqueta, ConteoImagen, EstadisticasOrdenes, ReferenciaProducto } from "@/lib/ordenes/estadisticas";

/**
 * En la máquina que tiene la carpeta de órdenes se calcula en vivo. El servidor
 * no la tiene —ni las fotos— así que allí las estadísticas salen del snapshot
 * publicado desde el panel de administración, marcadas como tales para que
 * nadie las confunda con datos frescos.
 */
export async function GET(): Promise<Response> {
  const vivo = await calcularEstadisticasOrdenes();
  if (vivo) return Response.json(vivo);

  const snapshot = readLocalSnapshot();
  const guardadas = snapshot?.estadisticasOrdenes;
  if (guardadas) {
    const respuesta: EstadisticasOrdenes = {
      ...guardadas,
      origen: "snapshot",
      generadoEn: snapshot?.generatedAt,
    };
    return Response.json(respuesta);
  }

  return Response.json(
    {
      error: `No hay estadísticas disponibles: esta máquina no tiene la carpeta ${rutaOrdenes()} y todavía no se publicó un snapshot. Genera y publica el snapshot desde el panel de administración (Dataset LoRA).`,
    },
    { status: 404 },
  );
}
