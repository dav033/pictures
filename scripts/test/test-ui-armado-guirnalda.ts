/**
 * UI del armado de guirnaldas (ADR-0032, entrega E6). Render estático
 * (`renderToStaticMarkup`) y módulos sin React, como las pruebas de UI del
 * patrón y del bouquet (`test-ui-propuesta.ts`): comprueba qué datos de Python
 * llegan al decorador, no la animación. Sin red ni proveedores.
 *
 * Las salidas de Python son reales: `scripts/fixtures/guirnalda-ui/vistas-guirnalda.json`
 * (vista previa sin catálogo de la guirnalda de `plan-con-patrones.json`). La
 * huella de la tarjeta sin armado (`tarjeta-sin-armado.json`) se tomó con el
 * código de 27528f2, antes de E6: es el oráculo de "sin armado, byte a byte
 * igual". Si otra entrega cambia la tarjeta a propósito, la huella se vuelve
 * a tomar a mano desde un commit sin E6 con esa entrega fusionada; nunca desde
 * el código que se prueba.
 *
 * Run: npx tsx scripts/test/test-ui-armado-guirnalda.ts
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TarjetaPlanDecoracion } from "@/components/TarjetaPlanDecoracion";
import type { Reloj } from "@/components/plan/autoguardado";
import {
  agregarRemate,
  BloqueGuirnalda,
  claveArmadoGuirnalda,
  conCaida,
  conForma,
  ControlesGuirnalda,
  conSoporte,
  crearVistaGuirnalda,
  dibujarGuirnalda,
  GraficaGuirnalda,
  HojaArmadoGuirnalda,
  leyendaGuirnalda,
  mismoArmadoGuirnalda,
  panelVistaGuirnalda,
  posicionPorRacimo,
  quitarRemate,
  racimosEnOrden,
  resumenInsumosGuirnalda,
} from "@/components/plan/guirnalda";
import { conAnfitriona, conRelleno, MAXIMO_REMATES } from "@/components/plan/guirnalda/borrador-guirnalda";
import { peticionVistaGuirnalda } from "@/components/plan/guirnalda/usarVistaGuirnalda";
import { celdasDeArmado, patronSobreArmado } from "@/components/plan/guirnalda/geometria-guirnalda";
import { dibujoPatron } from "@/components/plan/patron/VistaPatron";
import { leyendaPatron } from "@/components/plan/patron/leyenda";
import { ArmadoGuirnaldaResueltoSchema, type ArmadoGuirnaldaResuelto, type ArmadoGuirnaldaV1 } from "@/lib/plan/armado-guirnalda";
import { OpcionesArmadoGuirnaldaSchema, type OpcionesArmadoGuirnalda } from "@/lib/plan/opciones-armado-guirnalda";
import { FalloPlanArmado } from "@/lib/plan/peticion-armado";
import { lineaVistaGuirnalda, pedirVistaArmadoGuirnalda, type VistaArmadoGuirnalda } from "@/lib/plan/peticion-armado-guirnalda";
import type { PatronColorResuelto } from "@/lib/plan/patron-color";
import type { PlanResuelto } from "@/lib/plan/resuelto";

let casos = 0;
function ok(nombre: string): void {
  casos += 1;
  console.log(`[PASS] ${nombre}`);
}

function textoVisible(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/&quot;/g, "\"").replace(/&[a-z#0-9]+;/g, " ").replace(/\s+/g, " ");
}

function leer<T>(ruta: string): T {
  return JSON.parse(readFileSync(resolve(process.cwd(), ruta), "utf8")) as T;
}

const huella = (html: string) => ({ bytes: Buffer.byteLength(html, "utf8"), sha256: createHash("sha256").update(html, "utf8").digest("hex") });

type Vista = { armado: ArmadoGuirnaldaResuelto; opciones: OpcionesArmadoGuirnalda } | { error: string; detalles: { motivo: string; mensaje: string } };
const vistas = leer<{ estructura_id: string; casos: Record<string, Vista> }>("scripts/fixtures/guirnalda-ui/vistas-guirnalda.json");
const ID = vistas.estructura_id;
function vista(nombre: string): VistaArmadoGuirnalda {
  const caso = vistas.casos[nombre];
  assert.ok(caso && "armado" in caso, nombre);
  return { armado: ArmadoGuirnaldaResueltoSchema.parse(caso.armado), opciones: OpcionesArmadoGuirnaldaSchema.parse(caso.opciones) };
}
const RECETA = vista("receta");
const COLGADA = vista("colgada_arco_caido");
const U_INVERTIDA = vista("pared_u_invertida");
const ONDULADA = vista("pared_ondulada");
const SOBRE_ARCO = vista("sobre_arco_curva");

const planBase = leer<PlanResuelto>("scripts/fixtures/patron-color-ui/plan-con-patrones.json");
const estructura = planBase.estructuras.find((item) => item.estructura_id === ID)!;
const declarada = planBase.plan.estructuras.find((item) => item.estructura_id === ID)!;
const leyenda = leyendaGuirnalda(RECETA.armado, estructura.lineas);

/** El plan de patrones con la guirnalda armada (o no), como lo devolvería la resolución con la bandera. */
function planConArmado(resuelto: ArmadoGuirnaldaResuelto | null): PlanResuelto {
  const plan: PlanResuelto = structuredClone(planBase);
  if (!resuelto) return plan;
  const pieza = plan.plan.estructuras.find((item) => item.estructura_id === ID)!;
  pieza.armado_guirnalda = structuredClone(resuelto.armado);
  plan.armados_guirnalda = [structuredClone(resuelto)];
  return plan;
}

