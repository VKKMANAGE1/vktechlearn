"""Build the minified CSS/JS that the live pages load.

Sources stay readable in the repo (pages.css, pdf/style.css, pdf/app.js,
img/app.js); this script writes the compressed copies next to them:

    pages.min.css
    pdf/style.min.css
    pdf/app.min.js
    img/app.min.js

Run it after editing any of those sources and commit the .min files with the
source:

    python3 tools/minify_assets.py

Deployment needs nothing extra — GitHub Pages only serves the committed files,
so the workflow does not have to run esbuild.
"""

import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ESBUILD = ["npx", "--yes", "esbuild@0.24.0"]

TARGETS = [
    ("pages.css", "pages.min.css", False),
    ("post.css", "post.min.css", False),
    ("pdf/style.css", "pdf/style.min.css", False),
    ("pdf/app.js", "pdf/app.min.js", True),
    ("img/app.js", "img/app.min.js", True),
]


def build(src, dst, is_js):
    src_path = os.path.join(ROOT, src)
    dst_path = os.path.join(ROOT, dst)
    if not os.path.exists(src_path):
        print(f"skip (missing): {src}")
        return False
    cmd = ESBUILD + [src_path, "--minify", "--outfile=" + dst_path]
    if is_js:
        cmd += ["--target=es2019"]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"FAILED {src}\n{result.stderr.strip()}")
        return False
    before = os.path.getsize(src_path)
    after = os.path.getsize(dst_path)
    saved = 100 - (after * 100 / before)
    print(f"{src} -> {dst}  {before // 1024} KB -> {after // 1024} KB  ({saved:.0f}% smaller)")
    return True


def main():
    ok = all(build(src, dst, is_js) for src, dst, is_js in TARGETS)
    if not ok:
        sys.exit(1)
    print("minified assets ready — commit the .min files with the sources")


if __name__ == "__main__":
    main()
