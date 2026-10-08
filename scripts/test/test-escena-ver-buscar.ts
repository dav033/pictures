/**
 * La IA de escena ve por dentro de las piezas (src/lib/globos3d/herramientas-escena-inventario.ts): la cola de cada
 * línea de ver_escena, ver_pieza y buscar_en_escena, por `aplicarHerramienta`. Sin coste: no llama a ninguna IA ni a
 * la red.
 *   npx tsx scripts/test/test-escena-ver-buscar.ts
 * - el caso del dueño: «cambia los link-o-loon de las ramas» encuentra la pieza «Ramas» (una palmera de LOL-660) y
 *   NO la pared de Link-O-Loon de al lado (que queda como «encaja solo en parte»); con tubitos, las ramas trenzadas
 *   de la escena de Halloween;
 * - un tamaño («los globos de 24») y una parte etiquetada («la pata izquierda del arco», «los R-5 dorados del tronco»)
 *   dan la pieza, la parte y el selector exacto; el color nuevo no filtra;
 * - partes de un módulo de etiquetado (simuladas): «las hojas de la palmera» → parte hojas con sus tubitos;
 * - ver_pieza lista partes → formatos → colores, lo que va encima (con id) y lo que le falta decir;
 * - errores claros (id inexistente, nada que buscar) y nunca cambian la escena.
 */
import assert from "node:assert/strict";
import { DECLARACIONES_ESCENA, aplicarHerramienta, resumenEscena, type ResultadoHerramienta } from "../../src/lib/globos3d/herramientas-escena";
import { buscarEnEscena, verPieza } from "../../src/lib/globos3d/herramientas-escena-inventario";
import { ARBOLES_PREDEFINIDOS, type OpcionesArbolGlobos } from "../../src/lib/globos3d/arboles-globos";
import { escenaPredefinida } from "../../src/lib/globos3d/escenas-presets";
import { armarPieza, type Pieza, type PiezaArmada } from "../../src/lib/globos3d/piezas";
import type { Escena, NodoEscena } from "../../src/lib/globos3d/escena";

let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };

const ok = (r: ResultadoHerramienta): Extract<ResultadoHerramienta, { ok: true }> => {
  if (!r.ok) assert.fail(`se esperaba éxito y vino error: ${r.error}`);
  return r;
};
const error = (r: ResultadoHerramienta, contiene: RegExp) => {
  if (r.ok) assert.fail(`se esperaba error y vino: ${r.resumen}`);
  assert.match(r.error, contiene);
};
/** Una consulta: devuelve el texto y comprueba que no tocó la escena. */
function consulta(e: Escena, herramienta: string, args: Record<string, unknown>): string {
  const antes = JSON.stringify(e);
  const r = ok(aplicarHerramienta(e, herramienta, args));
  assert.equal(r.consulta, true, `${herramienta} es consulta`);
  assert.equal(JSON.stringify(r.escena), antes, `${herramienta} no cambia la escena`);
  return r.resumen;
}
/** El bloque de hallazgos completos (antes de «Encajan solo en parte»). */
const hallazgos = (texto: string) => texto.split(/\n(?:Encajan solo en parte|Lo más cercano)/)[0]!;
const primero = (texto: string) => texto.split("\n").find((l) => /^1\. /.test(l)) ?? "";

/** Palmera de la biblioteca con las hojas de Link-O-Loon 660 (las «ramas» del dueño). */
function palmeraDeLink(): OpcionesArbolGlobos {
  const a = structuredClone(ARBOLES_PREDEFINIDOS[0]!.arbol);
  if (a.copa.tipo !== "palmera") throw new Error("se esperaba una palmera");
  a.copa.hojas = { ...a.copa.hojas, formatoId: "LOL-660", codigos: ["032", "030"] };
  return a;
}

const halloween = escenaPredefinida("halloween_arbol_fantasmas");
const base = escenaPredefinida("arco_organico_columnas_guirnalda");
const ramasYPared: Escena = {
  ...base,
  nodos: [
    ...base.nodos,
    { id: "ramas", nombre: "Ramas", pieza: { tipo: "arbol_globos", arbol: palmeraDeLink() }, colocacion: { en: "piso", xCm: -150, zCm: 50, giroGrados: 0 } },
    { id: "pared-link", nombre: "Pared de link", pieza: { tipo: "pared_malla", formatoId: "LOL-12", infladoCm: 25, anchoCm: 150, altoCm: 150, patron: "un_color", colores: ["005"], union: { infladoCm: 12, codigo: "005" } }, colocacion: { en: "pared", pared: "izquierda", aLoLargoCm: 0, alturaCm: 0 } },
  ],
};

