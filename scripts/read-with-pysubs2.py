#!/usr/bin/env python3
"""Read a subtitle file with pysubs2 and print its cues as JSON.

pysubs2 is an independent implementation, in another language, sharing no code with subedit.
That is the whole reason it is here: it can disagree, and when it does the disagreement is
information. This script is deliberately thin, so what it reports is pysubs2's reading and
not a reinterpretation of it.

Usage: read-with-pysubs2.py <path> <format-identifier>
"""

import json
import sys

import pysubs2


def main() -> int:
    path, fmt = sys.argv[1], sys.argv[2]
    subs = pysubs2.load(path, format_=fmt)
    out = [
        {"start": line.start, "end": line.end, "text": line.plaintext}
        for line in subs
        if not line.is_comment
    ]
    json.dump(out, sys.stdout, ensure_ascii=False)
    return 0


if __name__ == "__main__":
    sys.exit(main())
