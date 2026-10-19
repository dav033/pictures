/**
 * Glosario del taller (src/lib/globos3d/glosario-taller.ts): lo que dice el decorador → formatos, tamaños, partes,
 * tipos de pieza, técnicas y colores. Sin coste: no llama a ninguna IA ni a la red.
 *   npx tsx scripts/test/test-glosario-taller.ts
 * - más de 60 frases como las dice el dueño (con tildes o sin ellas, mayúsculas, guiones, «r24», «24"», inglés y faltas);
 * - lo que NO debe traducir («hazla más grande» no es un tamaño de globo; «de 12 cm» y «24 globos» no son formatos);
 * - el color nuevo («a dorado», «por azul») no filtra; el selector junta formatos, partes y colores-filtro;
 * - el punto de extensión: las partes declaradas por los módulos de etiquetado entran con una línea;
 * - el vocabulario para el prompt sale del glosario y la ruta lo incluye con la regla de buscar antes de editar.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GLOSARIO, construirGlosario, interpretarTerminos, normalizarTexto, vocabularioParaPrompt, type Interpretacion } from "../../src/lib/globos3d/glosario-taller";
import { REGLA_BUSCAR_ANTES_DE_EDITAR, seccionVocabularioEscena } from "../../src/lib/globos3d/prompt-escena";

let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };

type Esperado = { formatos?: string[]; partes?: string[]; tipos?: string[]; tecnicas?: string[]; colores?: string[]; destino?: string[]; sinFormatos?: boolean };

/** Compara lo interpretado con lo esperado: formatos, partes, tipos y técnicas como conjuntos; colores: cada código esperado aparece. */
function comprobar(frase: string, e: Esperado): Interpretacion {
  const r = interpretarTerminos(frase);
  const conjunto = (a: readonly string[]) => [...a].sort();
  const msg = (que: string) => `«${frase}» → ${que}: ${JSON.stringify({ formatos: r.formatos, partes: r.partes, tipos: r.tipos, tecnicas: r.tecnicas, colores: r.colores, destino: r.coloresDestino })}`;
  if (e.formatos) assert.deepEqual(conjunto(r.formatos), conjunto(e.formatos), msg("formatos"));
  if (e.sinFormatos) assert.deepEqual(r.formatos, [], msg("no debía haber formatos"));
  if (e.partes) assert.deepEqual(conjunto(r.partes), conjunto(e.partes), msg("partes"));
  if (e.tipos) assert.deepEqual(conjunto(r.tipos), conjunto(e.tipos), msg("tipos"));
  if (e.tecnicas) assert.deepEqual(conjunto(r.tecnicas), conjunto(e.tecnicas), msg("técnicas"));
  if (e.colores) for (const c of e.colores) assert.ok(r.colores.some((x) => x.codigos.includes(c)), msg(`color ${c}`));
  if (e.colores?.length === 0) assert.deepEqual(r.colores, [], msg("no debía haber colores-filtro"));
  if (e.destino) for (const c of e.destino) assert.ok(r.coloresDestino.some((x) => x.codigos.includes(c)), msg(`color destino ${c}`));
  return r;
}

