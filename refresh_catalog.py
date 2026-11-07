"""Build the portable browser catalog from NASA's confirmed-planet table."""
import argparse
import json
from datetime import date, datetime
from pathlib import Path
from tempfile import NamedTemporaryFile
from urllib.parse import urlencode
from urllib.request import HTTPRedirectHandler, build_opener
from zoneinfo import ZoneInfo

HOST = "hostname sy_snum sy_dist ra dec st_spectype st_teff st_mass st_rad st_lum".split()
PLANET = ("pl_name discoverymethod disc_year pl_orbper pl_orbsmax pl_orbeccen "
          "pl_rade pl_bmasse pl_bmassprov pl_bmasselim pl_dens pl_eqt pl_insol "
          "pl_orbsmaxlim pl_radelim pl_denslim pl_eqtlim pl_insollim").split()
QUERY = "select " + ",".join(HOST + PLANET) + " from pscomppars order by hostname,pl_name"
ENDPOINT = "https://exoplanetarchive.ipac.caltech.edu/TAP/sync"
MAX_RESPONSE_BYTES = 32 * 1024 * 1024
TEXT_FIELDS = {"hostname", "pl_name", "st_spectype", "discoverymethod", "pl_bmassprov"}


class NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, help="Use a previously downloaded TAP JSON response")
    parser.add_argument("--date", type=date.fromisoformat, help="Snapshot date for a previously downloaded response")
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
        host["planets"].append([row[key] for key in PLANET])

    snapshot = {
        "date": (args.date or datetime.now(ZoneInfo("America/New_York")).date()).isoformat(),
        "hostFields": HOST,
        "planetFields": PLANET,
        "systems": [[host["star"], host["planets"]] for host in hosts.values()],
    }
    target = Path(__file__).with_name("dist") / "catalog.js"
    with NamedTemporaryFile(mode="w", encoding="utf-8", dir=target.parent, delete=False) as output:
        pending = Path(output.name)
        try:
            output.write("window.ATLAS_CATALOG = ")
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
