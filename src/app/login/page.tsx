import { Suspense } from "react";
import { LoginForm } from "./LoginForm";

export default function LoginPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-neutral-50 px-4">
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
