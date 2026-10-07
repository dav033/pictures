import "server-only";

/**
 * API de servidor del registro y la auditoría (documentación completa en ./tipos.ts). Desde el navegador se
 * usa ./cliente.ts, nunca este archivo.
 */
export {
  auditar,
  avisar,
  decidir,
  depurar,
  fechaRegistro,
  informar,
  registrar,
  registrarError,
  type OpcionesAuditoria,
  type OpcionesRegistro,
} from "./registro";
export {
  actualizarContexto,
  cabecerasCorrelacion,
  conContexto,
  contextoActual,
  contextoDesdeRequest,
  idConversacionDelCuerpo,
  idConversacionEfectivo,
  sanearIdConversacion,
} from "./contexto";
export {
  auditarGeneracionImagen,
  auditarLlamadaIa,
  auditarLlamadaIaSincrona,
  crearFetchAuditado,
  deduplicarMensajes,
  describirPeticionGemini,
  envolverChatPort,
  envolverClienteGemini,
  envolverFuncionIa,
  envolverRegistroHerramientas,
  extraerRespuestaGemini,
  iniciarLlamadaIa,
  resultadoDeTurno,
  type DescripcionImagen,
  type DescripcionLlamadaIa,
  type LlamadaIaEnCurso,
  type OpcionesFetchAuditado,
  type ResultadoImagenAuditable,
  type ResultadoLlamadaIa,
} from "./envoltorios";
export { conRegistro, entradaDesdeCuerpo, observadorSse, type OpcionesConRegistro } from "./ruta";
export { diagnosticoEscritor, esperarRegistros } from "./escritor";
export { redactar, sanearTexto, serializarError } from "./redaccion";
export { configuracion } from "./configuracion";
export * from "./tipos";
