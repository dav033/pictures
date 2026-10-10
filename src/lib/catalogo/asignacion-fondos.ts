import { separarCalificado } from "./ids";
import type { IdRepositorioFundador } from "./tipos";

/**
 * A qué repositorio va cada entrada de `FONDOS_CATALOGO` y cada generador (REQ-013, regla R2): lo que se alquila para sentarse o
 * servir (grupos `asiento` y `mesa`, con la mesa con mantel, los conjuntos de mesa con sillas y la zona lounge) es **mobiliario**;
 * lo que viste el montaje (fondos de foto, grupo `decorado`: paneles, cortinas, aros, pedestales, bases de pastel, el pastel) es
 * **escenografía**. Tabla explícita: `test-catalogo-repositorios` comprueba que cubre el catálogo entero, sin sobrantes, y que
 * casa con el grupo de cada entrada; una entrada nueva sin asignar hace fallar la prueba. Sin datos del catálogo ni del motor:
 * el motor y las superficies de cliente pueden importarlo (regla R8, `test-catalogo-capas`).
 */

export type RepositorioDeFondos = Extract<IdRepositorioFundador, "mobiliario" | "escenografia">;

/** Los generadores paramétricos (REQ-012): su id es la etiqueta de `pieza.mueble.id`. */
export const GENERADORES_MOBILIARIO = ["mesa_param", "sillas_param"] as const;
export type IdGenerador = (typeof GENERADORES_MOBILIARIO)[number];

const MOBILIARIO = [
  "mesa_mantel",
  "silla_tiffany", "silla_moderna", "banca", "taburete_alto", "taburete_bajo", "sofa", "love_seat", "sillon",
  "mesa_imperial", "mesa_imperial_mantel", "mesa_redonda", "mesa_redonda_mantel", "mesa_coctel", "mesa_coctel_licra", "mesa_postres",
  "mesa_postres_mantel", "mesa_centro", "mesa_hexagonal", "mesas_nido_hexagonales", "mesa_regalos", "carrito_dulces",
  "mesa_redonda_sillas", "mesa_redonda10_sillas", "mesa_imperial_sillas", "sala_lounge",
  ...GENERADORES_MOBILIARIO,
] as const;

const ESCENOGRAFIA = [
  "panel_redondo", "media_luna", "arcos_chiara", "lentejuelas", "pedestales", "tapete_redondo", "cortina_luces", "letrero",
  "aro_metalico", "aro_hexagonal", "arco_metalico", "base_hexagonal", "peldanos", "escalera_decorativa", "biombo", "jarron_pampas",
  "lampara_pie", "base_pastel", "pastel", "cortina_flecos", "neon_cursiva", "marco_tela", "rotulo_acrilico", "columna_griega",
  "alfombra_redonda",
] as const;

export const ASIGNACION_FONDOS: ReadonlyMap<string, RepositorioDeFondos> = new Map<string, RepositorioDeFondos>([
  ...MOBILIARIO.map((id) => [id, "mobiliario"] as const),
  ...ESCENOGRAFIA.map((id) => [id, "escenografia"] as const),
]);

/**
 * El id que se GUARDA en `pieza.mueble.id` (SPEC §5.2: siempre el corto) a partir de uno que llega en cualquier forma: el corto,
 * tal cual (también uno que ya no está en el catálogo: el motor lo dibuja como caja roja); el calificado, solo si su repositorio
 * es el que tiene asignado ese id (`mobiliario:silla_tiffany` → `silla_tiffany`). Cualquier otro calificado (otro repositorio,
 * `escenografia:silla_tiffany`, o un id que no es de fondos) → `null`: no se guarda.
 */
export function idCortoDeFondo(id: string): string | null {
  const calificado = separarCalificado(id);
  if (!calificado) return id;
  return ASIGNACION_FONDOS.get(calificado.idLocal) === calificado.repositorio ? calificado.idLocal : null;
}
