import { DECORACION_DEMO_COTIZACION } from "./decoracion-demo-cotizacion";
import { randomUUID } from "node:crypto";
import { decoracionesSempertex } from "@/lib/biblioteca-sempertex/biblioteca";
import { ListaMaterialesRequestSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
import { llamarPythonListaMateriales } from "@/lib/ia/nucleo/python-adapter";
import { crosswalkIncluido } from "@/lib/globos3d/motor/v1";
import { pythonDoble } from "../lib/python-doble-precio";

/** Cotiza en Python la decoración de demostración o, con un id como argumento, una idea real de la biblioteca. */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const useFixture = args.includes("--fixture");
  const id = args.find((arg) => arg !== "--fixture");
  if (args.filter((arg) => arg !== "--fixture").length > 1 || id?.startsWith("--")) {
    throw new Error("Usage: datos-cotizacion-guiada.ts [--fixture] [idea-id]");
  }
  const decoracion = id ? decoracionesSempertex.find((item) => item.id === id) : DECORACION_DEMO_COTIZACION;
  if (!decoracion) throw new Error(`Falta la decoración para la cotización: ${id ?? "demostración"}.`);
  const entrada = ListaMaterialesRequestSchema.parse({
    schema_version: "lista-materiales.v1",
    materiales: decoracion.materiales.map((material) => ({ variant_id: material.variantId, cantidad: material.cantidad })),
  });
  // UI fixtures use controlled packages; the default retains the real Python integration.
  const cotizacion = useFixture
    ? await pythonDoble(crosswalkIncluido(), {
      variantesExtra: decoracion.materiales.map((material) => ({
        variantId: material.variantId,
        titulo: material.nota ?? "Fixture material",
        unidadesPaq: 50,
        precio: 13_037,
      })),
    }).cotizarLista(entrada)
    : await llamarPythonListaMateriales({ entrada, requestId: randomUUID(), correlationId: randomUUID() });
  process.stdout.write(JSON.stringify(cotizacion));
}

void main();
