import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { HappiaApiError, HappiaClient } from "../src/cliente";

const fetchOriginal = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = fetchOriginal;
});

const cliente = () => new HappiaClient({ baseUrl: "https://example.test/api", apiKey: "secret-key" });

function sobre(data: unknown[], currentPage: number, totalItems: number, limit: number) {
  return { status: "success", data, pagination: { totalItems, totalPages: Math.ceil(totalItems / limit), currentPage } };
}

function paqueteBase(id = "pkg-1", overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id,
    event_type_id: "evt-1",
    name: "Paquete de prueba",
    base_guests: 10,
    standard_duration_minutes: 120,
    conditions: null,
    restrictions: null,
    is_active: true,
    is_featured: false,
    city: "Barranquilla",
    city_slug: "barranquilla",
    package_items: [
      {
        id: `${id}-item`,
        total: 1000,
        is_active: true,
        package_id: id,
        charge_type: "total",
        charge_mode: "event",
        quantity_editable: false,
        sale_unit: null,
        removable: false,
        description: null,
        suggested_start_time: null,
        provider_name: null,
        category_name: null,
        ...overrides,
      },
    ],
  };
}

function servicioBase(id = "srv-1", overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id,
    name: "Animación con show de magia",
    description: null,
    total: 350000,
    charge_type: "total",
    charge_mode: "unit",
    quantity_editable: true,
    sale_unit: { singular: "hora", plural: "horas" },
    has_delivery: false,
    image_url: null,
    image_focus: "50% 50%",
    category_name: "Animación",
    provider_name: "Magia Caribe",
    city: "Barranquilla",
    city_slug: "barranquilla",
    rating: null,
    ...overrides,
  };
}

function mockFetch(responder: (url: URL, init?: RequestInit) => Response) {
  const llamadas: URL[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    llamadas.push(url);
    return responder(url, init);
  }) as typeof fetch;
  return llamadas;
}

// Real production bug: `description: null` is the normal state of package items.
test("listarPackages acepta description: null (estado real y normal de la API de Happia)", async () => {
  mockFetch(() => Response.json(sobre([paqueteBase()], 1, 1, 100)));
  const { packages } = await cliente().listarPackages();
  assert.equal(packages.length, 1);
  assert.equal(packages[0]?.package_items[0]?.description, null);
});

test("un paquete sucio se descarta y el resto del catálogo sigue disponible", async () => {
  const sucio = { ...paqueteBase("dirty"), base_guests: 0 };
  mockFetch(() => Response.json(sobre([sucio, paqueteBase("ok")], 1, 2, 100)));
  const aviso = console.warn;
  const avisos: unknown[][] = [];
  console.warn = (...args: unknown[]) => { avisos.push(args); };
  try {
    const { packages } = await cliente().listarPackages();
    assert.deepEqual(packages.map((p) => p.id), ["ok"]);
  } finally {
    console.warn = aviso;
  }
  assert.equal(avisos.length, 1);
  assert.ok(!JSON.stringify(avisos).includes("Paquete de prueba"), "el aviso no lleva valores del proveedor");
});

test("si TODOS los ítems son inválidos es una ruptura de contrato y falla", async () => {
  mockFetch(() => Response.json(sobre([paqueteBase("pkg-1", { id: "" })], 1, 1, 100)));
  const aviso = console.warn;
  console.warn = () => {};
  try {
    await assert.rejects(() => cliente().listarPackages(), HappiaApiError);
  } finally {
    console.warn = aviso;
  }
});

test("un catálogo que cambia de tamaño mientras se lee se vuelve a leer una vez", async () => {
  let ronda = 0;
  const llamadas = mockFetch((url) => {
    const page = Number(url.searchParams.get("page"));
    if (page === 1) ronda += 1;
    // First pass: page 2 reports a different total (an item was deleted in between). Second pass is stable.
    const totalItems = ronda === 1 && page === 2 ? 3 : 4;
    const ids = page === 1 ? ["a", "b"] : ["c", "d"];
    return Response.json({ status: "success", data: ids.map((id) => paqueteBase(id)), pagination: { totalItems, totalPages: 2, currentPage: page } });
  });
  const { packages } = await cliente().listarPackages();
  assert.deepEqual(packages.map((p) => p.id), ["a", "b", "c", "d"]);
  assert.equal(llamadas.length, 4);
});