// ---------------------------------------------------------------------------
// 1. Sin armado, la tarjeta sale byte a byte igual que antes de E6.
{
  const antes = leer<{ editable: { sha256: string; bytes: number }; lectura: { sha256: string; bytes: number } }>("scripts/fixtures/guirnalda-ui/tarjeta-sin-armado.json");
  const editable = renderToStaticMarkup(React.createElement(TarjetaPlanDecoracion, { plan: planConArmado(null), onPlanActualizado: () => undefined, onAprobar: () => undefined }));
  const lectura = renderToStaticMarkup(React.createElement(TarjetaPlanDecoracion, { plan: planConArmado(null) }));
  assert.deepEqual(huella(editable), antes.editable, "tarjeta editable sin armado: byte a byte la de 27528f2");
  assert.deepEqual(huella(lectura), antes.lectura, "tarjeta de solo lectura sin armado: byte a byte la de 27528f2");
  const vacia = renderToStaticMarkup(React.createElement(TarjetaPlanDecoracion, { plan: { ...planConArmado(null), armados_guirnalda: [] }, onPlanActualizado: () => undefined, onAprobar: () => undefined }));
  assert.deepEqual(huella(vacia), antes.editable, "una lista de armados vacía tampoco cambia nada");
  assert.doesNotMatch(editable, /bloque-armado-guirnalda|Armado de la guirnalda/);
  ok("sin armado: la tarjeta (editable y de lectura) sale byte a byte igual que antes de E6");
}

