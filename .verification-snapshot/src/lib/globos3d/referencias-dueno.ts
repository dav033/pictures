import type { ColorLeido, LecturaFoto, MezclaLeida, PiezaLeida } from "./lectura-foto";

/**
 * **Referencias del dueño** (lote 1, 2026-10-08): 13 fotos de Pinterest que el dueño pasó para meter al taller sus
 * decoraciones (guirnaldas orgánicas de toda silueta, columnas de forma libre con uvas, arcos rojos clásicos con orbes,
 * fondos con panel redondo y media luna…). Cada una LEÍDA A MANO con el mismo formato que lee la IA (`lectura-foto.ts`)
 * y armada por `compilar-lectura.ts`: son el banco con que se mide la lectura de Gemini y entran a la biblioteca.
 *
 * Las fotos NO están en el repo (viven en `pictures-workspace/referencias-usuario/lote-01/`, con el número de cada
 * una); aquí solo van las medidas y colores leídos. `fidelidad` (1–5) y `nota` son honestas y se revisan contra la foto.
 */
export type ReferenciaDueno = { id: string; numero: number; nombre: string; ocasiones: string[]; lectura: LecturaFoto; fidelidad: 1 | 2 | 3 | 4 | 5; nota: string };

const c = (nombre: string, hex: string, peso: number, acabado: ColorLeido["acabado"] = "mate"): ColorLeido => ({ nombre, hex, peso, acabado });
const p = (x: number, y: number, grosor: number) => ({ x, y, grosor });
const otro = (descripcion: string): PiezaLeida => ({ tipo: "otro", descripcion });
/** La mezcla de tamaños medida en la foto: % de grandes, medianos y chicos, y el diámetro de cada uno en fracción del alto de la imagen. */
const m = (grandes: number, medianos: number, chicos: number, diametroGrande: number, diametroMediano: number, diametroChico: number): MezclaLeida => ({ grandes, medianos, chicos, diametroGrande, diametroMediano, diametroChico });

const DORADO = (peso: number) => c("dorado", "#c9a24e", peso, "cromado");

