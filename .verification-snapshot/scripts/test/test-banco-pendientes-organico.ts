/**
 * Los pendientes del banco de la IA de escena que eran del motor orgánico (2026-10-08), sin modelo y sin coste:
 *   npx tsx scripts/test/test-banco-pendientes-organico.ts
 *
 * 1. Un segundo «más R-24» seguido ya no se satura: engruesa el cuerpo por pasos y lo dice.
 * 2. «Menos tupida» baja el TOTAL (el relleno de huecos no lo vuelve a subir).
 * 3. «Menos R-5 / menos R-9 / más R-12»: el relleno respeta la mezcla pedida y el resumen dice lo que de verdad quedó.
 * 4. Tras ajustar_tamanos el color pedido en un tamaño (Reflex Azul en los R-24) no desaparece.
 * 5. Un color que no se fabrica en un formato no cae en blanco en silencio: el más parecido de ese formato, y se avisa.
 * 6. Zonas izquierda y derecha (la pata de un arco): solo cambia la mezcla de ese lado.
 */
import assert from "node:assert/strict";
import { aplicarHerramienta, type ResultadoHerramienta } from "../../src/lib/globos3d/herramientas-escena";
import { escenaPredefinida } from "../../src/lib/globos3d/escenas-presets";
import { SALA_INICIAL, type Escena, type NodoEscena } from "../../src/lib/globos3d/escena";
import { armarPieza, type Pieza } from "../../src/lib/globos3d/piezas";
import { inventarioDe } from "../../src/lib/globos3d/partes-globos";
import { armarOrganico, RELLENO_TUPIDO, type ColorOrganico } from "../../src/lib/globos3d/organico";
import { opcionesArcoOrganico } from "../../src/lib/globos3d/formas-escena";
import { colorDeRescate, masParecidoEnFormato, sustitutoDeFamilia } from "../../src/lib/globos3d/colores-formato";
import { enZona, rangoAltura } from "../../src/lib/globos3d/zonas-organicas";
import { coloresDelFormato } from "../../src/lib/globos3d/formatos";
import { referenciaPorCodigo, TABLA_SEMPERTEX } from "../../src/lib/plan/referencia-sempertex";

let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };
const ok = (r: ResultadoHerramienta): Extract<ResultadoHerramienta, { ok: true }> => { if (!r.ok) assert.fail(`se esperaba éxito: ${r.error}`); return r; };
const nodo = (e: Escena, id: string): NodoEscena => e.nodos.find((n) => n.id === id) ?? assert.fail(`falta ${id}`);
const vacia: Escena = { sala: structuredClone(SALA_INICIAL), nodos: [] };

/** Globos por formato de una pieza, contados en la pieza armada (lo que ve la verificación). */
function porFormato(p: Pieza, parte?: string): Record<string, number> {
  const r: Record<string, number> = {};
  for (const l of inventarioDe(armarPieza(p))) if (!parte || l.parte === parte || l.parte.startsWith(`${parte}/`)) r[l.formatoId] = (r[l.formatoId] ?? 0) + l.cantidad;
  return r;
}
const total = (p: Pieza) => armarPieza(p).globos.length;
const colores = (p: Pieza, formato: string) => [...new Set(armarPieza(p).globos.filter((g) => g.formatoId === formato).map((g) => g.codigo))];

