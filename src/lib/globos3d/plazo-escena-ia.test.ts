import assert from "node:assert/strict";
import test from "node:test";
import {
  HERRAMIENTA_MAXIMA_MS, MARGEN_DE_CORTE_MS, TEXTO_PEDIDO_SIN_TIEMPO, VUELTA_DEL_MODELO_MS, alcanzaParaHerramienta, alcanzaParaVuelta, controlarPlazo, corteConPlazo, corteElPlazo, crearPlazo,
  respuestaConPlazo, textoHerramientaSinTiempo, textoPasoSinTiempo,
} from "./plazo-escena-ia";

const relojA = (inicial = 1_000_000) => {
  let ahora = inicial;
  return { ahora: () => ahora, pasan: (ms: number) => { ahora += ms; } };
};

test("el plazo cuenta lo que queda desde que se crea y nunca baja de cero", () => {
  const reloj = relojA();
  const plazo = crearPlazo(75_000, reloj.ahora);
  assert.equal(plazo.restanteMs(), 75_000);
  reloj.pasan(30_000);
  assert.equal(plazo.restanteMs(), 45_000);
  assert.ok(plazo.alcanza(45_000) && !plazo.alcanza(45_001));
  reloj.pasan(100_000);
  assert.equal(plazo.restanteMs(), 0);
});

test("una herramienta se aplica solo si queda tiempo para ella y para que el modelo conteste después", () => {
  const reloj = relojA();
  const plazo = crearPlazo(75_000, reloj.ahora);
  assert.ok(alcanzaParaHerramienta(plazo));
  reloj.pasan(75_000 - HERRAMIENTA_MAXIMA_MS - VUELTA_DEL_MODELO_MS);
  assert.ok(alcanzaParaHerramienta(plazo), "justo");
  reloj.pasan(1);
  assert.ok(!alcanzaParaHerramienta(plazo), "un milisegundo menos y no");
  assert.ok(alcanzaParaVuelta(plazo), "pero todavía cabe una vuelta del modelo");
  reloj.pasan(HERRAMIENTA_MAXIMA_MS);
  assert.ok(!alcanzaParaVuelta(plazo));
});

test("lo que recibe el modelo cuando una herramienta no se aplicó por tiempo empieza por «No pude:» y dice cuál fue", () => {
  const texto = textoHerramientaSinTiempo("ajustar_tamanos");
  assert.match(texto, /^No pude: /);
  assert.ok(texto.includes("ajustar_tamanos") && texto.includes("no se aplicó"));
});

test("el corte del modelo llega con el del navegador y, si no, con el plazo", () => {
  const navegador = new AbortController();
  const plazo = crearPlazo(60_000);
  const corte = corteConPlazo(navegador.signal, plazo);
  assert.ok(!corte.aborted);
  navegador.abort();
  assert.ok(corte.aborted, "«Detener» sigue cortando");
  const vencido = corteConPlazo(new AbortController().signal, crearPlazo(MARGEN_DE_CORTE_MS));
  return new Promise<void>((resolver) => setTimeout(() => { assert.ok(vencido.aborted, "con el plazo agotado se corta la llamada en pie"); resolver(); }, 30));
});

/**
 * El bucle de la ruta, con un reloj a mano y herramientas que tardan lo que se diga: cada vuelta del modelo pide las herramientas de `turnos`; el
 * bucle pregunta al control antes de cada vuelta y de cada herramienta, como `route.ts`.
 */
function correrBucle(turnos: string[][], segundosPorHerramienta: number) {
  const reloj = relojA();
  const control = controlarPlazo(crearPlazo(75_000, reloj.ahora));
  const aplicadas: string[] = [], alModelo: string[] = [], alUsuario: string[] = [];
  let vueltas = 0;
  for (const turno of turnos) {
    if (!control.hayVuelta()) break;
    vueltas += 1;
    reloj.pasan(3_000);
    for (const nombre of turno) {
      if (!control.puedeAplicar()) { alModelo.push(textoHerramientaSinTiempo(nombre)); alUsuario.push(textoPasoSinTiempo(nombre)); continue; }
      aplicadas.push(nombre);
      reloj.pasan(segundosPorHerramienta * 1000);
    }
  }
  return { aplicadas, alModelo, alUsuario, vueltas, estado: control.estado() };
}

