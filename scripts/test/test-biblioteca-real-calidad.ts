import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { ESTRUCTURAS_OFICIALES_IDS } from "@/lib/plan/estructuras-oficiales";
import { nombreGlobosCliente } from "@/components/guiado/formato";
import { presentacionMaterialGuiado } from "@/lib/ia/guiado/presentacion-material-guiado";
import { pasosParaCliente } from "@/lib/ia/guiado/pasos-cliente";

type Material = { variantId: string; sku: string | null; cantidad: number; nota?: string; origenCantidad?: string; detalleCantidad?: string };
type Decoracion = { id: string; origen: string; tematica: string; fotos: Array<{ url: string; fuente: string }>; materiales: Material[]; piezas: Array<{ estructura: string; cantidad: number }>; pasos: Array<{ texto: string }>; paleta?: string[] };
const datos = JSON.parse(readFileSync("src/lib/biblioteca-sempertex/decoraciones.json", "utf8")) as Decoracion[];
const reales = datos.filter((item) => item.origen === "referencia_real");
// Las del script (20, solo R-12) y las curadas a mano sobre fotos oficiales de Sempertex (11, con origen de cada cantidad).
const curadas = reales.filter((item) => item.materiales.every((material) => material.origenCantidad !== undefined));
const delScript = reales.filter((item) => !curadas.includes(item));
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

for (const decoracion of delScript) {
  assert.ok(decoracion.piezas.length > 0, `${decoracion.id}: piezas presentes`);
  assert.ok(decoracion.materiales.length > 0, `${decoracion.id}: materiales presentes`);
  assert.ok(decoracion.materiales.every((material) => material.cantidad > 0 && /R-12/i.test(material.nota ?? "")), `${decoracion.id}: conteo R-12 válido`);
  assert.ok(decoracion.materiales.every((material) => !/(infinity|filigree|grado|2 caras|4 caras|mascara|feliz|cumple|impres[oa])/i.test(material.nota ?? "")), `${decoracion.id}: globos lisos/metálicos, sin impresos ajenos`);
}

const dos = cantidades(2);
assert.ok((dos.get("naranja") ?? 0) > (dos.get("negro") ?? 0), "deco-real-02 conserva proporción naranja/negro de foto");
exigirColores(3, ["azul", "blanco", "plateado"]);
exigirColores(4, ["dorado"]);
exigirColores(6, ["azul", "verde", "amarillo", "rojo", "naranja"]);
exigirColores(7, ["rosado", "morado", "dorado"]);
exigirColores(11, ["turquesa"]);
exigirColores(10, ["azul", "azul marino", "blanco", "plateado"]);
exigirColores(16, ["azul", "azul marino", "plateado"]);
exigirColores(19, ["rosado", "fucsia", "dorado rosa"]);

// Curadas: foto local, variantes válidas, piezas oficiales, cantidades con su origen y nombres de cliente limpios.
for (const decoracion of curadas) {
  const foto = decoracion.fotos[0]!;
  const archivo = path.join(process.cwd(), "public", foto.url.slice(1));
  assert.ok(foto.url.startsWith("/biblioteca-sempertex/referencias/") && foto.url.endsWith(".jpg") && existsSync(archivo), `${decoracion.id}: foto local`);
  const cabecera = readFileSync(archivo).subarray(0, 3);
  assert.ok(cabecera[0] === 0xff && cabecera[1] === 0xd8 && cabecera[2] === 0xff, `${decoracion.id}: la foto es un JPG`);
  assert.ok(/^sempertex-\d{2}\.(?:jpg|png)$/.test(foto.fuente), `${decoracion.id}: archivo de origen de la foto oficial`);
  assert.ok(decoracion.piezas.length > 0 && decoracion.piezas.every((pieza) => (ESTRUCTURAS_OFICIALES_IDS as readonly string[]).includes(pieza.estructura) && pieza.cantidad > 0), `${decoracion.id}: piezas oficiales`);
  assert.ok((decoracion.paleta?.length ?? 0) >= 3, `${decoracion.id}: paleta medida en la foto`);
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
    assert.ok(/^B2b .+ — .+ · [^·]+$/.test(material.nota ?? ""), `${quien}: nota «producto — variante · código · color»`);
    if (material.origenCantidad !== "plan_python") assert.match(material.detalleCantidad ?? "", /estimado a partir de la foto/i, `${quien}: lo contado en la foto lo dice`);
    else assert.match(material.detalleCantidad ?? "", /plan/i, `${quien}: lo del plan de Python lo dice`);
    // El nombre que ve el cliente: sin paquetes, marcas ni códigos.
    const nombre = nombreGlobosCliente({ nombre: material.nota });
    assert.ok(!/paquete|b2b|·|\bR-\d|\bT\d{3}\b|\bLOL\b|\bIN\b/i.test(nombre) && nombre.length < 70, `${quien}: nombre de cliente limpio («${nombre}»)`);
    const linea = presentacionMaterialGuiado(material.nota).nombre;
    assert.ok(!/paquete|·|\/ /i.test(linea) && linea !== "Globo de látex", `${quien}: línea de costeo con nombre («${linea}»)`);
  }
}

