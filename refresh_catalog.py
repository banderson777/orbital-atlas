"""Build the portable browser catalog from NASA's confirmed-planet table."""
import argparse
import json
from datetime import datetime
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import urlopen
from zoneinfo import ZoneInfo

HOST = "hostname sy_snum sy_dist ra dec st_spectype st_teff st_mass st_rad st_lum".split()
PLANET = ("pl_name discoverymethod disc_year pl_orbper pl_orbsmax pl_orbeccen "
          "pl_rade pl_bmasse pl_bmassprov pl_dens pl_eqt pl_insol "
          "pl_orbsmaxlim pl_radelim pl_denslim pl_eqtlim pl_insollim").split()
QUERY = "select " + ",".join(HOST + PLANET) + " from pscomppars order by hostname,pl_name"
ENDPOINT = "https://exoplanetarchive.ipac.caltech.edu/TAP/sync"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, help="Use a previously downloaded TAP JSON response")
    parser.add_argument("--date", help="Snapshot date for a previously downloaded response")
    args = parser.parse_args()
    if args.input:
        rows = json.loads(args.input.read_text(encoding="utf-8"))
    else:
        with urlopen(ENDPOINT + "?" + urlencode({"query": QUERY, "format": "json"}), timeout=90) as response:
            rows = json.load(response)

    if not isinstance(rows, list) or len(rows) < 5000:
        raise ValueError("Expected the full PSCompPars confirmed-planet table.")
    hosts = {}
    seen = set()
    for row in rows:
        name = row["pl_name"]
        if not name or name in seen or not row["hostname"]:
            raise ValueError(f"Missing or repeated planet or host name: {name!r}")
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
        "date": args.date or datetime.now(ZoneInfo("America/New_York")).date().isoformat(),
        "hostFields": HOST,
        "planetFields": PLANET,
        "systems": [[host["star"], host["planets"]] for host in hosts.values()],
    }
    target = Path(__file__).with_name("dist") / "catalog.js"
    pending = target.with_suffix(".tmp")
    pending.write_text("window.ATLAS_CATALOG = " + json.dumps(snapshot, ensure_ascii=True, allow_nan=False,
                                                             separators=(",", ":")) + ";\n", encoding="utf-8")
    pending.replace(target)
    print(f"{len(rows):,} planets in {len(hosts):,} systems → {target.name}")


if __name__ == "__main__":
    main()
