import re
import subprocess
import tempfile
import unittest
from fnmatch import fnmatchcase
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import mock_open, patch

from CI.create_ipk import build_ipk, get_version


class CreateIpkVersionTests(unittest.TestCase):
    def _assert_version(self, version, packages, build_date, expected, git_date="20260920\n"):
        entries = [SimpleNamespace(name=name, is_file=lambda: True) for name in packages]
        with patch("CI.create_ipk.os.path.exists", return_value=True), \
                patch("CI.create_ipk.os.path.isdir", return_value=True), \
                patch("builtins.open", mock_open(read_data=f"## Version {version}\n")), \
                patch("CI.create_ipk.os.scandir", return_value=entries) as scan, \
                patch("CI.create_ipk.subprocess.check_output") as git_output, \
                patch("CI.create_ipk.time.strftime", return_value=build_date):
            if isinstance(git_date, Exception):
                git_output.side_effect = git_date
            else:
                git_output.return_value = git_date
            self.assertEqual(get_version("unused_root"), (version, expected))
            scan.assert_called_once_with(str(Path("unused_root", ".dist")))

    def test_new_base_version_starts_at_r0(self):
        self._assert_version(
            "2.4.2", ["enigma2-plugin-extensions-openwebif_2.4.1-git20260928-r42_all.ipk"],
            "20260928", "git20260928-r0"
        )

    def test_existing_version_increments_highest_revision_across_dates(self):
        self._assert_version(
            "2.4.0",
            (
                "enigma2-plugin-extensions-openwebif_2.4.0-git20260920-r15_all.ipk",
                "enigma2-plugin-extensions-openwebif_2.4.0-git20260925-r16_all.ipk",
                "enigma2-plugin-extensions-openwebif_2.4.0-git20260928-r18_all.ipk",
                "enigma2-plugin-extensions-openwebif_2.4.0-git20260929-r99_arm.ipk",
                "enigma2-plugin-extensions-openwebif_2.4.01-git20260929-r99_all.ipk",
            ),
            "20260928", "git20260928-r19"
        )

    def test_new_day_keeps_revision_sequence(self):
        self._assert_version(
            "2.4.0", ["enigma2-plugin-extensions-openwebif_2.4.0-git20260928-r18_all.ipk"],
            "20260929", "git20260929-r19"
        )

    def test_edition_packages_continue_revision_sequence(self):
        self._assert_version(
            "2.4.0",
            (
                "enigma2-plugin-extensions-openwebif_2.4.0-git20260928-r18_all.ipk",
                "enigma2-plugin-extensions-openwebif_topic2k-edition_2.4.0-git20260929-r19_all.ipk",
                "enigma2-plugin-extensions-openwebif_topic2k-edition_2.4.0-git20260930-r99_arm.ipk",
                "enigma2-plugin-extensions-openwebif_topic2k-edition_2.4.01-git20260930-r99_all.ipk",
            ),
            "20260928", "git20260929-r20"
        )

    def test_clock_behind_latest_package_does_not_downgrade(self):
        self._assert_version(
            "2.4.0", ["enigma2-plugin-extensions-openwebif_2.4.0-git20260928-r18_all.ipk"],
            "20260920", "git20260928-r19"
        )

    def test_without_git_uses_build_date(self):
        self._assert_version(
            "2.4.0", [], "20260928", "git20260928-r0",
            git_date=subprocess.CalledProcessError(1, "git")
        )

    def test_revision_uses_existing_packages_in_root_and_dist(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            Path(tmpdir, "CHANGES.md").write_text("## Version 2.4.0\n", encoding="utf-8")
            Path(tmpdir, "enigma2-plugin-extensions-openwebif_2.4.0-git20260920-r4_all.ipk").touch()
            dist = Path(tmpdir, ".dist")
            dist.mkdir()
            (dist / "enigma2-plugin-extensions-openwebif_2.4.0-git20260925-r6_all.ipk").touch()
            with patch("CI.create_ipk.subprocess.check_output", return_value="20260920\n"), \
                    patch("CI.create_ipk.time.strftime", return_value="20260928"):
                self.assertEqual(get_version(tmpdir), ("2.4.0", "git20260928-r7"))

    def test_root_packages_do_not_affect_revision(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            Path(tmpdir, "CHANGES.md").write_text("## Version 2.4.0\n", encoding="utf-8")
            Path(tmpdir, "enigma2-plugin-extensions-openwebif_2.4.0-git20260930-r99_all.ipk").touch()
            dist = Path(tmpdir, ".dist")
            dist.mkdir()
            (dist / "enigma2-plugin-extensions-openwebif_2.4.0-git20260925-r6_all.ipk").touch()
            with patch("CI.create_ipk.subprocess.check_output", return_value="20260920\n"), \
                    patch("CI.create_ipk.time.strftime", return_value="20260928"):
                self.assertEqual(get_version(tmpdir), ("2.4.0", "git20260928-r7"))

    def test_missing_dist_starts_at_r0_despite_root_packages(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            Path(tmpdir, "CHANGES.md").write_text("## Version 2.4.0\n", encoding="utf-8")
            Path(tmpdir, "enigma2-plugin-extensions-openwebif_2.4.0-git20260930-r99_all.ipk").touch()
            with patch("CI.create_ipk.subprocess.check_output", return_value="20260920\n"), \
                    patch("CI.create_ipk.time.strftime", return_value="20260928"):
                self.assertEqual(get_version(tmpdir), ("2.4.0", "git20260928-r0"))

    def test_consecutive_builds_keep_both_packages(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            Path(tmpdir, "CHANGES.md").write_text("## Version 2.4.0\n", encoding="utf-8")
            plugin_dir = Path(tmpdir, "plugin")
            plugin_dir.mkdir()
            (plugin_dir / "__init__.py").write_text("", encoding="utf-8")
            with patch("CI.create_ipk.subprocess.check_output", return_value="20260920\n"), \
                    patch("CI.create_ipk.time.strftime", return_value="20260928"), \
                    patch("CI.create_ipk.get_build_branch", return_value=""), \
                    patch("CI.create_ipk.subprocess.check_call"), \
                    patch("CI.create_ipk.compileall.compile_dir"):
                first = Path(build_ipk(tmpdir))
                first_contents = first.read_bytes()
                second = Path(build_ipk(tmpdir))

            self.assertEqual(first.name, "enigma2-plugin-extensions-openwebif_topic2k-edition_2.4.0-git20260928-r0_all.ipk")
            self.assertEqual(second.name, "enigma2-plugin-extensions-openwebif_topic2k-edition_2.4.0-git20260928-r1_all.ipk")
            self.assertEqual(first.parent, Path(tmpdir, ".dist"))
            self.assertEqual(second.parent, Path(tmpdir, ".dist"))
            self.assertFalse(list(Path(tmpdir).glob("*.ipk")))
            self.assertEqual(first.read_bytes(), first_contents)
            self.assertTrue(second.is_file())

    def test_shell_builder_and_download_references_use_edition_filename(self):
        root = Path(__file__).resolve().parents[1]
        prefix = "enigma2-plugin-extensions-openwebif_topic2k-edition_"
        shell = (root / "CI" / "create_ipk.sh").read_text(encoding="utf-8")
        self.assertIn(f"PKG=${{D}}/.dist/{prefix}${{VER}}-${{GITVER}}_all.ipk", shell)
        self.assertIn("Package: enigma2-plugin-extensions-openwebif\n", shell)

        latest = f"{prefix}latest_all.ipk"
        workflow = (root / ".github" / "workflows" / "build.yml").read_text(encoding="utf-8")
        self.assertIn(f'ln -s "${{PKG1}}" {latest}', workflow)
        pattern = re.search(r"path: ./Rel/(\S+\.ipk)", workflow).group(1)
        self.assertTrue(fnmatchcase(f"{prefix}2.4.0-git20260928-r0_all.ipk", pattern))
        self.assertFalse(fnmatchcase(latest, pattern))
        self.assertFalse(fnmatchcase("enigma2-plugin-extensions-openwebif_2.4.0-git20260928-r0_all.ipk", pattern))
        self.assertIn(f"<{latest}>", (root / "doc" / "source" / "index.rst").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()