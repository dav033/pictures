import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("./ControlesTactiles.tsx", import.meta.url), "utf8");

test("touch controls invoke viewer actions directly without synthetic keyboard events", () => {
  assert.doesNotMatch(source, /KeyboardEvent|dispatchEvent/);
  assert.match(source, /onAccion\("ArrowLeft"/);
  assert.match(source, /onAccion\("Delete"/);
});
