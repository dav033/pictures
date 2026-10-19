import type { NivelCreatividad } from "./creatividad";
import type { SceneSpec } from "./scene-spec";
import type { VisualContext } from "./visual-context";

/**
 * EL ENTORNO DE LA IMAGEN: dónde está la decoración, no qué es (2026-10-07, pedido del dueño con una captura correcta
 * pero sosa —semiarco + 2 columnas de colores contra una pared blanca lisa—: «necesitamos composiciones un poco más
 * audaces y complejas, no de las decoraciones sino del ENTORNO»).
 *
 * Por qué salía pared blanca. El caption de FLUX solo describía la decoración: en el nivel de creatividad por defecto
 * (2) el plan no completa ni lugar ni momento (`completarEscenaConPlan`), así que el contexto llegaba sin lugar; el
 * evento era como mucho «Birthday celebration atmosphere» (o nada, con un evento abierto como «revelacion_genero»), y
 * los pasos de presupuesto quitaban esas pistas las primeras (`dropEnvironment`). FLUX base, sin un sitio que pintar,
 * pinta un estudio: pared lisa y piso.
 *
 * Qué hace. Un entorno de evento COMPLETO y deliberado que sale de lo que dijo el cliente —evento, lugar, momento,
 * temática— y, si no dijo nada, del entorno por defecto de su evento. Nunca pared vacía salvo que la pida.
 *
 * Reglas:
 * - La decoración es el sujeto del caption; el entorno va DESPUÉS y nunca la tapa ni la cambia: la guarda «the only
 *   balloons are the three pieces described» lo dice en positivo y con cuántas piezas son (FLUX.2 no admite
 *   negativos, y nombrar «extra balloons» se los pondría en la cabeza). Solo el encuadre (`ENCUADRE_ESCENA`) va antes.
 * - Vocabulario cerrado, en inglés, sin nombres de color (no tiñe la decoración ni engaña la cobertura de colores del
 *   preflight), sin texto, letreros, marcas ni personajes con dueño.
 * - Cuatro formas: la completa (paso 0 del presupuesto), la media, la compacta (el hueco que el presupuesto le reserva
 *   en todos los demás pasos) y la mínima (solo el último paso).
 * - Lo que el entorno añade (mesa, torta, regalos, luces, mesas del fondo…) es escenografía: se marca «no incluido en
 *   la cotización» (`noCotizado`, que /api/generate devuelve como `avisoNoCotizado` a las dos vistas).
 * - Con la foto del espacio o sobre una imagen previa, la escena ya existe: no hay entorno inventado.
 * - Con escenografía de la foto de referencia (mesa, paneles, cortina), esa es la utilería: el entorno pone escenario,
 *   hora, luz y encuadre, sin objetos propios que la dupliquen. Con la guía de escena, sin encuadre (manda el mapa).
 * - Niveles 0 («Fiel») y 1 («Sobrio»): sin la utilería del evento (su dirección es «sin ambientación»).
 *
 * Puro: sin proveedor, red ni estado. Un solo dueño para la ruta y los scripts que la reproducen.
 *
 * RONDA 2 (2026-10-07, «la composición sigue pobre»: la decoración de frente, centrada contra un paño liso, con el
 * salón solo en los bordes). Causa: en un plan de varias piezas la decoración ocupa ~1250 de los 1500 caracteres y al
 * entorno le llegaba solo su forma compacta, que nombraba la sala y la mesa pero NUNCA lo que hay detrás de las piezas
 * (FLUX ponía su fondo de catálogo: una pared lisa), y el encuadre 3/4 iba al final, donde FLUX.2 no lo lee. Se
 * probaron tres composiciones con imagen real sobre el caso del dueño (guiada-20261007-070255-dzwwhq, misma semilla):
 * telón de tela con luces (4/10: otro paño de pared a pared y una columna de más), salón en capas con invitados
 * desenfocados (3,5/10: profundidad real pero una columna de más) y luz dramática de noche (6/10: la única con las 3
 * piezas exactas y atmósfera de evento premium). Queda UNA composición para todos los eventos, la luz dramática, con
 * lo mejor de las otras injertado:
 * - la hora (la del cliente; sin hora, de noche, o al atardecer en los eventos de día) y la luz que baña el fondo en un
 *   tono que no compite con los globos (`tonoLuzParaPaleta`); cadenas de luces con bokeh;
 * - DETRÁS de las piezas, el salón o el exterior con invitados desenfocados (de «capas»): el fondo tiene profundidad,
 *   no es un muro iluminado;
 * - la mesa del evento con su temática, iluminada, a un lado (la mesa en una esquina del primer plano acababa al
 *   fondo y al centro);
 * - el encuadre como PRIMERA frase del caption, y la guarda de globos con el número de piezas.
 * Sin «pieces lit from the front» (los jueces vieron los globos planos, de flash).
 */

export const ENTORNO_ESCENA_VERSION = "entorno-escena-v3-luz-en-capas" as const;

export type EventoEntorno =
  | "cumple_infantil" | "cumple_adulto" | "cumple" | "boda" | "xv" | "baby_shower" | "revelacion" | "bautizo"
  | "graduacion" | "corporativo" | "halloween" | "navidad" | "amor" | "familia" | "fiesta";

type Ambito = "interior" | "exterior";
type PorAmbito = Readonly<Record<Ambito, string>>;

/** La mesa del evento. `{tema}` se cambia por la temática del cliente («unicorn themed »), o por nada. */
type MesaEvento = { objeto: string; con: string; conCorto: string };

