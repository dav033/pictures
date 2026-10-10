/**
 * Las figuras que el lector escribe como `otro` (W4, hueco de «falta_figura»): el taller ya tiene las piezas (la biblioteca de decoraciones
 * y la forma rellena de la IA de escena), lo que faltaba era la puerta.
 * - el reconocimiento por descripción (`lectura-otro-figura.ts`): calabazas, espirales y rizos, flores de globos y un número o una letra
 *   rellenos de globos; y lo que NO se arma queda pendiente: globos de foil con forma (la tienda no los vende), papel, tela, peluche,
 *   plantas, una descripción a medias;
 * - de la lectura a la escena (`figuras-lectura.ts`): dónde cae cada una, qué dice la nota y que la lista de compra trae sus globos;
 * - de la herramienta a la pieza: `agregar_pieza` con `forma` y `texto` da la misma pieza que arma la compilación, y los ids que usa la
 *   compilación son los de `decoracion_id`;
 * - el esquema que se manda a Gemini sigue en su presupuesto (`test-esquema-gemini.ts` lo vigila; aquí se imprimen los bytes).
 * Las descripciones son las que devolvió el lector en la pasada 2 del arnés (corrida 2026-10-10T17-07-01-532Z, las 30 fotos del dueño).
 *
 * Run: NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-figuras-lectura.ts
 */
import assert from "node:assert/strict";
import { armarEscena, type Escena } from "@/lib/globos3d/escena";
import { compilarLectura } from "@/lib/globos3d/compilar-lectura";
import { LecturaFotoSchema } from "@/lib/globos3d/lectura-foto";
import { resolverOtro } from "@/lib/globos3d/lectura-otro";
import { DECLARACIONES_ESCENA, aplicarHerramienta } from "@/lib/globos3d/herramientas-escena";
import { DECORACIONES_PREDEFINIDAS } from "@/lib/globos3d/figuras";
import type { FiguraOtro } from "@/lib/globos3d/lectura-otro-figura";

let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };

const decoracion = (id: string, cantidad: number, colores: string[], sobreEstructura: boolean, cantidadSupuesta = false): FiguraOtro => ({ clase: "decoracion", id, cantidad, cantidadSupuesta, colores, sobreEstructura });
const texto = (valor: string, colores: string[], gigante = false): FiguraOtro => ({ clase: "texto", texto: valor, colores, gigante });
const figurasDe = (descripcion: string) => { const r = resolverOtro(descripcion); return r.tipo === "figura" ? r.figuras : assert.fail(`«${descripcion}» debía ser una figura: ${JSON.stringify(r)}`); };

console.log("Figuras de la lectura (arnés W4):");

