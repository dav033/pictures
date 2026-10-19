/**
 * Piezas leídas como `otro` (`lectura-otro.ts`): lo que el taller tiene con otro nombre se arma con su pieza del catálogo SOLO si el
 * sustantivo principal lo dice con exactitud (una mesa de postres, una mesa alta, unos pedestales, un marco de tela); un estante, unos
 * cupcakes, unos dulces o unas cajas de regalo no son una mesa ni un carrito. El fondo de la foto sin pieza (ventanales, césped, deck)
 * no cuenta; lo que el taller arma como figura (calabazas, un número relleno de globos: `test-figuras-lectura.ts`) o es un arreglo de pampas en el
 * piso (el jarrón del catálogo) se arma; lo que no sabe armar (mariposas, muñecos, globos sueltos) sigue pendiente. Las descripciones son las 61 que
 * devolvió el lector en las 30 fotos de las corridas 2026-10-10T09-30-37 y T09-56-24 (sin llamadas de pago).
 * - la clasificación de cada una, y las reglas que la reseña pidió (falsos positivos, superficies, «:» como separador);
 * - una lectura con esas piezas compila: las del catálogo salen como nodos (con un aviso de que su color y su medida son los del
 *   catálogo), las de fondo no van a `omitidas` y solo las pendientes quedan en `omitidas`;
 * - dónde caen: del lado que nombran, a la profundidad que dicen y nunca delante ni encima de la estructura.
 *
 * Run: npx tsx --conditions=react-server scripts/test/test-lectura-otro.ts
 */
import assert from "node:assert/strict";
import { armarEscena } from "@/lib/globos3d/escena";
import { compilarLectura } from "@/lib/globos3d/compilar-lectura";
import { LecturaFotoSchema } from "@/lib/globos3d/lectura-foto";
import { resolverOtro, type ResolucionOtro } from "@/lib/globos3d/lectura-otro";

