import type { OpcionesOrganico, PuntoMezcla, TramoOrganico } from "./organico";

/**
 * Perfiles de tamaño para la columna de un orgánico: cómo se reparten los formatos de los globos a lo alto del
 * recorrido (`t`: 0 en el piso, 1 en la punta). Cada perfil es una mezcla de `PuntoMezcla` que reemplaza la de la
 * columna; con la misma semilla, el mismo perfil da siempre la misma pieza. Solo se aplica cuando el usuario lo elige:
 * una pieza sin perfil conserva su mezcla.
 */
export type PerfilTamano = { id: string; nombre: string; mezcla: readonly PuntoMezcla[] };

const CLAVE_PERFILES_PROPIOS = "taller3d.perfiles-tamano.v1";

/** Los cinco perfiles de fábrica: champaña, botella, bolo de bowling, cónico (taper) y lápiz (uniforme y chico). */
export const PERFILES_FABRICA: readonly PerfilTamano[] = [
  {
    id: "champana",
    nombre: "Champaña",
    mezcla: [
      { t: 0, pesos: { "R-5": 0.3, "R-9": 0.7 } },
      { t: 0.3, pesos: { "R-9": 0.5, "R-12": 0.5 } },
      { t: 0.65, pesos: { "R-12": 0.3, "R-18": 0.4, "R-24": 0.3 } },
      { t: 0.85, pesos: { "R-9": 0.2, "R-12": 0.5, "R-18": 0.3 } },
      { t: 1, pesos: { "R-9": 0.6, "R-12": 0.4 } },
    ],
  },
  {
    id: "botella",
    nombre: "Botella",
    mezcla: [
      { t: 0, pesos: { "R-9": 0.4, "R-12": 0.6 } },
      { t: 0.4, pesos: { "R-12": 0.25, "R-18": 0.4, "R-24": 0.35 } },
      { t: 0.6, pesos: { "R-12": 0.3, "R-18": 0.4, "R-24": 0.3 } },
      { t: 0.8, pesos: { "R-9": 0.5, "R-12": 0.5 } },
      { t: 1, pesos: { "R-5": 0.3, "R-9": 0.7 } },
    ],
  },
  {
    id: "bolo",
    nombre: "Bolo de bowling",
    mezcla: [
      { t: 0, pesos: { "R-5": 0.4, "R-9": 0.6 } },
      { t: 0.5, pesos: { "R-9": 0.5, "R-12": 0.5 } },
      { t: 0.8, pesos: { "R-12": 0.4, "R-18": 0.4, "R-24": 0.2 } },
      { t: 1, pesos: { "R-12": 0.2, "R-18": 0.45, "R-24": 0.35 } },
    ],
  },
  {
    id: "cono",
    nombre: "Cónico (taper)",
    mezcla: [
      { t: 0, pesos: { "R-18": 0.4, "R-24": 0.3, "R-12": 0.3 } },
      { t: 0.5, pesos: { "R-12": 0.5, "R-18": 0.2, "R-9": 0.3 } },
      { t: 1, pesos: { "R-5": 0.4, "R-9": 0.5, "R-12": 0.1 } },
    ],
  },
  {
    id: "lapiz",
    nombre: "Lápiz",
    mezcla: [
      { t: 0, pesos: { "R-9": 0.5, "R-12": 0.5 } },
      { t: 1, pesos: { "R-5": 0.4, "R-9": 0.6 } },
    ],
  },
];

/** La mezcla de un perfil (una copia: la pieza no comparte el arreglo de la lista de fábrica). */
export function mezclaDePerfil(perfil: PerfilTamano): PuntoMezcla[] {
  return perfil.mezcla.map((m) => ({ t: m.t, pesos: { ...m.pesos } }));
}

/** La mezcla de tamaños de la columna de un orgánico (undefined si no tiene columna). */
export function mezclaDeOpciones(opciones: OpcionesOrganico): readonly PuntoMezcla[] | undefined {
  return opciones.tramos.find((t) => t.id === "columna")?.mezcla;
}

