/**
 * Lógica pura del modal «Ajusta la propuesta» (`src/components/plan/ajuste/ajuste-propuesta.ts`): qué le pide el
 * explorador a `/api/plan-editar`, cómo se convierte lo que devuelve en tarjetas y cuándo se puede guardar.
 * Sin React, sin red, sin proveedores. Qué globo se vende y su color son del catálogo de Python
 * (`test_catalog.py`); aquí solo se prueba lo que la pantalla decide con eso.
 *
 * Run: npx tsx scripts/test/test-ajuste-propuesta.ts
 */
import assert from "node:assert/strict";
import {
  LIMITE_INICIAL,
  LIMITE_MAXIMO,
  MENSAJE_PARTICIPACION,
  agruparPorFamilia,
  agruparPorTamano,
  armarBusqueda,
  armarConsultas,
  armarEdicion,
  armarPeticionColores,
  avisoAplicado,
  claveFiltros,
  colorInicial,
  describirLinea,
  leerRespuestaBusqueda,
  leerRespuestaColores,
  lineaObjetivoDe,
  miniaturaDeCatalogo,
  motivoNoAplicable,
  puedeCargarMas,
  resumenFiltros,
  siguienteLimite,
  tamanoInicialDe,
  tarjetasDeCandidatos,
  validarParticipacion,
  varianteParaAplicar,
  type CandidatoDelServidor,
  type TarjetaGlobo,
} from "../../src/components/plan/ajuste/ajuste-propuesta";
import {
  FAMILIAS,
  agruparColoresPorFamilia,
  coloresDeBusqueda,
  familiaDeColor,
  familiaDeColores,
} from "../../src/components/plan/ajuste/familias-color";
import { crearCacheTemporal } from "../../src/lib/cache/cache-temporal";
import { PALETA_COLORES_V2 } from "../../src/lib/rag/taxonomy/v2";

let casos = 0;
function caso(nombre: string, prueba: () => void): void {
  try {
    prueba();
  } catch (error) {
    console.error(`[FAIL] ${nombre}`);
    throw error;
  }
  casos += 1;
  console.log(`[PASS] ${nombre}`);
}

const BASE = { texto: "", colores: [] as string[], tamanos: [] as number[], limite: LIMITE_INICIAL, approvalToken: "token" };

caso("la búsqueda sin texto ni filtros pide el catálogo entero; con filtros, solo los filtros", () => {
  assert.deepEqual(armarBusqueda(BASE), { modo: "buscar", consulta: "globo", approval_token: "token", limite: 10 });
  const porColor = armarBusqueda({ ...BASE, colores: ["rojo", "azul"], tamanos: [12] });
  assert.equal(porColor.consulta, "", "filtros sin texto: el servidor recorre el catálogo por filtros");
  assert.deepEqual(porColor.filtros, { colores: ["rojo", "azul"], tamanos_pulgadas: [12] });
  assert.equal(armarBusqueda({ ...BASE, texto: "a", colores: ["rojo"] }).consulta, "", "una letra no es texto");
  assert.equal(armarBusqueda({ ...BASE, texto: "a" }).consulta, "globo", "una letra y nada más: el catálogo entero");
  const conTexto = armarBusqueda({ ...BASE, texto: "  globo metalizado ", colores: ["rojo"] });
  assert.equal(conTexto.consulta, "globo metalizado");
  assert.deepEqual(conTexto.filtros, { colores: ["rojo"] }, "sin tamaños no se manda la lista vacía");
});

caso("la búsqueda respeta lo que el servidor acepta: sin repetidos, máximo 8 y límite entre 1 y 40", () => {
  const nueve = Array.from({ length: 9 }, (_, i) => `color-${i}`);
  assert.equal(armarBusqueda({ ...BASE, colores: [...nueve, "color-0"] }).filtros?.colores?.length, 8);
  assert.equal(armarBusqueda({ ...BASE, tamanos: [5, 5, 9] }).filtros?.tamanos_pulgadas?.length, 2);
  assert.equal(armarBusqueda({ ...BASE, limite: 0 }).limite, 1);
  assert.equal(armarBusqueda({ ...BASE, limite: 99 }).limite, LIMITE_MAXIMO);
  assert.equal(armarBusqueda({ ...BASE, limite: 12.9 }).limite, 12);
});