const CASOS: ReadonlyArray<readonly [string, ResolucionOtro["tipo"], string?]> = [
  ["pedestales acrílicos transparentes con platos plateados", "catalogo", "pedestales"],
  ["racimo de globos rosa cromado cortado por el borde izquierdo", "pendiente"],
  ["florero blanco con planta verde esférica a la izquierda", "escenografia"],
  ["panel de tela vino tras el arco que cubre la pared del fondo", "pendiente"],
  ["mariposas rosas de papel pegadas en el fondo y entre los globos", "pendiente"],
  ["estante de tres niveles con cupcakes y postres a la derecha", "pendiente"],
  ["cortinas de tela rosa claro a la izquierda", "pendiente"],
  ["dos mariposas grandes de foil lila y blanco sobre el arco", "pendiente"],
  ["globos sueltos y racimos de globos lila y blancos al pie del arco", "pendiente"],
  ["panel de castillo rosa con ladrillo y ventanas blancas, detrás de la decoración", "pendiente"],
  ["árbol de navidad plateado con tinsel, en el piso al centro", "pendiente"],
  ["muñeco de nieve con gorro rosa y cajas de regalo rosadas en el piso", "pendiente"],
  ["copos de nieve decorativos blancos y rosados sobre la pared", "pendiente"],
  ["ventanales y césped detrás del montaje, sin piezas de decoración adicionales", "escenografia"],
  ["flor de papel naranja sobre la pared, arriba a la izquierda del arco", "pendiente"],
  ["mesa dorada de postres con bandejas y tortitas naranjas, a la izquierda del pedestal", "catalogo", "mesa_postres"],
  ["deck de madera y cerca de listones al fondo, casa y cielo", "escenografia"],
  ["mesa alta dorada de tapa redonda con bandeja de dulces y cupcakes sobre base blanca", "catalogo", "mesa_coctel"],
  ["dos cajas blancas de regalo con moños de borlas sobre la mesa", "pendiente"],
  ["arcoíris de cañas o madera con borlas de macramé colgado de la pared a la izquierda", "pendiente"],
  ["número 1 gigante tipo mosaico (caja blanca) lleno de globos rosa, malva y verde con flores y cintas rosas", "figura"],
  ["número 6 gigante tipo mosaico (caja blanca) lleno de globos verde menta, rosa y blancos con flores", "figura"],
  ["cortina blanca drapeada al fondo", "pendiente"],
  ["caballete de madera tipo escalera que sostiene el letrero", "pendiente"],
  ["mesa redonda de alambre dorado con tapa blanca", "catalogo", "mesa_hexagonal"],
  ["florero rosado con flores y ramas a la izquierda", "escenografia"],
  ["pequeños dulces o cupcakes rosados sobre el pedestal bajo", "pendiente"],
  ["pampas beige y crema con rosas blancas en el piso, al pie del aro", "catalogo", "jarron_pampas"],
  ["dos columnas de acrílico transparente con globos blancos, blush y nude dentro, a la izquierda", "pendiente"],
  ["jarrón de piedra con pampas, flores blancas y rosas, arriba a la izquierda", "catalogo", "jarron_pampas"],
  ["arreglo de flores rosas, pampas y ramas secas apoyado en el piso al pie de la guirnalda", "catalogo", "jarron_pampas"],
  ["esferas doradas colgantes y ramas secas oscuras en el techo", "pendiente"],
  ["puertas-ventanal blancas de vidrio al fondo, con persianas a los lados", "escenografia"],
  ["plantas verdes y arbustos al fondo del patio, y hierbas altas a la derecha", "escenografia"],
  ["letras gigantes blancas «ONE» al frente, sobre las que hay mesa de dulces", "pendiente"],
  ["letra O gigante blanca detrás de la guirnalda derecha", "pendiente"],
  ["panel rosa con «Princess» en dorado y panel crema/beige detrás", "pendiente"],
  ["mesa de dulces: cajitas doradas y blancas, frascos, torta dorada con campana y jarrones", "pendiente"],
  ["base blanca baja bajo el muro de globos", "pendiente"],
  ["rizos dorados metálicos entre los globos y flores doradas de adorno", "pendiente"],
  ["osito de peluche blanco con lazo rosado, sentado a la izquierda", "pendiente"],
  ["mesa auxiliar de patas doradas con torre de macarons rosados", "pendiente"],
  ["arco de medio punto blanco de tela, unos 2,3 m, detrás de los globos (sin id de catálogo)", "pendiente"],
  ["bocina o caja negra al borde derecho de la foto", "pendiente"],
  ["topiarios de boj en macetas doradas a los lados, copas y frutero dorado sobre las mesas", "pendiente"],
  ["marca de agua GM'DECOMAGIC con teléfono sobre la foto", "pendiente"],
  ["panel de varillas de madera oscuras en la pared del fondo", "pendiente"],
  ["escalera o estante metálico negro a la derecha", "pendiente"],
  ["silla de tapizado café en la esquina inferior derecha", "catalogo", "silla_moderna"],
  ["cubo de acrílico transparente con plato dorado de pie encima, vacío, al pie del arco", "pendiente"],
  ["bandejas con tejido dorado y postres sobre los pedestales", "pendiente"],
  ["dos mesas auxiliares de metal dorado con tapa de vidrio o madera, con copas o bandejas encima", "catalogo", "mesa_hexagonal"],
  ["cortina blanca drapeada de tela con pliegues al fondo", "pendiente"],
  ["florero a la izquierda con flores secas blancas y ramas de lavanda", "escenografia"],
  ["murciélago negro de foil arriba a la izquierda", "pendiente"],
  ["gato negro de foil arriba a la derecha", "pendiente"],
  ["figura negra de foil con cara (gato o calabaza) al centro, abajo, y figura crema de foil cerca", "pendiente"],
  ["dos calabazas de Halloween (jack-o-lantern) en el piso, a la izquierda", "figura"],
  ["letras doradas «...thday» en la pared a la izquierda, cortadas por el borde de la foto", "pendiente"],
  ["distintivo negro con logo pequeño sobre la columna, a la izquierda", "pendiente"],
  ["muro denso de globos blancos, grises, negros, dorados y plateados cromados, sin estructura visible", "pendiente"],
];

for (const [descripcion, tipo, id] of CASOS) {
  const r = resolverOtro(descripcion);
  assert.equal(r.tipo, tipo, `«${descripcion}»: ${JSON.stringify(r)}`);
  if (r.tipo === "catalogo") assert.equal(r.id, id, `«${descripcion}» → ${r.id}`);
}
console.log(`  ✓ ${CASOS.length} descripciones de las 30 lecturas se clasifican como debe (${CASOS.filter((c) => c[1] === "catalogo").length} del catálogo, ${CASOS.filter((c) => c[1] === "figura").length} figuras, ${CASOS.filter((c) => c[1] === "escenografia").length} de fondo)`);

