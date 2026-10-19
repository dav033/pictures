/**
 * Las ayudas («?») de la vista guiada (`src/components/guiado/ayudas-guiada.ts` y `src/components/ui/Ayuda.tsx`).
 * Pedido del dueño (2026-10-07): «agrega también iconos de tooltip que expliquen formularios, gráficas, inputs y lo
 * que sea necesario, pero tampoco nos pasemos». Comprueba:
 *   1. el catálogo: entre 8 y 12 ayudas, id único, texto de una o dos frases y como mucho 160 caracteres, sin jerga y
 *      sin repetir la etiqueta;
 *   2. que cada ayuda se usa (y que ningún «?» lleva un texto suelto fuera del catálogo);
 *   3. dónde se coloca la burbuja: arriba del icono si cabe, nunca fuera de 390 px;
 *   4. el HTML del servidor: botón con aria-label y aria-describedby que apunta a un role="tooltip" con el texto;
 *   5. cada pantalla lleva su «?» UNA vez (no en cada fila ni en cada tabla).
 * Sin red, sin Python, sin modelo: sin coste.
 *
 *   npx tsx scripts/test/test-ayudas-guiada.ts
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AYUDAS } from "@/components/guiado/ayudas-guiada";
import { Ayuda, posicionAyuda } from "@/components/ui/Ayuda";
import { CampoGanancia } from "@/components/cotizacion/CampoGanancia";
import { FilaGasto } from "@/components/cotizacion/FilaGasto";
import { ModoMateriales } from "@/components/cotizacion/ModoMateriales";
import { CotizacionPersonalGuiada } from "@/components/guiado/CotizacionPersonalGuiada";
import { DetalleGlobos } from "@/components/guiado/TablaGlobosPieza";
import { TarjetaEleccion } from "@/components/guiado/TarjetaEleccion";
import { TarjetaPlan } from "@/components/guiado/TarjetaPlan";
import { AjustarPlan } from "@/components/guiado/ajuste/AjustarPlan";
import { admiteColorNuevo, piezasAjustables } from "@/components/guiado/ajuste/ajuste-plan-guiado";
import { useAjustePlanGuiado } from "@/components/guiado/ajuste/usarAjustePlanGuiado";
import { piezasVistaDePlan } from "@/components/guiado/piezas-vista";
import { CotizacionGuiadaSchema, PlanGuiadoSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
import { bibliotecaVisible } from "@/lib/biblioteca-sempertex/biblioteca";

const sinAccion = () => undefined;
const desescapar = (html: string) => html.replaceAll("&quot;", "\"").replaceAll("&#x27;", "'").replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">");

// ── 1. El catálogo ──────────────────────────────────────────────────────────────────────────────────────────────────
const lista = Object.entries(AYUDAS).map(([clave, ayuda]) => ({ clave, ...ayuda }));
assert.ok(lista.length >= 8 && lista.length <= 12, `entre 8 y 12 ayudas («tampoco nos pasemos»): hay ${lista.length}`);
const ids = lista.map((ayuda) => ayuda.id);
assert.equal(new Set(ids).size, ids.length, `ids repetidos: ${ids.filter((id, indice) => ids.indexOf(id) !== indice).join(", ")}`);
const JERGA = [/\bPython\b/, /\bplan_hash\b/, /\bmotor\b/i, /\bSVG\b/, /\bJSON\b/, /\bAPI\b/, /\bestructura/i, /\bvariante/i, /\bproduct_id\b/, /\bIA\b/, /\bmodelo de lenguaje\b/i, /\bcotizaci[oó]n profesional\b/i];
for (const ayuda of lista) {
  assert.match(ayuda.id, /^[a-z]+(?:-[a-z]+)*$/, `${ayuda.id}: id en minúsculas con guiones (es el que queda en el registro)`);
  assert.ok(ayuda.texto.length <= 160, `${ayuda.id}: ${ayuda.texto.length} caracteres (máximo 160)`);
  assert.ok(ayuda.texto.length >= 40, `${ayuda.id}: tan corto que no explica nada`);
  // Frases: un punto (o ? !) seguido de espacio o del final; «$100.000» no corta.
  const frases = ayuda.texto.match(/[.!?](?=\s|$)/g)?.length ?? 0;
  assert.ok(frases >= 1 && frases <= 2, `${ayuda.id}: ${frases} frases (una o dos)`);
  assert.ok(/[.!?]$/.test(ayuda.texto), `${ayuda.id}: termina en punto`);
  for (const palabra of JERGA) assert.ok(!palabra.test(ayuda.texto), `${ayuda.id}: jerga «${palabra.source}» en «${ayuda.texto}»`);
  // No repite la etiqueta: el texto no empieza diciendo el tema que ya nombra el botón.
  const tema = ayuda.tema.toLocaleLowerCase("es").replace(/^(el|la|los|las|tu|lo)\s+/, "");
  assert.ok(!ayuda.texto.toLocaleLowerCase("es").startsWith(tema), `${ayuda.id}: el texto repite la etiqueta «${ayuda.tema}»`);
  assert.ok(ayuda.tema.length > 3 && ayuda.tema === ayuda.tema.toLocaleLowerCase("es"), `${ayuda.id}: el tema va en minúscula (sigue a «Ayuda: »)`);
}
const textos = lista.map((ayuda) => ayuda.texto);
assert.equal(new Set(textos).size, textos.length, "dos ayudas con el mismo texto");

// ── 2. Cada ayuda se usa, y solo desde el catálogo ──────────────────────────────────────────────────────────────────
function archivos(carpeta: string): string[] {
  return readdirSync(carpeta).flatMap((nombre) => {
    const ruta = path.join(carpeta, nombre);
    return statSync(ruta).isDirectory() ? archivos(ruta) : /\.(tsx?|mts)$/.test(nombre) ? [ruta] : [];
  });
}
const usos = new Map<string, string[]>();
const ayudasSueltas: string[] = [];
for (const archivo of archivos(path.join(process.cwd(), "src"))) {
  if (archivo.endsWith(`${path.sep}ayudas-guiada.ts`) || archivo.endsWith(`${path.sep}Ayuda.tsx`)) continue;
  const fuente = readFileSync(archivo, "utf8");
  for (const [, clave] of fuente.matchAll(/AYUDAS\.(\w+)/g)) {
    usos.set(clave!, [...(usos.get(clave!) ?? []), path.relative(process.cwd(), archivo)]);
  }
  for (const [etiqueta] of fuente.matchAll(/<Ayuda\b[^>]*>/g)) {
    // El diálogo «Ayuda y atajos» del taller es el componente `Ayuda` sin props (AyudaTaller.tsx), no un «?» de pantalla.
    const dialogoTaller = path.relative(process.cwd(), archivo) === path.join("src", "components", "tres-d", "Taller3D.tsx") && etiqueta === "<Ayuda />";
    if (!dialogoTaller && !/^<Ayuda\s+\{\.\.\.AYUDAS\.\w+\}/.test(etiqueta)) ayudasSueltas.push(`${path.relative(process.cwd(), archivo)}: ${etiqueta}`);
  }
}
for (const ayuda of lista) assert.ok(usos.has(ayuda.clave), `AYUDAS.${ayuda.clave} no se usa en ninguna pantalla (texto huérfano)`);
for (const clave of usos.keys()) assert.ok(clave in AYUDAS, `AYUDAS.${clave} no existe`);
assert.deepEqual(ayudasSueltas, [], "un «?» con texto fuera del catálogo (no lo vería esta prueba)");

// ── 3. Dónde va la burbuja (390 × 844, burbuja de 280 × 60) ─────────────────────────────────────────────────────────
const MOVIL = { width: 390, height: 844 };
const BURBUJA = { width: 280, height: 60 };
const icono = (left: number, top: number) => ({ left, top, width: 20, bottom: top + 20 });
const enMedio = posicionAyuda(icono(180, 400), BURBUJA, MOVIL);
assert.equal(enMedio.lado, "arriba", "arriba del icono si cabe: el campo que explica va debajo de su etiqueta");
assert.ok(enMedio.top + BURBUJA.height <= 400 - 8, "no tapa el icono ni lo que hay debajo");
assert.ok(enMedio.left >= 8 && enMedio.left + BURBUJA.width <= MOVIL.width - 8);
assert.equal(enMedio.flecha, 190 - enMedio.left, "la flecha apunta al centro del icono");
const izquierda = posicionAyuda(icono(2, 400), BURBUJA, MOVIL);
assert.equal(izquierda.left, 8, "pegado a la izquierda: se recoloca dentro de la ventana");
assert.ok(izquierda.flecha >= 14 && izquierda.flecha <= BURBUJA.width - 14);
const derecha = posicionAyuda(icono(366, 400), BURBUJA, MOVIL);
assert.equal(derecha.left + BURBUJA.width, MOVIL.width - 8, "pegado a la derecha: no se sale de 390 px");
assert.ok(derecha.left + derecha.flecha >= 366 && derecha.left + derecha.flecha <= 386, "la flecha cae sobre el icono (sin salirse de la esquina redonda)");
const arribaDelTodo = posicionAyuda(icono(100, 20), BURBUJA, MOVIL);
assert.equal(arribaDelTodo.lado, "abajo", "sin sitio arriba, va abajo");
assert.equal(arribaDelTodo.top, 48);
const estrecha = posicionAyuda(icono(150, 400), { width: 304, height: 80 }, { width: 320, height: 568 });
assert.ok(estrecha.left >= 8 && estrecha.left + 304 <= 312, "en 320 px también cabe");

// ── 4. El HTML del servidor: accesible y sin burbuja hasta que se abre ──────────────────────────────────────────────
type AyudaEnHtml = { id: string; etiqueta: string; texto: string };
/** Los «?» de un HTML: cada botón con su aria-label y el texto del role="tooltip" al que apunta su aria-describedby. */
function ayudasEn(html: string): AyudaEnHtml[] {
  const limpio = desescapar(html);
  return [...limpio.matchAll(/<button[^>]*data-ayuda="([^"]+)"[^>]*>/g)].map(([boton, id]) => {
    assert.match(boton, /type="button"/, `${id}: es un botón que no envía formularios`);
    const etiqueta = /aria-label="([^"]+)"/.exec(boton)?.[1];
    const describe = /aria-describedby="([^"]+)"/.exec(boton)?.[1];
    assert.ok(etiqueta?.startsWith("Ayuda: "), `${id}: aria-label «Ayuda: …»`);
    assert.ok(describe, `${id}: sin aria-describedby`);
    const descripcion = new RegExp(`<span id="${describe.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}" role="tooltip" hidden="">([^<]+)</span>`).exec(limpio);
    assert.ok(descripcion, `${id}: su aria-describedby no apunta a un role="tooltip" con texto`);
    return { id: id!, etiqueta: etiqueta!, texto: descripcion[1]! };
  });
}
const sola = renderToStaticMarkup(createElement(Ayuda, AYUDAS.ganancia));
assert.deepEqual(ayudasEn(sola), [{ id: "ganancia", etiqueta: "Ayuda: tu ganancia", texto: AYUDAS.ganancia.texto }]);
assert.ok(!sola.includes("data-ayuda-burbuja"), "cerrada, la burbuja no existe (ni en el servidor)");
assert.match(sola, /<svg[^>]*aria-hidden="true"/, "el icono es decorativo");
const dos = ayudasEn(renderToStaticMarkup(createElement("div", null, createElement(Ayuda, AYUDAS.ganancia), createElement(Ayuda, AYUDAS.valorUnidad))));
assert.equal(dos.length, 2);
const idsDescripcion = [...renderToStaticMarkup(createElement("div", null, createElement(Ayuda, AYUDAS.ganancia), createElement(Ayuda, AYUDAS.ganancia))).matchAll(/aria-describedby="([^"]+)"/g)].map((coincidencia) => coincidencia[1]);
assert.notEqual(idsDescripcion[0], idsDescripcion[1], "dos «?» iguales en la misma pantalla no comparten id");