/** El orgánico con la mezcla de su columna reemplazada por la del perfil; el resto de los tramos no se toca. */
export function aplicarPerfilTamano(opciones: OpcionesOrganico, perfil: PerfilTamano): OpcionesOrganico {
  if (!opciones.tramos.some((t) => t.id === "columna")) return opciones;
  const tramos: TramoOrganico[] = opciones.tramos.map((t) => (t.id === "columna" ? { ...t, mezcla: mezclaDePerfil(perfil) } : t));
  return { ...opciones, tramos };
}

const IDS_FABRICA: ReadonlySet<string> = new Set(PERFILES_FABRICA.map((p) => p.id));

/** Lo que se guarda en el navegador: solo los perfiles con la forma esperada, con mezcla, y sin el id de uno de fábrica. */
function esPerfil(valor: unknown): valor is PerfilTamano {
  if (!valor || typeof valor !== "object") return false;
  const p = valor as Record<string, unknown>;
  if (typeof p.id !== "string" || typeof p.nombre !== "string" || !Array.isArray(p.mezcla) || p.mezcla.length === 0) return false;
  if (IDS_FABRICA.has(p.id)) return false;
  return p.mezcla.every((m: unknown) => {
    if (!m || typeof m !== "object") return false;
    const q = m as Record<string, unknown>;
    return typeof q.t === "number" && !!q.pesos && typeof q.pesos === "object";
  });
}

/** Los perfiles propios guardados en este navegador; con cualquier error (sin almacén, JSON roto), ninguno. */
export function leerPerfilesPropios(almacen: Pick<Storage, "getItem"> | undefined): PerfilTamano[] {
  try {
    const crudo = almacen?.getItem(CLAVE_PERFILES_PROPIOS);
    if (!crudo) return [];
    const datos: unknown = JSON.parse(crudo);
    return Array.isArray(datos) ? datos.filter(esPerfil) : [];
  } catch {
    return [];
  }
}

/** Los perfiles propios sin el que tiene ese id. */
export function quitarPerfilPropio(perfiles: readonly PerfilTamano[], id: string): PerfilTamano[] {
  return perfiles.filter((p) => p.id !== id);
}

/** Dos mezclas son la misma si tienen los mismos puntos y los mismos pesos por formato. */
export function mismaMezcla(a: readonly PuntoMezcla[], b: readonly PuntoMezcla[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((p, i) => {
    const q = b[i]!;
    if (p.t !== q.t) return false;
    const claves = new Set([...Object.keys(p.pesos), ...Object.keys(q.pesos)]);
    return [...claves].every((k) => (p.pesos[k] ?? 0) === (q.pesos[k] ?? 0));
  });
}

/** El perfil (de fábrica o propio) cuya mezcla tiene la columna del orgánico; null si la mezcla es personalizada. */
export function perfilActivo(opciones: OpcionesOrganico, perfiles: readonly PerfilTamano[]): PerfilTamano | null {
  const mezcla = mezclaDeOpciones(opciones);
  if (!mezcla) return null;
  return [...PERFILES_FABRICA, ...perfiles].find((p) => mismaMezcla(p.mezcla, mezcla)) ?? null;
}

/** Guarda los perfiles propios; `false` si el navegador no deja escribir (privado, cuota llena, sin almacén). */
export function guardarPerfilesPropios(almacen: Pick<Storage, "setItem"> | undefined, perfiles: readonly PerfilTamano[]): boolean {
  try {
    almacen?.setItem(CLAVE_PERFILES_PROPIOS, JSON.stringify(perfiles));
    return almacen !== undefined;
  } catch {
    return false;
  }
}

/** Un perfil propio con nombre limpio y un id que no repite el de otro; `null` si el nombre va vacío. */
export function nuevoPerfilPropio(nombre: string, mezcla: readonly PuntoMezcla[], existentes: readonly PerfilTamano[]): PerfilTamano | null {
  const limpio = nombre.trim().replace(/\s+/g, " ");
  if (!limpio) return null;
  const base = `propio-${limpio.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
  const usados = new Set(existentes.map((p) => p.id));
  let id = base;
  for (let n = 2; usados.has(id); n++) id = `${base}-${n}`;
  return { id, nombre: limpio, mezcla: mezclaDePerfil({ id, nombre: limpio, mezcla }) };
}
