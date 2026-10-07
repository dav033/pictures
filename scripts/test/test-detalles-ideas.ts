import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { bibliotecaVisible } from "@/lib/biblioteca-sempertex/biblioteca";
import { detalleDeIdea, type DetalleIdea } from "@/lib/biblioteca-sempertex/detalle-idea";
import type { DecoracionSempertex } from "@/lib/biblioteca-sempertex/esquemas";
import { TarjetaEleccion } from "@/components/guiado/TarjetaEleccion";
import { lineasSinPiezaDeIdea, piezasVistaDeIdea, resumenIdea } from "@/components/guiado/idea-vista";
import { productoSempertex, tablaGlobos } from "@/components/guiado/piezas-vista";
import { construirDetalleIdea, escribirDetallesIdeas, leerMaterial, leerPlanDe, type PlanArchivo } from "../biblioteca/detalles-ideas";

/**
 * El detalle de las ideas de la biblioteca (pedido 2: «Tu elección» con el detalle de «Tu plan» y globos SEMPERTEX,
 * no genéricos). Sin red, sin Python y sin modelo: lee `decoraciones.json`, los `.plan.json` guardados y
 * `detalles-ideas.json`. Sin coste.
 *
 *   npx tsx scripts/test/test-detalles-ideas.ts
 */

const cola: Array<[string, () => void | Promise<void>]> = [];
function prueba(nombre: string, cuerpo: () => void | Promise<void>): void {
  cola.push([nombre, cuerpo]);
}

const visibles = bibliotecaVisible();
const detalle = (id: string): DetalleIdea => {
  const encontrado = detalleDeIdea(id);
  assert.ok(encontrado, `${id}: sin detalle en detalles-ideas.json`);
  return encontrado;
};
const lineasDe = (d: DetalleIdea) => [...d.piezas.flatMap((pieza) => pieza.lineas), ...(d.lineasSinPieza ?? [])];

prueba("cobertura: toda idea visible tiene detalle válido, con al menos una pieza", () => {
  assert.ok(visibles.length >= 31, `la biblioteca tiene ${visibles.length} ideas visibles`);
  for (const decoracion of visibles) {
    const d = detalle(decoracion.id);
    assert.ok(d.piezas.length >= 1);
    assert.equal(d.piezas.reduce((suma, pieza) => suma + pieza.repeticiones, 0), decoracion.piezas.reduce((suma, pieza) => suma + pieza.cantidad, 0), `${decoracion.id}: mismas piezas que la decoración`);
  }
});

prueba("totales = materiales: el total, la suma de piezas y cada variante cuadran con decoraciones.json", () => {
  for (const decoracion of visibles) {
    const d = detalle(decoracion.id);
    const materiales = decoracion.materiales.reduce((suma, material) => suma + material.cantidad, 0);
    assert.equal(d.total, materiales, `${decoracion.id}: total`);
    const lineas = lineasDe(d);
    assert.equal(lineas.reduce((suma, linea) => suma + linea.unidades, 0), materiales, `${decoracion.id}: suma de líneas`);
    for (const pieza of d.piezas) assert.equal(pieza.total, pieza.lineas.reduce((suma, linea) => suma + linea.unidades, 0), `${decoracion.id}/${pieza.id}: total de la pieza`);
    for (const material of decoracion.materiales) {
      const enDetalle = lineas.filter((linea) => linea.variantId === material.variantId).reduce((suma, linea) => suma + linea.unidades, 0);
      assert.equal(enDetalle, material.cantidad, `${decoracion.id}: variante ${material.variantId}`);
    }
  }
});

prueba("globos Sempertex, no genéricos: cada línea nombra el producto del catálogo de su material", () => {
  for (const decoracion of visibles) {
    const porVariante = new Map(decoracion.materiales.map((material) => [material.variantId, material]));
    for (const linea of lineasDe(detalle(decoracion.id))) {
      const material = porVariante.get(linea.variantId)!;
      assert.equal(linea.producto, leerMaterial(material).producto, `${decoracion.id}: producto de ${linea.variantId}`);
      assert.doesNotMatch(linea.producto, /\bB2b\b|PAQUETE|R-\d/i, `${decoracion.id}: «${linea.producto}» sin jerga`);
    }
  }
  assert.equal(productoSempertex("B2b Globo Latex Redondo Fashion Negro — R-12 / PAQUETE X 50"), "Fashion Negro");
  assert.equal(productoSempertex("B2b Globo Latex Redondo Reflex Dorado — R-12 / PAQUETE X 50"), "Reflex Dorado");
  assert.equal(productoSempertex("B2b Globo Latex Redondo Fashion Palo De Rosa — R-12 / PAQUETE X 50"), "Fashion Palo de Rosa");
  assert.equal(productoSempertex("B2b Globo Latex Link-O-Loon® Pastel Dusk Té Verde — LOL 6 / PAQUETE X 50"), "Link-O-Loon® Pastel Dusk Té Verde");
  assert.equal(productoSempertex("Globo de látex 12\" Palo de rosa"), null, "un nombre sin título del catálogo no inventa producto");
  assert.equal(productoSempertex(null), null);
});