prueba("se reconocen por la descripción: calabazas, espirales y rizos, flores de globos, un número o una letra rellenos de globos", () => {
  const CASOS: ReadonlyArray<readonly [string, readonly FiguraOtro[]]> = [
    // Las de la pasada 2 (fotos 52, 35 y 44).
    ["calabazas inflables de Halloween de piso a ambos lados", [decoracion("calabaza_grande", 2, [], false)]],
    ["número 1 de caja tipo mosaico, lleno de globos rosa, malva y verde y flores de tela", [texto("1", ["rosa", "malva", "verde"])]],
    ["número 5 de caja tipo mosaico, lleno de globos verde salvia, durazno y rosa con flores de tela y moños", [texto("5", ["verde salvia", "durazno", "rosa"])]],
    ["espirales de foil dorado tipo cinta rizada y flores doradas de globos R-5 pegadas al muro", [decoracion("rizo_voluta", 3, ["dorado"], true, true), decoracion("flor5", 3, ["dorado"], true, true)]],
    // Las de la pasada 1 (las mismas fotos, otra lectura).
    ["dos calabazas de Halloween (jack-o-lantern) en el piso, a la izquierda", [decoracion("calabaza_grande", 2, [], false)]],
    ["número 1 gigante tipo mosaico (caja blanca) lleno de globos rosa, malva y verde con flores y cintas rosas", [texto("1", ["rosa", "malva", "verde"], true)]],
    ["número 6 gigante tipo mosaico (caja blanca) lleno de globos verde menta, rosa y blancos con flores", [texto("6", ["verde menta", "rosa", "blanco"], true)]],
    // La del humo con el CLI (otra lectura de la 35): el adjetivo antes del número, las comillas, «de cartón blanco» y el lugar al final.
    ["número gigante «1» de cartón blanco relleno de globos rosa, malva y menta con rosas, a la izquierda", [texto("1", ["rosa", "malva", "menta"], true)]],
    ["número gigante «5» de cartón blanco relleno de globos menta, rosa y durazno con rosas, a la derecha, apoyado en el piso", [texto("5", ["menta", "rosa", "durazno"], true)]],
    // Variantes: la cantidad que dice, el plural a secas, dos números en una descripción, una letra, el tubito en espiral o en resorte.
    ["una calabaza grande en el piso", [decoracion("calabaza_grande", 1, [], false)]],
    ["calabaza con sombrero de bruja en el piso", [decoracion("calabaza_bruja", 1, [], false)]],
    ["calabazas de Halloween", [decoracion("calabaza_grande", 3, [], false, true)]],
    ["número 15 de globos dorados", [texto("15", ["dorado"])]],
    ["número 1 y número 5 llenos de globos rosa", [texto("1", ["rosa"]), texto("5", ["rosa"])]],
    ["números 1 y 5 llenos de globos rosa", [texto("1", ["rosa"]), texto("5", ["rosa"])]],
    ["número 1 y 5 llenos de globos rosa", [texto("1", ["rosa"]), texto("5", ["rosa"])]],
    ["números grandes 1 y 5 llenos de globos rosa", [texto("1", ["rosa"]), texto("5", ["rosa"])]],
    ["número 1 lleno de globos metálicos dorados", [texto("1", ["dorado"])]],
    ["número 1 de globos verdes y azules", [texto("1", ["verde", "azul"])]],
    ["letra A de caja rellena de globos blancos y dorados", [texto("A", ["blanco", "dorado"])]],
    // El color de la figura es el que sigue a su nombre, no el de su soporte («sobre base dorada», «de cartón blanco») ni el de su lugar.
    ["número 1 de globos rosa sobre base dorada", [texto("1", ["rosa"])]],
    ["número 1 lleno de globos rosa y verde, de cartón blanco", [texto("1", ["rosa", "verde"])]],
    ["calabazas naranjas en el piso", [decoracion("calabaza_grande", 3, [], false, true)]],
    ["rizos dorados entre los globos de la guirnalda", [decoracion("rizo_tirabuzon", 3, ["dorado"], true, true)]],
    ["flores de globos blancas sobre el arco", [decoracion("flor5", 3, ["blanco"], true, true)]],
    ["tres rizos rosados", [decoracion("rizo_tirabuzon", 3, ["rosado"], true)]],
    ["un resorte plateado entre los globos", [decoracion("rizo_resorte", 1, ["plateado"], true)]],
    ["volutas doradas y plateadas", [decoracion("rizo_voluta", 3, ["dorado", "plateado"], true, true)]],
    ["flores de globos R-5 rosadas", [decoracion("flor5", 3, ["rosado"], true, true)]],
  ];
  for (const [descripcion, esperadas] of CASOS) assert.deepEqual(figurasDe(descripcion), esperadas, descripcion);
  const aLaIzquierda = resolverOtro("dos calabazas de Halloween (jack-o-lantern) en el piso, a la izquierda");
  assert.ok(aLaIzquierda.tipo === "figura" && aLaIzquierda.lado === -1, "el lado sale de la descripción");
  const aLaDerecha = resolverOtro("número gigante «5» de cartón blanco relleno de globos menta, rosa y durazno con rosas, a la derecha, apoyado en el piso");
  assert.ok(aLaDerecha.tipo === "figura" && aLaDerecha.lado === 1, "y el del número");
});

