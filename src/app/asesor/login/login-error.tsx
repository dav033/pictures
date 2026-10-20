"use client";

import { useSearchParams } from "next/navigation";

export default function AdvisorLoginError() {
  const searchParams = useSearchParams();
  return searchParams.get("error") === "1"
    ? <p role="alert" className="mt-4 text-sm text-red-600">Usuario o contraseña incorrectos.</p>
    : null;
}
