"use client";

import { Moon, Sun } from "lucide-react";
import { siguienteTema } from "@/lib/tema/tema";
import { useTema } from "@/lib/tema/use-tema";

/**
 * Sun/moon switch for the header. Without a choice the app follows the
 * system; the first click stores the opposite of what is painted now.
 */
export function InterruptorTema({ className = "" }: { className?: string }) {
  const { tema, cambiar } = useTema();
  const oscuro = tema === "dark";
  const etiqueta = oscuro ? "Usar tema claro" : "Usar tema oscuro";
  return (
    <button
      type="button"
      onClick={() => cambiar(siguienteTema(tema))}
      aria-label={etiqueta}
      title={etiqueta}
      data-testid="interruptor-tema"
      className={`ui-icon-button ${className}`}
    >
      {/* Both icons live in the DOM; CSS shows the right one before hydration too. */}
      <Sun className="tema-icono-sol size-4" aria-hidden="true" />
      <Moon className="tema-icono-luna size-4" aria-hidden="true" />
    </button>
  );
}
