"""Build the portable browser catalog from NASA's confirmed-planet table."""
import argparse
import json
from datetime import date, datetime
from html.parser import HTMLParser
from pathlib import Path
from tempfile import NamedTemporaryFile
from urllib.parse import urlencode, urljoin, urlsplit
from urllib.request import HTTPRedirectHandler, build_opener
from zoneinfo import ZoneInfo

HOST = "hostname sy_snum sy_dist ra dec st_spectype st_teff st_mass st_rad st_lum".split()
PLANET = ("pl_name discoverymethod disc_year pl_orbper pl_orbsmax pl_orbeccen "
          "pl_rade pl_bmasse pl_bmassprov pl_bmasselim pl_dens pl_eqt pl_insol "
          "pl_orbsmaxlim pl_radelim pl_denslim pl_eqtlim pl_insollim").split()
HOST_REF = [key + "_reflink" for key in ("st_teff", "st_lum", "st_mass")]
PLANET_REF = [key + "_reflink" for key in ("pl_rade", "pl_bmasse", "pl_dens", "pl_insol", "pl_orbsmax", "pl_orbper")]
QUERY = "select " + ",".join(HOST + PLANET + HOST_REF + PLANET_REF) + " from pscomppars order by hostname,pl_name"
ENDPOINT = "https://exoplanetarchive.ipac.caltech.edu/TAP/sync"
CATALOG_PREFIX = "window.ATLAS_CATALOG = "
REFERENCE_HOSTS = {"exoplanetarchive.ipac.caltech.edu", "exofop.ipac.caltech.edu",
                   "ui.adsabs.harvard.edu", "www.nature.com", "doi.org"}
MAX_RESPONSE_BYTES = 32 * 1024 * 1024
TEXT_FIELDS = {"hostname", "pl_name", "st_spectype", "discoverymethod", "pl_bmassprov"}


class NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class ReferenceLink(HTMLParser):
    href = None

    def handle_starttag(self, tag, attrs):
        if tag == "a" and self.href is None:
            self.href = dict(attrs).get("href")


def reference_url(value):
    if not isinstance(value, str) or len(value) > 2048:
        return None
    parser = ReferenceLink()
    parser.feed(value)
    href = parser.href
    if not href or "\\" in href or any(char.isspace() or ord(char) < 32 for char in href):
        return None
    try:
        url = urlsplit(urljoin(ENDPOINT, href))
    except ValueError:
        return None
    if url.scheme == "https" and url.netloc in REFERENCE_HOSTS:
        return url.geturl()
    return None


def read_rows(source):
    payload = source.read(MAX_RESPONSE_BYTES + 1)
    if len(payload) > MAX_RESPONSE_BYTES:
        raise ValueError("Catalog exceeds the maximum download size.")
    rows = json.loads(payload)
    if not isinstance(rows, list) or not 5_000 <= len(rows) <= 50_000:
        raise ValueError("Expected the full PSCompPars confirmed-planet table.")
    return rows


def validate_row(row, index):
    if not isinstance(row, dict):
        raise ValueError(f"Catalog row {index} must be an object.")
    for key in HOST + PLANET:
        if key not in row:
            raise ValueError(f"Catalog row {index} is missing {key}.")
        value = row[key]
        if value is None and key not in {"hostname", "pl_name"}:
            continue
        if key in TEXT_FIELDS:
            valid = isinstance(value, str) and len(value) <= 256 and bool(value.strip())
            valid = valid and not any(0xD800 <= ord(char) <= 0xDFFF for char in value)
        else:
            valid = type(value) in {int, float} and -1e15 <= value <= 1e15
            if key == "sy_snum":
                valid = valid and value == int(value) and value > 0
        if not valid:
            raise ValueError(f"Catalog row {index} has an invalid {key}.")


def index_snapshot(snapshot):
    hosts = {}
    planets = {}
    for star, members in snapshot["systems"]:
        host = dict(zip(snapshot["hostFields"], star))
        hostname = host["hostname"]
        hosts[hostname] = host
        for row in members:
            planet = dict(zip(snapshot["planetFields"], row))
            planets[planet["pl_name"]] = {**planet, "hostname": hostname}
    return hosts, planets


