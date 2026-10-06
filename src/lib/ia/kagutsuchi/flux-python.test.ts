import assert from "node:assert/strict";
import test from "node:test";
import { PythonAdapterError, type PythonAdapterErrorCode } from "@/lib/ia/nucleo/python-adapter";
import { errorDeAdaptadorFlux, ProveedorImagenNoDisponibleError } from "./flux";

const REQUEST_ID = "00000000-0000-4000-8000-000000000001";
const CORRELATION_ID = "00000000-0000-4000-8000-000000000002";

function adapterError(input: {
  code?: PythonAdapterErrorCode;
  domainCode?: string;
  providerStatus?: number;
  providerDetail?: string;
}): PythonAdapterError {
  return new PythonAdapterError({
    code: input.code ?? "PYTHON_INVALID_REQUEST",
    status: 502,
    requestId: REQUEST_ID,
    correlationId: CORRELATION_ID,
    domainCode: input.domainCode,
    providerStatus: input.providerStatus,
    providerDetail: input.providerDetail,
  });
}

test("errorDeAdaptadorFlux rebuilds ProveedorImagenNoDisponibleError for saldo_agotado, with fal.ai's real status", () => {
  const error = errorDeAdaptadorFlux(adapterError({
    domainCode: "flux_account_saldo_agotado",
    providerStatus: 402,
    providerDetail: "insufficient balance",
  }));

  assert.ok(error instanceof ProveedorImagenNoDisponibleError);
  assert.equal(error.status, 402);
  assert.equal(error.causa, "saldo_agotado");
  assert.match(error.message, /insufficient balance/);
});

test("errorDeAdaptadorFlux rebuilds ProveedorImagenNoDisponibleError for acceso_denegado", () => {
  const error = errorDeAdaptadorFlux(adapterError({
    domainCode: "flux_account_acceso_denegado",
    providerStatus: 401,
    providerDetail: "invalid api key",
  }));

  assert.ok(error instanceof ProveedorImagenNoDisponibleError);
  assert.equal(error.status, 401);
  assert.equal(error.causa, "acceso_denegado");
});

test("errorDeAdaptadorFlux falls back to the causa-implied status when providerStatus is missing", () => {
  const saldo = errorDeAdaptadorFlux(adapterError({ domainCode: "flux_account_saldo_agotado" }));
  const acceso = errorDeAdaptadorFlux(adapterError({ domainCode: "flux_account_acceso_denegado" }));

  assert.ok(saldo instanceof ProveedorImagenNoDisponibleError);
  assert.equal(saldo.status, 402);
  assert.ok(acceso instanceof ProveedorImagenNoDisponibleError);
  assert.equal(acceso.status, 403);
});

test("errorDeAdaptadorFlux returns a plain Error (not ProveedorImagenNoDisponibleError) for every other domain code", () => {
  for (const domainCode of ["flux_timeout", "flux_generation_failed", "flux_invalid_image_response", undefined]) {
    const error = errorDeAdaptadorFlux(adapterError({ domainCode }));
    assert.equal(error instanceof ProveedorImagenNoDisponibleError, false);
    assert.ok(error instanceof Error);
  }
});

test("errorDeAdaptadorFlux leaves a plain Error untouched", () => {
  const original = new Error("algo se rompió");
  assert.equal(errorDeAdaptadorFlux(original), original);
});

test("errorDeAdaptadorFlux wraps a non-Error throw", () => {
  const error = errorDeAdaptadorFlux("boom");
  assert.ok(error instanceof Error);
  assert.equal(error instanceof ProveedorImagenNoDisponibleError, false);
});
