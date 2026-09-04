"use client";

import { useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(
    searchParams.get("error") === "1" ? "Contraseña incorrecta." : null,
  );
  const [cargando, setCargando] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setCargando(true);

    const formData = new FormData(event.currentTarget);
    const password = String(formData.get("password") || "");

    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });

    setCargando(false);

    if (!res.ok) {
      setError("Contraseña incorrecta.");
      return;
    }

    router.replace(searchParams.get("from") || "/");
    router.refresh();
  }

  return (
    <form
      onSubmit={onSubmit}
      action="/api/login"
      method="post"
      className="w-full max-w-sm space-y-4 rounded-lg border border-neutral-200 bg-white p-6 shadow-sm"
    >
      <h1 className="text-lg font-semibold text-neutral-900">Iniciar sesión</h1>
      <input type="hidden" name="from" value={searchParams.get("from") || "/"} />
      <input
        name="password"
        type="password"
        autoFocus
        autoComplete="current-password"
        placeholder="Contraseña"
        className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={cargando}
        className="w-full rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {cargando ? "Ingresando…" : "Entrar"}
      </button>
    </form>
  );
}
