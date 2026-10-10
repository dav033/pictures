import { ESTRUCTURAS_OFICIALES_IDS, type EstructuraOficialId } from "@/lib/plan/estructuras-oficiales";
import { MAX_CAPAS_COLUMNA } from "@/lib/plan/armado-columna";
import { TABLA_SEMPERTEX, type ReferenciaSempertex } from "../../src/lib/plan/referencia-sempertex";
import {
  DENSIDADES_ESPEC, FORMATOS_REMATE, ORIGENES_ESPEC, TAMANOS_ESPEC,
  type ColorEspec, type EspecClienteV1, type PiezaEspec,
} from "../../src/lib/globos3d/motor/espec-cliente-v1";
import { crearAzar, semillaDeEscenario, type Azar } from "./azar";

/**
 * **Generador de escenarios de la matriz.** Cada escenario es una especificación del cliente (`EspecClienteV1`), la única
 * entrada de la fachada. La ocasión es el origen de la espec (propuesta, idea, edición…) y el tamaño de la sala lo decide el
 * propio motor (`distribuir`): la matriz los mide como estratos, no como entradas. La iluminación y el mobiliario no son
 * entradas de la fachada, así que la matriz no los varía (ver `ejecutar.ts`).
 *
 * Determinista: el escenario `i` de la semilla `s` sale siempre igual, y no depende de los anteriores.
 */

/** Los colores van de 1 a 6, el máximo del esquema (`MAX_COLORES_PIEZA`). Un escenario con más no se genera: su rechazo lo prueba `test-escenarios-matriz.ts`. */
export const COLORES_MIN = 1;
export const COLORES_MAX = 6;

export type Escenario = {
  id: string;
  indice: number;
  semilla: number;
  espec: EspecClienteV1;
};

/** Los colores del catálogo, agrupados por familia de acabado: cada familia se elige con la misma probabilidad. */
const FAMILIAS: readonly (readonly ReferenciaSempertex[])[] = (() => {
  const porFamilia = new Map<string, ReferenciaSempertex[]>();
  for (const r of TABLA_SEMPERTEX.referencias) porFamilia.set(r.familia, [...(porFamilia.get(r.familia) ?? []), r]);
  return [...porFamilia.values()];
})();

function colorAleatorio(az: Azar): ReferenciaSempertex {
  const familia = az.elegir(FAMILIAS);
  return az.elegir(familia);
}

/** Pesos de color que suman 1 (con tres decimales, el último absorbe el redondeo). */
function pesosDe(n: number, az: Azar): number[] {
  const crudos = Array.from({ length: n }, () => 0.2 + az.siguiente() * 0.8);
  const suma = crudos.reduce((s, v) => s + v, 0);
  const pesos = crudos.map((v) => Math.round((v / suma) * 1000) / 1000);
  pesos[n - 1] = Math.round((1 - pesos.slice(0, -1).reduce((s, v) => s + v, 0)) * 1000) / 1000;
  return pesos;
}

function coloresDe(az: Azar): ColorEspec[] {
  const n = az.entero(COLORES_MIN, COLORES_MAX);
  const usados = new Set<string>();
  const pesos = pesosDe(n, az);
  return pesos.map((peso) => {
    let ref = colorAleatorio(az);
    while (usados.has(ref.codigo)) ref = colorAleatorio(az);
    usados.add(ref.codigo);
    return { codigo: ref.codigo, nombre: ref.nombre.slice(0, 80), peso };
  });
}

const dos = (az: Azar, min: number, max: number): number => Math.round((min + az.siguiente() * (max - min)) * 100) / 100;

