import ast
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock


ROOT = Path(__file__).resolve().parents[1]


class Reference:
    def __init__(self, value):
        self.value = value

    def toString(self):
        return self.value

    def valid(self):
        return self.value.startswith('1:7:')


class BouquetList:
    def __init__(self, name='', services=()):
        self.name = name
        self.services = list(services)
        self.flushChanges = Mock()

    def getContent(self, kind, _):
        if kind == 'R':
            return list(self.services)
        raise AssertionError(kind)

    def startEdit(self):
        return self

    def setListName(self, name):
        self.name = name

    def addService(self, ref):
        self.services.append(ref)
        return 0

    def removeService(self, ref):
        self.services = [service for service in self.services if service.toString() != ref.toString()]
        return 0


class BouquetDuplicateTests(unittest.TestCase):
    def setUp(self):
        output = redirect_stdout(StringIO())
        output.__enter__()
        self.addCleanup(output.__exit__, None, None, None)
        source = ast.parse((ROOT / 'plugin/controllers/BouquetEditor.py').read_text(encoding='utf-8'))
        editor = next(node for node in source.body if isinstance(node, ast.ClassDef) and node.name == 'BouquetEditor')
        self.roots = {0: 'tv-root', 1: 'radio-root'}
        self.lists = {root: BouquetList() for root in self.roots.values()}
        self.db = SimpleNamespace(reloadBouquets=Mock())
        self.center = SimpleNamespace(list=self.list_services, info=lambda ref: SimpleNamespace(
            getName=lambda _: self.lists[ref.toString()].name))
        namespace = {
            'Source': type('Source', (), {}), '_': lambda text: text,
            'eServiceReference': Reference,
            'eServiceCenter': SimpleNamespace(getInstance=lambda: self.center),
            'eDVBDB': SimpleNamespace(getInstance=lambda: self.db),
            'config': SimpleNamespace(usage=SimpleNamespace(multibouquet=SimpleNamespace(value=True))),
            'InfoBar': SimpleNamespace(instance=None),
            'MODE_TV': 0, 'MODE_RADIO': 1,
            'ROOTTV': self.roots[0], 'ROOTRADIO': self.roots[1],
            'ETCENIGMA': '/test/enigma2', 'pathjoin': lambda *parts: '/'.join(parts),
            'exists': lambda _: False,
            'remove': Mock(),
        }
        exec(compile(ast.Module(body=[editor], type_ignores=[]), str(ROOT / 'plugin/controllers/BouquetEditor.py'), 'exec'), namespace)
        self.editor = namespace['BouquetEditor'](None)

    def list_services(self, ref):
        return self.lists.setdefault(ref.toString(), BouquetList())

    def add_source(self, name='Favoriten', services=(), mode=0):
        suffix = 'tv' if mode == 0 else 'radio'
        ref = Reference(f'1:7:{1 if mode == 0 else 2}:0:0:0:0:0:0:0:FROM BOUQUET "userbouquet.source.{suffix}" ORDER BY bouquet')
        self.lists[ref.toString()] = BouquetList(name, services)
        self.lists[self.roots[mode]].services.append(ref)
        return ref

    def duplicate(self, ref):
        self.editor.func = self.editor.DUPLICATE_BOUQUET
        self.editor.handleCommand({'sBouquetRef': ref.toString() if ref else None})
        return self.editor.result

    def copied_list(self, mode=0):
        return self.lists[self.lists[self.roots[mode]].services[-1].toString()]

    def test_copies_all_references_in_order_without_changing_source(self):
        services = [Reference(value) for value in ('DVB channel', 'Marker: Nachrichten', 'Spacer', 'IPTV: https://example.invalid/live', 'Alternative group')]
        source = self.add_source('ÖR & Nachrichten (TV)', services)
        self.assertTrue(self.duplicate(source)[0])
        self.assertEqual(self.copied_list().name, 'ÖR & Nachrichten (TV) - Kopie 1')
        self.assertEqual(self.copied_list().services, services)
        self.assertEqual(self.lists[source.toString()].name, 'ÖR & Nachrichten (TV)')
        self.assertEqual(self.lists[source.toString()].services, services)
        self.copied_list().flushChanges.assert_called_once()
        self.db.reloadBouquets.assert_called_once()

    def test_repeated_copies_get_unique_numbered_names_and_files(self):
        source = self.add_source()
        for number in range(1, 4):
            self.assertTrue(self.duplicate(source)[0])
            self.assertEqual(self.copied_list().name, f'Favoriten - Kopie {number}')
        refs = self.lists[self.roots[0]].services
        self.assertEqual(len({ref.toString() for ref in refs}), 4)

    def test_radio_and_empty_bouquets(self):
        source = self.add_source('Radio', mode=1)
        self.assertTrue(self.duplicate(source)[0])
        self.assertEqual(self.copied_list(1).name, 'Radio - Kopie 1')
        self.assertEqual(self.copied_list(1).services, [])
        self.assertEqual(self.lists[self.roots[0]].services, [])
        self.assertIn('.radio"', self.lists[self.roots[1]].services[-1].toString())

    def test_existing_copy_names_are_not_reused(self):
        source = self.add_source()
        self.lists[self.roots[0]].services.append(Reference('existing'))
        self.lists['existing'] = BouquetList('Favoriten - Kopie 1')
        self.assertTrue(self.duplicate(source)[0])
        self.assertEqual(self.copied_list().name, 'Favoriten - Kopie 2')

    def test_copy_of_copy_appends_suffix_to_selected_name(self):
        source = self.add_source('Favoriten - Kopie 1')
        self.assertTrue(self.duplicate(source)[0])
        self.assertEqual(self.copied_list().name, 'Favoriten - Kopie 1 - Kopie 1')

    def test_missing_invalid_or_unknown_source_does_not_create_bouquet(self):
        for ref in (None, Reference('invalid'), Reference('1:7:1:unknown')):
            with self.subTest(ref=ref):
                self.assertFalse(self.duplicate(ref)[0])
                self.assertEqual(self.lists[self.roots[0]].services, [])
                self.assertEqual(self.lists[self.roots[1]].services, [])

    def test_unreadable_source_does_not_create_empty_copy(self):
        source = self.add_source()
        self.center.list = lambda ref: None if ref.toString() == source.toString() else self.list_services(ref)
        self.assertFalse(self.duplicate(source)[0])
        self.assertEqual(len(self.lists[self.roots[0]].services), 1)

    def test_multi_bouquet_disabled(self):
        source = self.add_source()
        self.editor.duplicateBouquet.__globals__['config'].usage.multibouquet.value = False
        self.assertFalse(self.duplicate(source)[0])
        self.assertEqual(len(self.lists[self.roots[0]].services), 1)

    def test_existing_add_bouquet_still_adds_mode_suffix(self):
        self.assertTrue(self.editor.addBouquet('Neu', 0, None)[0])
        self.assertEqual(self.copied_list().name, 'Neu (TV)')

    def test_failed_service_copy_is_reported_and_removed_from_bouquet_list(self):
        source = self.add_source(services=[Reference('channel')])
        original_list = self.center.list

        def failing_list(ref):
            result = original_list(ref)
            if ref.toString() not in (source.toString(), *self.roots.values()):
                result.addService = Mock(return_value=1)
            return result

        self.center.list = failing_list
        self.assertFalse(self.duplicate(source)[0])
        self.assertEqual(self.lists[self.roots[0]].services, [source])
        self.assertEqual(len(self.lists[source.toString()].services), 1)
        self.editor.duplicateBouquet.__globals__['remove'].assert_called_once()

    def test_api_passes_reference_and_returns_result(self):
        source = self.add_source('Sender')
        tree = ast.parse((ROOT / 'plugin/controllers/BQE.py').read_text(encoding='utf-8'))
        controller = next(node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == 'BQEWebController')
        namespace = {
            'BaseController': type('BaseController', (), {'__init__': lambda self, **kwargs: None}),
            'BouquetEditor': type(self.editor),
            'toBinary': lambda value: value.encode('utf-8'),
            'toString': lambda value: value.decode('utf-8'),
        }
        exec(compile(ast.Module(body=[controller], type_ignores=[]), 'BQE.py', 'exec'), namespace)
        api = namespace['BQEWebController'](None)
        api.session = None
        api.isJson = True
        result = api.P_duplicatebouquet(SimpleNamespace(args={b'sBouquetRef': [source.toString().encode('utf-8')]}))
        self.assertTrue(result['Result'][0])
        self.assertEqual(self.copied_list().name, 'Sender - Kopie 1')
        self.assertFalse(api.withMainTemplate)


if __name__ == '__main__':
    unittest.main()