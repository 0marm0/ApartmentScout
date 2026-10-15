"""The local server behind ``apartmentscout serve``: the dashboard's files plus a small JSON API for the "New search"
wizard (read and save criteria.yaml, create or switch a search folder, re-score).

The API exists only for a page served by this process. It is guarded three ways:

* the server binds to 127.0.0.1 and refuses requests whose ``Host`` is not 127.0.0.1 or localhost on its own port
  (DNS rebinding) or whose ``Origin`` is another site;
* every call needs the per-run random token the server writes into the page it serves (``<meta name="as-token">``),
  sent back in the ``X-AS-Token`` header, which also forces a CORS preflight for any other origin (and none is answered);
* writes stay inside the active search folder (criteria.yaml, backups/) or directly under the searches folder
  (new folders), after the same validation `apartmentscout criteria --check` runs. Example searches are read-only.

A hosted copy of the dashboard (GitHub Pages, a standalone file) has no such meta tag and so never shows these controls.
"""
from __future__ import annotations

import datetime as dt
import hmac
import http.server
import json
import os
import re
import secrets
import shutil
import threading
import time
import urllib.parse
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from . import __version__
from .config import Workspace
from .criteria_check import check_text, summary_lines
from .intake import city_profile, init_search
from .tourapi import MAX_PHOTO_BYTES, TourError, TourFiles, pillow_available   # tour findings and photos

MAX_BODY = 256 * 1024
FOLDER = re.compile(r"^[a-z0-9][a-z0-9-]{0,59}$")
TOUR_PHOTO = re.compile(r"^/tours/(?P<id>[A-Za-z0-9][A-Za-z0-9._-]{0,119})/photos/(?P<name>[a-z0-9]{6,32}\.webp)$")
BACKUPS_KEPT = 30
REPO = Path(__file__).resolve().parent.parent
EXAMPLES = REPO / "examples"


def slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", str(text).lower()).strip("-")[:60].strip("-") or "search"


class ApiError(Exception):
    def __init__(self, status: int, message: str, **extra: Any) -> None:
        super().__init__(message)
        self.status, self.message, self.extra = status, message, extra


@dataclass
class Job:
    id: str
    steps: list[dict[str, str]]
    state: str = "running"          # running | done | error
    error: str | None = None
    started: float = field(default_factory=time.time)
    finished: float | None = None

    def view(self) -> dict[str, Any]:
        return {"id": self.id, "state": self.state, "error": self.error, "steps": self.steps,
                "seconds": round((self.finished or time.time()) - self.started, 1)}