// Lo que se ve en cada foto (productos, colores y piezas), en palabras de la biblioteca.
exigirColores(21, ["naranja", "fucsia", "rosa claro", "durazno", "verde eucalipto"]);
exigirColores(22, ["rosa fuerte", "rosa claro", "blanco perlado", "rojo", "«love» rojo y blanco", "rojo con «te amo»"]);
exigirColores(23, ["plateado", "negro", "naranja cobrizo", "champaña", "café con leche"]);
exigirColores(24, ["verde eucalipto", "verde té", "dorado", "naranja"]);
exigirColores(25, ["coral", "blanco perla", "vino con «feliz día mamá»", "rosado pastel", "vino", "dorado cromado"]);
exigirColores(26, ["durazno", "lila amatista", "rosa perlado", "verde menta"]);
exigirColores(27, ["verde eucalipto", "con copos de nieve", "blanco perla", "dorado cromado"]);
exigirColores(28, ["blanco nácar", "dorado cromado", "nude", "blanco perla"]);
exigirColores(29, ["fucsia", "crema", "amarillo", "verde eucalipto"]);
exigirColores(30, ["verde lima", "negro", "blanco"]);
exigirColores(31, ["verde lima", "negro", "blanco", "blanco con balón de fútbol", "blanco con balones de fútbol"]);
const notas = (numero: number) => porNumero(numero).materiales.map((material) => material.nota ?? "").join(" | ");
assert.match(notas(21), /Tubito/, "deco-real-21: flores de globos para modelar");
assert.match(notas(22), /Metalizado Love/, "deco-real-22: globos metalizados LOVE");
assert.match(notas(22), /Corazones Divertidos — CORAZON 12/, "deco-real-22: corazón «Te amo»");
assert.match(notas(24), /Link-O-Loon®.+LOL 6/, "deco-real-24: colgantes de eslabón");
assert.match(notas(25), /Feliz Dia Mama/, "deco-real-25: impresos «Feliz día Mamá»");
assert.match(notas(27), /Copos De Nieve/, "deco-real-27: esferas impresas con copos");
assert.match(notas(29), /Link-O-Loon®.+LOL 12/, "deco-real-29: arco de eslabones");
assert.match(notas(31), /Balón De Futbol.+R-24/, "deco-real-31: balones gigantes impresos");
const piezas = (numero: number) => porNumero(numero).piezas.map((pieza) => pieza.estructura).join(",");
assert.equal(piezas(21), "bouquet");
assert.equal(piezas(23), "figura", "deco-real-23: escultura → figura (la estructura oficial que admite esculturas)");
assert.equal(piezas(27), "aro_circular");
assert.equal(piezas(29), "arco,bouquet");
assert.equal(piezas(30), "columna,figura");
assert.equal(piezas(31), "arco_asimetrico");
console.log("test-biblioteca-real-calidad: 31 decoraciones (20 del script y 11 curadas), colores, productos, piezas y nombres coherentes");
