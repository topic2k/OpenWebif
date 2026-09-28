import io
import os
import subprocess
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from CI.create_ipk import build_ipk, get_build_branch
from plugin.build_info import getBuildBranch


class BuildBranchTests(unittest.TestCase):
    def test_package_builder_reads_current_branch(self):
        with patch("CI.create_ipk.subprocess.check_output", return_value="feature/about-branch\n") as check_output:
            self.assertEqual(get_build_branch("repo"), "feature/about-branch")
        check_output.assert_called_once_with(
            ["git", "symbolic-ref", "--quiet", "--short", "HEAD"],
            cwd="repo", text=True, stderr=subprocess.DEVNULL
        )

    def test_detached_head_has_no_branch(self):
        with patch("CI.create_ipk.subprocess.check_output", side_effect=subprocess.CalledProcessError(1, "git")):
            self.assertEqual(get_build_branch("repo"), "")

    def test_display_escapes_branch_from_package(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch("plugin.build_info.__file__", os.path.join(tmpdir, "build_info.py")):
                Path(tmpdir, "build_branch").write_text("feature/<fix>&test\n", encoding="utf-8")
                self.assertEqual(getBuildBranch(), "feature/&lt;fix&gt;&amp;test")

    def test_display_without_package_metadata(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch("plugin.build_info.__file__", os.path.join(tmpdir, "build_info.py")):
                self.assertEqual(getBuildBranch(), "")

    def test_python_ipk_contains_only_the_branch_used_to_build_it(self):
        for branch in ("feature/about-branch", ""):
            with self.subTest(branch=branch), tempfile.TemporaryDirectory() as tmpdir:
                plugin_dir = Path(tmpdir, "plugin")
                plugin_dir.mkdir()
                (plugin_dir / "__init__.py").write_text("", encoding="utf-8")
                (plugin_dir / "build_branch").write_text("stale-branch\n", encoding="utf-8")
                with patch("CI.create_ipk.get_version", return_value=("2.4.0", "git20260928-r1")), \
                        patch("CI.create_ipk.get_build_branch", return_value=branch), \
                        patch("CI.create_ipk.subprocess.check_call"), \
                        patch("CI.create_ipk.compileall.compile_dir"):
                    ipk = build_ipk(tmpdir)

                data = Path(ipk).read_bytes()
                self.assertTrue(data.startswith(b"!<arch>\n"))
                offset = 8
                while offset < len(data):
                    header = data[offset:offset + 60]
                    size = int(header[48:58])
                    name = header[:16].decode("ascii").strip()
                    content = data[offset + 60:offset + 60 + size]
                    if name == "data.tar.gz":
                        break
                    offset += 60 + size + (size % 2)
                else:
                    self.fail("IPK has no data archive")

                with tarfile.open(fileobj=io.BytesIO(content), mode="r:gz") as archive:
                    metadata = "./usr/lib/enigma2/python/Plugins/Extensions/OpenWebif/build_branch"
                    if branch:
                        self.assertEqual(archive.extractfile(metadata).read().decode("utf-8"), f"{branch}\n")
                    else:
                        self.assertNotIn(metadata, archive.getnames())


if __name__ == "__main__":
    unittest.main()