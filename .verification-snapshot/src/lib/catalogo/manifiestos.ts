import { MANIFIESTO_ESCENOGRAFIA } from "./repositorios/escenografia/manifiesto";
import { MANIFIESTO_MOBILIARIO } from "./repositorios/mobiliario/manifiesto";
import { MANIFIESTO_SEMPERTEX } from "./repositorios/sempertex/manifiesto";
import type { IdRepositorioFundador, ManifiestoRepositorio } from "./tipos";

/**
 * Los manifiestos de los repositorios fundadores, sin cargar ninguna entrada (REQ-013): lo que una ruta o una pantalla necesita
 * para listar repositorios (nombre, versión, licencia, precio, visibilidad) sin pagar la biblioteca. Entrada liviana: ni
 * cargadores ni motor (`test-catalogo-capas`).
 */
export const MANIFIESTOS: Readonly<Record<IdRepositorioFundador, ManifiestoRepositorio>> = {
  sempertex: MANIFIESTO_SEMPERTEX, mobiliario: MANIFIESTO_MOBILIARIO, escenografia: MANIFIESTO_ESCENOGRAFIA,
};
