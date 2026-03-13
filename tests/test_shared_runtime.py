import sys
from pathlib import Path
import unittest


PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / 'core-api'))

import shared  # noqa: E402


class SharedRuntimeTests(unittest.TestCase):
    def setUp(self):
        shared._rate_limit_fallback.clear()
        shared._config_version_local = 0
        shared._config_version_cache['value'] = 0
        shared._config_version_cache['expires'] = 0

    def test_rate_limit_fallback_blocks_after_limit(self):
        self.assertTrue(shared.check_rate_limit('ip:test', 2, window_seconds=60))
        self.assertTrue(shared.check_rate_limit('ip:test', 2, window_seconds=60))
        self.assertFalse(shared.check_rate_limit('ip:test', 2, window_seconds=60))

    def test_mask_field_supports_legacy_values(self):
        encrypted = shared._legacy_encrypt('1234567890')
        self.assertEqual(shared.mask_field(encrypted), '***7890')

    def test_versioned_cache_invalidates_on_version_bump(self):
        cache = shared.VersionedTTLCache(ttl_seconds=30)
        cache.set('services', {'ok': True})
        self.assertEqual(cache.get('services'), {'ok': True})
        shared._bump_config_version()
        self.assertIsNone(cache.get('services'))


if __name__ == '__main__':
    unittest.main()
