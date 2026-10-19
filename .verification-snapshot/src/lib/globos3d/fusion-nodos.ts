import { etiquetaDeLlave, sonIguales } from "./diff-escenas";
import { ambienteNormalizado, type NodoEscena, type Sala } from "./escena";

/**
 * Lo común de «deshacer turno», «rehacer turno» y «aplicar el turno» (D-021): mezclar una pieza campo a campo entre tres
 * versiones (la de ahora, de dónde se viene y adónde se va) y dejar la escena con sus padres en regla. Puro.
 */

export type MotivoConservada = "editada" | "quitada" | "en_uso" | "sala" | "sin_padre";
export type PiezaConservada = { id: string; nombre: string; motivo: MotivoConservada; /** Qué campos de la pieza se dejaron como los tenía la persona. */ campos?: string[] };

const esObjetoPlano = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

type Salida = { cambiados: string[]; conservados: string[] };

function mezclar(actual: unknown, desde: unknown, hasta: unknown, ruta: readonly string[], atomico: boolean, salida: Salida): unknown {
  if (sonIguales(desde, hasta)) return actual;
  if (!atomico && esObjetoPlano(actual) && esObjetoPlano(desde) && esObjetoPlano(hasta)) {
    const resultado: Record<string, unknown> = { ...actual };
    for (const k of new Set([...Object.keys(desde), ...Object.keys(hasta)])) {
      const r = mezclar(actual[k], desde[k], hasta[k], [...ruta, k], false, salida);
      if (r === undefined) delete resultado[k]; else resultado[k] = r;
    }
    return resultado;
  }
  // Ya está donde se quiere llevar (se deshizo con Ctrl+Z): ni se cambia ni es un conflicto.
  if (sonIguales(actual, hasta)) return actual;
  const etiqueta = etiquetaDeLlave(ruta[ruta.length - 1] ?? "pieza");
  if (sonIguales(actual, desde)) { salida.cambiados.push(etiqueta); return hasta; }
  salida.conservados.push(etiqueta);
  return actual;
}

export type ResultadoFusion = { nodo: NodoEscena; cambiados: string[]; conservados: string[] };

/**
 * Lleva `actual` de `desde` a `hasta` solo en los campos que la persona no tocó: lo que cambió entre `desde` y `hasta` y sigue
 * igual que en `desde` se cambia; lo que ya no está como en `desde` se deja. Una pieza que cambió de tipo, o de lugar
 * (piso → pared), se mueve entera o no se mueve: mezclar campos de dos tipos daría una pieza que no existe.
 */
export function fusionarNodo(actual: NodoEscena, desde: NodoEscena, hasta: NodoEscena): ResultadoFusion {
  const salida: Salida = { cambiados: [], conservados: [] };
  const a = actual as unknown as Record<string, unknown>, d = desde as unknown as Record<string, unknown>, h = hasta as unknown as Record<string, unknown>;
  const resultado: Record<string, unknown> = { ...a };
  for (const k of ["nombre", "pieza", "colocacion"] as const) {
    const atomico = (k === "pieza" && desde.pieza.tipo !== hasta.pieza.tipo) || (k === "colocacion" && desde.colocacion.en !== hasta.colocacion.en);
    resultado[k] = mezclar(a[k], d[k], h[k], [k], atomico, salida);
  }
  return { nodo: salida.cambiados.length ? (resultado as unknown as NodoEscena) : actual, ...salida };
}

export const padreDe = (n: NodoEscena): string | null => ("padreId" in n.colocacion ? n.colocacion.padreId : null);

/**
 * Deja la escena sin piezas colgadas de un padre que ya no está: toda pieza tocada por el turno cuyo padre falta vuelve a como
 * estaba en `actual` (o se quita si no estaba), y se anota. Se repite hasta que no quede ninguna.
 */
export function sanearPadres(nodos: NodoEscena[], actual: readonly NodoEscena[], tocadas: Set<string>, conservadas: PiezaConservada[], revertidas: string[]): NodoEscena[] {
  let resultado = nodos;
  for (;;) {
    const ids = new Set(resultado.map((n) => n.id));
    const huerfana = resultado.find((n) => tocadas.has(n.id) && padreDe(n) !== null && !ids.has(padreDe(n)!));
    if (!huerfana) return resultado;
    const previa = actual.find((n) => n.id === huerfana.id);
    resultado = previa ? resultado.map((n) => (n.id === huerfana.id ? previa : n)) : resultado.filter((n) => n.id !== huerfana.id);
    tocadas.delete(huerfana.id);
    const i = revertidas.indexOf(huerfana.id);
    if (i >= 0) revertidas.splice(i, 1);
    conservadas.push({ id: huerfana.id, nombre: huerfana.nombre, motivo: "sin_padre" });
  }
}

/** La sala que se devuelve de una copia: el ambiente se normaliza como al leer una escena guardada. */
export function salaNormalizada(sala: Sala): Sala {
  const { ambiente, ...resto } = sala;
  const bueno = ambienteNormalizado(ambiente);
  return bueno ? { ...resto, ambiente: bueno } : resto;
}

export const MOTIVO_TEXTO: Readonly<Record<MotivoConservada, string>> = {
  editada: "la editaste a mano después",
  quitada: "la quitaste a mano después",
  en_uso: "algo que pusiste después depende de ella",
  sala: "cambiaste la sala después",
  sin_padre: "la pieza de la que cuelga ya no está",
};

