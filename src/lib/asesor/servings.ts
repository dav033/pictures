/** What one unit of a service yields (pieces, portions, glasses), read from what the catalogue itself says. */
export type Serves = { amount: number; unit: "piezas" | "porciones" | "trozos" | "vasos"; estimated: boolean };

type Servable = { name: string | null; description: string | null; category_name: string };

const FOOD_OR_DRINK = /comida|bebida|reposter/i;
const GLASS_ML = 250;

const num = (text: string) => Number(text.replace(",", "."));

/**
 * Pieces from "x20" in the name ("Picadas-Minidedito x20 + Miniquibbe x20" is 40), portions when the catalogue says
 * "12-14 porciones" (the low end), and, only as a labelled estimate, slices of a cake by its weight (a half pound is about
 * five slices) and glasses of a drink by its volume (250 ml each). Anything else yields no figure rather than a guess.
 */
export function servesOfService(service: Servable): Serves | null {
  const name = service.name ?? "";
  const text = `${name} ${service.description ?? ""}`;
  const portions = /(\d+)\s*[-–]\s*(\d+)\s*porciones/i.exec(text) ?? /(\d+)\s*porciones/i.exec(text);
  if (portions) return { amount: Math.min(...portions.slice(1).map(Number)), unit: "porciones", estimated: false };
  if (!FOOD_OR_DRINK.test(service.category_name)) return null;
  const pieces = [...name.matchAll(/\bx\s?(\d{1,3})\b/gi)].map((match) => Number(match[1]));
  if (pieces.length > 0) return { amount: pieces.reduce((sum, count) => sum + count, 0), unit: "piezas", estimated: false };
  const pounds = /(\d+)\s*\/\s*(\d+)\s*lb/i.exec(name);
  if (pounds && /torta|pastel|cake/i.test(name)) return { amount: Math.max(1, Math.round((Number(pounds[1]) / Number(pounds[2])) * 10)), unit: "trozos", estimated: true };
  const liters = /(\d+(?:[.,]\d+)?)\s*(?:lts?|litros?|l)\b/i.exec(name);
  if (liters) return { amount: Math.max(1, Math.round((num(liters[1]) * 1000) / GLASS_ML)), unit: "vasos", estimated: true };
  return null;
}

export const scaleServes = (serves: Serves | null, quantity: number): Serves | null => (serves ? { ...serves, amount: serves.amount * quantity } : null);

/** "≈ 5 trozos" / "40 piezas": how a yield reads on screen and in the model's context. */
export function servesText(serves: Serves): string {
  return `${serves.estimated ? "≈ " : ""}${serves.amount} ${serves.unit}${serves.estimated ? " (estimado)" : ""}`;
}

/** Whether a service is food or drink, so its yield matters for the guests. */
export const isFoodOrDrink = (category: string): boolean => FOOD_OR_DRINK.test(category);

export type QuantityCheck = "ok" | "short" | "unknown" | "none";
export type Coverage = { check: QuantityCheck; notes: string[] };

type Line = { name: string; category: string; quantity: number; serves: Serves | null; /** A per-person service already covers every guest. */ perPerson?: boolean };

/**
 * Does the food and drink in a proposal reach every guest? Cakes and drinks need at least one portion or glass per person;
 * finger food is reported per guest. A line with no yield data is said to be unknown, never assumed enough.
 */
export function coverageOf(lines: readonly Line[], guests: number): Coverage {
  const food = lines.filter((line) => isFoodOrDrink(line.category));
  if (food.length === 0) return { check: "none", notes: [] };
  const notes: string[] = [];
  let short = false;
  let unknown = false;
  const total = (units: Serves["unit"][]) => food.reduce((sum, line) => sum + (line.serves && units.includes(line.serves.unit) ? line.serves.amount : 0), 0);
  const has = (units: Serves["unit"][]) => food.some((line) => line.serves && units.includes(line.serves.unit));
  if (has(["trozos", "porciones"])) {
    const portions = total(["trozos", "porciones"]);
    if (portions < guests) { short = true; notes.push(`Alcance: las tortas y postres suman unas ${portions} porciones para ${guests} invitados; no alcanzan (faltan ~${guests - portions}).`); }
    else notes.push(`Alcance: las tortas y postres suman unas ${portions} porciones para ${guests} invitados.`);
  }
  if (has(["vasos"])) {
    const glasses = total(["vasos"]);
    if (glasses < guests) { short = true; notes.push(`Alcance: las bebidas rinden unos ${glasses} vasos de ${GLASS_ML} ml para ${guests} invitados; no alcanzan.`); }
    else notes.push(`Alcance: las bebidas rinden unos ${glasses} vasos de ${GLASS_ML} ml para ${guests} invitados.`);
  }
  if (has(["piezas"])) {
    const pieces = total(["piezas"]);
    const perGuest = Math.round((pieces / guests) * 10) / 10;
    if (perGuest < 3) short = true;
    notes.push(`Alcance: la comida por piezas suma ${pieces} (${perGuest} por invitado)${perGuest < 3 ? "; son pocas si va a ser la comida principal" : ""}.`);
  }
  const noData = food.filter((line) => !line.serves && !line.perPerson);
  if (noData.length > 0) { unknown = true; notes.push(`Alcance: no hay dato de cuánto rinde ${noData.map((line) => `«${line.name}»`).join(", ")}; confirma que alcance para ${guests} invitados.`); }
  return { check: short ? "short" : unknown ? "unknown" : "ok", notes };
}