// Falsos positivos de la reseña: el sustantivo principal decide, no lo que sale después ni lo que hay encima.
const NO_COMO: ReadonlyArray<readonly [string, ResolucionOtro["tipo"], string]> = [
  ["cupcakes sobre el pedestal bajo", "pendiente", "pedestales"],
  ["postres sobre los pedestales", "pendiente", "pedestales"],
  ["pastel en pedestal", "pendiente", "pedestales"],
  ["sobre el pedestal, un pastel de tres pisos", "pendiente", "pedestales"],
  ["sobre el pedestal blanco: cupcakes", "pendiente", "pedestales"],
  ["mesa de dulces: pedestales con platos y frascos", "pendiente", "pedestales"],
  ["letras de madera sobre la mesa de dulces", "pendiente", "carrito_dulces"],
  ["mesa de dulces con cajitas y frascos", "pendiente", "carrito_dulces"],
  ["escalera o estante metálico negro a la derecha", "pendiente", "escalera_decorativa"],
  ["estante de tres niveles con cupcakes y postres", "pendiente", "carrito_dulces"],
  ["cupcakes y postres rosados", "pendiente", "carrito_dulces"],
  ["dos cajas blancas de regalo con moños sobre la mesa", "pendiente", "mesa_regalos"],
  ["panel de tela vino tras el arco", "pendiente", "marco_tela"],
  ["flor de tela rosa", "pendiente", "marco_tela"],
  ["arco de tela blanco", "pendiente", "marco_tela"],
  ["cortina blanca drapeada", "pendiente", "cortina_flecos"],
  ["muro denso de globos blancos y dorados, sin estructura visible", "pendiente", "escenografia"],
  ["pared de globos blancos", "pendiente", "escenografia"],
  ["pared de flores artificiales", "pendiente", "escenografia"],
  ["mesa auxiliar de patas doradas con torre de macarons", "pendiente", "mesa_hexagonal"],
  ["árbol plateado con luces en el piso", "pendiente", "escenografia"],
  // El fondo con adjetivo o material antes del «con» tampoco se traga lo que lleva puesto.
  ["pared blanca con mariposas de papel", "pendiente", "escenografia"],
  ["pared del fondo con letras de papel", "pendiente", "escenografia"],
  ["jardín con letras gigantes LOVE", "pendiente", "escenografia"],
  ["césped con globos sueltos", "pendiente", "escenografia"],
  // «alta» y «tela» sueltas en el nombre no hacen una mesa cóctel ni un marco de tela.
  ["mesa rectangular alta con postres", "pendiente", "mesa_coctel"],
  ["mesa de madera alta con mantel", "pendiente", "mesa_coctel"],
  ["marco redondo de tela blanca", "pendiente", "marco_tela"],
];
for (const [descripcion, tipo, nada] of NO_COMO) {
  const r = resolverOtro(descripcion);
  assert.equal(r.tipo, tipo, `«${descripcion}»: ${JSON.stringify(r)}`);
  assert.ok(!(r.tipo === "catalogo" && r.id === nada), `«${descripcion}» no es ${nada}: ${JSON.stringify(r)}`);
}
console.log(`  ✓ ${NO_COMO.length} falsos positivos de la corrida no se convierten en pieza del catálogo ni en fondo`);