export const REFERENCIAS_DUENO: readonly ReferenciaDueno[] = [
  {
    id: "referencia:dino-jungla-mesa", numero: 1, nombre: "Mesa de dinosaurios con guirnalda verde y dorada", ocasiones: ["cumpleanos", "fiesta-infantil"], fidelidad: 3,
    nota: "Guirnalda de arriba, columna cortada a la derecha, cortina con luces, letrero y mesa con mantel; los aros con helechos, los troncos, el musgo, la torta y los dinosaurios no son del taller.",
    lectura: {
      resumen: "Guirnalda orgánica verde oscuro, dorada, marfil y de confeti sobre una cortina con luces y una mesa de dinosaurios.", aspecto: 1,
      escala: { altoImagenCm: 250, referencia: "mesa de 75 cm" }, pisoY: 0.98, sala: { pared: "#f1efeb", piso: "#b9b2a8" },
      piezas: [
        { tipo: "guirnalda_organica", puntos: [p(0.06, 0.13, 0.13), p(0.25, 0.09, 0.15), p(0.45, 0.08, 0.15), p(0.65, 0.09, 0.15), p(0.83, 0.11, 0.13)], tamanos: { "R-18": 20, "R-12": 60, "R-9": 15, "R-5": 5 }, racimos: 0.4,
          colores: [c("verde esmeralda", "#1f4d3a", 40), DORADO(25), c("marfil", "#efe8c8", 20), c("cristal con confeti dorado", "#e8e2d0", 15, "confeti")] },
        { tipo: "columna_organica", forma: "recta", x: 0.97, yBase: 0.98, yArriba: 0.45, ancho: 0.16, grosor: 0.16, tamanos: { "R-18": 30, "R-12": 55, "R-9": 15 }, racimos: 0.4,
          colores: [c("verde esmeralda", "#1f4d3a", 40), DORADO(30), c("marfil", "#efe8c8", 30)], nota: "cortada por el borde de la foto" },
        { tipo: "fondo", id: "cortina_luces", x: 0.5, yBase: 0.98, ancho: 0.86, alto: 0.88, colores: [c("blanco", "#f4f2ee", 100)] },
        { tipo: "fondo", id: "letrero", x: 0.5, yBase: 0.42, ancho: 0.22, alto: 0.1, texto: "Asher", colorTexto: "#2f4a35", colores: [c("madera clara", "#e8e2d4", 100)] },
        { tipo: "fondo", id: "mesa_mantel", x: 0.52, yBase: 0.98, ancho: 0.9, alto: 0.3, colores: [c("blanco", "#f7f6f2", 100)] },
        otro("aros con helechos y dinosaurios dorados"), otro("troncos, musgo, torta y dinosaurios dorados sobre la mesa"),
      ],
    },
  },
  {
    id: "referencia:happy-birthday-azul-dorado-redondo", numero: 2, nombre: "Medio arco azul marino y dorado con panel redondo y media luna", ocasiones: ["cumpleanos"], fidelidad: 3,
    nota: "Medio arco que nace del piso a la izquierda y cruza arriba, panel redondo con aro dorado, media luna azul, pedestales, ramo de helio y globos en el piso; el letrero de luz, la torta, la jaula y el florero no son del taller.",
    lectura: {
      resumen: "Medio arco orgánico azul marino, dorado, crema y confeti dorado sobre un panel redondo, con ramo de helio a la derecha.", aspecto: 0.667,
      escala: { altoImagenCm: 300, referencia: "pedestales de 75 cm" }, pisoY: 0.86, sala: { pared: "#f2e3cf", piso: "#e6e1da" },
      piezas: [
        { tipo: "guirnalda_organica", puntos: [p(0.11, 0.83, 0.23), p(0.08, 0.62, 0.22), p(0.08, 0.4, 0.2), p(0.14, 0.2, 0.18), p(0.3, 0.1, 0.15), p(0.5, 0.08, 0.12), p(0.68, 0.12, 0.09)], tamanos: {}, mezcla: m(30, 40, 30, 0.17, 0.095, 0.055), racimos: 0.6,
          colores: [c("azul marino", "#1d2b5c", 45), c("crema", "#ecdcc0", 25), DORADO(20), c("cristal con confeti dorado", "#e8dcc0", 10, "confeti")] },
        { tipo: "fondo", id: "media_luna", x: 0.7, yBase: 0.8, ancho: 0.14, alto: 0.57, colores: [c("azul marino", "#1c2f5e", 100)] },
        { tipo: "fondo", id: "panel_redondo", x: 0.48, yBase: 0.54, ancho: 0.3, alto: 0.3, colores: [c("crema", "#f3e3c3", 80), c("dorado", "#d8b25a", 20)] },
        { tipo: "fondo", id: "pedestales", x: 0.56, yBase: 0.84, ancho: 0.44, alto: 0.26, colores: [c("azul marino", "#1f3366", 34), c("blanco", "#f4f1ea", 33), c("dorado", "#c9a14a", 33, "cromado")] },
        { tipo: "ramo_helio", x: 0.86, yBase: 0.62, yArriba: 0.12, cantidad: 9, colores: [c("azul marino", "#1d2b5c", 40), DORADO(30), c("crema", "#ecdcc0", 20), c("cristal con confeti dorado", "#e8dcc0", 10, "confeti")] },
        { tipo: "globo", x: 0.53, y: 0.8, diametro: 0.11, en: "piso", colores: [DORADO(100)] },
        { tipo: "globo", x: 0.76, y: 0.83, diametro: 0.1, en: "piso", colores: [c("azul marino", "#1d2b5c", 100)] },
        { tipo: "globo", x: 0.88, y: 0.84, diametro: 0.1, en: "piso", colores: [c("azul marino", "#1d2b5c", 100)] },
        { tipo: "fondo", id: "tapete_redondo", x: 0.5, yBase: 0.92, ancho: 0.57, alto: 0.1, colores: [c("beige", "#d8cfc4", 100)] },
        otro("letrero de luz «Happy Birthday»"), otro("torta azul y dorada, bandejas, jaula con vela y florero con ramas doradas"),
      ],
    },
  },
  {
    id: "referencia:happy-birthday-lentejuelas-arco-asimetrico", numero: 3, nombre: "Arco asimétrico azul marino y dorado con flores sobre lentejuelas", ocasiones: ["cumpleanos"], fidelidad: 3,
    nota: "Arco asimétrico (racimo arriba a la izquierda, cruza y baja por la derecha hasta el piso) con rosas blancas y hojas secas doradas, pared de lentejuelas, pedestal azul y tapete; las rosas azules van blancas (no hay rosa de tela azul) y el letrero de neón no es del taller.",
    lectura: {
      resumen: "Arco orgánico asimétrico azul marino, dorado, champaña y confeti con flores y hojas doradas sobre una pared de lentejuelas.", aspecto: 0.8,
      escala: { altoImagenCm: 330, referencia: "pedestal de 70 cm" }, pisoY: 0.9, sala: { pared: "#e9e2d8", piso: "#e8e4df" },
      piezas: [
        { tipo: "fondo", id: "lentejuelas", x: 0.44, yBase: 0.82, ancho: 0.41, alto: 0.61, colores: [c("dorado", "#d4af5a", 100)] },
        { tipo: "guirnalda_organica", puntos: [p(0.2, 0.12, 0.15), p(0.38, 0.1, 0.12), p(0.6, 0.11, 0.12), p(0.78, 0.17, 0.14), p(0.85, 0.35, 0.16), p(0.84, 0.6, 0.18), p(0.8, 0.88, 0.2)], tamanos: { "R-24": 12, "R-18": 25, "R-12": 40, "R-9": 13, "R-5": 10 }, racimos: 0.55,
          follaje: ["rosa blanca", "hoja_seca dorada"],
          colores: [c("azul marino", "#1b2550", 35), c("champaña", "#e8d6b8", 30), DORADO(25), c("cristal con confeti dorado", "#e6d8b8", 10, "confeti")] },
        { tipo: "fondo", id: "pedestales", x: 0.35, yBase: 0.87, ancho: 0.16, alto: 0.21, colores: [c("azul marino", "#1c2652", 100)] },
        { tipo: "fondo", id: "tapete_redondo", x: 0.45, yBase: 0.97, ancho: 0.4, alto: 0.06, colores: [c("blanco", "#f2efe8", 100)] },
        otro("letrero de neón «Happy Birthday»"), otro("florero dorado con flores azules y blancas sobre un pie dorado"), otro("cuadro con corazón y vela"),
      ],
    },
  },
  {
    id: "referencia:graduacion-columnas-uvas", numero: 4, nombre: "Columnas de forma libre azul marino y dorado con uvas", ocasiones: ["graduacion"], fidelidad: 4,
    nota: "Dos columnas de racimos apilados a los lados de una pared de lentejuelas, con racimos de uvas dorados de R-5; el letrero de neón no es del taller.",
    lectura: {
      resumen: "Dos columnas orgánicas de forma libre azul marino y dorado cromado con racimos de uvas doradas, a los lados de una pared de lentejuelas.", aspecto: 0.8,
      escala: { altoImagenCm: 340, referencia: "pared de lentejuelas" }, pisoY: 0.88, sala: { pared: "#e7e2d6", piso: "#3a3432" },
      piezas: [
        { tipo: "fondo", id: "lentejuelas", x: 0.53, yBase: 0.75, ancho: 0.44, alto: 0.51, colores: [c("dorado", "#c8a55a", 100)] },
        { tipo: "columna_organica", forma: "racimos", x: 0.2, yBase: 0.9, yArriba: 0.2, ancho: 0.26, grosor: 0.14, tamanos: {}, mezcla: m(25, 45, 30, 0.11, 0.075, 0.045), racimos: 0.8,
          colores: [c("azul marino", "#1e2a5a", 55), c("dorado", "#b79659", 45, "cromado")] },
        { tipo: "columna_organica", forma: "racimos", x: 0.82, yBase: 0.87, yArriba: 0.19, ancho: 0.3, grosor: 0.15, tamanos: {}, mezcla: m(25, 45, 30, 0.11, 0.075, 0.045), racimos: 0.8,
          colores: [c("azul marino", "#1e2a5a", 55), c("dorado", "#b79659", 45, "cromado")] },
        ...([[0.2, 0.32], [0.14, 0.52], [0.22, 0.66], [0.82, 0.27], [0.75, 0.48], [0.86, 0.62]] as const).map(([x, y]): PiezaLeida => ({ tipo: "decoracion", id: "racimo_uvas_dorado", x, y, cantidad: 1, colores: [DORADO(100)] })),
        otro("letrero de neón «Congrats Grad»"),
      ],
    },
  },
  {
    id: "referencia:arcos-chiara-tropical", numero: 5, nombre: "Arcos chiara con columna orgánica fucsia, naranja y crema", ocasiones: ["cumpleanos", "fiesta-verano"], fidelidad: 3,
    nota: "Arcos chiara azul, crema y fucsia; una columna orgánica grande a la derecha que sube y cruza arriba hacia la izquierda, y una corta a la izquierda; las rodajas de toronja y la flor de tela no son del taller.",
    lectura: {
      resumen: "Arcos chiara con un medio arco orgánico fucsia, naranja, crema y dorado a la derecha y una columna corta a la izquierda.", aspecto: 0.834,
      escala: { altoImagenCm: 330, referencia: "arcos de 2 m" }, pisoY: 0.96, sala: { pared: "#e9e6e2", piso: "#8a3b1e" },
      piezas: [
        { tipo: "fondo", id: "arcos_chiara", x: 0.38, yBase: 0.85, ancho: 0.3, alto: 0.55, colores: [c("azul", "#3b8fd4", 34), c("crema", "#f1d8bd", 33), c("fucsia", "#c2185b", 33)] },
        { tipo: "guirnalda_organica", puntos: [p(0.74, 0.94, 0.3), p(0.76, 0.7, 0.28), p(0.72, 0.45, 0.25), p(0.65, 0.22, 0.2), p(0.5, 0.1, 0.16), p(0.3, 0.09, 0.13)], tamanos: { "R-24": 10, "R-18": 30, "R-12": 40, "R-9": 10, "R-5": 10 }, racimos: 0.6,
          colores: [c("fucsia", "#e8197a", 35), c("naranja", "#f26a1b", 25), c("crema", "#efe6da", 25), DORADO(15)] },
        { tipo: "columna_organica", forma: "racimos", x: 0.12, yBase: 0.95, yArriba: 0.6, ancho: 0.18, grosor: 0.15, tamanos: { "R-18": 30, "R-12": 50, "R-9": 10, "R-5": 10 }, racimos: 0.6,
          colores: [c("naranja", "#f26a1b", 40), c("crema", "#efe6da", 35), DORADO(25)] },
        otro("rodajas de toronja y flor de tela"),
      ],
    },
  },
  {
    id: "referencia:portal-rojo-orbes", numero: 6, nombre: "Portal rojo de columnas clásicas con orbes dorados y flecos", ocasiones: ["cumpleanos", "fiesta-infantil"], fidelidad: 3,
    nota: "Dos columnas clásicas rojas con base dorada y una guirnalda clásica roja arriba (el portal), y cuatro orbes con collar y flecos; los orbes de foil van como R-24 Reflex, los flecos como tubitos y el orbe naranja como Reflex naranja; el cartel de la izquierda no es del taller.",
    lectura: {
      resumen: "Portal de columnas clásicas rojas con travesaño rojo y bases doradas, con orbes dorados colgando flecos.", aspecto: 0.8,
      escala: { altoImagenCm: 290, referencia: "columnas de 2,4 m" }, pisoY: 0.95, sala: { pared: "#e9e3da", piso: "#e3ddd5" },
      piezas: [
        { tipo: "guirnalda_clasica", x1: 0.14, x2: 0.92, y: 0.11, colores: [c("rojo", "#d61e1e", 100)] },
        { tipo: "columna_clasica", x: 0.32, yBase: 0.82, yArriba: 0.16, colores: [c("rojo", "#d61e1e", 100)] },
        { tipo: "columna_clasica", x: 0.73, yBase: 0.82, yArriba: 0.16, colores: [c("rojo", "#d61e1e", 100)] },
        { tipo: "columna_clasica", x: 0.32, yBase: 0.95, yArriba: 0.82, colores: [DORADO(100)] },
        { tipo: "columna_clasica", x: 0.73, yBase: 0.95, yArriba: 0.82, colores: [DORADO(100)] },
        ...([0.08, 0.43, 0.9] as const).map((x): PiezaLeida => ({ tipo: "decoracion", id: "orbe_flecos_dorado", x, y: 0.42, cantidad: 1, colores: [DORADO(100)] })),
        { tipo: "decoracion", id: "orbe_flecos_dorado", x: 0.55, y: 0.5, cantidad: 1, colores: [c("naranja", "#e8661a", 100, "cromado")] },
        otro("cartel con dibujo a la izquierda"),
      ],
    },
  },
  {
    id: "referencia:guirnalda-love-monstera", numero: 7, nombre: "Guirnalda verde y blush con monstera y «love»", ocasiones: ["san-valentin", "boda", "fiesta-verano"], fidelidad: 3,
    nota: "Guirnalda orgánica en arco verde esmeralda y blush con hojas de monstera y el «love» de foil; el «love» va en letras sueltas (no hay foil en cursiva) y el carrito no es del taller.",
    lectura: {
      resumen: "Guirnalda orgánica verde esmeralda y blush en arco sobre la pared, con hojas de monstera y letras «love» de foil.", aspecto: 0.97,
      escala: { altoImagenCm: 260, referencia: "carrito de 85 cm" }, pisoY: 1.05, sala: { pared: "#f4f3f0", piso: "#d9d4cc" },
      piezas: [
        { tipo: "guirnalda_organica", puntos: [p(0.03, 0.34, 0.16), p(0.15, 0.18, 0.15), p(0.32, 0.11, 0.15), p(0.52, 0.12, 0.14), p(0.7, 0.2, 0.15), p(0.86, 0.46, 0.15)], tamanos: {}, mezcla: m(33, 24, 43, 0.2, 0.11, 0.06), racimos: 0.55,
          follaje: ["monstera"], colores: [c("blush", "#f2d5b8", 55), c("verde esmeralda", "#174a35", 45)] },
        { tipo: "metalizado", texto: "love", cursiva: true, x: 0.38, y: 0.53, alto: 0.16, colores: [c("oro rosa", "#e0a070", 100, "cromado")] },
        otro("carrito dorado con botella y piñas"),
      ],
    },
  },
  {
    id: "referencia:guirnalda-esquina-armario-palmas", numero: 8, nombre: "Guirnalda en esquina sobre un armario con hojas de palma", ocasiones: ["fiesta-verano", "general"], fidelidad: 3,
    nota: "Guirnalda orgánica que cruza arriba y baja por la derecha (en esquina) con verdes, dorado y blanco perla y pencas de palma; el armario y la pared de piedra no son del taller.",
    lectura: {
      resumen: "Guirnalda orgánica en esquina sobre un armario: verde oscuro, verde, verde lima, dorado y blanco perla con hojas de palma.", aspecto: 1.165,
      escala: { altoImagenCm: 240, referencia: "globos de 11 pulgadas" }, pisoY: 1.25, sala: { pared: "#b9a48c", piso: "#6b4d3a" },
      piezas: [
        { tipo: "guirnalda_organica", puntos: [p(0.18, 0.13, 0.14), p(0.35, 0.15, 0.14), p(0.55, 0.15, 0.16), p(0.72, 0.25, 0.18), p(0.8, 0.45, 0.17), p(0.82, 0.62, 0.14), p(0.88, 0.73, 0.1)], tamanos: { "R-18": 30, "R-12": 35, "R-9": 25, "R-5": 10 }, racimos: 0.45,
          follaje: ["palma"],
          colores: [c("verde esmeralda", "#1f3b30", 30), c("blanco perla", "#f5f3ee", 25, "perla"), c("dorado perla", "#d9b24a", 20, "perla"), c("verde", "#2fa84f", 15), c("verde lima", "#9fd38a", 10, "perla")] },
        otro("armario de madera"), otro("pared de piedra"),
      ],
    },
  },
  {
    id: "referencia:guirnalda-diagonal-monstera", numero: 9, nombre: "Guirnalda en diagonal verde y blush con monstera", ocasiones: ["san-valentin", "fiesta-verano"], fidelidad: 3,
    nota: "Guirnalda orgánica que sube por la izquierda y baja en diagonal a la derecha, verde esmeralda y blush con globos grandes y hojas de monstera; el carrito no es del taller.",
    lectura: {
      resumen: "Guirnalda orgánica en arco que baja en diagonal, verde esmeralda y blush, con hojas de monstera sobre un carrito.", aspecto: 1.017,
      escala: { altoImagenCm: 230, referencia: "carrito de 70 cm de ancho" }, pisoY: 1.12, sala: { pared: "#f6f5f2", piso: "#ddd8d0" },
      piezas: [
        { tipo: "guirnalda_organica", puntos: [p(0.03, 0.32, 0.2), p(0.14, 0.13, 0.18), p(0.3, 0.07, 0.17), p(0.47, 0.12, 0.15), p(0.62, 0.28, 0.16), p(0.76, 0.46, 0.17), p(0.88, 0.72, 0.18)], tamanos: {}, mezcla: m(40, 27, 33, 0.19, 0.115, 0.06), racimos: 0.6,
          follaje: ["monstera"], colores: [c("blush", "#f3dcc4", 60), c("verde esmeralda", "#0f4a33", 40)] },
        otro("carrito dorado con botella y piñas"),
      ],
    },
  },
  {
    id: "referencia:dino-menta-mesa", numero: 10, nombre: "Medio arco menta, blanco y verde con letrero sobre la mesa", ocasiones: ["cumpleanos", "fiesta-infantil"], fidelidad: 3,
    nota: "Medio arco que sube por la izquierda y cruza arriba con globos gigantes menta y blancos y acentos verde oscuro, letrero de madera menta y mesa de postres; la cerca, la torta y los postres no son del taller.",
    lectura: {
      resumen: "Medio arco orgánico menta, blanco y verde oscuro con globos gigantes, letrero menta y mesa de postres.", aspecto: 0.984,
      escala: { altoImagenCm: 250, referencia: "mesa de 75 cm" }, pisoY: 1.13, sala: { pared: "#9c8f80", piso: "#b5a593" },
      piezas: [
        { tipo: "guirnalda_organica", puntos: [p(0.03, 0.47, 0.22), p(0.12, 0.32, 0.25), p(0.22, 0.2, 0.22), p(0.36, 0.11, 0.2), p(0.5, 0.05, 0.17), p(0.6, 0.02, 0.14)], tamanos: { "R-36": 8, "R-24": 10, "R-18": 22, "R-12": 35, "R-9": 15, "R-5": 10 }, racimos: 0.7,
          colores: [c("verde menta", "#cfe8dd", 45), c("blanco", "#f4f6f2", 30), c("verde esmeralda", "#1f5a4c", 25)] },
        { tipo: "fondo", id: "letrero", x: 0.55, yBase: 0.63, ancho: 0.28, alto: 0.3, texto: "Roaring Sweetavores", colorTexto: "#ffffff", colores: [c("menta", "#a9d6c9", 100)] },
        { tipo: "fondo", id: "mesa_mantel", x: 0.5, yBase: 1.13, ancho: 1, alto: 0.3, colores: [c("blanco", "#e8e4dc", 100)] },
        otro("cerca de madera"), otro("torta, postres y vasos de dinosaurios"),
      ],
    },
  },
  {
    id: "referencia:frozen-let-it-go", numero: 11, nombre: "Guirnalda Frozen azul, lila y plata con «LET IT GO»", ocasiones: ["cumpleanos", "fiesta-infantil"], fidelidad: 3,
    nota: "Guirnalda orgánica que sube por la izquierda y cruza arriba en azul, aguamarina, lila, plata y confeti, letras de foil plateadas y mesa; los copos de nieve y las figuras no son del taller.",
    lectura: {
      resumen: "Guirnalda orgánica de Frozen azul cromado, aguamarina, violeta, plata y confeti con letras «LET IT GO» de foil.", aspecto: 1,
      escala: { altoImagenCm: 270, referencia: "mesa de 75 cm" }, pisoY: 1.03, sala: { pared: "#ece9e4", piso: "#cfcac2" },
      piezas: [
        { tipo: "guirnalda_organica", puntos: [p(0.06, 0.7, 0.13), p(0.07, 0.48, 0.15), p(0.14, 0.26, 0.15), p(0.32, 0.12, 0.14), p(0.58, 0.09, 0.14), p(0.8, 0.11, 0.12)], tamanos: { "R-18": 25, "R-12": 40, "R-9": 20, "R-5": 15 }, racimos: 0.45,
          colores: [c("azul", "#2d6fb7", 25, "cromado"), c("aguamarina", "#3fb8c0", 20), c("violeta", "#7b5bb5", 20, "cromado"), c("plata", "#b8bcc2", 15, "cromado"), c("lila", "#b9a6e0", 10), c("cristal con confeti lila", "#e4def0", 10, "confeti")] },
        { tipo: "metalizado", texto: "LET", cursiva: false, x: 0.5, y: 0.38, alto: 0.14, colores: [c("plata", "#c0c4c8", 100, "cromado")] },
        { tipo: "metalizado", texto: "IT GO", cursiva: false, x: 0.5, y: 0.53, alto: 0.14, colores: [c("plata", "#c0c4c8", 100, "cromado")] },
        { tipo: "fondo", id: "mesa_mantel", x: 0.5, yBase: 1.03, ancho: 0.75, alto: 0.28, colores: [c("plata", "#c9c9c9", 100)] },
        otro("copos de nieve de papel"), otro("torta, cupcakes y figuras de Frozen"),
      ],
    },
  },
  {
    id: "referencia:guirnalda-feston-vino-rosa", numero: 12, nombre: "Guirnalda en festón vino, rosa, durazno y dorado", ocasiones: ["boda", "general"], fidelidad: 4,
    nota: "Guirnalda orgánica recta en festón con vino, rosa viejo, durazno, dorado cromado y crema; la mesita y las flores naturales no son del taller.",
    lectura: {
      resumen: "Guirnalda orgánica horizontal vino, rosa viejo, durazno, dorado y crema sobre una mesita.", aspecto: 1.26,
      escala: { altoImagenCm: 230, referencia: "globos de 12 pulgadas" }, pisoY: 1.25, sala: { pared: "#f4f2ef", piso: "#ddd6cc" },
      piezas: [
        { tipo: "guirnalda_organica", puntos: [p(0.02, 0.21, 0.2), p(0.2, 0.16, 0.22), p(0.4, 0.14, 0.2), p(0.6, 0.15, 0.2), p(0.8, 0.18, 0.2), p(0.98, 0.21, 0.18)], tamanos: {}, mezcla: m(22, 36, 42, 0.16, 0.085, 0.055), racimos: 0.4,
          colores: [c("vino", "#7b1f2e", 35), c("palo de rosa", "#e7a4a4", 25), c("durazno", "#f6c7a0", 20), DORADO(15), c("crema", "#f7e7c8", 5)] },
        otro("mesita blanca con flores naturales y vasos de cobre"),
      ],
    },
  },
  {
    id: "referencia:medio-arco-oro-rosa-confeti", numero: 13, nombre: "Medio arco dorado, rosa y confeti que baja por la izquierda", ocasiones: ["despedida", "boda"], fidelidad: 3,
    nota: "Guirnalda orgánica que cruza arriba y baja por la izquierda, dorado cromado, rosado y durazno con mucho confeti dorado; el banderín «She Said Yasss» y la comida no son del taller.",
    lectura: {
      resumen: "Guirnalda orgánica en esquina izquierda dorada, rosada y de confeti dorado.", aspecto: 1,
      escala: { altoImagenCm: 250, referencia: "globos de 16 pulgadas" }, pisoY: 1.15, sala: { pared: "#ecebe8", piso: "#d9d4cc" },
      piezas: [
        { tipo: "guirnalda_organica", puntos: [p(0.97, 0.06, 0.13), p(0.7, 0.04, 0.15), p(0.45, 0.06, 0.16), p(0.22, 0.11, 0.16), p(0.07, 0.26, 0.16), p(0.03, 0.5, 0.15), p(0.05, 0.75, 0.14), p(0.08, 0.9, 0.12)], tamanos: {}, mezcla: m(25, 40, 35, 0.18, 0.1, 0.07), racimos: 0.4,
          colores: [DORADO(35), c("cristal con confeti dorado", "#efe4cc", 25, "confeti"), c("rosado pastel", "#efc0c0", 25), c("durazno", "#f6d2c6", 15)] },
        otro("banderín «She Said Yasss»"), otro("bandejas de comida"),
      ],
    },
  },
];
