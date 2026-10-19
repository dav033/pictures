import assert from "node:assert/strict";
import test from "node:test";
import { PERFILES_FABRICA, aplicarPerfilTamano, mezclaDePerfil } from "@/lib/globos3d/perfiles-tamano";
import { AJUSTES_QUINCE_AZUL, aplicarAjustes, ajustesDeOpciones, opcionesDeAjustes } from "./PanelOrganico";

const cono = PERFILES_FABRICA.find((p) => p.id === "cono")!;

test("cambiar el alto de una columna con perfil de tamaño conserva la mezcla del perfil", () => {
  const conPerfil = aplicarPerfilTamano(opcionesDeAjustes(AJUSTES_QUINCE_AZUL), cono);
  const antes = ajustesDeOpciones(conPerfil, true);
  const despues = aplicarAjustes(conPerfil, antes, { ...antes, altoCm: antes.altoCm + 20 });
  assert.deepEqual(despues.tramos[0]!.mezcla, mezclaDePerfil(cono));
  assert.equal(despues.tramos[0]!.recorrido[6]!.y > conPerfil.tramos[0]!.recorrido[6]!.y, true, "la columna sí cambió de alto");
});

test("cambiar el grosor de una columna con perfil también conserva su mezcla", () => {
  const conPerfil = aplicarPerfilTamano(opcionesDeAjustes(AJUSTES_QUINCE_AZUL), cono);
  const antes = ajustesDeOpciones(conPerfil, true);
  const despues = aplicarAjustes(conPerfil, antes, { ...antes, grosor: antes.grosor * 1.1 });
  assert.deepEqual(despues.tramos[0]!.mezcla, mezclaDePerfil(cono));
});

test("una columna sin perfil conserva su mezcla de fábrica al cambiar el alto", () => {
  const base = opcionesDeAjustes(AJUSTES_QUINCE_AZUL);
  const antes = ajustesDeOpciones(base, true);
  const despues = aplicarAjustes(base, antes, { ...antes, altoCm: antes.altoCm + 20 });
  assert.deepEqual(despues.tramos[0]!.mezcla, base.tramos[0]!.mezcla);
});