type DatosEvento = {
  /** El evento tras un lugar que dijo el cliente: «a lush garden set for a wedding reception». */
  nombre: string;
  /** Lo mismo en la forma compacta: «a lush garden set for a wedding». */
  nombreCorto: string;
  /** El escenario por defecto del evento, completo y compacto, bajo techo y al aire libre. */
  escenario: PorAmbito;
  escenarioCorto: PorAmbito;
  lugarPorDefecto: Ambito;
  mesa: MesaEvento;
  /** Objetos de ambiente por importancia (forma completa). */
  extras: readonly string[];
  /** El objeto de ambiente de la forma compacta, en pocas palabras. */
  extraCorto: string;
  /** Un detalle del piso o del fondo que da profundidad (solo en la forma completa). */
  detalle: string;
  /** Lo no cotizado que la imagen puede mostrar, en palabras del cliente (mesa, extras, detalle). */
  noCotizado: readonly string[];
};

const EVENTOS: Readonly<Record<EventoEntorno, DatosEvento>> = {
  cumple_infantil: {
    nombre: "a kids' birthday party",
    nombreCorto: "a kids' party",
    escenario: { interior: "a lively kids' birthday party room with tall windows and guest tables in the background", exterior: "a sunny backyard kids' birthday party" },
    escenarioCorto: { interior: "a lively kids' party room", exterior: "a sunny backyard kids' party" },
    lugarPorDefecto: "interior",
    mesa: { objeto: "dessert table", con: "a {tema}birthday cake, cupcakes and candy jars", conCorto: "a {tema}birthday cake" },
    extras: ["wrapped gifts", "warm string lights overhead"],
    extraCorto: "wrapped gifts",
    detalle: "confetti scattered on the floor",
    noCotizado: ["la mesa de postres", "la torta", "los dulces", "los regalos", "las luces", "el confeti"],
  },
  cumple_adulto: {
    nombre: "a birthday party",
    nombreCorto: "a birthday party",
    escenario: { interior: "a stylish lounge with velvet seating set for a birthday party", exterior: "an open-air birthday party terrace" },
    escenarioCorto: { interior: "a stylish birthday lounge", exterior: "an open-air birthday terrace" },
    lugarPorDefecto: "interior",
    mesa: { objeto: "dessert table", con: "a {tema}tiered birthday cake and glasses ready for a toast", conCorto: "a {tema}tiered cake" },
    extras: ["wrapped gifts", "warm string lights overhead"],
    extraCorto: "wrapped gifts",
    detalle: "confetti scattered on the floor",
    noCotizado: ["la mesa de postres", "la torta", "las copas", "los regalos", "las luces", "el confeti"],
  },
  cumple: {
    nombre: "a birthday party",
    nombreCorto: "a birthday party",
    escenario: { interior: "a festive birthday party room with tall windows and guest tables in the background", exterior: "a festive backyard birthday party" },
    escenarioCorto: { interior: "a festive birthday party room", exterior: "a festive backyard birthday party" },
    lugarPorDefecto: "interior",
    mesa: { objeto: "dessert table", con: "a {tema}birthday cake and cupcakes", conCorto: "a {tema}birthday cake" },
    extras: ["wrapped gifts", "warm string lights overhead"],
    extraCorto: "wrapped gifts",
    detalle: "confetti scattered on the floor",
    noCotizado: ["la mesa de postres", "la torta", "los dulces", "los regalos", "las luces", "el confeti"],
  },
  boda: {
    nombre: "a wedding reception",
    nombreCorto: "a wedding",
    escenario: { interior: "an elegant wedding ballroom with crystal chandeliers and tall windows", exterior: "a romantic garden wedding reception" },
    escenarioCorto: { interior: "an elegant wedding ballroom", exterior: "a romantic garden wedding" },
    lugarPorDefecto: "interior",
    mesa: { objeto: "sweetheart table", con: "fine linens and a tiered wedding cake", conCorto: "a wedding cake" },
    extras: ["tall floral centerpieces", "candles in glass holders"],
    extraCorto: "floral centerpieces",
    detalle: "flower petals scattered on the floor",
    noCotizado: ["la mesa de los novios", "la mantelería", "la torta", "las flores", "las velas", "los pétalos"],
  },
  xv: {
    nombre: "a fifteenth-birthday gala",
    nombreCorto: "a fifteenth-birthday gala",
    escenario: { interior: "a glamorous ballroom with chandeliers set for a fifteenth-birthday gala", exterior: "a glamorous garden fifteenth-birthday gala" },
    escenarioCorto: { interior: "a glamorous gala ballroom", exterior: "a glamorous garden gala" },
    lugarPorDefecto: "interior",
    mesa: { objeto: "dessert table", con: "a {tema}tall tiered cake", conCorto: "a {tema}tiered cake" },
    extras: ["candelabras with flowers", "an elegant upholstered armchair"],
    extraCorto: "candelabras",
    detalle: "a polished dance floor with soft haze",
    noCotizado: ["la mesa de postres", "la torta", "los candelabros", "las flores", "la silla", "la pista"],
  },
  baby_shower: {
    nombre: "a baby shower",
    nombreCorto: "a baby shower",
    escenario: { interior: "a bright, airy baby shower lounge with tall windows and potted plants", exterior: "a sunny garden baby shower" },
    escenarioCorto: { interior: "an airy baby shower lounge", exterior: "a sunny garden baby shower" },
    lugarPorDefecto: "interior",
    mesa: { objeto: "dessert table", con: "a {tema}tiered cake, cookies and treats", conCorto: "a {tema}tiered cake" },
    extras: ["wrapped gifts", "fresh flowers in vases"],
    extraCorto: "wrapped gifts",
    detalle: "a plush teddy bear on a chair",
    noCotizado: ["la mesa de postres", "la torta", "los dulces", "los regalos", "las flores", "el peluche"],
  },
  revelacion: {
    nombre: "a gender reveal party",
    nombreCorto: "a gender reveal",
    escenario: { interior: "a joyful gender reveal party room with tall windows and potted plants", exterior: "a sunny garden gender reveal party" },
    escenarioCorto: { interior: "a joyful gender reveal room", exterior: "a sunny garden gender reveal" },
    lugarPorDefecto: "interior",
    mesa: { objeto: "dessert table", con: "a {tema}tiered cake, cookies and small treats", conCorto: "a {tema}tiered cake" },
    extras: ["wrapped gifts", "fresh flowers in small vases"],
    extraCorto: "wrapped gifts",
    detalle: "confetti scattered on the floor",
    noCotizado: ["la mesa de postres", "la torta", "los dulces", "los regalos", "las flores", "el confeti"],
  },
  bautizo: {
    nombre: "a christening reception",
    nombreCorto: "a christening",
    escenario: { interior: "a serene christening reception room with tall windows", exterior: "a peaceful garden christening reception" },
    escenarioCorto: { interior: "a serene reception room", exterior: "a peaceful garden reception" },
    lugarPorDefecto: "interior",
    mesa: { objeto: "dessert table", con: "a {tema}tiered cake and small treats", conCorto: "a {tema}tiered cake" },
    extras: ["fresh flowers in vases", "candles in glass holders"],
    extraCorto: "fresh flowers",
    detalle: "guest tables with fine linens in the background",
    noCotizado: ["la mesa de postres", "la torta", "los dulces", "las flores", "las velas", "las mesas de invitados"],
  },
  graduacion: {
    nombre: "a graduation party",
    nombreCorto: "a graduation party",
    escenario: { interior: "a festive graduation party hall with guest tables in the background", exterior: "an open-air graduation party" },
    escenarioCorto: { interior: "a festive graduation hall", exterior: "an open-air graduation party" },
    lugarPorDefecto: "interior",
    mesa: { objeto: "dessert table", con: "a {tema}graduation cake and cupcakes", conCorto: "a {tema}graduation cake" },
    extras: ["graduation caps", "warm string lights overhead"],
    extraCorto: "graduation caps",
    detalle: "confetti scattered on the floor",
    noCotizado: ["la mesa de postres", "la torta", "los dulces", "los birretes", "las luces", "el confeti"],
  },
  corporativo: {
    nombre: "a corporate event",
    nombreCorto: "a corporate event",
    escenario: { interior: "a sleek corporate event venue with modern architecture", exterior: "an open-air corporate terrace event" },
    escenarioCorto: { interior: "a sleek corporate venue", exterior: "an open-air corporate terrace" },
    lugarPorDefecto: "interior",
    mesa: { objeto: "catering table", con: "elegant hors d'oeuvres", conCorto: "hors d'oeuvres" },
    extras: ["tall cocktail tables with fine linens", "modern accent lighting"],
    extraCorto: "cocktail tables",
    detalle: "a polished floor with soft reflections",
    noCotizado: ["la mesa de catering", "los pasabocas", "las mesas altas", "la mantelería", "la iluminación"],
  },
  halloween: {
    nombre: "a Halloween party",
    nombreCorto: "a Halloween party",
    escenario: { interior: "a spooky Halloween party room", exterior: "a spooky Halloween backyard party" },
    escenarioCorto: { interior: "a spooky Halloween party room", exterior: "a spooky Halloween backyard" },
    lugarPorDefecto: "interior",
    mesa: { objeto: "dessert table", con: "{tema}Halloween treats", conCorto: "Halloween treats" },
    extras: ["carved pumpkins with candles", "cobweb details"],
    extraCorto: "carved pumpkins",
    detalle: "soft haze over the floor",
    noCotizado: ["la mesa de postres", "los dulces", "las calabazas", "las telarañas", "la neblina"],
  },
  navidad: {
    nombre: "a Christmas party",
    nombreCorto: "a Christmas party",
    escenario: { interior: "a cozy Christmas living room", exterior: "a festive Christmas patio" },
    escenarioCorto: { interior: "a cozy Christmas living room", exterior: "a festive Christmas patio" },
    lugarPorDefecto: "interior",
    mesa: { objeto: "dessert table", con: "holiday cookies and a festive cake", conCorto: "holiday cookies" },
    extras: ["a decorated Christmas tree", "wrapped presents"],
    extraCorto: "a Christmas tree",
    detalle: "a crackling fireplace in the background",
    noCotizado: ["la mesa de postres", "la torta", "el árbol de Navidad", "los regalos", "la chimenea"],
  },
  amor: {
    nombre: "a romantic dinner",
    nombreCorto: "a romantic dinner",
    escenario: { interior: "an intimate romantic dinner setting", exterior: "a romantic garden dinner" },
    escenarioCorto: { interior: "an intimate dinner setting", exterior: "a romantic garden dinner" },
    lugarPorDefecto: "interior",
    mesa: { objeto: "dinner table", con: "fine linens, candles and a small cake", conCorto: "candles" },
    extras: ["fresh flower arrangements", "candles in glass holders"],
    extraCorto: "fresh flowers",
    detalle: "flower petals scattered on the floor",
    noCotizado: ["la mesa", "la mantelería", "la torta", "las flores", "las velas", "los pétalos"],
  },
  familia: {
    nombre: "a family brunch",
    nombreCorto: "a family brunch",
    escenario: { interior: "a charming family brunch setting", exterior: "a charming garden brunch" },
    escenarioCorto: { interior: "a charming brunch setting", exterior: "a charming garden brunch" },
    lugarPorDefecto: "interior",
    mesa: { objeto: "brunch table", con: "fresh pastries and a {tema}cake", conCorto: "fresh pastries" },
    extras: ["fresh flower arrangements", "fine teacups"],
    extraCorto: "fresh flowers",
    detalle: "soft linens on the guest tables",
    noCotizado: ["la mesa", "los pasteles", "la torta", "las flores", "la vajilla", "la mantelería"],
  },
  fiesta: {
    nombre: "a celebration",
    nombreCorto: "a celebration",
    escenario: { interior: "a festive event hall with guest tables in the background", exterior: "a festive open-air party" },
    escenarioCorto: { interior: "a festive event hall", exterior: "a festive open-air party" },
    lugarPorDefecto: "interior",
    mesa: { objeto: "dessert table", con: "a {tema}cake and small treats", conCorto: "a {tema}cake" },
    extras: ["guest tables with fine linens", "warm string lights overhead"],
    extraCorto: "string lights",
    detalle: "softly blurred party details in the background",
    noCotizado: ["la mesa de postres", "la torta", "los dulces", "las mesas de invitados", "las luces"],
  },
};

