"""Read-only browser check for the modern UI; requires selenium and a local driver."""

import argparse
import base64
import json
import os
import threading
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

from hardware_safety import require_hardware_access


ROOT = Path(__file__).resolve().parents[1]
BROWSERS = {
    "chrome": r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    "edge": r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    "firefox": r"C:\Program Files\Mozilla Firefox\firefox.exe",
    "waterfox": r"C:\Program Files\Waterfox\waterfox.exe",
}


def start_proxy(receiver):
    require_hardware_access(receiver.get('IP'))
    authorization = "Basic " + base64.b64encode(
        f"{receiver['username']}:{receiver['password']}".encode()
    ).decode()
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    class ReceiverProxy(BaseHTTPRequestHandler):
        def do_GET(self):
            try:
                request = urllib.request.Request(
                    f"http://{receiver['IP']}{self.path}",
                    headers={"Authorization": authorization, "Accept-Encoding": "identity"},
                )
                try:
                    response = opener.open(request, timeout=20)
                except urllib.error.HTTPError as error:
                    response = error
                with response:
                    body = response.read()
                    self.send_response(response.status)
                    for name, value in response.headers.items():
                        if name.lower() not in ("content-length", "transfer-encoding", "connection"):
                            self.send_header(name, value)
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
            except Exception as error:
                self.send_error(502, str(error))

        def log_message(self, format, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), ReceiverProxy)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def start_browser(name):
    binary = BROWSERS[name]
    if name == "chrome":
        options = webdriver.ChromeOptions()
        options.binary_location = binary
        options.add_argument("--headless=new")
        options.set_capability("goog:loggingPrefs", {"browser": "ALL"})
        return webdriver.Chrome(options=options)
    if name == "edge":
        options = webdriver.EdgeOptions()
        options.binary_location = binary
        options.add_argument("--headless=new")
        return webdriver.Edge(options=options)
    options = webdriver.FirefoxOptions()
    options.binary_location = binary
    options.add_argument("-headless")
    return webdriver.Firefox(options=options)


def verify(name, origin):
    browser = start_browser(name)
    wait = WebDriverWait(browser, 25)
    try:
        if origin is None:
            browser.get("data:text/html,<title>Browser ready</title>")
            assert browser.title == "Browser ready"
            print(f"{name}: driver ready")
            return

        browser.get(origin + "/#bqe")
        wait.until(lambda _: browser.execute_script(
            "return document.querySelectorAll('#bql > li').length > 1"
        ))
        bouquets = browser.execute_script("return document.querySelectorAll('#bql > li').length")
        wait.until(lambda _: browser.execute_script(
            "return document.querySelector('#osd__current-service')?.textContent?.trim()"
            " && document.querySelector('#osd__current-event__name')?.textContent?.trim()"
        ))
        status = browser.execute_script(
            "return {sender: document.querySelector('#osd__current-service').textContent.trim(), "
            "titel: document.querySelector('#osd__current-event__name').textContent.trim()}"
        )

        browser.execute_script("location.hash = '#at'")
        wait.until(lambda _: browser.find_elements(By.CSS_SELECTOR, 'a[href="/#/at/new"]'))
        browser.find_element(By.CSS_SELECTOR, 'a[href="/#/at/new"]').click()
        wait.until(lambda _: browser.execute_script(
            "return location.hash === '#/at/new' && "
            "!!document.querySelector('#at__page--edit:not(.hidden) form[name=atedit]')"
        ))
        browser.get(origin + "/#/at/new")
        wait.until(lambda _: browser.execute_script(
            "return !!document.querySelector('#at__page--edit:not(.hidden) form[name=atedit]')"
        ))
        scripts = browser.execute_script(
            "return [...document.scripts].map(s => s.src).filter(s => /autotimers-app|owif-app|responsive.min/.test(s))"
        )
        print(json.dumps({"browser": name, "bouquets": bouquets, "status": status,
                          "autotimer_click": True, "autotimer_direct": True,
                          "scripts": scripts}, ensure_ascii=False))
    except Exception:
        print(json.dumps({"browser": name, "url": browser.current_url, "snapshot": browser.execute_script(
            "return {ready:document.readyState, title:document.title, "
            "body:document.body?.innerText?.slice(0,500), "
            "main:document.querySelector('#content_container')?.innerText?.slice(0,500), "
            "atList:document.querySelector('#at__page--list')?.outerHTML?.slice(0,200), "
            "atEdit:document.querySelector('#at__page--edit')?.outerHTML?.slice(0,200), "
            "bql:document.querySelector('#bql')?.innerHTML?.slice(0,600), "
            "scripts:[...document.scripts].map(s=>s.src).filter(s=>/autotimers-app|owif-app|responsive.min|bouqueteditor-app/.test(s))}"
        ), "console": browser.get_log("browser") if name in ("chrome", "edge") else []}, ensure_ascii=False))
        raise
    finally:
        browser.quit()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--browsers", nargs="+", choices=BROWSERS, default=list(BROWSERS))
    args = parser.parse_args()
    server = None
    if not args.self_test:
        target = require_hardware_access(os.environ.get('OPENWEBIF_TEST_RECEIVER_HOST'))
        receiver = json.loads((ROOT / "._work" / ".creds.json").read_text(encoding="utf-8"))[0]
        if receiver['IP'] != target:
            raise RuntimeError('OPENWEBIF_TEST_RECEIVER_HOST stimmt nicht mit dem gespeicherten Gerät überein')
        server = start_proxy(receiver)
    try:
        for name in args.browsers:
            verify(name, None if server is None else f"http://127.0.0.1:{server.server_port}")
    finally:
        if server is not None:
            server.shutdown()
            server.server_close()


if __name__ == "__main__":
    main()