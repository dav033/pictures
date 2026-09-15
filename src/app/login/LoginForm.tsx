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
      className="ui-card w-full max-w-sm space-y-4 p-6"
    >
      <h1 className="text-lg font-semibold text-texto">Iniciar sesión</h1>
      <input type="hidden" name="from" value={searchParams.get("from") || "/"} />
      <label htmlFor="login-password" className="sr-only">
        Contraseña
      </label>
      <input
        id="login-password"
        name="password"
        type="password"
        autoFocus
        autoComplete="current-password"
        placeholder="Contraseña"
        className="ui-input"
      />
      {error && <p role="alert" className="text-sm text-error">{error}</p>}
      <button
        type="submit"
        disabled={cargando}
        className="ui-button-primary w-full"
      >
        {cargando ? "Ingresando…" : "Entrar"}
      </button>
    </form>
  );
}
