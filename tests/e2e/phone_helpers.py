"""Shared by the phone-app browser tests (test_phone_app.py, test_phone_offline.py): an iPhone context and a finger.

A `Finger` sends real touch input through the DevTools protocol (Input.dispatchTouchEvent), so the page sees touchstart / touchmove /
touchend and pointer events with timestamps, the way a phone sends them. The pauses between moves are the point of the test (a flick is
fast, a drag is slow, a long press is a held finger), so they are real `wait_for_timeout`s, not stand-ins for waiting on a condition.
"""
from __future__ import annotations

IPHONE = "iPhone 14"   # 390 x 844 CSS px, 3x, touch, mobile UA
IOS_UA = ("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1")


def iphone_args(width: int = 390, height: int = 844) -> dict:
    """new_context() options for an iPhone 14 running the installed app: 390 x 844, 3x, touch, a Safari user agent."""
    return {"viewport": {"width": width, "height": height}, "screen": {"width": width, "height": 844}, "device_scale_factor": 3,
            "is_mobile": True, "has_touch": True, "user_agent": IOS_UA}


class Finger:
    def __init__(self, page) -> None:
        self.page = page
        self.cdp = page.context.new_cdp_session(page)

    def _send(self, kind: str, x: float | None = None, y: float | None = None) -> None:
        pts = [] if x is None else [{"x": x, "y": y, "id": 1, "radiusX": 4, "radiusY": 4, "force": 1}]
        self.cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": pts})

    def down(self, x: float, y: float) -> None:
        self._send("touchStart", x, y)

    def move(self, x: float, y: float) -> None:
        self._send("touchMove", x, y)

    def up(self) -> None:
        self._send("touchEnd")

    def cancel(self) -> None:
        self._send("touchCancel")

    def drag(self, x0: float, y0: float, x1: float, y1: float, steps: int = 10, step_ms: int = 14, hold_end_ms: int = 0) -> None:
        """Press at (x0, y0), move to (x1, y1) in `steps` moves `step_ms` apart, optionally rest there, lift."""
        self.down(x0, y0)
        self.page.wait_for_timeout(step_ms)
        for i in range(1, steps + 1):
            self.move(x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps)
            self.page.wait_for_timeout(step_ms)
        if hold_end_ms:
            self.page.wait_for_timeout(hold_end_ms)
        self.up()

    def flick(self, x0: float, y0: float, x1: float, y1: float) -> None:
        """A quick swipe: few, closely spaced moves and a lift while still moving."""
        self.drag(x0, y0, x1, y1, steps=5, step_ms=0)

    def hold(self, x: float, y: float, ms: int) -> None:
        self.down(x, y)
        self.page.wait_for_timeout(ms)

    def tap(self, x: float, y: float) -> None:
        self.down(x, y)
        self.page.wait_for_timeout(40)
        self.up()


def center(page, selector: str) -> tuple[float, float]:
    b = page.locator(selector).first.bounding_box()
    assert b, f"{selector} is not on screen"
    return b["x"] + b["width"] / 2, b["y"] + b["height"] / 2


def rect(page, selector: str) -> dict:
    return page.evaluate("(s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, top: r.top, bottom: r.bottom, left: r.left, right: r.right }; }", selector)