/** Normaliza como `visual-context.ts`: sin tildes, minúsculas, `_` como espacio. */
function normalizado(texto: string | undefined): string {
  return (texto ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/_/g, " ");
}

/** Edades nombradas en el texto («30 años», «4 a 6 años»: la primera cifra del rango). */
function edadesDelTexto(texto: string): number[] {
  return [...texto.matchAll(/\b(\d{1,3})\s*(?:a\s*\d{1,3}\s*)?(?:anos?|anitos?|years?)\b/g)].map((coincidencia) => Number(coincidencia[1]));
}

const INFANTIL = /\b(?:infantil|nin[oa]s?|hij[oa]s?|bebes?|primer anito|primer ano|kids?|niet[oa]s?|sobrin[oa]s?|chiquit[oa]s?|pequen[oa]s?|unicornios?|dinosaurios?|princesas?|superheroes?|sirenas?|hadas?|piratas?|safari)\b/;
const ADULTO = /\b(?:adult[oa]s?|espos[oa]|mi (?:mama|papa|madre|padre|abuel[oa]|novi[oa]|jefe|jefa))\b/;

/** El evento del cliente en la familia de entornos, de su etiqueta y de sus palabras. */
export function eventoDelContexto(contexto: Pick<VisualContext, "eventType" | "eventLabel" | "userRequest" | "style">): { evento: EventoEntorno; delCliente: boolean } {
  const etiqueta = normalizado([contexto.eventType, contexto.eventLabel].filter(Boolean).join(" "));
  const todo = normalizado([contexto.eventType, contexto.eventLabel, contexto.userRequest, contexto.style].filter(Boolean).join(" "));
  // La etiqueta del evento manda sobre las palabras sueltas del pedido («boda» en la etiqueta y «cumpleaños de mi
  // hija» en el texto): se mira primero la etiqueta y, sin evento en ella, todo el texto.
  for (const texto of [etiqueta, todo]) {
    if (!texto.trim()) continue;
    if (/\b(?:revelacion|gender reveal)\b/.test(texto)) return { evento: "revelacion", delCliente: true };
    if (/\b(?:baby ?shower|bienvenida de(?:l)? bebe)\b/.test(texto)) return { evento: "baby_shower", delCliente: true };
    if (/\b(?:boda|matrimonio|casamiento|wedding)\b/.test(texto)) return { evento: "boda", delCliente: true };
    if (/\b(?:xv|quince(?: anos)?|quinceanos|quinceanera|15 anos|sweet (?:fifteen|sixteen))\b/.test(texto)) return { evento: "xv", delCliente: true };
    if (/\b(?:bautizo|bautismo|comunion|primera comunion|confirmacion|christening|baptism)\b/.test(texto)) return { evento: "bautizo", delCliente: true };
    if (/\b(?:graduacion|grado|graduation|prom)\b/.test(texto)) return { evento: "graduacion", delCliente: true };
    if (/\b(?:empresa|corporativ[oa]|corporate|lanzamiento|conferencia|convencion|inauguracion)\b/.test(texto)) return { evento: "corporativo", delCliente: true };
    if (/\bhalloween\b/.test(texto)) return { evento: "halloween", delCliente: true };
    if (/\b(?:navidad|navideno|navidena|novena|christmas)\b/.test(texto)) return { evento: "navidad", delCliente: true };
    if (/\b(?:san valentin|amor y amistad|aniversario|pedida de mano|valentine)\b/.test(texto)) return { evento: "amor", delCliente: true };
    if (/\b(?:dia de la madre|dia del padre|dia de las madres|mothers day|fathers day)\b/.test(texto)) return { evento: "familia", delCliente: true };
    if (/\b(?:cumple|cumpleanos|birthday|cumpleanero|cumpleanera)\b/.test(texto)) {
      const edades = edadesDelTexto(todo);
      if (edades.some((edad) => edad >= 16) || ADULTO.test(todo)) return { evento: "cumple_adulto", delCliente: true };
      if (edades.some((edad) => edad <= 12) || INFANTIL.test(todo)) return { evento: "cumple_infantil", delCliente: true };
      return { evento: "cumple", delCliente: true };
    }
  }
  return { evento: "fiesta", delCliente: false };
}