console.log("1. Segundo «más R-24» seguido");
prueba("el segundo más R-24 sube de verdad y dice que engrosó el cuerpo", () => {
  let e = ok(aplicarHerramienta(vacia, "agregar_pieza", { tipo: "semiarco_organico", tamanos: ["R-24", "R-9"], colores: ["azul reflex", "dorado"] })).escena;
  const antes0 = porFormato(nodo(e, "semiarco-organico").pieza)["R-24"]!;
  const r1 = ok(aplicarHerramienta(e, "ajustar_tamanos", { id: "semiarco-organico", cambios: [{ formato: "R-24", accion: "mas" }] }));
  const antes1 = porFormato(nodo(r1.escena, "semiarco-organico").pieza)["R-24"]!;
  assert.ok(antes1 > antes0, `primer más: ${antes0} → ${antes1}`);
  const r2 = ok(aplicarHerramienta(r1.escena, "ajustar_tamanos", { id: "semiarco-organico", cambios: [{ formato: "R-24", accion: "mas" }] }));
  const antes2 = porFormato(nodo(r2.escena, "semiarco-organico").pieza)["R-24"]!;
  assert.ok(antes2 >= Math.max(antes1 + 3, antes1 * 1.5), `segundo más: ${antes1} → ${antes2}`);
  assert.match(r2.resumen, /engrosé todo el cuerpo un \d+ %/);
  assert.doesNotMatch(r2.resumen, /no llegué a la meta/);
  e = r2.escena;
  assert.ok(total(nodo(e, "semiarco-organico").pieza) > 0);
});
prueba("con engrosar: false no engruesa y avisa que no llegó", () => {
  const e = ok(aplicarHerramienta(vacia, "agregar_pieza", { tipo: "semiarco_organico", tamanos: ["R-24", "R-9"], colores: ["azul reflex", "dorado"] })).escena;
  const r1 = ok(aplicarHerramienta(e, "ajustar_tamanos", { id: "semiarco-organico", engrosar: true, cambios: [{ formato: "R-24", accion: "mas" }] }));
  const r2 = ok(aplicarHerramienta(r1.escena, "ajustar_tamanos", { id: "semiarco-organico", engrosar: false, cambios: [{ formato: "R-24", accion: "mas" }] }));
  assert.doesNotMatch(r2.resumen, /engrosé todo el cuerpo/);
});

console.log("2. Menos tupida baja el total");
prueba("densidad menos: el total baja al menos un 10 % en el arco y en las columnas orgánicas", () => {
  let e = ok(aplicarHerramienta(vacia, "agregar_pieza", { tipo: "arco_organico", donde: { en: "piso", x_cm: 0, z_cm: -150 } })).escena;
  e = ok(aplicarHerramienta(e, "agregar_pieza", { tipo: "columna_organica", donde: { en: "piso", x_cm: -250, z_cm: -150 } })).escena;
  for (const id of ["arco-organico", "columna-organica"]) {
    const antes = total(nodo(e, id).pieza);
    const r = ok(aplicarHerramienta(e, "ajustar_tamanos", { id, densidad: "menos" }));
    const despues = total(nodo(r.escena, id).pieza);
    assert.ok(despues <= antes * 0.9, `${id}: ${antes} → ${despues}`);
    assert.match(r.resumen, /quité el relleno de R-5/);
  }
});
prueba("densidad más sigue subiendo la estructura y no quita relleno", () => {
  const e = ok(aplicarHerramienta(vacia, "agregar_pieza", { tipo: "columna_organica" })).escena;
  const r = ok(aplicarHerramienta(e, "ajustar_tamanos", { id: "columna-organica", densidad: "mas" }));
  assert.doesNotMatch(r.resumen, /quité el relleno/);
  assert.ok(total(nodo(r.escena, "columna-organica").pieza) > total(nodo(e, "columna-organica").pieza));
});

console.log("3. El relleno respeta lo pedido y el resumen dice lo real");
prueba("menos R-5 y R-9, más R-12: ni R-5 ni R-9 vuelven por el relleno y las cifras del resumen son las del armado", () => {
  const e = escenaPredefinida("arco_organico_columnas_guirnalda");
  const antes = porFormato(nodo(e, "arco").pieza);
  const r = ok(aplicarHerramienta(e, "ajustar_tamanos", { id: "arco", cambios: [
    { formato: "R-5", accion: "menos" }, { formato: "R-9", accion: "menos" }, { formato: "R-12", accion: "mas" }, { formato: "R-18", accion: "mas" },
  ] }));
  const despues = porFormato(nodo(r.escena, "arco").pieza);
  assert.ok(despues["R-5"]! <= antes["R-5"]! * 0.8, `R-5 ${antes["R-5"]} → ${despues["R-5"]}`);
  assert.ok(despues["R-9"]! < antes["R-9"]!, `R-9 ${antes["R-9"]} → ${despues["R-9"]}`);
  assert.ok(despues["R-12"]! >= antes["R-12"]! * 1.3, `R-12 ${antes["R-12"]} → ${despues["R-12"]}`);
  // Cada «R-x: antes → después» del resumen es el del armado final y parte de lo que había al empezar el pedido.
  for (const m of r.resumen.matchAll(/(R-\d+): (\d+) → (\d+)/g)) {
    assert.equal(Number(m[2]), antes[m[1]!] ?? 0, `${m[1]}: el «antes» del resumen es lo que había al empezar`);
    assert.equal(Number(m[3]), despues[m[1]!] ?? 0, `${m[1]}: el «después» del resumen es lo que de verdad quedó armado`);
  }
});

