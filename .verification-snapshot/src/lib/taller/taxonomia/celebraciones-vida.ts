import type { Celebracion } from "./tipos";

/** Celebraciones de la vida y la familia, y fiestas sin fecha fija. */
export const CELEBRACIONES_VIDA: readonly Celebracion[] = [
  {
    id: "cumpleanos", nombre: "Cumpleaños", en: "Birthday", grupo: "vida-y-familia",
    sinonimos: ["cumpleaños", "cumpleaño", "cumpleanios", "cumpleaños feliz", "feliz cumpleaños", "cumple años", "fiesta de cumpleaños", "happy birthday", "birthday", "birthday party", "bday", "b-day", "onomástico", "cumpleañero", "cumpleañera", "festejado", "festejada", "cunpleaños", "cumpleaños numero"],
    ambiguos: ["cumple", "cumples"],
  },
  {
    id: "primer-cumpleanos", nombre: "Primer cumpleaños", en: "First birthday", grupo: "vida-y-familia",
    sinonimos: ["primer cumpleaños", "1er cumpleaños", "1er añito", "primer añito", "primer año", "mi primer año", "1 año", "un añito", "first birthday", "1st birthday", "smash cake", "one year old", "cumpleaños número uno", "mi primer añito"],
    ambiguos: ["un año"],
  },
  {
    id: "cumpleanos-infantil", nombre: "Cumpleaños infantil", en: "Kids' birthday", grupo: "vida-y-familia",
    sinonimos: ["cumpleaños infantil", "cumpleaños de niño", "cumpleaños de niña", "cumpleaños de niños", "cumple infantil", "fiesta de cumpleaños infantil", "kids birthday", "kid's birthday", "children's birthday", "birthday for kids", "cumpleaños de mi hijo", "cumpleaños de mi hija"],
  },
  {
    id: "cumpleanos-adulto", nombre: "Cumpleaños adulto", en: "Adult birthday", grupo: "vida-y-familia",
    sinonimos: ["cumpleaños adulto", "cumpleaños de adulto", "cumpleaños de adultos", "cumpleaños de hombre", "cumpleaños de mujer", "cumpleaños de mi esposo", "cumpleaños de mi esposa", "cumpleaños de mamá", "cumpleaños de papá", "adult birthday", "grown up birthday"],
  },
  {
    id: "cumpleanos-18", nombre: "Mayoría de edad (18 años)", en: "18th birthday", grupo: "vida-y-familia",
    sinonimos: ["18 años", "cumpleaños 18", "cumpleaños 18 años", "mayoría de edad", "mayor de edad", "dieciocho años", "18th birthday", "eighteenth birthday", "turning 18", "ya soy mayor de edad"],
  },
  {
    id: "cumpleanos-decada", nombre: "Cumpleaños de década (30, 40, 50, 60 o más)", en: "Milestone birthday (30, 40, 50, 60+)", grupo: "vida-y-familia",
    sinonimos: ["30 años", "40 años", "50 años", "60 años", "70 años", "80 años", "90 años", "cumpleaños 30", "cumpleaños 40", "cumpleaños 50", "cumpleaños 60", "cumpleaños 70", "treinta años", "cuarenta años", "cincuenta años", "sesenta años", "30th birthday", "40th birthday", "50th birthday", "60th birthday", "70th birthday", "milestone birthday", "dirty thirty", "flirty thirty", "fabulous forty", "fabulous 40", "over the hill", "medio siglo", "cuarentona", "cincuentona", "treintañera", "cuarentón"],
  },
  {
    id: "sweet-sixteen", nombre: "Sweet sixteen (16 años)", en: "Sweet sixteen", grupo: "vida-y-familia",
    sinonimos: ["sweet sixteen", "sweet 16", "sweet sixteen party", "dulces 16", "dulces dieciséis", "16 años", "cumpleaños 16", "sweet seventeen", "sixteenth birthday", "16th birthday"],
  },
  {
    id: "quince-anos", nombre: "Quince años (quinceañera)", en: "Quinceañera (15th birthday)", grupo: "vida-y-familia",
    sinonimos: ["quince años", "quince", "15 años", "15 años cumpleaños", "xv años", "xv", "mis xv", "mis xv años", "mis 15", "mis 15 años", "mis quince", "mis quince años", "quinceañera", "quinceañeras", "quinceañero", "quinceañera party", "quinceneara", "quinseañera", "quinse años", "fiesta de quince", "fiesta de 15", "fiesta de xv", "xv años party", "quince años party", "quinceañeras party", "15th birthday", "fifteenth birthday"],
  },
  {
    id: "baby-shower", nombre: "Baby shower", en: "Baby shower", grupo: "vida-y-familia",
    sinonimos: ["baby shower", "babyshower", "baby showers", "baby show", "bebé shower", "shower de bebé", "ducha de bebé", "fiesta de baby shower", "fiesta para el bebé", "bebé en camino", "esperando bebé", "esperando un bebé", "oh baby", "it's a boy", "it's a girl", "its a boy", "its a girl", "mommy to be", "mom to be", "mamá en espera", "bienvenido baby", "welcome baby shower", "gender neutral baby shower"],
    ambiguos: ["es una niña", "es un niño", "dulce espera"],
  },
  {
    id: "revelacion-genero", nombre: "Revelación de género", en: "Gender reveal", grupo: "vida-y-familia",
    sinonimos: ["revelación de género", "revelación de sexo", "revelacion del sexo", "revelacion del genero", "gender reveal", "gender reveal party", "fiesta de revelación", "niño o niña", "nene o nena", "adivina niño o niña", "boy or girl", "team boy", "team girl", "he or she", "pink or blue", "rosa o azul", "he o she", "gender revel", "revelación"],
  },
  {
    id: "bienvenida-bebe", nombre: "Bienvenida de bebé / nacimiento", en: "Newborn welcome", grupo: "vida-y-familia",
    sinonimos: ["bienvenida bebé", "bienvenido bebé", "bienvenida de bebé", "bienvenida del bebé", "bienvenida a casa del bebé", "recién nacido", "recién nacida", "welcome baby", "newborn", "new baby", "ya nació", "llegó el bebé", "cigüeña", "stork", "welcome home baby", "nuevo bebé", "nuevo integrante", "bienvenido al mundo", "welcome to the world"],
    ambiguos: ["nacimiento"],
  },
  {
    id: "medio-ano", nombre: "Seis meses (medio año)", en: "Half birthday (6 months)", grupo: "vida-y-familia",
    sinonimos: ["seis meses", "6 meses", "medio año", "medio cumpleaños", "half birthday", "half year", "6 months", "six months", "6 months old", "mesversario", "mesversarios", "6 mesitos", "seis mesitos", "mis 6 meses"],
  },
  {
    id: "bautizo", nombre: "Bautizo", en: "Baptism / christening", grupo: "vida-y-familia",
    sinonimos: ["bautizo", "bautizos", "bautismo", "bautizar", "bautizado", "bautizada", "baptism", "christening", "baptismo", "bautiso", "fiesta de bautizo", "mi bautizo", "naming ceremony", "baptism party"],
  },
  {
    id: "primera-comunion", nombre: "Primera comunión", en: "First communion", grupo: "vida-y-familia",
    sinonimos: ["primera comunión", "1ra comunión", "1era comunión", "1ª comunión", "comunión", "comuniones", "first communion", "holy communion", "my first communion", "mi primera comunión", "fiesta de comunión", "fiesta de primera comunión", "primer comunion", "comunion party"],
  },
  {
    id: "confirmacion", nombre: "Confirmación", en: "Confirmation", grupo: "vida-y-familia",
    sinonimos: ["confirmación", "sacramento de la confirmación", "confirmandos", "confirmation", "fiesta de confirmación", "mi confirmación", "confirmation party", "crismación"],
  },
  {
    id: "bar-bat-mitzvah", nombre: "Bar / bat mitzvá", en: "Bar / bat mitzvah", grupo: "vida-y-familia",
    sinonimos: ["bar mitzvah", "bat mitzvah", "bar mitzvá", "bat mitzvá", "mitzvah", "barmitzvah", "batmitzvah", "bar/bat mitzvah", "bar mitzvah party"],
  },
  {
    id: "graduacion", nombre: "Graduación", en: "Graduation", grupo: "vida-y-familia",
    sinonimos: ["graduación", "graduaciones", "grado", "grados", "graduado", "graduada", "graduados", "graduandos", "graduation", "grad", "grad party", "graduation party", "class of", "ceremonia de grado", "fiesta de grado", "fiesta de graduación", "graduasion", "graducion", "toga", "birrete", "bachiller", "bachilleres", "bachillerato", "promoción de bachilleres", "felicidades graduado", "congrats grad", "me gradué", "ya me gradué", "graduación universitaria", "graduación de colegio", "graduación de secundaria", "graduación de bachillerato", "egresados", "egresado", "egresada", "egreso", "high school graduation", "college graduation", "university graduation", "senior night"],
    ambiguos: ["diploma", "class", "universidad", "título profesional"],
  },
  {
    id: "graduacion-preescolar", nombre: "Graduación de preescolar", en: "Preschool / kindergarten graduation", grupo: "vida-y-familia",
    sinonimos: ["graduación de preescolar", "graduación preescolar", "graduación de kínder", "graduación de jardín", "graduación de jardín infantil", "graduacion de prekinder", "graduación de pre-kinder", "graduación de transición", "graduacion de parvulos", "kindergarten graduation", "preschool graduation", "pre-k graduation", "prekindergarten graduation", "fiesta de graduación preescolar", "adiós jardín", "mi graduación de kínder"],
  },
  {
    id: "despedida-soltera", nombre: "Despedida de soltera", en: "Bachelorette party", grupo: "vida-y-familia",
    sinonimos: ["despedida de soltera", "despedida soltera", "despedida de solteras", "despedida de la novia", "bachelorette", "bachelorette party", "hen party", "hen night", "hens party", "team bride", "bride to be", "future mrs", "last fling before the ring", "last fling", "la novia se despide", "bride squad", "bride tribe", "despedida de soltera party"],
  },
  {
    id: "despedida-soltero", nombre: "Despedida de soltero", en: "Bachelor party", grupo: "vida-y-familia",
    sinonimos: ["despedida de soltero", "despedida soltero", "despedida de solteros", "bachelor party", "stag party", "stag night", "stag do", "última noche de soltero", "el novio se despide", "groom to be", "boys night out"],
  },
  {
    id: "bridal-shower", nombre: "Bridal shower / lluvia de regalos", en: "Bridal shower", grupo: "vida-y-familia",
    sinonimos: ["bridal shower", "bridal shower party", "wedding shower", "lluvia de sobres", "lluvia de regalos", "lluvia de regalos de boda", "té de cocina", "kitchen tea", "kitchen shower", "shower de novia", "shower nupcial", "bridal brunch", "brunch de novia", "miss to mrs", "from miss to mrs"],
  },
  {
    id: "compromiso", nombre: "Compromiso / pedida de mano", en: "Engagement", grupo: "vida-y-familia",
    sinonimos: ["compromiso", "compromiso de matrimonio", "pedida de mano", "pedida", "pedimento", "pedimiento", "engagement", "engagement party", "engaged", "she said yes", "ella dijo que sí", "will you marry me", "marry me", "cásate conmigo", "propuesta de matrimonio", "anillo de compromiso", "fiesta de compromiso", "we're engaged", "were engaged", "nos comprometimos", "se van a casar", "future husband", "future wife", "fiancé", "fiancée", "prometidos", "prometida", "prometido"],
    ambiguos: ["propuesta"],
  },
  {
    id: "boda", nombre: "Boda", en: "Wedding", grupo: "vida-y-familia",
    sinonimos: ["boda", "bodas", "matrimonio", "casamiento", "wedding", "wedding day", "wedding party", "wedding reception", "recepción de boda", "nupcias", "nupcial", "enlace matrimonial", "los novios", "novios", "mr and mrs", "mr & mrs", "just married", "recién casados", "recién casado", "bride and groom", "boda civil", "boda religiosa", "boda por la iglesia", "se casan", "nos casamos", "me caso", "sí acepto", "i do", "bodas y eventos", "matrimonio civil", "matrimonial", "newlyweds", "bodorrio", "vestido de novia", "fiesta de boda", "love is sweet", "mi boda", "nuestra boda", "wedding backdrop", "pared de boda", "photocall de boda", "boho wedding"],
    ambiguos: ["novia", "novio", "bride", "groom", "altar", "ceremonia", "ceremony", "recepción", "reception", "nupcial"],
  },
  {
    id: "aniversario", nombre: "Aniversario de pareja", en: "Wedding / couple anniversary", grupo: "vida-y-familia",
    sinonimos: ["aniversario", "aniversarios", "aniversario de bodas", "aniversario de matrimonio", "aniversario de novios", "aniversario de pareja", "aniversario de casados", "anniversary", "wedding anniversary", "happy anniversary", "feliz aniversario", "primer aniversario", "años juntos", "years together", "años de casados", "años de matrimonio", "años de novios", "años de noviazgo", "mesversario de novios", "our anniversary", "nuestro aniversario", "aniversary", "aniversario de amor"],
  },
  {
    id: "bodas-plata-oro", nombre: "Bodas de plata / de oro", en: "Silver / golden anniversary", grupo: "vida-y-familia",
    sinonimos: ["bodas de plata", "bodas de oro", "bodas de perla", "bodas de diamante", "bodas de rubí", "bodas de cristal", "25 años de casados", "50 años de casados", "25 años de matrimonio", "50 años de matrimonio", "silver anniversary", "golden anniversary", "25th anniversary", "50th anniversary", "ruby anniversary", "pearl anniversary", "bodas de plata y oro", "renovación de votos", "vow renewal", "renewal of vows"],
  },
  {
    id: "jubilacion", nombre: "Jubilación / retiro laboral", en: "Retirement", grupo: "vida-y-familia",
    sinonimos: ["jubilación", "jubilado", "jubilada", "jubilados", "jubilarse", "se jubila", "me jubilo", "retirement", "retirement party", "happy retirement", "pensionado", "pensionada", "pensión", "fiesta de jubilación", "retiro laboral", "adiós a la oficina", "feliz jubilación", "retired", "officially retired"],
    ambiguos: ["retiro"],
  },
  {
    id: "bienvenida-regreso", nombre: "Bienvenida / regreso a casa", en: "Welcome home", grupo: "vida-y-familia",
    sinonimos: ["welcome home", "welcome back", "bienvenido a casa", "bienvenida a casa", "bienvenidos a casa", "regreso a casa", "regreso a casa de", "volviste", "de vuelta a casa", "bienvenida de regreso", "bienvenido de regreso", "homecoming", "te esperábamos", "bienvenida al hogar", "regreso de viaje", "welcome home party", "bienvenida militar", "regreso a casa del hospital", "welcome home soldier"],
    ambiguos: ["bienvenida", "bienvenido", "bienvenidos", "welcome"],
  },
  {
    id: "despedida", nombre: "Despedida", en: "Farewell", grupo: "vida-y-familia",
    sinonimos: ["despedida", "despedidas", "farewell", "farewell party", "goodbye party", "bon voyage", "buen viaje", "fiesta de despedida", "despedida de trabajo", "despedida laboral", "despedida de colegio", "going away", "going away party", "despedida de viaje", "despedida de año", "despedida del jefe", "se va", "nos dejas", "last day", "last day party", "good luck", "buena suerte"],
    ambiguos: ["adiós"],
  },
  {
    id: "recuperacion", nombre: "Recuperación / ¡ponte bien!", en: "Get well soon", grupo: "vida-y-familia",
    sinonimos: ["ponte bien", "ponte bien pronto", "get well", "get well soon", "recuperación", "pronta recuperación", "mejórate", "que te mejores", "feliz recuperación", "alta médica", "recovery", "feel better", "feel better soon", "te extrañamos", "mejórate pronto", "after surgery", "después de la cirugía", "recuperándose", "fighter", "valiente", "sé fuerte"],
    ambiguos: ["salud", "hospital"],
  },
  {
    id: "nuevo-hogar", nombre: "Casa nueva / nuevo hogar", en: "Housewarming", grupo: "vida-y-familia",
    sinonimos: ["housewarming", "house warming", "casa nueva", "nuevo hogar", "inauguración de casa", "estreno de casa", "estreno de apartamento", "mudanza", "nueva casa", "new home", "new house", "home sweet home", "hogar dulce hogar", "bienvenidos a mi nuevo hogar", "inauguración del apartamento", "inauguracion del departamento", "feliz nuevo hogar", "new place"],
  },
  {
    id: "felicitaciones-logro", nombre: "Felicitaciones / logro", en: "Congratulations", grupo: "vida-y-familia",
    sinonimos: ["felicitaciones", "felicidades por tu logro", "congratulations", "congrats", "congratulation", "lo lograste", "you did it", "nuevo trabajo", "new job", "ascenso", "promotion", "celebración de logro", "te lo mereces", "orgullosos de ti", "proud of you", "so proud", "logro desbloqueado", "i did it", "lo logré", "felicitaciones por tu ascenso"],
    ambiguos: ["logro", "éxito", "felicidades"],
  },
  {
    id: "fiesta-infantil", nombre: "Fiesta infantil", en: "Kids' party", grupo: "fiestas-y-otros",
    sinonimos: ["fiesta infantil", "fiestas infantiles", "infantil", "infantiles", "fiesta para niños", "fiesta de niños", "fiesta de niño", "fiesta de niña", "fiesta para niñas", "kids party", "children's party", "childrens party", "party for kids", "kid's party", "fiesta de los niños", "cumpleaños y fiesta infantil", "evento infantil", "evento para niños", "celebración infantil"],
    ambiguos: ["niños", "niñas", "kids", "children", "infancia"],
  },
  {
    id: "fiesta-sorpresa", nombre: "Fiesta sorpresa", en: "Surprise party", grupo: "fiestas-y-otros",
    sinonimos: ["fiesta sorpresa", "fiesta de sorpresa", "sorpresa de cumpleaños", "surprise party", "surprise birthday", "surprise birthday party", "sorpresa para", "te hicimos una sorpresa", "fiesta de sorpresa para", "sorprendiendo a", "fiestas sorpresa"],
    ambiguos: ["sorpresa", "surprise"],
  },
  {
    id: "pijamada", nombre: "Pijamada", en: "Sleepover", grupo: "fiestas-y-otros",
    sinonimos: ["pijamada", "pijamadas", "fiesta de pijamas", "pijama party", "pajama party", "pyjama party", "slumber party", "sleepover", "sleep over", "pijamada de niñas", "pijamada de cumpleaños", "noche de pijamas", "pijamada de amigas", "fiesta pijama", "piyamada", "piyama party", "pijamada tipi", "pijamada con tipi", "campamento en casa", "pijamada glamping", "glamping party"],
  },
  {
    id: "noche-de-chicas", nombre: "Noche de chicas", en: "Girls' night", grupo: "fiestas-y-otros",
    sinonimos: ["noche de chicas", "noche de amigas", "noche de chicas party", "girls night", "girls night out", "ladies night", "spa party", "spa day", "día de spa", "fiesta de spa", "tarde de chicas", "salida de chicas", "reunión de amigas", "juntada de amigas", "girls trip", "wine night", "noche de vinos"],
  },
  {
    id: "fiesta-verano", nombre: "Fiesta de piscina / verano", en: "Pool / summer party", grupo: "fiestas-y-otros",
    sinonimos: ["fiesta de piscina", "fiesta en la piscina", "pool party", "fiesta de verano", "fiesta de playa", "beach party", "summer party", "fiesta en la playa", "fiesta acuática", "fiesta de agua", "splash party", "water party", "verano", "summer", "summer vibes", "summer fun", "hello summer", "hola verano", "last splash", "big splash", "pool day", "día de piscina", "bbq party", "barbacoa", "asado", "fiesta de la alberca", "alberca"],
    ambiguos: ["piscina", "playa", "beach", "pool"],
  },
  {
    id: "fiesta-jardin", nombre: "Fiesta de jardín", en: "Garden party", grupo: "fiestas-y-otros",
    sinonimos: ["fiesta de jardín", "garden party", "fiesta en el jardín", "fiesta al aire libre", "outdoor party", "fiesta campestre", "tea party", "té de las cinco", "fiesta de té", "picnic", "fiesta de picnic", "fiesta en el patio", "backyard party", "backyard bash", "boda en el jardín", "fiesta en la terraza", "fiesta en finca", "fiesta de finca", "fiesta de campo", "fiesta de primavera"],
    ambiguos: ["jardín", "garden", "aire libre"],
  },
  {
    id: "fiesta-tematica", nombre: "Fiesta temática", en: "Themed party", grupo: "fiestas-y-otros",
    sinonimos: ["fiesta temática", "fiestas temáticas", "themed party", "theme party", "fiesta con temática", "party theme", "tema de fiesta", "tema de la fiesta", "ambientación temática", "decoración temática", "fiesta por temas", "fiesta de tema", "fiesta con tema"],
  },
  {
    id: "fiesta-neon", nombre: "Fiesta neón / glow", en: "Neon / glow party", grupo: "fiestas-y-otros",
    sinonimos: ["fiesta neón", "neon party", "neon night", "glow party", "glow in the dark party", "fiesta glow", "fiesta fluorescente", "fiesta flúor", "blacklight party", "black light party", "fiesta luz negra", "fiesta de luz negra", "rave party", "fiesta rave", "glow night", "fiesta brillante en la oscuridad", "fiesta que brilla en la oscuridad", "uv party", "fiesta uv", "fiesta de colores neón"],
  },
  {
    id: "fiesta-disfraces", nombre: "Fiesta de disfraces", en: "Costume party", grupo: "fiestas-y-otros",
    sinonimos: ["fiesta de disfraces", "fiesta disfraces", "costume party", "fancy dress party", "fancy dress", "mascarada", "masquerade", "masquerade ball", "baile de máscaras", "fiesta de máscaras", "fiesta de antifaz", "baile de disfraces", "concurso de disfraces", "costume contest", "dress up party", "fiesta de personajes", "fiesta de cosplay", "cosplay party", "disfrázate"],
    ambiguos: ["disfraces", "disfraz"],
  },
  {
    id: "brunch", nombre: "Brunch", en: "Brunch", grupo: "fiestas-y-otros",
    sinonimos: ["brunch", "brunches", "baby brunch", "brunch de bebé", "brunch familiar", "brunch de amigas", "mimosa bar", "bubbly bar", "bar de mimosas", "almuerzo especial", "desayuno especial", "desayuno sorpresa", "desayuno de fiesta", "brunch party", "brunch de cumpleaños", "brunch de mamá", "brunch de graduación", "bottomless brunch", "champagne brunch", "tea time", "hora del té"],
  },
  {
    id: "reunion-familiar", nombre: "Reunión familiar", en: "Family reunion", grupo: "fiestas-y-otros",
    sinonimos: ["reunión familiar", "reuniones familiares", "family reunion", "family gathering", "encuentro familiar", "día de la familia", "family day", "almuerzo familiar", "cena familiar", "cena de familia", "familia unida", "mi familia", "nuestra familia", "yo amo a mi familia", "family party", "fiesta familiar", "reunión de familia", "family time", "family love", "family is everything", "familia es todo", "gran familia", "toda la familia"],
  },
  {
    id: "cena-romantica", nombre: "Cena romántica", en: "Romantic dinner", grupo: "fiestas-y-otros",
    sinonimos: ["cena romántica", "cena para dos", "romantic dinner", "date night", "candlelight dinner", "cena a la luz de las velas", "cita romántica", "sorpresa romántica", "sorpresa de amor", "detalle romántico", "decoración romántica", "fiesta romántica", "noche romántica", "romantic surprise", "romantic night", "romantic setup", "cita sorpresa", "cena sorpresa", "picnic romántico", "propuesta romántica", "proposal setup"],
    ambiguos: ["romántica", "romántico", "romantic"],
  },
];
