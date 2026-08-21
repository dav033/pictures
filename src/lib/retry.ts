// Movido a @sempertex/agente-core como parte de la extracción del motor
// reutilizable (PLAN: extraer el motor de chat/RAG a un paquete). Se deja
// este shim para que nada que ya importe "@/lib/retry" tenga que cambiar.
export type { OpcionesReintento } from "@sempertex/agente-core";
export { conReintento } from "@sempertex/agente-core";