// Lo que sí tiene pieza aunque el nombre empiece por una superficie o lleve el adorno después.
const SI_COMO: ReadonlyArray<readonly [string, string]> = [
  ["pared de lentejuelas doradas al fondo", "lentejuelas"],
  ["panel de lentejuelas plateadas", "lentejuelas"],
  ["piso con tapete beige", "tapete_redondo"],
  ["cortina de luces blancas", "cortina_luces"],
  ["cortinas de flecos doradas", "cortina_flecos"],
  ["silla tapizada en terciopelo verde", "silla_moderna"],
  ["silla de tapizado café en la esquina inferior derecha", "silla_moderna"],
  ["mesa auxiliar de alambre dorado con tapa blanca", "mesa_hexagonal"],
  ["mesa redonda de alambre dorado", "mesa_hexagonal"],
  ["jarrón con pampas", "jarron_pampas"],
  ["jarrón de piedra con pampas, flores blancas, arriba a la izquierda", "jarron_pampas"],
  ["mesa de postres dorada", "mesa_postres"],
  ["mesa de regalos con mantel", "mesa_regalos"],
  ["mesa alta de cóctel", "mesa_coctel"],
  ["marco de tela blanca", "marco_tela"],
  ["bastidor de tela con nombre", "marco_tela"],
  ["escalera decorativa de madera", "escalera_decorativa"],
  ["pedestales blancos de distintas alturas", "pedestales"],
  ["tres pedestales dorados con una torta", "pedestales"],
  ["piso de madera con tapete beige", "tapete_redondo"],
  // Un material o un tapete con lo que lo hace la pieza del catálogo: la pared, la forma o el piso.
  ["lentejuelas doradas de fondo", "lentejuelas"],
  ["lentejuelas plateadas en la pared", "lentejuelas"],
  ["pared blanca con lentejuelas", "lentejuelas"],
  ["tapete redondo", "tapete_redondo"],
  ["piso con tapete", "tapete_redondo"],
  ["pared blanca con cortina de luces", "cortina_luces"],
  // Los nombres del propio catálogo.
  ["carrito de dulces", "carrito_dulces"],
  ["alfombra redonda", "alfombra_redonda"],
  ["cortina con luces", "cortina_luces"],
  ["marco con tela", "marco_tela"],
  ["mesa hexagonal dorada", "mesa_hexagonal"],
  ["mesas nido hexagonales", "mesas_nido_hexagonales"],
];
for (const [descripcion, id] of SI_COMO) {
  const r = resolverOtro(descripcion);
  assert.ok(r.tipo === "catalogo" && r.id === id, `«${descripcion}» debía ser ${id}: ${JSON.stringify(r)}`);
}
console.log(`  ✓ ${SI_COMO.length} nombres exactos (pared de lentejuelas, piso con tapete, silla tapizada, jarrón con pampas…) van a su pieza`);

// Falsos positivos de la tercera reseña: un material suelto no es la pieza del catálogo. Unas lentejuelas sobre la mesa no son la pared
// de 2,4 m; un tapete de bienvenida no es el tapete redondo; un pedestal solo no es el juego de tres (azul, blanco y dorado) del catálogo.
const MATERIALES: ReadonlyArray<readonly [string, ResolucionOtro["tipo"]]> = [
  ["lentejuelas doradas esparcidas sobre la mesa", "pendiente"],
  ["lentejuelas plateadas", "pendiente"],
  ["pared blanca, lentejuelas esparcidas sobre la mesa", "escenografia"],
  ["tapete de bienvenida WELCOME", "pendiente"],
  ["tapete negro de bienvenida con letras blancas", "pendiente"],
  ["tapete de yoga", "pendiente"],
  ["pedestal dorado", "pendiente"],
  ["un pedestal dorado con una torta", "pendiente"],
  // Cuarta reseña: lo que dice de la pieza es su cláusula («de fondo» de la pared que viene después no hace pared a las lentejuelas),
  // un tapete cuadrado no es el redondo y una alfombra de bienvenida tampoco es la redonda del catálogo.
  ["lentejuelas esparcidas sobre la mesa, pared blanca de fondo", "pendiente"],
  ["tapete cuadrado negro", "pendiente"],
  ["tapete rectangular beige en el piso", "pendiente"],
  // Quinta reseña: un color solo no hace del tapete el redondo del piso (el de encima de la mesa es un camino de mesa).
  ["tapete beige sobre la mesa", "pendiente"],
  ["tapete claro frente al montaje", "pendiente"],
  ["alfombra redonda de bienvenida", "pendiente"],
];
for (const [descripcion, tipo] of MATERIALES) assert.equal(resolverOtro(descripcion).tipo, tipo, `«${descripcion}»: ${JSON.stringify(resolverOtro(descripcion))}`);
console.log(`  ✓ ${MATERIALES.length} materiales sueltos (lentejuelas, tapete, un pedestal) no se vuelven la pieza del catálogo`);