prueba("las del script (plan de Python) separan por pieza con las cantidades exactas de Python", async () => {
  const delScript = visibles.filter((decoracion) => /^deco-real-(0\d|1\d|20)-/.test(decoracion.id));
  assert.equal(delScript.length, 20);
  for (const decoracion of delScript) {
    const d = detalle(decoracion.id);
    const leido: { plan: PlanArchivo | null } = await leerPlanDe(decoracion);
    const plan = leido.plan;
    assert.ok(plan, `${decoracion.id}: tiene plan resuelto`);
    if (d.lineasSinPieza?.length) continue; // el plan dejó de cuadrar con la biblioteca (lo avisa el script): sin repartir.
    // Desde la auditoría de fotos (2026-10-06) algunas suman accesorios contados en la foto (cortinas, foil, impresos):
    // entonces la idea es «estimado», pero lo de Python sigue en cada pieza con sus cantidades exactas.
    const conFoto = decoracion.materiales.some((material) => material.origenCantidad !== undefined && material.origenCantidad !== "plan_python");
    assert.equal(d.fuente, conFoto ? "estimado" : "plan", `${decoracion.id}: cantidades de Python${conFoto ? " y de la foto" : ""}`);
    assert.equal(d.planHash, plan.plan_resuelto.plan_hash);
    const resueltas: PlanArchivo["plan_resuelto"]["estructuras"] = plan.plan_resuelto.estructuras;
    for (const pieza of d.piezas) {
      const resuelta = resueltas.find((estructura) => estructura.estructura_id === pieza.id);
      if (!resuelta) continue; // pieza partida de una repetición: la cubre la prueba de repeticiones
      const dePython = resuelta.lineas.reduce((suma: number, linea) => suma + Math.max(0, linea.unidades), 0);
      const porVariante = new Map<string, number>();
      for (const linea of resuelta.lineas) porVariante.set(linea.variant_id, (porVariante.get(linea.variant_id) ?? 0) + Math.max(0, linea.unidades));
      const deFoto = pieza.lineas.reduce((suma, linea) => suma + Math.max(0, linea.unidades - (porVariante.get(linea.variantId) ?? 0)), 0);
      assert.equal(pieza.total - deFoto, dePython, `${decoracion.id}/${pieza.id}: total de Python`);
    }
  }
});

prueba("«Columnas negras y doradas»: dos piezas individuales, Columna izquierda y Columna derecha, con productos Sempertex", () => {
  const d = detalle("deco-real-08-images-23");
  assert.deepEqual(d.piezas.map((pieza) => pieza.nombre), ["Columna izquierda", "Columna derecha"]);
  assert.ok(d.piezas.every((pieza) => pieza.repeticiones === 1 && pieza.estructura === "columna"));
  const vista = piezasVistaDeIdea(d);
  const filas = vista.flatMap((pieza) => tablaGlobos(pieza.lineas).filas);
  assert.ok(filas.every((fila) => fila.producto), "toda fila nombra su producto Sempertex");
  assert.ok(filas.some((fila) => /Negro/.test(fila.etiqueta)) && filas.some((fila) => /Dorado/.test(fila.etiqueta)));
});

prueba("repeticiones: se parten en piezas individuales solo si Python da cantidades divisibles; si no, pareja «(iguales)»", () => {
  const decoracion = { ...visibles.find((item) => item.id === "deco-real-08-images-23")!, piezas: [{ estructura: "columna" as const, cantidad: 2 }] } satisfies DecoracionSempertex;
  const [negro, dorado] = decoracion.materiales;
  assert.ok(negro && dorado);
  const plan = (unidades: [number, number]): PlanArchivo => ({
    estado: "resuelto",
    plan_resuelto: {
      plan_hash: "a".repeat(64),
      plan: { estructuras: [{ estructura_id: "EST_01_COLUMNA", estructura_oficial: "columna", repeticiones: 2, ubicacion: "entrada", medidas: { ancho_m: 0.55, alto_m: 2 } }] },
      estructuras: [{ estructura_id: "EST_01_COLUMNA", lineas: [{ variant_id: negro.variantId, unidades: unidades[0], color: "negro" }, { variant_id: dorado.variantId, unidades: unidades[1], color: "dorado" }] }],
    },
  });
  const par = construirDetalleIdea({ ...decoracion, materiales: [{ ...negro, cantidad: 42 }, { ...dorado, cantidad: 44 }] }, plan([42, 44])).detalle!;
  assert.deepEqual(par.piezas.map((pieza) => [pieza.nombre, pieza.repeticiones, pieza.total]), [["Columna izquierda", 1, 43], ["Columna derecha", 1, 43]]);
  assert.deepEqual(par.piezas[0]!.lineas.map((linea) => linea.unidades), [21, 22], "la mitad exacta de lo de Python");
  const impar = construirDetalleIdea({ ...decoracion, materiales: [{ ...negro, cantidad: 43 }, { ...dorado, cantidad: 44 }] }, plan([43, 44])).detalle!;
  assert.deepEqual(impar.piezas.map((pieza) => [pieza.nombre, pieza.repeticiones, pieza.total]), [["Columna (iguales)", 2, 87]], "43 no se parte: pareja con el total de Python");
});

