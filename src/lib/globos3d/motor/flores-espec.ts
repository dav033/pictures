import { resolverColorFlexible } from "../herramientas-escena-colores";
import type { Pieza } from "../piezas";
import type { FloresEspec } from "./espec-cliente-v1";
import type { BomLinea } from "./resultado-motor-v1";

/**
 * Las flores de globo de una pieza: `petalos` globos R-5 de un color y, si se pide, uno de centro de otro. La talla es
 * siempre R-5 (la regla del dueño, `flores-pieza.ts`). Lo que se cuenta sale de la espec y no de lo que se alcanzó a
 * dibujar: una pieza sin dónde colgarlas igual las lleva.
 */
const FORMATO_FLOR = "R-5";

export function florDeGlobos(flores: FloresEspec, notas: string[]): Pieza {
  const codigo = (c: string) => resolverColorFlexible(c, [FORMATO_FLOR], notas);
  return {
    tipo: "decoracion",
    decoracion: {
      tipo: "flor",
      propiedades: {
        petalos: { formatoId: FORMATO_FLOR, infladoCm: 10, codigo: codigo(flores.codigo), cantidad: flores.petalos, aperturaGrados: 6, giroGrados: 0 },
        centro: flores.centro ? { formatoId: FORMATO_FLOR, infladoCm: 8, codigo: codigo(flores.centro), cantidad: 1 } : null,
      },
    },
  };
}

export function lineasDeFlores(flores: FloresEspec, notas: string[]): BomLinea[] {
  const petalo = resolverColorFlexible(flores.codigo, [FORMATO_FLOR], notas);
  const lineas: BomLinea[] = [{ formatoId: FORMATO_FLOR, codigo: petalo, cantidad: flores.cantidad * flores.petalos }];
  if (flores.centro) lineas.push({ formatoId: FORMATO_FLOR, codigo: resolverColorFlexible(flores.centro, [FORMATO_FLOR], notas), cantidad: flores.cantidad });
  return lineas;
}
