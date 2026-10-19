import { TABLA_SEMPERTEX, type ReferenciaSempertex } from "@/lib/plan/referencia-sempertex";
import { coloresDelFormato } from "./formatos";
import { colorDeRescate, sustitutoDeFamilia } from "./colores-formato";
import type { Vec3 } from "./modulos";
import type { ColorOrganico } from "./organico";

/**
 * **El color de cada globo del motor orgánico** (paso 6 de `organico.ts`): por proporción (cuotas exactas sobre el total de
 * cada grupo de globos con los mismos colores posibles) y sin dos globos del mismo color pegados cuando se puede. Cada color
 * debe fabricarse en el formato del globo: si no, se usa el más parecido de su misma familia en ese formato (y se avisa); si
 * la familia no lo tiene parecido, ese color no se usa en ese globo; si ningún color de la paleta viene en un formato, el más
 * parecido que se fabrique en él (y se avisa), nunca el blanco.
 *
 * Los globos FIJOS (`codigoFijo`, los que pone la foto) conservan su código, pero cuentan en la cuota del color de la paleta
 * que los sirve (en su grupo): así «45 % dorados» incluye a los fijos dorados y no se pasa de largo con los demás.
 */

export type GloboParaColor = { formatoId: string; c: Vec3; r: number; codigoFijo?: string };

export type EntradaColor = {
  globos: readonly GloboParaColor[];
  colores: readonly ColorOrganico[];
  /** Id del tramo del globo `i` (los colores con `tramos` solo van en esos). */
  tramoDe: (i: number) => string;
  /** Fracción del recorrido de su tramo en que cae el globo `i` (solo se pide si algún color va por `franjas`). */
  fraccionDe: (i: number) => number;
  azar: () => number;
  avisos: string[];
};

export type ColorAsignado = {
  /** La paleta usable (sin los colores fuera de la tabla o de peso 0). */
  paleta: ColorOrganico[];
  /** La entrada de la paleta que tomó cada globo (null: ninguna, va el de rescate). */
  entrada: Array<number | null>;
  /** El código Sempertex final de cada globo. */
  codigos: string[];
};