// ── 5. Cada pantalla, su «?» una vez ────────────────────────────────────────────────────────────────────────────────
const cuenta = (html: string) => {
  const contadas = new Map<string, number>();
  for (const ayuda of ayudasEn(html)) {
    const catalogo = lista.find((item) => item.id === ayuda.id);
    assert.ok(catalogo, `${ayuda.id}: no está en el catálogo`);
    assert.equal(ayuda.texto, catalogo.texto, `${ayuda.id}: el texto del HTML no es el del catálogo`);
    assert.equal(ayuda.etiqueta, `Ayuda: ${catalogo.tema}`);
    contadas.set(ayuda.id, (contadas.get(ayuda.id) ?? 0) + 1);
  }
  return Object.fromEntries(contadas);
};

// Precio al cliente (negocio): ganancia, cómo cotizar los globos y el valor por unidad (solo en la fila que se le pide).
assert.deepEqual(cuenta(renderToStaticMarkup(createElement(CampoGanancia, { clave: "k", valor: "", error: null, onValor: sinAccion }))), { ganancia: 1 });
assert.deepEqual(cuenta(renderToStaticMarkup(createElement(ModoMateriales, { clave: "k", modo: "paquete", onModo: sinAccion, totalPaquetes: 120_000, totalGranel: 90_000, globos: { plan: 40, extra: 0, sobrante: 10 }, atenuar: false }))), { "modo-globos": 1 });
const fila = (ayudaValor: boolean) => renderToStaticMarkup(createElement("ul", null, createElement(FilaGasto, {
  seccion: "mano_de_obra", base: "mano_de_obra-k-f1", titulo: "Tu trabajo", fila: { id: "f1", descripcion: "Montaje", costo: "50000", cantidad: "2" }, errores: {}, tocada: false,
  subtotal: 100_000, atenuar: false, onCambiar: sinAccion, onConcepto: sinAccion, onPaso: sinAccion, onQuitar: sinAccion, onSalir: sinAccion, ayudaValor,
})));
assert.deepEqual(cuenta(fila(true)), { "valor-unidad": 1 });
assert.match(desescapar(fila(true)), /<label for="mano_de_obra-k-f1-costo"[^>]*>Valor por unidad<\/label>/, "la etiqueta sigue unida a su casilla");
assert.deepEqual(cuenta(fila(false)), {}, "las demás filas no repiten el «?»");

