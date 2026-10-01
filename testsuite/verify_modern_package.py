"""Check that a built IPK contains the modern browser assets and templates."""

import hashlib
import io
import sys
import tarfile
from pathlib import Path


def payload(package):
    archive = package.read_bytes()
    assert archive.startswith(b"!<arch>\n"), "not an IPK/ar archive"
    offset = 8
    while offset < len(archive):
        header = archive[offset:offset + 60]
        assert header[-2:] == b"`\n", "invalid ar member"
        name = header[:16].decode("ascii").strip().rstrip("/")
        length = int(header[48:58])
        offset += 60
        data = archive[offset:offset + length]
        offset += length + length % 2
        if name == "data.tar.gz":
            return tarfile.open(fileobj=io.BytesIO(data), mode="r:gz")
    raise AssertionError("missing data.tar.gz")


def main():
    package = Path(sys.argv[1])
    root = Path(__file__).resolve().parents[1]
    prefix = "./usr/lib/enigma2/python/Plugins/Extensions/OpenWebif/"
    scripts = ("responsive.min.js", "owif-app.js", "bouqueteditor-app.js", "autotimers-app.js")
    with payload(package) as data:
        for script in scripts:
            name = prefix + "public/modern/js/" + script
            actual = data.extractfile(name).read()
            expected = (root / "plugin/public/modern/js" / script).read_bytes()
            assert actual == expected, f"outdated packaged asset: {script}"
        for path, script in (("main", "responsive.min.js"), ("ajax/at", "autotimers-app.js"),
                             ("ajax/bqe", "bouqueteditor-app.js")):
            name = prefix + "controllers/views/responsive/" + path + ".tmpl"
            assert (script + "?v1.2.36").encode() in data.extractfile(name).read(), name
    print(package.name, "verified", hashlib.sha256(package.read_bytes()).hexdigest())


if __name__ == "__main__":
    main()