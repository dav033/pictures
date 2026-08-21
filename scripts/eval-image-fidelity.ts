import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

type Fixture = { id: string; required_elements?: string[]; forbidden_elements?: string[] };
const root = process.argv[2] ? path.resolve(process.argv[2]) : path.join(process.cwd(), "fixtures", "image-fidelity");
async function main() {
  let fixtures: Fixture[] = [];
  try {
    const files = (await readdir(root)).filter((file) => file.endsWith(".json"));
    fixtures = await Promise.all(files.map(async (file) => JSON.parse(await readFile(path.join(root, file), "utf8")) as Fixture));
  } catch {
    // Private rights-cleared fixtures stay outside the repository.
  }
  const report = { fixture_count: fixtures.length, baseline: fixtures.map((fixture) => ({ id: fixture.id, required_count: fixture.required_elements?.length ?? 0, forbidden_count: fixture.forbidden_elements?.length ?? 0 })), note: "Run provider-specific visual evaluation with private rights-cleared images; do not commit customer photos or base64 payloads." };
  console.log(JSON.stringify(report, null, 2));
}

void main();