caso("el token y el modo LoRA viajan solo si existen, y la línea objetivo solo si es un globo", () => {
  const sinToken = armarBusqueda({ ...BASE, approvalToken: undefined });
  assert.equal("approval_token" in sinToken, false);
  assert.equal(Object.hasOwn(sinToken, "loraMode"), false);
  assert.deepEqual(armarPeticionColores("t"), { modo: "colores", approval_token: "t" });
  assert.deepEqual(armarPeticionColores(undefined), { modo: "colores" });
  const globo = { forma: "redondo", diam_pulg: 12 };
  assert.deepEqual(lineaObjetivoDe(globo), { forma: "redondo", diam_pulg: 12 });
  assert.equal(lineaObjetivoDe({ forma: null, diam_pulg: null }), undefined, "un telón o un kit admite cualquier producto");
  assert.equal(lineaObjetivoDe(undefined), undefined);
  assert.deepEqual(armarBusqueda({ ...BASE, lineaObjetivo: globo }).linea_objetivo, globo);
  assert.deepEqual(tamanoInicialDe({ diam_pulg: 12 }), [12], "al cambiar un globo de 12″ se parte de los de 12″");
  assert.deepEqual(tamanoInicialDe({ diam_pulg: 7 }), [], "un tamaño que el catálogo no vende no filtra");
  assert.deepEqual(tamanoInicialDe(undefined), []);
});

caso("«Cargar más» sube de 10 en 10 hasta 40 y solo se ofrece si hay más", () => {
  let limite = LIMITE_INICIAL;
  const pasos = [limite];
  for (let i = 0; i < 4; i += 1) { limite = siguienteLimite(limite); pasos.push(limite); }
  assert.deepEqual(pasos, [10, 20, 30, 40, 40]);
  assert.equal(puedeCargarMas(10, true), true);
  assert.equal(puedeCargarMas(10, false), false, "el servidor dijo que no hay más");
  assert.equal(puedeCargarMas(LIMITE_MAXIMO, true), false, "ya se pidió el tope");
});

caso("la clave de la búsqueda ignora el límite pero no los filtros", () => {
  const a = armarBusqueda({ ...BASE, colores: ["rojo"], limite: 10 });
  assert.equal(claveFiltros(a), claveFiltros(armarBusqueda({ ...BASE, colores: ["rojo"], limite: 20 })));
  assert.notEqual(claveFiltros(a), claveFiltros(armarBusqueda({ ...BASE, colores: ["azul"] })));
  assert.notEqual(claveFiltros(a), claveFiltros(armarBusqueda({ ...BASE, colores: ["rojo"], tamanos: [9] })));
  assert.notEqual(claveFiltros(a), claveFiltros(armarBusqueda({ ...BASE, colores: ["rojo"], lineaObjetivo: { forma: "redondo", diam_pulg: 9 } })));
});

caso("cada color de la paleta tiene familia, y lo que la paleta no conoce cae en «Otros» sin perderse", () => {
  for (const color of PALETA_COLORES_V2) assert.notEqual(familiaDeColor(color), "otros", `${color} debe tener familia`);
  assert.equal(familiaDeColor("rojo"), "rojos");
  assert.equal(familiaDeColor("burdeos"), "rojos");
  assert.equal(familiaDeColor("dorado rosa"), "dorados");
  assert.equal(familiaDeColor("Café"), "neutros", "mayúsculas y tildes no cambian la familia");
  assert.equal(familiaDeColor("  LILA "), "morados");
  assert.equal(familiaDeColor("transparente"), "neutros");
  assert.equal(familiaDeColor("frambuesa"), "otros", "un color que la paleta no conoce");
  assert.equal(familiaDeColor("gris"), "otros", "gris se observa pero el catálogo no lo vende");
  assert.equal(familiaDeColor("constructor"), "otros", "una clave heredada del objeto no es un color");
  assert.equal(new Set(FAMILIAS.map((f) => f.id)).size, FAMILIAS.length);
});

