#!/usr/bin/env python3
"""aqt install-qt with support for Qt 6.12's versioned WebEngine repository.

Install requirements-build.txt first. Arguments are the same as aqt install-qt.
Downloads, checksums, extraction and relocation are still handled by aqt.
"""

import posixpath
import sys
from importlib.metadata import version
from multiprocessing import freeze_support

import aqt.installer
from aqt.archives import ModuleToPackage, QtArchives, UpdateXmls
from aqt.exceptions import ArchiveListError
from aqt.metadata import Version


class DesktopArchives(QtArchives):
    def _arch_ext(self):
        if self.version >= Version("6.11.0") and self.os_name == "windows" and self.arch == "win64_msvc2022_64":
            return "_msvc2022_64"
        return super()._arch_ext()

    def _get_archives(self):
        if str(self.version) != "6.12.0" or "qtwebengine" not in self.mod_list:
            return super()._get_archives()

        hosts = {
            "windows": ("windows_x86", "msvc2022_64", "win64_msvc2022_64"),
            "mac": ("mac_x64", "clang_64", "clang_64"),
            "linux": ("linux_x64", "x86_64", "linux_gcc_64"),
        }
        if self.os_name not in hosts or self.target != "desktop":
            raise ArchiveListError("The Qt 6.12 WebEngine installer supports desktop Windows x64, macOS and Linux x64.")
        host, repository_arch, package_arch = hosts[self.os_name]
        if self.arch != package_arch:
            raise ArchiveListError(f"Use architecture '{package_arch}' for Qt 6.12 WebEngine on {self.os_name}.")

        # Do not let aqt select the obsolete, pre-release July WebEngine build.
        self.mod_list.remove("qtwebengine")
        try:
            super()._get_archives()
        finally:
            self.mod_list.add("qtwebengine")

        repository = posixpath.join(
            "online/qtsdkrepository", host, "extensions/qtwebengine/6120/61400", repository_arch
        )
        package = f"extensions.qtwebengine.6120.61400.{package_arch}"
        self.logger.info("Selecting the Qt 6.12.0 WebEngine package from the versioned 6120/61400 repository.")
        metadata = self._download_update_xml(posixpath.join(repository, "Updates.xml"))
        self._parse_update_xmls(
            [UpdateXmls(repository, metadata)], ModuleToPackage({"qtwebengine": [package]})
        )


def main():
    # This adapter uses aqt's repository API; keep it in sync with the pinned version.
    if version("aqtinstall") != "3.3.0":
        print("Install dev/requirements-build.txt before running this installer.", file=sys.stderr)
        return 1
    freeze_support()
    aqt.installer.QtArchives = DesktopArchives
    return aqt.installer.Cli().run(["install-qt", *sys.argv[1:]])


if __name__ == "__main__":
    sys.exit(main())
