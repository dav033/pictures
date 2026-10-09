import { armarDesdeEspec, crearCachePiezas, crosswalkEnVivo, crosswalkIncluido, cotizarBom, snapshotPublicado } from "@/lib/globos3d/motor/v1";
import { leerMotorGuiada } from "@/lib/guiada-motor/bandera";
import { atenderEditarMotor, TOPE_EDICIONES_POR_NAVEGADOR_HORA, type DependenciasEditarMotor } from "@/lib/guiada-motor/editar-motor";
import { crearTopePorNavegador } from "@/lib/guiada-motor/tope-imagenes-navegador";
import { llamarPythonListaMateriales } from "@/lib/ia/nucleo/python-adapter";
import { planGuardadoDeIdea } from "@/lib/plan/planes-ideas-guardados";
import { conRegistro, decidir } from "@/lib/registro";

/**
 * Los cambios del cliente a un plan armado por el motor 3D (REQ-007, fase 5): colores, proporciones de color, tamaños y
 * piezas. Aplica la edición a la espec firmada, vuelve a armar solo las piezas que cambiaron (caché de piezas), cotiza con
 * Python (`lista-materiales`) y devuelve el plan nuevo con su token nuevo. Sin modelo ni RAG. Un cambio que no se puede
 * hacer sale como «No pude: …» y el plan no se toca. Lógica en lib/guiada-motor/editar-motor.ts.
 */
export const maxDuration = 30;

// Una caché por proceso: guarda piezas ya armadas (números y geometría, nunca recursos de GPU).
const cachePiezas = crearCachePiezas(96);
const topeEdiciones = crearTopePorNavegador(TOPE_EDICIONES_POR_NAVEGADOR_HORA);

const dependencias: DependenciasEditarMotor = {
  leerBandera: leerMotorGuiada,
  auditar: decidir,
  armar: (espec) => armarDesdeEspec(espec, { cachePiezas }),
  planGuardado: planGuardadoDeIdea,
  cotizar: (bom, { requestId, signal }) => cotizarBom(bom, {
    crosswalk: async () => crosswalkIncluido(),
    crosswalkEnVivo: () => crosswalkEnVivo(),
    snapshotPublicado: () => snapshotPublicado(),
    cotizarLista: (entrada) => llamarPythonListaMateriales({ entrada, requestId: crypto.randomUUID(), correlationId: requestId, parentSignal: signal }),
  }),
  nuevoId: () => crypto.randomUUID(),
  tomarEdicion: (navegador) => topeEdiciones.tomar(navegador),
  estadisticasCache: () => { const { aciertos, fallos } = cachePiezas.estadisticas(); return { aciertos, fallos }; },
};

export const POST = conRegistro("/api/guiada/motor/editar", (request: Request) => atenderEditarMotor(request, dependencias), { vista: "guiada" });