caso("los colores del catálogo se reparten en familias en orden fijo, con el más surtido primero", () => {
  const familias = agruparColoresPorFamilia([
    { valor: "azul", total: 132 }, { valor: "dorado", total: 130 }, { valor: "turquesa", total: 2 }, { valor: "multicolor", total: 307 },
    { valor: "rojo", total: 93 }, { valor: "burdeos", total: 5 }, { valor: "champagne", total: 4 }, { valor: "frambuesa", total: 1 }, { valor: "dorado rosa", total: 19 },
  ]);
  assert.deepEqual(familias.map((f) => f.id), ["rojos", "dorados", "azules", "multicolor", "otros"], "orden fijo, y solo las familias que el catálogo tiene");
  assert.deepEqual(familias.find((f) => f.id === "dorados")!.colores.map((c) => c.valor), ["dorado", "dorado rosa", "champagne"], "el más surtido primero");
  assert.deepEqual(familias.find((f) => f.id === "otros")!.colores, [{ valor: "frambuesa", total: 1 }], "lo desconocido no se pierde");
  assert.equal(familias.reduce((suma, f) => suma + f.colores.length, 0), 9, "ningún color se pierde en el reparto");
  const dorados = familias.find((f) => f.id === "dorados")!;
  assert.deepEqual(coloresDeBusqueda(dorados, []), ["dorado", "dorado rosa", "champagne"], "sin colores marcados: toda la familia");
  assert.deepEqual(coloresDeBusqueda(dorados, ["champagne", "azul"]), ["champagne"], "con colores marcados: solo esos, y solo los de la familia");
});

caso("un producto con varios colores va a «Multicolor» salvo que sus colores sean de una misma familia", () => {
  assert.equal(familiaDeColores(["dorado"]), "dorados");
  assert.equal(familiaDeColores(["dorado", "dorado rosa"]), "dorados");
  assert.equal(familiaDeColores(["dorado", "multicolor"]), "multicolor");
  assert.equal(familiaDeColores(["blanco", "dorado"]), "multicolor");
  assert.equal(familiaDeColores(["multicolor"]), "multicolor");
  assert.equal(familiaDeColores([]), "otros");
  assert.equal(familiaDeColores(["frambuesa"]), "otros");
});

const tarjeta = (productId: string, colores: string[], opciones: Array<{ id: string; diam: number | null }>): TarjetaGlobo => ({
  productId,
  nombre: `Globo ${productId}`,
  imagen: null,
  colores,
  opciones: opciones.map((o) => ({ variantId: o.id, productId, variantIds: [o.id], tamano: o.diam === null ? null : `${o.diam} pulgadas`, tamanoCorto: o.diam === null ? null : `${o.diam}″`, diamPulg: o.diam, colores })),
});

caso("las búsquedas: una sola sin familia; con familias, una por familia con sus colores, sin pasar el tope de ocho", () => {
  const catalogo = agruparColoresPorFamilia([
    { valor: "rojo", total: 9 }, { valor: "burdeos", total: 1 }, { valor: "dorado", total: 5 },
    ...["blanco", "negro", "beige", "crema", "nude", "cafe", "transparente"].map((valor) => ({ valor, total: 1 })),
  ]);
  const base = { texto: "", tamanos: [] as number[], limite: 10, approvalToken: "t" };
  const sinFamilia = armarConsultas({ ...base, familias: [], exactos: [], catalogo });
  assert.equal(sinFamilia.length, 1);
  assert.equal(sinFamilia[0]!.familia, null);
  assert.equal(sinFamilia[0]!.cuerpo.consulta, "globo");
  const varias = armarConsultas({ ...base, familias: ["neutros", "rojos", "dorados"], exactos: ["burdeos"], tamanos: [12], catalogo });
  assert.deepEqual(varias.map((c) => c.familia), ["rojos", "dorados", "neutros"], "en el orden fijo de las familias, no en el que se marcaron");
  assert.deepEqual(varias[0]!.cuerpo.filtros, { colores: ["burdeos"], tamanos_pulgadas: [12] }, "el color exacto marcado manda sobre el resto de la familia");
  assert.deepEqual(varias[1]!.cuerpo.filtros?.colores, ["dorado"]);
  assert.equal(varias[2]!.cuerpo.filtros?.colores?.length, 7, "la familia más grande cabe en una sola búsqueda");
  assert.equal(armarConsultas({ ...base, familias: ["azules"], exactos: [], catalogo }).length, 1, "una familia que el catálogo no tiene: se busca todo, no se inventa");
  assert.equal(armarConsultas({ ...base, familias: ["azules"], exactos: [], catalogo })[0]!.familia, null);
});

caso("los globos sin color elegido se reparten por la familia de sus colores, en orden fijo", () => {
  const grupos = agruparPorFamilia([
    tarjeta("p-azul", ["azul"], [{ id: "a", diam: 12 }]),
    tarjeta("p-multi", ["dorado", "multicolor"], [{ id: "m", diam: 12 }]),
    tarjeta("p-rojo", ["rojo", "burdeos"], [{ id: "r", diam: 12 }]),
    tarjeta("p-rojo-2", ["rojo"], [{ id: "r2", diam: 12 }]),
    tarjeta("p-sin", [], [{ id: "s", diam: 12 }]),
  ]);
  assert.deepEqual(grupos.map((g) => [g.familia, g.tarjetas.map((t) => t.productId)]), [
    ["rojos", ["p-rojo", "p-rojo-2"]], ["azules", ["p-azul"]], ["multicolor", ["p-multi"]], ["otros", ["p-sin"]],
  ]);
});