@dataclass
class ServeState:
    """What the running server is showing, shared between request threads."""
    dash: Path
    searches_dir: Path
    ws: Workspace | None
    data_dir: Path
    media_dir: Path | None
    export: Callable[[Workspace, Path], None]
    rescore: Callable[[Workspace], None]
    api: bool = True
    token: str = field(default_factory=lambda: secrets.token_urlsafe(24))
    port: int = 0
    lock: threading.RLock = field(default_factory=threading.RLock)
    jobs: dict[str, Job] = field(default_factory=dict)

    # -- the active search
    @property
    def read_only(self) -> bool:
        return self.ws is not None and EXAMPLES.resolve() in self.ws.root.resolve().parents

    def activate(self, ws: Workspace) -> None:
        """Make `ws` the search the dashboard shows: export its data into its own git-ignored cache."""
        example = EXAMPLES.resolve() in ws.root.resolve().parents
        data_dir = self.dash / "data" if example else ws.cache_dir / "dashboard-data"
        self.export(ws, data_dir)
        with self.lock:
            self.ws, self.data_dir, self.media_dir = ws, data_dir, ws.root / "media"

    def display(self, p: Path) -> str:
        """A path as the renter would type it: relative to the folder the server started in when possible."""
        try:
            return os.path.relpath(p.resolve(), Path.cwd()) if p.resolve().is_relative_to(Path.cwd()) else str(p.resolve())
        except OSError:
            return str(p)

    # -- reads
    def cities(self) -> list[dict[str, Any]]:
        out = [{"id": "generic", "name": "Another city", "timezone": None, "feeds": []}]
        for p in sorted((REPO / "config" / "cities").glob("*.yaml")):
            prof = city_profile(p.stem)
            out.append({"id": p.stem, "name": prof.get("name") or p.stem, "timezone": prof.get("timezone"),
                        "feeds": prof.get("transit_feeds") or [], "records": prof.get("records")})
        return out

    def searches(self) -> list[dict[str, Any]]:
        out = []
        if self.searches_dir.is_dir():
            for d in sorted(self.searches_dir.iterdir()):
                f = d / "criteria.yaml"
                if d.is_dir() and not d.is_symlink() and f.is_file():
                    try:
                        name = (yaml.safe_load(f.read_text(encoding="utf-8")) or {}).get("search", {}).get("name") or d.name
                    except (OSError, yaml.YAMLError, AttributeError):
                        name = d.name
                    out.append({"folder": d.name, "name": str(name), "active": self.ws is not None and d.resolve() == self.ws.root.resolve()})
        return out

    def session(self) -> dict[str, Any]:
        ws = self.ws
        try:
            name = (ws.criteria().get("search") or {}).get("name") if ws else None
        except (OSError, ValueError, yaml.YAMLError):
            name = None
        return {"api": 1, "version": __version__, "can_save": bool(ws and not self.read_only), "example": self.read_only,
                "tours": {"save": bool(ws and not self.read_only), "photos": bool(ws and not self.read_only and pillow_available()),
                          "max_photo_bytes": MAX_PHOTO_BYTES},
                "search": {"folder": ws.root.name, "name": name, "path": self.display(ws.root)} if ws else None,
                "searches_dir": self.display(self.searches_dir), "searches": self.searches(), "cities": self.cities()}

    # -- tour findings and photos (apartmentscout/tourapi.py)
    def tour_files(self) -> TourFiles:
        if self.ws is None:
            raise ApiError(409, "No search is open.")
        if self.read_only:
            raise ApiError(403, "This is a bundled example search and is read-only. Your visit notes stay in this browser.")
        return TourFiles(self.ws.root, self.lock)

    # -- writes
    def save_criteria(self, text: str) -> dict[str, Any]:
        ws = self.ws
        if ws is None:
            raise ApiError(409, "No search is open, so there is no criteria.yaml to save. Create a search instead.")
        if self.read_only:
            raise ApiError(403, "This is a bundled example search and is read-only. Create a new search to keep your own criteria.")
        rep = check_text(text)
        if not rep.ok:
            raise ApiError(422, "criteria.yaml has problems; nothing was written.", errors=rep.errors, warnings=rep.warnings)
        root = ws.root.resolve()
        target = (root / "criteria.yaml")
        if target.is_symlink() or target.resolve().parent != root:
            raise ApiError(403, "criteria.yaml is not a plain file inside the search folder.")
        backup = None
        with self.lock:
            if target.exists():
                bdir = root / "backups"
                bdir.mkdir(exist_ok=True)
                stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
                backup = bdir / f"criteria-{stamp}.yaml"
                n = 1
                while backup.exists():
                    n += 1
                    backup = bdir / f"criteria-{stamp}-{n}.yaml"
                shutil.copy2(target, backup)
                for old in sorted(bdir.glob("criteria-*.yaml"))[:-BACKUPS_KEPT]:
                    old.unlink(missing_ok=True)
            tmp = root / f".criteria.{secrets.token_hex(4)}.tmp"
            try:
                tmp.write_text(text, encoding="utf-8")
                os.replace(tmp, target)
            finally:
                tmp.unlink(missing_ok=True)
        rel = self.display(root)
        return {"ok": True, "backup": f"{backup.relative_to(root).as_posix()}" if backup else None, "warnings": rep.warnings,
                "folder": root.name, "next": [f"apartmentscout score --search {rel}", f"apartmentscout build --search {rel}"]}

    def create_search(self, folder: str, text: str, city: str | None) -> dict[str, Any]:
        if not isinstance(folder, str) or not FOLDER.match(folder):
            raise ApiError(400, "Folder names use lowercase letters, digits and hyphens (up to 60 characters, starting with a letter or digit).")
        rep = check_text(text)
        if not rep.ok:
            raise ApiError(422, "criteria.yaml has problems; nothing was created.", errors=rep.errors, warnings=rep.warnings)
        base = self.searches_dir.resolve()
        target = base / folder
        if target.resolve().parent != base:
            raise ApiError(400, "That folder is outside the searches folder.")
        with self.lock:
            if target.exists() or target.is_symlink():
                raise ApiError(409, f"A search folder named {folder} already exists. Pick another name.")
            self.searches_dir.mkdir(parents=True, exist_ok=True)
            try:
                init_search(target, city or (rep.criteria or {}).get("search", {}).get("city"), text)
            except (ValueError, FileExistsError) as e:
                shutil.rmtree(target, ignore_errors=True)
                raise ApiError(422, str(e)) from e
        rel = self.display(target)
        return {"ok": True, "folder": folder, "path": rel, "warnings": rep.warnings,
                "next": [f"apartmentscout serve --search {rel}", f"apartmentscout import listings.csv --search {rel}", f"apartmentscout all --search {rel}"]}

    def activate_folder(self, folder: str) -> dict[str, Any]:
        if not isinstance(folder, str) or not FOLDER.match(folder):
            raise ApiError(400, "Unknown search folder.")
        base = self.searches_dir.resolve()
        target = base / folder
        if target.is_symlink() or target.resolve().parent != base or not (target / "criteria.yaml").is_file():
            raise ApiError(404, "No search with that folder name.")
        self.activate(Workspace(target.resolve()))
        return {"ok": True, "folder": folder}

    def start_rescore(self) -> dict[str, Any]:
        with self.lock:
            ws = self.ws
            if ws is None:
                raise ApiError(409, "No search is open.")
            if self.read_only:
                raise ApiError(403, "This is a bundled example search and is read-only.")
            if any(j.state == "running" for j in self.jobs.values()):
                raise ApiError(409, "A re-score is already running.")
            job = Job(secrets.token_hex(6), [{"name": "Score every listing", "state": "running"}, {"name": "Rebuild the dashboard data", "state": "waiting"}])
            self.jobs[job.id] = job
            for old in list(self.jobs)[:-5]:
                self.jobs.pop(old, None)
        threading.Thread(target=self._run_job, args=(job, ws), daemon=True).start()
        return {"ok": True, "job": job.id}

    def _run_job(self, job: Job, ws: Workspace) -> None:
        try:
            self.rescore(ws)
            job.steps[0]["state"], job.steps[1]["state"] = "done", "running"
            self.export(ws, self.data_dir)
            job.steps[1]["state"] = "done"
            job.state = "done"
        except Exception as e:  # noqa: BLE001 - reported to the page, never raised into the thread
            for s in job.steps:
                if s["state"] == "running":
                    s["state"] = "error"
            job.state, job.error = "error", f"{type(e).__name__}: {str(e)[:300]}"
        finally:
            job.finished = time.time()


