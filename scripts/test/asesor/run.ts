// Deterministic advisor suites (no database needed). The DB integration suite is `npm run asesor:test:integration`.
import { spawnSync } from "node:child_process";

const SUITES = ["scripts/test/asesor/auth.test.ts", "scripts/test/asesor/db.test.ts", "scripts/test/asesor/agent.test.ts"];
const result = spawnSync("npx", ["tsx", "--conditions=react-server", "--test", ...SUITES], { stdio: "inherit" });
process.exitCode = result.status ?? 1;