caso("dentro de una familia los globos se subdividen por tamaño, de menor a mayor, cada uno con solo sus opciones", () => {
  const grupos = agruparPorTamano([
    tarjeta("p-1", ["rojo"], [{ id: "1-18", diam: 18 }, { id: "1-5", diam: 5 }]),
    tarjeta("p-2", ["rojo"], [{ id: "2-12", diam: 12 }, { id: "2-sin", diam: null }]),
    tarjeta("p-3", ["rojo"], [{ id: "3-5", diam: 5 }, { id: "3-12", diam: 12 }]),
  ]);
  assert.deepEqual(grupos.map((g) => g.etiqueta), ["5″", "12″", "18″", "Sin tamaño"], "numérico (12 después de 5), y lo que no trae tamaño al final");
  const cinco = grupos[0]!;
  assert.deepEqual(cinco.tarjetas.map((t) => t.productId), ["p-1", "p-3"]);
  assert.deepEqual(cinco.tarjetas[0]!.opciones.map((o) => o.variantId), ["1-5"], "solo las opciones de ese tamaño");
  assert.deepEqual(grupos[1]!.tarjetas.map((t) => [t.productId, t.opciones.map((o) => o.variantId)]), [["p-2", ["2-12"]], ["p-3", ["3-12"]]]);
  assert.equal(grupos.reduce((suma, g) => suma + g.tarjetas.reduce((s, t) => s + t.opciones.length, 0), 0), 6, "ninguna opción se pierde ni se repite");
  assert.deepEqual(agruparPorTamano([]), []);
});

caso("el resumen de filtros plegado dice lo elegido: familias, colores exactos y tamaños", () => {
  const catalogo = agruparColoresPorFamilia([{ valor: "dorado", total: 5 }, { valor: "champagne", total: 1 }, { valor: "rojo", total: 3 }]);
  assert.deepEqual(resumenFiltros({ familias: [], exactos: [], tamanos: [], catalogo }), []);
  assert.deepEqual(resumenFiltros({ familias: ["dorados"], exactos: [], tamanos: [12, 5], catalogo }), ["Dorados", "5″", "12″"]);
  assert.deepEqual(resumenFiltros({ familias: ["dorados", "rojos"], exactos: ["champagne"], tamanos: [], catalogo }), ["Rojos", "Champagne"]);
  assert.deepEqual(resumenFiltros({ familias: ["azules"], exactos: [], tamanos: [], catalogo }), [], "una familia que el catálogo no tiene no se anuncia");
});

caso("las fotos del CDN de Shopify se piden al tamaño en que se ven; otras direcciones quedan como están", () => {
  const foto = "https://cdn.shopify.com/s/files/1/0825/6100/7911/files/R12.jpg?v=1768592952";
  assert.equal(miniaturaDeCatalogo(foto, 360), `${foto}&width=360`);
  assert.equal(miniaturaDeCatalogo("https://cdn.shopify.com/s/files/x.jpg", 240), "https://cdn.shopify.com/s/files/x.jpg?width=240");
  assert.equal(miniaturaDeCatalogo(`${foto}&width=100`, 360), `${foto}&width=100`, "ya trae su ancho");
  assert.equal(miniaturaDeCatalogo("https://otro.example/a.jpg", 360), "https://otro.example/a.jpg");
  assert.equal(miniaturaDeCatalogo("no es una url", 360), "no es una url");
});

caso("la participación va de 2 a 79 % y la edición lleva la fracción", () => {
  assert.deepEqual(validarParticipacion("20"), { ok: true, fraccion: 0.2 });
  assert.deepEqual(validarParticipacion("2"), { ok: true, fraccion: 0.02 });
  assert.deepEqual(validarParticipacion("79"), { ok: true, fraccion: 0.79 });
  for (const mala of ["1", "80", "0", "-5", "", "  ", "abc", "NaN", "Infinity"]) {
    assert.deepEqual(validarParticipacion(mala), { ok: false, mensaje: MENSAJE_PARTICIPACION }, mala);
  }
});

