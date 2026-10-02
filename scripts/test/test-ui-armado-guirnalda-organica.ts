/**
 * UI de la guirnalda armada con el motor del diseñador (ADR-0034). Render estático
 * (`renderToStaticMarkup`) y módulos sin React, como las pruebas de UI del arco, del
 * patrón, del bouquet y de la guirnalda por partes: comprueba qué datos del motor llegan
 * al decorador, no la animación. Sin red ni proveedores.
 *
 * La salida de Python es real: `scripts/fixtures/guirnalda-organica-ui/vista-guirnalda-organica.json`
 * es la respuesta de /api/plan-armado-guirnalda-organica para la guirnalda `EST_04_GUIRNALDA` de
 * `scripts/fixtures/patron-color-ui/plan-con-patrones.json` —la guirnalda colocada globo a
 * globo, el SVG que emitió el motor, sus herramientas y sus rangos—. Así la frontera del
 * cliente se valida contra lo que el motor devuelve de verdad y no contra un objeto escrito a
 * mano que se desincroniza en silencio.
 *
 * Lo que esta prueba vigila es la regla de ADR-0034: **el cliente no recalcula**. Las
 * medidas, el conteo, la compra, los adornos y los avisos que aparecen en la pantalla son los
 * de la respuesta, carácter por carácter, y el dibujo es el SVG del motor sin tocar. Y que la
 * tarjeta monte este bloque —y no el del patrón ni el de ADR-0032— cuando la pieza trae
 * `armado_guirnalda_organica`, sin cambiar nada cuando no lo trae.
 *
 * Run: npx tsx scripts/test/test-ui-armado-guirnalda-organica.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TarjetaPlanDecoracion } from "@/components/TarjetaPlanDecoracion";
import {
  claveVistaGuirnaldaOrganica,
  PanelGuirnaldaOrganica,
  panelVistaGuirnaldaOrganica,
  peticionVistaGuirnaldaOrganica,
  type PanelVistaGuirnaldaOrganica,
  type PiezaVistaGuirnaldaOrganica,
} from "@/components/plan/guirnalda-organica";
import { leyendaPatron } from "@/components/plan/patron/leyenda";
import { ArmadoGuirnaldaOrganicaV1Schema, type ArmadoGuirnaldaOrganicaV1 } from "@/lib/plan/armado-guirnalda-organica";
import { FalloPlanArmado } from "@/lib/plan/peticion-armado";
import {
  pedirVistaArmadoGuirnaldaOrganica,
  RESPALDO_VISTA_ARMADO_GUIRNALDA_ORGANICA,
  type VistaArmadoGuirnaldaOrganica,
} from "@/lib/plan/peticion-armado-guirnalda-organica";
import type { PlanResuelto } from "@/lib/plan/resuelto";

let casos = 0;
function caso(nombre: string, prueba: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(prueba)
    .then(() => {
      casos += 1;
      console.log(`[PASS] ${nombre}`);
    })
    .catch((error: unknown) => {
      console.error(`[FAIL] ${nombre}`);
      throw error;
    });
}

const leerJson = (ruta: string): unknown => JSON.parse(readFileSync(resolve(process.cwd(), ruta), "utf8")) as unknown;

const FIXTURE = leerJson("scripts/fixtures/guirnalda-organica-ui/vista-guirnalda-organica.json") as {
  peticion: { estructura_id: string; armado_guirnalda_organica: ArmadoGuirnaldaOrganicaV1; colores: string[] };
  respuesta: Record<string, unknown>;
};
const RESUELTO = leerJson("scripts/fixtures/patron-color-ui/plan-con-patrones.json") as PlanResuelto;

const ESTRUCTURA_ID = FIXTURE.peticion.estructura_id;
const ARMADO = ArmadoGuirnaldaOrganicaV1Schema.parse(FIXTURE.peticion.armado_guirnalda_organica);
const PIEZA: PiezaVistaGuirnaldaOrganica = { plan: RESUELTO.plan, estructuraId: ESTRUCTURA_ID, colores: FIXTURE.peticion.colores };
const DECLARADA = RESUELTO.plan.estructuras.find((estructura) => estructura.estructura_id === ESTRUCTURA_ID)!;
const RESUELTA = RESUELTO.estructuras.find((estructura) => estructura.estructura_id === ESTRUCTURA_ID)!;
const LEYENDA = leyendaPatron(
  DECLARADA.materiales,
  RESUELTA.lineas,
  RESUELTO.patrones_color?.find((patron) => patron.estructura_id === ESTRUCTURA_ID)?.conteo,
);

/** Un `fetch` que contesta una sola vez lo que se le dé, y anota el cuerpo con el que se le llamó. */
function fetcherDe(responder: () => { status: number; cuerpo: unknown }): { fetch: typeof fetch; cuerpos: unknown[] } {
  const cuerpos: unknown[] = [];
  const fetcher = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    cuerpos.push(JSON.parse(String(init?.body)) as unknown);
    const { status, cuerpo } = responder();
    return new Response(JSON.stringify(cuerpo), { status, headers: { "Content-Type": "application/json" } });
  };
  return { fetch: fetcher as unknown as typeof fetch, cuerpos };
}