console.log("Declaraciones");
prueba("ver_pieza y buscar_en_escena están declaradas con su esquema", () => {
  for (const n of ["ver_pieza", "buscar_en_escena"]) {
    const d = DECLARACIONES_ESCENA.find((x) => x.name === n);
    assert.ok(d, `falta ${n}`);
    assert.ok(d.description.length > 40);
    assert.equal(d.parametersJsonSchema.type, "object");
  }
  const buscar = DECLARACIONES_ESCENA.find((x) => x.name === "buscar_en_escena")!;
  for (const p of ["texto", "formatos", "partes", "colores", "ids", "limite"]) assert.ok(JSON.stringify(buscar.parametersJsonSchema).includes(`"${p}"`), `buscar_en_escena tiene ${p}`);
});

console.log("ver_escena ve por dentro");
prueba("cada pieza dice de qué formatos y colores está hecha (y sus partes)", () => {
  const r = resumenEscena(ramasYPared);
  const linea = (id: string) => r.split("\n").find((l) => l.startsWith(`- ${id} `)) ?? "";
  assert.match(linea("ramas"), /lleva: .*LOL-660 032 verde selva/);
  assert.match(linea("pared-link"), /lleva: .*36 LOL-12 005 blanco/);
  assert.match(linea("columna-izq"), /lleva: 9 R-12 609 rosado/);
  assert.match(linea("arco"), /partes: pata\/derecha \d+, pata\/izquierda \d+/);
  for (const l of r.split("\n").filter((x) => x.startsWith("- "))) assert.ok(l.length < 900, `línea corta: ${l.length}`);
});
prueba("lo etiquetado sale con su parte; lo que no lleva globos no agrega nada", () => {
  const r = resumenEscena(halloween);
  assert.match(r, /- arbol .*partes: base \d+, tronco \d+/);
  assert.match(r, /- ramas .*lleva: 20 T-260 076 chocolate/);
  assert.ok(!/fantasma-izq .*lleva:/.test(r), "un fantasma de papel no lleva globos");
});

console.log("buscar_en_escena: el caso del dueño");
prueba("«cambia los link-o-loon de las ramas» → la pieza «Ramas», no la pared de Link-O-Loon", () => {
  const r = consulta(ramasYPared, "buscar_en_escena", { texto: "cambia los link-o-loon de las ramas" });
  assert.match(r, /Busqué formatos LOL-\* · partes ramas/);
  assert.match(primero(r), /«Ramas» \(id ramas\).*es la pieza entera \(por su nombre\).*5 LOL-660 032 verde selva.*selector: \{"formatos":\["LOL-660"\]\}/);
  assert.ok(!hallazgos(r).includes("pared-link"), "la pared no es lo que se nombró");
  assert.match(r, /Encajan solo en parte[\s\S]*«Pared de link» \(id pared-link\): tiene LOL-\* ×36/);
  assert.match(r, /nunca recolorees ni cambies la pieza entera/);
});
prueba("«linkoloon» con falta y en inglés también", () => {
  assert.match(primero(consulta(ramasYPared, "buscar_en_escena", { texto: "los linkolon de las ramas" })), /id ramas/);
  assert.match(primero(consulta(ramasYPared, "buscar_en_escena", { texto: "link-o-loons on the branches" })), /id ramas/);
});
prueba("«los tubitos de las ramas a dorado» en Halloween → las ramas trenzadas; dorado es el color nuevo", () => {
  const r = consulta(halloween, "buscar_en_escena", { texto: "cambia los tubitos de las ramas a dorado" });
  assert.match(primero(r), /«Ramas trenzadas» \(id ramas\).*20 T-260 076 chocolate.*selector: \{"formatos":\["T-260"\](,"partes":\["ramas"(,"ramas\/ramitas")?\])?\}/);
  assert.match(r, /El color nuevo \(«dorado»\) no filtra/);
  // Los fantasmas «de la rama» se llaman así pero no tienen tubitos: solo en parte.
  assert.match(r, /«Fantasma \(rama izquierda\)» \(id fantasma-izq\): se llama «ramas»; pero no tiene T-\*/);
  assert.ok(!hallazgos(r).includes("fantasma"));
});
prueba("el resultado pone primero la pieza que más encaja y da sus ids", () => {
  const r = consulta(ramasYPared, "buscar_en_escena", { texto: "los link-o-loon" });
  const lineas = r.split("\n").filter((l) => /^\d+\. /.test(l));
  assert.equal(lineas.length, 2, r);
  assert.match(r, /Ids: (ramas, pared-link|pared-link, ramas)\./);
});