// Falsos negativos: después del fondo (tras una coma o en una lista con «y») la descripción nombra una pieza del catálogo; y un florero
// con globos no es el arreglo de flores que es fondo.
const DESPUES_DEL_FONDO: ReadonlyArray<readonly [string, ResolucionOtro["tipo"], string?]> = [
  ["pared blanca, mesa de postres dorada a la izquierda", "catalogo", "mesa_postres"],
  ["ventanales, césped y una mesa de regalos", "catalogo", "mesa_regalos"],
  ["ventanales y una mesa de regalos", "catalogo", "mesa_regalos"],
  ["ventanales, con una mesa de regalos delante", "catalogo", "mesa_regalos"],
  ["florero con globos metálicos dorados", "pendiente"],
];
for (const [descripcion, tipo, id] of DESPUES_DEL_FONDO) {
  const r = resolverOtro(descripcion);
  assert.equal(r.tipo, tipo, `«${descripcion}»: ${JSON.stringify(r)}`);
  if (r.tipo === "catalogo") assert.equal(r.id, id, `«${descripcion}» → ${r.id}`);
}
const postresALaIzquierda = resolverOtro("pared blanca, mesa de postres dorada a la izquierda");
assert.ok(postresALaIzquierda.tipo === "catalogo" && postresALaIzquierda.lado === -1, `el lado sale de toda la descripción: ${JSON.stringify(postresALaIzquierda)}`);
// Lo que dice dónde está otra cosa («sobre la mesa de postres», «a la izquierda de la mesa de regalos») no nombra la pieza.
for (const d of ["pared blanca, cupcakes sobre la mesa de postres", "ventanales al fondo, a la izquierda de la mesa de regalos"]) assert.notEqual(resolverOtro(d).tipo, "catalogo", d);
console.log(`  ✓ ${DESPUES_DEL_FONDO.length} descripciones que empiezan por el fondo: la pieza del catálogo que nombran después cuenta`);

// Fondo: solo si TODO el nombre es fondo; el singular y las plantas también.
const FONDOS = ["ventanal grande al fondo", "ventanales y césped", "plantas verdes y arbustos", "planta grande a la izquierda", "pared de ladrillo blanca", "pared del fondo", "piso de madera", "deck de madera y cerca de listones", "jardín con hierbas altas"];
for (const d of FONDOS) assert.equal(resolverOtro(d).tipo, "escenografia", d);
for (const d of ["pared con letras de papel", "piso con confeti dorado", "cerca de globos rosados", "casa de muñecas"]) assert.equal(resolverOtro(d).tipo, "pendiente", d);
console.log("  ✓ el fondo se traga solo cuando todo el nombre es fondo (ventanal, plantas…); una pared con algo encima no");

// Lado, profundidad y cantidad que dice la descripción.
const dicho = (d: string) => { const r = resolverOtro(d); return r.tipo === "catalogo" ? r : assert.fail(`«${d}» debía ser del catálogo: ${JSON.stringify(r)}`); };
assert.equal(dicho("mesa de postres a la izquierda del arco").lado, -1);
assert.equal(dicho("mesa de regalos a la derecha").lado, 1);
assert.equal(dicho("mesa de regalos a la izquierda o a la derecha").lado, 0);
assert.equal(dicho("mesa de postres en la esquina inferior derecha").lado, 1);
// Solo cuenta lo que dice de dónde está la pieza, no lo que describe de otra cosa.
assert.equal(dicho("mesa de postres frente al arco, con la columna derecha detrás").lado, 0);
assert.equal(dicho("mesa de postres frente al arco, con la columna derecha detrás").profundidad, "delante");
assert.equal(dicho("mesa de postres con el arco detrás").profundidad, null);
assert.equal(dicho("mesa de postres detrás del arco").profundidad, "fondo");
assert.equal(dicho("tres pedestales blancos").cantidad, 1, "unos pedestales ya son un juego");
assert.equal(dicho("mesa de postres").lado, 0);
assert.equal(dicho("mesa alta al fondo").profundidad, "fondo");
assert.equal(dicho("mesa alta delante del arco").profundidad, "delante");
assert.equal(dicho("dos mesas auxiliares de metal dorado").cantidad, 2);
assert.equal(dicho("mesa de postres").cantidad, 1);
console.log("  ✓ el lado (izquierda/derecha), la profundidad (fondo/delante) y la cantidad se leen de la descripción");

// --- Compilar -----------------------------------------------------------------------------------------------------------------------------
type Compilada = ReturnType<typeof compilarLectura>;
const color = { nombre: "blanco", hex: "#f4f1ea", peso: 100, acabado: "mate" as const };
const base = { aspecto: 1.5, escala: { altoImagenCm: 250, referencia: "mesa de 75 cm" }, pisoY: 0.9, sala: { pared: "#ffffff", piso: "#cccccc" } };
const lectura = (...piezas: unknown[]) => LecturaFotoSchema.parse({ resumen: "prueba de otro", ...base, piezas });
const otro = (descripcion: string) => ({ tipo: "otro" as const, descripcion });
/** La estructura principal de las pruebas de lugar: un panel redondo de 150 cm en el centro de la foto. */
const panel = { tipo: "fondo" as const, id: "panel_redondo", x: 0.5, yBase: 0.9, ancho: 0.6, alto: 0.6, colores: [color] };