// ---------------------------------------------------------------------------
// 2. Con armado: el bloque solo en la guirnalda, con lo que resolvió Python.
{
  const html = renderToStaticMarkup(React.createElement(TarjetaPlanDecoracion, { plan: planConArmado(RECETA.armado), onPlanActualizado: () => undefined, onAprobar: () => undefined }));
  const texto = textoVisible(html);
  assert.equal((html.match(/data-testid="bloque-armado-guirnalda"/g) ?? []).length, 1, "un solo bloque, el de la guirnalda");
  assert.match(texto, /Armado de la guirnalda Guirnalda sobre la mesa/, "el nombre de Python como chip");
  assert.match(texto, /12 cuartetos de 12" de izquierda a derecha, relleno de 14 globos chicos y 5 globos grandes de remate, sobre la mesa\./, "la descripción de Python");
  assert.match(texto, /Soporte: Sobre la mesa .*Forma: Recta .*Largo: 3,5 m .*Racimo: Cuarteto de 12″ · 12 cuartetos .*Relleno: 14 globos chicos entre racimos .*Remates: 1 × R-24 blanco fashion \(a lo largo\), 3 × R-18 blanco fashion \(a lo largo\), 1 × R-18 dorado reflex \(a lo largo\)/);
  assert.match(texto, /Necesita \(no se cotiza\): 4 m de tira · ≈ 22 puntos de pegante · tijeras · bomba infladora/, "insumos de Python; lo estimado con ≈");
  assert.match(texto, /Armado e instalación: ≈ 1–1,75 h estimado/, "la duración, marcada como estimada");
  assert.match(texto, /Sobra 1 globo que no completa un cuarteto: va suelto entre los racimos\./, "los avisos de Python");
  assert.equal((html.match(/data-testid="editar-armado-guirnalda"/g) ?? []).length, 1);
  assert.equal((html.match(/data-testid="abrir-hoja-armado-guirnalda"/g) ?? []).length, 1);
  assert.equal((html.match(/data-testid="bloque-patron"/g) ?? []).length, 3, "las piezas con patrón siguen con su bloque");
  assert.doesNotMatch(html, /data-testid="editor-armado-guirnalda"|data-testid="dialogo-hoja-armado-guirnalda"/, "editor y hoja cerrados no se montan");
  const lectura = renderToStaticMarkup(React.createElement(TarjetaPlanDecoracion, { plan: planConArmado(RECETA.armado) }));
  assert.doesNotMatch(lectura, /editar-armado-guirnalda/, "sin edición no se ofrece el editor");
  assert.match(lectura, /abrir-hoja-armado-guirnalda/, "la hoja sí");
  // Ocupado: "Editar armado" sigue enfocable (aria-disabled, no disabled).
  const ocupado = renderToStaticMarkup(React.createElement(BloqueGuirnalda, { resuelto: RECETA.armado, leyenda, nombrePieza: "Guirnalda", onEditar: () => undefined, ocupado: true }));
  const boton = /<button[^>]*data-testid="editar-armado-guirnalda"[^>]*>/.exec(ocupado)?.[0] ?? "";
  assert.match(boton, /aria-disabled="true"/);
  assert.doesNotMatch(boton, /\sdisabled=""/);
  const sobre = textoVisible(renderToStaticMarkup(React.createElement(BloqueGuirnalda, { resuelto: SOBRE_ARCO.armado, leyenda, nombrePieza: "Guirnalda", anfitriona: "Arco" })));
  assert.match(sobre, /Soporte: Sobre Arco/, "sobre otra pieza, con su nombre");
  const colgada = textoVisible(renderToStaticMarkup(React.createElement(BloqueGuirnalda, { resuelto: COLGADA.armado, leyenda, nombrePieza: "Guirnalda" })));
  assert.match(colgada, /Forma: Arco caído con 0,4 m de caída, 3 anclajes .*Largo: 3,5 m · cuerda 3,94 m/, "la caída y la cuerda de Python");
  assert.match(colgada, /4,5 m de tira · ≈ 8,5 m de cuerda · 3 ganchos/, "metros de tira y de cuerda");
  ok("bloque del armado: soporte, forma, caída, racimo, relleno, remates, insumos y duración estimada de Python");
}

// ---------------------------------------------------------------------------
// 3. La gráfica: la forma real, la caída a escala y los racimos de izquierda a derecha.
{
  const recta = dibujarGuirnalda(RECETA.armado);
  const k = 4;
  const enDibujo = (dibujo: ReturnType<typeof dibujarGuirnalda>, papel: string) => dibujo.globos.filter((globo) => globo.papel === papel).length;
  for (const caso of [RECETA, COLGADA, U_INVERTIDA, ONDULADA, SOBRE_ARCO]) {
    const dibujo = dibujarGuirnalda(caso.armado);
    const total = dibujo.globos.length;
    assert.equal(total, caso.armado.globos_por_instancia, `${caso.armado.armado.forma}: cada globo de Python se dibuja una vez`);
    assert.equal(enDibujo(dibujo, "racimo"), caso.armado.racimos.length * k);
    assert.equal(enDibujo(dibujo, "relleno"), caso.armado.relleno?.total ?? 0);
    assert.deepEqual(dibujo.racimos.map((racimo) => racimo.numero), caso.armado.racimos.map((racimo) => racimo.numero));
  }
  const xs = recta.racimos.map((racimo) => racimo.centro.x);
  assert.ok(xs.every((x, i) => i === 0 || x > xs[i - 1]!), "numerados de izquierda a derecha");
  assert.ok(recta.racimos.every((racimo) => Math.abs(racimo.centro.y) < 0.01), "recta: todos a la misma altura");
  assert.equal(recta.soporte, "mesa");
  assert.ok(recta.apoyo && recta.globos.every((globo) => globo.y < recta.apoyo!.y), "sobre la mesa: la mesa va debajo");
  // Remate junto al racimo que dijo Python.
  const remate = recta.globos.find((globo) => globo.papel === "remate" && globo.codigo === 5)!;
  const cercano = [...recta.racimos].sort((a, b) => Math.hypot(a.centro.x - remate.x, a.centro.y - remate.y) - Math.hypot(b.centro.x - remate.x, b.centro.y - remate.y))[0]!;
  assert.equal(cercano.numero, RECETA.armado.remates.find((item) => item.codigo === 5)!.racimos[0], "el remate va junto a su racimo");

  // Arco caído de 3 anclajes y 0,4 m: dos tramos que bajan, a escala del largo.
  const caido = dibujarGuirnalda(COLGADA.armado);
  assert.equal(caido.anclajes.length, 3);
  assert.ok(caido.anclajes.every((anclaje) => Math.abs(anclaje.y) < 0.01), "los anclajes arriba");
  const escala = (caido.anclajes[2]!.x - caido.anclajes[0]!.x) / 3.5;
  const bajo = Math.max(...caido.racimos.map((racimo) => racimo.centro.y));
  assert.ok(Math.abs(bajo / escala - 0.4) < 0.06, `la caída se dibuja a escala: ${(bajo / escala).toFixed(3)} m`);
  const mitad = caido.racimos[Math.floor(caido.racimos.length / 2)]!;
  assert.ok(Math.abs(mitad.centro.y) < bajo * 0.5, "el anclaje del medio sube la guirnalda: dos tramos, no uno");

  // U invertida de 1,2 m: los extremos bajan respecto del centro, a escala.
  const u = dibujarGuirnalda(U_INVERTIDA.armado);
  const [primero, ultimo] = [u.racimos[0]!, u.racimos.at(-1)!];
  const cima = Math.min(...u.racimos.map((racimo) => racimo.centro.y));
  const escalaU = (ultimo.centro.x - primero.centro.x) / 3.5;
  assert.ok(primero.centro.y > cima && ultimo.centro.y > cima, "U invertida: los extremos más abajo que el centro");
  assert.ok(Math.abs((primero.centro.y - cima) / escalaU - 1.2) < 0.08, "la caída de los lados, a escala");

  const onda = dibujarGuirnalda(ONDULADA.armado);
  assert.ok(onda.racimos.some((racimo) => racimo.centro.y < -1) && onda.racimos.some((racimo) => racimo.centro.y > 1), "ondulada: sube y baja");
  const curva = dibujarGuirnalda(SOBRE_ARCO.armado);
  assert.ok(curva.racimos[5]!.centro.y < curva.racimos[0]!.centro.y, "curva: el centro más alto que los extremos");
  assert.equal(curva.soporte, "sobre_estructura");

  // Sin caída declarada, una de muestra y el texto lo dice.
  const sinCaida = { ...U_INVERTIDA.armado, armado: { ...U_INVERTIDA.armado.armado } };
  delete sinCaida.armado.caida_m;
  assert.equal(dibujarGuirnalda(sinCaida).caidaDeMuestra, true);
  assert.equal(dibujarGuirnalda(U_INVERTIDA.armado).caidaDeMuestra, false);
  assert.match(renderToStaticMarkup(React.createElement(GraficaGuirnalda, { resuelto: sinCaida, leyenda })), /La caída no está declarada: se dibuja una de muestra\./);

  // La rejilla del patrón sobre la curva del armado: la misma vista del patrón sigue la forma.
  const patron = planBase.patrones_color!.find((item) => item.estructura_id === "EST_02_ARCO")! as PatronColorResuelto;
  const plano = dibujoPatron(patron, { tipo: "guirnalda" });
  const enU = dibujoPatron(patron, { tipo: "guirnalda", guirnalda: { forma: "u_invertida", largo_m: 3.5, caida_m: 1.2 } });
  const recto = dibujoPatron(patron, { tipo: "guirnalda", guirnalda: { forma: "recta", largo_m: 3.5 } });
  assert.ok(enU.caja.alto / enU.caja.ancho > (plano.caja.alto / plano.caja.ancho) * 1.8, "con armado en U, el patrón se dibuja en U");
  assert.ok(recto.caja.alto < plano.caja.alto, "recta: más plana que la onda de siempre");
  ok("gráfica: recta, curva, ondulada, U invertida y arco caído, con la caída a escala y los racimos de izquierda a derecha");

  // Con patrón y armado se dibujan los racimos del armado (E5, `filas_de_racimos`), no la rejilla completa del patrón.
  const celdas = celdasDeArmado(RECETA.armado);
  const materialDe = new Map(RECETA.armado.leyenda.map((entrada) => [entrada.codigo, entrada.material]));
  assert.deepEqual(celdas, RECETA.armado.racimos.map((racimo) => racimo.codigos.map((codigo) => materialDe.get(codigo))), "cada racimo con el material de sus códigos");
  const sobreArmado = patronSobreArmado(patron, RECETA.armado);
  assert.equal(sobreArmado.celdas.length, RECETA.armado.racimos.length);
  assert.deepEqual(sobreArmado.extras, []);
  assert.notEqual(patron.celdas.length, RECETA.armado.racimos.length, "la rejilla completa del patrón tiene otras filas");
  const conPatron = planConArmado(RECETA.armado);
  conPatron.patrones_color = [...conPatron.patrones_color!, { ...structuredClone(patron), estructura_id: ID }];
  const html = renderToStaticMarkup(React.createElement(TarjetaPlanDecoracion, { plan: conPatron, onPlanActualizado: () => undefined, onAprobar: () => undefined }));
  const inicio = html.lastIndexOf('data-testid="bloque-patron"');
  const fin = html.indexOf('data-testid="bloque-armado-guirnalda"', inicio);
  assert.ok(inicio > 0 && fin > inicio, "la guirnalda muestra su patrón y su armado");
  const globosDelPatron = (html.slice(inicio, fin).match(/class="patron-globo-entra"/g) ?? []).length;
  assert.equal(globosDelPatron, RECETA.armado.racimos.length * 4, "el bloque del patrón dibuja los racimos del armado (12 cuartetos), no la rejilla completa");
  ok("con patrón y armado: el patrón se dibuja sobre los racimos que de verdad se arman");
}

// ---------------------------------------------------------------------------
// 4. Accesibilidad de la gráfica: texto alternativo y orden de lectura; destinos con el teclado.
{
  const estatica = renderToStaticMarkup(React.createElement(GraficaGuirnalda, { resuelto: RECETA.armado, leyenda, etiqueta: "Guirnalda: guirnalda sobre la mesa" }));
  assert.match(estatica, /<figure aria-label="Guirnalda: guirnalda sobre la mesa"/);
  assert.match(estatica, /<svg[^>]*aria-hidden="true"/, "el dibujo no se lee; se lee su texto");
  assert.match(estatica, /<figcaption class="sr-only"><p>Sobre la mesa\. Recta, 3,5 m de largo\. 12 cuartetos de 12″, numerados de izquierda a derecha\.<\/p>/);
  const lista = /<ol aria-label="Racimos de izquierda a derecha">(.*?)<\/ol>/.exec(estatica)?.[1] ?? "";
  const items = [...lista.matchAll(/<li>(.*?)<\/li>/g)].map((item) => item[1]!.replace(/&quot;/g, "\""));
  assert.equal(items.length, 12);
  assert.deepEqual(items.map((item) => Number(/^Racimo (\d+):/.exec(item)?.[1])), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], "la lista va en el orden de armado");
  assert.equal(items[1], "Racimo 2: R-9 blanco fashion (2), R-12 blanco fashion (3), R-12 dorado reflex (8), R-12 blanco fashion (3); junto a él, remate: R-24 blanco fashion (5)", "cada racimo con sus códigos y su remate");
  assert.match(estatica, /Relleno entre racimos: 14 globos chicos, 8 de R-5 blanco fashion \(1\), 6 de R-5 dorado reflex \(6\)\./);
  assert.match(estatica, /Sueltos entre racimos: 1 de R-12 blanco fashion \(3\)\./);
  assert.doesNotMatch(estatica, /role="button"/);
  assert.deepEqual(racimosEnOrden(RECETA.armado, leyenda).map((racimo) => racimo.numero), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  const editable = renderToStaticMarkup(React.createElement(GraficaGuirnalda, { resuelto: RECETA.armado, leyenda, destino: { remate: "el remate 1", onSoltar: () => undefined }, resaltado: 3 }));
  assert.match(editable, /role="group" aria-label="Racimos de la guirnalda: elige junto a cuál va el remate 1"/);
  assert.equal((editable.match(/role="button"/g) ?? []).length, 12, "cada racimo es un destino");
  assert.equal((editable.match(/tabindex="0"/g) ?? []).length, 1, "un solo racimo entra con Tab; las flechas mueven el resto");
  assert.match(editable, /aria-label="Racimo 1: [^"]*\. Poner aquí el remate 1" data-racimo="1"/);
  assert.equal((editable.match(/data-racimo="\d+"/g) ?? []).length, 12, "zonas donde soltar con el puntero");
  ok("gráfica accesible: figura con texto alternativo, racimos en orden de lectura y destinos operables con el teclado");
}

// ---------------------------------------------------------------------------
// 5. Controles del editor: lo que Python admite, la caída solo donde cuelga, remates movibles.
{
  const colores = leyendaPatron(declarada.materiales, estructura.lineas);
  const controles = (borrador: ArmadoGuirnaldaV1 | null, opciones: OpcionesArmadoGuirnalda | null, moviendo: number | null = null) => renderToStaticMarkup(React.createElement(ControlesGuirnalda, {
    borrador, opciones, colores, nombrePieza: (id: string) => ({ EST_02_ARCO: "Arco" } as Record<string, string>)[id] ?? id,
    onCambiar: () => undefined, moviendo, onMover: () => undefined, onArrastrar: () => undefined,
  }));
  const receta = controles(RECETA.armado.armado, RECETA.opciones);
  const texto = textoVisible(receta);
  assert.match(receta, /role="radiogroup" aria-label="Soporte de la guirnalda"/);
  assert.match(texto, /En pared Colgada En el piso Sobre la mesa Sobre otra pieza/, "los soportes que admite Python");
  assert.match(texto, /Recta Curva Ondulada U invertida Arco caído/, "las cinco formas del contrato");
  assert.doesNotMatch(texto, /Caída declarada|Puntos de anclaje/, "recta sobre la mesa: sin caída ni anclajes");
  assert.match(texto, /Trío Cuarteto Quinteto .*9″ 11″ 12″/);
  assert.match(receta, /role="switch" aria-checked="true"[^>]*>.*Relleno entre racimos/, "relleno encendido");
  assert.match(receta, /aria-valuetext="21\s?%" data-testid="proporcion-relleno-guirnalda"/, "la proporción del relleno, con su valor en texto");
  assert.equal((receta.match(/data-testid="remate-guirnalda"/g) ?? []).length, 2);
  assert.match(receta, /aria-pressed="false" aria-label="Mover el remate 1 \(Blanco mate\) a un racimo"/, "cada remate se lleva a un racimo con un botón");
  const colgada = textoVisible(controles(COLGADA.armado.armado, COLGADA.opciones, 1));
  assert.match(colgada, /Caída declarada .*0,4 m/, "la caída, solo en las formas que cuelgan");
  assert.match(colgada, /Puntos de anclaje .*3 puntos/);
  assert.match(controles(COLGADA.armado.armado, COLGADA.opciones, 1), /aria-pressed="true" aria-label="Cancelar: no mover el remate 2/, "el remate que se mueve se anuncia");
  const sobre = controles(SOBRE_ARCO.armado.armado, SOBRE_ARCO.opciones);
  assert.match(sobre, /data-testid="anfitriona-guirnalda"/);
  assert.match(textoVisible(sobre), /Sobre la pieza EST_01_COLUMNA Arco EST_03_PARED/, "las anfitrionas que dijo Python, por su nombre");
  const sinOpciones = textoVisible(controles(RECETA.armado.armado, null));
  assert.match(sinOpciones, /Soporte .*Sobre la mesa Forma/, "sin opciones de Python: solo lo que el borrador ya tiene");
  assert.doesNotMatch(sinOpciones, /En pared Colgada/);
  assert.match(controles(null, null), /aria-hidden="true"/, "sin borrador: esqueleto de carga");
  ok("controles: soportes, formas, caída y anclajes, racimo, relleno y remates movibles, con lo que Python admite");
}

// ---------------------------------------------------------------------------
// 6. El borrador: solo la forma del contrato; ninguna regla de conteo.
{
  const base = RECETA.armado.armado;
  const colgada = conSoporte(base, "colgada");
  assert.equal(colgada.puntos_de_anclaje, 2, "colgar pide los anclajes mínimos del contrato");
  assert.equal(colgada.origen, "decorador", "lo que toca el decorador lo firma él");
  const sobre = conAnfitriona(base, "EST_02_ARCO");
  assert.deepEqual([sobre.soporte, sobre.estructura_id], ["sobre_estructura", "EST_02_ARCO"]);
  assert.equal("estructura_id" in conSoporte(sobre, "pared"), false, "fuera de otra pieza no lleva anfitriona");
  const conU = conCaida(conForma(base, "u_invertida"), 0.30000000000000004);
  assert.equal(conU.caida_m, 0.3, "la caída a dos decimales");
  assert.equal("caida_m" in conForma(conU, "recta"), false, "una forma que no cuelga pierde la caída");
  assert.equal("caida_m" in conCaida(conU, null), false);
  assert.equal(conRelleno(base, { material: 1, proporcion: 0.123456 }).relleno?.proporcion, 0.12);
  let lleno: ArmadoGuirnaldaV1 = { ...base, remates: [] };
  for (let i = 0; i < MAXIMO_REMATES; i += 1) lleno = agregarRemate(lleno, 0)!;
  assert.equal(agregarRemate(lleno, 0), null, "hasta 6 remates");
  assert.equal(quitarRemate(lleno, 0).remates.length, MAXIMO_REMATES - 1);
  assert.deepEqual([1, 2, 6, 7, 11, 12].map((racimo) => posicionPorRacimo(racimo, 12)), ["extremo_izq", "cada_n", "centro", "centro", "cada_n", "extremo_der"]);
  assert.equal(posicionPorRacimo(2, 3), "centro");
  assert.ok(mismoArmadoGuirnalda(base, { ...base, origen: "decorador" }), "mismo armado aunque cambie quién lo firmó");
  assert.equal(claveArmadoGuirnalda(base), claveArmadoGuirnalda(Object.fromEntries(Object.entries(base).reverse()) as ArmadoGuirnaldaV1), "la clave no depende del orden de las claves (el eco de Python)");
  ok("borrador: soporte, forma, caída, relleno y remates con la forma del contrato; soltar en un racimo da su posición");
}

// ---------------------------------------------------------------------------
// 7. Hoja de armado: una sola, con insumos en metros, racimos en orden, leyenda y, si hay, el patrón.
{
  const patron = planBase.patrones_color!.find((item) => item.estructura_id === "EST_02_ARCO")! as PatronColorResuelto;
  const html = renderToStaticMarkup(React.createElement(HojaArmadoGuirnalda, { resuelto: COLGADA.armado, leyenda, estructura, declarada, tituloPlan: planBase.plan.concepto.titulo, patron }));
  const hoja = textoVisible(html);
  assert.match(hoja, /Hoja de armado · Baby shower azul, blanco y flores/);
  assert.match(hoja, /3,5 m de largo · cuerda de 3,94 m · 13 cuartetos de 12″ · 76 globos por guirnalda/);
  assert.match(hoja, /Soporte: Colgada · Forma: Arco caído con 0,4 m de caída, 3 anclajes/);
  assert.match(hoja, /Código Globo Por guirnalda Total 1 1 R-5 blanco fashion/, "la leyenda de códigos por material y tamaño");
  assert.match(hoja, /Tira perforada 4,5 m .*Cuerda ≈ 8,5 m nailon o cuerda para colgarla[^.]*estimado .*Ganchos 3 ganchos/, "insumos con metros de tira y de cuerda");
  assert.match(hoja, /Duración estimada: ≈ 1,5–2,75 h de armado e instalación \(estimado\)/);
  const racimos = [...(/data-testid="racimos-armado-guirnalda">(.*?)<\/ol>/.exec(html)?.[1] ?? "").matchAll(/Racimo (\d+)/g)].map((item) => Number(item[1]));
  assert.deepEqual(racimos, Array.from({ length: 13 }, (_, i) => i + 1), "los racimos en orden, del 1 al último");
  assert.match(hoja, /Relleno entre racimos \(16\):/);
  assert.match(hoja, /Remate a lo largo: 1 × .*junto al racimo 3/);
  assert.match(hoja, /Paso a paso .*Cuélgala de sus 3 puntos de anclaje con la cuerda, con una caída de 0,4 m\./);
  assert.match(hoja, new RegExp(`Patrón: ${patron.nombre}`), "la hoja del patrón se funde en esta");
  if (patron.instrucciones.length) assert.match(hoja, /Consejos del patrón/);
  for (const clase of ["hoja-armado ", "hoja-armado-bloque", "hoja-armado-columnas"]) assert.match(html, new RegExp(`class="${clase}`), `clase de impresión ${clase.trim()}`);
  assert.match(html, /<figure aria-label="Guirnalda de mesa: guirnalda colgada"/, "la gráfica de la hoja con su texto");
  const sinPatron = textoVisible(renderToStaticMarkup(React.createElement(HojaArmadoGuirnalda, { resuelto: RECETA.armado, leyenda, estructura, declarada })));
  assert.doesNotMatch(sinPatron, /Patrón:|Consejos del patrón/);
  assert.match(sinPatron, /Sueltos entre racimos: 1 ×/);
  assert.equal(resumenInsumosGuirnalda([], null), "");
  ok("hoja de armado: una sola, con insumos en metros, racimos en orden, leyenda, pasos y el patrón fundido");
}

// ---------------------------------------------------------------------------
// 8. La vista previa del editor: estados de carga, error, vacío, éxito y concurrencia.
function vaciarPromesas(): Promise<void> {
  return new Promise((listo) => setImmediate(listo));
}

function relojFalso(): { reloj: Reloj; avanzar: (ms: number) => Promise<void> } {
  let ahora = 0;
  let siguienteId = 0;
  let tareas: Array<{ id: number; en: number; accion: () => void }> = [];
  const reloj: Reloj = (accion, ms) => {
    const id = ++siguienteId;
    tareas.push({ id, en: ahora + ms, accion });
    return () => {
      tareas = tareas.filter((tarea) => tarea.id !== id);
    };
  };
  async function avanzar(ms: number): Promise<void> {
    const fin = ahora + ms;
    for (;;) {
      tareas.sort((a, b) => a.en - b.en || a.id - b.id);
      const tarea = tareas[0];
      if (!tarea || tarea.en > fin) break;
      tareas.shift();
      ahora = tarea.en;
      tarea.accion();
      await vaciarPromesas();
    }
    ahora = fin;
    await vaciarPromesas();
  }
  return { reloj, avanzar };
}

type Pedido = { armado: ArmadoGuirnaldaV1 | null; signal: AbortSignal; resolver: (vista: VistaArmadoGuirnalda) => void; fallar: (error: unknown) => void };

function banco(inicial: ArmadoGuirnaldaResuelto | null) {
  const { reloj, avanzar } = relojFalso();
  const pedidos: Pedido[] = [];
  const rechazos: string[] = [];
  const control = crearVistaGuirnalda({
    inicial,
    reloj,
    pedir: (armado, signal) => new Promise((resolver, fallar) => pedidos.push({ armado, signal, resolver, fallar })),
    alRechazar: (mensaje) => rechazos.push(mensaje),
  });
  return { control, pedidos, rechazos, avanzar };
}

const conArmado = (resuelto: ArmadoGuirnaldaResuelto, armado: ArmadoGuirnaldaV1): VistaArmadoGuirnalda => ({ armado: { ...resuelto, armado }, opciones: RECETA.opciones });

async function probarVistaPrevia(): Promise<void> {
  // Al abrir con el armado del plan: se dibuja ya y se piden las opciones una vez, sin tapar el dibujo.
  {
    const { control, pedidos, avanzar } = banco(RECETA.armado);
    assert.equal(control.estado().vista, RECETA.armado, "el armado del plan, desde el primer render");
    control.mostrar(RECETA.armado.armado);
    assert.equal(pedidos.length, 1, "una sola petición, solo para saber las opciones");
    assert.deepEqual([control.estado().borrador, control.estado().enVuelo], ["listo", false], "no se anuncia 'Dibujando…'");
    pedidos[0]!.resolver(RECETA);
    await avanzar(0);
    assert.deepEqual(control.estado().opciones, RECETA.opciones);
    assert.deepEqual(panelVistaGuirnalda(control.estado()), { fase: "listo", vista: RECETA.armado, actualizando: false, fallo: null });

    // Concurrencia: dos cambios seguidos; gana el último y la respuesta vieja no cuenta.
    const b = conForma(RECETA.armado.armado, "ondulada");
    const c = conForma(RECETA.armado.armado, "curva");
    control.mostrar(b);
    assert.equal(pedidos.length, 1, "espera la pausa antes de pedir");
    const mientras = panelVistaGuirnalda(control.estado());
    assert.deepEqual(mientras.fase === "listo" && [mientras.vista, mientras.actualizando], [RECETA.armado, true], "se conserva el último dibujo mientras llega el nuevo");
    await avanzar(300);
    assert.equal(pedidos.length, 2);
    control.mostrar(c);
    await avanzar(300);
    assert.equal(pedidos.length, 3);
    assert.equal(pedidos[1]!.signal.aborted, true, "el borrador anterior se cancela");
    pedidos[1]!.resolver(conArmado(ONDULADA.armado, b));
    await avanzar(0);
    assert.equal(control.estado().borrador, "pendiente", "una respuesta vieja no se dibuja");
    pedidos[2]!.resolver(conArmado(SOBRE_ARCO.armado, c));
    await avanzar(0);
    assert.equal(control.estado().vista?.armado, c);
    assert.equal(control.estado().borrador, "listo");

    // Deshacer a lo ya dibujado: sin otra petición.
    control.mostrar(RECETA.armado.armado);
    assert.equal(control.estado().vista, RECETA.armado);
    assert.equal(pedidos.length, 3, "lo que Python ya dibujó no se vuelve a pedir");

    // Rechazo de Python: su frase, y el editor lo deshace.
    const d = conSoporte(conForma(RECETA.armado.armado, "u_invertida"), "piso");
    control.mostrar(d);
    await avanzar(300);
    const frase = "Una guirnalda que cuelga necesita la pared o puntos de anclaje de donde colgar.";
    pedidos[3]!.fallar(new FalloPlanArmado(frase, { motivo: "forma_no_admitida" }));
    await avanzar(0);
    assert.equal(control.estado().borrador, "rechazado");
    assert.equal(control.estado().error?.mensaje, frase);
    assert.equal(panelVistaGuirnalda(control.estado()).fase, "listo", "el dibujo anterior sigue a la vista");

    // Python caído: fallo con "Reintentar" y el último dibujo a la vista.
    const e = conCaida(COLGADA.armado.armado, 0.5);
    control.mostrar(e);
    await avanzar(300);
    pedidos[4]!.fallar(new FalloPlanArmado("No pudimos conectar con el servidor."));
    await avanzar(0);
    const caido = panelVistaGuirnalda(control.estado());
    assert.equal(control.estado().borrador, "fallido");
    assert.deepEqual(caido.fase === "listo" && caido.fallo, "No pudimos conectar con el servidor.");
    control.mostrar(e);
    await avanzar(1000);
    assert.equal(pedidos.length, 5, "lo que ya falló no se vuelve a pedir solo");
    control.reintentar();
    await avanzar(300);
    assert.equal(pedidos.length, 6, "Reintentar lo vuelve a pedir");
    control.cerrar();
    assert.equal(pedidos[5]!.signal.aborted, true, "cerrar el editor cancela lo que quede");
  }
  // Sin armado en el plan: cargando, la receta al instante; si Python no puede armarla, vacío.
  {
    const { control, pedidos, rechazos, avanzar } = banco(null);
    control.mostrar(null);
    assert.deepEqual(panelVistaGuirnalda(control.estado()), { fase: "cargando" });
    await avanzar(0);
    assert.equal(pedidos.length, 1, "la receta sale sin pausa");
    pedidos[0]!.fallar(new FalloPlanArmado("Con estos globos no se puede armar la guirnalda sin cambiar la compra.", { motivo: "sin_armado_posible" }));
    await avanzar(0);
    assert.deepEqual(panelVistaGuirnalda(control.estado()), { fase: "vacio", mensaje: "Con estos globos no se puede armar la guirnalda sin cambiar la compra." });
    assert.deepEqual(rechazos, [], "la receta rechazada no deshace nada");
  }
  {
    const { control, pedidos, avanzar } = banco(null);
    control.mostrar(null);
    await avanzar(0);
    pedidos[0]!.fallar(new TypeError("Failed to fetch"));
    await avanzar(0);
    const panel = panelVistaGuirnalda(control.estado());
    assert.equal(panel.fase, "error");
    assert.ok(panel.fase === "error" && panel.reintentable && !/Failed to fetch/.test(panel.mensaje), "un error técnico no llega al decorador");
    control.reintentar();
    await avanzar(0);
    pedidos[1]!.resolver(RECETA);
    await avanzar(0);
    assert.equal(panelVistaGuirnalda(control.estado()).fase, "listo");
    assert.equal(control.estado().receta, true);
  }
  ok("vista previa: cargando, listo, vacío, error con Reintentar, rechazo con la frase de Python y concurrencia (gana el último)");
}

// ---------------------------------------------------------------------------
// 9. La petición al navegador: solo el contrato, la respuesta validada y los errores para el decorador.
async function probarPeticion(): Promise<void> {
  const pieza = { plan: planBase.plan, estructuraId: ID, lineas: estructura.lineas.map(lineaVistaGuirnalda) };
  const responder = (datos: unknown, status = 200): typeof fetch => async () => new Response(JSON.stringify(datos), { status, headers: { "Content-Type": "application/json" } });
  let enviado: Record<string, unknown> = {};
  let url = "";
  const bien = await pedirVistaArmadoGuirnalda(peticionVistaGuirnalda(pieza, null), {
    fetcher: async (destino, init) => {
      url = String(destino);
      enviado = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return responder(RECETA)(destino, init);
    },
  });
  assert.equal(url, "/api/plan-armado-guirnalda");
  assert.equal(bien.armado.nombre, "Guirnalda sobre la mesa");
  assert.deepEqual(Object.keys(enviado).sort(), ["armado_guirnalda", "estructura_id", "lineas", "plan"]);
  assert.deepEqual(Object.keys((enviado.lineas as Record<string, unknown>[])[0]!).sort(), ["acabado", "color", "diam_pulg", "product_id", "tamano_codigo", "unidades", "variant_id"], "de cada línea solo lo que nombra");
  const cuerpo = peticionVistaGuirnalda(pieza, null);
  await assert.rejects(pedirVistaArmadoGuirnalda(cuerpo, { fetcher: responder({ armado: RECETA.armado }) }), FalloPlanArmado, "sin opciones no vale");
  await assert.rejects(pedirVistaArmadoGuirnalda(cuerpo, { fetcher: responder({ ...RECETA, armado: { ...RECETA.armado, racimos: [] } }) }), FalloPlanArmado, "fuera de esquema no se dibuja");
  await assert.rejects(pedirVistaArmadoGuirnalda(cuerpo, { fetcher: responder({ ...RECETA, armado: { ...RECETA.armado, estructura_id: "EST_02_ARCO" } }) }), FalloPlanArmado, "ni la de otra pieza");
  const frase = "Solo una guirnalda en U invertida o en arco caído tiene caída.";
  await assert.rejects(
    pedirVistaArmadoGuirnalda(cuerpo, { fetcher: responder({ error: frase, causa: "ARMADO_INVALIDO", motivo: "caida_sin_forma_colgante", mensaje: frase }, 422) }),
    (error: unknown) => error instanceof FalloPlanArmado && error.armadoInvalido && error.motivo === "caida_sin_forma_colgante" && error.message === frase,
    "el rechazo trae la frase de Python",
  );
  await assert.rejects(pedirVistaArmadoGuirnalda(cuerpo, { fetcher: responder({ schema_version: "operational.v1", code: "PYTHON_UNAVAILABLE", message: "connect ECONNREFUSED 127.0.0.1:8000" }, 503) }), (error: unknown) => error instanceof FalloPlanArmado && !error.armadoInvalido && !/ECONNREFUSED/.test(error.message), "Python caído: un mensaje para el decorador");
  await assert.rejects(pedirVistaArmadoGuirnalda(cuerpo, { fetcher: async () => { throw new TypeError("Failed to fetch"); } }), (error: unknown) => error instanceof FalloPlanArmado && !/Failed to fetch/.test(error.message));
  ok("petición de la vista previa: solo el contrato, respuesta validada, rechazo con la frase de Python y Python caído sin detalles técnicos");
}

async function main(): Promise<void> {
  await probarVistaPrevia();
  await probarPeticion();
  console.log(`\n${casos} casos en verde`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
