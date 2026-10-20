import { randomBytes } from "node:crypto";
import { open, unlink } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { hashAdvisorPassword } from "../src/lib/asesor/auth";

async function writePrivateFile(filePath: string, contents: string): Promise<void> {
  let created = false;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(filePath, "wx", 0o600);
    created = true;
    await handle.writeFile(contents, "utf8");
  } catch (error) {
    if (created) await unlink(filePath);
    throw error;
  } finally {
    await handle?.close();
  }
}

export async function seedAdvisorCredentials(directory = process.cwd()) {
  const credentialsPath = path.join(directory, ".asesor-credentials.txt");
  const hashesPath = path.join(directory, ".asesor-password-hashes.env");
  const passwords = { user: randomBytes(24).toString("base64url"), admin: randomBytes(24).toString("base64url") };
  const [userHash, adminHash] = await Promise.all([
    hashAdvisorPassword(passwords.user),
    hashAdvisorPassword(passwords.admin),
  ]);
  const secret = randomBytes(32).toString("base64url");
  const credentials = `Asesor Happia credentials\nuser=${passwords.user}\nadmin=${passwords.admin}\n`;
  const hashes = `ASESOR_USER_PASSWORD_HASH=${userHash}\nASESOR_ADMIN_PASSWORD_HASH=${adminHash}\nASESOR_SESSION_SECRET=${secret}\n`;

  await writePrivateFile(credentialsPath, credentials);
  try {
    await writePrivateFile(hashesPath, hashes);
  } catch (error) {
    await unlink(credentialsPath);
    throw error;
  }
  return { credentialsPath, hashesPath };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  seedAdvisorCredentials().then(({ credentialsPath, hashesPath }) => {
    console.log(`Credenciales generadas en ${credentialsPath}`);
    console.log(`Hashes y secreto de sesión generados en ${hashesPath}`);
    console.log("Guarda ambos archivos fuera del repositorio; no se muestran las contraseñas en la terminal.");
  }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "No se pudieron generar las credenciales.");
    process.exitCode = 1;
  });
}
