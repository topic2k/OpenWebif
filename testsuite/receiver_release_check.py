"""Install a verified IPK after recordings, or put the receiver in standby."""

import argparse
import base64
import hashlib
import http.client
import json
import os
import re
import time
import urllib.request
from pathlib import Path

from hardware_safety import require_hardware_access


ROOT = Path(__file__).resolve().parents[1]


def request_bytes(receiver, path):
    require_hardware_access(receiver.get('IP'))
    token = base64.b64encode(f"{receiver['username']}:{receiver['password']}".encode()).decode()
    req = urllib.request.Request(f"http://{receiver['IP']}{path}", headers={"Authorization": "Basic " + token})
    with urllib.request.urlopen(req, timeout=12) as response:
        return response.read()


def request(receiver, path):
    return json.loads(request_bytes(receiver, path))


def no_recording(receiver):
    status = request(receiver, "/api/statusinfo")
    if str(status.get("isRecording", "")).lower() not in ("false", "0"):
        raise RuntimeError("Receiver ist in Aufnahme oder der Aufnahmestatus ist unbekannt: Abbruch")


def install(receiver, package):
    require_hardware_access(receiver.get('IP'))
    import paramiko

    no_recording(receiver)
    package = package.resolve(strict=True)
    expected = hashlib.sha256(package.read_bytes()).hexdigest()
    remote = f"/tmp/openwebif-junie-{package.name}"
    client = paramiko.SSHClient()
    client.load_system_host_keys()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(receiver["IP"], username=receiver["username"], password=receiver["password"],
                   look_for_keys=False, allow_agent=False, timeout=15)
    try:
        sftp = client.open_sftp()
        try:
            sftp.put(str(package), remote)
            stdin, stdout, stderr = client.exec_command(f"sha256sum {remote}", timeout=25)
            actual = stdout.read().decode().split()[0]
            if stdout.channel.recv_exit_status() != 0 or actual != expected:
                raise RuntimeError("Paket-Prüfsumme auf dem Gerät stimmt nicht überein")
            print("Paket-Upload geprüft:", expected)

            no_recording(receiver)
            stdin, stdout, stderr = client.exec_command(f"opkg install {remote}", timeout=180)
            output, errors = stdout.read().decode(errors="replace"), stderr.read().decode(errors="replace")
            code = stdout.channel.recv_exit_status()
            print("opkg:", output, errors, "exit:", code)
            if code:
                raise RuntimeError("Paketinstallation fehlgeschlagen; Enigma2 wird nicht neu gestartet")
        finally:
            sftp.remove(remote)
            sftp.close()

    finally:
        client.close()

    restart(receiver)


def restart(receiver):
    no_recording(receiver)
    template = (ROOT / 'plugin/controllers/views/responsive/ajax/at.tmpl').read_bytes()
    marker = re.search(rb'autotimers-app\.js\?v[\d.]+', template)
    if marker is None:
        raise RuntimeError('AutoTimer-Browserdatei ohne Versionskennung')
    try:
        result = request(receiver, "/api/powerstate?newstate=3")
        if not result.get("result"):
            raise RuntimeError(f"Enigma2-Neustart abgelehnt: {result}")
    except (urllib.error.URLError, TimeoutError, http.client.RemoteDisconnected) as error:
        if isinstance(error, urllib.error.HTTPError):
            raise
        print("Verbindung beim Enigma2-Neustart getrennt:", type(error).__name__)

    for attempt in range(30):
        try:
            time.sleep(3)
            content = request_bytes(receiver, "/ajax/at")
            if marker.group() in content:
                print('Enigma2-Neustart bestätigt: aktives AutoTimer-Template enthält', marker.group().decode())
                return
        except Exception:
            pass
    raise RuntimeError("Aktualisiertes AutoTimer-Template nach Enigma2-Neustart nicht sichtbar")


def inspect(receiver):
    require_hardware_access(receiver.get('IP'))
    import paramiko

    client = paramiko.SSHClient()
    client.load_system_host_keys()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(receiver["IP"], username=receiver["username"], password=receiver["password"],
                   look_for_keys=False, allow_agent=False, timeout=15)
    try:
        for command in (
                "opkg status enigma2-plugin-extensions-openwebif",
                "sha256sum /usr/lib/enigma2/python/Plugins/Extensions/OpenWebif/public/modern/js/autotimers-app.js"):
            stdin, stdout, stderr = client.exec_command(command, timeout=25)
            output = stdout.read().decode(errors="replace")
            errors = stderr.read().decode(errors="replace")
            code = stdout.channel.recv_exit_status()
            if code:
                raise RuntimeError(f"Geräteprüfung fehlgeschlagen ({code}): {errors}")
            print(command, output)
            if command.startswith("sha256sum "):
                expected = hashlib.sha256((ROOT / "plugin/public/modern/js/autotimers-app.js").read_bytes()).hexdigest()
                if output.split()[0] != expected:
                    raise RuntimeError("Installiertes AutoTimer-Skript weicht vom lokalen Build ab")
    finally:
        client.close()


def standby(receiver):
    no_recording(receiver)
    result = request(receiver, "/api/powerstate?newstate=5")
    if str(result.get("result", "")).lower() not in ("true", "1"):
        raise RuntimeError(f"Standby wurde abgelehnt: {result}")
    for attempt in range(10):
        time.sleep(1)
        state = request(receiver, "/api/powerstate")
        if str(state.get("instandby", "")).lower() in ("true", "1"):
            print("Receiver befindet sich im Standby")
            return
    raise RuntimeError("Standby nach Anfrage nicht bestätigt")


def main():
    parser = argparse.ArgumentParser()
    actions = parser.add_mutually_exclusive_group(required=True)
    actions.add_argument("--install", type=Path)
    actions.add_argument("--standby", action="store_true")
    actions.add_argument("--restart", action="store_true")
    actions.add_argument("--inspect", action="store_true")
    args = parser.parse_args()
    target = require_hardware_access(os.environ.get('OPENWEBIF_TEST_RECEIVER_HOST'))
    receiver = json.loads((ROOT / "._work" / ".creds.json").read_text(encoding="utf-8"))[0]
    if receiver['IP'] != target:
        raise RuntimeError('OPENWEBIF_TEST_RECEIVER_HOST stimmt nicht mit dem gespeicherten Gerät überein')
    if args.install:
        install(receiver, args.install)
    elif args.standby:
        standby(receiver)
    elif args.restart:
        restart(receiver)
    else:
        inspect(receiver)


if __name__ == "__main__":
    main()