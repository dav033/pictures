import type { DiferenciaEscena } from "./contrato";

const MAX_ELEMENTOS = 200;
const PROFUNDIDAD_RUTAS = 3;
/** Los ids y rutas vienen de la escena (texto libre): se acotan para que la diferencia nunca pase el tope de la columna. */
const MAX_TEXTO = 120;
const corto = (texto: string): string => (texto.length > MAX_TEXTO ? `${texto.slice(0, MAX_TEXTO - 1)}…` : texto);

type Objeto = Record<string, unknown>;

function esObjeto(valor: unknown): valor is Objeto {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

function iguales(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((valor, i) => iguales(valor, b[i]));
  if (esObjeto(a) && esObjeto(b)) {
    const claves = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const clave of claves) if (!iguales(a[clave], b[clave])) return false;
    return true;
  }
  return false;
}

/** Rutas de campo (`sala.ancho`) que difieren entre dos valores, bajando hasta `PROFUNDIDAD_RUTAS` niveles. */
function rutasDistintas(a: unknown, b: unknown, prefijo: string, profundidad: number, salida: string[]): void {
  if (iguales(a, b) || salida.length >= MAX_ELEMENTOS) return;
  if (esObjeto(a) && esObjeto(b) && profundidad < PROFUNDIDAD_RUTAS) {
    for (const clave of new Set([...Object.keys(a), ...Object.keys(b)])) {
      rutasDistintas(a[clave], b[clave], prefijo ? `${prefijo}.${clave}` : clave, profundidad + 1, salida);
    }
    return;
  }
  salida.push(corto(prefijo || "(raíz)"));
}

function nodosPorId(escena: Objeto): Map<string, Objeto> | null {
  const nodos = escena.nodos;
  if (!Array.isArray(nodos)) return null;
  const mapa = new Map<string, Objeto>();
  for (const nodo of nodos) {
    if (!esObjeto(nodo) || typeof nodo.id !== "string") return null;
    mapa.set(nodo.id, nodo);
  }
  return mapa;
}

function sinNodos(escena: Objeto): Objeto {
  return Object.fromEntries(Object.entries(escena).filter(([clave]) => clave !== "nodos"));
}

/**
 * Qué cambió entre la escena de antes y la de después del turno. Las escenas del Taller 3D traen `nodos` con `id`: se
 * reporta qué piezas se agregaron, quitaron o modificaron (y qué campos). Cualquier otra forma (el plan del chat del
 * cliente) se compara por rutas de campo.
 */
export function diferenciaEscenas(antes: Objeto, despues: Objeto): DiferenciaEscena {
  const nodosAntes = nodosPorId(antes);
  const nodosDespues = nodosPorId(despues);
  if (!nodosAntes || !nodosDespues) {
    const otros: string[] = [];
    rutasDistintas(antes, despues, "", 0, otros);
    return { agregados: [], quitados: [], modificados: [], otros };
  }

  const modificados: DiferenciaEscena["modificados"] = [];
  for (const [id, nodo] of nodosDespues) {
    const previo = nodosAntes.get(id);
    if (!previo || iguales(previo, nodo) || modificados.length >= MAX_ELEMENTOS) continue;
    const campos: string[] = [];
    rutasDistintas(previo, nodo, "", 0, campos);
    modificados.push({ id: corto(id), campos });
  }

  const otros: string[] = [];
  rutasDistintas(sinNodos(antes), sinNodos(despues), "", 0, otros);

  return {
    agregados: [...nodosDespues.keys()].filter((id) => !nodosAntes.has(id)).slice(0, MAX_ELEMENTOS).map(corto),
    quitados: [...nodosAntes.keys()].filter((id) => !nodosDespues.has(id)).slice(0, MAX_ELEMENTOS).map(corto),
    modificados,
    otros,
  };
}

export function hayCambios(diferencia: DiferenciaEscena): boolean {
  return diferencia.agregados.length + diferencia.quitados.length + diferencia.modificados.length + diferencia.otros.length > 0;
}
