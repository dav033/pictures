
/**
 * La misma API de servidor que ./index.ts, SIN `server-only`: para módulos de servidor que también importan los
 * scripts de tsx sin `--conditions=react-server` (python-adapter, gemini, flux, Happie, la ruta de eco). Fuera
 * de Next el registro está inactivo (ver `activo` en configuracion.ts), así que esos scripts no escriben nada.
 * Desde el navegador se usa ./cliente.ts, nunca este archivo.
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
export { configuracion, registroActivo } from "./configuracion";
export { versionCodigo, type VersionCodigo } from "./version";
export * from "./tipos";