const simple = compilarLectura(lectura(
  otro("mesa dorada de postres con bandejas y tortitas naranjas"),
  otro("ventanales y césped detrás del montaje, sin piezas de decoración adicionales"),
  otro("mariposas rosas de papel pegadas en el fondo"),
  otro("dos cajas blancas de regalo con moños de borlas sobre la mesa"),
));
assert.ok(simple.escena.nodos.some((n) => n.id.startsWith("mesa-postres")), "la mesa de postres se arma");
assert.ok(!simple.escena.nodos.some((n) => n.id.startsWith("mesa-regalos")), "unas cajas de regalo no son la mesa de regalos");
assert.deepEqual(simple.omitidas, ["mariposas rosas de papel pegadas en el fondo", "dos cajas blancas de regalo con moños de borlas sobre la mesa"], "lo pendiente queda omitido");
assert.ok(simple.notas.some((n) => n.includes("Mesa de postres") && n.includes("color y su medida son los del catálogo")), "avisa que el color y la medida son los del catálogo");
assert.ok(simple.notas.some((n) => n.includes("fondo de la foto")), "el fondo sin pieza se anota");
console.log("  ✓ una lectura con otro compila: la mesa de postres sale (con su aviso de catálogo), el fondo no cuenta y solo lo pendiente va a omitidas");

// Un «otro» del mismo catálogo que un fondo ya leído no añade otro juego.
const pedestales = { tipo: "fondo" as const, id: "pedestales", x: 0.5, yBase: 0.8, ancho: 0.12, alto: 0.3, colores: [color] };
const sin = compilarLectura(lectura(pedestales));
const con = compilarLectura(lectura(pedestales, otro("pedestales de acrilico con platos")));
assert.equal(con.escena.nodos.length, sin.escena.nodos.length, "el otro de pedestales no añade un segundo juego");
assert.ok(con.notas.some((n) => n.includes("ya está leída")), "avisa que ya estaba");
console.log("  ✓ un otro del catálogo ya leído no se repite");


// Dónde caen.
type Caja = { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } };
const cajas = (r: Compilada) => new Map(armarEscena(r.escena).porNodo.map((n) => [n.id, n.caja as Caja] as const));
/** Ningún otro nodo cruza (en x y en altura) la caja del nodo: ni delante ni encima. */
function sinEstorbar(r: Compilada, id: string) {
  const todas = cajas(r), mia = todas.get(id)!;
  for (const [otroId, c] of todas) {
    if (otroId === id) continue;
    const seCruzan = mia.max.x > c.min.x && mia.min.x < c.max.x && mia.max.y > c.min.y && mia.min.y < c.max.y;
    assert.ok(!seCruzan, `${id} [${mia.min.x.toFixed(0)}, ${mia.max.x.toFixed(0)}] estorba a ${otroId} [${c.min.x.toFixed(0)}, ${c.max.x.toFixed(0)}]`);
  }
}
const idDe = (r: Compilada, prefijo: string) => r.escena.nodos.find((n) => n.id.startsWith(prefijo))?.id ?? assert.fail(`falta ${prefijo}: ${r.escena.nodos.map((n) => n.id).join(", ")} · ${r.omitidas.join(" | ")}`);
const xDe = (r: Compilada, id: string) => { const c = cajas(r).get(id)!; return (c.min.x + c.max.x) / 2; };

const izq = compilarLectura(lectura(panel, otro("mesa dorada de postres con bandejas, a la izquierda del panel")));
const der = compilarLectura(lectura(panel, otro("mesa dorada de postres con bandejas, a la derecha del panel")));
const centro = compilarLectura(lectura(panel, otro("mesa dorada de postres con bandejas")));
assert.ok(xDe(izq, idDe(izq, "mesa-postres")) < -75, "a la izquierda cae a la izquierda del panel");
assert.ok(xDe(der, idDe(der, "mesa-postres")) > 75, "a la derecha cae a la derecha del panel");
for (const r of [izq, der, centro]) sinEstorbar(r, idDe(r, "mesa-postres"));
// Sin lado, la mesa no se queda en x = 0 (delante del panel): al lado, en el hueco más cercano al centro.
assert.ok(Math.abs(xDe(centro, idDe(centro, "mesa-postres"))) > 75, "sin lado tampoco queda delante del panel");
// Sin nada que tapar, la mesa queda en el centro.
const libre = compilarLectura(lectura(otro("mesa dorada de postres")));
assert.ok(Math.abs(xDe(libre, idDe(libre, "mesa-postres"))) < 5, "sin estructura, la mesa queda en el centro");
console.log("  ✓ la pieza cae del lado que dice y en el hueco más cercano al centro; nunca delante ni encima del panel");