/** Frases del dueño (y variantes) → lo que deben significar. */
const FRASES: ReadonlyArray<[string, Esperado]> = [
  // Link-O-Loon en todas sus formas
  ["cambia los link-o-loon de las ramas", { formatos: ["LOL-*"], partes: ["ramas"] }],
  ["los linkoloons verdes", { formatos: ["LOL-*"], colores: ["030"] }],
  ["los linkaloon", { formatos: ["LOL-*"] }],
  ["los link a loon de la pared", { formatos: ["LOL-*"], tipos: ["pared_malla", "pared_trenzas"] }],
  ["Link-O-Loon de 12", { formatos: ["LOL-12"] }],
  ["lol 6 y 12", { formatos: ["LOL-6", "LOL-12"] }],
  ["LOL-660 de las ramas", { formatos: ["LOL-660"], partes: ["ramas"] }],
  ["los eslabones largos del tronco", { formatos: ["LOL-660"], partes: ["tronco"] }],
  ["los eslabónes", { formatos: ["LOL-*"] }],
  ["linkoloom rosados", { formatos: ["LOL-*"], colores: ["009"] }],
  ["los links de 6 pulgadas", { formatos: ["LOL-6"] }],
  ["los 660", { formatos: ["LOL-660"] }],
  ["link o lun azul", { formatos: ["LOL-*"] }],
  // Tubitos
  ["los tubitos del moño", { formatos: ["T-*"], tipos: ["decoracion"] }],
  ["los globos largos de las hojas", { formatos: ["T-*"], partes: ["hojas"] }],
  ["tubito 260 fucsia", { formatos: ["T-260"], colores: ["012"] }],
  ["los 260 negros", { formatos: ["T-260"] }],
  ["los T-360 del tallo", { formatos: ["T-360"], partes: ["tallo"] }],
  ["los globos mágicos", { formatos: ["T-*"] }],
  ["twisting balloons gold", { formatos: ["T-*"] }],
  ["los tuvitos", { formatos: ["T-*"] }],
  ["tubitos 160 y 260", { formatos: ["T-160", "T-260"] }],
  // Redondos por pulgadas
  ["los globos de 24", { formatos: ["R-24"] }],
  ["los de 24 azules", { formatos: ["R-24"] }],
  ["24 pulgadas", { formatos: ["R-24"] }],
  ['los de 18"', { formatos: ["R-18"] }],
  ["los r24", { formatos: ["R-24"] }],
  ["los R 24 dorados", { formatos: ["R-24"], colores: ["970"] }],
  ["los R-5 dorados del tronco", { formatos: ["R-5"], partes: ["tronco"], colores: ["970"] }],
  ["redondos de 12", { formatos: ["R-12"] }],
  ["los redondos", { formatos: ["R-*"] }],
  ["cambia los colores de un tamaño de 9 a otro", { formatos: ["R-9"] }],
  ["12 inch round balloons", { formatos: ["R-12"] }],
  ["los globos de 36 del remate", { formatos: ["R-36"], partes: ["remate"] }],
  // Tamaños por palabra
  ["los globos grandes", { formatos: ["R-24", "R-36"] }],
  ["los grandes en azul", { formatos: ["R-24", "R-36"], destino: ["040"] }],
  ["los medianos", { formatos: ["R-12", "R-18"] }],
  ["las perlitas doradas", { formatos: ["R-5"], colores: ["970"] }],
  ["los globitos del centro", { formatos: ["R-5"], partes: ["centro"] }],
  ["los chiquitos", { formatos: ["R-5"] }],
  ["los chicos", { formatos: ["R-5", "R-9"] }],
  ["los pequeños blancos", { formatos: ["R-5", "R-9"], colores: ["005"] }],
  ["el jumbo", { formatos: ["R-36"] }],
  // Corazones
  ["los corazones rojos", { formatos: ["C-*"], colores: ["015"] }],
  ["corazón de 6", { formatos: ["C-6"] }],
  ["un corazón de globos", { tipos: ["forma"], sinFormatos: true }],
  // Partes
  ["los pétalos", { partes: ["petalos"] }],
  ["los petalos de la flor", { partes: ["petalos"], tipos: ["decoracion"] }],
  ["el centro de la flor", { partes: ["centro"], tipos: ["decoracion"] }],
  ["el botón", { partes: ["centro"] }],
  ["la corona", { partes: ["corona"] }],
  ["los lazos del moño", { partes: ["lazos"], tipos: ["decoracion"] }],
  ["las hojas de la palmera", { partes: ["hojas"], tipos: ["arbol_globos"] }],
  ["las ojas de la palmera", { partes: ["hojas"], tipos: ["arbol_globos"] }],
  ["las frutas de la copa", { partes: ["frutas", "copa"] }],
  ["los cocos", { partes: ["cocos"] }],
  ["el collar", { partes: ["collar"] }],
  ["los flecos", { partes: ["flecos"] }],
  ["el relleno", { partes: ["relleno"] }],
  ["la estructura", { partes: ["estructura"] }],
  ["las patas del arco", { partes: ["pata"], tipos: ["arco", "arco_organico"] }],
  ["la pata izquierda", { partes: ["pata/izquierda"] }],
  ["la clave del arco", { partes: ["clave"], tipos: ["arco", "arco_organico"] }],
  ["la base de la columna", { partes: ["base"], tipos: ["columna"] }],
  ["el tronco del árbol", { partes: ["tronco"], tipos: ["arbol_globos"] }],
  // Tipos y técnicas
  ["la columna orgánica", { tipos: ["organico"] }],
  ["el arco orgánico", { tipos: ["arco_organico"] }],
  ["la guirnalda de cuartetos", { tipos: ["guirnalda", "organico"], tecnicas: ["cuarteto"] }],
  ["la guirlanda", { tipos: ["guirnalda", "organico"] }],
  ["la pared de trenzas", { tipos: ["pared_trenzas"] }],
  ["el numero metalizado", { tipos: ["metalizado"] }],
  ["las letras", { tipos: ["letras"] }],
  ["el racimo trenzado", { tecnicas: ["racimo", "trenza"] }],
  ["el techo de helio", { tipos: ["techo"], tecnicas: ["helio"] }],
  ["la colunma clásica", { tipos: ["columna"], tecnicas: ["clasico"] }],
  // Colores: filtro y destino
  ["cambia el rosado por azul", { colores: ["009"], destino: ["040"] }],
  ["ponlo en dorado", { colores: [], destino: ["970"] }],
  ["los link-o-loon de las ramas a verde", { formatos: ["LOL-*"], partes: ["ramas"], colores: [], destino: ["030"] }],
  ["los 609", { colores: ["609"] }],
];

console.log(`Frases del dueño (${FRASES.length})`);
prueba(`hay al menos 60 frases`, () => assert.ok(FRASES.length >= 60));
for (const [frase, esperado] of FRASES) prueba(frase, () => { comprobar(frase, esperado); });

