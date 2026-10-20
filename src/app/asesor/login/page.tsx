import { Suspense } from "react";
import AdvisorLoginError from "./login-error";

export default function AdvisorLoginPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="text-2xl font-semibold">Asesor Happia</h1>
      <p className="mt-2 text-sm text-muted-foreground">Ingresa con tu cuenta de asesor.</p>
      <Suspense fallback={null}><AdvisorLoginError /></Suspense>
      <form action="/api/asesor/login" method="post" className="mt-6 grid gap-4">
        <label className="grid gap-2 text-sm">
          Usuario
          <select name="username" required autoComplete="username" className="rounded-md border bg-background px-3 py-2">
            <option value="user">Asesor</option>
            <option value="admin">Administrador</option>
          </select>
        </label>
        <label className="grid gap-2 text-sm">
          Contraseña
          <input name="password" type="password" required autoComplete="current-password" className="rounded-md border bg-background px-3 py-2" />
        </label>
        <button type="submit" className="rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground">Iniciar sesión</button>
      </form>
    </main>
  );
}