console.log("4. El color pedido en un tamaño no desaparece");
prueba("Reflex Azul (no viene en R-9) sigue en los R-24 después de subir los R-24", () => {
  let e = ok(aplicarHerramienta(vacia, "agregar_pieza", { tipo: "semiarco_organico", tamanos: ["R-24", "R-9"], colores: ["blanco", "dorado"] })).escena;
  e = ok(aplicarHerramienta(e, "cambiar_pieza", { id: "semiarco-organico", reemplazar_colores: [{ de: "blanco", a: "azul reflex" }] })).escena;
  e = ok(aplicarHerramienta(e, "ajustar_tamanos", { id: "semiarco-organico", cambios: [{ formato: "R-24", accion: "mas" }] })).escena;
  const p = nodo(e, "semiarco-organico").pieza;
  assert.deepEqual(colores(p, "R-24"), ["940"], "los R-24 son Reflex Azul");
  assert.ok(!colores(p, "R-9").includes("981"), "los R-9 no se pintan de Reflex Plata para completar el azul");
});
prueba("el motor da el color primero a los globos donde viene tal cual", () => {
  const colorPaleta: ColorOrganico[] = [{ codigo: "940", peso: 40 }, { codigo: "570", peso: 60 }];
  const opciones = { ...opcionesArcoOrganico({ anchoCm: 200, altoCm: 200, radioBaseCm: 40, radioPuntaCm: 26, semilla: 3, densidad: 1, colores: colorPaleta, flores: null, huecosFlores: 0 }) };
  const r = armarOrganico(opciones);
  const azulesEnR9 = r.globos.filter((g) => g.formatoId === "R-9" && g.codigo === "940").length;
  assert.equal(azulesEnR9, 0, "ningún R-9 es Reflex Azul (no se fabrica)");
  assert.ok(r.globos.some((g) => g.codigo === "940"), "el azul está en los tamaños donde sí viene");
});

console.log("5. Un color que no se fabrica en el formato: el más parecido, avisado");
prueba("sin ningún color de la paleta en R-9: el más parecido que se fabrica en R-9 (no el blanco) y el aviso", () => {
  const paleta: ColorOrganico[] = ["940", "951", "915"].map((codigo) => ({ codigo, peso: 10, formatos: ["R-24", "R-18", "R-12", "R-5"] }));
  const r = armarOrganico({ ...opcionesArcoOrganico({ anchoCm: 200, altoCm: 200, radioBaseCm: 40, radioPuntaCm: 26, semilla: 7, densidad: 1, colores: paleta, flores: null, huecosFlores: 0 }), relleno: RELLENO_TUPIDO });
  const r9 = r.globos.filter((g) => g.formatoId === "R-9");
  assert.ok(r9.length > 0);
  assert.ok(r9.every((g) => g.codigo !== "005"), "ningún R-9 cae en Fashion Blanco");
  assert.ok(r9.every((g) => coloresDelFormato("R-9").some((c) => c.codigo === g.codigo)), "los R-9 usan colores que se fabrican en R-9");
  assert.ok(r.avisos.some((a) => /Ningún color de la paleta se fabrica en R-9: se usa .* el más parecido a/.test(a)), "lo avisa");
});
prueba("la herramienta lo dice (AVISO DE COLOR) y propone quitar ese tamaño; quitar R-9 deja solo reflex", () => {
  const e = ok(aplicarHerramienta(vacia, "agregar_pieza", { tipo: "arco_organico", colores: ["dorado reflex", "plata reflex"] })).escena;
  const r = ok(aplicarHerramienta(e, "cambiar_pieza", { id: "arco-organico", colores: ["azul reflex", "violeta reflex", "rojo reflex"] }));
  assert.match(r.resumen, /AVISO DE COLOR[\s\S]*Ningún color de la paleta se fabrica en R-9[\s\S]*quita ese tamaño/);
  const r2 = ok(aplicarHerramienta(r.escena, "ajustar_tamanos", { id: "arco-organico", cambios: [{ formato: "R-9", accion: "quitar" }] }));
  const usados = [...new Set(armarPieza(nodo(r2.escena, "arco-organico").pieza).globos.map((g) => g.codigo))];
  assert.ok(usados.length > 0 && usados.every((c) => referenciaPorCodigo(c)?.familia === "reflex"), `colores: ${usados.join(", ")}`);
});
prueba("sustitutoDeFamilia solo vale si es parecido; masParecidoEnFormato siempre da uno que se fabrica", () => {
  const azul = referenciaPorCodigo("940")!;
  assert.equal(sustitutoDeFamilia(azul, "R-9"), null, "Reflex Plata/Dorado no valen por un azul");
  assert.equal(sustitutoDeFamilia(referenciaPorCodigo("971")!, "R-9")?.familia, "reflex", "un champaña sí se parece a un reflex de R-9");
  const m = masParecidoEnFormato(azul.hexGlobo, "R-9")!;
  assert.ok(coloresDelFormato("R-9").some((c) => c.codigo === m.ref.codigo));
  const r = colorDeRescate([{ codigo: "940", peso: 1 }], new Map(TABLA_SEMPERTEX.referencias.map((x) => [x.codigo, x])), "R-9");
  assert.ok(r.ref && r.ref.codigo !== "005" && /Ningún color de la paleta se fabrica en R-9/.test(r.aviso));
});

