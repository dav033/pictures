import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

type Material = { cantidad: number; nota?: string };
type Decoracion = { id: string; origen: string; materiales: Material[]; piezas: Array<{ estructura: string; cantidad: number }> };
const datos = JSON.parse(readFileSync("src/lib/biblioteca-sempertex/decoraciones.json", "utf8")) as Decoracion[];
const reales = datos.filter((item) => item.origen === "referencia_real");
assert.equal(reales.length, 20, "publica 20 decoraciones reales");

function porNumero(numero: number): Decoracion {
  const prefijo = `deco-real-${String(numero).padStart(2, "0")}-`;
  const decoracion = reales.find((item) => item.id.startsWith(prefijo));
  assert.ok(decoracion, `falta decoración ${numero}`);
  return decoracion;
}
function cantidades(numero: number): Map<string, number> {
  return new Map(porNumero(numero).materiales.map((item) => [item.nota?.split(" · ").at(-1)?.toLocaleLowerCase("es") ?? "", item.cantidad]));
}
function exigirColores(numero: number, esperados: string[]): void {
  const presentes = cantidades(numero);
  for (const color of esperados) assert.ok((presentes.get(color) ?? 0) > 0, `deco-real-${numero}: falta ${color}`);
}

for (const decoracion of reales) {
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
console.log("test-biblioteca-real-calidad: 20 decoraciones, colores y productos coherentes");
