import { z } from "zod";
import type { Escena, NodoEscena } from "./escena";
import { coloresDelFormato, formatoPorId } from "./formatos";
import { fallar, nombreDe, resolverColor } from "./herramientas-escena-colores";
import { clasesDe, type HerramientaExtra } from "./herramientas-escena-grupos";
import { armarPieza } from "./piezas";
import { infladoDeRemate, type RemateGlobo } from "./remate";

/**
 * **poner_remate**: el globo de arriba de las columnas («un R-36 arriba de cada columna», «el globo de arriba en
 * dorado», «quítale el globo de arriba»). Va en la pieza (`Pieza.remate`), amarrado sobre su punta con el nudo abajo:
 * nunca un globo suelto con poner_sobre, que queda de lado y metido en la columna.
 */

const RemateSchema = z.object({
  ids: z.array(z.string().min(1).max(80)).max(12).optional().describe("ids de las columnas; si falta, TODAS las columnas de la escena"),
  formato: z.string().min(3).max(6).optional().describe("formato redondo del globo de arriba: R-5, R-9, R-12, R-18, R-24 o R-36 (por defecto el que ya tenía, o R-24)"),
  color: z.string().min(1).max(60).optional().describe("color (nombre o código); si falta, el que ya tenía o el color principal de la columna"),
  inflado_cm: z.number().min(10).max(100).optional().describe("inflado (cm); si falta, el de decoración del formato (R-36 ≈ 90 cm)"),
  quitar: z.boolean().optional().describe("true: quitar el globo de arriba"),
});

const esColumna = (n: NodoEscena) => n.pieza.tipo === "columna" || (clasesDe(n).has("columna") && n.pieza.tipo !== "decoracion");

/** El color que más lleva la pieza y que se fabrica en ese formato (o Fashion Blanco). */
function colorPrincipal(n: NodoEscena, formatoId: string): string {
  const hay = new Set(coloresDelFormato(formatoId).map((r) => r.codigo));
  const cuenta = new Map<string, number>();
  for (const g of armarPieza({ ...n.pieza, remate: undefined }).globos) cuenta.set(g.codigo, (cuenta.get(g.codigo) ?? 0) + 1);
  const orden = [...cuenta.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  return orden.find((c) => hay.has(c)) ?? "005";
}

function aplicar(escena: Escena, argumentos: unknown): { escena: Escena; resumen: string } {
  const a = RemateSchema.parse(argumentos ?? {});
  const objetivos = a.ids?.length
    ? a.ids.map((id) => escena.nodos.find((n) => n.id === id) ?? fallar(`No hay pieza con id «${id}». Usa ver_escena para ver los ids.`))
    : escena.nodos.filter(esColumna);
  if (!objetivos.length) fallar("No hay columnas en la escena. Agrega una (agregar_estructura tipo columna) o pásame los ids.");
  const notas: string[] = [];
  const hechas: string[] = [];
  const nodos = escena.nodos.map((n) => {
    if (!objetivos.includes(n)) return n;
    if (a.quitar) {
      if (!n.pieza.remate) { notas.push(`«${n.nombre}» no tenía globo arriba.`); return n; }
      const { remate: _fuera, ...resto } = n.pieza;
      hechas.push(`«${n.nombre}»`);
      return { ...n, pieza: resto };
    }
    const formatoId = (a.formato ?? n.pieza.remate?.formatoId ?? "R-24").toUpperCase().replace(/^R(\d)/, "R-$1");
    const formato = formatoPorId(formatoId);
    if (!formato || formato.tipo !== "redondo") fallar(`El globo de arriba va con un redondo (R-5, R-9, R-12, R-18, R-24 o R-36), no «${a.formato}».`);
    let codigo: string;
    if (a.color) {
      const r = resolverColor(a.color, formatoId);
      if (r.nota) notas.push(r.nota);
      codigo = r.codigo;
    } else {
      const previo = n.pieza.remate?.codigo;
      codigo = previo && coloresDelFormato(formatoId).some((r) => r.codigo === previo) ? previo : colorPrincipal(n, formatoId);
    }
    const remate: RemateGlobo = { formatoId, codigo, ...(a.inflado_cm ? { infladoCm: a.inflado_cm } : {}) };
    const inflado = infladoDeRemate(remate);
    const alto = Math.round(armarPieza({ ...n.pieza, remate }).caja.max.y);
    const ref = coloresDelFormato(formatoId).find((r) => r.codigo === codigo);
    hechas.push(`«${n.nombre}» (${formatoId} ${ref ? nombreDe(ref) : codigo}, ${Math.round(inflado)} cm; alto total ${alto} cm)`);
    return { ...n, pieza: { ...n.pieza, remate } };
  });
  const resumen = a.quitar
    ? hechas.length ? `Quité el globo de arriba de ${hechas.join(", ")}.` : "No había globos de arriba que quitar."
    : `Globo de arriba (amarrado sobre la punta, nudo abajo) en ${hechas.join(", ")}.`;
  return { escena: { ...escena, nodos }, resumen: [resumen, ...new Set(notas)].join(" ") };
}

export const HERRAMIENTAS_REMATE: Readonly<Record<string, HerramientaExtra>> = {
  poner_remate: {
    esquema: RemateSchema,
    descripcion: "Pone, cambia o quita el GLOBO DE ARRIBA de las columnas (clásicas u orgánicas): «un R-36 arriba de cada columna», «el globo de arriba dorado», «quítale el globo de arriba». Va amarrado sobre la punta, con el nudo abajo, y cotiza con la columna (parte «remate»). Úsala SIEMPRE para un globo encima de una columna; nunca agregar un globo suelto + poner_sobre.",
    aplicar,
  },
};
