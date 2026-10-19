import { armarDesdeEspec, type EspecClienteV1 } from "../../src/lib/globos3d/motor/v1";
import { referenciaPorCodigo } from "../../src/lib/plan/referencia-sempertex";
import { todosLosCasos } from "./casos-motor-guiada";

/**
 * Una idea de la biblioteca y los colores oficiales de su escena: el caso del experimento de color de Kontext y de la prueba que fija
 * el texto de «Ver cómo quedaría». Sin red y sin coste. Entra al motor solo por `motor/v1` (la frontera de `test-motor-guiada-fronteras`).
 */
export type ColorDeEscena = { nombre: string; hex: string; acabado: string; sempertex: string };

/** La idea cuyo id empieza por `prefijo` (`idea-deco-real-07-`: «Dos columnas rosa, lila y dorado»; `-10-`: azules con plata cromada). */
export function especDeIdea(prefijo: string): EspecClienteV1 {
  const idea = todosLosCasos()
    .filter((c) => armarDesdeEspec(c.espec).noRepresentable.length === 0)
    .find((c) => c.id.startsWith(prefijo));
  if (!idea) throw new Error(`No encuentro la idea ${prefijo} entre los casos del motor.`);
  return idea.espec;
}

export const especIdea07 = (): EspecClienteV1 => especDeIdea("idea-deco-real-07-");

/** Los colores de la escena con su acabado Sempertex: el hex del globo sale de la tabla oficial (`hexGlobo`), uno por color. */
export function paletaDe(espec: EspecClienteV1): ColorDeEscena[] {
  const porHex = new Map<string, ColorDeEscena>();
  for (const linea of armarDesdeEspec(espec).bom.total) {
    const ref = referenciaPorCodigo(linea.codigo);
    if (!ref) continue;
    const hex = ref.hexGlobo.toUpperCase();
    if (!porHex.has(hex)) porHex.set(hex, { nombre: ref.nombreEn, hex, acabado: ref.acabado, sempertex: ref.nombreCompleto });
  }
  return [...porHex.values()];
}
