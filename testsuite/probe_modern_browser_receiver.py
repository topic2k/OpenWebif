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


def start_browser(name, receiver=None):
    binary = BROWSERS[name]
    if name == "chrome":
        options = webdriver.ChromeOptions()
        options.binary_location = binary
        options.add_argument("--headless=new")
        options.set_capability("goog:loggingPrefs", {"browser": "ALL"})
        browser = webdriver.Chrome(options=options)
        if receiver is not None:
            authorization = "Basic " + base64.b64encode(
                f"{receiver['username']}:{receiver['password']}".encode()
            ).decode()
            browser.execute_cdp_cmd('Network.enable', {})
            browser.execute_cdp_cmd('Network.setExtraHTTPHeaders', {
                'headers': {'Authorization': authorization}
            })
        return browser
    if name == "edge":
        options = webdriver.EdgeOptions()
        options.binary_location = binary
        options.add_argument("--headless=new")
        return webdriver.Edge(options=options)
    options = webdriver.FirefoxOptions()
    options.binary_location = binary
    options.add_argument("-headless")
    return webdriver.Firefox(options=options)


def verify(name, origin, receiver=None):
    browser = start_browser(name, receiver)
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
        browser.get(origin + "/#at")
        wait.until(lambda _: browser.execute_script(
            "return !!document.querySelector('#tag-filter-at') && "
            "!!document.querySelector('[data-tag-filter-toggle=at]')"
        ))
        tags = browser.execute_async_script("""
            const done = arguments[arguments.length - 1];
            Promise.all(['/api/tagfiltertags', '/api/gettags'].map(async url => {
                const response = await fetch(url);
                const text = await response.text();
                try { return {status: response.status, body: JSON.parse(text)}; }
                catch (_) { return {status: response.status, body: text.slice(0, 160)}; }
            })).then(done).catch(error => done({error: String(error)}));
        """)
        print(json.dumps({"browser": name, "tag_api_status":
                          [response.get('status') for response in tags] if isinstance(tags, list) else tags},
                         ensure_ascii=False))
        assert isinstance(tags, list) and tags[0]['status'] == 200, 'Tag filter API failed'
        assert isinstance(tags[0]['body'], dict), 'Tag filter API returned no JSON'
        assert isinstance(tags[0]['body'].get('known'), list), 'Tag filter API returned no known tags'
        browser.find_element(By.CSS_SELECTOR, '[data-tag-filter-toggle="at"]').click()
        wait.until(lambda _: browser.execute_script(
            "return !document.querySelector('#tag-filter-at .list-tag-filter-panel').hidden && "
            "!!document.querySelector('#tag-filter-at .list-tag-filter-options > strong')"
        ))
        displayed = browser.execute_script("""
            return [...document.querySelectorAll('#tag-filter-at .list-tag-filter-options label input')]
                .map(input => input.value);
        """)
        assert set(tags[0]['body']['known']).issubset(displayed), 'Managed tags not displayed in the filter'

        browser.get(origin + "/#bqe")
        wait.until(lambda _: browser.execute_script(
            "return !!document.querySelector('#osd__current-event__name')?.textContent?.trim()"
        ))
        browser.execute_script("document.querySelector('#osd__current-event').click()")
        wait.until(lambda _: browser.find_elements(By.CSS_SELECTOR, '#eventdescriptionII button[data-href^="/#/at/new?"]'))
        browser.execute_script("document.querySelector('#eventdescriptionII button[data-href]').click()")
        wait.until(lambda _: browser.execute_script(
            "return location.hash.startsWith('#/at/new?') && "
            "!!document.querySelector('#at__page--edit:not(.hidden) form[name=atedit]')"
        ))
        event_name = browser.execute_script(
            "return document.querySelector('form[name=atedit] [name=name]').value"
        )
        assert event_name, 'EPG AutoTimer form did not receive the event title'
        scripts = browser.execute_script(
            "return [...document.scripts].map(s => s.src).filter(s => /autotimers-app|owif-app|responsive.min/.test(s))"
        )
        print(json.dumps({"browser": name, "bouquets": bouquets, "status": status,
                          "autotimer_click": True, "autotimer_direct": True,
                          "known_tags": len(tags[0]['body']['known']), "filter_options": len(displayed),
                          "epg_autotimer": True,
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
    parser.add_argument("--direct", action="store_true", help="Direct Chrome access with HTTP Basic Auth")
    parser.add_argument("--browsers", nargs="+", choices=BROWSERS, default=list(BROWSERS))
    args = parser.parse_args()
    if args.direct and (args.self_test or args.browsers != ['chrome']):
        parser.error('--direct requires receiver access and --browsers chrome')
    server = None
    if not args.self_test:
        target = require_hardware_access(os.environ.get('OPENWEBIF_TEST_RECEIVER_HOST'))
        receiver = json.loads((ROOT / "._work" / ".creds.json").read_text(encoding="utf-8"))[0]
        if receiver['IP'] != target:
            raise RuntimeError('OPENWEBIF_TEST_RECEIVER_HOST stimmt nicht mit dem gespeicherten Gerät überein')
        if not args.direct:
            server = start_proxy(receiver)
    try:
        for name in args.browsers:
            origin = None if args.self_test else (
                f"http://{receiver['IP']}" if args.direct else f"http://127.0.0.1:{server.server_port}"
            )
            verify(name, origin, receiver if args.direct else None)
    finally:
        if server is not None:
            server.shutdown()
            server.server_close()


if __name__ == "__main__":
    main()