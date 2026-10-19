import type { Celebracion } from "./tipos";

/** Fechas del calendario, deporte y eventos, empresa y comercio. */
export const CELEBRACIONES_CALENDARIO: readonly Celebracion[] = [
  // ---- Fechas del calendario ------------------------------------------------------------------------------
  {
    id: "ano-nuevo", nombre: "Año nuevo", en: "New Year", grupo: "calendario",
    sinonimos: ["año nuevo", "feliz año nuevo", "feliz año", "new year", "new years", "happy new year", "new year's eve", "new years eve", "nye", "nochevieja", "noche vieja", "fin de año", "reveillon", "countdown", "cuenta regresiva", "bienvenido 2027", "feliz 2027", "feliz 2026", "feliz 2028", "hello 2027", "adiós 2026", "las doce uvas", "12 uvas"],
  },
  {
    id: "dia-de-reyes", nombre: "Día de Reyes", en: "Three Kings Day", grupo: "calendario",
    sinonimos: ["día de reyes", "reyes magos", "tres reyes magos", "los reyes magos", "epifanía", "three kings day", "three kings", "roscón de reyes", "rosca de reyes", "6 de enero", "día de los reyes", "noche de reyes"],
    ambiguos: ["reyes"],
  },
  {
    id: "san-valentin", nombre: "San Valentín / amor y amistad", en: "Valentine's Day", grupo: "calendario",
    sinonimos: ["san valentín", "san balentin", "sanvalentin", "día de san valentín", "valentines", "valentines day", "valentine's day", "14 de febrero", "día de los enamorados", "enamorados", "día del amor", "amor y amistad", "amor amistad", "día del amor y la amistad", "día de la amistad", "friendship day", "día del amigo", "galentine", "galentines", "te amo", "i love you", "te quiero", "decoración con amor", "celebrar es amar", "be my valentine", "cupido", "cupid"],
    ambiguos: ["amor", "love", "corazones", "hearts", "enamorada", "enamorado", "amistad", "valentín"],
  },
  {
    id: "carnaval", nombre: "Carnaval", en: "Carnival", grupo: "calendario",
    sinonimos: ["carnaval", "carnavales", "carnival", "mardi gras", "fiesta de carnaval", "carnaval de barranquilla", "carnaval de río", "comparsa", "comparsas", "batucada", "reina del carnaval", "desfile de carnaval", "marimonda"],
    ambiguos: ["carroza", "carrozas"],
  },
  {
    id: "dia-de-la-mujer", nombre: "Día de la Mujer", en: "International Women's Day", grupo: "calendario",
    sinonimos: ["día de la mujer", "día internacional de la mujer", "8 de marzo", "women's day", "womens day", "international women's day", "día de las mujeres", "8m", "feliz día de la mujer", "girl power", "empoderamiento femenino", "mes de la mujer"],
  },
  {
    id: "san-patricio", nombre: "San Patricio", en: "St. Patrick's Day", grupo: "calendario",
    sinonimos: ["san patricio", "día de san patricio", "st patrick", "st patricks", "st patrick's day", "saint patrick", "saint patrick's day", "17 de marzo", "trébol de cuatro hojas", "shamrock", "leprechaun", "duende irlandés", "olla de oro", "pot of gold", "fiesta irlandesa", "paddy's day", "lucky charm"],
    ambiguos: ["trébol", "irlandés", "irish"],
  },
  {
    id: "pascua", nombre: "Pascua", en: "Easter", grupo: "calendario",
    sinonimos: ["pascua", "pascuas", "felices pascuas", "easter", "happy easter", "easter party", "domingo de resurrección", "semana santa", "conejo de pascua", "conejito de pascua", "easter bunny", "huevos de pascua", "huevo de pascua", "easter egg", "easter eggs", "egg hunt", "búsqueda de huevos", "caza de huevos", "some bunny", "hoppy easter"],
    ambiguos: ["conejo", "bunny", "conejito"],
  },
  {
    id: "dia-del-nino", nombre: "Día del Niño", en: "Children's Day", grupo: "calendario",
    sinonimos: ["día del niño", "día de los niños", "día de la niñez", "children's day", "childrens day", "kids day", "día del niño y la niña", "día de la infancia", "día internacional del niño", "30 de abril", "feliz día del niño", "día de los pequeños", "día del nene"],
  },
  {
    id: "dia-de-la-madre", nombre: "Día de la Madre", en: "Mother's Day", grupo: "calendario",
    sinonimos: ["día de la madre", "día de las madres", "día de mamá", "día de la mamá", "mothers day", "mother's day", "feliz día mamá", "feliz día de la madre", "feliz día mami", "para mamá", "gracias mamá", "te quiero mamá", "te amo mamá", "sorprende a mamá", "mejor mamá del mundo", "best mom ever", "best mom", "happy mother's day", "mamita"],
    ambiguos: ["mamá", "mami", "madre", "madres", "mom", "mother", "mommy", "mamás"],
  },
  {
    id: "dia-del-padre", nombre: "Día del Padre", en: "Father's Day", grupo: "calendario",
    sinonimos: ["día del padre", "día de los padres", "día de papá", "día del papá", "fathers day", "father's day", "feliz día papá", "feliz día del padre", "para papá", "gracias papá", "te quiero papá", "te amo papá", "mejor papá del mundo", "best dad ever", "best dad", "happy father's day", "papito", "super papá", "el mejor papá"],
    ambiguos: ["papá", "papi", "padre", "padres", "dad", "father", "daddy", "papás"],
  },
  {
    id: "dia-del-maestro", nombre: "Día del Maestro", en: "Teacher's Day", grupo: "calendario",
    sinonimos: ["día del maestro", "día del profesor", "día del docente", "día de los maestros", "día de los docentes", "día de la maestra", "día del educador", "teachers day", "teacher's day", "teacher appreciation", "teacher appreciation day", "semana del maestro", "feliz día maestro", "feliz día maestra", "gracias maestra", "gracias maestro", "gracias profe", "best teacher", "best teacher ever", "15 de mayo", "thank you teacher"],
    ambiguos: ["maestro", "maestra", "profesor", "profesora", "profe", "teacher", "docente"],
  },
  {
    id: "dia-de-la-secretaria", nombre: "Día de la Secretaria", en: "Administrative Professionals' Day", grupo: "calendario",
    sinonimos: ["día de la secretaria", "día de las secretarias", "día de secretaria", "secretary's day", "secretary day", "secretaries day", "administrative professionals day", "administrative professionals", "día del asistente administrativo", "feliz día secretaria", "gracias secretaria", "admin appreciation"],
    ambiguos: ["secretaria", "secretarias", "secretary"],
  },
  {
    id: "dia-de-los-abuelos", nombre: "Día de los Abuelos", en: "Grandparents' Day", grupo: "calendario",
    sinonimos: ["día de los abuelos", "día del abuelo", "día de la abuela", "grandparents day", "feliz día abuelo", "feliz día abuela", "gracias abuelos", "te quiero abuela", "te quiero abuelo", "best grandma", "best grandpa", "mejor abuela del mundo", "mejor abuelo del mundo", "día de los abuelitos"],
    ambiguos: ["abuelo", "abuela", "abuelos", "abuelita", "abuelito", "grandma", "grandpa", "grandparents"],
  },
  {
    id: "regreso-a-clases", nombre: "Regreso a clases", en: "Back to school", grupo: "calendario",
    sinonimos: ["regreso a clases", "regreso a la escuela", "regreso al colegio", "back to school", "vuelta al cole", "vuelta al colegio", "vuelta a clases", "inicio de clases", "inicio escolar", "inicio del año escolar", "primer día de clases", "primer día de escuela", "first day of school", "bienvenida escolar", "welcome back to school", "inicio de curso", "fin de curso", "fin de clases", "fin del año escolar", "end of school year", "last day of school"],
    ambiguos: ["colegio", "escuela", "school", "clases"],
  },
  {
    id: "independencia", nombre: "Independencia / fiestas patrias", en: "Independence / national holidays", grupo: "calendario",
    sinonimos: ["independencia", "día de la independencia", "fiestas patrias", "fiesta patria", "grito de independencia", "mes patrio", "mes de la patria", "independence day", "national day", "día nacional", "bicentenario", "día de la bandera", "flag day", "viva la patria", "orgullo patrio", "fiesta nacional", "fiestas nacionales", "día de la patria", "colores patrios", "bandera nacional", "7 de agosto", "9 de julio", "10 de agosto", "5 de julio", "25 de mayo", "27 de febrero", "28 de noviembre", "20 de noviembre"],
    ambiguos: ["bandera", "banderas", "tricolor", "patria", "flag"],
  },
  {
    id: "cuatro-de-julio", nombre: "4 de julio (EE. UU.)", en: "Fourth of July", grupo: "calendario",
    sinonimos: ["4 de julio", "cuatro de julio", "fourth of july", "4th of july", "july 4th", "july 4", "july fourth", "bandera usa", "bandera de estados unidos", "bandera de eeuu", "usa flag", "american flag", "stars and stripes", "estrellas y rayas", "red white and blue", "rojo blanco y azul", "god bless america", "american pride", "usa party", "memorial day", "labor day", "veterans day"],
  },
  {
    id: "independencia-mexico", nombre: "16 de septiembre (México)", en: "Mexican Independence Day", grupo: "calendario",
    sinonimos: ["16 de septiembre", "dieciséis de septiembre", "15 de septiembre", "grito de dolores", "independencia de méxico", "fiestas patrias méxico", "viva méxico", "mexican independence day", "mexican independence", "noche mexicana", "verde blanco y rojo", "la noche del grito", "el grito"],
  },
  {
    id: "independencia-colombia", nombre: "20 de julio (Colombia)", en: "Colombian Independence Day", grupo: "calendario",
    sinonimos: ["20 de julio", "veinte de julio", "independencia de colombia", "independencia colombia", "colombian independence day", "colombian independence", "fiestas patrias colombia", "amarillo azul y rojo", "tricolor colombia", "bandera de colombia", "bandera colombia", "banderola colombia", "viva colombia", "orgullo colombiano", "soy colombiano", "soy colombiana", "batalla de boyacá"],
  },
  {
    id: "independencia-peru", nombre: "Fiestas patrias del Perú (28 de julio)", en: "Peruvian Independence Day", grupo: "calendario",
    sinonimos: ["28 de julio", "fiestas patrias perú", "independencia del perú", "independencia peru", "peruvian independence day", "peruvian independence", "bandera del perú", "bandera peru", "viva el perú", "orgullo peruano", "soy peruano", "soy peruana"],
  },
  {
    id: "independencia-chile", nombre: "18 de septiembre (Chile)", en: "Chilean Independence Day", grupo: "calendario",
    sinonimos: ["18 de septiembre", "fiestas patrias chile", "fiestas patrias de chile", "independencia de chile", "independencia chile", "dieciocho de septiembre", "el dieciocho", "fonda", "fondas", "ramadas", "viva chile", "orgullo chileno", "soy chileno", "soy chilena", "chilean independence day", "bandera de chile", "cueca"],
  },
  {
    id: "cinco-de-mayo", nombre: "Cinco de Mayo", en: "Cinco de Mayo", grupo: "calendario",
    sinonimos: ["cinco de mayo", "5 de mayo", "batalla de puebla", "viva cinco de mayo", "happy cinco de mayo", "taco party", "fiesta de tacos", "tequila party", "may 5th", "fifth of may"],
  },
  {
    id: "halloween", nombre: "Halloween", en: "Halloween", grupo: "calendario",
    sinonimos: ["halloween", "jalouin", "jalowin", "jaloguin", "hallowen", "haloween", "halloween party", "happy halloween", "feliz halloween", "fiesta de halloween", "noche de brujas", "día de brujas", "noche de halloween", "trick or treat", "truco o trato", "dulce o truco", "spooky", "spooky season", "spooktacular", "all hallows eve", "31 de octubre", "october 31", "boo bash", "casa embrujada", "haunted house", "casa del terror", "fiesta de terror", "fiesta de brujas", "fiesta de monstruos", "noche de terror", "trunk or treat", "monster bash", "witches brew", "noche embrujada", "scary party"],
    ambiguos: ["bruja", "brujas", "brujita", "brujo", "calabaza", "calabazas", "fantasma", "fantasmas", "murciélago", "murciélagos", "telaraña", "araña", "pumpkin", "ghost"],
  },
  {
    id: "dia-de-muertos", nombre: "Día de Muertos", en: "Day of the Dead", grupo: "calendario",
    sinonimos: ["día de muertos", "día de los muertos", "día de los difuntos", "día de difuntos", "day of the dead", "día de todos los santos", "todos los santos", "catrina", "catrinas", "la catrina", "calavera de azúcar", "sugar skull", "sugar skulls", "altar de muertos", "ofrenda de muertos", "cempasúchil", "flor de cempasúchil", "pan de muerto", "noche de muertos", "2 de noviembre", "1 de noviembre"],
    ambiguos: ["muertos", "difuntos", "papel picado", "calavera", "calaveras", "ofrenda", "ofrendas", "marigold"],
  },
  {
    id: "accion-de-gracias", nombre: "Acción de Gracias", en: "Thanksgiving", grupo: "calendario",
    sinonimos: ["acción de gracias", "día de acción de gracias", "thanksgiving", "happy thanksgiving", "feliz acción de gracias", "thanksgiving day", "thanksgiving party", "thanksgiving dinner", "cena de acción de gracias", "turkey day", "friendsgiving", "gobble gobble", "thankful and blessed", "grateful thankful blessed", "día de dar gracias", "cornucopia", "cuerno de la abundancia", "cena de pavo"],
    ambiguos: ["pavo", "turkey", "cosecha", "harvest", "thankful", "grateful"],
  },
  {
    id: "black-friday", nombre: "Black Friday / ciber lunes", en: "Black Friday / Cyber Monday", grupo: "calendario",
    sinonimos: ["black friday", "blackfriday", "viernes negro", "cyber monday", "cybermonday", "ciber lunes", "cyber lunes", "cyber week", "ciber semana", "cyberweek", "black week", "hot sale", "hotsale", "buen fin", "el buen fin", "black friday sale", "noviembre negro", "black november", "cyber days", "cyberdays"],
  },
  {
    id: "navidad", nombre: "Navidad", en: "Christmas", grupo: "calendario",
    sinonimos: ["navidad", "navidades", "navideño", "navideña", "navideños", "christmas", "xmas", "x-mas", "krismas", "chrismas", "navida", "nabidad", "navidd", "merry christmas", "feliz navidad", "happy holidays", "felices fiestas", "season's greetings", "papá noel", "santa claus", "santa", "san nicolás", "viejito pascuero", "pesebre", "belén", "árbol de navidad", "arbolito de navidad", "christmas tree", "nochebuena", "noche buena", "christmas eve", "nativity", "novena", "novenas", "novena de aguinaldos", "aguinaldo", "aguinaldos", "posada", "posadas", "villancicos", "24 de diciembre", "25 de diciembre", "christmas day", "reno", "renos", "reindeer", "duende navideño", "elfo", "elf", "bastón de caramelo", "candy cane", "candy canes", "guirnalda navideña", "corona navideña", "christmas wreath", "estrella de belén", "campanas navideñas", "jingle bells", "ho ho ho"],
    ambiguos: ["campana", "campanas", "diciembre", "december", "holiday", "holidays", "regalo", "regalos", "presents", "gift", "gifts", "invierno navideño"],
  },
  {
    id: "hanukkah", nombre: "Hanukkah", en: "Hanukkah", grupo: "calendario",
    sinonimos: ["hanukkah", "hanukah", "hanuka", "chanukah", "janucá", "menorah", "menorá", "dreidel", "happy hanukkah", "feliz janucá", "feliz hanukkah", "hanukkah party", "eight crazy nights", "ocho noches de hanukkah", "chag sameach", "festival judío de las luces", "fiesta de las luminarias"],
    ambiguos: ["estrella de david", "star of david"],
  },
  {
    id: "diwali", nombre: "Diwali", en: "Diwali", grupo: "calendario",
    sinonimos: ["diwali", "deepavali", "divali", "dipavali", "happy diwali", "feliz diwali", "diwali party", "diwali celebration", "rangoli", "diya", "diyas", "shubh deepavali", "shubh diwali", "festival de las luces hindú", "celebración hindú", "hindu festival"],
  },
  {
    id: "ano-nuevo-chino", nombre: "Año nuevo chino", en: "Lunar / Chinese New Year", grupo: "calendario",
    sinonimos: ["año nuevo chino", "chinese new year", "lunar new year", "año nuevo lunar", "festival de primavera china", "spring festival china", "gong xi fa cai", "gung hay fat choy", "año del dragón", "año de la serpiente", "año del caballo", "año de la cabra", "year of the dragon", "year of the snake", "year of the horse", "year of the goat", "linternas rojas", "red lantern", "red lanterns", "sobre rojo", "sobres rojos", "red envelope", "hongbao", "danza del león", "lion dance", "dragon dance", "cny", "tet", "año nuevo vietnamita", "año nuevo asiático"],
  },
  {
    id: "ramadan-eid", nombre: "Ramadán / Eid", en: "Ramadan / Eid", grupo: "calendario",
    sinonimos: ["ramadán", "ramadan kareem", "ramadan mubarak", "eid", "eid mubarak", "eid al fitr", "eid al adha", "eid ul fitr", "id mubarak", "aid mubarak", "fiesta del cordero", "fiesta del fin del ayuno", "eid party", "happy eid", "feliz eid", "feliz ramadán", "iftar", "iftar party", "fanous", "celebración islámica"],
    ambiguos: ["luna creciente", "crescent moon", "mezquita", "mosque"],
  },
  {
    id: "orgullo", nombre: "Orgullo (Pride)", en: "Pride", grupo: "calendario",
    sinonimos: ["orgullo gay", "orgullo lgbt", "orgullo lgbtq", "orgullo lgbtiq", "día del orgullo", "día del orgullo gay", "mes del orgullo", "pride", "pride month", "pride party", "pride parade", "happy pride", "feliz orgullo", "gay pride", "lgbt pride", "lgbt", "lgbtq", "lgbtiq", "lgtb", "lgbti", "marcha del orgullo", "desfile del orgullo", "love is love", "amor es amor", "love wins", "bandera lgbt", "bandera del orgullo", "pride flag", "queer"],
    ambiguos: ["orgullo", "diversidad", "diversity", "inclusión"],
  },
  {
    id: "oktoberfest", nombre: "Oktoberfest", en: "Oktoberfest", grupo: "calendario",
    sinonimos: ["oktoberfest", "octoberfest", "oktober fest", "october fest", "oktoberfest party", "fiesta de la cerveza", "fiesta cervecera", "fiesta alemana", "german party", "bavarian party", "fiesta bávara", "biergarten", "beer garden", "prost", "prosit", "lederhosen", "dirndl", "festival de la cerveza", "beer festival", "beerfest"],
    ambiguos: ["stein", "pretzel", "bretzel", "baviera", "bavaria"],
  },
  // ---- Deporte y eventos -----------------------------------------------------------------------------------
  {
    id: "mundial-futbol", nombre: "Mundial / fútbol", en: "World Cup / football (soccer)", grupo: "deporte-y-eventos",
    sinonimos: ["mundial", "copa del mundo", "copa mundial", "mundial de fútbol", "world cup", "worldcup", "copa américa", "eurocopa", "euro cup", "copa libertadores", "libertadores", "copa oro", "final de fútbol", "final del mundial", "partido de fútbol", "partido del mundial", "fiesta de fútbol", "fiesta mundialista", "mundialista", "selección", "la selección", "selección nacional", "selección colombia", "hinchas", "hincha", "hinchada", "golazo", "viva la selección", "vamos selección", "soccer party", "football party", "fiebre mundialista", "fiebre del fútbol", "pasión del fútbol", "la pasión del fútbol", "eliminatorias", "mundial 2026", "world cup 2026", "world cup party", "watch party"],
    ambiguos: ["fútbol", "soccer", "balón de fútbol", "balones de fútbol", "pelota de fútbol", "balón", "balones", "cancha", "estadio", "stadium", "gol"],
  },
  {
    id: "super-bowl", nombre: "Final de fútbol americano (Super Bowl)", en: "American football final (Super Bowl)", grupo: "deporte-y-eventos",
    sinonimos: ["super bowl", "superbowl", "super bowl party", "super bowl sunday", "final de fútbol americano", "fútbol americano", "american football", "touchdown", "tailgate", "tailgate party", "tailgating", "game day", "gameday", "game day party", "día de partido", "big game", "the big game", "big game party", "football sunday", "domingo de fútbol americano", "halftime show", "show de medio tiempo", "end zone", "super bowl decorations"],
  },
  {
    id: "olimpiadas", nombre: "Olimpiadas", en: "Olympics", grupo: "deporte-y-eventos",
    sinonimos: ["olimpiadas", "olimpiada", "juegos olímpicos", "olímpico", "olímpicos", "olympics", "olympic", "olympic games", "olympics party", "fiesta olímpica", "olimpiadas escolares", "olimpiadas deportivas", "juegos paralímpicos", "paralympics", "podio", "podium", "medalla de oro", "gold medal", "medalla de plata", "medalla de bronce", "aros olímpicos", "olympic rings", "cinco aros", "antorcha olímpica", "olympic torch", "llama olímpica", "juegos panamericanos", "panamericanos", "juegos centroamericanos", "juegos bolivarianos", "juegos deportivos", "competencia deportiva", "sports day", "día deportivo", "día del deporte", "field day", "jornada deportiva", "mini olimpiadas", "mini olympics", "kids olympics"],
  },
  {
    id: "carrera-meta", nombre: "Carrera / maratón / meta", en: "Race / marathon / finish line", grupo: "deporte-y-eventos",
    sinonimos: ["maratón", "marathon", "media maratón", "half marathon", "línea de meta", "finish line", "arco de meta", "arco de llegada", "arco de salida", "meta de carrera", "starting line", "línea de salida", "triatlón", "triathlon", "carrera de colores", "color run", "colour run", "fun run", "carrera divertida", "carrera atlética", "carrera de 5k", "carrera de 10k", "carrera 5k", "carrera 10k", "ultra maratón", "trail run", "carrera de montaña", "carrera de ciclismo", "carrera de relevos", "relay race", "carrera de obstáculos", "obstacle race", "mud run", "race day", "día de carrera", "en sus marcas", "listos fuera", "ready set go", "on your mark", "kit de corredor", "corredores", "runners", "running club", "run club"],
    ambiguos: ["carrera", "meta", "10k", "5k", "21k", "42k", "salida", "llegada", "race", "finish", "running", "ciclismo"],
  },
  {
    id: "campeonato", nombre: "Campeonato / torneo", en: "Championship / tournament", grupo: "deporte-y-eventos",
    sinonimos: ["campeonato", "campeonatos", "torneo", "torneos", "tournament", "championship", "champions", "campeón", "campeones", "campeona", "campeonas", "trofeo", "trofeos", "trophy", "fiesta de campeonato", "celebración de campeonato", "championship party", "fiesta del equipo", "team party", "banquete deportivo", "cierre de temporada deportiva", "end of season party", "inauguración de torneo", "gran final", "grand final", "finalistas", "subcampeón", "runner up", "semifinal", "ganamos", "we won", "victory party", "fiesta de la victoria", "bicampeón", "tricampeón", "liga de fútbol", "go team", "vamos equipo", "pep rally"],
    ambiguos: ["copa", "final", "equipo", "team", "victoria", "victory", "liga", "league"],
  },
  // ---- Empresa y comercio ----------------------------------------------------------------------------------
  {
    id: "inauguracion", nombre: "Inauguración / apertura", en: "Grand opening", grupo: "empresa-y-comercio",
    sinonimos: ["inauguración", "inaguracion", "inaugurar", "inaugura", "inauguramos", "gran inauguración", "gran apertura", "grand opening", "apertura de tienda", "apertura de local", "apertura de negocio", "apertura de restaurante", "apertura de sucursal", "soft opening", "ribbon cutting", "corte de cinta", "corte de listón", "nuevo local", "nueva sucursal", "nueva tienda", "nuevo negocio", "ya abrimos", "estamos abiertos", "now open", "we are open", "próximamente", "coming soon", "inauguración de oficinas", "ceremonia de inauguración", "ceremonia de apertura", "opening ceremony", "opening day", "día de apertura", "open house", "puertas abiertas", "bienvenidos a nuestra tienda"],
    ambiguos: ["apertura", "opening", "abrimos"],
  },
  {
    id: "aniversario-empresa", nombre: "Aniversario de empresa", en: "Company anniversary", grupo: "empresa-y-comercio",
    sinonimos: ["aniversario de empresa", "aniversario de la empresa", "aniversario corporativo", "aniversario de la tienda", "aniversario del negocio", "aniversario de la marca", "aniversario del local", "aniversario del restaurante", "aniversario de la compañía", "aniversario institucional", "aniversario de la fundación", "aniversario del colegio", "aniversario de la universidad", "aniversario de la ciudad", "aniversario del club", "company anniversary", "business anniversary", "brand anniversary", "store anniversary", "corporate anniversary", "años de la empresa", "años de trayectoria", "años de fundación", "años de historia", "años en el mercado", "años de servicio", "años de experiencia", "years of service", "years in business", "years of success", "celebramos nuestro aniversario", "celebrating our anniversary", "gran aniversario"],
  },
  {
    id: "lanzamiento-producto", nombre: "Lanzamiento de producto / marca", en: "Product / brand launch", grupo: "empresa-y-comercio",
    sinonimos: ["lanzamiento", "lanzamientos", "lanzamiento de producto", "lanzamiento de marca", "lanzamiento de colección", "lanzamiento de servicio", "lanzamiento de libro", "lanzamiento de disco", "lanzamiento de álbum", "lanzamiento de campaña", "lanzamiento oficial", "gran lanzamiento", "product launch", "launch", "launch party", "launch event", "launch day", "brand launch", "collection launch", "book launch", "album launch", "grand launch", "official launch", "nuevo producto", "new product", "presentación de producto", "presentación de marca", "presentación oficial", "presentación de colección", "unveiling", "product reveal", "nueva colección", "new collection", "nueva línea", "new line", "novedades", "ya disponible", "now available", "preventa", "pre-order", "preorder", "estreno", "premiere", "estreno de producto"],
    ambiguos: ["novedad", "new arrival", "new arrivals"],
  },
  {
    id: "evento-corporativo", nombre: "Evento corporativo", en: "Corporate event", grupo: "empresa-y-comercio",
    sinonimos: ["evento corporativo", "eventos corporativos", "fiesta corporativa", "fiesta de empresa", "fiesta de la empresa", "fiesta de fin de año de la empresa", "fiesta de oficina", "corporate event", "corporate events", "corporate party", "company party", "company event", "office party", "office christmas party", "team building", "teambuilding", "integración de equipo", "evento de integración", "evento empresarial", "eventos empresariales", "evento de empresa", "evento institucional", "cena de gala", "cena de empresa", "cena corporativa", "gala corporativa", "gala empresarial", "gala benéfica", "charity gala", "charity event", "evento benéfico", "fundraiser", "recaudación de fondos", "subasta benéfica", "reconocimiento", "premiación", "awards night", "awards ceremony", "gala de premios", "ceremonia de premios", "ceremonia de reconocimiento", "día de la familia de la empresa", "cierre de año", "year end party", "end of year party", "cóctel corporativo", "cóctel empresarial", "happy hour", "afterwork", "after work", "after office", "kickoff", "kick-off", "sales kickoff", "town hall", "all hands", "fiesta de colaboradores", "fiesta de empleados", "staff party", "employee appreciation"],
    ambiguos: ["corporativo", "corporativa", "empresa", "empresarial", "oficina", "office", "gala", "awards", "premios", "colaboradores", "empleados"],
  },
  {
    id: "feria-stand", nombre: "Feria / stand", en: "Trade fair / booth", grupo: "empresa-y-comercio",
    sinonimos: ["feria comercial", "feria empresarial", "feria de negocios", "feria de emprendedores", "feria industrial", "feria de muestras", "trade show", "trade fair", "tradeshow", "stand de feria", "stand de exhibición", "stand de exposición", "stand comercial", "stand de ventas", "stand promocional", "stand de marca", "stand corporativo", "stand de globos", "stand con globos", "booth", "exhibition booth", "trade show booth", "booth decoration", "exposición comercial", "exhibición comercial", "exhibitor", "expositor", "expositores", "expo bodas", "expo novias", "expo quinceañeras", "expo xv", "bridal expo", "wedding expo", "wedding fair", "feria de bodas", "feria de novias", "feria de quinceañeras", "feria del libro", "book fair", "feria artesanal", "feria de artesanías", "craft fair", "feria gastronómica", "food fair", "feria del hogar", "feria de empleo", "job fair", "feria universitaria", "feria escolar", "school fair", "feria de ciencias", "science fair", "feria de salud", "health fair", "feria de turismo", "auto show", "feria de moda", "feria de diseño", "art fair"],
    ambiguos: ["feria", "ferias", "stand", "stands", "fair", "expo", "exposición", "exhibición"],
  },
  {
    id: "vitrina-escaparate", nombre: "Vitrina / escaparate", en: "Shop window display", grupo: "empresa-y-comercio",
    sinonimos: ["vitrina", "vitrinas", "escaparate", "escaparates", "vidriera", "vidrieras", "aparador", "aparadores", "window display", "window displays", "shop window", "store window", "window dressing", "visual merchandising", "vitrinismo", "decoración de vitrina", "decoración de vitrinas", "decoración de escaparate", "decoración de vidriera", "montaje de vitrina", "montaje de escaparate", "diseño de vitrina", "diseño de escaparate", "vitrina navideña", "escaparate navideño", "vitrina de temporada", "vitrina comercial", "vitrina de tienda", "vitrina con globos", "vitrina de globos", "escaparate con globos", "vidriera con globos", "balloon window", "balloon window display", "retail display", "retail decoration", "decoración retail", "decoración comercial", "decoración de tienda", "decoración de local", "ambientación de tienda", "ambientación comercial", "ambientación de local", "ambientación retail", "punto de venta", "pop display", "point of sale", "display de tienda", "display comercial", "display promocional", "pop up store", "tienda efímera", "tienda temporal", "pop up shop"],
    ambiguos: ["exhibidor", "display", "mostrador", "pop up", "popup", "góndola", "kiosco"],
  },
  {
    id: "temporada-ventas", nombre: "Temporada de ventas", en: "Sales season", grupo: "empresa-y-comercio",
    sinonimos: ["temporada de ventas", "temporada alta", "temporada de descuentos", "temporada de ofertas", "temporada de rebajas", "temporada de promociones", "temporada comercial", "venta de temporada", "ventas de temporada", "gran venta", "venta especial", "venta anual", "venta de aniversario", "venta de fin de año", "venta de liquidación", "venta flash", "flash sale", "season sale", "seasonal sale", "sales season", "sales event", "campaña de ventas", "campaña comercial", "campaña promocional", "campaña de temporada", "rebajas", "rebajas de verano", "rebajas de invierno", "summer sale", "winter sale", "spring sale", "fall sale", "end of season sale", "clearance", "clearance sale", "liquidación", "liquidación total", "outlet", "fin de temporada", "oferta de temporada", "ofertas de temporada", "ofertas especiales", "special offers", "super ofertas", "mega ofertas", "mega sale", "mega venta", "super sale", "big sale", "gran remate", "gran liquidación", "semana de ofertas", "oferta de la semana", "oferta del día", "deal of the day", "día de ofertas", "día de descuentos", "día sin iva", "tax free day", "fin de semana sin iva"],
    ambiguos: ["sale", "oferta", "ofertas", "descuento", "descuentos", "promoción", "promociones", "rebaja", "discount", "discounts", "deal", "deals", "venta", "ventas"],
  },
  {
    id: "conferencia", nombre: "Conferencia / congreso", en: "Conference / congress", grupo: "empresa-y-comercio",
    sinonimos: ["conferencia", "conferencias", "congreso", "congresos", "simposio", "simposios", "seminario", "seminarios", "conference", "conferences", "congress", "symposium", "seminar", "summit", "cumbre", "convención", "convenciones", "convention", "keynote", "keynote speaker", "ponente", "ponentes", "conferencista", "conferencistas", "speaker", "speakers", "panelista", "panelistas", "networking", "networking event", "evento de networking", "encuentro empresarial", "encuentro de negocios", "encuentro profesional", "encuentro de emprendedores", "leadership summit", "women's conference", "mujeres líderes", "mujeres emprendedoras", "startup event", "startup summit", "demo day", "pitch day", "pitch night", "hackathon", "hackatón", "devfest", "meetup", "tech conference", "tech summit", "developer conference", "foro empresarial", "foro de negocios", "foro económico", "business forum", "mesa redonda", "round table", "roundtable", "panel de expertos", "expert panel"],
    ambiguos: ["charla", "foro", "panel", "jornada", "workshop", "forum", "capacitación", "training"],
  },
  {
    id: "activacion-marca", nombre: "Activación de marca", en: "Brand activation", grupo: "empresa-y-comercio",
    sinonimos: ["activación de marca", "activaciones de marca", "activaciones", "brand activation", "brand activations", "activation", "experiencia de marca", "experiencias de marca", "brand experience", "experiential marketing", "marketing experiencial", "evento de marca", "eventos de marca", "brand event", "evento promocional", "eventos promocionales", "promotional event", "promoción en punto de venta", "in-store promotion", "in-store event", "evento en tienda", "photo booth de marca", "branded backdrop", "step and repeat", "step & repeat", "telón de marca"],
    ambiguos: ["activación", "backdrop", "photocall", "photo booth", "photobooth", "fotozona", "photo wall", "selfie wall", "instagrammable"],
  },
];
