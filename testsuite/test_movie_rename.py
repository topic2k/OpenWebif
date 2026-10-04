import ast
from contextlib import redirect_stdout
from io import StringIO
import os
from pathlib import Path
import shutil
from stat import S_IMODE
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch


MOVIES = Path(__file__).resolve().parents[1] / 'plugin/controllers/models/movies.py'
SIDECARS = ('.eit', '.jpg', '.ts.cuts', '.ts.meta', '.txt', '.ts.ap', '.ts.sc', '.ts_mp.jpg')
METADATA = b'1:0:1:service:\nOriginal title\nDescription\n12345\nFilm Series\n'


class ServiceReferenceDouble:
    mustDescent = 1

    def __init__(self, filename, flags=0):
        self.filename = str(filename)
        self.flags = flags

    def getPath(self):
        return self.filename


class MovieRenameTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        source = ast.parse(MOVIES.read_text(encoding='utf-8'))
        names = ('movieAction', 'createActionList', 'movieActionService', '_renameRecording')
        nodes = [node for node in source.body
                 if (isinstance(node, ast.FunctionDef) and node.name in names)
                 or (isinstance(node, ast.ImportFrom) and node.module in
                     ('os', 'os.path', 'stat', 'tempfile'))]
        if not hasattr(os, 'statvfs'):
            nodes = [ast.copy_location(ast.ImportFrom(module=node.module, names=[
                alias for alias in node.names if alias.name != 'statvfs'], level=node.level), node)
                if isinstance(node, ast.ImportFrom) and node.module == 'os' else node for node in nodes]
        cls.code = compile(ast.Module(body=nodes, type_ignores=[]), str(MOVIES), 'exec')

    def setUp(self):
        output = redirect_stdout(StringIO())
        output.__enter__()
        self.addCleanup(output.__exit__, None, None, None)
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.folder = Path(self.tmp.name)
        self.movie = self.folder / 'original.ts'
        self.movie.write_bytes(b'recording data')
        for suffix in SIDECARS:
            (self.folder / ('original' + suffix)).write_bytes(
                METADATA if suffix == '.ts.meta' else suffix.encode())
        self.service = ServiceReferenceDouble(self.movie)
        self.namespace = {
            'eServiceReference': ServiceReferenceDouble,
            'eServiceCenter': SimpleNamespace(getInstance=lambda: SimpleNamespace(
                info=lambda _: SimpleNamespace(getName=lambda _: 'Original title'))),
            'config': SimpleNamespace(EMC=SimpleNamespace(needsreload=SimpleNamespace(value=False))),
            'moveFiles': Mock(side_effect=lambda items, _: [os.rename(src, dst) for src, dst in items]),
            'copyFiles': Mock(side_effect=lambda items, _: [shutil.copyfile(src, dst) for src, dst in items]),
            'statvfs': lambda dest: SimpleNamespace(f_bfree=shutil.disk_usage(dest).free, f_bsize=1),
        }
        exec(self.code, self.namespace)

    def snapshot(self):
        return {str(file.relative_to(self.folder)): file.read_bytes()
                for file in self.folder.rglob('*') if file.is_file()}

    def rename(self, newname='Neu & schön'):
        return self.namespace['movieActionService'](self.service, None, 'Original title', True, newname, 'rename')

    def test_action_list_uses_original_sources_and_new_destinations(self):
        items = self.namespace['createActionList'](self.service, None, 'renamed')
        self.assertEqual(items, [(str(self.movie), str(self.folder / 'renamed.ts'))] + [
            (str(self.folder / ('original' + suffix)), str(self.folder / ('renamed' + suffix)))
            for suffix in SIDECARS])

    def test_success_renames_recording_and_all_sidecars_and_updates_only_title(self):
        before = self.snapshot()
        self.rename()
        expected = {name.replace('original', 'Neu & schön', 1): content for name, content in before.items()}
        expected['Neu & schön.ts.meta'] = METADATA.replace(b'Original title', 'Neu & schön'.encode())
        self.assertEqual(self.snapshot(), expected)

    def test_short_metadata_is_rejected_before_moving_any_file(self):
        for content in (b'', b'service', b'service\n'):
            with self.subTest(content=content):
                self.movie.with_suffix('.ts.meta').write_bytes(content)
                before = self.snapshot()
                with self.assertRaisesRegex(ValueError, 'metadata.*title'):
                    self.rename()
                self.assertEqual(self.snapshot(), before)

    def test_short_metadata_in_explicit_move_plan_is_rejected_before_mutation(self):
        meta = self.movie.with_suffix('.ts.meta')
        meta.write_bytes(b'service\n')
        items = [(str(self.movie), str(self.folder / 'renamed.ts')),
                 (str(meta), str(self.folder / 'renamed.ts.meta'))]
        before = self.snapshot()
        with patch.dict(self.namespace, createActionList=Mock(return_value=items)):
            with self.assertRaisesRegex(ValueError, 'metadata.*title'):
                self.rename('renamed')
        self.assertEqual(self.snapshot(), before)

    def test_metadata_preserves_legacy_bytes_line_endings_and_missing_final_newline(self):
        for content in (b'service\r\nOld\r\nLegacy \xff\r\n123\r\nTags',
                        b'service\nOld', b'service\n\n'):
            with self.subTest(content=content):
                self.movie.with_suffix('.ts.meta').write_bytes(content)
                self.rename('original')
                self.assertEqual(self.movie.with_suffix('.ts.meta').read_bytes(),
                                 content.replace(b'Old', b'original') if b'Old' in content
                                 else b'service\noriginal\n')

    def test_missing_metadata_does_not_prevent_rename(self):
        self.movie.with_suffix('.ts.meta').unlink()
        before = self.snapshot()
        self.rename('renamed')
        self.assertEqual(self.snapshot(), {name.replace('original', 'renamed', 1): content
                                          for name, content in before.items()})

    def test_invalid_name_does_not_change_files(self):
        before = self.snapshot()
        for name in ('', '.', '..', '../bad', 'bad/name', 'bad\\name', 'bad\nname', 'bad\rname', 'bad\x00name'):
            with self.subTest(name=name):
                with self.assertRaisesRegex(ValueError, 'Invalid recording name'):
                    self.rename(name)
                self.assertEqual(self.snapshot(), before)

    def test_existing_destination_is_never_overwritten(self):
        for suffix in ('.ts', '.ts.meta', '.eit'):
            target = self.folder / ('renamed' + suffix)
            target.write_bytes(b'unrelated recording')
            before = self.snapshot()
            with self.subTest(suffix=suffix):
                with self.assertRaisesRegex(OSError, 'Destination already exists'):
                    self.rename('renamed')
                self.assertEqual(self.snapshot(), before)
            target.unlink()

    def test_metadata_read_failure_does_not_change_files(self):
        before = self.snapshot()
        with patch('builtins.open', side_effect=OSError('read denied')):
            with self.assertRaisesRegex(OSError, 'read denied'):
                self.rename()
        self.assertEqual(self.snapshot(), before)

    def test_metadata_staging_write_failure_leaves_originals_and_no_temporary_file(self):
        before = self.snapshot()

        def failing_file(*args, **kwargs):
            file = tempfile.NamedTemporaryFile(*args, **kwargs)
            write = file.write

            def fail(content):
                write(content[:4])
                raise OSError('disk full')

            file.write = fail
            return file

        with patch.dict(self.namespace, NamedTemporaryFile=failing_file):
            with self.assertRaisesRegex(OSError, 'disk full'):
                self.rename()
        self.assertEqual(self.snapshot(), before)

    def test_staging_creation_sync_or_permission_failure_does_not_change_originals(self):
        before = self.snapshot()
        for operation in ('NamedTemporaryFile', 'fsync', 'chmod'):
            with self.subTest(operation=operation):
                with patch.dict(self.namespace, {operation: Mock(side_effect=OSError('staging failed'))}):
                    with self.assertRaisesRegex(OSError, 'staging failed'):
                        self.rename()
                self.assertEqual(self.snapshot(), before)

    def test_metadata_commit_is_atomic_and_preserves_permissions(self):
        meta = self.movie.with_suffix('.ts.meta')
        meta.chmod(0o640)
        mode = S_IMODE(meta.stat().st_mode)
        calls = []

        def commit(src, dst):
            calls.append((src, dst))
            self.assertEqual(Path(dst).read_bytes(), METADATA)
            self.assertEqual(Path(src).read_bytes(), METADATA.replace(b'Original title', b'renamed'))
            self.assertEqual(S_IMODE(Path(src).stat().st_mode), mode)
            self.assertFalse(self.movie.exists())
            os.replace(src, dst)

        with patch.dict(self.namespace, replace=commit):
            self.rename('renamed')
        self.assertEqual(len(calls), 1)
        self.assertEqual(S_IMODE((self.folder / 'renamed.ts.meta').stat().st_mode), mode)
        self.assertEqual(set(self.snapshot()), {'renamed.ts'} | {'renamed' + suffix for suffix in SIDECARS})

    def test_atomic_replace_failure_rolls_back_all_file_names_and_metadata(self):
        before = self.snapshot()
        with patch.dict(self.namespace, replace=Mock(side_effect=OSError('replace denied'))):
            with self.assertRaisesRegex(OSError, 'replace denied'):
                self.rename()
        self.assertEqual(self.snapshot(), before)

    def test_first_move_failure_leaves_originals_and_no_temporary_file(self):
        before = self.snapshot()
        with patch.dict(self.namespace, rename=Mock(side_effect=OSError('move denied'))):
            with self.assertRaisesRegex(OSError, 'move denied'):
                self.rename()
        self.assertEqual(self.snapshot(), before)

    def test_move_failure_rolls_back_already_renamed_files(self):
        before = self.snapshot()
        calls = []

        def fail_third_move(src, dst):
            calls.append((src, dst))
            if len(calls) == 3:
                raise OSError('move denied')
            os.rename(src, dst)

        with patch.dict(self.namespace, rename=fail_third_move):
            with self.assertRaisesRegex(OSError, 'move denied'):
                self.rename()
        self.assertEqual(len(calls), 5)
        self.assertEqual(self.snapshot(), before)

    def test_rollback_failure_is_reported_with_original_error_and_affected_paths(self):
        calls = []

        def fail_move_and_rollback(src, dst):
            calls.append((src, dst))
            if len(calls) >= 3:
                raise OSError('move denied' if len(calls) == 3 else 'rollback denied')
            os.rename(src, dst)

        with patch.dict(self.namespace, rename=fail_move_and_rollback):
            result = self.namespace['movieAction'](None, str(self.movie), domove=True, newname='renamed')
        self.assertFalse(result['result'])
        for value in ('incomplete', 'move denied', 'rollback denied', 'renamed.ts', 'renamed.eit'):
            self.assertIn(value, result['message'])
        self.assertEqual(len(calls), 5)
        self.assertEqual(self.movie.with_suffix('.ts.meta').read_bytes(), METADATA)
        self.assertFalse(self.namespace['config'].EMC.needsreload.value)
        self.assertEqual(set(self.snapshot()), {'renamed.ts', 'renamed.eit'} | {
            'original' + suffix for suffix in SIDECARS if suffix != '.eit'})

    def test_cleanup_failure_reports_original_failure_and_temporary_path(self):
        before = self.snapshot()
        with patch.dict(self.namespace, fsync=Mock(side_effect=OSError('sync failed')),
                        unlink=Mock(side_effect=OSError('cleanup denied'))):
            with self.assertRaisesRegex(OSError, 'incomplete.*sync failed.*Temporary metadata.*cleanup denied'):
                self.rename()
        after = self.snapshot()
        self.assertEqual({name: after[name] for name in before}, before)
        self.assertEqual(len(set(after) - set(before)), 1)

    def test_api_reports_failure_for_invalid_metadata_without_mutation(self):
        self.movie.with_suffix('.ts.meta').write_bytes(b'service\n')
        before = self.snapshot()
        result = self.namespace['movieAction'](None, str(self.movie), domove=True, newname='renamed')
        self.assertFalse(result['result'])
        self.assertIn('metadata', result['message'])
        self.assertEqual(self.snapshot(), before)

    def test_api_success_only_after_all_files_and_metadata_are_updated(self):
        result = self.namespace['movieAction'](None, str(self.movie), domove=True, newname='renamed')
        self.assertTrue(result['result'])
        self.assertTrue(self.namespace['config'].EMC.needsreload.value)
        self.assertEqual((self.folder / 'renamed.ts.meta').read_bytes(),
                         METADATA.replace(b'Original title', b'renamed'))
        self.assertEqual(set(self.snapshot()), {'renamed.ts'} | {'renamed' + suffix for suffix in SIDECARS})
        self.namespace['moveFiles'].assert_not_called()

    def test_non_ts_recording_uses_its_own_extension_and_sidecars(self):
        filename = self.folder / 'other.mp4'
        filename.write_bytes(b'mp4 recording')
        (self.folder / 'other.mp4.meta').write_bytes(METADATA)
        service = ServiceReferenceDouble(filename)
        before = self.snapshot()
        self.namespace['movieActionService'](service, None, 'Original title', True, 'renamed', 'rename')
        expected = {name.replace('other', 'renamed', 1): content for name, content in before.items()}
        expected['renamed.mp4.meta'] = METADATA.replace(b'Original title', b'renamed')
        self.assertEqual(self.snapshot(), expected)

    def test_directory_rename_keeps_children_and_does_not_add_an_extension(self):
        directory = self.folder / 'series.folder'
        directory.mkdir()
        (directory / 'episode.ts').write_bytes(b'episode')
        before = self.snapshot()
        service = ServiceReferenceDouble(directory, flags=ServiceReferenceDouble.mustDescent)
        self.namespace['movieActionService'](service, None, 'Series', True, 'renamed', 'rename')
        self.assertEqual(self.snapshot(), {name.replace('series.folder', 'renamed', 1): content
                                          for name, content in before.items()})

    def test_copy_and_move_keep_existing_helpers_and_metadata_content(self):
        for domove in (False, True):
            with self.subTest(domove=domove):
                destination = self.folder / ('move' if domove else 'copy')
                destination.mkdir()
                self.namespace['movieActionService'](self.service, str(destination), 'Original title',
                                                     domove, None, 'move' if domove else 'copy')
                self.assertEqual((destination / 'original.ts.meta').read_bytes(), METADATA)
                helper = self.namespace['moveFiles' if domove else 'copyFiles']
                helper.assert_called_once()
                self.assertEqual(self.movie.exists(), not domove)


if __name__ == '__main__':
    unittest.main()
