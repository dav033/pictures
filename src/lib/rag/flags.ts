/**
 * Única fuente de verdad para los feature flags del RAG. Antes se leían con
 * `process.env` directo en dos archivos distintos (route.ts y ejecutar.ts) —
 * hoy coinciden, pero nada impedía que un cambio en uno no se reflejara en
 * el otro.
 */
export const RAG_ENABLED = process.env.RAG_ENABLED === "true";
export const RAG_FRANJAS_ENABLED = process.env.RAG_FRANJAS_ENABLED === "true";
