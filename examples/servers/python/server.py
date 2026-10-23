# Copyright 2026 Plainweave Systems
# SPDX-License-Identifier: Apache-2.0
"""A loopback-only, in-memory task API using only Python's standard library."""
import json
import os
import re
import signal
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

MAX_BODY_BYTES = 16_384
INITIAL_TASKS = (
    {"id": "1", "title": "Keep client state local", "done": False},
    {"id": "2", "title": "Let server data flow", "done": True},
)


class HttpError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


def task_values(value, create):
    if not isinstance(value, dict):
        raise HttpError(400, "Body must be a JSON object")
    allowed = {"title"} if create else {"title", "done"}
    if not value or set(value) - allowed:
        raise HttpError(400, "Provide only title" if create else "Provide title and/or done")
    result = {}
    if "title" in value:
        title = value["title"]
        if not isinstance(title, str) or not 1 <= len(title.strip()) <= 200:
            raise HttpError(400, "title must be a string of 1–200 characters")
        result["title"] = title.strip()
    if create and "title" not in value:
        raise HttpError(400, "title is required")
    if "done" in value:
        if not isinstance(value["done"], bool):
            raise HttpError(400, "done must be a boolean")
        result["done"] = value["done"]
    return result


class TaskServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, port=4000):
        self.tasks = {task["id"]: dict(task) for task in INITIAL_TASKS}
        self.next_id = 3
        self.lock = threading.Lock()
        super().__init__(("127.0.0.1", port), TaskHandler)


class TaskHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "MirrorlessDemo"

    def setup(self):
        super().setup()
        self.connection.settimeout(10)

    def log_message(self, *_args):
        pass

    def reply(self, status, value, headers=None):
        body = json.dumps(value, ensure_ascii=True, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        if status >= 400:
            self.close_connection = True
            self.send_header("Connection", "close")
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def send_error(self, code, message=None, explain=None):
        # BaseHTTPRequestHandler otherwise responds with an HTML error document.
        self.reply(code, {"error": message or "Invalid HTTP request"})

    def read_json(self):
        content_type = self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
        if content_type != "application/json":
            raise HttpError(415, "Use Content-Type: application/json")
        transfer = self.headers.get("Transfer-Encoding", "").lower()
        length_header = self.headers.get("Content-Length")
        if transfer and length_header is not None:
            raise HttpError(400, "Ambiguous request body length")
        if transfer:
            if transfer != "chunked":
                raise HttpError(400, "Unsupported transfer encoding")
            chunks = []
            total = 0
            for _ in range(1024):
                line = self.rfile.readline(128)
                if not line.endswith(b"\r\n"):
                    raise HttpError(400, "Invalid chunked body")
                try:
                    size = int(line.split(b";", 1)[0].strip(), 16)
                except ValueError:
                    raise HttpError(400, "Invalid chunked body") from None
                if size < 0:
                    raise HttpError(400, "Invalid chunked body")
                if size == 0:
                    # Bound trailer bytes as well as payload bytes.
                    trailer_bytes = 0
                    while True:
                        trailer = self.rfile.readline(1024)
                        trailer_bytes += len(trailer)
                        if trailer_bytes > 4096 or not trailer.endswith(b"\r\n"):
                            raise HttpError(400, "Invalid body trailers")
                        if trailer == b"\r\n":
                            break
                    body = b"".join(chunks)
                    break
                total += size
                if total > MAX_BODY_BYTES:
                    raise HttpError(413, "JSON body exceeds 16384 bytes")
                chunk = self.rfile.read(size)
                if len(chunk) != size or self.rfile.read(2) != b"\r\n":
                    raise HttpError(400, "Interrupted chunked body")
                chunks.append(chunk)
            else:
                raise HttpError(413, "Too many body chunks")
        else:
            try:
                length = int(length_header or "0")
            except ValueError:
                raise HttpError(400, "Invalid Content-Length") from None
            if length < 0:
                raise HttpError(400, "Invalid Content-Length")
            if length > MAX_BODY_BYTES:
                raise HttpError(413, "JSON body exceeds 16384 bytes")
            body = self.rfile.read(length)
            if len(body) != length:
                raise HttpError(400, "Request body was interrupted")
        try:
            value = json.loads(body.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            raise HttpError(400, "Body must be a JSON object") from None
        if not isinstance(value, dict):
            raise HttpError(400, "Body must be a JSON object")
        return value

    def dispatch(self):
        try:
            path = urlsplit(self.path).path
            match = re.fullmatch(r"/api/tasks/([1-9][0-9]*)", path)
            allowed = ("GET", "POST") if path == "/api/tasks" else ("GET",) if path == "/api/summary" else ("GET", "PATCH", "DELETE") if match else None
            if allowed is None:
                raise HttpError(404, "Not found")
            if self.command not in allowed:
                self.reply(405, {"error": "Method not allowed"}, {"Allow": ", ".join(allowed)})
                return
            if path == "/api/summary":
                with self.server.lock:
                    result = {"total": len(self.server.tasks), "done": sum(task["done"] for task in self.server.tasks.values())}
                self.reply(200, result)
            elif path == "/api/tasks" and self.command == "GET":
                with self.server.lock:
                    result = [dict(task) for task in self.server.tasks.values()]
                self.reply(200, result)
            elif path == "/api/tasks":
                values = task_values(self.read_json(), True)
                with self.server.lock:
                    task_id = str(self.server.next_id)
                    self.server.next_id += 1
                    self.server.tasks[task_id] = {"id": task_id, "title": values["title"], "done": False}
                self.reply(201, {"id": task_id})
            else:
                task_id = match.group(1)
                # Check existence again under the lock after receiving a PATCH body.
                with self.server.lock:
                    if task_id not in self.server.tasks:
                        raise HttpError(404, "Task not found")
                values = task_values(self.read_json(), False) if self.command == "PATCH" else None
                with self.server.lock:
                    task = self.server.tasks.get(task_id)
                    if task is None:
                        raise HttpError(404, "Task not found")
                    if self.command == "GET":
                        result = dict(task)
                    elif self.command == "PATCH":
                        task.update(values)
                        result = {"ok": True}
                    else:
                        del self.server.tasks[task_id]
                        result = {"ok": True}
                self.reply(200, result)
        except HttpError as error:
            self.reply(error.status, {"error": str(error)})
        except (BrokenPipeError, ConnectionResetError, TimeoutError):
            self.close_connection = True
        except Exception:
            self.reply(500, {"error": "Internal server error"})

    do_GET = do_POST = do_PATCH = do_DELETE = dispatch
    do_PUT = do_OPTIONS = do_HEAD = do_TRACE = dispatch


def main():
    port_text = os.environ.get("PORT", "4000")
    if not port_text.isascii() or not port_text.isdecimal() or not 0 <= int(port_text) <= 65535:
        raise SystemExit("PORT must be an integer from 0 to 65535")
    server = TaskServer(int(port_text))
    stopping = threading.Event()

    def stop(_signum, _frame):
        if not stopping.is_set():
            stopping.set()
            # shutdown must not run on the serve_forever thread.
            threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    print(f"Mirrorless Python task API: http://127.0.0.1:{server.server_port}", flush=True)
    try:
        server.serve_forever(poll_interval=0.1)
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
