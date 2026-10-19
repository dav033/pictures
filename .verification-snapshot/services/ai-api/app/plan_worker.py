"""The plan's synchronous CPU work runs off the event loop, one task at a time.

Expanding color patterns, resolving lines and validating the results against
the contract is pure Python CPU work (ADR-0028 §10). Done inside an
``async def`` it blocks the one event loop of ai-api (chat streaming, images,
nonces) and ``asyncio.wait_for`` cannot interrupt it. It goes to this
executor instead: the loop keeps serving while it runs, and a single thread
bounds the concurrency (under the GIL more threads would not compute any
faster and would take more turns from the loop). Waiting work sits in the
executor's queue, not in a thread; when its deadline passes before it starts,
the cancellation removes it without spending any CPU. Work that already
started runs to the end and its result is discarded.
"""

from __future__ import annotations

import asyncio
import contextvars
import functools
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from typing import ParamSpec, TypeVar

P = ParamSpec("P")
T = TypeVar("T")

#: One worker: see the module docstring.
PLAN_CPU_WORKERS = 1
_EXECUTOR = ThreadPoolExecutor(max_workers=PLAN_CPU_WORKERS, thread_name_prefix="plan-cpu")


async def run_plan_cpu(function: Callable[P, T], *args: P.args, **kwargs: P.kwargs) -> T:
    """``function(*args, **kwargs)`` in the plan's worker, with the caller's context vars."""
    loop = asyncio.get_running_loop()
    context = contextvars.copy_context()
    call = functools.partial(context.run, function, *args, **kwargs)
    return await loop.run_in_executor(_EXECUTOR, call)


__all__ = ["PLAN_CPU_WORKERS", "run_plan_cpu"]
