"""Checks that the README's link to Slack's app-creation screen matches the manifest.

The link carries `deploy/slack-manifest.yml` percent-encoded into the URL, which a
reader can't check by eye. A failure prints the URL to replace the stale one with.
"""

import re
import unittest
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = (ROOT / "deploy/slack-manifest.yml").read_text()
CREATE_APP_PREFIX = "https://api.slack.com/apps?new_app=1&manifest_yaml="
# Percent-encoding leaves only unreserved characters, so the pattern ends where the
# URL does instead of running into the surrounding Markdown.
CREATE_APP_URL = re.compile(re.escape(CREATE_APP_PREFIX) + r"[A-Za-z0-9_.~%-]+")


class ManifestLinkTest(unittest.TestCase):
    def test_readme_links_the_manifest_in_deploy(self):
        urls = CREATE_APP_URL.findall((ROOT / "README.md").read_text())
        expected = CREATE_APP_PREFIX + quote(MANIFEST, safe="")
        self.assertTrue(urls)
        for url in urls:
            self.assertEqual(url, expected, f"Replace the stale link with:\n{expected}")
