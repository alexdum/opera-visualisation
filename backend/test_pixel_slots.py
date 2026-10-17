"""Admission ordering, overload, cancellation, and capacity regressions."""
from concurrent.futures import ThreadPoolExecutor
from threading import Event
import time

import pytest

from api.pixel_work import PixelBusy, PixelCancelled, PixelSlots


def wait_until(predicate):
    deadline = time.monotonic() + 3
    while not predicate():
        assert time.monotonic() < deadline
        time.sleep(.005)


def test_queue_is_fifo_and_rejects_overflow():
    slots = PixelSlots(1, 2, 2)
    slots.acquire(lambda: False)
    order = []
    def work(name):
        slots.acquire(lambda: False)
        try:
            order.append(name)
        finally:
            slots.release()
    with ThreadPoolExecutor(max_workers=2) as executor:
        first = executor.submit(work, 'first')
        wait_until(lambda: len(slots.queue) == 1)
        second = executor.submit(work, 'second')
        try:
            wait_until(lambda: len(slots.queue) == 2)
            with pytest.raises(PixelBusy):
                slots.acquire(lambda: False)
        finally:
            slots.release()
        first.result(timeout=3)
        second.result(timeout=3)
    assert order == ['first', 'second']
    assert slots.available == 1 and not slots.queue


def test_timed_out_waiter_leaves_queue_without_taking_a_slot():
    slots = PixelSlots(1, 2, .03)
    slots.acquire(lambda: False)
    try:
        with pytest.raises(PixelBusy):
            slots.acquire(lambda: False)
        assert slots.available == 0 and not slots.queue
    finally:
        slots.release()
    slots.acquire(lambda: False)
    slots.release()


def test_cancelled_head_does_not_block_next_waiter():
    slots = PixelSlots(1, 2, 2)
    slots.acquire(lambda: False)
    cancelled, admitted = Event(), Event()
    def next_waiter():
        slots.acquire(lambda: False)
        try:
            admitted.set()
        finally:
            slots.release()
    with ThreadPoolExecutor(max_workers=2) as executor:
        first = executor.submit(slots.acquire, cancelled.is_set)
        wait_until(lambda: len(slots.queue) == 1)
        second = executor.submit(next_waiter)
        try:
            wait_until(lambda: len(slots.queue) == 2)
            cancelled.set()
            with pytest.raises(PixelCancelled):
                first.result(timeout=3)
            assert not admitted.is_set()
        finally:
            slots.release()
        second.result(timeout=3)
    assert admitted.is_set() and slots.available == 1 and not slots.queue


def test_configurable_capacity_and_cancelled_arrival():
    slots = PixelSlots(2, 0, 0)
    with pytest.raises(PixelCancelled):
        slots.acquire(lambda: True)
    slots.acquire(lambda: False)
    slots.acquire(lambda: False)
    with pytest.raises(PixelBusy):
        slots.acquire(lambda: False)
    slots.release()
    slots.release()
    with pytest.raises(ValueError):
        slots.release()
