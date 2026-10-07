import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { ESTRUCTURAS_OFICIALES_IDS } from "@/lib/plan/estructuras-oficiales";
import { nombreGlobosCliente } from "@/components/guiado/formato";
import { presentacionMaterialGuiado } from "@/lib/ia/guiado/presentacion-material-guiado";
import { pasosParaCliente } from "@/lib/ia/guiado/pasos-cliente";

type Material = { variantId: string; sku: string | null; cantidad: number; nota?: string; origenCantidad?: string; detalleCantidad?: string };
type Decoracion = { id: string; origen: string; titulo: string; tematica: string; fotos: Array<{ url: string; fuente: string }>; materiales: Material[]; piezas: Array<{ estructura: string; cantidad: number }>; pasos: Array<{ texto: string }>; paleta?: string[] };
type Compra = { variant_id: string; sku: string | null; titulo: string; tamano_codigo: string | null; unidades_necesarias: number };
type PlanGuardado = {
  estado: string;
  plan_resuelto: { compras: Compra[]; plan: { estructuras: Array<{ estructura_id: string; estructura_oficial?: string; armado_columna?: { remate: { tipo: string; tamano: number; material: number } } }> } };
  extras_foto?: Array<{ variantId: string; sku: string | null; cantidad: number; nota: string }>;
};
type Elemento = { element_id: string; approved: boolean; category: string; visual_semantics?: { structure_type?: string }; appearance: { remate_columna?: { tipo: string; color?: string }; tamanos_leidos?: string } };

const datos = JSON.parse(readFileSync("src/lib/biblioteca-sempertex/decoraciones.json", "utf8")) as Decoracion[];
const reales = datos.filter((item) => item.origen === "referencia_real");
// Las del script salen de sus fotos «real-NN-…» resueltas por Python (con la corrección de la auditoría de fotos del
// 2026-10-06); las curadas, de las fotos oficiales de Sempertex. Todas dicen de dónde sale cada cantidad.
const delScript = reales.filter((item) => /\/referencias\/real-\d{2}-/.test(item.fotos[0]?.url ?? ""));
const curadas = reales.filter((item) => !delScript.includes(item));
assert.equal(delScript.length, 20, "publica 20 decoraciones reales del script");
assert.equal(curadas.length, 11, "publica 11 decoraciones curadas de las fotos de Sempertex");

function porNumero(numero: number): Decoracion {
  const prefijo = `deco-real-${String(numero).padStart(2, "0")}-`;
  const decoracion = reales.find((item) => item.id.startsWith(prefijo));
  assert.ok(decoracion, `falta decoración ${numero}`);
  return decoracion;
}
function cantidades(numero: number): Map<string, number> {
  const resultado = new Map<string, number>();
  for (const item of porNumero(numero).materiales) {
    const color = item.nota?.split(" · ").at(-1)?.toLocaleLowerCase("es") ?? "";
    resultado.set(color, (resultado.get(color) ?? 0) + item.cantidad);
  }
  return resultado;
}
function exigirColores(numero: number, esperados: string[]): void {
  const presentes = cantidades(numero);
  for (const color of esperados) assert.ok((presentes.get(color) ?? 0) > 0, `deco-real-${numero}: falta ${color} (hay ${[...presentes.keys()].join(", ")})`);
}
function prohibirColores(numero: number, prohibidos: string[]): void {
  const presentes = cantidades(numero);
  for (const color of prohibidos) assert.ok(!presentes.has(color), `deco-real-${numero}: no debería llevar ${color}`);
}
/** Unidades de un producto (por su título en la nota) en una talla («R-36»), o en todas. */
function unidades(numero: number, producto: RegExp, talla?: string): number {
  return porNumero(numero).materiales.filter((material) => producto.test(material.nota ?? "") && (!talla || (material.nota ?? "").split(" · ")[1] === talla)).reduce((total, material) => total + material.cantidad, 0);
}
const tallasDe = (decoracion: Decoracion) => new Set(decoracion.materiales.map((material) => /· (R-\d{1,2}) ·/.exec(material.nota ?? "")?.[1]).filter((talla): talla is string => talla !== undefined));
const idAnalisis = (decoracion: Decoracion) => /\/referencias\/(real-\d{2}-[^/]+)\.jpg$/.exec(decoracion.fotos[0]!.url)![1]!;
const planDe = (decoracion: Decoracion) => JSON.parse(readFileSync(path.join("data", "biblioteca-real", "analisis", `${idAnalisis(decoracion)}.plan.json`), "utf8")) as PlanGuardado;
const elementosDe = (decoracion: Decoracion) => (JSON.parse(readFileSync(path.join("data", "biblioteca-real", "analisis", `${idAnalisis(decoracion)}.json`), "utf8")) as { respuesta: { blueprint: { elements: Elemento[] } } }).respuesta.blueprint.elements;

