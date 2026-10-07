import "server-only";

/**
 * API de servidor del registro y la auditoría (documentación completa en ./tipos.ts). Desde el navegador se
 * usa ./cliente.ts, nunca este archivo. Los módulos que también cargan los scripts de tsx sin
 * `--conditions=react-server` importan ./servidor.ts (la misma API sin `server-only`).
 */
export * from "./servidor";
