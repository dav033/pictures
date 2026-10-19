import type { Tematica } from "./tipos";
import { TEMATICAS_ESTILO } from "./tematicas-estilo";

/**
 * Temáticas / estilos: cómo se ve la decoración, sin importar qué se celebra. Cerrada y sin marcas ni personajes
 * con licencia: lo que el cliente nombra con una marca se describe aquí de forma genérica («princesas», «invierno»).
 * `ambiguos` son pistas débiles (una palabra suelta que sugiere la temática sin asegurarla).
 */
const TEMATICAS_MUNDO: readonly Tematica[] = [
  {
    id: "dinosaurios", nombre: "Dinosaurios", en: "Dinosaurs", grupo: "animales-y-naturaleza",
    sinonimos: ["dinosaurio", "dinosaurios", "dino", "dinos", "t-rex", "trex", "tiranosaurio", "raptor", "triceratops", "estegosaurio", "jurásico", "prehistórico", "dinosaur", "dinosaurs", "prehistoric", "huevo de dinosaurio"],
  },
  {
    id: "safari-jungla", nombre: "Safari / jungla", en: "Safari / jungle", grupo: "animales-y-naturaleza",
    sinonimos: ["safari", "jungla", "selva", "jungle", "zoológico", "zoo", "animales salvajes", "wild animals", "león", "lion", "jirafa", "giraffe", "elefante", "elephant", "cebra", "zebra", "tigre", "animal print", "estampado animal", "leopardo", "two wild", "wild one"],
    ambiguos: ["mono", "animales"],
  },
  {
    id: "tropical-hawaiana", nombre: "Tropical / hawaiana (luau)", en: "Tropical / Hawaiian (luau)", grupo: "animales-y-naturaleza",
    sinonimos: ["tropical", "tropicales", "hawaiana", "hawaiano", "hawaii", "hawái", "luau", "aloha", "monstera", "palma", "palmas", "palmera", "hojas de palma", "hojas tropicales", "hoja tropical", "flamenco", "flamingo", "piña", "pineapple", "tucán", "toucan", "hibisco", "tiki", "palm leaves", "tropical leaves", "follaje tropical"],
    ambiguos: ["verano", "summer", "caribe"],
  },
  {
    id: "granja", nombre: "Granja", en: "Farm", grupo: "animales-y-naturaleza",
    sinonimos: ["granja", "farm", "farmyard", "animales de granja", "farm animals", "vaca", "vaquita", "cow", "cerdito", "pig", "gallina", "gallo", "pollito", "pollitos", "oveja", "ovejita", "sheep", "caballo", "horse", "burro", "patito", "granjero", "farmer", "tractor", "establo", "barn", "espantapájaros", "scarecrow"],
    ambiguos: ["rancho", "campo"],
  },
  {
    id: "bosque-encantado", nombre: "Bosque encantado", en: "Enchanted forest", grupo: "animales-y-naturaleza",
    sinonimos: ["bosque", "bosque encantado", "enchanted forest", "forest", "woodland", "bosque mágico", "bosque de hadas", "animales del bosque", "forest animals", "woodland animals", "zorro", "fox", "ciervo", "venado", "deer", "búho", "owl", "ardilla", "squirrel", "erizo", "hedgehog", "hongo", "hongos", "mushroom", "mushrooms", "musgo", "helecho", "campamento", "camping", "fogata", "campfire", "tipi", "teepee"],
    ambiguos: ["árbol", "tree", "leaves"],
  },
  {
    id: "mariposas", nombre: "Mariposas", en: "Butterflies", grupo: "animales-y-naturaleza",
    sinonimos: ["mariposa", "mariposas", "butterfly", "butterflies", "mariposa monarca", "alas de mariposa", "butterfly wings", "libélula", "dragonfly", "abeja", "abejita", "bee", "bumblebee", "colmena", "beehive", "mariquita", "catarina", "ladybug", "insectos", "bichitos", "oruga", "caterpillar", "luciérnaga", "firefly"],
    ambiguos: ["alas", "wings"],
  },
  {
    id: "flores-jardin", nombre: "Flores / jardín", en: "Flowers / garden", grupo: "animales-y-naturaleza",
    sinonimos: ["flor", "flores", "flower", "flowers", "floral", "florales", "blossom", "jardín", "garden", "primavera", "spring", "tulipán", "tulipanes", "tulip", "margarita", "margaritas", "daisy", "girasol", "girasoles", "sunflower", "lirio", "orquídea", "orchid", "peonía", "peony", "hortensia", "hydrangea", "lavanda", "lavender", "flor de cerezo", "cherry blossom", "ramo de flores", "bouquet floral", "arreglo floral", "corona de flores", "flower crown", "pared de flores", "flower wall", "arco floral", "guirnalda de flores"],
    ambiguos: ["rosa", "planta", "plantas", "maceta", "follaje"],
  },
  {
    id: "organico-natural", nombre: "Orgánico natural (verdes y hojas)", en: "Natural greens", grupo: "animales-y-naturaleza",
    sinonimos: ["orgánico natural", "organico natural", "naturaleza", "nature", "verdes y hojas", "hojas verdes", "green leaves", "follaje verde", "green foliage", "botánico", "botánica", "botanical", "greenery", "estilo natural", "natural style", "jardín botánico", "botanical garden", "ecológico", "eco-friendly", "sostenible", "sustainable", "reciclado", "recycled"],
    ambiguos: ["natural"],
  },
  {
    id: "cactus-desierto", nombre: "Cactus / desierto", en: "Cactus / desert", grupo: "animales-y-naturaleza",
    sinonimos: ["cactus", "cactus mejicano", "cactus mexicano", "cacto", "suculenta", "suculentas", "succulent", "succulents", "desierto", "desert", "agave", "nopal", "nopales", "llama", "llamas", "alpaca", "alpacas", "no prob-llama", "cactus party"],
  },
  {
    id: "mascotas", nombre: "Mascotas (perros y gatos)", en: "Pets (dogs and cats)", grupo: "animales-y-naturaleza",
    sinonimos: ["mascota", "mascotas", "pet", "pets", "perro", "perros", "perrito", "perritos", "dog", "dogs", "puppy", "puppies", "cachorro", "cachorros", "gato", "gatos", "gatito", "gatitos", "cat", "cats", "kitten", "kittens", "huellitas", "huellas de perro", "paw print", "paw prints", "hueso", "bone", "fiesta de mascotas", "pet party", "puppy party", "cumpleaños de mascota", "pet birthday", "dog birthday", "cat party", "paws"],
    ambiguos: ["huellitas"],
  },
  {
    id: "osos-peluche", nombre: "Osos y peluches", en: "Teddy bears and plush", grupo: "animales-y-naturaleza",
    sinonimos: ["oso de peluche", "osos de peluche", "osito de peluche", "ositos de peluche", "osito", "ositos", "oso", "osos", "teddy", "teddy bear", "teddy bears", "bear", "bears", "peluche", "peluches", "plush", "plushie", "plushies", "muñeco de peluche", "stuffed animal", "stuffed animals", "bear hug", "we can bearly wait", "beary", "baby bear", "mama bear", "papa bear", "panda", "pandas"],
    ambiguos: ["muñeco", "juguete"],
  },
  {
    id: "unicornio", nombre: "Unicornio", en: "Unicorn", grupo: "fantasia-y-cuentos",
    sinonimos: ["unicornio", "unicornios", "unicorn", "unicorns", "cuerno de unicornio", "unicorn horn", "pegaso", "pegasus", "unicorn party", "unicornio mágico", "magical unicorn"],
  },
  {
    id: "princesas", nombre: "Princesas", en: "Princesses", grupo: "fantasia-y-cuentos",
    sinonimos: ["princesa", "princesas", "princess", "princesses", "reina", "queen", "castillo de princesa", "corona", "coronas", "crown", "crowns", "tiara", "tiaras", "cuento de hadas", "fairy tale", "fairytale", "érase una vez", "once upon a time", "realeza", "royalty", "fiesta real", "royal party", "fiesta de princesas", "princess party", "cenicienta", "bella durmiente", "rapunzel", "zapatilla de cristal"],
    ambiguos: ["real", "royal"],
  },
  {
    id: "fantasia-hadas", nombre: "Fantasía / hadas", en: "Fantasy / fairies", grupo: "fantasia-y-cuentos",
    sinonimos: ["fantasía", "fantasy", "hada", "hadas", "fairy", "fairies", "hada madrina", "fairy godmother", "polvo de hadas", "fairy dust", "pixie dust", "polvo de estrellas", "stardust", "duende", "duendes", "gnomo", "gnomos", "gnome", "gnomes", "varita mágica", "magic wand", "hechizo", "spell", "encantado", "encantada", "enchanted", "libro de cuentos", "storybook", "dragón", "dragones", "dragons", "caballero", "knight", "hechicera", "sorceress", "poción", "pociones", "potion", "potions", "mundo mágico"],
    ambiguos: ["mágico", "mágica", "magic", "magical", "magia", "castillo", "castle", "mago", "wizard"],
  },
  {
    id: "sirenas", nombre: "Sirenas", en: "Mermaids", grupo: "fantasia-y-cuentos",
    sinonimos: ["sirena", "sirenas", "mermaid", "mermaids", "sirenita", "cola de sirena", "mermaid tail", "mermaid party", "fiesta de sirenas", "tritón", "neptuno", "atlántida", "reino submarino", "underwater kingdom", "escamas de sirena", "mermaid scales"],
    ambiguos: ["escamas", "scales", "concha", "perla", "pearl", "shell"],
  },
  {
    id: "invierno", nombre: "Invierno / nieve", en: "Winter / snow", grupo: "fantasia-y-cuentos",
    sinonimos: ["invierno", "winter", "invernal", "wintry", "nieve", "snow", "nevado", "nevada", "snowy", "copo de nieve", "copos de nieve", "snowflake", "snowflakes", "muñeco de nieve", "muñecos de nieve", "snowman", "bola de nieve", "snowball", "snow globe", "globo de nieve", "hielo", "ice", "reina de las nieves", "snow queen", "ice queen", "reina de hielo", "castillo de hielo", "ice castle", "palacio de hielo", "reino de hielo", "ice kingdom", "winter wonderland", "polo norte", "north pole", "pingüino", "pingüinos", "penguin", "penguins", "oso polar", "polar bear", "iglú", "igloo"],
    ambiguos: ["frío", "cold", "congelado", "azul y plata", "blue and silver"],
  },
  {
    id: "superheroes", nombre: "Superhéroes", en: "Superheroes", grupo: "aventura-y-oficios",
    sinonimos: ["superhéroe", "superhéroes", "super héroe", "super héroes", "super hero", "superhero", "superheroína", "superheroínas", "heroína", "héroe", "héroes", "hero", "capa de superhéroe", "superpoderes", "super poderes", "superpowers", "super powers", "antifaz de héroe", "super fuerza", "super mamá", "super papá", "super niño", "super niña", "supergirl", "cómic", "cómics", "comic book", "pop art", "justiciero", "liga de héroes", "equipo de héroes"],
    ambiguos: ["capa", "cape", "antifaz", "mask", "máscara", "comic"],
  },
  {
    id: "espacio", nombre: "Espacio / astronautas", en: "Space / astronauts", grupo: "aventura-y-oficios",
    sinonimos: ["espacio", "espacial", "space", "astronauta", "astronautas", "astronaut", "cosmos", "cósmico", "cosmic", "galaxia", "galaxias", "galaxy", "universo", "universe", "planeta", "planetas", "planet", "sistema solar", "solar system", "cohete", "cohetes", "rocket", "nave espacial", "spaceship", "ovni", "ufo", "extraterrestre", "alien", "aliens", "marciano", "saturno", "marte", "júpiter", "to the moon", "a la luna", "two the moon", "out of this world", "blast off", "despegue", "constelación", "constelaciones", "vía láctea"],
    ambiguos: ["luna", "moon", "sol", "sun"],
  },
  {
    id: "piratas", nombre: "Piratas", en: "Pirates", grupo: "aventura-y-oficios",
    sinonimos: ["pirata", "piratas", "pirate", "pirates", "barco pirata", "pirate ship", "calavera pirata", "skull and crossbones", "bandera pirata", "pirate flag", "jolly roger", "tesoro", "tesoros", "treasure", "mapa del tesoro", "treasure map", "cofre del tesoro", "treasure chest", "garfio", "parche de pirata", "eye patch", "capitán pirata", "ahoy", "isla del tesoro", "treasure island", "fiesta de piratas", "pirate party", "columna pirata", "columna de bloques pirata", "bucanero", "corsario", "doblones", "monedas de oro", "gold coins"],
  },
  {
    id: "vehiculos-oficios", nombre: "Vehículos y oficios", en: "Vehicles and jobs", grupo: "aventura-y-oficios",
    sinonimos: ["carros", "carrito", "coches", "autos", "cars", "camión", "camiones", "truck", "trucks", "excavadora", "excavator", "construcción", "construction", "constructor", "builder", "bomberos", "bombero", "firefighter", "camión de bomberos", "fire truck", "policía", "police", "patrulla", "detective", "doctor", "doctora", "médico", "enfermera", "nurse", "veterinario", "dentista", "chef", "cocinero", "pastelero", "baker", "piloto", "pilot", "avión", "aviones", "airplane", "airplanes", "helicóptero"],
    ambiguos: ["carro", "auto", "avión", "barco", "tren"],
  },
  {
    id: "monstruos", nombre: "Monstruos amistosos", en: "Friendly monsters", grupo: "aventura-y-oficios",
    sinonimos: ["monstruo", "monstruos", "monster", "monsters", "monstruito", "monstruitos", "little monster", "little monsters", "monstruos amistosos", "friendly monsters", "monstruos de colores", "colorful monsters", "monstruos peludos", "furry monsters", "monstruos divertidos", "monster bash", "monster party", "fiesta de monstruos", "ojos saltones", "googly eyes", "ojitos saltones", "peludo", "furry", "pompones", "pom poms"],
    ambiguos: ["ojos", "ojo", "eyes"],
  },
  {
    id: "circo", nombre: "Circo / carpa", en: "Circus / big top", grupo: "aventura-y-oficios",
    sinonimos: ["circo", "circus", "carpa de circo", "big top", "payaso", "payasos", "payasito", "clown", "clowns", "malabarista", "juggler", "acróbata", "acrobat", "trapecista", "domador", "ringmaster", "maestro de ceremonias", "carrusel", "carousel", "tiovivo", "rueda de la fortuna", "ferris wheel", "montaña rusa", "roller coaster", "parque de diversiones", "amusement park", "juegos de feria", "carnival games", "fun fair", "funfair", "tómbola", "step right up", "pasen y vean", "the greatest show", "el gran show"],
    ambiguos: ["sombrero de copa", "top hat", "carpa", "boletos", "tickets"],
  },
  {
    id: "frutas", nombre: "Frutas (cítricos, sandía)", en: "Fruit (citrus, watermelon)", grupo: "gustos-y-motivos",
    sinonimos: ["fruta", "frutas", "fruit", "fruits", "frutal", "frutales", "fruity", "cítricos", "citrus", "sandía", "watermelon", "tutti frutti", "one in a melon", "ensalada de frutas", "fruit salad"],
    ambiguos: [],
  },
  {
    id: "dulces-candy", nombre: "Dulces / candy", en: "Sweets / candy", grupo: "gustos-y-motivos",
    sinonimos: ["dulce", "dulces", "candy", "candies", "sweets", "sweet treats", "golosinas", "golosina", "caramelo", "caramelos", "candy shop", "tienda de dulces", "candy land", "candyland", "tierra de dulces", "candy bar", "mesa de dulces", "mesa dulce", "sweet table", "dessert table", "paleta de caramelo", "lollipop", "lollipops", "chupeta", "chupetín", "gomitas", "gummy", "gummies", "malvaviscos", "marshmallow", "algodón de azúcar", "cotton candy", "bombones", "bombón", "cupcake", "cupcakes", "galleta", "galletas", "cookie", "cookies", "donut", "donuts"],
    ambiguos: ["dulce", "chocolate", "helado"],
  },
];

export const TEMATICAS: readonly Tematica[] = [...TEMATICAS_MUNDO, ...TEMATICAS_ESTILO];
