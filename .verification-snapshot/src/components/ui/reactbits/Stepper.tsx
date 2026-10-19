"use client";

import { useReducedMotionPreference } from "./useReducedMotionPreference";

export type StepperStep = {
  id: string;
  label: string;
  completed: boolean;
};

type StepperProps = {
  steps: readonly StepperStep[];
  onToggle: (id: string) => void;
  label?: string;
};

/** A compact, accessible stepper that keeps the assistant's independently checkable steps. */
export function Stepper({ steps, onToggle, label = "Pasos de armado" }: StepperProps) {
  const prefersReducedMotion = useReducedMotionPreference();
  const completed = steps.filter((step) => step.completed).length;

  return (
    <div>
      <div className="mt-4 flex items-center gap-3">
        <div
          className="h-1.5 flex-1 overflow-hidden rounded-full bg-superficie-2"
          role="progressbar"
          aria-label="Pasos terminados"
          aria-valuemin={0}
          aria-valuemax={steps.length}
          aria-valuenow={completed}
        >
          <div
            className={`h-full origin-left rounded-full bg-exito ${prefersReducedMotion ? "" : "transition-transform duration-300"}`}
            style={{ transform: `scaleX(${steps.length ? completed / steps.length : 0})` }}
          />
        </div>
        <span className="shrink-0 text-xs tabular-nums text-texto-suave">{completed} de {steps.length}</span>
      </div>
      <ol className="mt-3 space-y-1" aria-label={label}>
        {steps.map((step, index) => (
          <li key={step.id}>
            <button
              type="button"
              role="checkbox"
              aria-checked={step.completed}
              onClick={() => onToggle(step.id)}
              className={`flex min-h-11 w-full items-start gap-3 rounded-xl px-1 py-2 text-left ${prefersReducedMotion ? "" : "transition-colors"} hover:bg-superficie-suave focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/50`}
            >
              <span
                className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border-2 text-xs font-semibold ${step.completed ? "border-exito bg-exito text-fondo" : "border-borde text-texto-suave"}`}
                aria-hidden="true"
              >
                {step.completed ? "✓" : index + 1}
              </span>
              <span className={`text-sm leading-6 ${step.completed ? "text-texto-suave line-through" : "text-texto"}`}>
                <span className="sr-only">Paso {index + 1}: </span>{step.label}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
