import assert from "node:assert/strict";
import test from "node:test";
import { clasificacionDe } from "./clasificacion-biblioteca";
import { CELEBRACIONES, TEMATICAS } from "./taxonomia-celebraciones";
import {
  FILTRO_TAXONOMIA_VACIO, alternarOpcion, contarPorEje, etiquetaPrincipal, filtrarPorTaxonomia, hayFiltroTaxonomia, opcionesAgrupadas,
  ordenarPorIds, textoEtiquetaPrincipal, type Clasificador,
} from "./filtros-taxonomia";
import { filtrarBiblioteca, type ItemBiblioteca } from "../globos3d/biblioteca";

const TABLA: Record<string, { celebraciones: string[]; tematicas: string[] }> = {
  a: { celebraciones: ["cumpleanos", "baby-shower"], tematicas: ["dinosaurios"] },
  b: { celebraciones: ["cumpleanos"], tematicas: ["unicornio", "arcoiris"] },
  c: { celebraciones: ["boda"], tematicas: [] },
  d: { celebraciones: [], tematicas: ["dinosaurios"] },
};
/** Como `clasificacionDe`: una pieza derivada (`id~nodo`) hereda lo de su escena. */
const clasificar: Clasificador = (id) => TABLA[id] ?? TABLA[id.split("~")[0]!] ?? null;
const items = ["a", "b", "c", "d", "a~nodo1", "propio:x"].map((id) => ({ id }));

test("los ids de la tabla de prueba existen en la taxonomía", () => {
  for (const id of ["cumpleanos", "baby-shower", "boda"]) assert.ok(CELEBRACIONES.some((c) => c.id === id), id);
  for (const id of ["dinosaurios", "unicornio", "arcoiris"]) assert.ok(TEMATICAS.some((t) => t.id === id), id);
});

test("cuenta por opción, con las piezas derivadas heredando y lo sin clasificar fuera", () => {
  const celebraciones = contarPorEje(items, clasificar, "celebraciones");
  assert.equal(celebraciones.get("cumpleanos"), 3);
  assert.equal(celebraciones.get("baby-shower"), 2);
  assert.equal(celebraciones.get("boda"), 1);
  const tematicas = contarPorEje(items, clasificar, "tematicas");
  assert.equal(tematicas.get("dinosaurios"), 3);
  assert.equal(tematicas.get("unicornio"), 1);
  assert.equal(tematicas.has("boda"), false);
});

test("filtra: dentro de un eje es «alguna», entre ejes «las dos»", () => {
  const ids = (f: Parameters<typeof filtrarPorTaxonomia>[2]) => filtrarPorTaxonomia(items, clasificar, f).map((i) => i.id);
  assert.deepEqual(ids({ celebraciones: ["cumpleanos"], tematicas: [] }), ["a", "b", "a~nodo1"]);
  assert.deepEqual(ids({ celebraciones: ["boda", "baby-shower"], tematicas: [] }), ["a", "c", "a~nodo1"]);
  assert.deepEqual(ids({ celebraciones: ["cumpleanos"], tematicas: ["dinosaurios"] }), ["a", "a~nodo1"]);
  assert.deepEqual(ids({ celebraciones: [], tematicas: ["dinosaurios"] }), ["a", "d", "a~nodo1"]);
  assert.deepEqual(ids({ celebraciones: ["boda"], tematicas: ["dinosaurios"] }), []);
});

test("sin filtro devuelve la misma lista; un item sin clasificar no pasa un filtro activo", () => {
  assert.equal(filtrarPorTaxonomia(items, clasificar, FILTRO_TAXONOMIA_VACIO), items);
  assert.equal(filtrarPorTaxonomia(items, clasificar, { celebraciones: ["boda"], tematicas: [] }).some((i) => i.id === "propio:x"), false);
});

test("alternar agrega y quita sin tocar el filtro anterior", () => {
  const f1 = alternarOpcion(FILTRO_TAXONOMIA_VACIO, "celebraciones", "boda");
  assert.deepEqual(f1, { celebraciones: ["boda"], tematicas: [] });
  assert.equal(hayFiltroTaxonomia(f1), true);
  assert.equal(hayFiltroTaxonomia(FILTRO_TAXONOMIA_VACIO), false);
  assert.deepEqual(alternarOpcion(f1, "celebraciones", "boda"), FILTRO_TAXONOMIA_VACIO);
  assert.deepEqual(FILTRO_TAXONOMIA_VACIO, { celebraciones: [], tematicas: [] });
});

test("agrupa por grupo de la taxonomía, solo con items, las más frecuentes primero", () => {
  const grupos = opcionesAgrupadas("celebraciones", contarPorEje(items, clasificar, "celebraciones"));
  const planas = grupos.flatMap((g) => g.opciones);
  assert.deepEqual(planas.map((o) => o.id).sort(), ["baby-shower", "boda", "cumpleanos"]);
  assert.equal(grupos.find((g) => g.opciones.some((o) => o.id === "cumpleanos"))?.opciones[0]?.n, 3);
  for (const g of grupos) {
    const esperado = CELEBRACIONES.filter((c) => c.grupo === g.grupo).map((c) => c.id);
    assert.ok(g.opciones.every((o) => esperado.includes(o.id)), `grupo ${g.grupo}`);
    assert.ok(g.nombre.length > 0 && g.nombre !== g.grupo);
    assert.deepEqual(g.opciones.map((o) => o.n), [...g.opciones.map((o) => o.n)].sort((x, y) => y - x));
  }
});

