"""Embed the offline chart files in a standalone Sites Worker module."""
import json
from pathlib import Path


ASSETS = {
    "index.html": "text/html; charset=utf-8",
    "atlas.css": "text/css; charset=utf-8",
    "atlas.js": "text/javascript; charset=utf-8",
    "catalog.js": "text/javascript; charset=utf-8",
    "atlas.svg": "image/svg+xml",
}


def main():
    root = Path(__file__).resolve().parent
    dist = root / "dist"
    assets = {f"/{name}": (mime, (dist / name).read_bytes().decode("utf-8"))
              for name, mime in ASSETS.items()}
    source = (root / "worker.mjs").read_text(encoding="utf-8")
    target = dist / "server" / "index.js"
    target.parent.mkdir(exist_ok=True)
    encoded = json.dumps(assets, ensure_ascii=True, separators=(",", ":"))
    target.write_text(f"const assets = {encoded};\n\n{source}", encoding="utf-8")


if __name__ == "__main__":
    main()
