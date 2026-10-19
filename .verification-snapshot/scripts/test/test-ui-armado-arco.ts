/**
 * UI del arco armado con el motor del diseñador (ADR-0034). Render estático
 * (`renderToStaticMarkup`) y módulos sin React, como las pruebas de UI del
 * patrón, del bouquet y de la guirnalda: comprueba qué datos del motor llegan
 * al decorador, no la animación. Sin red ni proveedores.
 *
 * La salida de Python es real: `scripts/fixtures/arco-ui/vista-arco.json` es la
 * respuesta de /api/plan-armado-arco para el arco `EST_02_ARCO` de
 * `scripts/fixtures/patron-color-ui/plan-con-patrones.json` —el arco colocado
 * globo a globo, el SVG que emitió el motor, sus herramientas y sus rangos—.
 * Así la frontera del cliente se valida contra lo que el motor devuelve de
 * verdad y no contra un objeto escrito a mano que se desincroniza en silencio.
 *
 * Lo que esta prueba vigila es la regla de ADR-0034: **el cliente no
 * recalcula**. Las medidas, el conteo, la compra y los avisos que aparecen en
 * la pantalla son los de la respuesta, carácter por carácter, y el dibujo es
 * el SVG del motor sin tocar.
 *
 * Run: npx tsx scripts/test/test-ui-armado-arco.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { claveVistaArco, PanelArco, panelVistaArco, peticionVistaArco, type PanelVistaArco, type PiezaVistaArco } from "@/components/plan/arco";
import { leyendaPatron } from "@/components/plan/patron/leyenda";
import { ArmadoArcoV1Schema, type ArmadoArcoV1 } from "@/lib/plan/armado-arco";
import { FalloPlanArmado } from "@/lib/plan/peticion-armado";
import { pedirVistaArmadoArco, RESPALDO_VISTA_ARMADO_ARCO, type VistaArmadoArco } from "@/lib/plan/peticion-armado-arco";
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

const FIXTURE = leerJson("scripts/fixtures/arco-ui/vista-arco.json") as {
  peticion: { estructura_id: string; armado_arco: ArmadoArcoV1; colores: string[] };
  respuesta: Record<string, unknown>;
};
const RESUELTO = leerJson("scripts/fixtures/patron-color-ui/plan-con-patrones.json") as PlanResuelto;

const ESTRUCTURA_ID = FIXTURE.peticion.estructura_id;
const ARMADO = ArmadoArcoV1Schema.parse(FIXTURE.peticion.armado_arco);
const PIEZA: PiezaVistaArco = { plan: RESUELTO.plan, estructuraId: ESTRUCTURA_ID, colores: FIXTURE.peticion.colores };
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

async function vistaDeLaFixture(): Promise<VistaArmadoArco> {
  const { fetch: fetcher } = fetcherDe(() => ({ status: 200, cuerpo: FIXTURE.respuesta }));
  return pedirVistaArmadoArco(peticionVistaArco(PIEZA, ARMADO), { fetcher });
}

function pintar(estado: PanelVistaArco, repeticiones = 1): string {
  return renderToStaticMarkup(
    React.createElement(PanelArco, { estado, leyenda: LEYENDA, nombrePieza: "Arco de la entrada", repeticiones, onReintentar: () => {} }),
  );
}

async function main(): Promise<void> {
  await caso("petición: solo el contrato de la ruta, con los tonos de la pieza y el armado tal cual", async () => {
    const { fetch: fetcher, cuerpos } = fetcherDe(() => ({ status: 200, cuerpo: FIXTURE.respuesta }));
    await pedirVistaArmadoArco(peticionVistaArco(PIEZA, ARMADO), { fetcher });
    assert.equal(cuerpos.length, 1);
    assert.deepEqual(Object.keys(cuerpos[0] as object).sort(), ["armado_arco", "colores", "estructura_id", "plan"]);
    const cuerpo = cuerpos[0] as { estructura_id: string; armado_arco: unknown; colores: string[] };
    assert.equal(cuerpo.estructura_id, ESTRUCTURA_ID);
    assert.deepEqual(cuerpo.armado_arco, ARMADO, "el armado viaja sin tocar: sus mandos son del motor");
    assert.deepEqual(cuerpo.colores, FIXTURE.peticion.colores);
    // Sin tonos resueltos no se inventa ninguno: el motor dibuja en su gris y lo avisa.
    const { fetch: otro, cuerpos: sinTonos } = fetcherDe(() => ({ status: 200, cuerpo: FIXTURE.respuesta }));
    await pedirVistaArmadoArco(peticionVistaArco({ plan: RESUELTO.plan, estructuraId: ESTRUCTURA_ID }, ARMADO), { fetcher: otro });
    assert.ok(!("colores" in (sinTonos[0] as object)));
  });

  await caso("respuesta: la del motor pasa validada; una fuera del contrato no se dibuja", async () => {
    const vista = await vistaDeLaFixture();
    assert.equal(vista.arco.version, "armado-arco.v1");
    assert.ok(vista.arco.globos.length > 0, "el motor coloca cada globo");
    assert.ok(vista.grafica.svg.includes("<g"), "el dibujo viene del motor, no de aquí");
    assert.deepEqual(vista.armado, ARMADO, "el eco del armado es el que se pidió");
    assert.equal(vista.opciones.patrones.length, 14, "las catorce herramientas del diseñador");
    assert.ok(vista.limites.anchoMin > 0 && vista.limites.nPaso > 0);
    for (const roto of [
      { ...FIXTURE.respuesta, arco: { ...(FIXTURE.respuesta.arco as object), globos: "muchos" } },
      { ...FIXTURE.respuesta, grafica: { lienzo: 600 } },
      { ...FIXTURE.respuesta, opciones: {} },
      { ...FIXTURE.respuesta, limites: { anchoMin: 1 } },
    ]) {
      const { fetch: fetcher } = fetcherDe(() => ({ status: 200, cuerpo: roto }));
      await assert.rejects(
        () => pedirVistaArmadoArco(peticionVistaArco(PIEZA, ARMADO), { fetcher }),
        (error: unknown) => error instanceof FalloPlanArmado && error.message === RESPALDO_VISTA_ARMADO_ARCO,
      );
    }
  });

  await caso("rechazo del motor: llega con la frase de Python y no se reintenta", async () => {
    const { fetch: fetcher } = fetcherDe(() => ({
      status: 422,
      cuerpo: { error: "armado_invalido", motivo: "ancho_insuficiente", mensaje: "El ancho no da para cuatro globos de 12″ a lo ancho." },
    }));
    await assert.rejects(
      () => pedirVistaArmadoArco(peticionVistaArco(PIEZA, ARMADO), { fetcher }),
      (error: unknown) =>
        error instanceof FalloPlanArmado
        && error.armadoInvalido
        && error.motivo === "ancho_insuficiente"
        && error.message === "El ancho no da para cuatro globos de 12″ a lo ancho.",
    );
  });

  await caso("clave: la pieza, su armado y sus tonos; el resto del plan no mueve el dibujo", () => {
    const clave = claveVistaArco(PIEZA, ARMADO);
    assert.equal(clave, claveVistaArco({ ...PIEZA, plan: { ...RESUELTO.plan, supuestos: ["otro supuesto"] } }, ARMADO));
    assert.notEqual(clave, claveVistaArco({ ...PIEZA, estructuraId: "EST_09_OTRO" }, ARMADO));
    assert.notEqual(clave, claveVistaArco({ ...PIEZA, colores: ["#000000", "#1f4fbf", "#c9a227"] }, ARMADO));
    assert.notEqual(clave, claveVistaArco(PIEZA, { ...ARMADO, patron: "solido" }));
    // El eco de Python puede traer las claves en otro orden: el mismo armado es la misma clave.
    const alRevés = Object.fromEntries(Object.entries(ARMADO).reverse()) as ArmadoArcoV1;
    assert.equal(clave, claveVistaArco(PIEZA, alRevés));
  });

  await caso("fases: cargando, vacío, error, y el dibujo anterior mientras llega el nuevo", async () => {
    const vista = await vistaDeLaFixture();
    const clave = claveVistaArco(PIEZA, ARMADO);
    assert.deepEqual(panelVistaArco(clave, null, null), { fase: "cargando" });
    assert.deepEqual(panelVistaArco(clave, null, { clave, mensaje: "No se arma.", armadoInvalido: true }), { fase: "vacio", mensaje: "No se arma." });
    assert.deepEqual(panelVistaArco(clave, null, { clave, mensaje: "Sin conexión.", armadoInvalido: false }), { fase: "error", mensaje: "Sin conexión." });
    assert.deepEqual(panelVistaArco(clave, { clave, vista }, null), { fase: "listo", vista, actualizando: false, fallo: null });
    // Otro armado en camino: se conserva el dibujo que hay y se dice que está actualizándose.
    assert.deepEqual(panelVistaArco("otra", { clave, vista }, null), { fase: "listo", vista, actualizando: true, fallo: null });
    // Falló el nuevo: el dibujo que se ve es el último que llegó, y se dice.
    assert.deepEqual(panelVistaArco("otra", { clave, vista }, { clave: "otra", mensaje: "Sin conexión.", armadoInvalido: false }), { fase: "listo", vista, actualizando: false, fallo: "Sin conexión." });
    // Un fallo de otro dibujo no ensucia el que se pide.
    assert.deepEqual(panelVistaArco(clave, null, { clave: "otra", mensaje: "Sin conexión.", armadoInvalido: false }), { fase: "cargando" });
  });

  await caso("el arco dibujado: el SVG del motor y sus cifras, sin recalcular ninguna", async () => {
    const vista = await vistaDeLaFixture();
    const { arco, grafica } = vista;
    const html = pintar({ fase: "listo", vista, actualizando: false, fallo: null }, 2);
    assert.ok(html.includes('aria-label="Armado del arco"'));
    // El dibujo es el del motor, carácter por carácter: si la pantalla lo volviera a pintar, esto cambiaría.
    assert.ok(html.includes(grafica.svg), "el SVG del motor entra tal cual");
    assert.ok(html.includes(`viewBox="0 0 ${grafica.lienzo} ${grafica.lienzo}"`));
    assert.ok(html.includes('role="img"') && html.includes("Arco de la entrada: arco de"), "texto alternativo descriptivo");
    // Las medidas reales del arco armado, no las declaradas en el plan.
    const metros = (valor: number) => new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 }).format(valor);
    for (const medida of [arco.ancho_m, arco.alto_m, arco.grosor_m, arco.largo_m]) {
      assert.ok(html.includes(`${metros(medida)} m`), `falta la medida ${medida}`);
    }
    assert.ok(html.includes(new Intl.NumberFormat("es-CO", { maximumFractionDigits: 1 }).format(arco.globos_por_metro)), "globos por metro");
    // El conteo y la compra del motor, cifra por cifra, y su total.
    for (const linea of arco.compra) {
      assert.ok(html.includes(`>${linea.cantidad}<`), `falta el conteo de ${linea.material}`);
      assert.ok(html.includes(`>${linea.comprar}<`), `falta la compra de ${linea.material}`);
    }
    assert.ok(html.includes(`>${arco.total_comprar}<`), "falta el total a comprar");
    assert.ok(html.includes("2 iguales"), "las cifras son de un solo arco");
    // El nombre y la frase del patrón los escribe el motor.
    const patron = vista.opciones.patrones.find((descrito) => descrito.id === vista.armado.patron)!;
    assert.ok(html.includes(patron.nombre) && html.includes(patron.descripcion));
  });

  await caso("los avisos del motor se leen, no se tiran", async () => {
    const vista = await vistaDeLaFixture();
    const avisos = ["El alto se ajustó a 2,4 m para que la banda quepa.", "La espiral se inclinó para cerrar el giro."];
    const conAvisos: VistaArmadoArco = { ...vista, arco: { ...vista.arco, avisos } };
    const html = pintar({ fase: "listo", vista: conAvisos, actualizando: false, fallo: null });
    assert.ok(html.includes('aria-label="Avisos del armado"'));
    for (const aviso of avisos) assert.ok(html.includes(aviso), `falta el aviso: ${aviso}`);
  });

  await caso("estados sin dibujo: cargando con role status, vacío con la frase y error con Reintentar", () => {
    const cargando = pintar({ fase: "cargando" });
    assert.ok(cargando.includes('role="status"') && cargando.includes('data-fase="cargando"'));
    assert.ok(!cargando.includes("<button"), "cargando no ofrece nada que tocar");
    const vacio = pintar({ fase: "vacio", mensaje: "El arco no se puede armar con estos globos." });
    assert.ok(vacio.includes("El arco no se puede armar con estos globos."));
    assert.ok(!vacio.includes("Reintentar"), "un rechazo del motor no se reintenta");
    const error = pintar({ fase: "error", mensaje: "No pude dibujar el arco." });
    assert.ok(error.includes('role="alert"'));
    assert.ok(error.includes('type="button"') && error.includes("Reintentar"), "control semántico y enfocable");
  });

  console.log(`\n${casos} casos en verde`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