prueba("lo que el taller no arma queda pendiente: foil con forma, papel, tela, peluche, plantas, y una descripción a medias (nada se arma dejando caer parte de lo que dice)", () => {
  const PENDIENTES = [
    "globo de foil de murciélago negro arriba a la izquierda",
    "globo de foil de cabeza de gato negro arriba a la derecha",
    "globo de foil de gato negro al centro-abajo, con cara de calabaza",
    "figura negra de foil con cara (gato o calabaza) al centro, abajo, y figura crema de foil cerca",
    "dos mariposas grandes de foil lila y blanco sobre el arco",
    "mariposas rosas metálicas pegadas en la pared",
    "flor de cartón naranja en la parte superior izquierda",
    "flor de papel naranja sobre la pared, arriba a la izquierda del arco",
    "flores de tela rosas entre los globos",
    "flores doradas de adorno",
    "calabazas de papel pegadas en la pared",
    "calabazas naturales a los lados",
    "rizos de papel crepé rosados",
    "oso de peluche blanco con lazo rosa, sentado a la izquierda",
    "muñeco de nieve con regalos rosados con moños",
    "copos de nieve blancos de papel sobre la guirnalda y en la pared",
    "árbol de navidad plateado pequeño sobre el piso",
    "dos arbustos de boj en macetas doradas a los lados del piso",
    "maceta blanca con planta verde de hojas esféricas",
    "letras gigantes blancas ONE con mesa de dulces: frascos dorados, cajitas, torta dorada, jaulas con velas",
    "letra gigante blanca O a la derecha, detrás de la guirnalda",
    "letras doradas en la pared (…ithday, cortadas por el borde izquierdo)",
    "número 5 blanco de madera rodeado de globos",
    "letra O gigante blanca con una guirnalda de globos al lado",
    // Una parte se reconoce y la otra no.
    "rizos dorados metálicos entre los globos y flores doradas de adorno",
    "calabazas y arañas negras en el piso",
    "calabazas, arañas y fantasmas de papel",
    "calabazas con arañas negras en el piso",
    "calabazas, con fantasmas",
    "número 5 de caja lleno de globos rosa y una mesa de dulces al lado",
    "número 5 lleno de globos rosa con un oso de peluche al lado",
    // Números juntos o letras de punto de referencia: no se deja caer ninguno.
    "número 2 relleno de globos rosa, a la izquierda de la letra o",
    "número 2 lleno de globos rosa, letra a la izquierda",
    "número 1 de caja tipo mosaico con globos rosa",
    // Un color que no es de la figura: lo que hay al lado, su lugar, lo que lleva.
    "calabaza inflable y globos negros",
    "calabaza sobre piso negro",
    "calabaza frente a la pared rosa",
    "calabazas blancas con rosas",
    "calabaza con sombrero negro",
    // Foil o metálico es otro producto (la tienda vende el número de foil y la calabaza de foil).
    "calabaza metálica naranja",
    "calabaza de globo metálico",
    "calabaza cromada",
    "número 1 de globos metálicos dorados",
    "número 1 de globos de foil dorado",
    "número 15 de globos metálicos plateados",
    // Dónde dice que está no es el piso (ni la estructura).
    "calabazas pegadas en la pared",
    "calabazas arriba a la izquierda",
    "espirales doradas colgando del techo",
    "flores de globos en el techo",
    // Flores de globos son de globos; «entre los globos» no lo dice (pueden ser de tela o naturales).
    "flores blancas entre los globos de la guirnalda",
    "flores blancas entre los globos",
    // Un producto distinto (foil) o en otro sitio (colgadas del techo).
    "calabaza de foil naranja",
    "calabazas colgadas del techo",
  ];
  for (const descripcion of PENDIENTES) assert.equal(resolverOtro(descripcion).tipo, "pendiente", `«${descripcion}»: ${JSON.stringify(resolverOtro(descripcion))}`);
});