export function asignarColores({ globos, colores, tramoDe, fraccionDe, azar, avisos }: EntradaColor): ColorAsignado {
  const referencias = new Map<string, ReferenciaSempertex>(TABLA_SEMPERTEX.referencias.map((r) => [r.codigo, r]));
  const paleta = colores.filter((c) => {
    if (referencias.has(c.codigo) && c.peso > 0) return true;
    avisos.push(`El color ${c.codigo} no está en la tabla Sempertex (o pesa 0): se quita de la paleta.`);
    return false;
  });
  if (paleta.length === 0) throw new Error("La paleta orgánica no tiene ningún color válido");
  const avisoSustitucion = new Set<string>();
  /** El código con que la entrada `e` se sirve en el formato: el suyo, el más parecido de su familia, o ninguno. */
  const codigoEn = (e: ColorOrganico, formatoId: string): string | null => {
    if (e.formatos && !e.formatos.includes(formatoId)) return null;
    const disponibles = coloresDelFormato(formatoId);
    if (disponibles.some((r) => r.codigo === e.codigo)) return e.codigo;
    const propia = referencias.get(e.codigo)!;
    const sustituto = sustitutoDeFamilia(propia, formatoId);
    const clave = `${e.codigo}|${formatoId}`;
    if (!avisoSustitucion.has(clave)) {
      avisoSustitucion.add(clave);
      avisos.push(sustituto
        ? `${propia.nombreCompleto} (${e.codigo}) no se fabrica en ${formatoId}: se usa ${sustituto.nombreCompleto} (${sustituto.codigo}).`
        : `${propia.nombreCompleto} (${e.codigo}) no se fabrica en ${formatoId} y su familia no tiene uno parecido: en ese formato no se usa.`);
    }
    return sustituto?.codigo ?? null;
  };
  const vecinos: number[][] = globos.map(() => []);
  for (let i = 0; i < globos.length; i++) {
    for (let j = i + 1; j < globos.length; j++) {
      const a = globos[i]!, b = globos[j]!;
      if (Math.hypot(a.c.x - b.c.x, a.c.y - b.c.y, a.c.z - b.c.z) <= a.r + b.r + 2) { vecinos[i]!.push(j); vecinos[j]!.push(i); }
    }
  }
  const entrada: Array<number | null> = globos.map(() => null);
  const codigos: Array<string | null> = globos.map(() => null), rescate = new Map<number, string>();
  const pegadoIgual = (i: number, k: number) => vecinos[i]!.some((j) => entrada[j] === k);
  const conFranjas = paleta.some((e) => e.franjas?.length);
  const porFormato = paleta.some((e) => e.porFormato);
  const fracciones = conFranjas ? globos.map((_, i) => fraccionDe(i)) : [];
  /** Si la entrada `e` de la paleta puede ir en el globo `i` (por su tramo y su franja). */
  const vaEnGlobo = (e: ColorOrganico, i: number) => {
    const id = tramoDe(i);
    if (e.tramos && !e.tramos.some((t) => id === t || id.startsWith(`${t}_`))) return false;
    return !e.franjas?.length || e.franjas.some((f) => fracciones[i]! >= Math.min(f.desde, f.hasta) - 1e-9 && fracciones[i]! <= Math.max(f.desde, f.hasta) + 1e-9);
  };

  // Los fijos primero: la entrada de la paleta que los sirve (la de su código, la de más peso si hay varias). Un fijo cuyo
  // código no sirve ninguna entrada (un color fuera de la paleta) conserva su código y no cuenta en ninguna cuota.
  globos.forEach((g, i) => {
    if (!g.codigoFijo) return;
    const sirven = [...paleta.keys()].filter((k) => vaEnGlobo(paleta[k]!, i) && codigoEn(paleta[k]!, g.formatoId) === g.codigoFijo);
    if (sirven.length) entrada[i] = sirven.reduce((m, k) => (paleta[k]!.peso > paleta[m]!.peso ? k : m));
  });
  const esFijoSinColor = (i: number) => Boolean(globos[i]!.codigoFijo) && entrada[i] === null;

  // Grupos de globos con las mismas entradas posibles: sin `tramos` ni `franjas` en la paleta, uno solo con todos.
  const grupos = new Map<string, { entradas: number[]; indices: number[] }>();
  globos.forEach((g, i) => {
    if (esFijoSinColor(i)) return;
    // Por tramo y franja; con colores `porFormato`, también por FORMATO: cada grupo reparte sus cuotas solo entre los colores
    // que pueden ir en sus globos (si no, la cuota de un color de un escalón se calculaba sobre todos y el sobrante caía al último).
    let entradas = [...paleta.keys()].filter((k) => vaEnGlobo(paleta[k]!, i) && (!porFormato || codigoEn(paleta[k]!, g.formatoId) !== null));
    if (entradas.length === 0) entradas = [...paleta.keys()].filter((k) => vaEnGlobo(paleta[k]!, i));
    // Un globo justo en el borde de dos franjas que no cae en ninguna: los colores de su tramo, sin mirar franjas.
    if (entradas.length === 0 && conFranjas) entradas = [...paleta.keys()].filter((k) => vaEnGlobo({ ...paleta[k]!, franjas: [] }, i));
    // Un fijo cuenta en SU color aunque el grupo no lo ofrezca por otro motivo.
    if (g.codigoFijo && !entradas.includes(entrada[i]!)) entradas = [...entradas, entrada[i]!].sort((a, b) => a - b);
    const clave = entradas.join(",");
    const grupo = grupos.get(clave) ?? { entradas, indices: [] };
    grupo.indices.push(i);
    grupos.set(clave, grupo);
  });
  for (const { entradas, indices } of grupos.values()) {
    if (entradas.length === 0) {
      avisos.push("Hay globos sin ningún color de la paleta que pueda ir en ellos (revisa `tramos` y `franjas` de los colores): se usa Fashion Blanco (005).");
      continue;
    }
    const pesoTotal = entradas.reduce((acc, k) => acc + paleta[k]!.peso, 0);
    const exactas = new Map(entradas.map((k) => [k, (paleta[k]!.peso / pesoTotal) * indices.length]));
    const cuotas = new Map(entradas.map((k) => [k, Math.floor(exactas.get(k)!)]));
    const sobrante = indices.length - [...cuotas.values()].reduce((a, b) => a + b, 0);
    [...entradas].sort((a, b) => (exactas.get(b)! - cuotas.get(b)!) - (exactas.get(a)! - cuotas.get(a)!) || a - b).slice(0, sobrante).forEach((k) => { cuotas.set(k, cuotas.get(k)! + 1); });
    // Los fijos del grupo ya tienen su color: no se reparten, y descuentan de la cuota de ese color.
    const fijosDe = (k: number) => indices.filter((i) => globos[i]!.codigoFijo && entrada[i] === k).length;
    const elegibles = new Map(entradas.map((k) => [k, indices.filter((i) => !globos[i]!.codigoFijo && codigoEn(paleta[k]!, globos[i]!.formatoId) !== null)]));
    const orden = [...entradas].sort((a, b) => elegibles.get(a)!.length - elegibles.get(b)!.length || a - b);
    orden.forEach((k, posicion) => {
      let lista = elegibles.get(k)!.filter((i) => entrada[i] === null);
      for (let i = lista.length - 1; i > 0; i--) {
        const j = Math.floor(azar() * (i + 1));
        [lista[i], lista[j]] = [lista[j]!, lista[i]!];
      }
      const exacto = (i: number) => coloresDelFormato(globos[i]!.formatoId).some((r) => r.codigo === paleta[k]!.codigo);
      lista = [...lista.filter(exacto), ...lista.filter((i) => !exacto(i))];
      const ultimo = posicion === orden.length - 1;
      let restante = ultimo ? lista.length : Math.max(0, cuotas.get(k)! - fijosDe(k));
      for (const pasada of [0, 1]) {
        for (const i of lista) {
          if (restante <= 0) break;
          if (entrada[i] !== null || (pasada === 0 && pegadoIgual(i, k))) continue;
          entrada[i] = k;
          restante--;
        }
      }
    });
  }
  // Los que no pudo tomar nadie (solo pasa con paletas muy restringidas): la entrada posible con menos vecinos iguales.
  globos.forEach((g, i) => {
    if (entrada[i] !== null || g.codigoFijo) return;
    const posibles = paleta.map((e, k) => ({ k, ok: vaEnGlobo(e, i) && codigoEn(e, g.formatoId) !== null })).filter((x) => x.ok).map((x) => x.k);
    if (posibles.length === 0) {
      const { ref, aviso } = colorDeRescate(paleta.filter((e) => vaEnGlobo(e, i)), referencias, g.formatoId);
      if (ref) rescate.set(i, ref.codigo);
      if (!avisoSustitucion.has(aviso)) { avisoSustitucion.add(aviso); avisos.push(aviso); }
      return;
    }
    posibles.sort((a, b) => vecinos[i]!.filter((j) => entrada[j] === a).length - vecinos[i]!.filter((j) => entrada[j] === b).length || a - b);
    entrada[i] = posibles[0]!;
  });
  globos.forEach((g, i) => {
    const k = entrada[i];
    codigos[i] = g.codigoFijo && referencias.has(g.codigoFijo) ? g.codigoFijo : k === null || k === undefined ? rescate.get(i) ?? "005" : codigoEn(paleta[k]!, g.formatoId) ?? "005";
  });
  return { paleta, entrada, codigos: codigos as string[] };
}