caso("no se puede guardar mientras falte algo, y el motivo lo dice en español", () => {
  const listo = { modo: "reemplazar" as const, objetivoVariantId: "v-1", elegido: { variantId: "v-2" }, participacion: "20" };
  assert.equal(motivoNoAplicable(listo), null);
  assert.match(motivoNoAplicable({ ...listo, objetivoVariantId: null }) ?? "", /Elige primero el globo que quieres cambiar/);
  assert.match(motivoNoAplicable({ ...listo, elegido: null }) ?? "", /Elige el globo nuevo/);
  assert.match(motivoNoAplicable({ ...listo, modo: "agregar", elegido: null }) ?? "", /para agregarlo/);
  assert.equal(motivoNoAplicable({ ...listo, modo: "agregar", objetivoVariantId: null }), null, "agregar no necesita un globo que cambiar");
  assert.equal(motivoNoAplicable({ ...listo, modo: "agregar", participacion: "95" }), MENSAJE_PARTICIPACION);
  assert.equal(motivoNoAplicable({ ...listo, participacion: "95" }), null, "cambiar no usa la participación");
});

caso("la edición que se manda coincide con lo elegido: agregar lleva participación; cambiar, el globo y no más", () => {
  const elegido = { variantId: "v-2", productId: "p-2" };
  const agregar = armarEdicion({ modo: "agregar", objetivoVariantId: "v-1", participacion: "35", estructuraId: "EST_01", elegido, color: " rojo " });
  assert.deepEqual(agregar, { accion: "agregar", estructura_id: "EST_01", variante: { product_id: "p-2", variant_id: "v-2", color: "rojo" }, participacion: 0.35 });
  const cambiar = armarEdicion({ modo: "reemplazar", objetivoVariantId: "v-1", participacion: "35", estructuraId: "EST_01", elegido, color: "" });
  assert.deepEqual(cambiar, { accion: "reemplazar", estructura_id: "EST_01", objetivo_variant_id: "v-1", variante: { product_id: "p-2", variant_id: "v-2" } });
  assert.equal(armarEdicion({ modo: "reemplazar", objetivoVariantId: null, participacion: "20", estructuraId: "EST_01", elegido, color: "" }), null, "sin globo que cambiar no hay edición");
  assert.equal(armarEdicion({ modo: "agregar", objetivoVariantId: null, participacion: "99", estructuraId: "EST_01", elegido, color: "" }), null);
  assert.equal(avisoAplicado("agregar"), "Listo, agregué el globo.");
  assert.equal(avisoAplicado("reemplazar"), "Listo, cambié el globo.");
});

const variante = (variantId: string, over: Partial<CandidatoDelServidor["variantes"][number]> = {}): CandidatoDelServidor["variantes"][number] => ({
  variantId, titulo: null, disponible: true, codigoTamano: "R-12", diamPulg: 12, forma: "redondo", colores: ["rojo"], ...over,
});
const producto = (variantes: CandidatoDelServidor["variantes"], productId = "p-1"): CandidatoDelServidor => ({ productId, titulo: "B2b Globo Latex Redondo Fashion Rojo", imagen: "https://cdn.example/rojo.jpg", variantes });

caso("las tarjetas traen solo opciones disponibles, de menor a mayor tamaño, con el nombre que ve el cliente", () => {
  const tarjetas = tarjetasDeCandidatos([
    producto([
      variante("v-18", { codigoTamano: "R-18", diamPulg: 18 }),
      variante("v-12", {}),
      variante("v-12m", { colores: ["rojo", "multicolor"] }),
      variante("v-agotada", { disponible: false, diamPulg: 5, codigoTamano: "R-5" }),
    ]),
    { productId: "p-2", titulo: "Globo agotado", imagen: null, variantes: [variante("v-x", { disponible: false })] },
    { productId: "p-3", titulo: "Globo sin tamaño", imagen: null, variantes: [variante("v-s", { codigoTamano: null, diamPulg: null, colores: [] })] },
  ]);
  assert.deepEqual(tarjetas.map((t) => t.productId), ["p-1", "p-3"], "un producto sin nada disponible no es una tarjeta");
  const [rojo, sinTamano] = tarjetas;
  assert.equal(rojo!.nombre, "Globo Latex Redondo Fashion Rojo", "sin el «B2b» del catálogo");
  assert.deepEqual(rojo!.opciones.map((o) => [o.diamPulg, o.colores.join("+")]), [[12, "rojo"], [12, "rojo+multicolor"], [18, "rojo"]], "por tamaño; un tamaño agotado no sale");
  assert.deepEqual(rojo!.colores, ["rojo", "multicolor"]);
  assert.equal(rojo!.opciones[0]!.tamano, "12 pulgadas");
  assert.equal(rojo!.opciones[0]!.tamanoCorto, "12″");
  assert.equal(sinTamano!.opciones[0]!.tamano, null);
  assert.equal(rojo!.imagen, "https://cdn.example/rojo.jpg");
  for (const opcion of rojo!.opciones) for (const campo of ["precio", "paquete", "unidadesPaquete"]) assert.equal(campo in opcion, false, `la opción no lleva «${campo}»: el modal solo habla de tamaño y color`);
  assert.equal("desde" in rojo!, false);
});