console.log("buscar_en_escena: tamaños, partes y colores");
prueba("«los globos de 24» → el arco con sus R-24", () => {
  const r = consulta(base, "buscar_en_escena", { texto: "los globos de 24" });
  assert.match(primero(r), /id arco.*\d+ R-24 609 rosado.*selector: \{"formatos":\["R-24"\]\}/);
  assert.ok(!r.includes("columna-izq"));
});
prueba("«la pata izquierda del arco» → la parte etiquetada, con su selector", () => {
  const r = consulta(base, "buscar_en_escena", { texto: "la pata izquierda del arco" });
  assert.match(primero(r), /id arco.*selector: \{"partes":\["pata\/izquierda"\]\}/);
  assert.ok(!primero(r).includes("pata/derecha"));
});
prueba("«los R-5 dorados del tronco» → la parte tronco (aunque el árbol se llame «base y tronco»), solo el dorado", () => {
  const r = consulta(halloween, "buscar_en_escena", { texto: "los R-5 dorados del tronco" });
  assert.match(primero(r), /id arbol.*6 R-5 970 dorado \[tronco\].*selector: \{"formatos":\["R-5"\],"partes":\["tronco"\],"colores":\["970"\]\}/);
});
prueba("por argumentos: formatos, partes, colores e ids", () => {
  const r = consulta(halloween, "buscar_en_escena", { formatos: ["R-18"], partes: ["base"], ids: ["arbol", "ramas"] });
  assert.match(primero(r), /id arbol.*16 R-18 880/);
  const s = consulta(base, "buscar_en_escena", { formatos: ["R-12"], colores: ["dorado"] });
  assert.match(s, /id columna-izq/);
  assert.match(s, /id columna-der/);
});
prueba("un color que ninguna pieza tiene ahí se toma como el color nuevo (se busca sin él y se avisa)", () => {
  const r = consulta(base, "buscar_en_escena", { texto: "los R-24 verdes" });
  assert.match(r, /lo busqué sin el color/);
  assert.match(primero(r), /id arco/);
});
prueba("lo que no está: lo dice y cuenta qué formatos y partes hay", () => {
  const r = consulta(base, "buscar_en_escena", { texto: "los corazones" });
  assert.match(r, /No encontré eso en la escena/);
  assert.match(r, /hay formatos R-5, R-9, R-12, R-18, R-24 y partes pata\/derecha, pata\/izquierda/);
});
prueba("por tipo y por nombre, sin criterios de globos", () => {
  const r = consulta(base, "buscar_en_escena", { texto: "la columna izquierda" });
  assert.match(primero(r), /id columna-izq.* · la pieza entera/);
});

