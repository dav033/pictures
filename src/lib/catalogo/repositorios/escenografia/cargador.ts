import { repositorioDeLista } from "../../construir";
import type { Repositorio } from "../../repositorio";
import { entradasDeFondos } from "../fondos";
import { MANIFIESTO_ESCENOGRAFIA } from "./manifiesto";

export const cargarEscenografia = (): Repositorio => repositorioDeLista(MANIFIESTO_ESCENOGRAFIA, () => entradasDeFondos("escenografia"));