test("con herramientas lentas, el bucle deja de aplicar cuando no queda tiempo para ellas y para el cierre, y lo dice", () => {
  const r = correrBucle([["a", "b"], ["c", "d"], ["e"]], 15);
  assert.deepEqual(r.aplicadas, ["a", "b", "c"], "las que cupieron");
  assert.equal(r.alModelo.length, 2, "d y e no se aplicaron");
  assert.ok(r.alModelo.every((t) => t.startsWith("No pude: ")));
  assert.ok(r.estado.herramientaSaltada);
  assert.match(respuestaConPlazo("", r.aplicadas.length, r.estado), /^Hice 3 cambios en la escena\. No pude terminar/);
});

test("lo que ve el usuario de una herramienta saltada no lleva las instrucciones para el modelo", () => {
  const r = correrBucle([["a", "b"], ["c", "d"], ["e"]], 15);
  for (const texto of r.alUsuario) {
    assert.match(texto, /^No pude: /);
    assert.doesNotMatch(texto, /Dile al usuario/);
  }
  assert.ok(r.alModelo.every((t) => t.includes("Dile al usuario")), "el modelo sí recibe qué hacer");
});

test("si todas las herramientas se aplicaron y solo falta la vuelta que las cierra, no se dice «No pude terminar»", () => {
  // Las dos herramientas se aplicaron (había tiempo) y el reloj llega al final antes de la vuelta que las cierra.
  const reloj = relojA();
  const control = controlarPlazo(crearPlazo(75_000, reloj.ahora));
  assert.ok(control.hayVuelta());
  assert.ok(control.puedeAplicar());
  reloj.pasan(70_000);
  assert.ok(!control.hayVuelta(), "no hay tiempo para la vuelta que cierra");
  const estado = control.estado();
  assert.deepEqual(estado, { herramientaSaltada: false, vueltaSaltada: true });
  const respuesta = respuestaConPlazo("", 2, estado);
  assert.equal(respuesta, "Listo: 2 cambios en la escena.");
  assert.ok(!respuesta.includes("No pude"));
  assert.equal(respuestaConPlazo("", 0, estado), "No hice cambios.");
  assert.equal(respuestaConPlazo("Hecho.", 1, estado), "Hecho.");
});

test("con una herramienta saltada la respuesta del modelo se conserva y se le suma el aviso", () => {
  const estado = { herramientaSaltada: true, vueltaSaltada: false };
  assert.equal(respuestaConPlazo("Moví el arco.", 1, estado), `Moví el arco. ${TEXTO_PEDIDO_SIN_TIEMPO}`);
  assert.equal(respuestaConPlazo("", 0, estado), TEXTO_PEDIDO_SIN_TIEMPO);
});

test("un fallo del proveedor justo antes del final no se toma por tiempo agotado: solo el corte del plazo lo es", () => {
  const navegador = new AbortController();
  const corte = corteConPlazo(navegador.signal, crearPlazo(MARGEN_DE_CORTE_MS + 60_000));
  assert.ok(!corteElPlazo(corte, navegador.signal), "sin cortes, aunque quedaran pocos segundos");
  navegador.abort();
  assert.ok(!corteElPlazo(corte, navegador.signal), "el «Detener» del navegador tampoco");
  const plazoAgotado = corteConPlazo(new AbortController().signal, crearPlazo(MARGEN_DE_CORTE_MS));
  return new Promise<void>((resolver) => setTimeout(() => { assert.ok(corteElPlazo(plazoAgotado, new AbortController().signal)); resolver(); }, 30));
});