test("si el catálogo sigue cambiando tras el reintento, falla en vez de devolver una lectura incompleta", async () => {
  let n = 0;
  mockFetch((url) => Response.json({ status: "success", data: [paqueteBase(`p${url.searchParams.get("page")}-${n}`)], pagination: { totalItems: 2 + (n++ % 2), totalPages: 2, currentPage: Number(url.searchParams.get("page")) } }));
  await assert.rejects(() => cliente().listarPackages(), HappiaApiError);
});

test("listarPackages lee todas las páginas con el limit máximo, sin duplicar ids, y manda la key", async () => {
  const llamadas = mockFetch((url, init) => {
    assert.equal((init?.headers as Record<string, string>)["x-api-key"], "secret-key");
    const page = Number(url.searchParams.get("page"));
    const ids = page === 1 ? ["a", "b"] : ["b", "c"]; // "b" shifts onto page 2 as the catalogue changes
    return Response.json({ status: "success", data: ids.map((id) => paqueteBase(id)), pagination: { totalItems: 3, totalPages: 2, currentPage: page } });
  });
  const { packages } = await cliente().listarPackages();
  assert.deepEqual(packages.map((p) => p.id), ["a", "b", "c"]);
  assert.equal(llamadas.length, 2);
  assert.equal(llamadas[0]?.pathname, "/api/packages");
  assert.equal(llamadas[0]?.searchParams.get("limit"), "100");
});

test("listarPackages corta en la primera página si la API anuncia páginas sin fin", async () => {
  const llamadas = mockFetch((url) => Response.json({ status: "success", data: [paqueteBase(`p${url.searchParams.get("page")}`)], pagination: { totalItems: 9999, totalPages: 9999, currentPage: 1 } }));
  await assert.rejects(() => cliente().listarPackages(), HappiaApiError);
  assert.equal(llamadas.length, 1);
});

test("listarServicios valida los 16 campos y manda city + limit 500", async () => {
  const llamadas = mockFetch(() => Response.json(sobre([servicioBase()], 1, 1, 500)));
  const servicios = await cliente().listarServicios({ city: "barranquilla" });
  assert.equal(servicios[0]?.sale_unit?.plural, "horas");
  assert.equal(llamadas[0]?.searchParams.get("city"), "barranquilla");
  assert.equal(llamadas[0]?.searchParams.get("limit"), "500");
});

test("un servicio sin una de las claves del contrato se rechaza", async () => {
  const incompleto: Record<string, unknown> = servicioBase();
  delete incompleto.rating;
  mockFetch(() => Response.json(sobre([incompleto], 1, 1, 500)));
  await assert.rejects(() => cliente().listarServiciosPagina());
});

test("una página más allá de la última es 200 con data vacía, no un error", async () => {
  mockFetch(() => Response.json({ status: "success", data: [], pagination: { totalItems: 3, totalPages: 1, currentPage: 9 } }));
  const pagina = await cliente().listarServiciosPagina({ page: 9, limit: 5 });
  assert.deepEqual(pagina.items, []);
  assert.equal(pagina.pagination.totalItems, 3);
});

test("page y limit inválidos se rechazan antes de llamar a la red", async () => {
  const llamadas = mockFetch(() => Response.json(sobre([], 1, 0, 50)));
  await assert.rejects(() => cliente().listarServiciosPagina({ limit: 501 }), RangeError);
  await assert.rejects(() => cliente().listarPackagesPagina({ limit: 101 }), RangeError);
  await assert.rejects(() => cliente().listarPackagesPagina({ page: 0 }), RangeError);
  await assert.rejects(() => cliente().listarPackagesPagina({ limit: 1.5 }), RangeError);
  assert.equal(llamadas.length, 0);
});

test("un 401 conserva el status HTTP y el mensaje del sobre, pero no el cuerpo desconocido", async () => {
  mockFetch(() => Response.json({ status: "API key inválida o expirada", data: null, pagination: null }, { status: 401 }));
  await assert.rejects(
    () => cliente().listarServiciosPagina(),
    (error: unknown) => error instanceof HappiaApiError && error.status === 401 && error.message.includes("API key inválida"),
  );
  mockFetch(() => new Response("private upstream html", { status: 503 }));
  await assert.rejects(
    () => cliente().listarServiciosPagina(),
    (error: unknown) => error instanceof HappiaApiError && error.status === 503 && !error.message.includes("private"),
  );
});

test("el formato anterior ({ packages: [...] }) ya no se acepta en silencio", async () => {
  mockFetch(() => Response.json({ packages: [paqueteBase()] }));
  await assert.rejects(() => cliente().listarPackages());
});
