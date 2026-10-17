"""Bounded rendering capacity with spare slots reserved for visible requests."""

from threading import Condition
from contextvars import ContextVar
from collections.abc import Callable
import time


class RenderCancelled(Exception):
    """No connected client still needs this render."""


render_cancellation: ContextVar[Callable[[], bool]] = ContextVar(
    "render_cancellation", default=lambda: False,
)


def render_is_cancelled() -> bool:
    return render_cancellation.get()()


def check_render_cancelled() -> None:
    if render_is_cancelled():
        raise RenderCancelled()


class RenderSlots:
    def __init__(self, capacity: int):
        self.capacity = max(1, capacity)
        self.available = self.capacity
        self.waiting = 0
        self.condition = Condition()

    def acquire(
        self, timeout: float | None = None, *, background: bool = False,
        cancelled: Callable[[], bool] = lambda: False,
    ) -> bool:
        with self.condition:
            if cancelled():
                raise RenderCancelled()
            if background:
                # Hidden preloads never queue or take the last foreground slot.
                if self.waiting or self.available <= 1:
                    return False
            else:
                self.waiting += 1
                try:
                    deadline = None if timeout is None else time.monotonic() + timeout
                    while self.available == 0:
                        if cancelled():
                            raise RenderCancelled()
                        remaining = None if deadline is None else deadline - time.monotonic()
                        if remaining is not None and remaining <= 0:
                            return False
                        self.condition.wait(0.05 if remaining is None else min(0.05, remaining))
                    if cancelled():
                        raise RenderCancelled()
                finally:
                    self.waiting -= 1
            self.available -= 1
            return True

    def release(self) -> None:
        with self.condition:
            if self.available >= self.capacity:
                raise ValueError("Render slot released without acquisition")
            self.available += 1
            self.condition.notify_all()