def report_changes(previous, current, detail):
    print(f"Snapshot {previous['date']} → {current['date']}")
    for label, old, new in zip(("Hosts", "Planets"), index_snapshot(previous), index_snapshot(current)):
        added = sorted(new.keys() - old.keys())
        removed = sorted(old.keys() - new.keys())
        changed = {}
        for name in sorted(old.keys() & new.keys()):
            fields = [key for key in old[name].keys() & new[name].keys() if old[name][key] != new[name][key]]
            if fields:
                changed[name] = sorted(fields)
        print(f"{label}: {len(old):,} → {len(new):,} | +{len(added):,}, −{len(removed):,}, {len(changed):,} changed")
        if detail:
            for marker, names in (("+", added), ("-", removed), ("~", changed)):
                for name in names:
                    fields = " (" + ", ".join(changed[name]) + ")" if marker == "~" else ""
                    print(f"  {marker} {json.dumps(name, ensure_ascii=True)}{fields}")
    fields_added = (set(current["hostFields"] + current["planetFields"]) -
                    set(previous["hostFields"] + previous["planetFields"]))
    if fields_added:
        print("New fields: " + ", ".join(sorted(fields_added)))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, help="Use a previously downloaded TAP JSON response")
    parser.add_argument("--date", type=date.fromisoformat, help="Snapshot date for a previously downloaded response")
    parser.add_argument("--check", action="store_true", help="List changes without replacing the current snapshot")
    args = parser.parse_args()
    if args.input:
        with args.input.open("rb") as source:
            rows = read_rows(source)
    else:
        url = ENDPOINT + "?" + urlencode({"query": QUERY, "format": "json"})
        with build_opener(NoRedirects()).open(url, timeout=90) as response:
            rows = read_rows(response)

    hosts = {}
    seen = set()
    for row_number, row in enumerate(rows, start=1):
        validate_row(row, row_number)
        name = row["pl_name"]
        if name in seen:
            raise ValueError(f"Repeated planet name at row {row_number}.")
        seen.add(name)
        host = hosts.setdefault(row["hostname"], {
            "star": [None] * len(HOST),
            "planets": [],
        })
        for index, key in enumerate(HOST):
            if host["star"][index] is None:
                host["star"][index] = row[key]
                ref = key + "_reflink"
                if ref in HOST_REF and row[key] is not None:
                    host[ref] = reference_url(row.get(ref))
        host["planets"].append([row[key] for key in PLANET] +
                               [reference_url(row.get(key)) for key in PLANET_REF])

    snapshot = {
        "date": (args.date or datetime.now(ZoneInfo("America/New_York")).date()).isoformat(),
        "hostFields": HOST + HOST_REF,
        "planetFields": PLANET + PLANET_REF,
        "systems": [[host["star"] + [host.get(key) for key in HOST_REF], host["planets"]]
                    for host in hosts.values()],
    }
    target = Path(__file__).with_name("dist") / "catalog.js"
    if target.exists():
        content = target.read_text(encoding="utf-8").strip()
        if not content.startswith(CATALOG_PREFIX) or not content.endswith(";"):
            raise ValueError("Cannot compare the existing catalog snapshot.")
        previous = json.loads(content[len(CATALOG_PREFIX):-1])
        report_changes(previous, snapshot, args.check)
    elif args.check:
        print("No baseline snapshot is available for comparison.")
    if args.check:
        return
    with NamedTemporaryFile(mode="w", encoding="utf-8", dir=target.parent, delete=False) as output:
        pending = Path(output.name)
        try:
            output.write(CATALOG_PREFIX)
            json.dump(snapshot, output, ensure_ascii=True, allow_nan=False, separators=(",", ":"))
            output.write(";\n")
            output.close()
            pending.chmod(0o644)
            pending.replace(target)
        finally:
            pending.unlink(missing_ok=True)
    print(f"{len(rows):,} planets in {len(hosts):,} systems → {target.name}")


if __name__ == "__main__":
    main()
