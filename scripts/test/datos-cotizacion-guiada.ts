import { DECORACION_DEMO_COTIZACION } from "./decoracion-demo-cotizacion";
import { randomUUID } from "node:crypto";
import { ListaMaterialesRequestSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
import { llamarPythonListaMateriales } from "@/lib/ia/nucleo/python-adapter";

async function main(): Promise<void> {
  const decoracion = DECORACION_DEMO_COTIZACION;
  if (!decoracion) throw new Error("Falta decoración de demostración para la cotización.");
  const entrada = ListaMaterialesRequestSchema.parse({
    schema_version: "lista-materiales.v1",
    materiales: decoracion.materiales.map((material) => ({ variant_id: material.variantId, cantidad: material.cantidad })),
  });
  const cotizacion = await llamarPythonListaMateriales({ entrada, requestId: randomUUID(), correlationId: randomUUID() });
  process.stdout.write(JSON.stringify(cotizacion));
}

void main();