prueba("un arreglo de pampas en el piso es el jarrón de pampas del catálogo; entre los globos o en la guirnalda son follaje y no", () => {
  for (const d of [
    "pampas crema y dorados con flores blancas al pie del arco, en el piso",
    "arreglo de flores rosas, pampas y ramas secas al pie de la columna, en el piso",
    "arreglo de flores rosas, pampas y ramas secas apoyado en el piso al pie de la guirnalda",
  ]) {
    const r = resolverOtro(d);
    assert.ok(r.tipo === "catalogo" && r.id === "jarron_pampas", `«${d}»: ${JSON.stringify(r)}`);
  }
  for (const d of ["pampas doradas entre los globos de la guirnalda", "arreglo de globos con pampas al pie del arco", "pampas sobre la guirnalda y racimos de globos en el piso", "pampas en la guirnalda", "pampas con globos al pie del arco", "arreglo de pampas y globos blancos en el piso", "pampas y globos dorados en el piso"]) {
    assert.equal(resolverOtro(d).tipo, "pendiente", d);
  }
});

// --- De la lectura a la escena -------------------------------------------------------------------------------------------------------
const ORO = { nombre: "dorado", hex: "#d4af37", peso: 100, acabado: "cromado" as const };
const base = { aspecto: 1.5, escala: { altoImagenCm: 250, referencia: "mesa de 75 cm" }, pisoY: 0.9, sala: { pared: "#ffffff", piso: "#cccccc" } };
const guirnalda = { tipo: "guirnalda_organica" as const, puntos: [{ x: 0.25, y: 0.28, grosor: 0.14 }, { x: 0.5, y: 0.27, grosor: 0.14 }, { x: 0.75, y: 0.28, grosor: 0.14 }], tamanos: {}, racimos: 0.6, colores: [ORO] };
const lectura = (...piezas: unknown[]) => LecturaFotoSchema.parse({ resumen: "prueba de figuras", ...base, piezas });
const otro = (descripcion: string) => ({ tipo: "otro" as const, descripcion });
const compilar = (...descripciones: string[]) => compilarLectura(lectura(guirnalda, ...descripciones.map(otro)));
const sinFiguras = compilarLectura(lectura(guirnalda));
const materiales = (escena: Escena) => new Map(armarEscena(escena).materiales.map((m) => [`${m.formatoId}|${m.codigo}`, m.cantidad]));
/** Lo que la lista de compra suma por las figuras: los globos de más sobre la escena con solo la guirnalda. */
function globosDeLasFiguras(r: ReturnType<typeof compilar>): Map<string, number> {
  const antes = materiales(sinFiguras.escena), despues = materiales(r.escena);
  return new Map([...despues].flatMap(([clave, n]) => (n - (antes.get(clave) ?? 0) > 0 ? [[clave, n - (antes.get(clave) ?? 0)] as const] : [])));
}
const nuevos = (r: ReturnType<typeof compilar>) => r.escena.nodos.filter((n) => !sinFiguras.escena.nodos.some((m) => m.id === n.id));

prueba("las calabazas se arman con la calabaza de la biblioteca, una a cada lado si dice «a ambos lados», y la lista de compra trae sus globos", () => {
  const r = compilar("calabazas inflables de Halloween de piso a ambos lados");
  const calabazas = nuevos(r);
  assert.deepEqual(calabazas.map((n) => n.pieza.tipo), ["decoracion", "decoracion"]);
  assert.ok(calabazas.every((n) => n.colocacion.en === "piso" && n.id.startsWith("calabaza-grande")), JSON.stringify(calabazas.map((n) => n.colocacion)));
  const xs = calabazas.map((n) => (n.colocacion.en === "piso" ? n.colocacion.xCm : 0));
  assert.ok(Math.min(...xs) < 0 && Math.max(...xs) > 0, `una a cada lado: ${xs.join(", ")}`);
  assert.deepEqual([...globosDeLasFiguras(r)].sort(), [["R-24|061", 2], ["T-160|031", 2], ["T-260|031", 6]], "por calabaza: un R-24 naranja, tres T-260 y un T-160 verdes");
  assert.deepEqual(r.omitidas, []);
  assert.ok(r.notas.some((n) => n.includes("Calabaza grande de la biblioteca (2 copias)") && n.includes("La de la foto es inflable; esta se arma de globos") && n.includes("Ajústala")), r.notas.join(" | "));
  const izquierda = compilar("dos calabazas de Halloween (jack-o-lantern) en el piso, a la izquierda");
  assert.ok(nuevos(izquierda).every((n) => n.colocacion.en === "piso" && n.colocacion.xCm < 0), "«a la izquierda»: las dos de ese lado");
});