/**
 * Temáticas que se pueden decir sin personaje con dueño: van en la torta («a unicorn themed birthday cake»). Una
 * temática que no está aquí (un personaje, una marca) no se nombra: la torta queda sin tema.
 */
const TEMATICAS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(?:safari|selva|jungla)\b/, "jungle safari"],
  [/\bunicornios?\b/, "unicorn"],
  [/\bsirenas?\b/, "mermaid"],
  [/\bdinosaurios?\b/, "dinosaur"],
  [/\bprincesas?\b/, "princess"],
  [/\bsuperheroes?\b/, "superhero"],
  [/\b(?:espacio exterior|astronautas?|galaxia|cohetes?|planetas?)\b/, "outer space"],
  [/\bfutbol\b/, "soccer"],
  [/\bmariposas?\b/, "butterfly"],
  [/\barcoiris\b/, "rainbow"],
  [/\bcirco\b/, "circus"],
  [/\bgranja\b/, "farm animal"],
  [/\b(?:bajo el mar|oceano|marino)\b/, "under the sea"],
  [/\b(?:tropical|hawaian[oa]|luau)\b/, "tropical"],
  [/\b(?:vaquer[oa]s?|western)\b/, "cowboy"],
  [/\bpiratas?\b/, "pirate"],
  [/\bhadas?\b/, "fairy"],
  [/\b(?:osit[oa]s?|teddy)\b/, "teddy bear"],
  [/\b(?:boho|bohemi[oa])\b/, "boho"],
];

