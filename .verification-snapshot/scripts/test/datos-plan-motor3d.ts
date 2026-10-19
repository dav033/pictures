import { armarDesdeEspec, cotizarBom, crosswalkIncluido, sobreDelMotor } from "../../src/lib/globos3d/motor/v1";
import { todosLosCasos } from "../lib/casos-motor-guiada";
import { pythonDoble } from "../lib/python-doble-precio";

/**
 * Los sobres del motor 3D de los casos que se arman (28 ideas y 18 oficiales), cotizados con el doble de Python, en JSON
 * por la salida estándar. Los lee `test-ui-plan-motor3d.ts`, que no puede importar el motor (es solo de servidor) y renderiza
 * los componentes reales. Sin red.
 */
async function main(): Promise<void> {
  const cruce = crosswalkIncluido();
  const salida: Array<{ id: string; plan: unknown; cotizacion: unknown; globos: number; porPieza: Record<string, number> }> = [];
  for (const caso of todosLosCasos()) {
    const resultado = armarDesdeEspec(caso.espec);
    if (resultado.noRepresentable.length) continue;
    const cotizada = await cotizarBom(resultado.bom, { crosswalk: async () => cruce, cotizarLista: pythonDoble(cruce).cotizarLista });
    if (!cotizada.ok) continue;
    const sobre = sobreDelMotor({ espec: caso.espec, resultado, cotizacion: cotizada, concepto: { titulo: `Plan de prueba ${caso.id}`.slice(0, 160), descripcion: "Plan de prueba" }, requestId: "11111111-1111-4111-8111-111111111111" });
    if (!sobre.ok) throw new Error(`${caso.id}: ${sobre.motivo}`);
    salida.push({
      id: caso.id, plan: sobre.plan, cotizacion: sobre.cotizacion, globos: resultado.bom.total.reduce((s, l) => s + l.cantidad, 0),
      porPieza: Object.fromEntries(Object.entries(resultado.bom.porPieza).map(([id, lineas]) => [id, lineas.reduce((s, l) => s + l.cantidad, 0)])),
    });
  }
  process.stdout.write(JSON.stringify(salida));
}

void main();