prueba("un plan que ya no cuadra con la biblioteca no reparte: la idea se muestra entera y lo avisa", () => {
  const decoracion = visibles.find((item) => item.id === "deco-real-08-images-23")!;
  const [negro, dorado] = decoracion.materiales;
  const plan: PlanArchivo = {
    estado: "resuelto",
    plan_resuelto: {
      plan: { estructuras: [{ estructura_id: "EST_01_COLUMNA", estructura_oficial: "columna", repeticiones: 1, ubicacion: "lateral_izquierdo", medidas: {} }, { estructura_id: "EST_02_COLUMNA", estructura_oficial: "columna", repeticiones: 1, ubicacion: "lateral_derecho", medidas: {} }] },
      estructuras: [
        { estructura_id: "EST_01_COLUMNA", lineas: [{ variant_id: negro!.variantId, unidades: 1, color: "negro" }] },
        { estructura_id: "EST_02_COLUMNA", lineas: [{ variant_id: dorado!.variantId, unidades: 1, color: "dorado" }] },
      ],
    },
  };
  const { detalle: d, avisos } = construirDetalleIdea(decoracion, plan);
  assert.ok(d && avisos.some((aviso) => /no cuadra/.test(aviso)));
  assert.ok(d.piezas.every((pieza) => pieza.lineas.length === 0));
  assert.equal(d.lineasSinPieza?.reduce((suma, linea) => suma + linea.unidades, 0), d.total);
  assert.equal(lineasSinPiezaDeIdea(d).length, d.lineasSinPieza?.length);
});

prueba("las nuevas (21-31) dicen que hay cantidades estimadas a partir de la foto; las del script, no", () => {
  for (const decoracion of visibles) {
    const d = detalle(decoracion.id);
    const contadas = decoracion.materiales.some((material) => material.origenCantidad === "estimado_foto" || material.origenCantidad === "plan_python_y_foto");
    assert.equal(d.fuente === "estimado", contadas, `${decoracion.id}: fuente ${d.fuente}`);
    assert.equal(resumenIdea(d).estimados.length > 0, contadas);
  }
});

prueba("--check: detalles-ideas.json está al día con decoraciones.json", async () => {
  const { desfasado, ideas } = await escribirDetallesIdeas({ comprobar: true });
  assert.equal(desfasado, false, "regenera con: npx tsx scripts/biblioteca/precomputar-detalles-ideas.ts");
  assert.equal(ideas, visibles.length);
});

prueba("la tarjeta «Tu elección» muestra piezas, medidas y productos Sempertex (no «globos negros de 12\"»)", () => {
  const decoracion = visibles.find((item) => item.id === "deco-real-08-images-23")!;
  const texto = renderToStaticMarkup(createElement(TarjetaEleccion, { decoracion })).replace(/<[^>]+>/g, " ").replace(/&quot;/g, "\"").replace(/\s+/g, " ");
  for (const esperado of ["Tu elección", "globos Sempertex", "Columna izquierda", "Columna derecha", "Fashion Negro", "Metal Dorado", "Ver detalle", "0,55 m"]) assert.ok(texto.includes(esperado), `falta «${esperado}» en: ${texto.slice(0, 400)}`);
  for (const generico of ["globos negros", "globos dorados", "R-12", "PAQUETE", "B2b"]) assert.equal(texto.includes(generico), false, `no debe decir «${generico}»`);
  const sombrero = renderToStaticMarkup(createElement(TarjetaEleccion, { decoracion: visibles.find((item) => item.id === "deco-real-23-sombrero-bruja-halloween")! }));
  assert.ok(sombrero.includes("Cantidades estimadas a partir de la foto"), "una idea contada en la foto lo dice con discreción");
});

void (async () => {
  for (const [nombre, cuerpo] of cola) {
    await cuerpo();
    console.log(`ok - ${nombre}`);
  }
  console.log(`\n${cola.length} pruebas, todas bien.`);
})().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