// Una estructura que llena la sala: la sala se ensancha para que la pieza quepa a un lado en vez de taparla.
const ancha = { ...panel, ancho: 1.3, alto: 0.5 };
const llena = compilarLectura(lectura(ancha, otro("mesa de regalos a la izquierda")));
const idRegalos = idDe(llena, "mesa-regalos");
sinEstorbar(llena, idRegalos);
const cajaRegalos = cajas(llena).get(idRegalos)!;
assert.ok(cajaRegalos.min.x >= -llena.escena.sala.anchoCm / 2 && cajaRegalos.max.x <= llena.escena.sala.anchoCm / 2, "la mesa cabe en la sala");
console.log(`  ✓ la sala se ensancha (${llena.escena.sala.anchoCm} cm) para que quepa a un lado, sin taparla`);

// Profundidad: «al fondo» pegada a la pared, «delante» más cerca de la cámara que su sitio de siempre.
const zDe = (r: Compilada, prefijo: string) => { const n = r.escena.nodos.find((x) => x.id.startsWith(prefijo)); return n?.colocacion.en === "piso" ? n.colocacion.zCm : Number.NaN; };
const alFondo = compilarLectura(lectura(otro("mesa alta de cóctel al fondo")));
const delante = compilarLectura(lectura(otro("mesa alta de cóctel delante")));
const siempre = compilarLectura(lectura(otro("mesa alta de cóctel")));
assert.ok(zDe(alFondo, "mesa-coctel") < zDe(siempre, "mesa-coctel"), "al fondo queda más cerca de la pared que el sitio de siempre");
assert.ok(zDe(delante, "mesa-coctel") > zDe(siempre, "mesa-coctel"), "delante queda más cerca de la cámara que el sitio de siempre");
console.log("  ✓ «al fondo» y «delante» cambian la profundidad");

// Varias, y la cantidad que dice la foto se anota.
const dos = compilarLectura(lectura(panel, otro("dos mesas auxiliares de metal dorado con tapa de vidrio"), otro("mesa de regalos a la izquierda")));
assert.ok(dos.notas.some((n) => n.includes("la foto dice 2 y se armó una")), "dice que la foto trae dos");
sinEstorbar(dos, idDe(dos, "mesa-hexagonal"));
sinEstorbar(dos, idDe(dos, "mesa-regalos"));
console.log("  ✓ dos piezas «otro» no se pisan entre sí ni con la estructura");

// Un telón ancho (la pared de lentejuelas) va pegado a la pared por detrás de todo y un tapete se tiende en su sitio de siempre: no esquivan.
const salaAntes = compilarLectura(lectura(panel)).escena.sala.anchoCm;
const fondos = compilarLectura(lectura(panel, otro("pared de lentejuelas doradas"), otro("piso con tapete beige")));
const lentejuelas = fondos.escena.nodos.find((n) => n.id.startsWith("lentejuelas")), tapete = fondos.escena.nodos.find((n) => n.id.startsWith("tapete"));
assert.ok(lentejuelas && tapete, fondos.omitidas.join(" | "));
assert.ok(lentejuelas?.colocacion.en === "piso" && lentejuelas.colocacion.zCm < -200 && Math.abs(lentejuelas.colocacion.xCm) < 5, `la pared de lentejuelas queda contra la pared, en el centro: ${JSON.stringify(lentejuelas?.colocacion)}`);
assert.ok(tapete?.colocacion.en === "piso" && tapete.colocacion.zCm > -150, `el tapete se tiende delante: ${JSON.stringify(tapete?.colocacion)}`);
assert.equal(fondos.escena.sala.anchoCm, salaAntes, "ni el telón ni el tapete ensanchan la sala");
console.log("  ✓ la pared de lentejuelas (contra la pared) y el tapete (delante) no esquivan ni ensanchan la sala");

