"""Translate one Russian music-style prompt to English using a local Argos model."""

from __future__ import annotations

import re
import sys

import argostranslate.translate


CYRILLIC_RE = re.compile(r"[\u0400-\u052F]")


def main() -> int:
    style = sys.stdin.buffer.read().decode("utf-8").strip()
    if not style or not CYRILLIC_RE.search(style):
        sys.stdout.write(style)
        return 0

    languages = argostranslate.translate.get_installed_languages()
    russian = next((language for language in languages if language.code == "ru"), None)
    english = next((language for language in languages if language.code == "en"), None)
    if russian is None or english is None:
        raise RuntimeError("The local Russian-to-English style translator is not installed")
    translation = russian.get_translation(english)
    if translation is None:
        raise RuntimeError("The local Russian-to-English style translator is unavailable")

    translated = translation.translate(style).strip()
    if not translated or CYRILLIC_RE.search(translated):
        raise RuntimeError("The local style translator did not return an English prompt")
    sys.stdout.write(translated)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"Style translation failed: {error}", file=sys.stderr)
        raise SystemExit(1)
