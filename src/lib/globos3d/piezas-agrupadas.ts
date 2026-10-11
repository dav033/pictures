import type { NodoArmado } from "./escena";
import { nombreGenerico } from "./biblioteca";
import type { TuboDecoracion } from "./decoraciones";
import type { GloboDePieza } from "./piezas";
import { referenciaPorCodigo } from "../plan/referencia-sempertex";
import { textoGlobos } from "./texto-cantidad";

/**
 * Una línea de la lista «Por pieza»: piezas con el mismo nombre genérico y el mismo contenido por copia. `sufijo` dice
 * color y tamaño cuando otro grupo comparte el nombre.
 */
export type GrupoDePiezas = {
  nombre: string;
  sufijo: string;
  piezas: NodoArmado[];
  globos: number;
  copias: number;
};

export type FilaPorPieza = {
  etiqueta: string;
  cuenta: string;
  expandible: boolean;
  piezas: Array<{ nombre: string; cuenta: string }>;
};

const firmaGlobo = (g: GloboDePieza) => [g.formatoId, g.codigo, g.infladoCm, g.parte ?? "", g.helio ? 1 : 0, g.confeti ? 1 : 0, JSON.stringify(g.estampado ?? null)].join("|");

const distancia = (a: TuboDecoracion["puntos"][number], b: TuboDecoracion["puntos"][number]) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const longitudDeTubo = (t: TuboDecoracion) => Math.round(t.puntos.reduce((suma, p, i) => (i ? suma + distancia(t.puntos[i - 1]!, p) : 0), 0));
const firmaTubo = (t: TuboDecoracion) => `${t.formatoId}|${t.codigo}|${t.grosorCm}|${t.cerrado ? 1 : 0}|${t.parte ?? ""}|${t.papel?.hex ?? ""}|${t.papel?.relleno ? 1 : 0}|${longitudDeTubo(t)}`;

/**
 * Lo que una pieza lleva por copia, sin posiciones: la misma decoración puesta en otro sitio tiene la misma firma.
 * Las que no se pusieron (sin copias o sin globos) y las de escenografía (sólidos) llevan su id: no se agrupan.
 */
function firmaDePieza(n: NodoArmado): string {
  if (n.copias === 0 || n.globos.length === 0 || n.solidos.length) return `unica|${n.id}`;
  const globos = n.globos.map(firmaGlobo).sort().join(";");
  const tubos = n.tubos.map(firmaTubo).sort().join(";");
  const flores = n.flores.map((f) => `${f.tipo}|${f.hex}|${f.diametroCm}`).sort().join(";");
  return `${n.copias}#${globos}#${tubos}#${flores}`;
}

const colorDe = (codigo: string) => referenciaPorCodigo(codigo)?.nombreCompleto ?? codigo;

/** Cómo se distingue un grupo de otro con el mismo nombre: su primer globo (formato y color) o su tubo (grosor y papel). */
function descripcionDe(piezas: readonly NodoArmado[]): string {
  const globo = piezas.flatMap((n) => n.globos)[0];
  if (globo) return `${globo.formatoId} ${colorDe(globo.codigo)}`;
  const tubo = piezas.flatMap((n) => n.tubos)[0];
  if (tubo) return `tubo ${tubo.grosorCm} cm${tubo.papel ? ` ${tubo.papel.hex}` : ""}`;
  return "sin globos";
}

/** Agrupa las piezas de la escena en el orden de su primera aparición; si dos grupos tienen el mismo nombre, los distingue. */
export function agruparPiezas(piezas: readonly NodoArmado[]): GrupoDePiezas[] {
  const grupos = new Map<string, GrupoDePiezas>();
  for (const n of piezas) {
    const clave = `${nombreGenerico(n.nombre)}\u0000${firmaDePieza(n)}`;
    const grupo = grupos.get(clave) ?? { nombre: nombreGenerico(n.nombre), sufijo: "", piezas: [], globos: 0, copias: 0 };
    grupo.piezas.push(n);
    grupo.globos += n.globos.length;
    grupo.copias += n.copias;
    grupos.set(clave, grupo);
  }
  const todos = [...grupos.values()];
  for (const g of todos) {
    const hermanos = todos.filter((x) => x.nombre === g.nombre);
    if (hermanos.length < 2) continue;
    const descripciones = hermanos.map((x) => descripcionDe(x.piezas));
    const i = hermanos.indexOf(g);
    g.sufijo = descripciones.filter((d) => d === descripciones[i]).length > 1 ? `${descripciones[i]} (${i + 1})` : (descripciones[i] ?? "");
  }
  return todos;
}

/** «Ojo con venas × 14» (una pieza sola: «Mesa 1»), con color y tamaño si otro grupo tiene el mismo nombre. */
export function etiquetaDeGrupo(g: GrupoDePiezas): string {
  const base = g.piezas.length > 1 ? `${g.nombre} × ${g.piezas.length}` : (g.piezas[0]?.nombre ?? g.nombre);
  return g.sufijo ? `${base} (${g.sufijo})` : base;
}

/** «14 globos» o «6 globos · 2 copias»: lo mismo en pantalla y en el texto copiado. */
export function cuentaDeGrupo(g: GrupoDePiezas): string {
  return `${textoGlobos(g.globos)}${g.copias > g.piezas.length ? ` · ${g.copias} copias` : ""}`;
}

/** «2 globos» o «2 globos · 3 copias» para una pieza. */
export function cuentaDePieza(n: NodoArmado): string {
  return `${textoGlobos(n.globos.length)}${n.copias > 1 ? ` · ${n.copias} copias` : ""}`;
}

/** Lo que muestra «Por pieza», igual en pantalla y en el texto copiado. */
export function filasPorPieza(grupos: readonly GrupoDePiezas[]): FilaPorPieza[] {
  return grupos.map((g) => ({
    etiqueta: etiquetaDeGrupo(g),
    cuenta: cuentaDeGrupo(g),
    expandible: g.piezas.length > 1,
    piezas: g.piezas.map((n) => ({ nombre: n.nombre, cuenta: cuentaDePieza(n) })),
  }));
}

/** Las líneas del texto copiado: una por fila y, en un grupo, una por pieza con su nombre. */
export function textoPorPieza(filas: readonly FilaPorPieza[]): string[] {
  return filas.flatMap((f) => [`${f.etiqueta} · ${f.cuenta}`, ...(f.expandible ? f.piezas.map((p) => `   ${p.nombre} · ${p.cuenta}`) : [])]);
}