function tematicaDelContexto(contexto: Pick<VisualContext, "style" | "userRequest" | "confirmedMotifs">): string | undefined {
  const texto = normalizado([contexto.style, ...(contexto.confirmedMotifs ?? []), contexto.userRequest].filter(Boolean).join(" "));
  return TEMATICAS.find(([patron]) => patron.test(texto))?.[1];
}

type Lugar = { escenario: string; corto: string; ambito: Ambito };

/**
 * Lugares que el cliente puede nombrar, en el escenario que FLUX sabe pintar: los de `VENUE_PATTERNS`
 * (visual-context.ts) y los sitios abiertos más comunes de `PLACE_HEAD`. Uno que no está aquí deja el escenario del
 * evento en su ámbito (bajo techo o al aire libre, si se sabe).
 */
const LUGARES: ReadonlyArray<readonly [RegExp, Lugar]> = [
  [/\b(?:piscina|pool)\b/, { escenario: "a poolside deck with lounge chairs", corto: "a poolside deck", ambito: "exterior" }],
  [/\b(?:jardin|garden)\b/, { escenario: "a lush garden with trees and open sky", corto: "a lush garden", ambito: "exterior" }],
  [/\b(?:playa|beach)\b/, { escenario: "a beach by the shoreline with open sky", corto: "a beach", ambito: "exterior" }],
  [/\b(?:terraza|rooftop|azotea)\b/, { escenario: "an open-air rooftop terrace with a city skyline", corto: "a rooftop terrace", ambito: "exterior" }],
  [/\bpatio\b/, { escenario: "an open-air patio with potted plants", corto: "an open-air patio", ambito: "exterior" }],
  [/\b(?:parque|park)\b/, { escenario: "a leafy park lawn with tall trees", corto: "a park lawn", ambito: "exterior" }],
  [/\b(?:finca|hacienda|quinta|granja|rancho)\b/, { escenario: "a rustic hacienda courtyard with stone walls", corto: "a hacienda courtyard", ambito: "exterior" }],
  [/\b(?:carpa|tent)\b/, { escenario: "a festive event tent with draped ceiling", corto: "an event tent", ambito: "exterior" }],
  [/\bhotel\b/, { escenario: "an elegant hotel ballroom with chandeliers", corto: "a hotel ballroom", ambito: "interior" }],
  [/\b(?:salon|ballroom|sala de eventos|auditorio|teatro)\b/, { escenario: "an elegant indoor event hall with high ceilings", corto: "an event hall", ambito: "interior" }],
  [/\b(?:restaurante|restaurant|gastrobar)\b/, { escenario: "a cozy restaurant event room", corto: "a restaurant room", ambito: "interior" }],
  [/\b(?:discoteca|bar|lounge)\b/, { escenario: "a stylish lounge bar", corto: "a lounge bar", ambito: "interior" }],
  [/\bclub\b/, { escenario: "a country club event room", corto: "a club event room", ambito: "interior" }],
  [/\b(?:iglesia|capilla|parroquia|templo)\b/, { escenario: "a church reception hall", corto: "a church hall", ambito: "interior" }],
  [/\b(?:colegio|escuela|universidad|school)\b/, { escenario: "a school event hall", corto: "a school hall", ambito: "interior" }],
  [/\b(?:conjunto|urbanizacion|condominio|edificio)\b/, { escenario: "a residential clubhouse", corto: "a clubhouse", ambito: "interior" }],
  [/\b(?:apartamento|apto|apartment)\b/, { escenario: "a cozy apartment living room", corto: "an apartment living room", ambito: "interior" }],
  [/\b(?:casa|hogar|home)\b/, { escenario: "a warm home living room", corto: "a home living room", ambito: "interior" }],
  [/\b(?:oficina|office|empresa)\b/, { escenario: "a modern office lounge", corto: "an office lounge", ambito: "interior" }],
];

/**
 * La hora de la escena. La que dijo el cliente manda; sin hora, la de su evento: de noche, que es la luz que hace la
 * escena (ronda 2: la «luz dramática» fue la única composición que los jueces dieron por evento premium), salvo los
 * eventos de día (baby shower, revelación, bautizo, brunch), que van al atardecer con la misma luz.
 */
export type MomentoEscena = "noche" | "atardecer" | "dia";
const EVENTOS_DE_DIA: ReadonlySet<EventoEntorno> = new Set<EventoEntorno>(["baby_shower", "revelacion", "bautizo", "familia"]);

/** La hora que dijo el cliente, o `undefined` si no dijo ninguna. */
function momentoDelCliente(lightingKind: VisualContext["lightingKind"]): MomentoEscena | undefined {
  switch (lightingKind) {
    case "night": return "noche";
    case "sunset": return "atardecer";
    case "day":
    case "afternoon": return "dia";
    default: return undefined;
  }
}

/**
 * El cliente pidió un fondo liso a propósito («fondo blanco», «pared lisa», «foto de estudio»): entonces no se inventa
 * entorno y el caption queda como antes.
 */
const PIDE_FONDO_LISO = /\b(?:pared (?:blanca|lisa|sola|vacia)|fondo (?:blanco|liso|neutro|plano|de estudio|vacio)|sin fondo|foto de estudio|estudio fotografico|plain (?:white )?(?:wall|background)|studio (?:shot|background))\b/;