test("busca opciones por nombre o sinónimo, sin tildes; mantiene las elegidas aunque ya no tengan items", () => {
  const cuentas = contarPorEje(items, clasificar, "tematicas");
  const dino = opcionesAgrupadas("tematicas", cuentas, "DINOSAURIOS").flatMap((g) => g.opciones.map((o) => o.id));
  assert.deepEqual(dino, ["dinosaurios"]);
  assert.deepEqual(opcionesAgrupadas("tematicas", cuentas, "zzzz-nada"), []);
  const conElegida = opcionesAgrupadas("tematicas", cuentas, "", ["piratas"]).flatMap((g) => g.opciones);
  assert.deepEqual(conElegida.find((o) => o.id === "piratas"), { id: "piratas", nombre: "Piratas", n: 0 });
  const cumple = opcionesAgrupadas("celebraciones", contarPorEje(items, clasificar, "celebraciones"), "cumpleanos").flatMap((g) => g.opciones.map((o) => o.id));
  assert.deepEqual(cumple, ["cumpleanos"]);
});

test("la etiqueta principal es la de mayor confianza (primera) con su nombre", () => {
  assert.deepEqual(etiquetaPrincipal({ celebraciones: ["boda", "cumpleanos"], tematicas: ["dinosaurios"] }), { celebracion: "Boda", tematica: "Dinosaurios" });
  assert.equal(textoEtiquetaPrincipal({ celebraciones: ["boda"], tematicas: ["dinosaurios"] }), "Boda · Dinosaurios");
  assert.equal(textoEtiquetaPrincipal({ celebraciones: [], tematicas: ["dinosaurios"] }), "Dinosaurios");
  assert.equal(textoEtiquetaPrincipal({ celebraciones: [], tematicas: [] }), null);
  assert.equal(textoEtiquetaPrincipal(null), null);
});

test("ordenarPorIds deja el orden del parecido y descarta lo que no está", () => {
  assert.deepEqual(ordenarPorIds(items, ["c", "zzz", "a", "d"]).map((i) => i.id), ["c", "a", "d"]);
  assert.deepEqual(ordenarPorIds(items, []), []);
});

test("con la clasificación real: una pieza derivada hereda las etiquetas de su escena y se filtra como ella", () => {
  const base = "base-organica:arco-cromado-negro-oro-plata";
  const propias = clasificacionDe(base);
  assert.ok(propias && propias.tematicas.includes("metalico-cromado"));
  const derivada = `${base}~nodo-1`;
  assert.deepEqual(clasificacionDe(derivada), propias);
  const reales: Clasificador = clasificacionDe;
  const res = filtrarPorTaxonomia([{ id: base }, { id: derivada }, { id: "no-existe" }], reales, { celebraciones: [], tematicas: ["metalico-cromado"] });
  assert.deepEqual(res.map((i) => i.id), [base, derivada]);
});

test("se combina con la búsqueda de texto del panel (filtrarBiblioteca) sin perder el orden", () => {
  const mk = (id: string, nombre: string): ItemBiblioteca => ({ id, tipo: "decoracion", nombre, descripcion: "", ocasiones: [] } as unknown as ItemBiblioteca);
  const lista = [mk("a", "Arco dino verde"), mk("b", "Arco unicornio"), mk("d", "Columna dino"), mk("c", "Arco boda")];
  const porTexto = filtrarBiblioteca(lista, new Map(), { tipo: null, ocasion: null, color: null, producto: null, texto: "arco" });
  assert.deepEqual(porTexto.map((i) => i.id), ["a", "b", "c"]);
  const ambos = filtrarPorTaxonomia(porTexto, clasificar, { celebraciones: [], tematicas: ["dinosaurios"] });
  assert.deepEqual(ambos.map((i) => i.id), ["a"]);
  // El conteo de las opciones sale de los items del tipo, no del texto: no depende del orden de los pasos.
  assert.equal(contarPorEje(lista, clasificar, "tematicas").get("dinosaurios"), 2);
});

test("un item sin id (el dato llegó sin él) no rompe la biblioteca: no está clasificado, no cuenta y no pasa un filtro activo", () => {
  const base = "base-organica:arco-cromado-negro-oro-plata";
  const sinId = { nombre: "sin id" } as unknown as { id: string };
  const lista = [{ id: base }, sinId];
  // El error de /3d: `TypeError: Cannot read properties of undefined (reading 'split')` en `clasificacionDe`.
  assert.equal(clasificacionDe(undefined), null);
  assert.equal(clasificacionDe(""), null);
  assert.equal(etiquetaPrincipal(clasificacionDe(sinId.id)).celebracion, null);
  assert.equal(contarPorEje(lista, clasificacionDe, "tematicas").get("metalico-cromado"), 1);
  assert.deepEqual(filtrarPorTaxonomia(lista, clasificacionDe, { celebraciones: [], tematicas: ["metalico-cromado"] }), [{ id: base }]);
  assert.equal(filtrarPorTaxonomia(lista, clasificacionDe, FILTRO_TAXONOMIA_VACIO), lista, "sin filtro la lista pasa entera, también el item sin id");
});
