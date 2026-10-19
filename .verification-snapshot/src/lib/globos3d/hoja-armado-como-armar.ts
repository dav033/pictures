import { referenciaPorCodigo } from "@/lib/plan/referencia-sempertex";
import { CONTORNOS_PREDEFINIDOS, type ContornoForma, type TecnicaRelleno } from "./formas";
import { opcionesArcoOrganico } from "./formas-escena";
import { formatoPorId, infladoValido } from "./formatos";
import type { GloboHoja } from "./hoja-armado-comun";
import type { TramoHoja } from "./hoja-armado-tramos";
import { INFLADO_GRANDE_CM, type OpcionesOrganico } from "./organico";
import type { Pieza } from "./piezas";
import { textoNumero } from "./texto-cantidad";

/**
 * El «cómo armar» de lo que la hoja da en franjas de altura (no por capas). Todo sale de lo que el motor ya sabe, nada se
 * supone:
 * - lo **orgánico** (arcos, columnas y guirnaldas orgánicas) se arma como lo documenta `organico.ts`: primero los globos grandes
 *   (anclas, de `INFLADO_GRANDE_CM` en adelante), luego los medianos que forman la estructura y al final el relleno (los globos de
 *   «<parte>/relleno»), que tapa los huecos. Esa es la orden de cada franja; el motor no fija en qué sitio exacto de la franja va
 *   cada globo, y la hoja lo dice;
 * - una **forma rellena** (un número o una letra de globos, un corazón…) dice su contorno y su técnica de relleno.
 */

/** Cómo se lee una franja de una pieza orgánica: el orden es el del motor y la posición exacta no está fijada. */
export const NOTA_ORGANICA =
  "Tabla por franja de altura (medida sobre el punto más bajo de la pieza): sirve para contar y preparar los globos de cada franja. No sirve para armar por capas; en cada franja el orden es primero lo grande (las anclas), luego la estructura mediana y al final el relleno que tapa los huecos, y la hoja no fija en qué sitio exacto de la franja va cada globo.";

/** Una forma rellena se arma por su técnica; las franjas sirven para contar y preparar los globos. */
export const NOTA_FORMA_RELLENA = "Tabla por franja de altura (medida sobre el punto más bajo de la pieza): sirve para contar y preparar los globos de cada franja. No sirve para armar por capas; cómo se arma la forma lo dice su técnica.";

type GloboDeFranja = Pick<GloboHoja, "formatoId" | "infladoCm" | "parte">;

const esRelleno = (g: GloboDeFranja): boolean => g.parte?.endsWith("/relleno") === true;

/** ¿Es una pieza del motor orgánico (columna, arco, guirnalda o racimo orgánico)? */
export const esOrganica = (pieza: Pieza | undefined): boolean => pieza?.tipo === "organico" || pieza?.tipo === "arco_organico";

/** Las opciones del motor orgánico de una pieza, si lo es (un arco orgánico las calcula de su medida). */
function opcionesOrganicas(pieza: Pieza | undefined): OpcionesOrganico | undefined {
  if (pieza?.tipo === "organico") return pieza.opciones;
  if (pieza?.tipo === "arco_organico") return opcionesArcoOrganico(pieza.arco);
  return undefined;
}

/** Lo que el motor orgánico usa de una pieza para ordenar sus globos: el inflado nominal de cada formato y los racimitos de relleno. */
type OrdenOrganico = { nominal: (formatoId: string, infladoCm: number) => number; racimos: ReadonlyMap<string, number> };

/**
 * Un globo es ancla por el inflado NOMINAL de su formato (`organico.ts` decide así, no por lo que mide cada globo con su ±7 %), y
 * el relleno en «trios» lleva racimitos de 3 a 6 (3 por omisión), con el mismo tope del motor.
 */
function ordenDe(opciones: OpcionesOrganico): OrdenOrganico {
  return {
    nominal: (formatoId, infladoCm) => {
      const formato = formatoPorId(formatoId);
      return formato ? infladoValido(formato, opciones.inflados?.[formatoId] ?? formato.infladoDecoracionCm) : infladoCm;
    },
    racimos: new Map(opciones.relleno.filter((r) => r.trios).map((r) => [r.formatoId, Math.min(6, Math.max(3, r.racimo ?? 3))] as const)),
  };
}

/** «3 × R-12 de 26 a 29 cm» o «2 × R-9 a 20 cm»: los globos de un paso por formato (el más grande primero), con su tamaño inflado al cm. */
function textoPorFormato(globos: readonly GloboDeFranja[], racimos: ReadonlyMap<string, number>): string {
  const porFormato = new Map<string, number[]>();
  for (const g of globos) porFormato.set(g.formatoId, [...(porFormato.get(g.formatoId) ?? []), Math.round(g.infladoCm)]);
  return [...porFormato.entries()]
    .sort((a, b) => Math.max(...b[1]) - Math.max(...a[1]) || a[0].localeCompare(b[0]))
    .map(([formato, cm]) => {
      const menor = Math.min(...cm), mayor = Math.max(...cm);
      const racimo = racimos.get(formato);
      return `${cm.length} × ${formato} ${mayor > menor ? `de ${menor} a ${mayor} cm` : `a ${menor} cm`}${racimo ? ` (en racimitos de hasta ${racimo})` : ""}`;
    })
    .join(", ");
}

