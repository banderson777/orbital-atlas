# Orbital Atlas

Orbital Atlas is a buildless star chart for the confirmed planets in the NASA Exoplanet Archive's Planetary Systems Composite Parameters table. Open `dist/index.html` in a modern browser. The bundled snapshot also works offline.

Drag to rotate and scroll or pinch to zoom. Hold Shift while dragging to pan. The canvas accepts the arrow keys, plus, minus, and Home. Use the catalog to search and select a host, including systems missing a 3D position. Click a planet in the system panel for details and hover over stars or planets for measurements.

## Refresh the NASA catalog

Run `python3 refresh_catalog.py --check` with Python 3.9 or later and internet access. It lists added and removed names and changed fields for both hosts and planets without writing the snapshot. Run `python3 refresh_catalog.py` to replace `dist/catalog.js` after review. To check and apply the same previously saved TAP JSON response, pass `--input PATH --date YYYY-MM-DD` to both commands.

The Data guide in the app explains the filter thresholds, the coverage of water-vapor detections, and how to read the map and orbit diagrams. The NASA table's [column definitions](https://exoplanetarchive.ipac.caltech.edu/docs/API_PS_columns.html) document the original measurements.