prueba("un número relleno de globos es la forma rellena de ese texto, de pie en el piso, con los colores de la descripción (los que la tabla no tiene, por su parecido, dicho en la nota)", () => {
  const r = compilar("número 5 de caja tipo mosaico, lleno de globos verde salvia, durazno y rosa con flores de tela y moños");
  const [numero] = nuevos(r);
  assert.ok(numero && numero.pieza.tipo === "forma" && numero.id === "numero-globos" && numero.colocacion.en === "piso", JSON.stringify(numero?.colocacion));
  const forma = numero.pieza.tipo === "forma" ? numero.pieza.forma : null;
  assert.ok(forma?.clase === "rellena" && forma.contorno.tipo === "texto" && forma.contorno.texto === "5", "el contorno es el texto «5»");
  assert.deepEqual(forma.colores.codigos, ["826", "060", "011"], "verde salvia → verde menta (826), durazno (060), rosa (011)");
  const bom = globosDeLasFiguras(r);
  for (const clave of ["R-12|826", "R-12|060", "R-12|011", "R-5|826", "R-5|060", "R-5|011"]) assert.ok((bom.get(clave) ?? 0) > 0, `la lista de compra trae ${clave}: ${[...bom.keys()].join(", ")}`);
  const alto = armarEscena(r.escena).porNodo.find((n) => n.id === "numero-globos")!.caja;
  assert.ok(alto.max.y - alto.min.y > 110 && alto.max.y - alto.min.y < 150, `unos 120 cm de alto: ${(alto.max.y - alto.min.y).toFixed(0)}`);
  assert.ok(r.notas.some((n) => n.includes("«5» de globos") && n.includes("solo se arman los globos del número") && n.includes("verde salvia → verde menta") && n.includes("120 cm de alto")), r.notas.join(" | "));
  assert.deepEqual(r.omitidas, []);
  const gigante = compilar("número 1 gigante tipo mosaico lleno de globos rosa y blanco");
  assert.ok(armarEscena(gigante.escena).porNodo.find((n) => n.id === "numero-globos")!.caja.max.y > alto.max.y, "«gigante» sale más alto");
  const sinColor = compilar("número 3 de caja lleno de globos");
  assert.deepEqual((nuevos(sinColor)[0]!.pieza as { forma: { colores: { codigos: string[] } } }).forma.colores.codigos, ["005"], "sin color dicho, blanco");
  assert.ok(sinColor.notas.some((n) => n.includes("la descripción no dice el color")));
  const dos = compilar("número 1 de caja lleno de globos rosa", "número 5 de caja lleno de globos rosa");
  assert.deepEqual(nuevos(dos).map((n) => n.id), ["numero-globos", "numero-globos-2"], "dos números, dos piezas");
  assert.deepEqual(nuevos(compilar("número 1 y número 5 llenos de globos rosa")).map((n) => n.id), ["numero-globos", "numero-globos-2"], "dos números en una descripción, también");
  // Como lo escribió el lector con el CLI (humo del arnés, foto 35): cada número del lado que dice, y la nota no dice que falte el color.
  const humo = compilar(
    "número gigante «1» de cartón blanco relleno de globos rosa, malva y menta con rosas, a la izquierda",
    "número gigante «5» de cartón blanco relleno de globos menta, rosa y durazno con rosas, a la derecha, apoyado en el piso",
  );
  const [uno, cinco] = nuevos(humo);
  assert.ok(uno?.colocacion.en === "piso" && cinco?.colocacion.en === "piso" && uno.colocacion.xCm < 0 && cinco.colocacion.xCm > 0, JSON.stringify([uno?.colocacion, cinco?.colocacion]));
  assert.deepEqual(humo.omitidas, []);
  assert.ok(humo.notas.some((n) => n.includes("150 cm de alto") && n.includes("malva → lila")), humo.notas.join(" | "));
  // Los colores que dice y la tabla no tiene ni por parecido no se tapan con «no dice el color».
  const raro = compilar("número 2 de caja lleno de globos turquesa fosforescente");
  assert.deepEqual(raro.omitidas, ["número 2 de caja lleno de globos turquesa fosforescente"], "una palabra que no se conoce («fosforescente») deja la descripción entera pendiente");
  const sinTabla = compilar("número 2 de caja lleno de globos beige");
  assert.ok(sinTabla.notas.some((n) => n.includes("beige → nude")), sinTabla.notas.join(" | "));
});

