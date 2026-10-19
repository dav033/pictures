import type { Tematica } from "./tipos";

/** Estilos, paletas y acabados, lugares y culturas, gustos y motivos (la otra mitad de `TEMATICAS`). */
export const TEMATICAS_ESTILO: readonly Tematica[] = [
  {
    id: "boho", nombre: "Boho", en: "Boho", grupo: "estilos",
    sinonimos: ["boho", "bohemio", "bohemia", "bohemian", "boho chic", "estilo boho", "boho wedding", "boho vibes", "hippie", "flower power", "macramé", "pampas", "hierba de la pampa", "pampas grass", "mimbre", "wicker", "rattan", "ratán", "terracota", "terracotta", "tonos tierra", "earth tones", "flores secas", "dried flowers", "atrapasueños", "dreamcatcher"],
  },
  {
    id: "minimalista", nombre: "Minimalista", en: "Minimalist", grupo: "estilos",
    sinonimos: ["minimalista", "minimalistas", "minimalist", "minimal", "minimalismo", "estilo minimalista", "decoración minimalista", "limpio", "clean look", "simple y elegante", "simple and elegant", "menos es más", "less is more", "tone on tone", "tonos neutros", "neutral tones", "paleta neutra", "escandinavo", "scandinavian", "nórdico", "moderno", "contemporáneo", "contemporary"],
    ambiguos: ["simple", "sencillo", "sutil", "neutros"],
  },
  {
    id: "elegante-lujo", nombre: "Elegante / lujo", en: "Elegant / luxury", grupo: "estilos",
    sinonimos: ["elegante", "elegantes", "elegant", "elegancia", "elegance", "lujo", "lujoso", "lujosa", "luxury", "luxurious", "luxe", "de lujo", "high end", "premium", "sofisticado", "sofisticada", "sophisticated", "refinado", "glamour", "glamoroso", "glamorous", "de gala", "black tie", "etiqueta", "evento elegante", "fiesta elegante", "decoración elegante", "decoración de lujo", "opulento", "opulent", "majestuoso", "regio"],
    ambiguos: ["estilo", "style", "classy", "chic", "formal"],
  },
  {
    id: "vintage", nombre: "Vintage / retro", en: "Vintage / retro", grupo: "estilos",
    sinonimos: ["vintage", "retro", "antiguo", "antigua", "antique", "old fashioned", "a la antigua", "de época", "nostalgia", "nostálgico", "nostalgic", "años 20", "años veinte", "1920s", "roaring twenties", "años 50", "1950s", "años 60", "1960s", "años 70", "1970s", "años 80", "1980s", "80s", "años 90", "1990s", "90s", "y2k", "throwback", "victoriano", "victoriana", "victorian"],
    ambiguos: ["clásico", "clásica", "classic", "timeless", "atemporal"],
  },
  {
    id: "rustico", nombre: "Rústico", en: "Rustic", grupo: "estilos",
    sinonimos: ["rústico", "rústica", "rústicos", "rustic", "boda rústica", "rustic wedding", "estilo rústico", "rustic style", "decoración rústica", "campestre", "country", "estilo country", "country chic", "farmhouse", "modern farmhouse", "troncos", "rodajas de madera", "wood slices", "tarima", "pallet", "pallets", "palets", "cajones de madera", "wooden crates", "barril de madera", "wooden barrel", "yute", "jute", "burlap", "arpillera", "mason jar", "mason jars"],
    ambiguos: ["madera", "wood", "wooden", "velas", "candles", "encaje", "lace"],
  },
  {
    id: "neon", nombre: "Neón", en: "Neon", grupo: "paletas-y-acabados",
    sinonimos: ["neón", "neon", "neones", "fluorescente", "fluorescentes", "fluorescent", "fluor", "flúor", "glow in the dark", "brilla en la oscuridad", "luz negra", "black light", "blacklight", "ultravioleta", "colores neón", "neon colors", "neon lights", "luces de neón", "letrero de neón", "neon sign", "fiesta neón", "neon party", "glow party", "neón y negro", "neon and black"],
    ambiguos: ["glow", "rave", "eléctrico", "electric", "vibrante", "vibrant"],
  },
  {
    id: "glam-dorado", nombre: "Glam dorado", en: "Gold glam", grupo: "paletas-y-acabados",
    sinonimos: ["glam dorado", "gold glam", "glam", "oro rosa", "rose gold", "rosegold", "lentejuelas", "sequins", "sequin", "lentejuelado", "glitter", "glittery", "escarcha", "purpurina", "paillettes", "shimmer", "hora dorada", "golden hour"],
    ambiguos: ["dorado", "dorada", "dorados", "doradas", "gold", "golden", "oro"],
  },
  {
    id: "arcoiris", nombre: "Arcoíris", en: "Rainbow", grupo: "paletas-y-acabados",
    sinonimos: ["arcoíris", "arco iris", "rainbow", "rainbows", "multicolor", "multicolores", "multicolored", "multicolour", "todos los colores", "all the colors", "rainbow party", "fiesta arcoíris", "fiesta de arcoíris", "fiesta de colores", "color party", "tema arcoíris", "rainbow theme", "arcoíris pastel", "pastel rainbow", "arcoíris neón", "neon rainbow", "arcoíris metálico", "metallic rainbow", "nubes y arcoíris", "clouds and rainbows", "somewhere over the rainbow", "rainbow baby", "bebé arcoíris", "doble arcoíris", "double rainbow", "taste the rainbow", "colores del arcoíris"],
    ambiguos: ["colorido", "colorida", "coloridos", "coloridas", "colorful", "de colores"],
  },
  {
    id: "pastel-macaron", nombre: "Pastel / macaron", en: "Pastel / macaron", grupo: "paletas-y-acabados",
    sinonimos: ["colores pastel", "pastel colors", "paleta pastel", "pastel palette", "tonos pastel", "pastel tones", "pasteles", "macaron", "macarons", "colores macaron", "tonos macaron", "paleta macaron", "pastel macaron", "fiesta pastel", "pastel party", "tema pastel", "pastel theme", "tonos empolvados", "dusty tones", "dusty pastel"],
    ambiguos: ["pastel", "suave", "soft"],
  },
  {
    id: "monocromatico", nombre: "Monocromático", en: "Monochrome", grupo: "paletas-y-acabados",
    sinonimos: ["monocromático", "monocromática", "monocromáticos", "monocromo", "monochrome", "monochromatic", "un solo color", "single color", "tono sobre tono", "tonal", "blanco y negro", "black and white", "negro y blanco", "escala de grises", "grayscale", "todo blanco", "all white", "total white", "todo negro", "all black", "total black"],
    ambiguos: ["degradé", "degradado", "ombre", "gradient", "gradiente"],
  },
  {
    id: "bicolor", nombre: "Bicolor (dos colores)", en: "Two-tone", grupo: "paletas-y-acabados",
    sinonimos: ["bicolor", "bicolores", "bi color", "dos colores", "two color", "two colors", "two tone", "two-tone", "dos tonos", "combinación de dos colores", "arco dos colores", "arco bicolor", "columna bicolor"],
    ambiguos: [],
  },
  {
    id: "metalico-cromado", nombre: "Metálico / cromado", en: "Metallic / chrome", grupo: "paletas-y-acabados",
    sinonimos: ["metálico", "metálica", "metálicos", "metálicas", "metallic", "cromado", "cromada", "cromados", "cromadas", "chrome", "chromed", "acabado cromado", "acabado metálico", "metallic finish", "acabado espejo", "mirror finish", "efecto espejo", "mirror effect", "espejado", "mirrored", "efecto metálico", "metallic effect"],
    ambiguos: ["metal", "metalizado", "metalizada", "metalizados", "metalizadas", "plata", "plateado", "plateada", "plateados", "silver", "espejo"],
  },
  {
    id: "transparente-burbujas", nombre: "Transparente / burbujas", en: "Clear / bubbles", grupo: "paletas-y-acabados",
    sinonimos: ["transparente", "transparentes", "transparent", "clear balloons", "globo transparente", "globos transparentes", "efecto cristal", "crystal effect", "bubble balloons", "globo burbuja", "globos burbuja", "bobo", "bobos", "bobo balloons", "globos bobo", "globos rellenos", "stuffed balloons"],
    ambiguos: ["cristal", "crystal", "burbuja", "burbujas", "bubble", "bubbles", "clear"],
  },
  {
    id: "lunares-confeti", nombre: "Lunares / confeti", en: "Polka dots / confetti", grupo: "paletas-y-acabados",
    sinonimos: ["lunares", "polka dot", "polka dots", "a lunares", "de lunares", "estampado de lunares", "dot print", "confeti", "confetti", "con confeti", "with confetti", "globos con confeti", "confetti balloons", "lluvia de confeti", "confetti shower", "rayas", "stripes", "striped", "a rayas", "de rayas"],
    ambiguos: ["puntos", "dots", "lunar", "polka"],
  },
  {
    id: "nautico", nombre: "Náutico / marino", en: "Nautical / marine", grupo: "lugares-y-culturas",
    sinonimos: ["náutico", "náutica", "nautical", "marinero", "marinera", "sailor", "sailors", "sailing", "navegante", "navegantes", "mar", "sea", "océano", "ocean", "oceanic", "bajo el mar", "under the sea", "fondo del mar", "ocean floor", "mundo submarino", "underwater world", "submarino mundo", "ancla", "anclas", "anchor", "anchors", "timón", "helm", "ship wheel"],
    ambiguos: ["mar", "sea", "playa", "beach", "pez", "fish", "coral"],
  },
  {
    id: "musica-disco", nombre: "Música / disco", en: "Music / disco", grupo: "gustos-y-motivos",
    sinonimos: ["música", "music", "musical", "musicales", "disco", "discoteca", "disco ball", "bola disco", "bola de disco", "bola de espejos", "mirror ball", "mirrorball", "disco party", "fiesta disco", "boogie", "boogie nights", "funky", "funk", "soul", "groove", "groovy", "baile", "dance", "danza", "bailar", "dancing", "dance party", "fiesta de baile", "dance floor", "pista de baile", "dancefloor", "baile de graduación"],
    ambiguos: ["música", "music", "disco", "baile", "dance"],
  },
  {
    id: "hollywood-cine", nombre: "Hollywood / cine", en: "Hollywood / movies", grupo: "gustos-y-motivos",
    sinonimos: ["hollywood", "cine", "cinema", "película", "películas", "movie", "movies", "film", "films", "movie night", "noche de cine", "noche de películas", "cine en casa", "home cinema", "home theater", "autocine", "drive-in", "alfombra roja", "red carpet", "red carpet event", "premiere", "estreno", "estrella de cine", "movie star", "movie stars", "estrellas de cine", "estrella de hollywood", "hollywood star", "paseo de la fama", "walk of fame", "hollywood walk of fame", "oscar"],
    ambiguos: ["cine", "película", "movie", "premiere", "estreno", "popcorn", "palomitas"],
  },
  {
    id: "paris", nombre: "París", en: "Paris", grupo: "lugares-y-culturas",
    sinonimos: ["parís", "parisino", "parisina", "parisian", "parisienne", "torre eiffel", "eiffel tower", "eiffel", "francia", "france", "francés", "francesa", "french", "français", "française", "estilo francés", "french style", "french chic", "chic francés", "french country", "campo francés", "provenza", "provence", "provenzal", "provençal", "lavanda provenza", "boutique parisina", "parisian boutique", "café parisino", "parisian café", "bistró", "bistrot"],
    ambiguos: ["francés", "french", "boina", "beret"],
  },
  {
    id: "mexicana", nombre: "México / fiesta mexicana", en: "Mexican fiesta", grupo: "lugares-y-culturas",
    sinonimos: ["mexicana", "mexicano", "mexicanos", "mexicanas", "mexican", "méxico", "fiesta mexicana", "mexican fiesta", "mexican party", "noche mexicana", "mexican night", "temática mexicana", "tema mexicano", "mexican theme", "estilo mexicano", "mexican style", "decoración mexicana", "mexican decor", "mexican decoration", "papel picado", "papel china", "banderitas de papel", "paper banners", "banderines mexicanos", "mexican banners", "sarape", "sarapes", "serape", "serapes", "zarape", "zarapes", "rebozo"],
    ambiguos: ["fiesta", "piñata", "tacos", "tequila", "chile"],
  },
  {
    id: "vaquero-western", nombre: "Vaquero / western", en: "Cowboy / western", grupo: "lugares-y-culturas",
    sinonimos: ["vaquero", "vaqueros", "vaquera", "vaqueras", "cowboy", "cowboys", "cowgirl", "cowgirls", "cow boy", "cow girl", "western", "wild west", "salvaje oeste", "oeste salvaje", "viejo oeste", "old west", "far west", "lejano oeste", "texas", "texano", "texana", "texanos", "texanas", "texan", "texans", "rodeo", "rodeos", "rodeo party", "fiesta de rodeo", "yeehaw", "yee haw", "yihaa"],
    ambiguos: ["bandana", "rodeo"],
  },
  {
    id: "corazones", nombre: "Corazones", en: "Hearts", grupo: "gustos-y-motivos",
    sinonimos: ["corazón", "corazones", "heart", "hearts", "hearty", "en forma de corazón", "heart shaped", "forma de corazón", "heart shape", "heart shapes", "globo corazón", "globo de corazón", "heart balloon", "heart balloons", "globos corazón", "globos de corazones", "arco de corazones", "heart arch", "arco corazones", "arco corazón", "columna de corazones", "heart column", "pared de corazones", "heart wall", "muro de corazones", "lluvia de corazones", "rain of hearts", "shower of hearts", "mar de corazones", "sea of hearts", "corazones rojos", "red hearts"],
    ambiguos: ["corazón", "heart", "amor", "love"],
  },
  {
    id: "estrellas-noche", nombre: "Estrellas / noche", en: "Stars / night", grupo: "gustos-y-motivos",
    sinonimos: ["estrella", "estrellas", "star", "stars", "starry", "estrellado", "estrellada", "estrellados", "estrelladas", "starry night", "noche estrellada", "cielo estrellado", "starry sky", "starlit", "starlight", "luz de estrellas", "twinkle twinkle little star", "twinkle twinkle", "brilla brilla estrellita", "brilla estrellita", "estrellita", "estrellitas", "little star", "little stars", "twinkle", "twinkling", "centelleante", "centelleo", "titilante", "titilar", "luna y estrellas", "moon and stars"],
    ambiguos: ["estrella", "estrellas", "star", "stars", "noche", "night"],
  },
  {
    id: "otono", nombre: "Otoño", en: "Autumn / fall", grupo: "gustos-y-motivos",
    sinonimos: ["otoño", "otoñal", "autumn", "autumnal", "fall", "fall vibes", "fall theme", "tema otoñal", "fall party", "fiesta de otoño", "autumn party", "hojas de otoño", "autumn leaves", "fall leaves", "hojas secas", "dry leaves", "dried leaves", "hojas caídas", "fallen leaves", "hojas de maple", "maple leaves", "hoja de maple", "maple leaf", "hojas de arce", "arce", "maple", "roble", "oak", "hojas de roble", "oak leaves", "bellotas", "acorns"],
    ambiguos: ["calabaza", "pumpkin", "mostaza", "burdeos", "cosecha"],
  },
  {
    id: "oriental", nombre: "Oriental / asiática", en: "Oriental / Asian", grupo: "lugares-y-culturas",
    sinonimos: ["oriental", "orientales", "asiático", "asiática", "asian", "asia", "japón", "japonés", "japonesa", "japan", "japanese", "estilo japonés", "japanese style", "tema japonés", "japanese theme", "fiesta japonesa", "japanese party", "kimono", "kimonos", "geisha", "geishas", "samurái", "ninja", "ninjas", "origami", "grullas de papel", "paper cranes", "grulla de papel", "paper crane", "sakura"],
    ambiguos: ["zen", "bambú", "origami", "kawaii", "abanico"],
  },
  {
    id: "deportes", nombre: "Deportes", en: "Sports", grupo: "gustos-y-motivos",
    sinonimos: ["deportes", "deporte", "sports", "sport", "deportivo", "deportiva", "futbol", "fútbol", "soccer", "balón de fútbol", "baloncesto", "básquetbol", "basketball", "béisbol", "baseball", "tenis", "tennis", "voleibol", "volleyball", "natación", "golf", "hockey", "rugby", "boxeo", "boxing", "artes marciales", "karate", "gimnasia", "gymnastics", "ciclismo", "atletismo", "yoga", "fitness", "gimnasio", "gym", "surf", "patinaje", "skate", "porristas", "cheerleader", "cancha", "trofeo", "medalla", "uniforme deportivo"],
    ambiguos: ["equipo", "team", "balón", "balones", "pelota", "copa", "gol", "jugador"],
  },
  {
    id: "videojuegos", nombre: "Videojuegos", en: "Video games", grupo: "gustos-y-motivos",
    sinonimos: ["videojuegos", "videojuego", "video juego", "video juegos", "video game", "video games", "videogame", "gamer", "gamers", "gaming", "consola", "consolas", "console", "control de videojuegos", "game controller", "joystick", "gamepad", "arcade", "máquina arcade", "level up", "player one", "jugador uno", "press start", "game over", "fin del juego", "pixel art", "8-bit", "8 bit", "bloques pixelados", "realidad virtual", "virtual reality", "esports", "fiesta gamer", "gamer party", "noche de videojuegos", "game night"],
    ambiguos: ["juegos", "game", "pixel", "pixeles", "control"],
  },
];