// La mesa que el lector llamó «otro» sostiene el pastel que la foto sí sitúa: va bajo el pastel, no al lado del panel.
const pastel = { tipo: "fondo" as const, id: "pastel", x: 0.5, yBase: 0.6, ancho: 0.12, alto: 0.15, colores: [color] };
const conPastel = compilarLectura(lectura(panel, otro("mesa de postres blanca"), pastel));
assert.ok(!conPastel.omitidas.some((o) => o.includes("no hay una mesa debajo")), `el pastel se apoya en la mesa leída como otro: ${conPastel.omitidas.join(" | ")}`);
assert.ok(conPastel.escena.nodos.some((n) => n.id.startsWith("pastel")), "el pastel está en la escena");
assert.ok(Math.abs(xDe(conPastel, idDe(conPastel, "mesa-postres"))) < 60, "la mesa está bajo el pastel, en el centro de la foto");
assert.ok(conPastel.notas.some((n) => n.includes("va bajo el pastel de la foto")), "dice por qué está ahí");
// Con una mesa leída de la foto, la de «otro» no le quita el pastel: va a su lado como cualquier otra.
const mesaLeida = { tipo: "fondo" as const, id: "mesa_mantel", x: 0.5, yBase: 0.9, ancho: 0.4, alto: 0.3, colores: [color] };
const conMesa = compilarLectura(lectura(panel, mesaLeida, otro("mesa de regalos a la izquierda"), pastel));
assert.ok(Math.abs(xDe(conMesa, idDe(conMesa, "mesa-regalos"))) > 75, "con una mesa leída, la mesa de otro va al lado");
console.log("  ✓ la mesa de otro se queda bajo el pastel de la foto; con una mesa leída, va a su lado");

// Varias piezas del mismo lado no ensanchan la sala sin fin: se reparten en filas hacia la cámara y no se pisan.
const lado3 = compilarLectura(lectura(panel, otro("pedestales a la izquierda"), otro("mesa de postres a la izquierda"), otro("mesa de regalos a la izquierda")));
const ids3 = ["pedestales", "mesa-postres", "mesa-regalos"].map((p) => idDe(lado3, p));
const planta = (id: string) => cajas(lado3).get(id)!;
const cajaPanel = planta(idDe(lado3, "panel-redondo"));
// Delante o detrás unas de otras es válido (filas hacia la cámara); lo que no vale es tapar el panel.
for (const id of ids3) assert.ok(planta(id).max.x <= cajaPanel.min.x || planta(id).min.x >= cajaPanel.max.x, `${id} tapa el panel`);
for (const [i, a] of ids3.entries()) for (const b of ids3.slice(i + 1)) {
  const A = planta(a), B = planta(b);
  assert.ok(!(A.max.x > B.min.x && A.min.x < B.max.x && A.max.z > B.min.z && A.min.z < B.max.z), `${a} y ${b} se pisan en planta`);
}
assert.ok(lado3.escena.sala.anchoCm < 900, `la sala no crece sin fin: ${lado3.escena.sala.anchoCm} cm`);
console.log(`  ✓ tres piezas «a la izquierda» no se pisan ni agrandan la sala sin fin (${lado3.escena.sala.anchoCm} cm)`);

// Dos «otro» con la misma pieza del catálogo son dos (una silla a cada lado): solo se descarta lo que la foto leyó como fondo.
const dosSillas = compilarLectura(lectura(panel, otro("silla tapizada a la izquierda"), otro("silla tapizada a la derecha")));
const sillas = dosSillas.escena.nodos.filter((n) => n.id.startsWith("silla-moderna"));
assert.equal(sillas.length, 2, `dos sillas: ${dosSillas.escena.nodos.map((n) => n.id).join(", ")} · ${dosSillas.notas.join(" | ")}`);
assert.ok(!dosSillas.notas.some((n) => n.includes("ya está leída")), "la segunda silla no se toma por ya leída");
const [xIzquierda, xDerecha] = sillas.map((n) => xDe(dosSillas, n.id)) as [number, number];
assert.ok(xIzquierda < 0 && xDerecha > 0, `cada silla de su lado: ${xIzquierda} y ${xDerecha}`);
console.log("  ✓ dos otro con la misma pieza del catálogo (silla a la izquierda y a la derecha) dan dos, cada una de su lado");

// Lo que empieza por el fondo y nombra después una pieza la arma; un florero con globos queda en omitidas (antes era fondo sin pieza).
const despues = compilarLectura(lectura(otro("pared blanca, mesa de postres dorada a la izquierda"), otro("florero con globos metálicos dorados")));
assert.ok(despues.escena.nodos.some((n) => n.id.startsWith("mesa-postres")), "la mesa de postres nombrada tras la coma se arma");
assert.deepEqual(despues.omitidas, ["florero con globos metálicos dorados"], "el florero con globos es capacidad que falta");
console.log("  ✓ la pieza nombrada tras el fondo se arma y el florero con globos queda en omitidas");

console.log("test-lectura-otro: ok");