prueba("los rizos y las flores de globos se apoyan en la estructura de más globos, repartidos y sin encimarse, con el color dicho", () => {
  const r = compilar("espirales de foil dorado tipo cinta rizada y flores doradas de globos R-5 pegadas al muro");
  const figuras = nuevos(r);
  assert.equal(figuras.length, 6, figuras.map((n) => n.id).join(", "));
  assert.ok(figuras.every((n) => n.colocacion.en === "sobre" && n.colocacion.padreId === "guirnalda-organica"), JSON.stringify(figuras.map((n) => n.colocacion)));
  const puntos = figuras.map((n) => (n.colocacion.en === "sobre" ? JSON.stringify(n.colocacion.puntoCm) : ""));
  assert.equal(new Set(puntos).size, 6, "seis sitios distintos: rizos y flores no se encorvan en el mismo punto");
  assert.equal(figuras.filter((n) => n.id.startsWith("rizo-voluta")).length, 3);
  assert.equal(figuras.filter((n) => n.id.startsWith("flor5")).length, 3);
  assert.deepEqual([...globosDeLasFiguras(r)].sort(), [["R-5|570", 18], ["T-260|570", 3]], "dorado: tres volutas de T-260 y tres flores de cinco pétalos y centro de R-5");
  assert.ok(r.notas.some((n) => n.includes("Voluta (espiral plana) de la biblioteca (3 copias: ") && n.includes("Lo de la foto es de foil; esto se arma de globos de látex")), r.notas.join(" | "));
  assert.deepEqual(r.omitidas, []);
  // Sin ninguna estructura de globos donde apoyarlas, van a la pared del fondo.
  const sola = compilarLectura(lectura(otro("tres rizos rosados")));
  assert.deepEqual(sola.escena.nodos.map((n) => n.colocacion.en), ["pared", "pared", "pared"]);
  assert.ok(sola.notas.some((n) => n.includes("no hay estructura de globos donde apoyarla")));
  assert.equal(new Set(sola.escena.nodos.map((n) => (n.colocacion.en === "pared" ? n.colocacion.aLoLargoCm : 0))).size, 3, "repartidos en la pared");
  // Lo que cae en la pared por falta de estructura se reparte entre todas las figuras, no cada una desde cero…
  const variasEnPared = compilarLectura(lectura(otro("espirales doradas y flores doradas de globos R-5 pegadas al muro"), otro("tres resortes plateados")));
  assert.equal(variasEnPared.escena.nodos.length, 9);
  const enLaPared = variasEnPared.escena.nodos.map((n) => (n.colocacion.en === "pared" ? `${n.colocacion.aLoLargoCm}/${n.colocacion.alturaCm}` : "?"));
  assert.equal(new Set(enLaPared).size, 9, `nueve sitios distintos en la pared: ${enLaPared.join(" ")}`);
  const ancho = variasEnPared.escena.sala.anchoCm;
  assert.ok(variasEnPared.escena.nodos.every((n) => n.colocacion.en === "pared" && Math.abs(n.colocacion.aLoLargoCm) <= ancho / 2 - 40), "ninguno se sale de la sala");
  // Muchas copias: no se salen de la sala (otra hilera más arriba) y, sobre una estructura, las que no caben van a la pared.
  const muchas = compilarLectura(lectura(otro("seis espirales y seis resortes y seis flores de globos R-5")));
  assert.ok(muchas.escena.nodos.length >= 12 && muchas.escena.nodos.every((n) => n.colocacion.en === "pared" && Math.abs(n.colocacion.aLoLargoCm) <= muchas.escena.sala.anchoCm / 2 - 40), "doce o más en la pared, dentro de la sala");
  const columnaFina = compilarLectura(lectura({ tipo: "columna_organica" as const, forma: "recta" as const, x: 0.5, yBase: 0.9, yArriba: 0.3, ancho: 0.15, grosor: 0.12, tamanos: {}, racimos: 0.3, colores: [ORO] }, otro("seis resortes plateados y seis flores de globos R-5")));
  const sobreLaColumna = columnaFina.escena.nodos.filter((n) => n.colocacion.en === "sobre").length;
  assert.ok(sobreLaColumna >= 2 && sobreLaColumna < 12, `en una columna fina no caben las doce: ${sobreLaColumna} sobre ella, el resto en la pared`);
  assert.ok(columnaFina.notas.some((n) => n.includes("en la pared del fondo (donde la estructura no tiene globos)")), columnaFina.notas.join(" | "));
  // …y lo que cae en la estructura, entre todas las descripciones.
  const dosDescripciones = compilar("tres rizos rosados", "flores de globos R-5 rosadas");
  const sitios = nuevos(dosDescripciones).map((n) => (n.colocacion.en === "sobre" ? JSON.stringify(n.colocacion.puntoCm) : n.colocacion.en === "pared" ? `pared ${n.colocacion.aLoLargoCm}/${n.colocacion.alturaCm}` : "?"));
  assert.equal(sitios.length, 6);
  assert.equal(new Set(sitios).size, 6, `dos descripciones sobre la misma guirnalda no se encimen, estén en la estructura o en la pared: ${sitios.join(" ")}`);
  assert.ok(r.notas.some((n) => n.includes("3 copias: la descripción solo dice el plural, y se supuso esa cuenta")), "la cuenta supuesta se dice");
});

