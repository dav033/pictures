import { DECORACION_DEMO_COTIZACION } from "./decoracion-demo-cotizacion";
import { randomUUID } from "node:crypto";
import { decoracionesSempertex } from "@/lib/biblioteca-sempertex/biblioteca";
import { ListaMaterialesRequestSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
import { llamarPythonListaMateriales } from "@/lib/ia/nucleo/python-adapter";

/** Cotiza en Python la decoración de demostración o, con un id como argumento, una idea real de la biblioteca. */
async function main(): Promise<void> {
  const id = process.argv[2];
  const decoracion = id ? decoracionesSempertex.find((item) => item.id === id) : DECORACION_DEMO_COTIZACION;
  if (!decoracion) throw new Error(`Falta la decoración para la cotización: ${id ?? "demostración"}.`);
  const entrada = ListaMaterialesRequestSchema.parse({
    schema_version: "lista-materiales.v1",
    materiales: decoracion.materiales.map((material) => ({ variant_id: material.variantId, cantidad: material.cantidad })),
  });
  const cotizacion = await llamarPythonListaMateriales({ entrada, requestId: randomUUID(), correlationId: randomUUID() });
  process.stdout.write(JSON.stringify(cotizacion));
}

void main();