caso("las presentaciones que solo difieren en el paquete son UNA opción, representada por el paquete más pequeño", () => {
  const [tarjetaUna] = tarjetasDeCandidatos([
    producto([
      variante("v-x50", { titulo: "R-12 / PAQUETE X 50" }),
      variante("v-x12", { titulo: "R-12 / PAQUETE X 12" }),
      variante("v-x20", { titulo: "R-12 / PAQUETE X 20" }),
    ]),
  ]);
  assert.equal(tarjetaUna!.opciones.length, 1, "x12, x20 y x50 del mismo tamaño y color: una sola opción");
  const opcion = tarjetaUna!.opciones[0]!;
  assert.equal(opcion.variantId, "v-x12", "el representante es el paquete más pequeño");
  assert.deepEqual(opcion.variantIds, ["v-x12", "v-x20", "v-x50"], "todas las presentaciones disponibles, de menor a mayor paquete");
  assert.equal(opcion.productId, "p-1");

  const [sinTitulo] = tarjetasDeCandidatos([producto([variante("v-b"), variante("v-a"), variante("v-c", { titulo: "R-12 / PAQUETE X 12" })])]);
  assert.equal(sinTitulo!.opciones[0]!.variantId, "v-c", "una presentación con paquete conocido gana a las que no lo dicen");
  const [empate] = tarjetasDeCandidatos([producto([variante("v-b"), variante("v-a")])]);
  assert.equal(empate!.opciones[0]!.variantId, "v-a", "sin datos de paquete: el id menor, siempre el mismo");
});

caso("tamaños, colores o formas distintos son opciones distintas, aunque el paquete sea el mismo", () => {
  const [una] = tarjetasDeCandidatos([
    producto([
      variante("v-12-rojo-x12", { titulo: "R-12 / PAQUETE X 12" }),
      variante("v-12-rojo-x50", { titulo: "R-12 / PAQUETE X 50" }),
      variante("v-18-rojo", { codigoTamano: "R-18", diamPulg: 18, titulo: "R-18 / PAQUETE X 12" }),
      variante("v-12-azul", { colores: ["azul"], titulo: "R-12 / PAQUETE X 12" }),
      variante("v-12-corazon", { forma: "corazon", titulo: "R-12 / PAQUETE X 12" }),
      variante("v-12-rojo-mayus", { colores: ["Rojo"], titulo: "R-12 / PAQUETE X 25" }),
    ]),
  ]);
  const porId = Object.fromEntries(una!.opciones.map((o) => [o.variantId, o.variantIds]));
  assert.equal(una!.opciones.length, 4, "12″ rojo, 12″ azul, 12″ corazón rojo y 18″ rojo");
  assert.deepEqual(porId["v-12-rojo-x12"], ["v-12-rojo-x12", "v-12-rojo-mayus", "v-12-rojo-x50"], "«Rojo» y «rojo» son el mismo color");
  assert.deepEqual(Object.keys(porId).sort(), ["v-12-azul", "v-12-corazon", "v-12-rojo-x12", "v-18-rojo"]);
  const todas = una!.opciones.flatMap((o) => o.variantIds);
  assert.equal(new Set(todas).size, 6, "ninguna variante se pierde ni se repite al colapsar");
});

caso("una variante agotada nunca esconde a una disponible ni la representa", () => {
  const [pequenaAgotada] = tarjetasDeCandidatos([
    producto([variante("v-x12", { titulo: "R-12 / PAQUETE X 12", disponible: false }), variante("v-x50", { titulo: "R-12 / PAQUETE X 50" })]),
  ]);
  assert.equal(pequenaAgotada!.opciones.length, 1, "el 12″ rojo sigue ofreciéndose aunque su paquete chico se haya agotado");
  assert.equal(pequenaAgotada!.opciones[0]!.variantId, "v-x50", "el representante es el más pequeño que SÍ hay");
  assert.deepEqual(pequenaAgotada!.opciones[0]!.variantIds, ["v-x50"]);
  const [mezcla] = tarjetasDeCandidatos([
    producto([variante("v-5-agotada", { diamPulg: 5, codigoTamano: "R-5", disponible: false }), variante("v-12"), variante("v-9", { diamPulg: 9, codigoTamano: "R-9" })]),
  ]);
  assert.deepEqual(mezcla!.opciones.map((o) => o.variantId), ["v-9", "v-12"], "solo lo que hay, sin huecos");
});

