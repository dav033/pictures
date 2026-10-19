import assert from "node:assert/strict";
import { armarDesdeEspec, descripcionImagenDeEspec } from "../../src/lib/globos3d/motor/v1";
import { descripcionRender3d, fraseMetalicos, MAX_DESCRIPCION, promptFotoDeLayout } from "../../src/lib/globos3d/render-ia";
import { promptImagenGuiada } from "../../src/lib/guiada-motor/render-ia-guiada";
import { materialesEnIngles } from "../../src/components/tres-d/dibujo-escena";
import { especDeIdea, especIdea07, paletaDe } from "../lib/paleta-guiada";

const idea07 = especIdea07();
const descripcion07 = descripcionImagenDeEspec(idea07).descripcion;
const paleta07 = paletaDe(idea07);
const materialesTaller07 = armarDesdeEspec(idea07).bom.total;
const descripcionTaller07 = descripcionRender3d("A balloon decoration in a room", materialesEnIngles(materialesTaller07));
const promptTaller07 = promptFotoDeLayout(descripcionTaller07, "igual_visor");
const promptGuiada07 = promptImagenGuiada(descripcion07, "igual_visor");
const fraseOro = "metallic balloons whose reflections keep their own colour (chrome gold reflects gold, never silver)";

function prueba(nombre: string, cuerpo: () => void): void {
  cuerpo();
  console.log(`  ✓ ${nombre}`);
}

prueba("la idea 07 conserva los tres colores oficiales Sempertex con sus hex y acabados", () => {
  assert.deepEqual(
    paleta07.map(({ nombre, hex, acabado }) => ({ nombre, hex, acabado })).sort((a, b) => a.hex.localeCompare(b.hex)),
    [
      { nombre: "pale lilac", hex: "#B6B8DC", acabado: "matte" },
      { nombre: "matte light pink", hex: "#F2B6C8", acabado: "matte" },
      { nombre: "chrome gold", hex: "#A08344", acabado: "glossy chrome" },
    ].sort((a, b) => a.hex.localeCompare(b.hex)),
  );
});

prueba("Taller y guiada envían cada hex con el acabado oficial de su color", () => {
  for (const color of paleta07) {
    const detalle = `${color.nombre} (${color.hex}) — ${color.acabado}`;
    assert.ok(descripcion07.includes(detalle), `falta ${detalle} en la descripción canónica`);
    assert.ok(promptTaller07.includes(detalle), `falta ${detalle} en el prompt del Taller`);
    assert.ok(promptGuiada07.includes(detalle), `falta ${detalle} en el prompt de la guiada`);
  }
});

prueba("el oro refleja oro y ambas superficies usan la frase medida", () => {
  assert.equal(fraseMetalicos(descripcion07), fraseOro);
  assert.ok(promptTaller07.includes(fraseOro));
  assert.ok(promptGuiada07.includes(fraseOro));
  assert.doesNotMatch(promptTaller07, /chrome balloons with mirror reflections/);
});

prueba("solo se dan reglas para los metales presentes en cada escena", () => {
  const plata = descripcionImagenDeEspec(especDeIdea("idea-deco-real-10-")).descripcion;
  const plataTaller = promptFotoDeLayout(plata, "igual_visor");
  const plataGuiada = promptImagenGuiada(plata, "igual_visor");
  assert.ok(plataTaller.includes("chrome silver reflects silver"));
  assert.ok(plataGuiada.includes("chrome silver reflects silver"));
  assert.doesNotMatch(plataTaller, /chrome gold|never silver/);
  assert.doesNotMatch(plataGuiada, /chrome gold|never silver/);

  const sinMetales = descripcionImagenDeEspec(especDeIdea("idea-deco-real-01-")).descripcion;
  assert.equal(fraseMetalicos(sinMetales), "");
  assert.doesNotMatch(promptFotoDeLayout(sinMetales), /metallic balloons|chrome gold|chrome silver/);
  assert.doesNotMatch(promptImagenGuiada(sinMetales, "igual_visor"), /metallic balloons|chrome gold|chrome silver/);
});

prueba("la descripción reserva espacio para los acabados incluso en una escena larga", () => {
  const descripcion = descripcionRender3d("A balloon wall. ".repeat(100), [
    { cantidad: 1, formatoId: "R-5", colorEn: "chrome gold", hexGlobo: "#A08344", acabado: "glossy chrome" },
    { cantidad: 1, formatoId: "R-5", colorEn: "pale lilac", hexGlobo: "#B6B8DC", acabado: "matte" },
    { cantidad: 1, formatoId: "R-5", colorEn: "matte light pink", hexGlobo: "#F2B6C8", acabado: "matte" },
  ]);
  assert.ok(descripcion.length <= MAX_DESCRIPCION);
  for (const detalle of ["chrome gold (#A08344) — glossy chrome", "pale lilac (#B6B8DC) — matte", "matte light pink (#F2B6C8) — matte"]) {
    assert.ok(descripcion.includes(detalle), `falta el acabado oficial ${detalle}`);
  }
});

console.log("\n5 pruebas ok");
