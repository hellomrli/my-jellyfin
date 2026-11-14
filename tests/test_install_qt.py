import importlib.util
from pathlib import Path
import unittest

from aqt.exceptions import ArchiveDownloadError, ArchiveListError


spec = importlib.util.spec_from_file_location("install_qt", Path(__file__).parents[1] / "dev/install-qt.py")
install_qt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(install_qt)


class MetadataArchives(install_qt.DesktopArchives):
    """Exercise aqt's real package selection/extraction paths without network I/O."""

    missing_versioned_engine = False

    def __init__(self, *args, **kwargs):
        self.requests = []
        super().__init__(*args, **kwargs)

    def _package(self, name, archives, package_version=None):
        directory = {"linux": "gcc_64", "mac": "macos", "windows": "msvc2022_64"}[self.os_name]
        package_version = package_version or f"{self.version}-0-202609281005"
        operations = "".join(
            f'<Operation name="Extract"><Argument>@TargetDir@/{self.version}/{directory}</Argument>'
            f'<Argument>{archive}</Argument></Operation>' for archive in archives
        )
        return (
            f"<Updates><PackageUpdate><Name>{name}</Name><Version>{package_version}</Version>"
            f"<Operations>{operations}</Operations></PackageUpdate></Updates>"
        )

    def _download_update_xml(self, path, silent=False):
        self.requests.append(path)
        compact_version = str(self.version).replace(".", "")
        if "/desktop/" in path:
            return self._package(f"qt.qt6.{compact_version}.{self.arch}", ["qtbase-test.7z"])
        if "/61400/" in path:
            if self.missing_versioned_engine:
                raise ArchiveDownloadError("Versioned WebEngine metadata unavailable")
            return self._package(
                f"extensions.qtwebengine.6120.61400.{self.arch}",
                ["qtwebengine-new.7z", "qtwebview_qtwebengine_plugin.7z"],
                package_version="6.12.0-0-202611110526",
            )
        if "/extensions/qtwebengine/" in path:
            return self._package(f"extensions.qtwebengine.{compact_version}.{self.arch}", ["qtwebengine-old.7z"])
        return None


class TestQtInstaller(unittest.TestCase):
    def archives(self, host="linux", arch="linux_gcc_64", version="6.12.0", **kwargs):
        return MetadataArchives(host, "desktop", version, arch, "https://download.qt.io",
                                modules=kwargs.pop("modules", ["qtwebengine"]), **kwargs)

    def test_latest_webengine_replaces_legacy_build_on_each_platform(self):
        platforms = [
            ("linux", "linux_gcc_64", "linux_x64", "x86_64", "gcc_64"),
            ("windows", "win64_msvc2022_64", "windows_x86", "msvc2022_64", "msvc2022_64"),
            ("mac", "clang_64", "mac_x64", "clang_64", "macos"),
        ]
        for host, arch, repository_host, repository_arch, directory in platforms:
            with self.subTest(host=host):
                result = self.archives(host, arch)
                engine = next(package for package in result.archives if package.name == "qtwebengine")
                self.assertIn(f"{repository_host}/extensions/qtwebengine/6120/61400/{repository_arch}/", engine.archive_path)
                self.assertEqual(engine.archive, "qtwebengine-new.7z")
                self.assertEqual(engine.archive_install_path, f"6.12.0/{directory}")
                for package in result.archives:
                    if "/61400/" in package.archive_path:
                        self.assertTrue(package.archive_path.endswith(f"/6.12.0-0-202611110526{package.archive}"))
                        self.assertEqual(package.archive_install_path, f"6.12.0/{directory}")
                self.assertFalse(any(package.archive == "qtwebengine-old.7z" for package in result.archives))
                self.assertEqual(len(result.archives), 3)
                if host == "windows":
                    self.assertIn("/qt6_6120/qt6_6120_msvc2022_64/", result.requests[0])

    def test_noarchives_repairs_webengine_without_reinstalling_base(self):
        result = self.archives(is_include_base_package=False)
        self.assertEqual([package.archive for package in result.archives],
                         ["qtwebengine-new.7z", "qtwebview_qtwebengine_plugin.7z"])

    def test_base_only_install_does_not_add_webengine(self):
        result = self.archives(modules=[])
        self.assertEqual([package.archive for package in result.archives], ["qtbase-test.7z"])
        self.assertFalse(any("/61400/" in path for path in result.requests))

    def test_older_qt_keeps_its_matching_webengine(self):
        for version, directory in [("6.11.3", "qt6_6113_msvc2022_64"), ("6.9.3", "qt6_693")]:
            with self.subTest(version=version):
                result = self.archives("windows", "win64_msvc2022_64", version)
                self.assertTrue(result.requests[0].endswith(f"/{directory}/Updates.xml"))
                self.assertFalse(any("/61400/" in path for path in result.requests))
                self.assertEqual(result.archives[-1].archive, "qtwebengine-old.7z")

    def test_missing_new_package_fails_instead_of_silently_using_july_build(self):
        MetadataArchives.missing_versioned_engine = True
        try:
            with self.assertRaises(ArchiveListError):
                self.archives()
        finally:
            MetadataArchives.missing_versioned_engine = False

    def test_unsupported_architecture_fails_before_download(self):
        with self.assertRaises(ArchiveListError):
            self.archives("windows", "win64_msvc2022_arm64")


if __name__ == "__main__":
    unittest.main()