prueba("una lectura completa de la pasada 2 (guirnalda, calabazas, número, espirales y un globo de foil): se arma lo que el taller sabe y «No pude» queda solo con lo demás", () => {
  const r = compilar(
    "calabazas inflables de Halloween de piso a ambos lados",
    "número 5 de caja tipo mosaico, lleno de globos verde salvia, durazno y rosa con flores de tela y moños",
    "espirales de foil dorado tipo cinta rizada y flores doradas de globos R-5 pegadas al muro",
    "globo de foil de murciélago negro arriba a la izquierda",
    "pampas crema y dorados con flores blancas al pie del arco, en el piso",
  );
  assert.deepEqual(r.omitidas, ["globo de foil de murciélago negro arriba a la izquierda"], "el foil con forma no se arma: queda dicho tal cual");
  assert.deepEqual(nuevos(r).map((n) => n.id).sort(), ["calabaza-grande", "calabaza-grande-2", "flor5", "flor5-2", "flor5-3", "jarron-pampas", "numero-globos", "rizo-voluta", "rizo-voluta-2", "rizo-voluta-3"]);
  assert.ok(armarEscena(r.escena).globos.length > armarEscena(sinFiguras.escena).globos.length + 50, "los globos de las figuras están en el armado");
  // Una descripción a medias no se arma a medias: queda entera en omitidas.
  assert.deepEqual(compilar("rizos dorados metálicos entre los globos y flores doradas de adorno").omitidas, ["rizos dorados metálicos entre los globos y flores doradas de adorno"]);
});

