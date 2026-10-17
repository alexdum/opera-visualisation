"""Process-local sharing and byte-bounded decoded data for pixel queries."""

from __future__ import annotations

from collections import OrderedDict
from collections.abc import Callable
from dataclasses import dataclass, field
from threading import Event, RLock
import time
from typing import Any, TypeVar

import numpy as np


class PixelCancelled(Exception):
    """No connected consumer still needs this extraction."""


def check_cancelled(cancelled: Callable[[], bool]) -> None:
    if cancelled():
        raise PixelCancelled()


@dataclass
class _Flight:
    done: Event = field(default_factory=Event)
    consumers: dict[object, Callable[[], bool]] = field(default_factory=dict)
    abandoned: bool = False
    result: Any = None
    error: BaseException | None = None


T = TypeVar("T")


class SharedPixelWork:
    def __init__(self) -> None:
        self.lock = RLock()
        self.flights: dict[tuple[Any, ...], _Flight] = {}

    def _cancelled(self, flight: _Flight) -> bool:
        with self.lock:
            if all(cancelled() for cancelled in flight.consumers.values()):
                flight.abandoned = True
            return flight.abandoned

    def run(
        self, key: tuple[Any, ...], work: Callable[[Callable[[], bool]], T],
        cancelled: Callable[[], bool],
    ) -> T:
        check_cancelled(cancelled)
        consumer = object()
        with self.lock:
            flight = self.flights.get(key)
            owner = flight is None or flight.abandoned
            if owner:
                flight = _Flight()
                self.flights[key] = flight
            flight.consumers[consumer] = cancelled
        try:
            if owner:
                try:
                    flight.result = work(lambda: self._cancelled(flight))
                except BaseException as exc:
                    flight.error = exc
                finally:
                    with self.lock:
                        # An abandoned flight may already have a replacement.
                        if self.flights.get(key) is flight:
                            del self.flights[key]
                        flight.done.set()
            else:
                while not flight.done.wait(0.05):
                    check_cancelled(cancelled)
            check_cancelled(cancelled)
            if flight.error is not None:
                raise flight.error
            return flight.result
        finally:
            with self.lock:
                flight.consumers.pop(consumer, None)


class PixelBlockCache:
    """LRU of immutable arrays; bound payload bytes, entry count, and lifetime."""

    def __init__(self, max_bytes: int, max_entries: int, seconds: float) -> None:
        self.max_bytes = max_bytes
        self.max_entries = max_entries
        self.seconds = seconds
        self.lock = RLock()
        self.entries: OrderedDict[tuple[Any, ...], tuple[float, np.ndarray]] = OrderedDict()
        self.nbytes = 0

    @property
    def enabled(self) -> bool:
        return self.max_bytes > 0 and self.max_entries > 0 and self.seconds > 0

    def get(self, key: tuple[Any, ...]) -> np.ndarray | None:
        with self.lock:
            entry = self.entries.get(key)
            if entry is None:
                return None
            expires, data = entry
            if expires <= time.monotonic() or not self.enabled:
                self.nbytes -= data.nbytes
                del self.entries[key]
                return None
            self.entries.move_to_end(key)
            return data

    def put(self, key: tuple[Any, ...], data: np.ndarray) -> None:
        if not self.enabled or data.nbytes > self.max_bytes:
            return
        # Own the allocation: caching a slice must not retain a larger parent.
        data = np.array(data, copy=True, order="C")
        data.flags.writeable = False
        with self.lock:
            previous = self.entries.pop(key, None)
            if previous is not None:
                self.nbytes -= previous[1].nbytes
            while self.entries and (
                self.nbytes + data.nbytes > self.max_bytes or
                len(self.entries) >= self.max_entries
            ):
                _, (_, evicted) = self.entries.popitem(last=False)
                self.nbytes -= evicted.nbytes
            self.entries[key] = (time.monotonic() + self.seconds, data)
            self.nbytes += data.nbytes

    def clear(self) -> None:
        with self.lock:
            self.entries.clear()
            self.nbytes = 0