export type EntornoEscena = {
  version: typeof ENTORNO_ESCENA_VERSION;
  evento: EventoEntorno;
  /** Bajo techo o al aire libre: qué baña la luz (las paredes o el paisaje) y qué sigue detrás de las piezas. */
  ambito: Ambito;
  /** La hora de la escena: la que dijo el cliente o la de su evento (`EVENTOS_DE_DIA`). */
  momento: MomentoEscena;
  /** Tono de la luz que baña el fondo, que no compite con los globos (`tonoLuzParaPaleta`). */
  tonoLuz: string;
  /** El entorno pone su propia escena (luces, invitados al fondo): no con escenografía de la foto, que ya es la escena. */
  conEscenografiaPropia: boolean;
  /** El encuadre 3/4 abre el caption (`ENCUADRE_ESCENA`); no con la guía de escena, cuyo mapa ya fija el punto de vista. */
  conEncuadre: boolean;
  /** De dónde salió cada dimensión: lo que dijo el cliente o el valor por defecto de su evento. */
  origen: { evento: "cliente" | "defecto"; lugar: "cliente" | "evento"; momento: "cliente" | "evento" | "foto" };
  /** «a lively kids' birthday party room…», «a lush garden with trees and open sky set for a wedding reception». */
  escenario: string;
  escenarioCorto: string;
  /** El lugar que nombró el cliente, sin el evento («a lush garden»): abre la forma compacta. */
  lugarCliente?: string;
  /** Quién llena el fondo detrás de las piezas: invitados y mesas, o mesas con velas en una cena romántica. */
  gente: { corta: string; larga: string };
  /** La mesa del evento, con la temática ya puesta (sin ella en los niveles 0-1 o con escenografía de la foto). */
  mesa?: MesaEvento;
  /** Objetos de ambiente, por importancia, y el de la forma media. */
  extras: readonly string[];
  extraCorto?: string;
  detalle?: string;
  /** Lo no cotizado que la imagen puede mostrar, en español, para el aviso (vacío si el entorno no añade objetos). */
  noCotizado: readonly string[];
};

export type EntradaEntorno = {
  contexto: VisualContext;
  /** Nivel de creatividad con que se genera (el firmado en el plan manda). */
  nivel: NivelCreatividad;
  /** Modo de la escena: solo `text_to_image` lleva entorno (con foto del espacio o imagen previa la escena ya existe). */
  modo: SceneSpec["generation_mode"];
  /** La foto de referencia trae su propia escenografía visible (mesa, paneles, cortina): el entorno no añade objetos. */
  conEscenografiaDeFoto?: boolean;
  /** La imagen se genera con la guía de escena (el mapa de las piezas por `/edit`): su punto de vista es el del mapa. */
  conGuiaDeEscena?: boolean;
  /**
   * El plan salió de una foto de referencia: sin hora del cliente, la escena va de día, con la luz natural de las fotos
   * de decoración (2026-10-07, «la composición no es fiel»: la noche con uplighting cambiaba el ambiente de la foto).
   */
  desdeFoto?: boolean;
};

/**
 * Colores de globo con los que una luz ámbar compite (los vuelve iguales o los ensucia): entonces la luz del fondo va
 * en tono frío. Nombres del catálogo en español y su traducción, normalizados.
 */
const PALETA_CALIDA = /\b(?:amarillo|yellow|naranja|orange|dorado|gold|golden|coral|durazno|peach|champagne|beige|crema|cream|cafe|brown|nude|mostaza)\b/;

/** «warm amber» salvo que la paleta tenga colores ámbar (dorado, amarillo, naranja…): entonces «cool-toned». */
export function tonoLuzParaPaleta(paleta: readonly string[]): string {
  return PALETA_CALIDA.test(normalizado(paleta.join(" "))) ? "cool-toned" : "warm amber";
}

/** Lo que la escena pone siempre (con escenografía propia) y no se cotiza: la luz, las luces colgadas, las mesas del fondo. */
const NO_COTIZADO_ESCENA: readonly string[] = ["la iluminación", "las luces", "las mesas de invitados"];

/** El entorno de la imagen, o `undefined` cuando no toca inventarlo (foto del espacio, ajuste, fondo liso pedido). */
export function entornoDeEscena(entrada: EntradaEntorno): EntornoEscena | undefined {
  if (entrada.modo !== "text_to_image") return undefined;
  const { contexto } = entrada;
  if (PIDE_FONDO_LISO.test(normalizado([contexto.userRequest, contexto.style, contexto.venue].filter(Boolean).join(" ")))) return undefined;
  const { evento, delCliente } = eventoDelContexto(contexto);
  const datos = EVENTOS[evento];
  const lugar = contexto.venue ? LUGARES.find(([patron]) => patron.test(normalizado(contexto.venue)))?.[1] : undefined;
  const ambito: Ambito = lugar?.ambito ?? (contexto.venueKind === "outdoor" ? "exterior" : contexto.venueKind === "indoor" ? "interior" : datos.lugarPorDefecto);
  const momentoCliente = momentoDelCliente(contexto.lightingKind);
  const conUtileria = entrada.nivel >= 2 && !entrada.conEscenografiaDeFoto;
  const conEscenografiaPropia = !entrada.conEscenografiaDeFoto;
  const tema = tematicaDelContexto(contexto);
  const conTema = (texto: string) => texto.replace("{tema}", tema ? `${tema} themed ` : "");
  return {
    version: ENTORNO_ESCENA_VERSION,
    evento,
    ambito,
    momento: momentoCliente ?? (entrada.desdeFoto ? "dia" : EVENTOS_DE_DIA.has(evento) ? "atardecer" : "noche"),
    tonoLuz: tonoLuzParaPaleta(contexto.palette),
    conEscenografiaPropia,
    conEncuadre: !entrada.conGuiaDeEscena,
    origen: { evento: delCliente ? "cliente" : "defecto", lugar: lugar || contexto.venueKind !== "unknown" ? "cliente" : "evento", momento: momentoCliente ? "cliente" : entrada.desdeFoto ? "foto" : "evento" },
    escenario: lugar ? `${lugar.escenario} set for ${datos.nombre}` : datos.escenario[ambito],
    escenarioCorto: lugar ? `${lugar.corto} set for ${datos.nombreCorto}` : datos.escenarioCorto[ambito],
    ...(lugar ? { lugarCliente: lugar.corto } : {}),
    gente: evento === "amor" ? { corta: "candlelit tables", larga: "candlelit tables" } : { corta: "guests", larga: "guests and tables" },
    ...(conUtileria ? { mesa: { objeto: datos.mesa.objeto, con: conTema(datos.mesa.con), conCorto: conTema(datos.mesa.conCorto) } } : {}),
    extras: conUtileria ? datos.extras : [],
    ...(conUtileria ? { extraCorto: datos.extraCorto, detalle: datos.detalle } : {}),
    // Lo que la imagen puede mostrar y no se cotiza: lo del evento (con utilería) y lo que la escena pone siempre.
    noCotizado: [...new Set([...(conUtileria ? datos.noCotizado : []), ...(conEscenografiaPropia ? NO_COTIZADO_ESCENA : [])])],
  };
}