console.log("6. Zonas izquierda y derecha");
prueba("enZona: izquierda y derecha parten el eje por su centro en x; una pieza angosta es toda", () => {
  const rango = rangoAltura([{ x: -100, y: 0 }, { x: 0, y: 200 }, { x: 100, y: 0 }]);
  assert.ok(enZona("izquierda", 0.2, 50, rango, -60) && !enZona("izquierda", 0.2, 50, rango, 60));
  assert.ok(enZona("derecha", 0.8, 50, rango, 60) && !enZona("derecha", 0.8, 50, rango, -60));
  assert.ok(enZona("izquierda", 0.5, 200, rango, 0) && enZona("derecha", 0.5, 200, rango, 0), "la clave está en las dos");
  const columna = rangoAltura([{ x: -10, y: 0 }, { x: 10, y: 200 }]);
  assert.ok(enZona("izquierda", 0.5, 100, columna, 8) && enZona("derecha", 0.5, 100, columna, -8), "una columna sola no tiene lados");
});
prueba("más R-24 en la pata izquierda: suben ahí y la mezcla (R-12, R-18, R-24) de la pata derecha queda igual", () => {
  const e = escenaPredefinida("arco_organico_columnas_guirnalda");
  const antes = nodo(e, "arco").pieza;
  const r = ok(aplicarHerramienta(e, "ajustar_tamanos", { id: "arco", cambios: [{ formato: "R-24", accion: "mas", donde: "izquierda" }] }));
  const despues = nodo(r.escena, "arco").pieza;
  const izq = (p: Pieza) => porFormato(p, "pata/izquierda")["R-24"] ?? 0;
  const der = (p: Pieza) => porFormato(p, "pata/derecha");
  assert.ok(izq(despues) >= izq(antes) + 2, `izquierda ${izq(antes)} → ${izq(despues)}`);
  for (const f of ["R-24", "R-18", "R-12"]) assert.equal(der(despues)[f] ?? 0, der(antes)[f] ?? 0, `derecha ${f} no cambia`);
  assert.match(r.resumen, /izquierda: \d+ → \d+/);
});
prueba("derecha con solo_ahi: el formato se quita de la izquierda", () => {
  const e = escenaPredefinida("arco_organico_columnas_guirnalda");
  const r = ok(aplicarHerramienta(e, "ajustar_tamanos", { id: "arco", cambios: [{ formato: "R-18", accion: "mas", donde: "derecha", solo_ahi: true }] }));
  const p = nodo(r.escena, "arco").pieza;
  assert.equal(porFormato(p, "pata/izquierda")["R-18"] ?? 0, 0, "ya no hay R-18 en la izquierda");
  assert.ok((porFormato(p, "pata/derecha")["R-18"] ?? 0) > 0);
});

console.log(`\n${pruebas} pruebas OK`);
