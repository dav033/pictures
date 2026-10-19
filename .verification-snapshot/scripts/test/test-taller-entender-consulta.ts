/**
 * REQ-002: entender la consulta del taller (celebraciones, temáticas, fuente, medidas). Sin base ni red.
 * Run: npx tsx scripts/test/test-taller-entender-consulta.ts
 */
import assert from "node:assert/strict";
import { entenderConsulta, fuentesDeTexto, medidasDeTexto, sinEntender, sinTildes } from "../../src/lib/taller/entender-consulta";

let casos = 0;
const ok = (nombre: string) => { casos += 1; console.log(`ok ${casos} - ${nombre}`); };

// --- medidas ---------------------------------------------------------------------------------------------------
{
  assert.deepEqual(medidasDeTexto("una columna de 2 metros"), { altoCm: 200, anchoCm: null }, "una columna se mide a lo alto");
  assert.deepEqual(medidasDeTexto("un arco de 3 metros"), { altoCm: null, anchoCm: 300 }, "un arco se mide a lo ancho");
  assert.deepEqual(medidasDeTexto("un arco de 4 metros de ancho"), { altoCm: null, anchoCm: 400 });
  assert.deepEqual(medidasDeTexto("un arco de 3 metros de alto"), { altoCm: 300, anchoCm: null }, "«de alto» manda sobre la pieza");
  assert.deepEqual(medidasDeTexto("una columna como de metro y medio"), { altoCm: 150, anchoCm: null });
  assert.deepEqual(medidasDeTexto("columna de dos metros y medio"), { altoCm: 250, anchoCm: null });
  assert.deepEqual(medidasDeTexto("pared de 3,5 m de ancho"), { altoCm: null, anchoCm: 350 });
  assert.deepEqual(medidasDeTexto("guirnalda de 1.5 mts"), { altoCm: null, anchoCm: 150 });
  assert.deepEqual(medidasDeTexto("algo de medio metro"), { altoCm: 50, anchoCm: null });
  assert.deepEqual(medidasDeTexto("centro de mesa de 80 cm"), { altoCm: 80, anchoCm: null });
  assert.deepEqual(medidasDeTexto("arco de 3 m de ancho y 2 m de alto"), { altoCm: 200, anchoCm: 300 });
  ok("medidas: metros, «metro y medio», cm, y el eje por «de alto/ancho» o por la pieza");

  for (const sin of ["globos gigantes de 36 pulgadas", "los de 24 azules", "link-o-loon 660 largos", "R-24 dorado", "mesa para 12 personas", "3 mesas", "arco de 5 m3"]) {
    assert.deepEqual(medidasDeTexto(sin), { altoCm: null, anchoCm: null }, `«${sin}» no es una medida`);
  }
  assert.deepEqual(medidasDeTexto("columna de 0,05 metros"), { altoCm: null, anchoCm: null }, "una medida absurda se descarta");
  ok("medidas: pulgadas, formatos, cantidades y números sueltos no son medidas");
}

// --- fuente ----------------------------------------------------------------------------------------------------
{
  assert.deepEqual(fuentesDeTexto("las guirnaldas de Pinterest que pasó el dueño"), ["referencia-dueno"]);
  assert.deepEqual(fuentesDeTexto("los medios arcos de las fotos del dueño"), ["referencia-dueno"]);
  assert.deepEqual(fuentesDeTexto("columnas de la revista Celebra"), ["celebra"]);
  assert.deepEqual(fuentesDeTexto("los topiarios de las ideas de Sempertex"), ["idea-sempertex"]);
  assert.deepEqual(fuentesDeTexto("lo que vi en internet"), ["referencia-web"]);
  assert.deepEqual(fuentesDeTexto("celebra con mamá"), [], "«celebra» a secas es un verbo, no la revista");
  assert.deepEqual(fuentesDeTexto("columna dorada"), []);
  ok("fuente: dueño/Pinterest, revista Celebra, Sempertex, internet; sin falsos positivos con el verbo celebrar");
}

// --- celebraciones y temáticas -----------------------------------------------------------------------------------
{
  const comunion = entenderConsulta("primera comunión con cruz");
  assert.deepEqual(comunion.celebraciones, ["primera-comunion"]);
  assert.ok(comunion.expansion.includes("primera") && comunion.expansion.includes("comunion"), "las palabras del id se suman al texto");

  const grado = entenderConsulta("columna orgánica dorada para grado");
  assert.deepEqual(grado.celebraciones, ["graduacion"]);

  const xv = entenderConsulta("letras de globos XV");
  assert.deepEqual(xv.celebraciones, ["quince-anos"]);
  assert.ok(xv.expansion.includes("quince"));

  assert.ok(entenderConsulta("halloween con arañas").celebraciones.includes("halloween"));
  assert.ok(entenderConsulta("fiesta de dinosaurios").tematicas.includes("dinosaurios"));
  assert.ok(entenderConsulta("columna de cebra").tematicas.includes("safari-jungla"));
  assert.deepEqual(entenderConsulta("cumple con mamá").celebraciones, [], "las pistas débiles no cuentan");
  assert.ok(sinEntender(entenderConsulta("una columna lisa")), "sin nada que entender");
  ok("taxonomía: celebraciones y temáticas fuertes con sus palabras; las débiles no");

  const todo = entenderConsulta("una columna de hello kitty de 2 metros de la revista Celebra");
  assert.equal(todo.altoCm, 200);
  assert.deepEqual(todo.fuentes, ["celebra"]);
  assert.equal(sinTildes("ÁÉÍÓÚ Ñandú"), "aeiou nandu");
  ok("todo junto: medida, fuente y taxonomía en una consulta");
}

console.log(`\n${casos} casos ok`);
