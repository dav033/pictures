import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { HappiaClient } from "../src/cliente";

// Bug real de producción: la API de Happia devuelve `description: null` en
// la mayoría de los package_items (no es un caso raro). El schema exigía
// `z.string()`, así que CADA llamada a listarPackages() fallaba con un
// ZodError — y como el catch de los webhooks nunca loguea el error real
// (por diseño, para no filtrar datos de proveedor), esto se veía en
// producción como un 503 genérico sin ninguna pista. Este test fija que un
// `description: null` es válido.

const fetchOriginal = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = fetchOriginal;
});

function paqueteBase(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "pkg-1",
    event_type_id: "evt-1",
    name: "Paquete de prueba",
    base_guests: 10,
    standard_duration_minutes: 120,
    conditions: null,
    restrictions: null,
    is_active: true,
    is_featured: false,
    package_items: [
      {
        id: "item-1",
        total: 1000,
        is_active: true,
        package_id: "pkg-1",
        charge_type: "total",
        description: null,
        suggested_start_time: null,
        provider_name: null,
        category_name: null,
        ...overrides,
      },
    ],
  };
}

function mockFetch(body: unknown, status = 200) {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), { status })) as typeof fetch;
}

test("listarPackages acepta description: null (estado real y normal de la API de Happia)", async () => {
  mockFetch({ packages: [paqueteBase()] });
  const cliente = new HappiaClient({ baseUrl: "https://example.test", apiKey: "x" });
  const { packages } = await cliente.listarPackages();
  assert.equal(packages.length, 1);
  assert.equal(packages[0]?.package_items[0]?.description, null);
});

test("listarPackages sigue rechazando un item_package genuinamente inválido", async () => {
  mockFetch({ packages: [paqueteBase({ id: "" })] }); // id vacío viola z.string().min(1)
  const cliente = new HappiaClient({ baseUrl: "https://example.test", apiKey: "x" });
  await assert.rejects(() => cliente.listarPackages());
});
