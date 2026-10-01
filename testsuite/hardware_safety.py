"""Opt-in gate for manual checks that would contact a real receiver."""

import os


def require_hardware_access(target):
    if os.environ.get('OPENWEBIF_ALLOW_HARDWARE_TESTS') != 'YES' or not target:
        raise RuntimeError('Live-Geräteprüfungen sind gesperrt. Nur manuell mit '
                           'OPENWEBIF_ALLOW_HARDWARE_TESTS=YES und expliziter Zieladresse freigeben.')
    return target