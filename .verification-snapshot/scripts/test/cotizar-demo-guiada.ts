import { DECORACION_DEMO_COTIZACION } from "./decoracion-demo-cotizacion";
import { randomUUID } from "node:crypto";
import { ListaMaterialesRequestSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
import { llamarPythonListaMateriales } from "@/lib/ia/nucleo/python-adapter";

const decoracion = DECORACION_DEMO_COTIZACION;
if (!decoracion) throw new Error("Falta decoración de demostración para la cotización.");
const decoracionId = decoracion.id;

const entrada = ListaMaterialesRequestSchema.parse({
  schema_version: "lista-materiales.v1",
  materiales: decoracion.materiales.map((material) => ({ variant_id: material.variantId, cantidad: material.cantidad })),
});

async function main(): Promise<void> {
  for (const uso of ["personal", "negocio"] as const) {
    const cotizacion = await llamarPythonListaMateriales({
      entrada,
      requestId: randomUUID(),
      correlationId: randomUUID(),
    });
    console.log(JSON.stringify({ decoracionId, uso, total: cotizacion.total, currency: cotizacion.currency, lineas: cotizacion.lineas }, null, 2));
  }
}

void main();
