#!/usr/bin/env python3
"""本地静态预览：只提供 web/ 下的前端文件，/api/* 返回 501。

用法：
    python serve.py            # 默认 8787 端口
    set PORT=9000 && python serve.py
"""
import json
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web")
PORT = int(os.environ.get("PORT", "8787"))


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def _no_backend(self):
        body = json.dumps(
            {"error": "backend-not-included",
             "message": "本仓库只包含前端，后端 API 未提供"},
            ensure_ascii=False,
        ).encode("utf-8")
        self.send_response(501)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.startswith("/api/"):
            return self._no_backend()
        if self.path == "/":
            self.path = "/index.html"
        return super().do_GET()

    do_POST = _no_backend
    do_PUT = _no_backend
    do_DELETE = _no_backend
    do_PATCH = _no_backend


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print("http://127.0.0.1:%d/" % PORT)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
