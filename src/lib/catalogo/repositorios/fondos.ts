import { FONDOS_CATALOGO, type FondoCatalogo } from "@/lib/globos3d/fondos-escenografia";
import { ASIGNACION_FONDOS, type RepositorioDeFondos } from "../asignacion-fondos";
import { crearEntrada } from "../construir";
import type { EntradaCatalogo } from "../repositorio";
import type { Procedencia } from "../tipos";

/**
 * Las entradas de `FONDOS_CATALOGO` de un repositorio (mobiliario o escenografía), filtradas por `ASIGNACION_FONDOS` y en el
 * orden del catálogo (R3: ese orden alimenta el prompt de la lectura de fotos y los `z.enum` de la IA). La clase sale de qué es
 * la entrada: un fondo fijo es `mueble-fijo` en mobiliario (la mesa con mantel) y `fondo` en escenografía; un mueble paramétrico
 * es `mueble` o `decorado`.
 */

export const PROCEDENCIA_TALLER: Procedencia = { fuente: "propio", titulo: "Modelo paramétrico del taller" };

function entradaDeFondo(repositorio: RepositorioDeFondos, f: FondoCatalogo): EntradaCatalogo {
  const comun = { idLocal: f.id, nombre: f.nombre, descripcion: f.descripcion, procedencia: PROCEDENCIA_TALLER };
  if (f.clase === "mueble") return crearEntrada(repositorio, { ...comun, clase: repositorio === "mobiliario" ? "mueble" : "decorado", dato: () => f });
  return crearEntrada(repositorio, { ...comun, clase: repositorio === "mobiliario" ? "mueble-fijo" : "fondo", dato: () => f });
}

export function entradasDeFondos(repositorio: RepositorioDeFondos): EntradaCatalogo[] {
  return FONDOS_CATALOGO.filter((f) => ASIGNACION_FONDOS.get(f.id) === repositorio).map((f) => entradaDeFondo(repositorio, f));
}