// --- De la herramienta a la pieza ------------------------------------------------------------------------------------------------------
prueba("`agregar_pieza` con `forma` y `texto` da la misma pieza que arma la compilación; el alto cambia, el ancho sale del texto, y lo que no se dibuja se rechaza con su porqué", () => {
  const vacia: Escena = { sala: sinFiguras.escena.sala, nodos: [] };
  const hecha = aplicarHerramienta(vacia, "agregar_pieza", { tipo: "forma", texto: "5", alto_cm: 120, tecnica: "organico", colores: ["verde menta", "durazno", "rosa"] });
  assert.ok(hecha.ok, hecha.ok ? "" : hecha.error);
  const compilada = compilar("número 5 de caja tipo mosaico, lleno de globos verde salvia, durazno y rosa");
  assert.deepEqual(hecha.escena.nodos[0]!.pieza, nuevos(compilada)[0]!.pieza, "la compilación usa la misma ruta que la IA de escena");
  assert.equal(hecha.escena.nodos[0]!.colocacion.en, "piso", "de pie en el piso, como una esfera o un cono");
  assert.ok(hecha.escena.nodos[0]!.nombre.includes("«5»"));
  const id = hecha.escena.nodos[0]!.id;
  const baja = aplicarHerramienta(hecha.escena, "cambiar_pieza", { id, alto_cm: 90 });
  assert.ok(baja.ok, baja.ok ? "" : baja.error);
  const caja = (e: Escena) => armarEscena(e).porNodo.find((n) => n.id === id)!.caja;
  assert.ok(caja(baja.escena).max.y < caja(hecha.escena).max.y, "con alto_cm 90 baja");
  const ancho = aplicarHerramienta(hecha.escena, "cambiar_pieza", { id, ancho_cm: 90 });
  assert.ok(!ancho.ok && /sale de su alto/.test(ancho.error), ancho.ok ? "" : ancho.error);
  const larga = aplicarHerramienta(vacia, "agregar_pieza", { tipo: "forma", texto: "123456", alto_cm: 250 });
  assert.ok(!larga.ok && /mide \d+ cm de ancho y una forma llega a 300 cm/.test(larga.error), larga.ok ? "" : larga.error);
  const rara = aplicarHerramienta(vacia, "agregar_pieza", { tipo: "forma", texto: "!?", alto_cm: 100 });
  assert.ok(!rara.ok && /No sé dibujar/.test(rara.error), rara.ok ? "" : rara.error);
  const corazon = aplicarHerramienta(vacia, "agregar_pieza", { tipo: "forma", figura: "corazon", texto: "5" });
  assert.ok(corazon.ok && corazon.escena.nodos[0]!.nombre.startsWith("Corazón"), "con figura, la figura manda");
});

prueba("los ids con que se arman las figuras son los de `decoracion_id`: la IA de escena los pone con la misma pieza y los mismos globos", () => {
  const ids = ["calabaza_grande", "rizo_voluta", "rizo_tirabuzon", "rizo_resorte", "flor5"];
  const existentes = new Set(DECORACIONES_PREDEFINIDAS.map((d) => d.id));
  for (const id of ids) assert.ok(existentes.has(id), `la biblioteca ya no tiene «${id}»`);
  const vacia: Escena = { sala: sinFiguras.escena.sala, nodos: [] };
  for (const id of ids) {
    const hecha = aplicarHerramienta(vacia, "agregar_pieza", { tipo: "decoracion", decoracion_id: id });
    assert.ok(hecha.ok, hecha.ok ? "" : hecha.error);
    assert.ok(armarEscena(hecha.escena).materiales.length > 0, `${id}: trae globos en la lista de compra`);
  }
  const compilada = compilar("dos calabazas de Halloween en el piso");
  const deLaIa = aplicarHerramienta(vacia, "agregar_pieza", { tipo: "decoracion", decoracion_id: "calabaza_grande" });
  assert.ok(deLaIa.ok);
  assert.deepEqual(materiales(deLaIa.escena).get("R-24|061"), 1);
  assert.equal(materiales(compilada.escena).get("R-24|061"), 2, "dos calabazas, dos R-24");
});

prueba("la IA de escena sabe que puede poner figuras y números rellenos: está dicho en la declaración, y el esquema sigue en su presupuesto", () => {
  const declaraciones = JSON.stringify(DECLARACIONES_ESCENA);
  for (const frase of ["rizos, calabazas, figuras de globos", "el número o la letra que se rellena de globos", "o un número o letra relleno (texto)"]) assert.ok(declaraciones.includes(frase), `falta «${frase}» en las declaraciones`);
  const bytes = DECLARACIONES_ESCENA.reduce((suma, d) => suma + Buffer.byteLength(JSON.stringify(d)), 0);
  console.log(`    declaraciones de la IA de escena: ${DECLARACIONES_ESCENA.length} herramientas, ${bytes} B de ${120 * 1024}`);
  assert.ok(bytes <= 120 * 1024, `${bytes} B`);
});

console.log(`test-figuras-lectura: ${pruebas} pruebas ok`);
