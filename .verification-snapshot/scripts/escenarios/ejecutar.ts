import type { ArmadaCompactaV1 } from "../../src/lib/globos3d/motor/armada-compacta";
import type { EspecClienteV1 } from "../../src/lib/globos3d/motor/espec-cliente-v1";
import type { ResultadoMotorV1 } from "../../src/lib/globos3d/motor/resultado-motor-v1";
import { armarDesdeEspec, EspecClienteV1Schema } from "../../src/lib/globos3d/motor/v1";

/**
 * **Ejecuta un escenario por la fachada y deja la observación en datos** (sin juzgarla: eso es `invariantes.ts`). Solo se usa
 * la fachada `armarDesdeEspec`, la entrada que usa el chat guiado: `espec-a-escena` es privado del motor (lo vigila
 * `test-motor-guiada-fronteras.ts`), así que la matriz no entra por dentro. Lo que la fachada no expone (la iluminación y el
 * mobiliario de la sala) no está en la matriz: ver `generador.ts`.
 */

/** La geometría de la armada compacta, por pieza de primer nivel (las flores cuentan como su pieza). */
export type Geometria = {
  sala: { anchoCm: number; fondoCm: number; altoCm: number };
  /** Caja de cada pieza en cm: [minx, miny, minz, maxx, maxy, maxz]. */
  cajas: ReadonlyMap<string, ArmadaCompactaV1["piezas"][number]["caja"]>;
  /** Globos que lleva cada pieza (incluidos los de sus flores). */
  globos: ReadonlyMap<string, number>;
};

export type Observacion = {
  /** El error de validación del esquema, si el cliente lo rechaza (esperado para lo que el esquema no admite). */
  rechazoEsquema: string | null;
  /** Lo que lanzó la fachada, si lanzó. */
  errorFachada: string | null;
  resultado: ResultadoMotorV1 | null;
  geometria: Geometria | null;
  tiempoMs: number;
  /** Huellas de dos construcciones seguidas de la misma espec (deben coincidir). */
  huellas: [string, string] | null;
  piezas: EspecClienteV1["piezas"];
  noRepresentables: ResultadoMotorV1["noRepresentable"];
  avisos: string[];
};

export function huellaDe(texto: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) h = Math.imul(h ^ texto.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, "0");
}

export function geometriaDe(armada: ArmadaCompactaV1): Geometria {
  return {
    sala: armada.sala,
    cajas: new Map(armada.piezas.map((p) => [p.id, p.caja])),
    globos: new Map(armada.piezas.map((p) => [p.id, p.globos[1]])),
  };
}

const mensaje = (error: unknown): string => (error instanceof Error ? `${error.name}: ${error.message}` : String(error));

export function observar(espec: EspecClienteV1): Observacion {
  const base: Observacion = {
    rechazoEsquema: null, errorFachada: null, resultado: null, geometria: null, tiempoMs: 0, huellas: null,
    piezas: espec.piezas, noRepresentables: [], avisos: [],
  };
  const valida = EspecClienteV1Schema.safeParse(espec);
  if (!valida.success) return { ...base, rechazoEsquema: valida.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(" | ") };
  const entrada = valida.data;
  const t0 = performance.now();
  let resultado: ResultadoMotorV1;
  try {
    resultado = armarDesdeEspec(entrada);
  } catch (error) {
    return { ...base, errorFachada: mensaje(error) };
  }
  const tiempoMs = performance.now() - t0;
  const segunda = armarDesdeEspec(entrada);
  return {
    ...base, resultado, geometria: geometriaDe(resultado.armada), tiempoMs,
    huellas: [huellaDe(JSON.stringify(resultado)), huellaDe(JSON.stringify(segunda))],
    noRepresentables: resultado.noRepresentable, avisos: resultado.avisos,
  };
}