// Todas: foto local, piezas oficiales, una línea por variante, pasos en palabras de cliente, producto real de Sempertex
// con su variante y SKU, y el origen de cada cantidad (Python o la foto) dicho.
for (const decoracion of reales) {
  const foto = decoracion.fotos[0]!;
  const archivo = path.join(process.cwd(), "public", foto.url.slice(1));
  assert.ok(foto.url.startsWith("/biblioteca-sempertex/referencias/") && foto.url.endsWith(".jpg") && existsSync(archivo), `${decoracion.id}: foto local`);
  const cabecera = readFileSync(archivo).subarray(0, 3);
  assert.ok(cabecera[0] === 0xff && cabecera[1] === 0xd8 && cabecera[2] === 0xff, `${decoracion.id}: la foto es un JPG`);
  assert.ok(decoracion.piezas.length > 0 && decoracion.piezas.every((pieza) => (ESTRUCTURAS_OFICIALES_IDS as readonly string[]).includes(pieza.estructura) && pieza.cantidad > 0), `${decoracion.id}: piezas oficiales`);
  assert.equal(new Set(decoracion.materiales.map((material) => material.variantId)).size, decoracion.materiales.length, `${decoracion.id}: una línea por variante`);
  assert.ok(decoracion.pasos.length >= 4 && decoracion.pasos.length <= 6, `${decoracion.id}: entre 4 y 6 pasos`);
  for (const paso of decoracion.pasos) {
    assert.equal(pasosParaCliente([paso])[0]!.texto, paso.texto, `${decoracion.id}: paso ya en palabras de cliente`);
    assert.ok(!/\b(?:R-\d+|T[12]60|LOL\s?\d+)\b/.test(paso.texto), `${decoracion.id}: paso sin códigos de catálogo («${paso.texto}»)`);
  }
  for (const material of decoracion.materiales) {
    const quien = `${decoracion.id} ${material.variantId}`;
    assert.ok(/^\d{10,}$/.test(material.variantId) && /^B2B-\d+$/.test(material.sku ?? ""), `${quien}: variante y SKU del catálogo`);
    assert.ok(material.cantidad > 0 && material.cantidad < 500, `${quien}: cantidad razonable`);
    // Producto real: el título del catálogo Sempertex («B2b …»), su variante y el color; nunca un «globo de látex» genérico.
    assert.ok(/^B2b .+ — .+ · [^·]+$/.test(material.nota ?? ""), `${quien}: nota «producto — variante · código · color»`);
    assert.ok(["plan_python", "estimado_foto", "plan_python_y_foto"].includes(material.origenCantidad ?? ""), `${quien}: dice de dónde sale la cantidad`);
    if (material.origenCantidad !== "plan_python") assert.match(material.detalleCantidad ?? "", /estimado a partir de la foto/i, `${quien}: lo contado en la foto lo dice`);
    else assert.match(material.detalleCantidad ?? "", /plan/i, `${quien}: lo del plan de Python lo dice`);
    // El nombre que ve el cliente: sin paquetes, marcas ni códigos.
    const nombre = nombreGlobosCliente({ nombre: material.nota });
    assert.ok(!/paquete|b2b|·|\bR-\d|\bT\d{3}\b|\bLOL\b|\bIN\b/i.test(nombre) && nombre.length < 70, `${quien}: nombre de cliente limpio («${nombre}»)`);
    const linea = presentacionMaterialGuiado(material.nota).nombre;
    assert.ok(!/paquete|·|\/ /i.test(linea) && linea !== "Globo de látex", `${quien}: línea de costeo con nombre («${linea}»)`);
  }
}

