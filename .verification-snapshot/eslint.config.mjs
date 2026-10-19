import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Salida compilada de los workspaces — no es código fuente.
    "packages/*/dist/**",
    // Entorno virtual Python generado localmente; lo cubren Ruff y mypy.
    "services/ai-api/.venv/**",
    // Herramientas de evaluación (juez, trazadores): scripts que se ejecutan con tsx, no código de la app.
    "evaluacion/**",
    // Worktrees temporales (los que crea un agente viven aqui dentro): son
    // copias del repo, no codigo fuente de este arbol. Sin esto, el lint
    // recorre cada copia y un arbol con cuatro worktrees pasa de 25 avisos
    // a 685 problemas ajenos (2026-09-29).
    ".claude/worktrees/**",
  ]),
]);

export default eslintConfig;