async function vistaDeLaFixture(): Promise<VistaArmadoGuirnaldaOrganica> {
  const { fetch: fetcher } = fetcherDe(() => ({ status: 200, cuerpo: FIXTURE.respuesta }));
  return pedirVistaArmadoGuirnaldaOrganica(peticionVistaGuirnaldaOrganica(PIEZA, ARMADO), { fetcher });
}

function pintar(estado: PanelVistaGuirnaldaOrganica, repeticiones = 1): string {
  return renderToStaticMarkup(
    React.createElement(PanelGuirnaldaOrganica, { estado, leyenda: LEYENDA, nombrePieza: "Guirnalda de la entrada", repeticiones, onReintentar: () => {} }),
  );
}

const entero = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 });

async function main(): Promise<void> {
  await caso("petición: solo el contrato de la ruta, con los tonos de la pieza y el armado tal cual", async () => {
    const { fetch: fetcher, cuerpos } = fetcherDe(() => ({ status: 200, cuerpo: FIXTURE.respuesta }));
    await pedirVistaArmadoGuirnaldaOrganica(peticionVistaGuirnaldaOrganica(PIEZA, ARMADO), { fetcher });
    assert.equal(cuerpos.length, 1);
    assert.deepEqual(Object.keys(cuerpos[0] as object).sort(), ["armado_guirnalda_organica", "colores", "estructura_id", "plan"]);
    const cuerpo = cuerpos[0] as { estructura_id: string; armado_guirnalda_organica: unknown; colores: string[] };
    assert.equal(cuerpo.estructura_id, ESTRUCTURA_ID);
    assert.deepEqual(cuerpo.armado_guirnalda_organica, ARMADO, "el armado viaja sin tocar: sus mandos son del motor");
    assert.deepEqual(cuerpo.colores, FIXTURE.peticion.colores);
    // Sin tonos resueltos no se inventa ninguno: el motor dibuja en su gris y lo avisa.
    const { fetch: otro, cuerpos: sinTonos } = fetcherDe(() => ({ status: 200, cuerpo: FIXTURE.respuesta }));
    await pedirVistaArmadoGuirnaldaOrganica(peticionVistaGuirnaldaOrganica({ plan: RESUELTO.plan, estructuraId: ESTRUCTURA_ID }, ARMADO), { fetcher: otro });
    assert.ok(!("colores" in (sinTonos[0] as object)));
  });

  await caso("respuesta: la del motor pasa validada; una fuera del contrato no se dibuja", async () => {
    const vista = await vistaDeLaFixture();
    assert.equal(vista.guirnalda.version, "armado-guirnalda-organica.v1");
    assert.ok(vista.guirnalda.globos.length > 0, "el motor coloca cada globo");
    assert.ok(vista.grafica.svg.includes("<g"), "el dibujo viene del motor, no de aquí");
    assert.ok(vista.grafica.ancho > vista.grafica.alto, "el lienzo de la guirnalda es apaisado");
    assert.deepEqual(vista.armado, ARMADO, "el eco del armado es el que se pidió");
    assert.equal(vista.opciones.acabados.length, 4);
    assert.equal(vista.opciones.repartos.length, 3);
    assert.ok(vista.limites.largoMin > 0 && vista.limites.festonesMax > 0);
    for (const roto of [
      { ...FIXTURE.respuesta, guirnalda: { ...(FIXTURE.respuesta.guirnalda as object), globos: "muchos" } },
      { ...FIXTURE.respuesta, grafica: { ancho: 760 } },
      { ...FIXTURE.respuesta, opciones: {} },
      { ...FIXTURE.respuesta, limites: { largoMin: 1 } },
    ]) {
      const { fetch: fetcher } = fetcherDe(() => ({ status: 200, cuerpo: roto }));
      await assert.rejects(
        () => pedirVistaArmadoGuirnaldaOrganica(peticionVistaGuirnaldaOrganica(PIEZA, ARMADO), { fetcher }),
        (error: unknown) => error instanceof FalloPlanArmado && error.message === RESPALDO_VISTA_ARMADO_GUIRNALDA_ORGANICA,
      );
    }
  });

  await caso("rechazo del motor: llega con la frase de Python y no se reintenta", async () => {
    const { fetch: fetcher } = fetcherDe(() => ({
      status: 422,
      cuerpo: { error: "armado_invalido", motivo: "material_fuera_de_rango", mensaje: "El armado nombra un color que la guirnalda no lleva." },
    }));
    await assert.rejects(
      () => pedirVistaArmadoGuirnaldaOrganica(peticionVistaGuirnaldaOrganica(PIEZA, ARMADO), { fetcher }),
      (error: unknown) =>
        error instanceof FalloPlanArmado
        && error.armadoInvalido
        && error.motivo === "material_fuera_de_rango"
        && error.message === "El armado nombra un color que la guirnalda no lleva.",
    );
  });

  await caso("clave: la pieza, su armado y sus tonos; el resto del plan no mueve el dibujo", () => {
    const clave = claveVistaGuirnaldaOrganica(PIEZA, ARMADO);
    assert.equal(clave, claveVistaGuirnaldaOrganica({ ...PIEZA, plan: { ...RESUELTO.plan, supuestos: ["otro supuesto"] } }, ARMADO));
    assert.notEqual(clave, claveVistaGuirnaldaOrganica({ ...PIEZA, estructuraId: "EST_09_OTRO" }, ARMADO));
    assert.notEqual(clave, claveVistaGuirnaldaOrganica({ ...PIEZA, colores: ["#000000", "#1f4fbf"] }, ARMADO));
    assert.notEqual(clave, claveVistaGuirnaldaOrganica(PIEZA, { ...ARMADO, forma: { ...ARMADO.forma, largoM: ARMADO.forma.largoM + 0.5 } }));
    // El eco de Python puede traer las claves en otro orden: el mismo armado es la misma clave.
    const alRevés = Object.fromEntries(Object.entries(ARMADO).reverse()) as ArmadoGuirnaldaOrganicaV1;
    assert.equal(clave, claveVistaGuirnaldaOrganica(PIEZA, alRevés));
  });

  await caso("fases: cargando, vacío, error, y el dibujo anterior mientras llega el nuevo", async () => {
    const vista = await vistaDeLaFixture();
    const clave = claveVistaGuirnaldaOrganica(PIEZA, ARMADO);
    assert.deepEqual(panelVistaGuirnaldaOrganica(clave, null, null), { fase: "cargando" });
    assert.deepEqual(panelVistaGuirnaldaOrganica(clave, null, { clave, mensaje: "No se arma.", armadoInvalido: true }), { fase: "vacio", mensaje: "No se arma." });
    assert.deepEqual(panelVistaGuirnaldaOrganica(clave, null, { clave, mensaje: "Sin conexión.", armadoInvalido: false }), { fase: "error", mensaje: "Sin conexión." });
    assert.deepEqual(panelVistaGuirnaldaOrganica(clave, { clave, vista }, null), { fase: "listo", vista, actualizando: false, fallo: null });
    assert.deepEqual(panelVistaGuirnaldaOrganica("otra", { clave, vista }, null), { fase: "listo", vista, actualizando: true, fallo: null });
    assert.deepEqual(panelVistaGuirnaldaOrganica("otra", { clave, vista }, { clave: "otra", mensaje: "Sin conexión.", armadoInvalido: false }), { fase: "listo", vista, actualizando: false, fallo: "Sin conexión." });
    assert.deepEqual(panelVistaGuirnaldaOrganica(clave, null, { clave: "otra", mensaje: "Sin conexión.", armadoInvalido: false }), { fase: "cargando" });
  });

  await caso("la guirnalda dibujada: el SVG del motor y sus cifras, sin recalcular ninguna", async () => {
    const vista = await vistaDeLaFixture();
    const { guirnalda, grafica } = vista;
    const html = pintar({ fase: "listo", vista, actualizando: false, fallo: null }, 2);
    assert.ok(html.includes('aria-label="Armado de la guirnalda"'));
    // El dibujo es el del motor, carácter por carácter: si la pantalla lo volviera a pintar, esto cambiaría.
    assert.ok(html.includes(grafica.svg), "el SVG del motor entra tal cual");
    assert.ok(html.includes(`viewBox="0 0 ${grafica.ancho} ${grafica.alto}"`), "el lienzo no es cuadrado");
    assert.ok(html.includes(`aspect-ratio:${grafica.ancho} / ${grafica.alto}`), "el marco toma la proporción del lienzo");
    assert.ok(html.includes('role="img"') && html.includes("Guirnalda de la entrada: guirnalda de"), "texto alternativo descriptivo");
    // Las medidas reales de la guirnalda armada, no las declaradas en el plan.
    const metros = (valor: number) => new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 }).format(valor);
    for (const medida of [guirnalda.largo_m, guirnalda.alto_m, guirnalda.grosor_extremos_m, guirnalda.grosor_centro_m]) {
      assert.ok(html.includes(`${metros(medida)} m`), `falta la medida ${medida}`);
    }
    assert.ok(html.includes(new Intl.NumberFormat("es-CO", { maximumFractionDigits: 1 }).format(guirnalda.globos_por_metro)), "globos por metro");
    // El conteo y la compra del motor, cifra por cifra, con lo que lleva de cada tamaño, y su total.
    for (const linea of guirnalda.compra) {
      assert.ok(html.includes(`>${entero.format(linea.cantidad)}<`), `falta el conteo de ${linea.material}`);
      assert.ok(html.includes(`>${entero.format(linea.comprar)}<`), `falta la compra de ${linea.material}`);
      for (const [pulgadas, cantidad] of Object.entries(linea.por_tamano)) assert.ok(html.includes(`${pulgadas}″: ${entero.format(cantidad as number)}`), `falta ${pulgadas}″ de ${linea.material}`);
    }
    assert.ok(html.includes(`>${entero.format(guirnalda.total_comprar)}<`), "falta el total a comprar");
    assert.ok(html.includes("2 iguales"), "las cifras son de una sola guirnalda");
    // Los adornos no son globos: se listan, no se compran.
    assert.ok(html.includes('data-testid="adornos-armado-guirnalda-organica"') && html.includes("no son globos y no están en esta compra"));
  });

  await caso("sin conteo de compra se muestra solo el conteo, sin inventar lo que hay que comprar", async () => {
    const vista = await vistaDeLaFixture();
    const sinCompra: VistaArmadoGuirnaldaOrganica = { ...vista, guirnalda: { ...vista.guirnalda, compra: [], total_comprar: 0 } };
    const html = pintar({ fase: "listo", vista: sinCompra, actualizando: false, fallo: null });
    assert.ok(html.includes('data-testid="materiales-armado-guirnalda-organica"'));
    assert.ok(html.includes(">—<"), "la compra que no llegó se dice con un guion");
    assert.ok(!html.includes("Total a comprar"));
  });

  await caso("los avisos del motor, los globos sueltos y los adornos se leen, no se tiran", async () => {
    const vista = await vistaDeLaFixture();
    const avisos = ["El grosor se ajustó a 0,9 m para que la tira quepa.", "Se quitó el tamaño de 36″: no cabe en la banda."];
    const conAvisos: VistaArmadoGuirnaldaOrganica = {
      ...vista,
      guirnalda: { ...vista.guirnalda, avisos, sueltos: 3, adornos: { ramas: 1, flores: 2 } },
    };
    const html = pintar({ fase: "listo", vista: conAvisos, actualizando: false, fallo: null });
    assert.ok(html.includes('aria-label="Avisos del armado"'));
    for (const aviso of avisos) assert.ok(html.includes(aviso), `falta el aviso: ${aviso}`);
    assert.ok(html.includes("3 globos quedan sin tocar a otro."));
    assert.ok(html.includes("1 rama de follaje y 2 flores"));
    const sinAdornos = pintar({ fase: "listo", vista: { ...vista, guirnalda: { ...vista.guirnalda, adornos: { ramas: 0, flores: 0 } } }, actualizando: false, fallo: null });
    assert.ok(!sinAdornos.includes("adornos-armado-guirnalda-organica"), "sin adornos no se dice nada");
  });

  await caso("estados sin dibujo: cargando con role status, vacío con la frase y error con Reintentar", () => {
    const cargando = pintar({ fase: "cargando" });
    assert.ok(cargando.includes('role="status"') && cargando.includes('data-fase="cargando"'));
    assert.ok(!cargando.includes("<button"), "cargando no ofrece nada que tocar");
    const vacio = pintar({ fase: "vacio", mensaje: "La guirnalda no se puede armar con estos tamaños." });
    assert.ok(vacio.includes("La guirnalda no se puede armar con estos tamaños."));
    assert.ok(!vacio.includes("Reintentar"), "un rechazo del motor no se reintenta");
    const error = pintar({ fase: "error", mensaje: "No pude dibujar la guirnalda." });
    assert.ok(error.includes('role="alert"'));
    assert.ok(error.includes('type="button"') && error.includes("Reintentar"), "control semántico y enfocable");
    assert.ok(/min-h-11/.test(error), "el botón de reintento mide 44 px");
  });

  await caso("la tarjeta monta este bloque cuando la pieza trae el armado, y no cambia cuando no lo trae", () => {
    const sin = renderToStaticMarkup(React.createElement(TarjetaPlanDecoracion, { plan: RESUELTO, onPlanActualizado: () => undefined, onAprobar: () => undefined }));
    assert.ok(!sin.includes("bloque-armado-guirnalda-organica"), "sin armado del motor no hay bloque");

    const conArmado = structuredClone(RESUELTO);
    const pieza: { armado_guirnalda_organica?: ArmadoGuirnaldaOrganicaV1 } = conArmado.plan.estructuras.find((estructura) => estructura.estructura_id === ESTRUCTURA_ID)!;
    pieza.armado_guirnalda_organica = ARMADO;
    const con = renderToStaticMarkup(React.createElement(TarjetaPlanDecoracion, { plan: conArmado, onPlanActualizado: () => undefined, onAprobar: () => undefined }));
    assert.equal((con.match(/data-testid="bloque-armado-guirnalda-organica"/g) ?? []).length, 1, "un bloque, el de la guirnalda");
    assert.ok(con.includes('data-fase="cargando"'), "en el servidor el dibujo aún se está pidiendo");
    // Con el motor mandando, el reparto y la mezcla no se ofrecen y se dice por qué.
    assert.ok(con.includes("los define su armado: el motor los coloca y los cuenta"), "la tarjeta explica por qué no hay reparto");
    // Y el resto de las piezas se pinta como antes: el arco sigue con su patrón.
    assert.equal(con.includes("bloque-armado-arco"), sin.includes("bloque-armado-arco"));
  });

  console.log(`\n${casos} casos en verde`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