// Las del script: lo de Python es exactamente su plan guardado (producto, variante, SKU y cantidad), lo contado en la foto
// es exactamente lo que la corrección dejó en el plan, y los impresos/foil/cortinas solo pueden venir de la foto.
for (const decoracion of delScript) {
  const plan = planDe(decoracion);
  assert.equal(plan.estado, "resuelto", `${decoracion.id}: plan Python guardado`);
  const compras = new Map(plan.plan_resuelto.compras.filter((compra) => compra.unidades_necesarias > 0).map((compra) => [compra.variant_id, compra]));
  const extras = new Map((plan.extras_foto ?? []).map((extra) => [extra.variantId, extra]));
  for (const material of decoracion.materiales) {
    const quien = `${decoracion.id} ${material.variantId}`;
    const compra = compras.get(material.variantId);
    const extra = extras.get(material.variantId);
    assert.ok(compra || extra, `${quien}: sale del plan de Python o de lo contado en la foto`);
    if (compra) {
      assert.ok((material.nota ?? "").startsWith(`${compra.titulo} · `) && material.sku === compra.sku, `${quien}: producto y SKU de la compra de Python`);
      assert.equal(material.cantidad, compra.unidades_necesarias + (extra?.cantidad ?? 0), `${quien}: respeta la cantidad de Python`);
      assert.ok(!/(infinity|filigree|grado|2 caras|4 caras|mascara|feliz|cumple|impres[oa]|metalizado|cortina|confetti)/i.test(compra.titulo), `${quien}: Python solo compra látex liso`);
    } else {
      assert.equal(material.origenCantidad, "estimado_foto", `${quien}: lo que Python no modela se cuenta en la foto`);
      assert.equal(material.cantidad, extra!.cantidad, `${quien}: cantidad de la foto tal como la dejó la corrección`);
      assert.equal(material.nota, extra!.nota, `${quien}: nota del catálogo vigente`);
    }
  }
  for (const variante of compras.keys()) assert.ok(decoracion.materiales.some((material) => material.variantId === variante), `${decoracion.id}: ${variante} de Python publicado`);

  // Ninguna columna con remate visible queda solo en 12": el remate de globo de la foto se compra, y en su talla.
  const remates = elementosDe(decoracion).filter((elemento) => elemento.approved && elemento.category === "balloon_structure" && elemento.visual_semantics?.structure_type === "columna" && elemento.appearance.remate_columna?.tipo === "globo");
  if (remates.length) {
    const columnas = plan.plan_resuelto.plan.estructuras.filter((estructura) => estructura.armado_columna);
    assert.ok(columnas.length >= remates.length && columnas.every((estructura) => estructura.armado_columna!.remate.tipo === "globo" && estructura.armado_columna!.remate.tamano > 12), `${decoracion.id}: cada columna con remate de globo lo arma el motor, mayor de 12"`);
    const grandes = decoracion.materiales.filter((material) => /· R-(?:18|24|36) ·/.test(material.nota ?? "") && material.origenCantidad === "plan_python").reduce((total, material) => total + material.cantidad, 0);
    assert.ok(grandes >= remates.length, `${decoracion.id}: ${remates.length} remates en la foto y ${grandes} globos grandes de Python`);
    assert.ok(decoracion.pasos.some((paso) => /Corona .+ con un globo/.test(paso.texto)), `${decoracion.id}: los pasos nombran el remate`);
  }
  // Una foto con tamaños mezclados no se publica con un solo tamaño.
  const mezcladas = elementosDe(decoracion).filter((elemento) => elemento.approved && elemento.category === "balloon_structure" && elemento.appearance.tamanos_leidos && elemento.appearance.tamanos_leidos !== "un_solo_tamano");
  if (mezcladas.length) assert.ok(tallasDe(decoracion).size > 1, `${decoracion.id}: la foto mezcla tamaños y la decoración solo lleva ${[...tallasDe(decoracion)].join(", ")}`);
}

