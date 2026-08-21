// Movido a @sempertex/agente-core como parte de la extracción del motor
// reutilizable (PLAN: extraer el motor de chat/RAG a un paquete). Se deja
// este shim para que nada que ya importe "./gemini/chat" o
// "@/lib/ia/gemini/chat" tenga que cambiar. `crearChatGemini()` sin argumentos
// se comporta exactamente igual que antes (cae a GEMINI_API_KEY/GEMINI_CHAT_MODEL).
export { crearChatGemini } from "@sempertex/agente-core/gemini";
