/**
 * **Vocabulario de partes de las decoraciones** (flores, moños, estrellas, figuras, rizos, burbujas, racimos y
 * Halloween): el nombre de oficio que lleva cada globo y cada tubito en `parte` (ver `GloboDecoracion.parte` y
 * `partes-globos.ts`), con una descripción corta en español y sinónimos en inglés (para el glosario que traduce lo que
 * dice el usuario a un `SelectorGlobos`).
 *
 * Reglas de los nombres: minúsculas, sin tildes, del más general al más fino separados por «/» («petalos/interior»,
 * «sombrero/copa», «patas/delantera/pies»). Una parte vale para sus subpartes («petalos» selecciona también
 * «petalos/interior»). Lo de papel (fantasma, telaraña, cintas del ramo, confeti) también lleva parte, aunque no es
 * globo ni se cotiza.
 *
 * Además: `marcarParte` / `conParte`, las ayudas con que los armadores ponen la parte sin tocar a los que ya la traen.
 */
export type ParteDecoracion = { nombre: string; descripcion: string; ingles: readonly string[] };

export const PARTES_DECORACIONES: readonly ParteDecoracion[] = [
  // Flores (de globos redondos, de tubito y de corazones).
  { nombre: "petalos", descripcion: "Los pétalos de una flor: globos redondos, lazos o burbujas de tubito, o corazones.", ingles: ["petals", "petal"] },
  { nombre: "petalos/interior", descripcion: "El anillo interior de pétalos (lazos de tubito encima de los pétalos grandes).", ingles: ["inner petals", "inner ring", "inner loops"] },
  { nombre: "corona", descripcion: "El anillo de globitos entre los pétalos y el centro de una flor.", ingles: ["crown", "ring", "collar"] },
  { nombre: "centro", descripcion: "El globito (o el trío) del centro de una flor, un moño o una estrella.", ingles: ["center", "centre", "middle", "button"] },
  // Moño y estrella.
  { nombre: "lazos", descripcion: "Los lazos de tubito de un moño.", ingles: ["loops", "bow loops"] },
  { nombre: "colas", descripcion: "Las colas de tubito que cuelgan de un moño.", ingles: ["tails", "bow tails", "streamers"] },
  { nombre: "rayos", descripcion: "Los rayos de tubito de una estrella.", ingles: ["rays", "spokes", "star arms"] },
  { nombre: "rayos/perillas", descripcion: "La burbujita de la punta de cada rayo de la estrella.", ingles: ["tips", "knobs", "ray tips"] },
  { nombre: "contorno", descripcion: "El contorno cerrado de tubito (estrella de contorno).", ingles: ["outline", "contour"] },
  // Racimos y orbe.
  { nombre: "uvas", descripcion: "Los globitos de un racimo de uvas.", ingles: ["grapes", "grape cluster"] },
  { nombre: "bola", descripcion: "Los globitos de una bolita (media bola compacta).", ingles: ["ball", "cluster"] },
  { nombre: "collar", descripcion: "Un anillo de globitos (collar de R-5, el cuello de un orbe).", ingles: ["collar", "ring", "necklace"] },
  { nombre: "esfera", descripcion: "El globo grande de un orbe.", ingles: ["sphere", "orb", "ball"] },
  { nombre: "flecos", descripcion: "Tiras de tubito casi sin inflar que cuelgan (flecos del orbe, cortina de flecos).", ingles: ["fringe", "tassel", "streamers"] },
  // Globo burbuja.
  { nombre: "exterior", descripcion: "El globo transparente de fuera de una burbuja.", ingles: ["outer balloon", "bubble", "clear balloon"] },
  { nombre: "interiores", descripcion: "Los globos metidos dentro de la burbuja.", ingles: ["inner balloons", "balloons inside", "stuffing balloons"] },
  { nombre: "relleno", descripcion: "Confeti o plumas dentro de la burbuja (papel, no se cotiza).", ingles: ["filling", "confetti", "feathers"] },
  // Rizos de tubito.
  { nombre: "tirabuzon", descripcion: "Un tubito enrollado en tirabuzón que se abre.", ingles: ["corkscrew", "curl"] },
  { nombre: "resorte", descripcion: "Un tubito enrollado en resorte apretado.", ingles: ["spring", "coil"] },
  { nombre: "penacho", descripcion: "Los rizos de un penacho (varios tirabuzones que salen de un punto).", ingles: ["plume", "curly plume"] },
  { nombre: "voluta", descripcion: "Un tubito enrollado en espiral plana.", ingles: ["scroll", "flat spiral", "volute"] },
  { nombre: "burbujas", descripcion: "Una cadena de burbujas de tubito retorcido.", ingles: ["bubbles", "bubble chain", "twisted bubbles"] },
  // Figuras (muñecos, animales, objetos).
  { nombre: "base", descripcion: "Los globos de la base que para la figura (o la base orgánica del árbol).", ingles: ["base", "stand", "foot ring"] },
  { nombre: "base/acentos", descripcion: "Los globitos de acento metidos en la base orgánica.", ingles: ["base accents", "accent balloons"] },
  { nombre: "cuerpo", descripcion: "El cuerpo de una figura (globo, racimo o tubito), de la araña o de la bruja.", ingles: ["body", "torso"] },
  { nombre: "cuello", descripcion: "Los globitos del cuello entre el cuerpo y la cabeza.", ingles: ["neck"] },
  { nombre: "cabeza", descripcion: "La cabeza de una figura (con la cara impresa).", ingles: ["head"] },
  { nombre: "brazos", descripcion: "Los brazos: burbujas de tubito.", ingles: ["arms"] },
  { nombre: "brazos/manos", descripcion: "Las manos al final de los brazos (globo, burbuja o dedos).", ingles: ["hands"] },
  { nombre: "piernas", descripcion: "Las piernas de una figura de pie o sentada: burbujas de tubito.", ingles: ["legs"] },
  { nombre: "piernas/pies", descripcion: "Los pies al final de las piernas.", ingles: ["feet", "shoes"] },
  { nombre: "patas", descripcion: "Las patas de una figura de lado (animal, insecto) o de la araña.", ingles: ["legs", "paws"] },
  { nombre: "patas/delantera", descripcion: "Las patas de adelante (las del lado de la cabeza).", ingles: ["front legs"] },
  { nombre: "patas/delantera/pies", descripcion: "Los pies de las patas de adelante.", ingles: ["front feet", "front paws"] },
  { nombre: "patas/media", descripcion: "Las patas del medio (insectos).", ingles: ["middle legs"] },
  { nombre: "patas/media/pies", descripcion: "Los pies de las patas del medio.", ingles: ["middle feet"] },
  { nombre: "patas/trasera", descripcion: "Las patas de atrás.", ingles: ["back legs", "hind legs"] },
  { nombre: "patas/trasera/pies", descripcion: "Los pies de las patas de atrás.", ingles: ["back feet", "hind paws"] },
  { nombre: "ruedas", descripcion: "Las ruedas de un vehículo.", ingles: ["wheels", "tires"] },
  { nombre: "sombrero", descripcion: "El sombrero de una figura (o el de papel de la bruja).", ingles: ["hat"] },
  { nombre: "sombrero/ala", descripcion: "El ala del sombrero (aro o flecos de tubito).", ingles: ["hat brim", "brim"] },
  { nombre: "sombrero/copa", descripcion: "La copa del sombrero (globo o burbuja de tubito).", ingles: ["hat crown", "hat top"] },
  { nombre: "sombrero/cinta", descripcion: "La cinta alrededor de la copa del sombrero.", ingles: ["hat band", "hatband"] },
  { nombre: "sombrero/pompon", descripcion: "El pompón del sombrero.", ingles: ["pompom", "bobble"] },
  { nombre: "mono", descripcion: "Un moño pegado a una figura.", ingles: ["bow"] },
  { nombre: "mono/lazos", descripcion: "Los lazos del moño de una figura.", ingles: ["bow loops"] },
  { nombre: "mono/globos", descripcion: "Los globitos a los lados del moño de una figura.", ingles: ["bow balloons"] },
  { nombre: "mono/centro", descripcion: "El nudo (globito del centro) del moño de una figura.", ingles: ["bow knot", "bow center"] },
  { nombre: "orejas", descripcion: "Las orejas (lazos, globos o burbujas).", ingles: ["ears"] },
  { nombre: "antenas", descripcion: "Las antenas de tubito.", ingles: ["antennae", "antennas"] },
  { nombre: "antenas/puntas", descripcion: "Los globitos de la punta de las antenas.", ingles: ["antenna tips", "antenna balls"] },
  { nombre: "alas", descripcion: "Las alas (abanico de lazos, burbujas o flecos, o globos).", ingles: ["wings"] },
  { nombre: "cola", descripcion: "La cola de una figura (rizo, curva o plumas) o del fantasma.", ingles: ["tail"] },
  { nombre: "pico", descripcion: "El pico de un ave.", ingles: ["beak", "bill"] },
  { nombre: "cejas", descripcion: "Las cejas de tubito sobre los ojos (el pájaro bravo).", ingles: ["eyebrows", "brows"] },
  { nombre: "barbilla", descripcion: "La barbilla roja que cuelga bajo el pico de la gallina.", ingles: ["wattle"] },
  { nombre: "cinturon", descripcion: "El cinturón de tubito alrededor del cuerpo de una figura.", ingles: ["belt", "waistband"] },
  { nombre: "aguijon", descripcion: "El aguijón de una abeja (una burbuja de tubito atrás).", ingles: ["stinger", "sting"] },
  { nombre: "cresta", descripcion: "La cresta o el copete (abanico sobre la cabeza).", ingles: ["crest", "comb", "tuft"] },
  { nombre: "ojos", descripcion: "Globos con ojo impreso (ojo, racimo de ojos, ojos pegados a una figura o al árbol).", ingles: ["eyes", "eyeballs"] },
  { nombre: "nariz", descripcion: "La nariz pegada a una figura (la de cerdito).", ingles: ["nose", "snout"] },
  { nombre: "cabina", descripcion: "La cabina con ventanas de un vehículo.", ingles: ["cabin", "cab", "windows"] },
  { nombre: "aros", descripcion: "Aros o arcos de tubito pegados a una figura (trazos, anillos, letras).", ingles: ["hoops", "rings", "arcs"] },
  { nombre: "bufanda", descripcion: "La bufanda de tubitos trenzados.", ingles: ["scarf"] },
  { nombre: "adornos", descripcion: "Globos o burbujas pegados a una figura sin otro nombre (botones, faros, detalles).", ingles: ["details", "accents", "decorations", "trim"] },
  // Halloween.
  { nombre: "calabaza", descripcion: "El globo grande de la calabaza (con su cara impresa).", ingles: ["pumpkin", "jack-o'-lantern"] },
  { nombre: "tallo", descripcion: "El tallo de la calabaza (con sus lazos y zarcillos).", ingles: ["stem"] },
  { nombre: "tallo/lazos", descripcion: "Los lazos (hojas) alrededor del tallo de la calabaza.", ingles: ["leaves", "stem loops"] },
  { nombre: "tallo/zarcillos", descripcion: "Los rizos de T-160 que salen del tallo.", ingles: ["tendrils", "vines"] },
  { nombre: "palma", descripcion: "La palma de la mano de monstruo (burbujas cruzadas).", ingles: ["palm"] },
  { nombre: "muneca", descripcion: "La muñeca de la mano de monstruo.", ingles: ["wrist"] },
  { nombre: "dedos", descripcion: "Los dedos de la mano de monstruo.", ingles: ["fingers"] },
  { nombre: "dedos/pulgar", descripcion: "El pulgar de la mano de monstruo.", ingles: ["thumb"] },
  { nombre: "ramo", descripcion: "Los globos de helio de un ramo.", ingles: ["bouquet balloons", "helium balloons"] },
  { nombre: "cintas", descripcion: "Las cintas del ramo de helio (papel).", ingles: ["ribbons", "strings"] },
  { nombre: "peso", descripcion: "El peso que sostiene el ramo (papel).", ingles: ["weight", "balloon weight"] },
  { nombre: "tronco", descripcion: "El tronco de tubitos torcidos del árbol.", ingles: ["trunk"] },
  { nombre: "tronco/cintas", descripcion: "Los tubitos que se enrollan por fuera del tronco.", ingles: ["trunk wraps", "wrapped twisties"] },
  { nombre: "ramas", descripcion: "Las ramas de tubitos trenzados del árbol.", ingles: ["branches"] },
  { nombre: "ramas/ramitas", descripcion: "Las burbujas cortas de la punta de cada rama.", ingles: ["twigs"] },
  { nombre: "copa", descripcion: "La copa del árbol: racimo alargado de globitos.", ingles: ["canopy", "tree top", "foliage"] },
  { nombre: "copa/ojos", descripcion: "Los ojos bravos al frente de la copa del árbol.", ingles: ["tree eyes"] },
  { nombre: "silueta", descripcion: "La silueta de papel del fantasma.", ingles: ["silhouette", "ghost body"] },
  { nombre: "cara", descripcion: "Los ojos y la boca de papel del fantasma.", ingles: ["face"] },
  { nombre: "radios", descripcion: "Los radios de la telaraña de papel.", ingles: ["spokes", "radial threads"] },
  { nombre: "anillos", descripcion: "Los anillos de la telaraña de papel.", ingles: ["rings", "spiral threads"] },
  // Pieza «globo» (un globo suelto, de clase decoración en la biblioteca).
  { nombre: "globo", descripcion: "Un globo suelto (el remate encima de un arco, un globo solo de helio).", ingles: ["balloon", "single balloon", "topper balloon"] },
];

const NOMBRES = new Set(PARTES_DECORACIONES.map((p) => p.nombre));

/** ¿Es una parte del vocabulario de las decoraciones? */
export const esParteDecoracion = (parte: string): boolean => NOMBRES.has(parte);

/** La descripción de una parte (o null si no está en el vocabulario). */
export const parteDecoracion = (nombre: string): ParteDecoracion | null => PARTES_DECORACIONES.find((p) => p.nombre === nombre) ?? null;

/**
 * Pone `parte` a los elementos de `lista` desde el índice `desde` que aún no la tienen (lo de una subparte ya marcada
 * se respeta). Cambia la lista en su sitio: es para los armadores, que van empujando globos y tubitos a una salida.
 */
export function marcarParte<T extends { parte?: string }>(lista: T[], desde: number, parte: string): void {
  for (let i = desde; i < lista.length; i++) if (!lista[i]!.parte) lista[i] = { ...lista[i]!, parte };
}

/** Copia de `lista` con `parte` en los que no la traen. */
export function conParte<T extends { parte?: string }>(lista: readonly T[], parte: string): T[] {
  return lista.map((e) => (e.parte ? e : { ...e, parte }));
}
