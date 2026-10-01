import os
from pathlib import Path
import shutil
import subprocess
import unittest
from unittest.mock import patch

from hardware_safety import require_hardware_access


class HardwareSafetyTests(unittest.TestCase):
    def test_access_is_denied_without_explicit_consent(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(RuntimeError):
                require_hardware_access('192.0.2.1')

    def test_access_is_denied_without_explicit_target(self):
        with patch.dict(os.environ, {'OPENWEBIF_ALLOW_HARDWARE_TESTS': 'YES'}, clear=True):
            with self.assertRaises(RuntimeError):
                require_hardware_access(None)

    def test_access_requires_both_consent_and_target(self):
        with patch.dict(os.environ, {'OPENWEBIF_ALLOW_HARDWARE_TESTS': 'YES'}, clear=True):
            self.assertEqual(require_hardware_access('192.0.2.1'), '192.0.2.1')

    def test_receiver_request_does_not_connect_without_consent(self):
        from receiver_release_check import request_bytes

        with patch.dict(os.environ, {}, clear=True), patch('urllib.request.urlopen') as urlopen:
            with self.assertRaises(RuntimeError):
                request_bytes({'IP': '192.0.2.1', 'username': 'test', 'password': 'test'}, '/api/statusinfo')
            urlopen.assert_not_called()

    def test_http_receiver_tests_skip_even_with_target_without_consent(self):
        from movie_files_testsuite import MoviefilesTestCase
        from status_quo_file_controller import TestEnigma2FileAPICalls

        with patch.dict(os.environ, {'ENIGMA2_HTTP_API_HOST': '192.0.2.1'}, clear=True), \
                patch('requests.sessions.Session.request') as request:
            for test_case in (MoviefilesTestCase, TestEnigma2FileAPICalls):
                suite = unittest.defaultTestLoader.loadTestsFromTestCase(test_case)
                result = unittest.TestResult()
                suite.run(result)
                self.assertEqual(len(result.skipped), result.testsRun)
                self.assertEqual(result.errors, [])
            request.assert_not_called()

    @unittest.skipUnless(shutil.which('node'), 'Node.js nicht installiert')
    def test_browser_probe_does_not_fetch_without_consent(self):
        script = Path(__file__).with_name('probe_timer_tags_receiver.js')
        environment = {key: value for key, value in os.environ.items()
                       if key != 'OPENWEBIF_ALLOW_HARDWARE_TESTS'}
        environment.update({'OPENWEBIF_TEST_RECEIVER_HOST': '192.0.2.1',
                            'OPENWEBIF_TEST_RECEIVER_USER': 'test',
                            'OPENWEBIF_TEST_RECEIVER_PASSWORD': 'test'})
        result = subprocess.run(
            ['node', '-e', "global.fetch = () => { throw Error('Netzwerkzugriff'); }; require(process.argv[1]);", str(script)],
            env=environment, capture_output=True, text=True, timeout=10,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('Freigabe, Zieladresse', result.stdout)


if __name__ == '__main__':
    unittest.main()