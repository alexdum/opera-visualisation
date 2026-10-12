from concurrent.futures import ThreadPoolExecutor
import threading

import pytest

from api.render_slots import RenderSlots


def test_preloads_leave_capacity_for_visible_frames():
    slots = RenderSlots(2)
    assert slots.acquire(background=True)
    assert not slots.acquire(background=True)
    assert slots.acquire(timeout=0)
    assert not slots.acquire(timeout=0)
    slots.release()
    slots.release()
    assert slots.acquire(background=True)
    slots.release()


def test_single_worker_accepts_visible_frames_but_skips_preloads():
    slots = RenderSlots(1)
    assert not slots.acquire(background=True)
    assert slots.acquire(timeout=0)
    slots.release()
    with pytest.raises(ValueError):
        slots.release()


def test_background_requests_cannot_overtake_a_waiting_visible_frame():
    slots = RenderSlots(2)
    assert slots.acquire(timeout=0)
    assert slots.acquire(timeout=0)
    acquired = threading.Event()
    release = threading.Event()

    def visible_request():
        assert slots.acquire(timeout=2)
        acquired.set()
        assert release.wait(2)
        slots.release()

    with ThreadPoolExecutor(max_workers=1) as executor:
        pending = executor.submit(visible_request)
        slots.release()
        assert acquired.wait(2)
        assert not slots.acquire(background=True)
        release.set()
        pending.result()
    slots.release()
