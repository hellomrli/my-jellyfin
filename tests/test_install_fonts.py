import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import URLError


spec = importlib.util.spec_from_file_location("install_fonts", Path(__file__).parents[1] / "dev/install-fonts.py")
install_fonts = importlib.util.module_from_spec(spec)
spec.loader.exec_module(install_fonts)


class TestFontInstaller(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.output = self.root / "Fonts with spaces"
        self.manifest = self.root / "fonts.json"
        self.content = b"unmodified-font-data"
        self.entry = {
            "name": "Example-Regular.otf", "kind": "font",
            "url": "https://example.org/pinned/Example-Regular.otf",
            "sha256": hashlib.sha256(self.content).hexdigest(),
        }
        self.write_manifest([self.entry])
        self.enterContext(contextlib.redirect_stdout(io.StringIO()))

    def write_manifest(self, files):
        self.manifest.write_text(json.dumps({"files": files}), encoding="utf-8")

    def install(self, check_only=False):
        install_fonts.install_fonts(self.output, self.manifest, check_only)

    def test_repository_manifest_pins_four_fonts_and_both_licenses(self):
        manifest = install_fonts.load_manifest(install_fonts.DEFAULT_MANIFEST)
        self.assertRegex(manifest["revision"], r"^[0-9a-f]{40}$")
        self.assertEqual(len(manifest["files"]), 6)
        for family in ("Sans", "Serif"):
            for style in ("Regular", "Bold"):
                self.assertTrue(any(entry["name"] == f"Noto{family}CJKsc-{style}.otf"
                                    and entry["kind"] == "font" for entry in manifest["files"]))
            self.assertTrue(any(entry["name"] == f"LICENSE-Noto{family}CJK.txt"
                                and entry["kind"] == "license" for entry in manifest["files"]))
        for entry in manifest["files"]:
            self.assertTrue(entry["url"].startswith(
                f"https://raw.githubusercontent.com/notofonts/noto-cjk/{manifest['revision']}/"))

    def test_download_and_verified_cache(self):
        with patch.object(install_fonts, "urlopen", return_value=io.BytesIO(self.content)) as request:
            self.install()
            request.assert_called_once()
        self.assertEqual((self.output / self.entry["name"]).read_bytes(), self.content)
        with patch.object(install_fonts, "urlopen") as request:
            self.install()
            self.install(check_only=True)
            request.assert_not_called()

    def test_settings_offer_bundled_fonts_without_forcing_ass_styles(self):
        filename = Path(__file__).parents[1] / "resources/settings/settings_description.json"
        descriptions = json.loads(filename.read_text(encoding="utf-8"))
        subtitles = next(section for section in descriptions if section["section"] == "subtitles")
        values = {entry["value"]: entry for entry in subtitles["values"]}
        self.assertEqual(values["font"]["default"], "sans-serif")
        self.assertEqual(values["ass_style_override"]["default"], "")
        font_names = [option[0] for option in values["font"]["possible_values"]]
        for family in ("Noto Sans CJK SC", "Noto Serif CJK SC"):
            self.assertIn(family, font_names)

    def test_corrupt_cache_is_repaired(self):
        self.output.mkdir()
        (self.output / self.entry["name"]).write_bytes(b"partial-download")
        with patch.object(install_fonts, "urlopen", return_value=io.BytesIO(self.content)):
            self.install()
        self.assertEqual((self.output / self.entry["name"]).read_bytes(), self.content)
        self.assertEqual(len(list(self.output.iterdir())), 1)

    def test_wrong_hash_never_replaces_existing_file(self):
        self.output.mkdir()
        filename = self.output / self.entry["name"]
        filename.write_bytes(b"previous-version")
        with patch.object(install_fonts, "urlopen", return_value=io.BytesIO(b"wrong-content")):
            with self.assertRaisesRegex(ValueError, "SHA-256 mismatch"):
                self.install()
        self.assertEqual(filename.read_bytes(), b"previous-version")
        self.assertEqual(list(self.output.iterdir()), [filename])

    def test_network_failure_retries_then_cleans_temporary_files(self):
        with patch.object(install_fonts, "urlopen", side_effect=URLError("offline")) as request, \
                patch.object(install_fonts.time, "sleep"):
            with self.assertRaises(URLError):
                self.install()
            self.assertEqual(request.call_count, 3)
        self.assertEqual(list(self.output.iterdir()), [])

    def test_transient_network_failure_can_recover(self):
        with patch.object(install_fonts, "urlopen", side_effect=[URLError("retry"), io.BytesIO(self.content)]) as request, \
                patch.object(install_fonts.time, "sleep"):
            self.install()
            self.assertEqual(request.call_count, 2)
        self.assertEqual((self.output / self.entry["name"]).read_bytes(), self.content)

    def test_check_only_does_not_download_or_create_output(self):
        with patch.object(install_fonts, "urlopen") as request:
            with self.assertRaisesRegex(ValueError, "Missing or corrupt"):
                self.install(check_only=True)
            request.assert_not_called()
        self.assertFalse(self.output.exists())

    def test_rejects_unsafe_or_duplicate_names(self):
        for name in ("../escape.otf", "C:\\escape.otf", "nested/font.otf", "", ".", ".."):
            with self.subTest(name=name):
                self.write_manifest([{**self.entry, "name": name}])
                with self.assertRaisesRegex(ValueError, "Unsafe"):
                    self.install()
        self.write_manifest([self.entry, {**self.entry, "name": self.entry["name"].upper()}])
        with self.assertRaisesRegex(ValueError, "duplicate"):
            self.install()
        self.assertFalse(self.output.exists())

    def test_rejects_invalid_source_or_missing_checksum(self):
        for changes in ({"url": "http://example.org/font.otf"}, {"url": "file:///tmp/font.otf"},
                        {"sha256": ""}, {"kind": "unknown"}):
            with self.subTest(changes=changes):
                self.write_manifest([{**self.entry, **changes}])
                with self.assertRaises(ValueError):
                    self.install()
        self.assertFalse(self.output.exists())


if __name__ == "__main__":
    unittest.main()