/**
 * Qué se arma primero, después y al final en una franja orgánica, con los tamaños de cada paso (el relleno de R-5 va en racimitos
 * donde el motor lo pone así). `undefined` si la franja es de un solo paso (todo estructura): no hay orden que dar.
 */
export function comoArmarFranjaOrganica(globos: readonly GloboDeFranja[], orden: OrdenOrganico): string | undefined {
  const esAncla = (g: GloboDeFranja) => orden.nominal(g.formatoId, g.infladoCm) >= INFLADO_GRANDE_CM;
  const pasos = [
    { nombre: "anclas", globos: globos.filter((g) => !esRelleno(g) && esAncla(g)), racimos: new Map<string, number>() },
    { nombre: "estructura", globos: globos.filter((g) => !esRelleno(g) && !esAncla(g)), racimos: new Map<string, number>() },
    { nombre: "relleno", globos: globos.filter(esRelleno), racimos: orden.racimos },
  ].filter((p) => p.globos.length > 0);
  if (pasos.length < 2) return undefined;
  return `Orden: ${pasos.map((p, i) => `${i + 1}.º ${p.nombre}: ${textoPorFormato(p.globos, p.racimos)}`).join(" · ")}`;
}

/** Las franjas de una pieza orgánica con su «cómo armar»; las de otras piezas quedan como están. */
export function conComoArmarOrganico(tramos: readonly TramoHoja[], pieza: Pieza | undefined): TramoHoja[] {
  const opciones = opcionesOrganicas(pieza);
  if (!opciones) return [...tramos];
  const orden = ordenDe(opciones);
  return tramos.map((t) => ({ ...t, comoArmar: comoArmarFranjaOrganica(t.globos, orden) }));
}

const nombreDeContorno = (c: ContornoForma): string => {
  if (c.tipo === "texto") {
    const alto = Math.round(c.altoCm + c.grosorCm);
    return c.disposicion === "columna" ? `«${c.texto}» en columna, cada carácter de unos ${alto} cm de alto, con el trazo de ${c.grosorCm} cm de ancho` : `«${c.texto}» de unos ${alto} cm de alto, con el trazo de ${c.grosorCm} cm de ancho`;
  }
  if (c.tipo === "predefinido") return `${CONTORNOS_PREDEFINIDOS.find((x) => x.id === c.id)?.nombre ?? "Forma"} de ${c.anchoCm} × ${c.altoCm} cm`;
  return "Silueta libre";
};

/** El inflado que el motor usa de verdad (nunca más del máximo del formato ni menos del 40 %), no el pedido. */
function infladoDe(formatoId: string, pedidoCm: number): string {
  const formato = formatoPorId(formatoId);
  return textoNumero(formato ? infladoValido(formato, pedidoCm) : pedidoCm);
}

function textoTecnica(t: TecnicaRelleno): string {
  switch (t.tipo) {
    case "celdas":
      return `Celdas de ${t.formatoId} inflado a ${infladoDe(t.formatoId, t.infladoCm)} cm: una hilera sigue el borde por dentro y el interior va en retícula ${t.celda === "cuadrada" ? "cuadrada" : "al tresbolillo (cada hilera corrida media celda)"}; los huecos que quedan se tapan con globos iguales o más chicos.`;
    case "malla":
      return `Malla de Link-O-Loon ${t.formatoId} inflado a ${infladoDe(t.formatoId, t.infladoCm)} cm: la cadeneta sigue el borde y dentro va la malla diagonal, con una pareja de R-5 ${referenciaPorCodigo(t.union.codigo)?.nombreCompleto ?? t.union.codigo} a ${infladoDe("R-5", t.union.infladoCm)} cm en cada nudo.`;
    case "organico": {
      const total = Object.values(t.mezcla).reduce((suma, peso) => suma + peso, 0) || 1;
      const mezcla = Object.entries(t.mezcla).map(([formato, peso]) => `${formato} ${Math.round((peso / total) * 100)} %`).join(", ");
      return `Capa orgánica de unos ${textoNumero(t.radioCm * 2)} cm de grueso, sobre el esqueleto de la forma: globos de tamaños mezclados (${mezcla}); la tabla de abajo dice cuántos de cada tamaño lleva cada franja.`;
    }
  }
}

/** El contorno y la técnica de una forma rellena, una línea cada uno; vacío para los volúmenes (esfera, cono, árbol, aerostático). */
export function comoArmarForma(pieza: Pieza | undefined): string[] {
  if (pieza?.tipo !== "forma" || pieza.forma.clase !== "rellena") return [];
  const f = pieza.forma;
  const extras = [
    f.borde ? `Hilera del borde de otro color: ${referenciaPorCodigo(f.borde.codigo)?.nombreCompleto ?? f.borde.codigo}.` : "",
    f.marcoCm ? `Solo un marco de ${f.marcoCm} cm junto al borde: el centro queda hueco.` : "",
    f.acento ? `Acentos: globitos ${f.acento.formatoId} de ${textoNumero(f.acento.infladoCm)} cm metidos en los huecos${f.acento.cada && f.acento.cada > 1 ? ` (uno de cada ${f.acento.cada})` : ""}.` : "",
  ].filter(Boolean);
  return [`Forma rellena de globos: ${nombreDeContorno(f.contorno)}.`, textoTecnica(f.tecnica), ...extras];
}
