import assert from "node:assert/strict";
import { after, test } from "node:test";
import { NextRequest } from "next/server";
import {
  ASESOR_SESSION_COOKIE,
  advisorCookieOptions,
  authenticateAdvisor,
  createAdvisorSessionToken,
  hashAdvisorPassword,
  readAdvisorSessionToken,
  requireAdvisorRole,
} from "@/lib/asesor/auth";
import { POST as login } from "@/app/api/asesor/login/route";
import { GET as voiceStatus } from "@/app/api/voz/transcribir/route";
import { config as proxyConfig, proxy } from "@/proxy";

const envKeys = ["ASESOR_USER_PASSWORD_HASH", "ASESOR_ADMIN_PASSWORD_HASH", "ASESOR_SESSION_SECRET", "APP_PASSWORD", "VOZ_ENABLED", "NODE_ENV"] as const;
const previousEnv = new Map(envKeys.map((key) => [key, process.env[key]]));
const USER_PASSWORD = "test-only-user-passphrase";
const ADMIN_PASSWORD = "test-only-admin-passphrase";

after(() => {
  for (const key of envKeys) {
    const value = previousEnv.get(key);
    if (value === undefined) Reflect.deleteProperty(process.env, key);
    else Reflect.set(process.env, key, value);
  }
});

test("advisor authentication uses scrypt for only user/admin and fails closed without configuration", async () => {
  delete process.env.ASESOR_SESSION_SECRET;
  assert.equal(await authenticateAdvisor("user", USER_PASSWORD), null);

  process.env.ASESOR_SESSION_SECRET = "test-session-secret-that-is-at-least-32-bytes";
  process.env.ASESOR_USER_PASSWORD_HASH = await hashAdvisorPassword(USER_PASSWORD);
  process.env.ASESOR_ADMIN_PASSWORD_HASH = await hashAdvisorPassword(ADMIN_PASSWORD);
  assert.match(process.env.ASESOR_USER_PASSWORD_HASH, /^scrypt\$16384\$8\$1\$/);
  assert.equal(await authenticateAdvisor("user", USER_PASSWORD), "user");
  assert.equal(await authenticateAdvisor("admin", ADMIN_PASSWORD), "admin");
  assert.equal(await authenticateAdvisor("admin", USER_PASSWORD), null);
  assert.equal(await authenticateAdvisor("user", ADMIN_PASSWORD), null);
  assert.equal(await authenticateAdvisor("owner", USER_PASSWORD), null);
  assert.equal(await authenticateAdvisor("user", "wrong-password"), null);
});

test("advisor sessions are signed, expire, reject tampering, and enforce role guards", async () => {
  process.env.ASESOR_SESSION_SECRET = "test-session-secret-that-is-at-least-32-bytes";
  const userToken = createAdvisorSessionToken("user", 1_800_000_000_000);
  const adminToken = createAdvisorSessionToken("admin", 1_800_000_000_000);
  assert.ok(userToken);
  assert.ok(adminToken);
  assert.equal(readAdvisorSessionToken(userToken, 1_800_000_000_000)?.role, "user");
  assert.equal(readAdvisorSessionToken(adminToken, 1_800_000_000_000)?.role, "admin");
  assert.equal(readAdvisorSessionToken(`${userToken}x`, 1_800_000_000_000), null);
  assert.equal(readAdvisorSessionToken(userToken, 2_000_000_000_000), null);

  const unauthenticated = requireAdvisorRole(new Request("https://example.test/api/asesor/clientes"));
  assert.ok(unauthenticated instanceof Response);
  assert.equal(unauthenticated.status, 401);

  const userRequest = new Request("https://example.test/api/asesor/admin", { headers: { cookie: `${ASESOR_SESSION_COOKIE}=${userToken}` } });
  const forbidden = requireAdvisorRole(userRequest, ["admin"]);
  assert.ok(forbidden instanceof Response);
  assert.equal(forbidden.status, 403);
  const userAllowed = requireAdvisorRole(userRequest, ["user", "admin"]);
  assert.ok(!(userAllowed instanceof Response));
  assert.equal(userAllowed.role, "user");

  const adminRequest = new Request("https://example.test/api/asesor/admin", { headers: { cookie: `${ASESOR_SESSION_COOKIE}=${adminToken}` } });
  const adminOnlyAllowed = requireAdvisorRole(adminRequest, ["admin"]);
  const sharedFlowAllowed = requireAdvisorRole(adminRequest, ["user", "admin"]);
  assert.ok(!(adminOnlyAllowed instanceof Response));
  assert.ok(!(sharedFlowAllowed instanceof Response));
  assert.equal(adminOnlyAllowed.role, "admin");
  assert.equal(sharedFlowAllowed.role, "admin");
});

test("advisor login issues HttpOnly/Secure production cookies and rejects invalid credentials", async () => {
  Reflect.set(process.env, "NODE_ENV", "production");
  process.env.ASESOR_SESSION_SECRET = "test-session-secret-that-is-at-least-32-bytes";
  process.env.ASESOR_USER_PASSWORD_HASH = await hashAdvisorPassword(USER_PASSWORD);
  process.env.ASESOR_ADMIN_PASSWORD_HASH = await hashAdvisorPassword(ADMIN_PASSWORD);

  const missing = await login(new Request("https://example.test/api/asesor/login", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://example.test" },
    body: JSON.stringify({ username: "user", password: "wrong" }),
  }));
  assert.equal(missing.status, 401);

  const response = await login(new Request("https://example.test/api/asesor/login", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://example.test" },
    body: JSON.stringify({ username: "admin", password: ADMIN_PASSWORD }),
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, role: "admin" });
  const setCookie = response.headers.get("set-cookie") ?? "";
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /Secure/i);
  assert.match(setCookie, /SameSite=Lax/i);

  const options = advisorCookieOptions();
  assert.equal(options.httpOnly, true);
  assert.equal(options.secure, true);
});

test("proxy exclusions are boundary-exact and voice reaches its existing guard without APP_PASSWORD", async () => {
  const matcher = new RegExp(`^${proxyConfig.matcher[0]}$`);
  for (const [path, expected] of [
    ["/asesor", false],
    ["/asesor/login", false],
    ["/asesor/admin", true],
    ["/asesor/admin/conversation-1", true],
    ["/asesor-extra", true],
    ["/api/asesor", false],
    ["/api/asesor/login", false],
    ["/api/asesor/admin/conversations", true],
    ["/api/asesor-extra", true],
    ["/api/voz/transcribir", false],
    ["/api/voz/transcribir-extra", true],
  ] as const) {
    assert.equal(matcher.test(path), expected, `unexpected proxy matcher result for ${path}`);
  }

  process.env.ASESOR_SESSION_SECRET = "test-session-secret-that-is-at-least-32-bytes";
  const userToken = createAdvisorSessionToken("user");
  assert.ok(userToken);
  const forbiddenPage = proxy(new NextRequest("https://example.test/asesor/admin", {
    headers: { cookie: `${ASESOR_SESSION_COOKIE}=${userToken}` },
  }));
  assert.equal(forbiddenPage.status, 403);

  Reflect.set(process.env, "NODE_ENV", "production");
  delete process.env.APP_PASSWORD;
  process.env.VOZ_ENABLED = "true";
  const response = await voiceStatus(new NextRequest("https://example.test/api/voz/transcribir"));
  assert.equal(response.status, 401, "the voice handler still enforces its existing APP_PASSWORD session check");
});
