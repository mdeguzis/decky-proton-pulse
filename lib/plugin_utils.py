"""Low-level utilities shared across the plugin backend.

Nothing here depends on Plugin state - these are pure helpers for
cleaning up the environment and safely unpacking archives.
"""

from __future__ import annotations

import os
import tarfile
import zipfile
from pathlib import Path


def system_command_env() -> dict[str, str]:
    """Build a clean env dict for shelling out to system tools.

    Decky bundles its own Python via PyOxidizer, which means
    LD_LIBRARY_PATH points at bundled OpenSSL/readline instead of the
    system copies.  If that leaks into subprocess calls, curl dies with
    ``OPENSSL_3.2.0 not found`` (decky-loader#729) and bash hits
    ``undefined symbol: rl_trim_arg_from_keyseq`` (#756).  The SSL cert
    vars point at the bundled CA bundle that system curl can't use either.

    Stripping all of these lets lspci, curl, uname, and friends find
    their own libs the normal way.
    """
    env = os.environ.copy()
    for key in (
        "LD_LIBRARY_PATH",
        "SSL_CERT_FILE",
        "SSL_CERT_DIR",
        "REQUESTS_CA_BUNDLE",
        "CURL_CA_BUNDLE",
        "PYTHONHOME",
        "PYTHONPATH",
    ):
        env.pop(key, None)
    return env


def extract_archive_safely(archive_path: Path, extract_dir: Path) -> None:
    """Unpack a zip or tar, making sure nothing escapes *extract_dir*.

    Malicious archives can sneak in entries with paths like
    ``../../etc/passwd`` that write outside where you'd expect.  We
    resolve and check every member path before extracting anything.
    """
    extract_root = extract_dir.resolve()

    def _ensure_within_root(candidate: Path) -> None:
        resolved = candidate.resolve()
        if resolved != extract_root and extract_root not in resolved.parents:
            raise RuntimeError(
                f"Archive entry attempted to escape extraction root: {resolved}"
            )

    if zipfile.is_zipfile(archive_path):
        with zipfile.ZipFile(archive_path, "r") as archive:
            for member in archive.infolist():
                _ensure_within_root(extract_dir / member.filename)
            archive.extractall(extract_dir)
        return

    with tarfile.open(archive_path, "r:*") as tar_archive:
        for tar_member in tar_archive.getmembers():
            _ensure_within_root(extract_dir / tar_member.name)
        try:
            tar_archive.extractall(extract_dir, filter="data")
        except TypeError:
            tar_archive.extractall(extract_dir)