caso("se aplica con una variante real: la que la propuesta ya compra, y si no, la del paquete más pequeño", () => {
  const opcion = { variantId: "v-x12", variantIds: ["v-x12", "v-x20", "v-x50"] };
  assert.equal(varianteParaAplicar(opcion, new Set()), "v-x12", "nada en la propuesta: el paquete más pequeño");
  assert.equal(varianteParaAplicar(opcion, new Set(["otra", "v-x50"])), "v-x50", "la propuesta ya compra esa presentación: la misma");
  assert.equal(varianteParaAplicar(opcion, new Set(["v-x50", "v-x20"])), "v-x20", "si usa varias, la de paquete más pequeño de las que usa");
  assert.equal(varianteParaAplicar(opcion, new Set(["no-es-de-esta-opcion"])), "v-x12", "una variante ajena no cambia el representante");
  for (const enPlan of [new Set<string>(), new Set(["v-x50"]), new Set(["v-x12", "v-x20"])]) {
    assert.ok(opcion.variantIds.includes(varianteParaAplicar(opcion, enPlan)), "siempre una variante de la opción");
  }
});

caso("el color de la variante elegida arranca en el único que tiene o en el que el cliente ya filtró", () => {
  assert.equal(colorInicial({ colores: ["dorado"] }, ["rojo"]), "dorado");
  assert.equal(colorInicial({ colores: ["multicolor", "rojo", "blanco"] }, ["rojo"]), "rojo");
  assert.equal(colorInicial({ colores: ["multicolor", "rojo"] }, []), "", "varios colores y ninguno filtrado: lo decide el cliente");
  assert.equal(colorInicial({ colores: [] }, ["rojo"]), "");
});

caso("las respuestas del servidor se validan en el borde: lo que no tiene la forma esperada es null", () => {
  const candidato = { productId: "p-1", titulo: "Globo", categoria: "globo_latex", imagen: null, disponible: true, variantes: [variante("v-1")] };
  assert.deepEqual(leerRespuestaBusqueda({ status: "OK", candidatos: [candidato], filtroRelajado: null, hayMas: true })?.hayMas, true);
  assert.equal(leerRespuestaBusqueda({ candidatos: [candidato] })?.hayMas, false, "un servidor que no dice hayMas: no hay más");
  assert.equal(leerRespuestaBusqueda({ candidatos: [{ ...candidato, productId: "" }] }), null);
  assert.equal(leerRespuestaBusqueda({ candidatos: [{ ...candidato, variantes: [{ ...candidato.variantes[0], disponible: "si" }] }] }), null);
  assert.equal(leerRespuestaBusqueda({ error: "x" }), null);
  assert.equal(leerRespuestaBusqueda(null), null);
  assert.deepEqual(leerRespuestaColores({ colores: [{ valor: "rojo", total: 93 }] }), [{ valor: "rojo", total: 93 }]);
  assert.equal(leerRespuestaColores({ colores: [{ valor: "", total: 1 }] }), null);
  assert.equal(leerRespuestaColores({ colores: [{ valor: "rojo" }] }), null);
  assert.equal(leerRespuestaColores({}), null);
});

caso("una línea de la pieza se describe como la ve el cliente", () => {
  assert.equal(describirLinea({ titulo: "B2b Globo Latex Redondo Rojo", tamano_codigo: "R-12", color: "rojo" }), "Globo Latex Redondo Rojo · 12 pulgadas · rojo");
  assert.equal(describirLinea({ titulo: "Telón dorado", tamano_codigo: null, color: null }), "Telón dorado");
});

async function casoAsync(nombre: string, prueba: () => Promise<void>): Promise<void> {
  try {
    await prueba();
  } catch (error) {
    console.error(`[FAIL] ${nombre}`);
    throw error;
  }
  casos += 1;
  console.log(`[PASS] ${nombre}`);
}

const pausa = (ms = 0) => new Promise<void>((resolver) => setTimeout(resolver, ms));

