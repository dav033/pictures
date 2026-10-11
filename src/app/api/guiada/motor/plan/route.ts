import { crosswalkEnVivo, crosswalkIncluido, cotizarBom, snapshotPublicado } from "@/lib/globos3d/motor/v1";
import { registrarAuditoriaPlan3d } from "@/lib/guiada-motor/auditoria-plan";
import { leerMotorGuiada } from "@/lib/guiada-motor/bandera";
import { atenderPlanMotor, type DependenciasPlanMotor } from "@/lib/guiada-motor/plan-motor";
import { llamarPythonListaMateriales } from "@/lib/ia/nucleo/python-adapter";
import { planGuardadoDeIdea } from "@/lib/plan/planes-ideas-guardados";
import { conRegistro, decidir } from "@/lib/registro";

/**
 * El plan de la vista guiada armado por el motor 3D (REQ-007, fase 2): `{desde:"propuesta", propuesta, brief}` o
 * `{desde:"idea", idea_id, base?}`. Sin modelo ni RAG; los precios, de Python (`lista-materiales`). Un plan que el 3D no
 * arma sale con un fallo tipado (`fallback.razon`) y la vista lo resuelve por el camino de siempre. Lógica en lib/guiada-motor.
 */
export const maxDuration = 30;

const dependencias: DependenciasPlanMotor = {
  leerBandera: leerMotorGuiada,
  auditar: decidir,
  planGuardado: planGuardadoDeIdea,
  cotizar: (bom, { requestId, signal }) => cotizarBom(bom, {
    crosswalk: async () => crosswalkIncluido(),
    crosswalkEnVivo: () => crosswalkEnVivo(),
    snapshotPublicado: () => snapshotPublicado(),
    cotizarLista: (entrada) => llamarPythonListaMateriales({ entrada, requestId: crypto.randomUUID(), correlationId: requestId, parentSignal: signal }),
  }),
  nuevoId: () => crypto.randomUUID(),
  registrarPlan: registrarAuditoriaPlan3d,
};

export const POST = conRegistro("/api/guiada/motor/plan", (request: Request) => atenderPlanMotor(request, dependencias), { vista: "guiada" });
