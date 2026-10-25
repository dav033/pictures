// Deterministic advisor suites (no database needed). The DB integration suite is `npm run asesor:test:integration`.
import { spawnSync } from "node:child_process";

const SUITES = ["scripts/test/asesor/auth.test.ts", "scripts/test/asesor/voice.test.ts", "scripts/test/asesor/voice-notes.test.ts", "scripts/test/asesor/chat-ui.test.ts", "scripts/test/asesor/db.test.ts", "scripts/test/asesor/catalogue.test.ts", "scripts/test/asesor/directions.test.ts", "scripts/test/asesor/packages.test.ts", "scripts/test/asesor/prompt.test.ts", "scripts/test/asesor/agent.test.ts", "scripts/test/asesor/brief.test.ts", "scripts/test/asesor/admin.test.ts"];
SUITES.push("scripts/test/asesor/summary-flow.test.ts", "scripts/test/asesor/brief-flow.test.ts", "scripts/test/asesor/deployed.test.ts", "scripts/test/asesor/deployment-version.test.ts", "scripts/test/asesor/evaluation-remediation.test.ts", "scripts/test/asesor/release-bundle.test.ts");
const result = spawnSync("npx", ["tsx", "--conditions=react-server", "--test", ...SUITES], { stdio: "inherit" });
process.exitCode = result.status ?? 1;