console.log("Lo que no debe traducir");
prueba("«hazla más grande» habla de la pieza, no de globos grandes", () => comprobar("hazla más grande", { sinFormatos: true }));
prueba("«de 12 cm» y «de 3 metros» son medidas", () => { comprobar("una columna de 12 cm", { sinFormatos: true }); comprobar("un arco de 3 metros", { sinFormatos: true }); });
prueba("«24 globos» es una cantidad", () => comprobar("ponle 24 globos", { sinFormatos: true }));
prueba("«de 24 globos» también es cantidad", () => comprobar("una guirnalda de 24 globos", { sinFormatos: true }));
prueba("«a los lados» no es «lazos»; «dentro» no es «centro»", () => { comprobar("dos columnas a los lados", { partes: [] }); comprobar("ponlo dentro", { partes: [] }); });
prueba("«rojas» no se corrige a «hojas»", () => comprobar("las flores rojas", { partes: [], colores: ["015"] }));
prueba("«de 11 pulgadas» avisa el más cercano", () => {
  const r = interpretarTerminos("globos de 11 pulgadas");
  assert.deepEqual(r.formatos, []);
  assert.ok(r.notas.some((n) => /R-12/.test(n)), JSON.stringify(r.notas));
});
prueba("«flores de tela» es follaje, no la decoración de globos", () => {
  const r = interpretarTerminos("ponle flores de tela");
  assert.deepEqual(r.tipos, []);
  assert.ok(r.notas.some((n) => /follaje/.test(n)));
});

console.log("Selector, notas y resto");
prueba("el selector junta formatos, partes y colores-filtro (no el color nuevo)", () => {
  const r = interpretarTerminos("los R-5 dorados del tronco a blanco");
  assert.deepEqual(r.selector.formatos, ["R-5"]);
  assert.deepEqual(r.selector.partes, ["tronco"]);
  assert.ok(r.selector.colores?.includes("970"));
  assert.ok(!r.selector.colores?.includes("005"));
  assert.ok(r.coloresDestino.some((c) => c.codigos.includes("005")));
});
prueba("las notas dicen qué se tradujo", () => {
  const r = interpretarTerminos("los linkoloon y los de 24");
  assert.ok(r.notas.some((n) => /linkoloon.*LOL-\*/.test(n)), JSON.stringify(r.notas));
  assert.ok(r.notas.some((n) => /24.*R-24/.test(n)), JSON.stringify(r.notas));
});
prueba("lo que no es del glosario queda en «resto» (para buscar por nombre)", () => {
  const r = interpretarTerminos("los tubitos de la columna izquierda");
  assert.ok(r.resto.includes("izquierda"), JSON.stringify(r.resto));
});
prueba("normaliza tildes, mayúsculas, guiones y pegados", () => {
  assert.equal(normalizarTexto("Los R24 y LOL-660 «Pétalos»"), "los r 24 y lol 660 petalos");
  assert.equal(normalizarTexto('globos de 18"'), "globos de 18 pulgadas");
});

console.log("Punto de extensión: partes de los módulos de etiquetado");
prueba("una lista de partes declaradas entra con su nombre y sus sinónimos", () => {
  const g = construirGlosario([["copa/frutas", { parte: "antenas", nombre: "antenas", sinonimos: ["antenitas"] }, { id: "petalos", sinonimos: ["petalitos"] }]]);
  assert.deepEqual(interpretarTerminos("las antenitas", g).partes, ["antenas"]);
  assert.deepEqual(interpretarTerminos("los petalitos", g).partes, ["petalos"]);
  assert.deepEqual(interpretarTerminos("la copa frutas", g).partes, ["copa/frutas"]);
  // El glosario de fábrica no cambia.
  assert.deepEqual(interpretarTerminos("las antenitas").partes, []);
});

console.log("Prompt");
prueba("el vocabulario sale del glosario: formatos, tamaños, técnicas, piezas y partes", () => {
  const v = vocabularioParaPrompt(GLOSARIO);
  for (const x of ["LOL-*", "LOL-660", "T-260", "R-24", "C-*", "grandes", "medianos", "chicos", "cuarteto", "pétalos", "ramas", "hojas"]) assert.ok(v.includes(x), `falta ${x}`);
  assert.ok(v.length < 3200, `el vocabulario es corto (${v.length})`);
});
prueba("la sección del sistema trae la regla de buscar antes de editar y la ruta la incluye", () => {
  const s = seccionVocabularioEscena();
  assert.ok(s.includes(REGLA_BUSCAR_ANTES_DE_EDITAR));
  assert.match(s, /buscar_en_escena/);
  assert.match(s, /NUNCA recolorees ni cambies la pieza entera/);
  const ruta = readFileSync(new URL("../../src/app/api/escena-ia/route.ts", import.meta.url), "utf8");
  assert.match(ruta, /\$\{seccionVocabularioEscena\(\)\}/);
  // La definición de tamaños del sistema y la del glosario dicen lo mismo.
  assert.match(ruta, /Grandes = R-24 \(y R-36\), medianos = R-18 y R-12, chicos = R-9 y R-5/);
});

console.log(`\n${pruebas} pruebas OK`);