// Precio personal.
const cotizacion = CotizacionGuiadaSchema.parse({
  lineas: [{ id: "v1", tamano: "12", cantidadNecesaria: 10, disponible: true, varianteId: "v1", nombre: "B2b Globo Latex Redondo Fashion Azul Celeste — R-12 / PAQUETE X 12", color: "azul", precioPaquete: 10_000, unidadesPaquete: 12, paquetes: 1, subtotal: 10_000, sobrante: 2 }],
  total: 10_000, mermaPorcentaje: 0, incluyeIva: true, complementosSoportados: false,
});
assert.deepEqual(cuenta(renderToStaticMarkup(createElement(CotizacionPersonalGuiada, { cotizacion }))), { "precio-personal": 1 });

// «Tu plan» (plan real del registro dgkw9b: semiarco + 2 columnas): el dibujo y la barra, una vez cada uno.
const plan = PlanGuiadoSchema.parse(JSON.parse(readFileSync("scripts/test/fixtures/plan-guiado-columnas-repetidas.json", "utf8")));
const tarjeta = renderToStaticMarkup(createElement(TarjetaPlan, {
  plan, estadoImagen: "nada", usoCosteo: null, compraAbierta: false, vigente: true, ocupado: false, hechas: [], contextoCompra: {},
  onAccion: sinAccion, onCosteo: sinAccion, onProveedores: sinAccion, onDistribuidor: sinAccion, onPlanAjustado: sinAccion,
}));
assert.deepEqual(cuenta(tarjeta), { "grafica-armado": 1, "barra-tamanos": 1 }, "una vez por tarjeta, no en cada pieza");
// «Ver detalle»: una tabla por pieza, el «?» solo en la primera.
const piezasVista = piezasVistaDePlan(plan);
assert.ok(piezasVista.filter((pieza) => pieza.lineas.length > 0).length >= 2, "el plan de prueba tiene varias tablas");
assert.deepEqual(cuenta(renderToStaticMarkup(createElement(DetalleGlobos, { piezas: piezasVista, total: 100 }))), { "tabla-detalle": 1 });