async function main(): Promise<void> {
  await casoAsync("la caché pide una sola vez lo mismo, también si dos lo piden a la vez, y lo olvida al vencer", async () => {
    let reloj = 1_000;
    const cache = crearCacheTemporal<string>({ ttlMs: 100, maximo: 10, ahora: () => reloj });
    let llamadas = 0;
    const producir = async () => { llamadas += 1; await pausa(5); return `valor-${llamadas}`; };
    const [a, b] = await Promise.all([cache.obtener("k", producir), cache.obtener("k", producir)]);
    assert.deepEqual([a, b, llamadas], ["valor-1", "valor-1", 1], "dos peticiones simultáneas comparten una");
    assert.equal(await cache.obtener("k", producir), "valor-1");
    assert.equal(llamadas, 1, "dentro del plazo no se vuelve a pedir");
    reloj += 101;
    assert.equal(cache.espiar("k"), undefined);
    assert.equal(await cache.obtener("k", producir), "valor-2");
    assert.equal(await cache.obtener("otra", producir), "valor-3", "otra clave, otra petición");
    assert.equal(await cache.obtener("larga", producir, { ttlMs: 10_000 }), "valor-4");
    reloj += 5_000;
    assert.equal(cache.espiar("larga"), "valor-4", "un plazo propio de la llamada manda");
  });

  await casoAsync("un fallo no se guarda y la siguiente petición lo vuelve a intentar", async () => {
    const cache = crearCacheTemporal<string>({ ttlMs: 1_000, maximo: 10 });
    let llamadas = 0;
    const producir = async () => { llamadas += 1; await pausa(1); if (llamadas === 1) throw new Error("falló"); return "bien"; };
    const [primera, segunda] = await Promise.allSettled([cache.obtener("k", producir), cache.obtener("k", producir)]);
    assert.equal(primera.status, "rejected");
    assert.equal(segunda.status, "rejected", "quien esperaba la misma petición recibe el mismo fallo");
    assert.equal(await cache.obtener("k", producir), "bien");
    assert.equal(llamadas, 2);
  });

  await casoAsync("una petición en vuelo se cancela cuando ya nadie la espera, pero no si alguien la sigue esperando o fue precalentada", async () => {
    const cache = crearCacheTemporal<string>({ ttlMs: 1_000, maximo: 10 });
    let cancelada = 0;
    const lenta = (signal: AbortSignal) => new Promise<string>((resolver, rechazar) => {
      const fin = setTimeout(() => resolver("listo"), 30);
      signal.addEventListener("abort", () => { cancelada += 1; clearTimeout(fin); rechazar(new DOMException("x", "AbortError")); });
    });
    const solo = new AbortController();
    const espera = cache.obtener("solo", lenta, { signal: solo.signal });
    solo.abort();
    await assert.rejects(espera, { name: "AbortError" });
    assert.equal(cancelada, 1, "sin nadie esperando, la petición se cancela");

    const uno = new AbortController();
    const dos = new AbortController();
    const e1 = cache.obtener("dos", lenta, { signal: uno.signal });
    const e2 = cache.obtener("dos", lenta, { signal: dos.signal });
    uno.abort();
    await assert.rejects(e1, { name: "AbortError" });
    assert.equal(await e2, "listo");
    assert.equal(cancelada, 1, "mientras alguien espera, sigue");

    cache.precalentar("pre", lenta);
    const suelta = new AbortController();
    const e3 = cache.obtener("pre", lenta, { signal: suelta.signal });
    suelta.abort();
    await assert.rejects(e3, { name: "AbortError" });
    await pausa(60);
    assert.equal(cancelada, 1, "lo precalentado no se cancela: alguien lo va a usar");
    assert.equal(cache.espiar("pre"), "listo");
    const yaAbortada = new AbortController();
    yaAbortada.abort();
    await assert.rejects(cache.obtener("otra", lenta, { signal: yaAbortada.signal }), { name: "AbortError" });
  });

  await casoAsync("la caché recuerda un máximo de claves y olvidar() lo vacía", async () => {
    const cache = crearCacheTemporal<number>({ ttlMs: 1_000, maximo: 2 });
    await cache.obtener("a", async () => 1);
    await cache.obtener("b", async () => 2);
    await cache.obtener("c", async () => 3);
    assert.deepEqual(["a", "b", "c"].map((clave) => cache.espiar(clave)), [undefined, 2, 3], "se olvida la más antigua");
    cache.olvidar();
    assert.equal(cache.espiar("c"), undefined);
  });

  console.log(`\n${casos} casos en verde`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