# --------------------------------------------------------------------------- HTTP
def make_handler(state: ServeState) -> type[http.server.SimpleHTTPRequestHandler]:
    class Handler(http.server.SimpleHTTPRequestHandler):
        server_version = "ApartmentScout"
        extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".webp": "image/webp"}   # tour photos (Python 3.10 does not know it)

        def __init__(self, *a: Any, **kw: Any) -> None:
            super().__init__(*a, directory=str(state.dash), **kw)

        def log_message(self, *a: Any) -> None:
            pass

        # -- static files
        def translate_path(self, path: str) -> str:
            clean = path.split("?", 1)[0].split("#", 1)[0]
            if clean.startswith("/tours/"):   # the renter's own tour photos, and nothing else under tours/
                m = TOUR_PHOTO.match(clean)
                with state.lock:
                    base = (state.ws.root / "tours").resolve() if state.ws is not None and not state.read_only else None
                if not m or base is None:
                    return str(state.dash / "__forbidden__")
                target = (base / m["id"] / "photos" / m["name"]).resolve()
                return str(target) if target.parent.parent.parent == base else str(state.dash / "__forbidden__")
            with state.lock:
                routes = {"/data/": state.data_dir.resolve(), "/media/": state.media_dir.resolve() if state.media_dir else None}
            for prefix, root in routes.items():
                if root and clean.startswith(prefix):
                    rel = Path(urllib.parse.unquote(clean[len(prefix):]))
                    target = (root / rel).resolve()
                    if root in target.parents or target == root:
                        return str(target)
                    return str(root / "__forbidden__")
            return super().translate_path(path)

        # -- guards
        def _own_hosts(self) -> set[str]:
            return {f"127.0.0.1:{state.port}", f"localhost:{state.port}"}

        def _host_ok(self) -> bool:
            if self.headers.get("Host", "") not in self._own_hosts():
                return False
            origin = self.headers.get("Origin")
            return origin is None or origin in {f"http://{h}" for h in self._own_hosts()}

        def _token_ok(self) -> bool:
            return hmac.compare_digest(self.headers.get("X-AS-Token", ""), state.token)

        def _send(self, status: int, body: dict[str, Any]) -> None:
            data = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)

        def _body(self) -> dict[str, Any]:
            if not (self.headers.get("Content-Type") or "").startswith("application/json"):
                raise ApiError(415, "Send JSON.")
            try:
                n = int(self.headers.get("Content-Length") or "0")
            except ValueError as e:
                raise ApiError(400, "Bad Content-Length.") from e
            if n > MAX_BODY:
                if n <= 4 * MAX_BODY:   # read and drop a modestly oversized body, so the client sees the 413, not a reset
                    self.rfile.read(n)
                else:
                    self.close_connection = True
                raise ApiError(413, "That is too large for a criteria file.")
            try:
                v = json.loads(self.rfile.read(n) or b"{}")
            except ValueError as e:
                raise ApiError(400, "The request body is not JSON.") from e
            if not isinstance(v, dict):
                raise ApiError(400, "The request body must be a JSON object.")
            return v

        def _raw(self, limit: int) -> bytes:
            """A photo body: an image content type, a Content-Length within `limit`, nothing else."""
            if not (self.headers.get("Content-Type") or "").startswith("image/"):
                raise ApiError(415, "Send the photo as an image.")
            try:
                n = int(self.headers.get("Content-Length") or "0")
            except ValueError as e:
                raise ApiError(400, "Bad Content-Length.") from e
            if n <= 0:
                raise ApiError(400, "No photo was sent.")
            if n > limit:
                raise ApiError(413, f"That photo is larger than {limit // (1024 * 1024)} MB.")
            return self.rfile.read(n)

        def _tours(self, method: str, route: str) -> dict[str, Any] | None:
            """/api/tours, /api/tours/<id>, /api/tours/<id>/photos and /api/tours/<id>/photos/delete."""
            parts = route.split("/")   # ['', 'api', 'tours', <id>, ...]
            try:
                files = state.tour_files()
                if len(parts) == 3 and method == "GET":
                    return {"tours": files.all()}
                if len(parts) == 4 and method == "GET":
                    return {"id": parts[3], "findings": files.get(parts[3])}
                if len(parts) == 4 and method == "POST":
                    return {"ok": True, "findings": files.save(parts[3], self._body().get("findings"))}
                if len(parts) == 5 and parts[4] == "photos" and method == "POST":
                    return {"ok": True, "photo": files.add_photo(parts[3], self._raw(MAX_PHOTO_BYTES))}
                if len(parts) == 6 and parts[4:] == ["photos", "delete"] and method == "POST":
                    return {"ok": True, "findings": files.delete_photo(parts[3], str(self._body().get("photo", "")))}
            except TourError as e:
                raise ApiError(e.status, e.message) from e
            return None

        # -- routing
        def do_GET(self) -> None:  # noqa: N802
            route = self.path.split("?", 1)[0]
            if route.startswith("/api/"):
                return self._api("GET", route)
            if not self._host_ok():
                return self._send(403, {"error": "Open the dashboard at http://127.0.0.1:%d/." % state.port})
            if state.api and route in ("/", "/index.html"):
                return self._index()
            return super().do_GET()

        def do_HEAD(self) -> None:  # noqa: N802
            if self.path.startswith("/api/") or not self._host_ok():
                return self._send(405, {"error": "Not allowed."})
            return super().do_HEAD()

        def do_POST(self) -> None:  # noqa: N802
            route = self.path.split("?", 1)[0]
            if not route.startswith("/api/"):
                return self._send(405, {"error": "Not allowed."})
            return self._api("POST", route)

        def do_OPTIONS(self) -> None:  # noqa: N802
            self._send(403, {"error": "Cross-origin requests are not accepted."})

        def do_PUT(self) -> None:  # noqa: N802
            self._send(405, {"error": "Not allowed."})

        do_DELETE = do_PATCH = do_PUT

        def _index(self) -> None:
            html = (state.dash / "index.html").read_text(encoding="utf-8")
            html = html.replace("</head>", f'<meta name="as-token" content="{state.token}">\n</head>', 1)
            data = html.encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)

        def _api(self, method: str, route: str) -> None:
            try:
                if not state.api:
                    raise ApiError(404, "The local API is switched off.")
                if not self._host_ok():
                    raise ApiError(403, "Requests must come from the dashboard page this server serves.")
                if not self._token_ok():
                    raise ApiError(401, "Missing or wrong session token. Reload the dashboard from `apartmentscout serve`.")
                self._send(200, self._dispatch(method, route))
            except ApiError as e:
                self._send(e.status, {"error": e.message, **e.extra})
            except Exception as e:  # noqa: BLE001 - never leak a traceback to the page
                self._send(500, {"error": f"{type(e).__name__}: {str(e)[:200]}"})

        def _dispatch(self, method: str, route: str) -> dict[str, Any]:
            if method == "GET":
                if route == "/api/session":
                    return state.session()
                if route == "/api/searches":
                    return {"searches": state.searches()}
                if route == "/api/criteria":
                    ws = state.ws
                    if ws is None:
                        raise ApiError(404, "No search is open.")
                    return {"yaml": ws.criteria_path.read_text(encoding="utf-8"), "folder": ws.root.name, "can_save": not state.read_only}
                if route == "/api/tours" or route.startswith("/api/tours/"):
                    out = self._tours(method, route)
                    if out is not None:
                        return out
                if route.startswith("/api/jobs/"):
                    job = state.jobs.get(route.rsplit("/", 1)[1])
                    if job is None:
                        raise ApiError(404, "Unknown job.")
                    return job.view()
                raise ApiError(404, "Unknown endpoint.")
            if route.startswith("/api/tours/"):
                out = self._tours(method, route)
                if out is not None:
                    return out
                raise ApiError(404, "Unknown endpoint.")
            body = self._body()
            if route == "/api/validate":
                rep = check_text(str(body.get("yaml", "")))
                return {"ok": rep.ok, "errors": rep.errors, "warnings": rep.warnings,
                        "summary": summary_lines(rep.criteria) if rep.ok and rep.criteria else []}
            if route == "/api/criteria":
                return state.save_criteria(str(body.get("yaml", "")))
            if route == "/api/searches":
                folder = body.get("folder") or slugify(body.get("name") or "search")
                return state.create_search(folder, str(body.get("yaml", "")), body.get("city"))
            if route == "/api/searches/activate":
                return state.activate_folder(body.get("folder"))
            if route == "/api/rescore":
                return state.start_rescore()
            raise ApiError(404, "Unknown endpoint.")

    return Handler


def make_server(state: ServeState, port: int = 0) -> http.server.ThreadingHTTPServer:
    """A threaded server on 127.0.0.1 only; `port=0` picks a free one (state.port is set to it)."""
    http.server.ThreadingHTTPServer.allow_reuse_address = True
    http.server.ThreadingHTTPServer.request_queue_size = 128   # the dashboard loads many files at once
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", port), make_handler(state))
    state.port = httpd.server_address[1]
    return httpd
