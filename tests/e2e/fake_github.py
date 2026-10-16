"""A stand-in for api.github.com's gist endpoints, answered through Playwright routing. The browser tests never reach the real API: every
request to api.github.com is fulfilled here, from memory, and every other foreign request is aborted by conftest.block_foreign.

It implements what js/sync/gist-client.js calls: GET /user, GET /gists, POST /gists, GET /gists/<id> (with ETag and 304), PATCH /gists/<id>
(set and delete files). Tokens are checked like GitHub checks them (Authorization: Bearer ...; 401 otherwise). Failures can be queued per
method, and `log` keeps every request so a test can assert on what was sent where (and that the token never appears in a URL or a body).

Playwright's sync API runs route handlers only while the test is inside one of its calls, so tests wait with page.wait_for_function /
conftest.poll (which use page.wait_for_timeout), never time.sleep.
"""
from __future__ import annotations

import json
import re
import uuid
from dataclasses import dataclass, field
from typing import Callable

CORS = {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "authorization, content-type, if-none-match, accept",
    "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "access-control-expose-headers": "etag, retry-after, x-ratelimit-remaining, x-ratelimit-reset, link",
}


@dataclass
class Gist:
    id: str
    owner: str
    files: dict[str, str]
    etag: int = 1
    updated: int = 1

    def etag_header(self) -> str:
        return f'W/"{self.id[:6]}-{self.etag}"'


@dataclass
class Request:
    method: str
    path: str
    url: str
    auth: str | None
    body: str | None
    status: int = 0


@dataclass
class FakeGitHub:
    tokens: dict[str, str] = field(default_factory=lambda: {"github_pat_FAKETOKENFORTESTS_one": "renter"})
    gists: dict[str, Gist] = field(default_factory=dict)
    log: list[Request] = field(default_factory=list)
    failures: list[tuple[str, int, dict]] = field(default_factory=list)   # (method, status, extra headers) used once, oldest first
    clock: int = 1
    max_file_bytes: int | None = None
    down: bool = False   # the network to GitHub is gone (requests fail like a dropped connection)

    # ------------------------------------------------------------------ helpers for tests
    def fail_next(self, method: str, status: int, **headers: str) -> None:
        self.failures.append((method.upper(), status, {k.replace("_", "-"): v for k, v in headers.items()}))

    def only(self, method: str | None = None, path: str | None = None) -> list[Request]:
        return [r for r in self.log if (method is None or r.method == method) and (path is None or re.search(path, r.path))]

    def main(self, gist_id: str | None = None) -> dict:
        """The parsed first sync file of the (only, or named) gist."""
        g = self.gists[gist_id] if gist_id else next(iter(self.gists.values()))
        return json.loads(g.files["apartmentscout-sync.json"])

    def items(self, gist_id: str | None = None) -> dict:
        """Every item of every sync file of the gist, merged."""
        g = self.gists[gist_id] if gist_id else next(iter(self.gists.values()))
        out: dict = {}
        for name, text in g.files.items():
            if re.fullmatch(r"apartmentscout-sync(-\d+)?\.json", name):
                out.update(json.loads(text)["sync"]["items"])
        return out

    def live(self, key: str):
        w = self.items().get(key)
        return None if w is None or w.get("x") else w["v"]

    # ------------------------------------------------------------------ the handler
    def install(self, ctx) -> None:
        ctx.route(re.compile(r"^https://api\.github\.com/"), self.handle)

    def handle(self, route) -> None:
        req = route.request
        if self.down and req.method != "OPTIONS":
            route.abort("internetdisconnected")
            return
        path = req.url.split("api.github.com", 1)[1]
        if req.method == "OPTIONS":
            route.fulfill(status=204, headers=CORS)
            return
        entry = Request(req.method, path, req.url, req.headers.get("authorization"), req.post_data)
        self.log.append(entry)
        status, headers, body = self.answer(req.method, path, entry, req.headers)
        entry.status = status
        route.fulfill(status=status, headers={**CORS, "content-type": "application/json; charset=utf-8", **headers}, body=json.dumps(body) if body is not None else "")

    def answer(self, method: str, path: str, entry: Request, headers: dict) -> tuple[int, dict, object]:
        for i, (m, status, extra) in enumerate(self.failures):
            if m == method or m == "*":
                self.failures.pop(i)
                return status, extra, {"message": "Injected failure for a test"}
        user = self.tokens.get((entry.auth or "").removeprefix("Bearer ").strip())
        if not user:
            return 401, {}, {"message": "Bad credentials"}
        if path == "/user":
            return 200, {}, {"login": user}
        if path.startswith("/gists?"):
            return 200, {}, [self.summary(g) for g in sorted(self.gists.values(), key=lambda g: -g.updated) if g.owner == user]
        if method == "POST" and path == "/gists":
            data = json.loads(entry.body or "{}")
            files = {n: f["content"] for n, f in data["files"].items() if f}
            if data.get("public"):
                return 422, {}, {"message": "A sync gist must be secret"}
            g = Gist(uuid.uuid4().hex, user, files, updated=self.tick())
            self.gists[g.id] = g
            return 201, {"etag": g.etag_header()}, self.full(g)
        m = re.fullmatch(r"/gists/([0-9a-f]+)", path)
        if not m or m.group(1) not in self.gists or self.gists[m.group(1)].owner != user:
            return 404, {}, {"message": "Not Found"}
        g = self.gists[m.group(1)]
        if method == "GET":
            if headers.get("if-none-match") == g.etag_header():
                return 304, {"etag": g.etag_header()}, None
            return 200, {"etag": g.etag_header()}, self.full(g)
        if method == "PATCH":
            data = json.loads(entry.body or "{}")
            for n, f in data.get("files", {}).items():
                if f is None:
                    g.files.pop(n, None)
                else:
                    if self.max_file_bytes and len(f["content"].encode()) > self.max_file_bytes:
                        return 422, {}, {"message": "Validation Failed"}
                    g.files[n] = f["content"]
            g.etag += 1
            g.updated = self.tick()
            return 200, {"etag": g.etag_header()}, self.full(g)
        return 404, {}, {"message": "Not Found"}

    def tick(self) -> int:
        self.clock += 1
        return self.clock

    def summary(self, g: Gist) -> dict:
        return {"id": g.id, "html_url": f"https://gist.github.com/{g.owner}/{g.id}", "updated_at": f"2026-10-15T12:{g.updated % 60:02d}:00Z", "owner": {"login": g.owner},
                "files": {n: {"filename": n, "size": len(t)} for n, t in g.files.items()}}

    def full(self, g: Gist) -> dict:
        d = self.summary(g)
        d["files"] = {n: {"filename": n, "size": len(t), "truncated": False, "content": t} for n, t in g.files.items()}
        return d


def token_values(fake: FakeGitHub) -> list[str]:
    return list(fake.tokens)


Handler = Callable[..., None]
