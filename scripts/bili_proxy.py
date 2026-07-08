#!/usr/bin/env python3
"""B 站扫码登录中转代理

经 Clash 出口转发 B 站 passport 请求,绕过 Cloudflare Worker IP 风控。
部署:本地电脑跑 Clash + 本脚本 + cloudflared tunnel 穿透到公网。

环境变量:
  CLASH_PROXY   Clash 的 HTTP 代理地址(默认 http://127.0.0.1:7890)
  PROXY_TOKEN   鉴权 token(必填,Worker 端配同名 secret)
  PORT          监听端口(默认 8080)

端点(均需 X-Proxy-Token 头):
  GET /health                         健康检查
  GET /qrcode                         获取扫码二维码(转发 passport/qrcode/generate)
  GET /poll?qrcode_key=xxx            轮询扫码状态(转发 passport/qrcode/poll)
  GET /nav?cookie=SESSDATA=...;...    查询账号信息(转发 api/nav,cookie 由 query 传)
  GET /buvid                          获取设备指纹(转发 finger/spi)

启动:
  PROXY_TOKEN=your-secret python3 bili_proxy.py
公网暴露(另开终端):
  cloudflared tunnel --url http://localhost:8080
"""

import os
import sys
import json
import urllib.request
import urllib.parse
from http.server import HTTPServer, BaseHTTPRequestHandler

CLASH_PROXY = os.environ.get("CLASH_PROXY", "http://127.0.0.1:7890")
TOKEN = os.environ.get("PROXY_TOKEN", "")
PORT = int(os.environ.get("PORT", "8080"))

# 模拟浏览器请求头,B 站 passport 缺 Referer/Origin 会返回 HTML 错误页
BILI_HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                   "AppleWebKit/537.36 (KHTML, like Gecko) "
                   "Chrome/120.0.0.0 Safari/537.36"),
    "Referer": "https://www.bilibili.com/",
    "Origin": "https://www.bilibili.com",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
}


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        # 鉴权:Worker 请求必须带 X-Proxy-Token
        if TOKEN and self.headers.get("X-Proxy-Token") != TOKEN:
            self._send_json(403, {"error": "forbidden"})
            return
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        qs = parsed.query

        if path == "/health":
            self._send_json(200, {"status": "ok"})
            return

        # 路由到 B 站的不同端点
        if path == "/qrcode":
            bili_url = ("https://passport.bilibili.com/x/passport-login/web/"
                        "qrcode/generate?source=main-fe-header")
            self._forward(bili_url)
        elif path == "/poll":
            if not qs:
                self._send_json(400, {"error": "missing qrcode_key"})
                return
            bili_url = ("https://passport.bilibili.com/x/passport-login/web/"
                        f"qrcode/poll?{qs}")
            self._forward(bili_url)
        elif path == "/buvid":
            bili_url = "https://api.bilibili.com/x/frontend/finger/spi"
            self._forward(bili_url)
        elif path == "/nav":
            # nav 需要 cookie,Worker 通过 query 传(cookie 值已 URL 编码)
            cookie = urllib.parse.parse_qs(qs).get("cookie", [""])[0]
            bili_url = "https://api.bilibili.com/x/web-interface/nav"
            self._forward(bili_url, extra_cookie=cookie)
        else:
            self._send_json(404, {"error": "not found", "path": path})

    def _forward(self, bili_url: str, extra_cookie: str = ""):
        """经 Clash 代理转发请求到 B 站,透传响应体"""
        headers = dict(BILI_HEADERS)
        if extra_cookie:
            headers["Cookie"] = extra_cookie
        try:
            req = urllib.request.Request(bili_url, headers=headers)
            # CLASH_PROXY 非空时走代理,空则直连(沙箱/本地调试用)
            if CLASH_PROXY:
                proxy_handler = urllib.request.ProxyHandler({
                    "http": CLASH_PROXY,
                    "https": CLASH_PROXY,
                })
                opener = urllib.request.build_opener(proxy_handler)
            else:
                opener = urllib.request.build_opener()
            resp = opener.open(req, timeout=15)
            body = resp.read()
            ct = resp.headers.get("content-type", "application/json; charset=utf-8")
            self.send_response(200)
            self.send_header("Content-Type", ct)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(body)
        except urllib.error.HTTPError as e:
            # B 站返回 4xx(如风控 -412 仍是 200+JSON,真正的 HTTP 错误少见)
            body = e.read()[:500]
            self._send_json(e.code, {"error": f"B 站返回 {e.code}", "body": body.decode("utf-8", "ignore")})
        except Exception as e:
            self._send_json(502, {"error": f"转发失败: {str(e)[:200]}"})

    def _send_json(self, code: int, obj: dict):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        # 简化日志:只打印路径和状态
        if len(args) >= 2:
            sys.stderr.write(f"[{args[0]}] {args[1]}\n")


if __name__ == "__main__":
    if not TOKEN:
        print("ERROR: PROXY_TOKEN 环境变量未设置(Worker 端需配同值 secret)", file=sys.stderr)
        sys.exit(1)
    print(f"bili proxy listening on :{PORT}")
    print(f"  CLASH_PROXY = {CLASH_PROXY}")
    print(f"  PROXY_TOKEN = {TOKEN[:8]}...")
    print(f"\n部署:另开终端运行 cloudflared tunnel --url http://localhost:{PORT}")
    HTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
