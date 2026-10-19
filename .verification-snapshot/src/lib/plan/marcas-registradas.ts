import type { PlanDecoracion } from "./tipos";

/**
 * Character and brand names in customer-facing plan text (E2E 2026-09-15: the
 * photo had a Princess Leia cutout and the concept came back as "Decoración
 * Estilo Princesa Leia Galáctica"). A proposal cannot be sold under a
 * trademarked character or brand, and the same text feeds the image prompt.
 *
 * The prompt asks for generic wording; this is the minimal deterministic net
 * before the plan is signed. It removes a short list of unambiguous names
 * (well-known franchises, characters and toy brands) from the concept title and
 * description and from each structure's name and `porque`, then tidies the
 * connectors left behind. It never rewrites the rest of the text. Common first
 * names that are also character names ("Elsa", "Ariel", "Woody") are left out on
 * purpose: they are often the name of the person celebrated. Pure.
 */
const NOMBRES_PROTEGIDOS: readonly string[] = [
  "star\\s+wars", "leia", "darth\\s+vader", "baby\\s+yoda", "yoda", "grogu", "mandalorian[oa]?", "chewbacca", "skywalker", "stormtroopers?",
  "disney", "pixar", "marvel", "dc\\s+comics", "mickey(?:\\s+mouse)?", "minnie(?:\\s+mouse)?", "frozen", "toy\\s+story", "buzz\\s+lightyear",
  "(?:rayo|lightning)\\s+mc\\s?queen", "paw\\s+patrol", "patrulla\\s+canina", "peppa\\s+pig", "hello\\s+kitty", "barbie", "spider[-\\s]?man", "hombre\\s+ara[nñ]a",
  "batman", "superman", "wonder\\s+woman", "avengers", "vengadores", "pok[eé]mon", "pikachu", "super\\s+mario(?:\\s+bros)?", "mario\\s+bros", "minecraft",
  "fortnite", "roblox", "bluey", "cocomelon", "harry\\s+potter", "hogwarts", "pj\\s+masks", "transformers", "my\\s+little\\s+pony", "hot\\s+wheels", "sanrio", "kuromi",
];

const PATRON_NOMBRES = new RegExp(`(?<![\\p{L}\\p{N}])(?:${NOMBRES_PROTEGIDOS.join("|")})(?![\\p{L}\\p{N}])`, "giu");
const CONECTOR_COLGANTE = "(?:de|del|con|estilo|tipo|inspirad[oa]s?\\s+en|al\\s+estilo\\s+de|tem[aá]tica\\s+de)";

export function contieneMarcaRegistrada(texto: string): boolean {
  PATRON_NOMBRES.lastIndex = 0;
  const encontrado = PATRON_NOMBRES.test(texto);
  PATRON_NOMBRES.lastIndex = 0;
  return encontrado;
}

export function sinMarcasRegistradas(texto: string, respaldo: string): string {
  if (!contieneMarcaRegistrada(texto)) return texto;
  const limpio = texto
    .replace(PATRON_NOMBRES, " ")
    // "de y", "estilo ," or a connector at the end are left behind by the removal.
    .replace(new RegExp(`\\s+${CONECTOR_COLGANTE}(?=\\s*(?:[,.;:!?)]|\\s(?:y|e|o)\\s|$))`, "giu"), "")
    .replace(/\s+([,.;:!?)])/gu, "$1")
    .replace(/([(¿¡])\s+/gu, "$1")
    .replace(/\s{2,}/gu, " ")
    .replace(/^[\s,.;:–-]+|[\s,;:–-]+$/gu, "")
    .trim();
  if (!/\p{L}{3,}/u.test(limpio)) return respaldo;
  return limpio.charAt(0).toUpperCase() + limpio.slice(1);
}

const TITULO_NEUTRO = "Decoración temática";
const TEXTO_NEUTRO = "Decoración para tu evento.";

export function sanearMarcasPlan<T extends PlanDecoracion>(plan: T): T {
  return {
    ...plan,
    concepto: {
      ...plan.concepto,
      titulo: sinMarcasRegistradas(plan.concepto.titulo, TITULO_NEUTRO),
      descripcion: sinMarcasRegistradas(plan.concepto.descripcion, TEXTO_NEUTRO),
    },
    estructuras: plan.estructuras.map((estructura) => ({
      ...estructura,
      nombre: sinMarcasRegistradas(estructura.nombre, "Pieza decorativa"),
      porque: sinMarcasRegistradas(estructura.porque, TEXTO_NEUTRO),
    })),
  };
}