function medidasDeEstructura(oficial: EstructuraOficialId, az: Azar): PiezaEspec["medidas"] {
  if (az.probar(0.2)) return {};
  if (oficial === "guirnalda") return { largoM: dos(az, 0.8, 6) };
  if (oficial === "aro_circular") { const d = dos(az, 1, 2.5); return { anchoM: d, altoM: d }; }
  if (oficial.startsWith("columna")) return { altoM: dos(az, 0.7, 3), ...(az.probar(0.5) ? { anchoM: dos(az, 0.4, 1) } : {}) };
  if (oficial.startsWith("arco")) return { anchoM: dos(az, 1, 3.5), altoM: dos(az, 1.5, 3) };
  if (oficial.startsWith("semiarco")) return { anchoM: dos(az, 1, 2.5), altoM: dos(az, 1.5, 3) };
  return { anchoM: dos(az, 0.5, 3), altoM: dos(az, 0.5, 3) };
}

function piezaAleatoria(indice: number, az: Azar): PiezaEspec {
  const oficial = az.elegir(ESTRUCTURAS_OFICIALES_IDS);
  const nombreMayus = oficial.toUpperCase();
  const lugar = oficial === "techo_globos" ? "techo" : oficial === "bouquet" || oficial === "centro_mesa" ? az.elegir(["mesa", "centro"] as const) : az.elegir(["centro", "izquierda", "derecha", "fondo"] as const);
  const pieza: PiezaEspec = {
    id: `EST_${String(indice + 1).padStart(2, "0")}_${nombreMayus}`,
    oficial,
    nombre: `Pieza ${indice + 1} ${oficial}`,
    lugar,
    medidas: medidasDeEstructura(oficial, az),
    colores: coloresDe(az),
    tamanos: az.elegir(TAMANOS_ESPEC),
  };
  if (az.probar(0.75)) pieza.densidad = az.elegir(DENSIDADES_ESPEC);
  if (oficial === "aro_circular" && az.probar(0.15)) pieza.forma = "parcial";
  if (az.probar(0.15)) {
    const ref = colorAleatorio(az);
    pieza.flores = { cantidad: az.entero(1, 24), petalos: az.entero(3, 6), codigo: ref.codigo, ...(az.probar(0.3) ? { centro: colorAleatorio(az).codigo } : {}) };
  }
  if (oficial.startsWith("columna")) {
    if (az.probar(0.2)) pieza.capas = az.entero(2, Math.min(MAX_CAPAS_COLUMNA, 30));
    if (az.probar(0.2)) pieza.remate = { formatoId: az.elegir(FORMATOS_REMATE), codigo: colorAleatorio(az).codigo };
  }
  if (["bouquet", "racimo_pared", "centro_mesa"].includes(oficial) && az.probar(0.5)) pieza.unidades = az.entero(1, 12);
  if (az.probar(0.05)) pieza.declarada = { materiales: [{ formatoId: "R-12", codigo: colorAleatorio(az).codigo, cantidad: az.entero(1, 200) }], motivo: "Lo cuenta la lista del catálogo." };
  return pieza;
}

/** Cuántas piezas tiene el escenario: sobre todo una, a veces dos o tres, para que los escenarios se peleen por la sala. */
function cuantasPiezas(az: Azar): number {
  const t = az.siguiente();
  return t < 0.6 ? 1 : t < 0.9 ? 2 : 3;
}

export function escenarioDe(semillaBase: number, indice: number): Escenario {
  const semilla = semillaDeEscenario(semillaBase, indice);
  const az = crearAzar(semilla);
  const piezas = Array.from({ length: cuantasPiezas(az) }, (_, i) => piezaAleatoria(i, az));
  const espec: EspecClienteV1 = {
    version: "espec-cliente.v1",
    origen: { tipo: az.elegir(ORIGENES_ESPEC) },
    piezas,
  };
  return { id: `E-${String(indice).padStart(5, "0")}`, indice, semilla, espec };
}

/** Los escenarios de un lote, uno a uno (no se guardan todos en memoria). */
export function* generarLote(semillaBase: number, n: number): Generator<Escenario> {
  for (let i = 0; i < n; i++) yield escenarioDe(semillaBase, i);
}
