import { armarDesdeEspec, cotizarBom, crosswalkIncluido, sobreDelMotor } from "../../src/lib/globos3d/motor/v1";
import { atenderArmadaMotor, crearCacheArmada } from "../../src/lib/guiada-motor/armada-motor";
import { huellaDeNavegador } from "../../src/lib/guiada-motor/plan-motor";
import { firmaDePlan, vistaDePieza, vistaDelPlan } from "../../src/components/guiado/motor3d/firma-plan";
import { PlanGuiadoSchema } from "../../src/lib/ia/contracts/asistente-guiado-v1";
import type { EstructuraOficialId } from "../../src/lib/plan/estructuras-oficiales";
import { sessionToken, SESSION_COOKIE } from "../../src/lib/auth/session";
import { todosLosCasos } from "../lib/casos-motor-guiada";
import { pythonDoble } from "../lib/python-doble-precio";

/**
 * Un plan del motor 3D (idea de dos piezas) con las respuestas REALES de `/api/guiada/motor/armada` a las peticiones que su
 * vista haría, en JSON por la salida estándar. Las lee `test-motor3d-ui.ts`, que no puede importar el motor (solo servidor) y
 * renderiza los componentes reales. El token queda atado al navegador `feedback_usuario=a1…`. Sin red ni coste.
 */
const CLAVE_APP = "clave-app-de-prueba";
const IDENTIDAD = "a1".repeat(16);
process.env.APP_PASSWORD = CLAVE_APP;

async function main(): Promise<void> {
  const caso = todosLosCasos().find((c) => c.id === "idea-deco-real-07-eb12910e210c94b6184d025127acce95")!;
  const resultado = armarDesdeEspec(caso.espec);
  const cruce = crosswalkIncluido();
  const cotizada = await cotizarBom(resultado.bom, { crosswalk: async () => cruce, cotizarLista: pythonDoble(cruce).cotizarLista });
  if (!cotizada.ok) throw new Error("no se cotizó");
  const sobre = sobreDelMotor({ espec: caso.espec, resultado, cotizacion: cotizada, concepto: { titulo: "Plan de prueba", descripcion: "Plan de prueba" }, requestId: "11111111-1111-4111-8111-111111111111", navegador: huellaDeNavegador(`nav-${IDENTIDAD}`) });
  if (!sobre.ok) throw new Error(sobre.motivo);
  const plan = PlanGuiadoSchema.parse(sobre.plan);
  const firma = firmaDePlan(plan)!;
  // Solo lo que la vista necesita de cada pieza (sin `piezas-vista`, que arrastra React).
  const piezas = plan.plan.estructuras.map((e) => ({ id: e.estructura_id, oficial: (e.estructura_oficial ?? null) as EstructuraOficialId | null }));

  const deps = { leerBandera: async () => ({ motor: "python" as const, fuente: "env" as const }), armar: armarDesdeEspec, cache: crearCacheArmada(8), auditar: () => undefined };
  const pedir = async (extra: Record<string, unknown>) => {
    const cuerpo = { ...firma, ...extra };
    const respuesta = await atenderArmadaMotor(new Request("https://app.test/api/guiada/motor/armada", {
      method: "POST", headers: { "content-type": "application/json", cookie: `${SESSION_COOKIE}=${sessionToken(CLAVE_APP)}; feedback_usuario=${IDENTIDAD}` }, body: JSON.stringify(cuerpo),
    }), deps);
    return { cuerpo, estado: respuesta.status, tipo: respuesta.headers.get("content-type"), texto: await respuesta.text() };
  };
  const grabaciones = [
    await pedir({ salida: "armada" }),
    await pedir({ salida: "svg", vista: vistaDelPlan(piezas) }),
    ...await Promise.all(piezas.map((p) => pedir({ salida: "svg", vista: vistaDePieza(p.oficial), pieza: p.id }))),
  ];
  process.stdout.write(JSON.stringify({
    plan, cotizacion: sobre.cotizacion, globosBom: resultado.bom.total.reduce((s, l) => s + l.cantidad, 0),
    porPieza: Object.fromEntries(Object.entries(resultado.bom.porPieza).map(([id, lineas]) => [id, lineas.reduce((s, l) => s + l.cantidad, 0)])),
    grabaciones,
  }));
}

void main();