// «Ajustar mi plan» con el estado real del panel (sin pedir nada: los efectos no corren en el servidor).
function PanelAjuste() {
  const ajuste = useAjustePlanGuiado({ plan, onPlanAjustado: sinAccion });
  return createElement(AjustarPlan, { plan, ajuste, ocupado: false });
}
const conCifra = piezasAjustables(plan).some((pieza) => pieza.colores.some((color) => color.cantidad));
assert.deepEqual(cuenta(renderToStaticMarkup(createElement(PanelAjuste))), {
  "colores-porcentaje": 1,
  ...(admiteColorNuevo(plan) ? { "cambiar-anadir-color": 1 } : {}),
  ...(conCifra ? { "cantidad-porcentaje": 1 } : {}),
}, "colores, catálogo y cantidad frente a %: una vez en todo el editor");

// «Tu elección»: el «≈ contado en la foto» solo en las ideas contadas en la foto.
const visibles = bibliotecaVisible();
const contada = renderToStaticMarkup(createElement(TarjetaEleccion, { decoracion: visibles.find((item) => item.id === "deco-real-23-sombrero-bruja-halloween")! }));
assert.equal(cuenta(contada)["contadas-foto"], 1, "la idea contada en la foto explica el «aproximado»");
const calculada = renderToStaticMarkup(createElement(TarjetaEleccion, { decoracion: visibles.find((item) => item.id === "deco-real-08-images-23")! }));
assert.equal(cuenta(calculada)["contadas-foto"], undefined, "una idea calculada no lleva ese «?»");
assert.ok((cuenta(calculada)["barra-tamanos"] ?? 0) <= 1);

console.log("test-ayudas-guiada: catálogo, usos, posición, HTML accesible y una ayuda por pantalla — todo bien.\n");
for (const ayuda of lista) console.log(`  ${ayuda.id.padEnd(22)} ${String(ayuda.texto.length).padStart(3)} c · ${(usos.get(ayuda.clave) ?? []).map((ruta) => path.basename(ruta)).filter((ruta, indice, todas) => todas.indexOf(ruta) === indice).join(", ")}\n    «${ayuda.texto}»`);
