import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import {
  contieneIdentidadSensible,
  OrderDataSourceSchema,
  ProductsCatalogSourceSchema,
  summarizeSource,
} from "../../src/lib/rag/sources/contracts";

const fixturePath = new URL("./", import.meta.url);

async function readFixture(name: string): Promise<unknown> {
  return JSON.parse(await readFile(new URL(name, fixturePath), "utf8")) as unknown;
}

describe("source contracts", () => {
  it("accepts synthetic CDN product fixture and reports safe counts", async () => {
    const parsed = ProductsCatalogSourceSchema.parse(await readFixture("products_catalog.fixture.json"));
    assert.equal(parsed.length, 2);
    assert.deepEqual(summarizeSource("products_catalog", parsed), {
      products: 2,
      variants: 2,
      activeProducts: 1,
      draftProducts: 1,
      nonPositivePriceVariants: 1,
    });
  });

  it("accepts order fixture without a customer identity", async () => {
    const parsed = OrderDataSourceSchema.parse(await readFixture("order_data.fixture.json"));
    assert.deepEqual(summarizeSource("order_data", parsed), { orders: 1, lineItems: 1, uniqueOrderSkus: 1 });
    assert.equal(contieneIdentidadSensible({ counts: summarizeSource("order_data", parsed) }), false);
  });

  it("does not allow a REST-shaped product to masquerade as CDN input", () => {
    const result = ProductsCatalogSourceSchema.safeParse([{ id: "fixture", title: "fixture", handle: "fixture", variants: [] }]);
    assert.equal(result.success, false);
  });

  it("detects sensitive identity keys in persistible objects", () => {
    assert.equal(contieneIdentidadSensible({ customer_id: "redacted" }), true);
    assert.equal(contieneIdentidadSensible({ sha256: "hash", counts: { products: 2 } }), false);
  });
});
