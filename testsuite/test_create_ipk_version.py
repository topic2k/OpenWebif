import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from CI.create_ipk import build_ipk, get_version


class CreateIpkVersionTests(unittest.TestCase):
    def test_new_base_version_starts_at_r0(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            Path(tmpdir, "CHANGES.md").write_text("## Version 2.4.2\n", encoding="utf-8")
            Path(tmpdir, "enigma2-plugin-extensions-openwebif_2.4.1-git20260928-r42_all.ipk").touch()
            with patch("CI.create_ipk.subprocess.check_output", return_value="20260920\n"), \
                    patch("CI.create_ipk.time.strftime", return_value="20260928"):
                self.assertEqual(get_version(tmpdir), ("2.4.2", "git20260928-r0"))

    def test_existing_version_increments_highest_revision_across_dates(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            Path(tmpdir, "CHANGES.md").write_text("## Version 2.4.0\n", encoding="utf-8")
            for name in (
                "enigma2-plugin-extensions-openwebif_2.4.0-git20260920-r15_all.ipk",
                "enigma2-plugin-extensions-openwebif_2.4.0-git20260925-r16_all.ipk",
                "enigma2-plugin-extensions-openwebif_2.4.0-git20260928-r18_all.ipk",
                "enigma2-plugin-extensions-openwebif_2.4.0-git20260929-r99_arm.ipk",
                "enigma2-plugin-extensions-openwebif_2.4.01-git20260929-r99_all.ipk",
            ):
                Path(tmpdir, name).touch()
            with patch("CI.create_ipk.subprocess.check_output", return_value="20260920\n"), \
                    patch("CI.create_ipk.time.strftime", return_value="20260928"):
                self.assertEqual(get_version(tmpdir), ("2.4.0", "git20260928-r19"))

    def test_new_day_keeps_revision_sequence(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            Path(tmpdir, "CHANGES.md").write_text("## Version 2.4.0\n", encoding="utf-8")
            Path(tmpdir, "enigma2-plugin-extensions-openwebif_2.4.0-git20260928-r18_all.ipk").touch()
            with patch("CI.create_ipk.subprocess.check_output", return_value="20260920\n"), \
                    patch("CI.create_ipk.time.strftime", return_value="20260929"):
                self.assertEqual(get_version(tmpdir), ("2.4.0", "git20260929-r19"))

    def test_clock_behind_latest_package_does_not_downgrade(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            Path(tmpdir, "CHANGES.md").write_text("## Version 2.4.0\n", encoding="utf-8")
            Path(tmpdir, "enigma2-plugin-extensions-openwebif_2.4.0-git20260928-r18_all.ipk").touch()
            with patch("CI.create_ipk.subprocess.check_output", return_value="20260920\n"), \
                    patch("CI.create_ipk.time.strftime", return_value="20260920"):
                self.assertEqual(get_version(tmpdir), ("2.4.0", "git20260928-r19"))

    def test_without_git_uses_build_date(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            Path(tmpdir, "CHANGES.md").write_text("## Version 2.4.0\n", encoding="utf-8")
            with patch("CI.create_ipk.subprocess.check_output", side_effect=subprocess.CalledProcessError(1, "git")), \
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

            self.assertTrue(first.name.endswith("_2.4.0-git20260928-r0_all.ipk"))
            self.assertTrue(second.name.endswith("_2.4.0-git20260928-r1_all.ipk"))
            self.assertEqual(first.read_bytes(), first_contents)
            self.assertTrue(second.is_file())


if __name__ == "__main__":
    unittest.main()