console.log("Partes de los módulos de etiquetado (simuladas)");
/** Como lo dejarán los módulos de etiquetado: la palmera dice tronco, hojas y cocos. */
const etiquetada = (p: Pieza): PiezaArmada => {
  const a = armarPieza(p);
  if (p.tipo !== "arbol_globos") return a;
  return {
    ...a,
    globos: a.globos.map((g) => ({ ...g, parte: g.formatoId === "R-9" ? "tronco" : g.codigo === "076" ? "copa/cocos" : "tronco/base" })),
    tubos: a.tubos.map((t) => ({ ...t, parte: "copa/hojas" })),
  };
};
const conPalmera: Escena = { ...base, nodos: [...base.nodos, { id: "palmera", nombre: "Palmera curva", pieza: { tipo: "arbol_globos", arbol: ARBOLES_PREDEFINIDOS[0]!.arbol }, colocacion: { en: "piso", xCm: 150, zCm: 50, giroGrados: 0 } }] };
prueba("«las hojas de la palmera» → la parte copa/hojas con sus tubitos", () => {
  const r = buscarEnEscena(conPalmera, { texto: "las hojas de la palmera" }, etiquetada);
  assert.match(primero(r), /id palmera.*5 T-260 032 verde selva \[copa\/hojas\].*selector: \{"partes":\["copa\/hojas"\]\}/);
});
prueba("«los cocos» y «la base del tronco» por segmento de la etiqueta", () => {
  assert.match(primero(buscarEnEscena(conPalmera, { texto: "los cocos" }, etiquetada)), /id palmera.*3 R-12 076 chocolate \[copa\/cocos\]/);
  assert.match(primero(buscarEnEscena(conPalmera, { texto: "los globos de la base del tronco" }, etiquetada)), /id palmera.*selector: \{"partes":\["tronco\/base"\]\}/);
});
prueba("sin etiquetas, una parte nombrada no se inventa: «aún no dice sus partes»", () => {
  const r = consulta(conPalmera, "buscar_en_escena", { texto: "las hojas de la palmera" });
  assert.match(r, /No encontré eso/);
  assert.match(r, /«Palmera curva» \(id palmera\): es de ese tipo; pero aún no dice sus partes \(no se sabe si tiene «hojas»\)/);
});
prueba("ver_pieza con etiquetas: partes → formatos → colores", () => {
  const v = verPieza(conPalmera, "palmera", etiquetada);
  assert.match(v, /^- copa\/hojas: T-260 ×9 \(032 Fashion Verde Selva ×5, 029 Fashion Verde Trébol ×4\)$/m);
  assert.match(v, /^- tronco: R-9 ×40 \(074 Fashion Café ×40\)$/m);
  assert.match(v, /47 globos y 9 tubitos.* en 4 partes/);
});

console.log("ver_pieza");
prueba("una pieza etiquetada: total, partes, formatos y colores; ejemplo de selector", () => {
  const v = consulta(halloween, "ver_pieza", { id: "arbol" });
  assert.match(v, /«Árbol \(base y tronco\)» \(id arbol\) · organico/);
  assert.match(v, /241 globos en 2 partes:/);
  assert.match(v, /^- base: R-5 ×104 \(076 Fashion Chocolate ×78/m);
  assert.match(v, /^- tronco: .*R-12 ×29 \(076 Fashion Chocolate ×29\)/m);
  assert.match(v, /selector \{"partes":\["base"\],"formatos":\["R-5"\]\} con el id arbol/);
});
prueba("lo que va encima o colgado de ella sale con su id y su contenido; y ella dice de quién cuelga", () => {
  const e = ok(aplicarHerramienta(base, "poner_sobre", { decoracion_id: "flor_r5_rosada", padre_id: "columna-izq", altura_cm: 120 })).escena;
  const flor = e.nodos.find((n: NodoEscena) => n.colocacion.en === "sobre")!;
  const v = consulta(e, "ver_pieza", { id: "columna-izq" });
  assert.match(v, new RegExp(`Encima o colgado de ella \\(1;[^\\n]*\\n- «${flor.nombre}» \\(id ${flor.id}, encima\\) · lleva: .*5 R-5 009 rosado`));
  assert.match(consulta(e, "ver_pieza", { id: flor.id }), /Ella misma va encima de «columna-izq»/);
});
prueba("con etiquetas lista sus partes; los tubitos se cuentan aparte", () => {
  const v = consulta(halloween, "ver_pieza", { id: "ramas" });
  assert.match(v, /0 globos y 20 tubitos/);
  assert.match(v, /^- ramas: T-260 ×8/m);
  assert.match(v, /^- ramas\/ramitas: T-260 ×12/m);
});
prueba("un fantasma de papel no lleva globos de látex", () => {
  assert.match(consulta(halloween, "ver_pieza", { id: "fantasma-izq" }), /No lleva globos de látex/);
});

console.log("Errores");
prueba("id que no está, nada que buscar, color que no existe", () => {
  error(aplicarHerramienta(base, "ver_pieza", { id: "no-existe" }), /No hay ninguna pieza con id «no-existe»/);
  error(aplicarHerramienta(base, "buscar_en_escena", {}), /No entendí qué buscar/);
  error(aplicarHerramienta(base, "buscar_en_escena", { texto: "por favor" }), /No entendí qué buscar/);
  error(aplicarHerramienta(base, "buscar_en_escena", { colores: ["xyzzy"] }), /No encontré el color «xyzzy»/);
  error(aplicarHerramienta(base, "buscar_en_escena", { texto: "los R-24", ids: ["nada"] }), /No hay ninguna pieza con id «nada»/);
});

console.log(`\n${pruebas} pruebas OK`);
