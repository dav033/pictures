export type TemaId =
  | "tropical"
  | "neon"
  | "corazones"
  | "huellitas"
  | "destellos"
  | "puntos"
  | "verde"
  | "azul"
  | "rosa"
  | "luxury"
  | "futbol"
  | "marca";

const REGLAS: Array<{ tema: TemaId; patrones: RegExp[] }> = [
  { tema: "tropical", patrones: [/tropical/i] },
  { tema: "neon", patrones: [/ne[oó]n/i] },
  { tema: "corazones", patrones: [/coraz[oó]n/i] },
  { tema: "huellitas", patrones: [/huellit/i] },
  { tema: "destellos", patrones: [/destell/i] },
  { tema: "puntos", patrones: [/punto/i] },
  { tema: "verde", patrones: [/verde/i, /frondos/i] },
  { tema: "azul", patrones: [/azul/i] },
  { tema: "rosa", patrones: [/rosa/i, /pink/i] },
  { tema: "luxury", patrones: [/luxury/i, /gala/i] },
  { tema: "futbol", patrones: [/f[uú]tbol/i] },
];

/**
 * No hay imagen ni campo de tema en la API de Happia — el nombre del
 * paquete ya implica una paleta ("Neón", "Tropical", "Corazones"...). Se
 * deriva el tema por coincidencia de palabra clave, determinista y sin
 * LLM; un nombre que no matchea cae al tema de marca.
 */
export function derivarTemaId(nombre: string): TemaId {
  for (const regla of REGLAS) {
    if (regla.patrones.some((patron) => patron.test(nombre))) return regla.tema;
  }
  return "marca";
}
