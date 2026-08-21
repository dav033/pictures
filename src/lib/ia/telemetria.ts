// Movido a @sempertex/agente-core como parte de la extracción del motor
// reutilizable (PLAN: extraer el motor de chat/RAG a un paquete). Se deja
// este shim para que nada que ya importe "./telemetria" o "@/lib/ia/telemetria"
// tenga que cambiar.
export type { Operacion, EventoTelemetria } from "@sempertex/agente-core";
export { registrarEvento, ultimosEventos } from "@sempertex/agente-core";