/** Cuánto del entorno cabe: el completo, el medio, el compacto (el que el presupuesto reserva) o el mínimo. */
export type DetalleEntorno = "completo" | "medio" | "compacto" | "minimo";

/**
 * El encuadre, en la PRIMERA frase del caption (ronda 2, 2026-10-07): al final, después de ~1250 caracteres de
 * decoración, FLUX.2 lo ignoraba («three-quarter angle» en la cola salió de frente en las 7 imágenes de las rondas 1 y
 * 2), y FLUX.2 atiende más a lo que va primero. Sin lado («from the left»): mirando desde el lado de una columna, la
 * columna y la pata del arco se solapan y FLUX tiende a fundirlas.
 */
export const ENCUADRE_ESCENA = "Three-quarter view event photo";

const NUMEROS = ["", "one", "two", "three", "four", "five", "six"] as const;

/**
 * Lo que la decoración NO comparte con el entorno, dicho en positivo: ningún globo más que las piezas del plan y las
 * piezas a la vista (la utilería no las tapa). Con `piezas` (2-6, el compilador las cuenta) la guarda dice cuántas:
 * en la ronda 2, dos de tres imágenes del caso del dueño dibujaron una columna de más.
 */
function guarda(detalle: DetalleEntorno, piezas: number | undefined): string {
  const cuantas = piezas && piezas >= 2 && piezas < NUMEROS.length ? `${NUMEROS[piezas]} ` : "";
  return detalle === "completo"
    ? `the ${cuantas}described balloon pieces stay fully visible, the only balloons in the scene`
    : `the only balloons are the ${cuantas}pieces described`;
}

type Formas = Readonly<{ completo: string; medio: string; compacto: string }>;

const HORA: Readonly<Record<MomentoEscena, string | undefined>> = { noche: "at night", atardecer: "at dusk", dia: undefined };

/**
 * La luz que baña el FONDO (no las piezas): de noche y al atardecer, uplighting en un tono que no compite con los
 * globos; de día, la luz natural del sitio.
 */
function luzDelFondo(entorno: EntornoEscena): Formas {
  if (entorno.momento === "dia") {
    return entorno.ambito === "interior"
      ? { completo: "bright daylight streaming through tall windows", medio: "bright daylight through tall windows", compacto: "bright window daylight" }
      : { completo: "bright natural daylight with a soft sun flare", medio: "bright natural daylight", compacto: "bright daylight" };
  }
  const superficie = entorno.ambito === "interior" ? "the walls" : "the scenery";
  const tono = entorno.tonoLuz;
  return { completo: `${superficie} washed in ${tono} uplighting with soft spotlight beams through light haze`, medio: `${superficie} washed in ${tono} uplighting`, compacto: `${tono} uplighting` };
}

/** Las cadenas de luces sobre la escena: con bokeh de noche y al atardecer. */
function lucesColgadas(entorno: EntornoEscena): Formas {
  return entorno.momento === "dia"
    ? { completo: "strands of string lights crossing overhead", medio: "string lights overhead", compacto: "string lights overhead" }
    : { completo: "strands of warm string lights crossing overhead with glowing bokeh", medio: "string lights overhead with glowing bokeh", compacto: "string light bokeh" };
}

/**
 * Lo que sigue DETRÁS de las piezas (injerto del «salón en capas» de la ronda 2): el salón o el exterior con invitados
 * desenfocados, para que el fondo tenga profundidad y no sea una pared bañada de luz. Con las piezas colgadas de la
 * pared (`enAlto`), el salón se abre a sus dos lados.
 */
function fondoConGente(entorno: EntornoEscena, enAlto: boolean | undefined): Formas {
  const espacio = entorno.ambito === "interior" ? "the room" : "the grounds";
  const donde = enAlto ? "at both sides of the pieces" : "far behind the pieces";
  return {
    completo: `${espacio} ${enAlto ? "opening out at both sides of the pieces" : "continuing far behind the pieces"} with softly blurred ${entorno.gente.larga}`,
    medio: `softly blurred ${entorno.gente.larga} ${donde}`,
    compacto: `blurred ${entorno.gente.corta} ${donde}`,
  };
}

