import { z } from "zod";
import { referenciaPorCodigo } from "@/lib/plan/referencia-sempertex";
import type { Caja, EscenaArmada, NodoArmado } from "../escena";
import { piezaDeNodo } from "./ids-nodos";

/**
 * **La armada compacta**: lo único de la geometría que sale del servidor. Posición, diámetro y color de cada globo,
 * los tubitos, las flores artificiales y la caja de cada pieza: lo justo para dibujar discos o esferas en el visor, sin
 * dar la receta del motor (D-019). Enteros en centímetros y vectores planos: 1 500 globos caben en menos de 30 KB.
 *
 * - `globos`: de 5 en 5, `x, y, z, diámetro, color` (el centro del cuerpo; `color` es un índice de `paleta`).
 * - `tubos`: grosor, color y los puntos `x, y, z` seguidos.
 * - `flores`: de 5 en 5, `x, y, z, diámetro, color`.
 * - `piezas[i]`: los tramos `[desde, cuántos]` que ocupa en cada lista (en unidades de 5 para globos y flores) y su caja
 *   `[minx, miny, minz, maxx, maxy, maxz]`. Las flores de globo de una pieza cuentan como suyas.
 */
export const VERSION_ARMADA = "armada-compacta.v1" as const;
export const TOPE_BYTES_ARMADA = 30 * 1024;
const COLOR_SIN_REFERENCIA = "#9ca3af";

const Tramo = z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]);

export const ArmadaCompactaV1Schema = z.object({
  version: z.literal(VERSION_ARMADA),
  sala: z.object({ anchoCm: z.number().int(), fondoCm: z.number().int(), altoCm: z.number().int() }).strict(),
  paleta: z.array(z.string().regex(/^#[0-9a-f]{6}$/)),
  globos: z.array(z.number().int()),
  tubos: z.array(z.object({ grosorCm: z.number(), color: z.number().int().nonnegative(), puntos: z.array(z.number().int()) }).strict()),
  flores: z.array(z.number().int()),
  piezas: z.array(z.object({
    id: z.string(),
    globos: Tramo,
    tubos: Tramo,
    flores: Tramo,
    caja: z.tuple([z.number().int(), z.number().int(), z.number().int(), z.number().int(), z.number().int(), z.number().int()]),
  }).strict()),
}).strict();

export type ArmadaCompactaV1 = z.infer<typeof ArmadaCompactaV1Schema>;

const entero = (n: number) => Math.round(n);

function hexDe(codigo: string, hexDeFlor?: string): string {
  if (hexDeFlor) return hexDeFlor.toLowerCase();
  return referenciaPorCodigo(codigo)?.hexGlobo ?? COLOR_SIN_REFERENCIA;
}

function unirCajas(cajas: readonly Caja[]): ArmadaCompactaV1["piezas"][number]["caja"] {
  if (!cajas.length) return [0, 0, 0, 0, 0, 0];
  const minimo = (k: "x" | "y" | "z") => entero(Math.min(...cajas.map((c) => c.min[k])));
  const maximo = (k: "x" | "y" | "z") => entero(Math.max(...cajas.map((c) => c.max[k])));
  return [minimo("x"), minimo("y"), minimo("z"), maximo("x"), maximo("y"), maximo("z")];
}

/** Agrupa los nodos de la escena por pieza del cliente, en el orden en que aparecen. */
function nodosPorPieza(armada: EscenaArmada): Map<string, NodoArmado[]> {
  const grupos = new Map<string, NodoArmado[]>();
  for (const nodo of armada.porNodo) {
    const id = piezaDeNodo(nodo.id);
    grupos.set(id, [...(grupos.get(id) ?? []), nodo]);
  }
  return grupos;
}

export function armadaCompacta(armada: EscenaArmada): ArmadaCompactaV1 {
  const paleta: string[] = [];
  const indiceDe = (hex: string) => {
    const existente = paleta.indexOf(hex);
    if (existente >= 0) return existente;
    paleta.push(hex);
    return paleta.length - 1;
  };
  const globos: number[] = [], flores: number[] = [];
  const tubos: ArmadaCompactaV1["tubos"] = [];
  const piezas: ArmadaCompactaV1["piezas"] = [];
  for (const [id, nodos] of nodosPorPieza(armada)) {
    const desdeGlobos = globos.length / 5, desdeTubos = tubos.length, desdeFlores = flores.length / 5;
    for (const nodo of nodos) {
      for (const g of nodo.globos) {
        const largo = g.infladoCm / 2 + g.cuelloExtraCm;
        globos.push(entero(g.nudo.x + g.direccion.x * largo), entero(g.nudo.y + g.direccion.y * largo), entero(g.nudo.z + g.direccion.z * largo), entero(g.infladoCm), indiceDe(hexDe(g.codigo)));
      }
      for (const t of nodo.tubos) tubos.push({ grosorCm: Math.round(t.grosorCm * 10) / 10, color: indiceDe(hexDe(t.codigo)), puntos: t.puntos.flatMap((p) => [entero(p.x), entero(p.y), entero(p.z)]) });
      for (const f of nodo.flores) flores.push(entero(f.posicion.x), entero(f.posicion.y), entero(f.posicion.z), entero(f.diametroCm), indiceDe(hexDe("", f.hex)));
    }
    piezas.push({
      id, globos: [desdeGlobos, globos.length / 5 - desdeGlobos], tubos: [desdeTubos, tubos.length - desdeTubos], flores: [desdeFlores, flores.length / 5 - desdeFlores],
      caja: unirCajas(nodos.map((n) => n.caja)),
    });
  }
  const { sala } = armada;
  return { version: VERSION_ARMADA, sala: { anchoCm: entero(sala.anchoCm), fondoCm: entero(sala.fondoCm), altoCm: entero(sala.altoCm) }, paleta, globos, tubos, flores, piezas };
}
