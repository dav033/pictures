"""Run services/ai-api locally and restart it whenever its code changes.

`uvicorn --reload` is how AGENTS.md says to run the service, so it never
serves a stale `plan.py`. On Windows, when uvicorn is started without a
console (a background shell, an IDE task, an agent), its reloader logs
"Reloading..." but the old worker keeps answering with the old code; on
2026-09-24 that hid two fixes for an hour. This supervisor runs uvicorn
without --reload and hard-restarts it (the whole process tree) when any
`.py` under `services/ai-api/app` changes, which works with or without a
console.

Usage, from the repository root:

    python scripts/ops/supervisar-ai-api.py            # port 8000
    python scripts/ops/supervisar-ai-api.py --port 8010

It only reads file modification times and starts/stops its own child; stop
it with Ctrl+C (or by ending its process).
"""

from __future__ import annotations

import argparse
import signal
import subprocess
import sys
import time
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
AI_API = RAIZ / "services" / "ai-api"


def firma(carpeta: Path) -> dict[str, float]:
    """Modification time of every Python file under ``carpeta``."""
    return {str(ruta): ruta.stat().st_mtime for ruta in carpeta.rglob("*.py")}


def comando(puerto: int) -> list[str]:
    return [
        "uv", "run", "--system-certs", "--env-file", "../../.env.local",
        "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(puerto),
    ]


def detener(proceso: subprocess.Popen[bytes]) -> None:
    """End the child and everything it started (`uv run` spawns uvicorn)."""
    if proceso.poll() is not None:
        return
    if sys.platform == "win32":
        subprocess.run(["taskkill", "/PID", str(proceso.pid), "/T", "/F"], capture_output=True, check=False)
    else:
        proceso.send_signal(signal.SIGTERM)
    try:
        proceso.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proceso.kill()
        proceso.wait(timeout=10)


def supervisar(puerto: int, intervalo: float) -> None:
    app = AI_API / "app"
    while True:
        antes = firma(app)
        print(f"[supervisor] ai-api en el puerto {puerto} ({len(antes)} archivos vigilados)", flush=True)
        proceso = subprocess.Popen(comando(puerto), cwd=AI_API)
        try:
            while proceso.poll() is None:
                time.sleep(intervalo)
                ahora = firma(app)
                if ahora != antes:
                    cambiados = sorted(k for k in ahora.keys() | antes.keys() if ahora.get(k) != antes.get(k))
                    nombres = [str(Path(ruta).relative_to(AI_API)) for ruta in cambiados[:5]]
                    print(f"[supervisor] cambió {nombres}: reinicio", flush=True)
                    detener(proceso)
                    break
            else:
                print(f"[supervisor] ai-api terminó con código {proceso.returncode}; reinicio en 3 s", flush=True)
                time.sleep(3)
        except KeyboardInterrupt:
            detener(proceso)
            return


def main() -> None:
    argumentos = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    argumentos.add_argument("--port", type=int, default=8000)
    argumentos.add_argument("--intervalo", type=float, default=1.0, help="segundos entre revisiones")
    opciones = argumentos.parse_args()
    supervisar(opciones.port, opciones.intervalo)


if __name__ == "__main__":
    main()
