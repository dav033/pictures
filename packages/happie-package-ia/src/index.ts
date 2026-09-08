export type { HappiaConfig } from "./config";
export { cargarConfigDesdeEnv } from "./config";

export { HappiaClient, HappiaApiError } from "./cliente";

export type { HappiaPackage, HappiaPackageItem, ListarPackagesRespuesta } from "./tipos";

export type {
  Recomendacion,
  RecomendacionResultado,
  RecomendarPaquetesInput,
  RecomendarPaquetesEstructuradoInput,
  ServiciosSolicitados,
  RecomendarPaquetesConFiltrosInput,
  TelemetriaRecomendacion,
  RegistrarTelemetriaRecomendacion,
} from "./recomendador";
export {
  recomendarPaquetes,
  recomendarPaquetesEstructurado,
  recomendarPaquetesConFiltros,
  registrarTelemetriaSeguro,
} from "./recomendador";

export type { TipoEventoCurado } from "./tipos-curados";
export { tiposEventoCurados, paquetesParaTipoCurado } from "./tipos-curados";

export { ordenarPorInvitados } from "./filtros";

export type { TemaId } from "./temas";
export { derivarTemaId } from "./temas";

export type { NecesidadCurada } from "./necesidades";
export { necesidadesCuradas } from "./necesidades";
