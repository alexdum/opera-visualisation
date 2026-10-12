"""Bounded rendering capacity with spare slots reserved for visible requests."""

from threading import Condition


class RenderSlots:
    def __init__(self, capacity: int):
        self.capacity = max(1, capacity)
        self.available = self.capacity
        self.waiting = 0
        self.condition = Condition()

    def acquire(self, timeout: float | None = None, *, background: bool = False) -> bool:
        with self.condition:
            if background:
                # Hidden preloads never queue or take the last foreground slot.
                if self.waiting or self.available <= 1:
                    return False
            else:
                self.waiting += 1
                try:
                    if not self.condition.wait_for(lambda: self.available > 0, timeout):
                        return False
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
