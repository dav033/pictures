import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

for (const archivo of [".env.local", ".env"]) {
  if (existsSync(archivo)) process.loadEnvFile(archivo);
}

// Keep the existing npm command as the operator-facing entry point while
// moving the provider, database writes and retry policy into Python.
const result = spawnSync(
  "uv",
  [
    "run",
    "--project",
    "services/ai-api",
    "--no-dev",
    "python",
    "services/ai-api/scripts/embed_catalog.py",
    ...process.argv.slice(2),
  ],
  { cwd: process.cwd(), env: process.env, stdio: "inherit" },
);

if (result.error) {
  console.error(`[FAIL] no se pudo ejecutar uv: ${result.error.message}`);
  process.exitCode = 1;
} else {
  process.exitCode = result.status ?? 1;
}
