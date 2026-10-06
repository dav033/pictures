import assert from "node:assert/strict";
import { FluxRevisionTranslationError, traducirRevisionParaFlux } from "../../src/lib/ia/kagutsuchi/revision-flux";

async function main(): Promise<void> {
  let textoEnviado = "";
  const traducida = await traducirRevisionParaFlux(
    "pon más globos Reflex dorados y quita los blancos B2B-20019949",
    async (texto) => {
      textoEnviado = texto;
      return "Add more gold balloons and remove the white ones.";
    },
  );
  assert.equal(textoEnviado, "pon más globos dorados y quita los blancos B2B-20019949");
  assert.equal(traducida, "Add more gold balloons and remove the white ones.");

  await assert.rejects(
    traducirRevisionParaFlux("cambia el arco", async () => { throw new Error("sin conexión"); }),
    FluxRevisionTranslationError,
  );
  await assert.rejects(
    traducirRevisionParaFlux("cambia el arco", async () => undefined),
    FluxRevisionTranslationError,
  );
  console.log("[PASS] revisión FLUX: limpieza previa, traductor simulado y error tipado al fallar");
}

void main();