// El caso del dueño (2026-10-06): las dos columnas negras y doradas llevan su bola negra gigante arriba (R-36, una por
// columna), cuerpo de 11 capas de 4 en negro Fashion y dorado Metal (perlado, no cromado), todo producto Sempertex.
assert.equal(unidades(8, /Fashion Negro/, "R-36"), 2, "deco-real-08: 2 globos negros R-36 de remate");
assert.equal(unidades(8, /Fashion Negro/, "R-12"), 44, "deco-real-08: 22 negros de 12\" por columna");
assert.equal(unidades(8, /Metal Dorado/, "R-12"), 44, "deco-real-08: 22 dorados Metal de 12\" por columna");
assert.equal(unidades(8, /Reflex Dorado/), 0, "deco-real-08: el dorado de la foto no es cromado");
// Columna arcoíris por anillos: 11 capas de 4 en seis colores, con dos azules distintos.
const seis = cantidades(6);
assert.deepEqual([seis.get("verde"), seis.get("rojo"), seis.get("azul rey"), seis.get("amarillo"), seis.get("naranja"), seis.get("azul celeste")], [12, 8, 8, 8, 4, 4], "deco-real-06: anillos de la foto");
// Gigantes en el color de la foto.
assert.ok(unidades(7, /Fashion Rosado/, "R-24") >= 2, "deco-real-07: un rosado gigante al pie de cada columna");
assert.ok(unidades(17, /Reflex Dorado Rosa/, "R-24") >= 1 && unidades(17, /Reflex Dorado —/, "R-24") >= 1, "deco-real-17: un remate gigante oro rosa y otro dorado");
assert.ok(unidades(5, /Reflex Dorado Rosa/, "R-24") >= 1, "deco-real-05: oro rosa gigante en la base");
assert.ok(unidades(19, /Reflex Dorado/, "R-24") >= 1, "deco-real-19: dorado gigante");
// Lo que no se ve en la foto no se compra.
assert.equal(unidades(13, /Metalizado/), 0, "deco-real-13: los números «15» no son un bouquet de látex");
assert.ok(!porNumero(13).piezas.some((pieza) => pieza.estructura === "bouquet"), "deco-real-13: sin bouquet");
assert.equal(unidades(16, /Reflex Plata/), 0, "deco-real-16: lo plateado son transparentes con confeti");
assert.equal(unidades(20, /Reflex Azul/), 0, "deco-real-20: el azul medio es estándar, no cromado");
assert.equal(unidades(3, /Fashion Azul Naval/), 0, "deco-real-03: el centro de mesa no lleva azul marino");
assert.equal(unidades(4, /Azul Turquesa Profundo|Fashion Azul —/), 0, "deco-real-04: sin azul cielo ni turquesa estándar");
assert.equal(unidades(7, /Orquidea/i) + unidades(12, /Orquidea/i) + unidades(11, /Orquidea/i), 0, "sin orquídea magenta donde la foto es lavanda o violeta");
assert.equal(unidades(28, /— R-24 \//), 0, "deco-real-28: el mayor de la foto es de 18\"");
assert.equal(unidades(23, /Reflex Plata/), 0, "deco-real-23: el cono es grafito, no plata");

// Lo que se ve en cada foto (productos, colores y piezas), en palabras de la biblioteca.
assert.ok((cantidades(2).get("naranja") ?? 0) > (cantidades(2).get("negro") ?? 0), "deco-real-02 conserva proporción naranja/negro de foto");
exigirColores(2, ["naranja", "negro", "blanco", "verde lima"]);
exigirColores(3, ["azul bebé", "azul rey cromado", "plateado", "blanco", "azul perlado"]);
exigirColores(4, ["verde metal", "verde lima cromado", "azul marino", "azul cromado", "dorado cromado"]);
exigirColores(5, ["oro rosa", "arena", "palo de rosa", "rosa bebé", "rojo frambuesa", "rosa con «feliz día mami»"]);
exigirColores(6, ["verde", "rojo", "azul rey", "amarillo", "naranja", "azul celeste"]);
exigirColores(7, ["rosa bebé", "lavanda", "dorado cromado"]);
exigirColores(9, ["rosa chicle", "rosa blush", "coral", "dorado cromado"]);
exigirColores(10, ["azul pastel", "blanco perla", "plateado", "azul marino", "transparente con confeti"]);
exigirColores(11, ["rosa chicle", "turquesa aguamarina", "lila", "violeta", "blanco"]);
exigirColores(12, ["lila pastel", "morado cromado", "plateado"]);
exigirColores(13, ["oro rosa", "blanco perla"]);
exigirColores(15, ["crema", "dorado cromado", "rojo"]);
exigirColores(16, ["azul marino", "azul cromado", "transparente con confeti", "azul rey"]);
exigirColores(17, ["oro rosa", "dorado cromado", "amarillo pastel", "rosa"]);
exigirColores(18, ["rosa pastel", "transparente con estrellas blancas", "dorado cromado", "blanco"]);
exigirColores(19, ["rosa chicle", "fucsia", "rojo cereza cromado", "dorado cromado", "transparente con confeti"]);
exigirColores(20, ["azul marino", "azul", "azul pastel", "azul celeste"]);
exigirColores(21, ["naranja", "fucsia", "rosa claro", "durazno", "verde eucalipto"]);
exigirColores(22, ["rosa fuerte", "rosa claro", "blanco perlado", "rojo", "«love» rojo y blanco", "rojo con «te amo»"]);
exigirColores(23, ["gris grafito", "negro", "naranja cobrizo", "champaña", "café con leche"]);
exigirColores(24, ["verde eucalipto", "verde té", "champaña", "naranja"]);
exigirColores(25, ["coral", "blanco perla", "vino con «feliz día mamá»", "rosado pastel", "vino", "dorado cromado"]);
exigirColores(26, ["crema", "lila amatista", "rosa perlado", "verde menta"]);
exigirColores(27, ["verde eucalipto", "con copos de nieve", "blanco perla", "dorado cromado"]);
exigirColores(28, ["blanco nácar", "dorado cromado", "nude", "blanco perla"]);
exigirColores(29, ["fucsia", "crema", "amarillo", "verde eucalipto"]);
exigirColores(30, ["verde lima", "negro", "blanco"]);
exigirColores(31, ["verde lima", "negro", "blanco", "blanco con balón de fútbol", "blanco con balones de fútbol"]);
prohibirColores(24, ["dorado"]);
prohibirColores(26, ["durazno"]);
const notas = (numero: number) => porNumero(numero).materiales.map((material) => material.nota ?? "").join(" | ");
assert.match(notas(5), /Feliz Dia Mami/, "deco-real-05: impresos «Feliz Día Mami»");
assert.match(notas(16), /Estrella Azul Rey/, "deco-real-16: estrellas metalizadas azul rey");
assert.match(notas(18), /Infinity® Estrellas/, "deco-real-18: transparentes con estrellas");
assert.match(notas(21), /Tubito/, "deco-real-21: flores de globos para modelar");
assert.match(notas(22), /Metalizado Love/, "deco-real-22: globos metalizados LOVE");
assert.match(notas(22), /Corazones Divertidos — CORAZON 12/, "deco-real-22: corazón «Te amo»");
assert.match(notas(22), /Fashion Rosa — R-5 /, "deco-real-22: la fila de globitos de 5\"");
assert.match(notas(23), /Silk Nuevo Gris Medianoche/, "deco-real-23: cono grafito");
assert.match(notas(24), /Link-O-Loon®.+LOL 6/, "deco-real-24: colgantes de eslabón");
assert.match(notas(24), /Reflex Champaña — R-5/, "deco-real-24: globitos champaña");
assert.match(notas(25), /Feliz Dia Mama/, "deco-real-25: impresos «Feliz día Mamá»");
assert.match(notas(26), /Tubito Pastel Dusk Crema/, "deco-real-26: pétalos crema");
assert.match(notas(27), /Copos De Nieve/, "deco-real-27: esferas impresas con copos");
assert.match(notas(29), /Link-O-Loon®.+LOL 12/, "deco-real-29: arco de eslabones");
assert.match(notas(31), /Balón De Futbol.+R-24/, "deco-real-31: balones gigantes impresos");
const piezas = (numero: number) => porNumero(numero).piezas.map((pieza) => pieza.estructura).join(",");
assert.equal(piezas(7), "columna_asimetrica", "deco-real-07: columnas orgánicas");
assert.equal(piezas(8), "columna");
assert.equal(piezas(11), "guirnalda", "deco-real-11: es una guirnalda en L, no un arco");
assert.equal(piezas(12), "semiarco,columna_asimetrica", "deco-real-12: semiarco y racimo de piso");
assert.equal(piezas(13), "semiarco");
assert.equal(piezas(15), "semiarco,guirnalda", "deco-real-15: el grupo de piso es una guirnalda corta");
assert.equal(piezas(21), "figura", "deco-real-21: arreglo de modelables en maceta → figura");
assert.equal(piezas(23), "figura", "deco-real-23: escultura → figura (la estructura oficial que admite esculturas)");
assert.equal(piezas(27), "aro_circular");
assert.equal(piezas(29), "arco,bouquet");
assert.equal(piezas(30), "columna,figura");
assert.equal(piezas(31), "arco_asimetrico");
assert.ok(!/champagne|champaña/i.test(porNumero(17).titulo), "deco-real-17: sin champaña en el título");
assert.ok(!/arco/i.test(porNumero(11).titulo), "deco-real-11: el título no dice arco");
console.log("test-biblioteca-real-calidad: 31 decoraciones (20 del script y 11 curadas), productos Sempertex reales, tamaños, remates, colores, piezas y nombres coherentes con sus fotos");