/** La mesa del evento, iluminada salvo de día, a un lado; o la mesa principal que la decoración ya nombra. */
function mesaDelEvento(entorno: EntornoEscena, detalle: DetalleEntorno, mesaPrincipal: boolean | undefined): string | undefined {
  if (!entorno.mesa) return undefined;
  const iluminada = entorno.momento !== "dia";
  if (detalle === "completo") {
    if (mesaPrincipal) return `the main table set with ${entorno.mesa.con}${iluminada ? " under small warm lamps" : ""}`;
    return `at one side a ${entorno.mesa.objeto} with ${entorno.mesa.con}${iluminada ? " glowing under small warm lamps" : ""}`;
  }
  const encendida = iluminada ? "lit " : "";
  return mesaPrincipal ? `the ${encendida}main table set with ${entorno.mesa.conCorto}` : `a ${encendida}${entorno.mesa.objeto} with ${entorno.mesa.conCorto} at one side`;
}

/** Objetos de ambiente sin luces (la escena ya pone las suyas). */
const SIN_LUCES = (texto: string | undefined): string | undefined => (texto && !/\blights?\b/.test(texto) ? texto : undefined);

function mayuscula(texto: string): string {
  return `${texto.charAt(0).toUpperCase()}${texto.slice(1)}`;
}

function unidas(partes: ReadonlyArray<string | undefined>): string {
  return partes.filter((parte): parte is string => Boolean(parte)).join(", ");
}

function conHora(texto: string, entorno: EntornoEscena): string {
  const hora = HORA[entorno.momento];
  return hora ? `${texto} ${hora}` : texto;
}

type OpcionesFrase = {
  /** La decoración ya nombra «the main table» (una guirnalda sobre ella, un centro encima): la mesa del evento es esa. */
  mesaPrincipal?: boolean;
  /** Todas las piezas cuelgan de la pared o del techo (`soloGuirnaldasEnAlto` del compilador): no hay salón detrás. */
  enAlto?: boolean;
  /** Cuántas piezas sueltas tiene la decoración, si el compilador las puede contar (`piezasContadas`). */
  piezas?: number;
};

/**
 * El entorno en palabras para el caption de FLUX: el encuadre (que el compilador pone PRIMERO, antes de la decoración)
 * y una frase de escena sin punto final (después de la decoración). Una sola composición para todos los eventos, la
 * ganadora de la ronda 2 («luz dramática», con el fondo en capas injertado):
 * - la hora (la del cliente o la de su evento) y la luz que baña el fondo, en un tono que no compite con los globos;
 * - cadenas de luces sobre la escena con bokeh;
 * - DETRÁS de las piezas el salón o el exterior con invitados desenfocados (nunca una pared lisa ni un paño);
 * - la mesa del evento, con su temática, iluminada a un lado;
 * - la guarda de globos, con cuántas piezas son.
 * Cuatro formas, de más a menos: completo (con el escenario, la utilería y el detalle de piso), medio, compacto (el
 * hueco que el presupuesto reserva en todos los pasos) y mínimo (escenario, fondo y guarda; sin encuadre).
 */
export function fraseEntorno(entorno: EntornoEscena, detalle: DetalleEntorno, opciones: OpcionesFrase = {}): { escena: string; encuadre?: string } {
  const encuadre = entorno.conEncuadre && detalle !== "minimo" ? { encuadre: ENCUADRE_ESCENA } : {};
  const laGuarda = guarda(detalle, opciones.piezas);
  if (!entorno.conEscenografiaPropia) {
    // La escenografía de la foto (su mesa, su panel o su cortina) es la escena: solo la luz y la hora, sin objetos.
    const luz = entorno.momento === "dia" ? luzDelFondo(entorno).compacto : `${entorno.tonoLuz} uplighting behind the pieces`;
    return { escena: `${mayuscula(conHora(entorno.escenarioCorto, entorno))}, ${luz}, ${laGuarda}`, ...encuadre };
  }
  const fondo = fondoConGente(entorno, opciones.enAlto);
  // La mínima (último paso): el sitio (el que dijo el cliente, o el del evento), la hora y lo que hay detrás.
  if (detalle === "minimo") return { escena: `${mayuscula(conHora(entorno.lugarCliente ?? entorno.escenarioCorto, entorno))}, ${fondo.compacto}, ${laGuarda}` };
  const luz = luzDelFondo(entorno);
  const luces = lucesColgadas(entorno);
  const mesa = mesaDelEvento(entorno, detalle, opciones.mesaPrincipal);
  if (detalle === "compacto") {
    // El lugar que dijo el cliente abre la frase; sin él, la hora (de día, la luz).
    const apertura = entorno.lugarCliente ? conHora(entorno.lugarCliente, entorno) : HORA[entorno.momento];
    return { escena: mayuscula(unidas([apertura, luz.compacto, luces.compacto, fondo.compacto, mesa, laGuarda])), ...encuadre };
  }
  if (detalle === "medio") {
    return { escena: `${mayuscula(conHora(entorno.escenarioCorto, entorno))}: ${unidas([luz.medio, luces.medio, fondo.medio, mesa, SIN_LUCES(entorno.extraCorto), laGuarda])}`, ...encuadre };
  }
  const hora = HORA[entorno.momento];
  return {
    escena: `${mayuscula(entorno.escenario)}${hora ? `, ${hora}` : ""}: ${unidas([luz.completo, luces.completo, fondo.completo, mesa, entorno.extras.find((extra) => SIN_LUCES(extra)), entorno.detalle, laGuarda])}`,
    ...encuadre,
  };
}

/** El aviso «no incluido en la cotización» de lo que el entorno añade, o `undefined` si no añade objetos. */
export function avisoNoCotizadoEntorno(entorno: EntornoEscena | undefined): string | undefined {
  const objetos = entorno?.noCotizado ?? [];
  if (!objetos.length) return undefined;
  const lista = objetos.length === 1 ? objetos[0]! : `${objetos.slice(0, -1).join(", ")} y ${objetos[objetos.length - 1]}`;
  return `${mayuscula(lista)} de la vista previa son ambientación: no están incluidos en la cotización.`;
}
