/**
 * «Editar <pieza>» para TODAS las estructuras (2026-10-04). El arco tenía su editor y otras piezas no: el arco
 * orgánico, el asimétrico y todo semiarco se dibujaban sin poder cambiarse (faltaba la edición
 * `armado_arco_organico`), y la pared, el aro, el techo y el centro de mesa solo ofrecían un selector de forma
 * suelto, sin densidad ni medidas, que son lo que su fórmula cuenta. Render estático y módulos puros, sin red.
 *
 * Lo que vigila:
 * - **cada pieza se nombra por lo que es**: «Editar semiarco», «Guardar aro», «Forma de la pared»; ninguna
 *   oficial cae al genérico «pieza» y un semiarco nunca dice «arco»;
 * - **el borrador de una pieza sin motor** solo ofrece lo que su fórmula lee (la pared, ancho × alto; el aro, su
 *   diámetro, que escribe ancho y alto a la vez; el techo, su largo; el centro de mesa, diámetro y alto) y las
 *   densidades que admite su oficial; guarda **solo lo que cambió**, en una edición;
 * - **la vista previa del editor es la del borrador**: el dibujo se pide con la forma elegida, sin tocar el plan;
 * - **la tarjeta** ofrece «Editar pared» con edición y no sin ella, y sin el selector suelto duplicado.
 *
 * Run: npx tsx scripts/test/test-ui-editor-pieza-sin-motor.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TarjetaPlanDecoracion } from "@/components/TarjetaPlanDecoracion";
import { BloqueDibujoEstructura } from "@/components/plan/dibujo/BloqueDibujoEstructura";
import { EditorPiezaSinMotor } from "@/components/plan/dibujo/EditorPiezaSinMotor";
import {
  borradorDe,
  camposMedidaDe,
  cambiosDe,
  conMedida,
  densidadesDe,
  formasDe,
  piezaConBorrador,
  valorMedida,
} from "@/components/plan/dibujo/borrador-pieza";
import { claveDibujoEstructura, peticionDibujoEstructura, type PiezaDibujoEstructura } from "@/components/plan/dibujo/vista-dibujo-estructura";
import { EditorArcoOrganico } from "@/components/plan/arco-organico/EditorArcoOrganico";
import { EdicionArmadoArcoOrganicoSchema, EdicionPropiedadesSchema } from "@/lib/plan/edicion-esquemas";
import { ESTRUCTURAS_OFICIALES_IDS } from "@/lib/plan/estructuras-oficiales";
import { nombreDePieza, textoArmado, textoEditar, textoGuardar } from "@/lib/plan/nombre-pieza";
import type { PlanResuelto } from "@/lib/plan/resuelto";
import { ArmadoArcoOrganicoV1Schema } from "@/lib/plan/armado-arco-organico";

let casos = 0;
async function caso(nombre: string, prueba: () => void | Promise<void>): Promise<void> {
  try {
    await prueba();
    casos += 1;
    console.log(`[PASS] ${nombre}`);
  } catch (error) {
    console.error(`[FAIL] ${nombre}`);
    throw error;
  }
}

const leer = <T,>(ruta: string): T => JSON.parse(readFileSync(resolve(process.cwd(), ruta), "utf8")) as T;
const texto = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");

const PLAN = leer<PlanResuelto>("scripts/fixtures/patron-color-ui/plan-con-patrones.json");
const PARED_ID = "EST_03_PARED";
const DECLARADA = PLAN.plan.estructuras.find((estructura) => estructura.estructura_id === PARED_ID)!;
const RESUELTA = PLAN.estructuras.find((estructura) => estructura.estructura_id === PARED_ID)!;

function pieza(oficial: string, tipo: string, extra: Record<string, unknown> = {}): PiezaDibujoEstructura {
  const declarada = { ...DECLARADA, tipo, estructura_oficial: oficial, ...extra } as unknown as PiezaDibujoEstructura["declarada"];
  const plan = { ...PLAN.plan, estructuras: PLAN.plan.estructuras.map((e) => (e.estructura_id === PARED_ID ? declarada : e)) } as PlanResuelto["plan"];
  return { plan, estructuraId: PARED_ID, declarada, mezclaReal: RESUELTA.mezcla_real };
}

async function main(): Promise<void> {
  await caso("cada oficial tiene su nombre real, y un semiarco nunca se llama arco", () => {
    for (const id of ESTRUCTURAS_OFICIALES_IDS) {
      assert.notEqual(nombreDePieza(id).sustantivo, "pieza", `${id} cae al genérico «pieza»`);
    }
    assert.equal(textoEditar(nombreDePieza("semiarco_asimetrico")), "Editar semiarco");
    assert.equal(textoArmado(nombreDePieza("semiarco")), "Armado del semiarco");
    assert.equal(textoArmado(nombreDePieza("columna_asimetrica")), "Armado de la columna");
    assert.equal(textoGuardar(nombreDePieza("aro_circular")), "Guardar aro");
    assert.equal(textoEditar(nombreDePieza("centro_mesa")), "Editar centro de mesa");
    assert.equal(textoEditar(nombreDePieza(undefined, "pared")), "Editar pared", "sin oficial, por el tipo");
  });

  await caso("el borrador ofrece solo lo que la fórmula de cada pieza lee", () => {
    assert.deepEqual(camposMedidaDe("pared_densa", "pared").map((c) => c.etiqueta), ["Ancho", "Alto"]);
    assert.deepEqual(camposMedidaDe("aro_circular", "arco").map((c) => [c.etiqueta, c.claves]), [["Diámetro", ["ancho_m", "alto_m"]]]);
    assert.deepEqual(camposMedidaDe("techo_globos", "guirnalda").map((c) => [c.etiqueta, c.claves]), [["Largo", ["largo_m"]]]);
    assert.deepEqual(camposMedidaDe("centro_mesa", "centro_mesa").map((c) => c.etiqueta), ["Diámetro", "Alto"]);
    assert.deepEqual(densidadesDe("pared_densa"), ["media", "lujosa"], "las de la oficial, no las tres");
    assert.deepEqual(densidadesDe("pared_no_densa"), ["sencilla"]);
    assert.deepEqual(densidadesDe("aro_circular"), ["sencilla", "media", "lujosa"]);
    assert.ok(formasDe("pared_densa").some((f) => f.id === "rombos"));
    assert.equal(formasDe("figura").length, 0);
  });

  await caso("guarda solo lo que cambió; el diámetro de un aro escribe ancho y alto; un techo sin largo lee el ancho", () => {
    const enPlan = borradorDe({ forma: undefined, densidad: "media", medidas: { ancho_m: 2, alto_m: 2.2 } });
    const pared = camposMedidaDe("pared_densa", "pared");
    assert.equal(cambiosDe(enPlan, enPlan, pared), null, "sin cambios no hay edición");
    const lujosa = { ...enPlan, densidad: "lujosa" as const };
    assert.deepEqual(cambiosDe(enPlan, lujosa, pared), { densidad: "lujosa" });
    const ancha = conMedida(enPlan, pared[0]!, 3);
    assert.deepEqual(cambiosDe(enPlan, ancha, pared), { medidas: { ancho_m: 3 } }, "el alto que no cambió no viaja");
    assert.deepEqual(cambiosDe(enPlan, { ...enPlan, forma: "rombos" }, pared), { forma: "rombos" });
    assert.deepEqual(cambiosDe({ ...enPlan, forma: "rombos" }, enPlan, pared), { forma: null }, "volver a «como la propone el plan» quita la forma");
    const aro = camposMedidaDe("aro_circular", "arco");
    assert.deepEqual(cambiosDe(enPlan, conMedida(enPlan, aro[0]!, 1.8), aro), { medidas: { ancho_m: 1.8, alto_m: 1.8 } });
    const techo = camposMedidaDe("techo_globos", "guirnalda");
    assert.equal(valorMedida({ ancho_m: 6 }, techo[0]!), 6);
    assert.equal(cambiosDe(enPlan, conMedida(enPlan, pared[0]!, 99), pared), null, "fuera de rango no se guarda");
    // Lo que se guarda pasa el contrato de la edición tal cual.
    assert.ok(EdicionPropiedadesSchema.safeParse({ accion: "propiedades", estructura_id: PARED_ID, densidad: "lujosa", medidas: { ancho_m: 3 } }).success);
    assert.ok(EdicionPropiedadesSchema.safeParse({ accion: "propiedades", estructura_id: PARED_ID, forma: null }).success);
    assert.ok(!EdicionPropiedadesSchema.safeParse({ accion: "propiedades", estructura_id: PARED_ID }).success, "una edición vacía no existe");
    assert.ok(!EdicionPropiedadesSchema.safeParse({ accion: "propiedades", estructura_id: PARED_ID, medidas: {} }).success);
  });

  await caso("la vista previa del editor es la del borrador: otra forma, otro dibujo, y el plan intacto", () => {
    const base = pieza("pared_densa", "pared");
    const enRombos = piezaConBorrador(base, "rombos");
    assert.notEqual(claveDibujoEstructura(enRombos), claveDibujoEstructura(base), "cambiar la forma vuelve a pedir el dibujo");
    const pedida = peticionDibujoEstructura(enRombos).plan.estructuras.find((e) => e.estructura_id === PARED_ID) as { forma?: string };
    assert.equal(pedida.forma, "rombos", "el dibujo se pide con la forma del borrador");
    assert.equal((base.plan.estructuras.find((e) => e.estructura_id === PARED_ID) as { forma?: string }).forma, undefined, "el plan a la vista no se toca");
    assert.equal(piezaConBorrador(base, null), base, "sin cambio de forma es la misma pieza");
    const sinForma = piezaConBorrador(pieza("pared_densa", "pared", { forma: "rombos" }), null);
    assert.equal(sinForma.declarada.forma, undefined);
  });

  const pintarEditor = (oficial: string, tipo: string, sobre: Partial<React.ComponentProps<typeof EditorPiezaSinMotor>> = {}) => {
    const declarada = { forma: undefined, densidad: "media", medidas: { ancho_m: 2, alto_m: 2.2 } };
    return renderToStaticMarkup(React.createElement(EditorPiezaSinMotor, {
      nombre: nombreDePieza(oficial, tipo),
      borrador: borradorDe(declarada),
      formas: formasDe(oficial),
      densidades: densidadesDe(oficial),
      campos: camposMedidaDe(oficial, tipo),
      hayCambios: false,
      guardando: false,
      errorGuardado: null,
      ocupado: false,
      onCambiar: () => {},
      onGuardar: () => {},
      onDescartar: () => {},
      onRestablecer: () => {},
      ...sobre,
    }));
  };

  await caso("el editor de cada pieza sin motor: su nombre, sus densidades, sus medidas y Guardar solo con cambios", () => {
    const pared = texto(pintarEditor("pared_densa", "pared"));
    assert.match(pared, /Editar pared/);
    assert.match(pared, /Guardar pared/);
    assert.match(pared, /¿Cómo se arma\?/);
    assert.match(pared, /Media .*Lujosa/);
    assert.doesNotMatch(pared, /Sencilla/, "una pared densa no ofrece la densidad sencilla");
    assert.match(pared, /Ancho .*Alto/);
    const botonGuardar = (html: string) => /<button[^>]*data-testid="guardar-pieza"[^>]*>/.exec(html)?.[0] ?? "";
    assert.match(botonGuardar(pintarEditor("pared_densa", "pared")), /disabled=""/, "sin cambios no se guarda");
    assert.doesNotMatch(botonGuardar(pintarEditor("pared_densa", "pared", { hayCambios: true })), /disabled=""/);
    assert.match(botonGuardar(pintarEditor("pared_densa", "pared", { hayCambios: true, ocupado: true })), /disabled=""/, "con otro cambio guardándose, espera");
    const aro = texto(pintarEditor("aro_circular", "arco"));
    assert.match(aro, /Editar aro/);
    assert.match(aro, /Diámetro/);
    assert.match(aro, /Sencilla .*Media .*Lujosa/);
    assert.match(texto(pintarEditor("techo_globos", "guirnalda")), /Editar techo .*Largo/);
    assert.match(texto(pintarEditor("centro_mesa", "centro_mesa")), /Editar centro de mesa .*Diámetro .*Alto .*Guardar centro de mesa/);
    // Una pared no densa solo admite una densidad: no hay nada que elegir y el grupo no aparece.
    assert.doesNotMatch(texto(pintarEditor("pared_no_densa", "pared")), /Densidad/);
    assert.match(texto(pintarEditor("pared_densa", "pared", { errorGuardado: "Esa densidad no es de esta pieza." })), /No se guardó: Esa densidad no es de esta pieza\. La propuesta sigue como estaba\./);
  });

  await caso("el bloque del dibujo: «Editar pared» en el encabezado y sin el selector suelto; sin edición, el de antes", () => {
    const base = pieza("pared_densa", "pared");
    const conEditor = renderToStaticMarkup(React.createElement(BloqueDibujoEstructura, {
      pieza: base, nombrePieza: "Pared de globos densa", nombre: nombreDePieza("pared_densa"),
      onCambiarForma: async () => null, onGuardarPropiedades: async () => null,
    }));
    assert.match(conEditor, /data-testid="editar-pieza-sin-motor"/);
    assert.match(texto(conEditor), /Forma de la pared .*Editar pared/);
    assert.match(conEditor, /aria-label="Forma de la pared"/);
    assert.doesNotMatch(conEditor, /data-testid="forma-pieza"/, "la forma se elige dentro del editor");
    assert.doesNotMatch(conEditor, /data-testid="editor-pieza-sin-motor"/, "el editor va plegado");
    const antes = renderToStaticMarkup(React.createElement(BloqueDibujoEstructura, { pieza: base, nombrePieza: "Pared", onCambiarForma: async () => null }));
    assert.doesNotMatch(antes, /editar-pieza-sin-motor/);
    assert.match(antes, /data-testid="forma-pieza"/, "sin el editor sigue el selector de siempre");
    assert.match(antes, /aria-label="Forma de la pieza"/);
  });

  await caso("el editor del arco orgánico de un semiarco dice semiarco en todos sus textos", () => {
    const fixture = leer<{ peticion: { armado_arco_organico: unknown } }>("scripts/fixtures/arco-organico-ui/vista-arco-organico.json");
    const armado = ArmadoArcoOrganicoV1Schema.parse(fixture.peticion.armado_arco_organico);
    const html = renderToStaticMarkup(React.createElement(EditorArcoOrganico, {
      borrador: armado,
      vista: { vista: null, borrador: "pendiente", error: null },
      leyenda: [],
      guardar: { puede: true },
      guardando: false,
      errorGuardado: null,
      planCambio: true,
      coloresCambiaron: true,
      hayCambios: true,
      onSeguirConMiBorrador: () => {},
      onUsarArcoDeLaPropuesta: () => {},
      onReceta: async () => null,
      onCambiar: () => {},
      onGuardar: () => {},
      onDescartar: () => {},
      onRestablecer: () => {},
      onReintentar: () => {},
      sustantivo: "semiarco",
    } as React.ComponentProps<typeof EditorArcoOrganico>));
    const visible = texto(html);
    assert.match(visible, /Editar semiarco/);
    assert.match(visible, /Guardar semiarco/);
    assert.match(visible, /Usar el semiarco de la propuesta/);
    assert.match(visible, /mientras editabas el semiarco/);
    assert.doesNotMatch(visible, /\barco\b/, "ningún texto dice «arco» a secas");
    // Y lo que guarda pasa el contrato de la edición nueva.
    assert.ok(EdicionArmadoArcoOrganicoSchema.safeParse({ accion: "armado_arco_organico", estructura_id: "EST_04_SEMIARCO", armado_arco_organico: armado }).success);
    assert.ok(EdicionArmadoArcoOrganicoSchema.safeParse({ accion: "armado_arco_organico", estructura_id: "EST_04_SEMIARCO", armado_arco_organico: null }).success);
    assert.ok(!EdicionArmadoArcoOrganicoSchema.safeParse({ accion: "armado_arco_organico", estructura_id: "EST_04_SEMIARCO", armado_arco_organico: { ...armado, forma: { ...armado.forma, corte: 0.1 } } }).success);
  });

  await caso("la tarjeta: con edición la pared ofrece «Editar pared»; de solo lectura, no", () => {
    const editable = renderToStaticMarkup(React.createElement(TarjetaPlanDecoracion, { plan: PLAN, onPlanActualizado: () => undefined, onAprobar: () => undefined }));
    assert.equal((editable.match(/data-testid="editar-pieza-sin-motor"/g) ?? []).length, 1, "un botón, el de la pared");
    assert.match(texto(editable), /Editar pared/);
    const lectura = renderToStaticMarkup(React.createElement(TarjetaPlanDecoracion, { plan: PLAN }));
    assert.doesNotMatch(lectura, /editar-pieza-sin-motor/);
  });

  console.log(`\n${casos} casos en verde`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
