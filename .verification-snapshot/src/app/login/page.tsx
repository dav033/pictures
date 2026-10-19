import { Suspense } from "react";
import { InterruptorTema } from "@/components/ui/interruptor-tema";
import { LoginForm } from "./LoginForm";

export default function LoginPage() {
  return (
    <main className="relative flex min-h-dvh items-center justify-center bg-fondo px-4">
      <div className="absolute right-3 top-3">
        <InterruptorTema />
      </div>
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
