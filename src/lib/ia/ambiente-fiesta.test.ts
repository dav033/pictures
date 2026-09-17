import assert from "node:assert/strict";
import test from "node:test";
import { ambienteDeFiesta, MAX_PROPS_AMBIENTE, nivelAmbienteDe, requiereAvisoNoCotizado } from "./ambiente-fiesta";

test("por defecto no se añade nada: el ambiente es opt-in", () => {
  const ambiente = ambienteDeFiesta("ninguno");
  assert.deepEqual(ambiente.props, []);
  assert.equal(ambiente.instruccion, "");
  assert.equal(ambiente.aviso, "");
});

test("un nivel desconocido no enciende el ambiente", () => {
  // Incluye lo que un cliente malicioso o un modelo podrian mandar.
  for (const valor of [undefined, null, "", "si", "true", 1, {}, ["completo"], "COMPLETO"]) {
    assert.equal(nivelAmbienteDe(valor), "ninguno", `${JSON.stringify(valor)} no debe encender nada`);
  }
  assert.equal(nivelAmbienteDe("minimo"), "minimo");
  assert.equal(nivelAmbienteDe("completo"), "completo");
});

test("el vocabulario es cerrado y acotado", () => {
  for (const nivel of ["minimo", "completo"] as const) {
    const ambiente = ambienteDeFiesta(nivel);
    assert.ok(ambiente.props.length > 0);
    assert.ok(ambiente.props.length <= MAX_PROPS_AMBIENTE, `${nivel} excede el techo`);
    assert.equal(new Set(ambiente.props).size, ambiente.props.length, "props duplicadas");
  }
});

test("la instruccion prohibe salirse de la lista", () => {
  const ambiente = ambienteDeFiesta("completo");
  for (const prop of ambiente.props) assert.ok(ambiente.instruccion.includes(prop), `falta ${prop}`);
  assert.match(ambiente.instruccion, /never add anything not in that list/i);
  // Nada que pueda confundirse con lo que se cobra.
  assert.match(ambiente.instruccion, /never add food, people, signage or additional balloon work/i);
});

test("ningun prop es una estructura de globos", () => {
  // La regresion que importa: si el ambiente pudiera dibujar globos, la imagen
  // mezclaria lo cotizado con lo que no y el aviso dejaria de ser suficiente.
  for (const nivel of ["minimo", "completo"] as const) {
    for (const prop of ambienteDeFiesta(nivel).props) {
      assert.doesNotMatch(prop, /balloon|arch|garland|column|globo|arco/i, `prop sospechosa: ${prop}`);
    }
  }
});

test("con props hay aviso de no cotizado", () => {
  assert.equal(requiereAvisoNoCotizado(ambienteDeFiesta("minimo"), []), true);
  assert.match(ambienteDeFiesta("minimo").aviso, /no están incluidos en la cotización/);
});

test("la escenografia de la foto del cliente tambien exige el aviso", () => {
  // Tampoco se la vendemos aunque estuviera en su foto.
  assert.equal(requiereAvisoNoCotizado(ambienteDeFiesta("ninguno"), [{ name: "mesa" }]), true);
});

test("sin props ni escenografia no hay aviso que dar", () => {
  assert.equal(requiereAvisoNoCotizado(ambienteDeFiesta("ninguno"), []), false);
});
