'use strict';

const $ = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const fmt = (n, digits = 2) => Number.isFinite(n)
  ? n.toLocaleString('en-US', { maximumFractionDigits: digits }) : '—';
const positive = (n) => Number.isFinite(n) && n > 0;
const numberWithUnit = (n, unit, digits = 2) => Number.isFinite(n) ? fmt(n, digits) + ' ' + unit : '—';
const normalize = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const TAU = Math.PI * 2;
const LY_PER_PC = 3.261563777;
const DEG = Math.PI / 180;
const SUN_X = -26670;
const starColors = { O:'#9db8ff', B:'#a6b8ff', A:'#c3d1ff', F:'#e4dcff', G:'#ffd99c', K:'#ffb67d', M:'#ff9b9f', L:'#eb94a1', T:'#bf95cf', Y:'#aa91ba' };
const starNames = { O:'Blue', B:'Blue-white', A:'White', F:'Yellow-white', G:'Yellow', K:'Orange', M:'Red' };
const evidence = {
  'WASP-39 b': 'https://science.nasa.gov/missions/webb/nasas-webb-reveals-an-exoplanet-atmosphere-as-never-before/',
  'GJ 9827 d': 'https://science.nasa.gov/missions/hubble/nasas-hubble-finds-water-vapor-in-small-exoplanets-atmosphere/',
  'WASP-96 b': 'https://science.nasa.gov/asset/webb/exoplanet-wasp-96-b-niriss-transmission-spectrum/',
  'HAT-P-11 b': 'https://science.nasa.gov/solar-system/ocean-worlds/',
  'HD 189733 b': 'https://science.nasa.gov/missions/hubble/hubble-finds-three-surprisingly-dry-exoplanets/',
  'HD 209458 b': 'https://science.nasa.gov/missions/hubble/hubble-finds-three-surprisingly-dry-exoplanets/',
  'WASP-12 b': 'https://science.nasa.gov/missions/hubble/hubble-finds-three-surprisingly-dry-exoplanets/',
  'WASP-107 b': 'https://science.nasa.gov/missions/webb/3-years-of-science-10-cosmic-surprises-from-nasas-webb-telescope/',
};
const traits = [
  { id:'water', label:'Water vapor', symbol:'◇', help:'Selected published atmospheric water detections' },
  { id:'rocky', label:'Rocky candidate', symbol:'⬡', help:'Radius and, when available, bulk density suggest a rocky candidate' },
  { id:'cold', label:'Cold / frozen?', symbol:'❄', help:'Catalog equilibrium temperature at or below 200 K' },
  { id:'hz', label:'Habitable zone', symbol:'◎', help:'Estimated conservative habitable zone' },
  { id:'earth-like', label:'Earth-like candidate', symbol:'⊕', help:'Life Search candidates with 0.8–1.25 Earth radii and 0.5–1.25 Earth flux' },
  { id:'giant', label:'Giant', symbol:'◉', help:'At least six Earth radii' },
];
const trappistHZ = new Set(['TRAPPIST-1 e', 'TRAPPIST-1 f', 'TRAPPIST-1 g']);
const trappistHZSource = 'https://science.nasa.gov/asset/webb/trappist-1-system-orbit-comparison/';
const hzModelSource = 'https://doi.org/10.1088/2041-8205/787/2/L29';
const nasaCalculated = 'https://exoplanetarchive.ipac.caltech.edu/docs/pscp_calc.html';
const referenceHosts = new Set(['exoplanetarchive.ipac.caltech.edu', 'exofop.ipac.caltech.edu',
  'ui.adsabs.harvard.edu', 'www.nature.com', 'doi.org', 'science.nasa.gov']);
const innerHZ = [1.107, 1.332e-4, 1.58e-8, -8.308e-12, -1.931e-15];
const outerHZ = [0.356, 6.171e-5, 1.698e-9, -3.198e-12, -5.575e-16];
const habitableOrbitColor = '#64df8e';
const unmatchedPlanetColor = '#858b99';
const habitabilityEvidence = {
  density: 'Density-supported',
  radius: 'Radius-based',
};
const massType = { Mass:'Reported mass', Msini:'Minimum mass', 'Msin(i)/sin(i)':'Inclination-corrected mass',
  'M-R relationship':'Estimated from radius' };
const comparison = new Map();
const COMPARE_LIMIT = 3;

function hzBoundary(coefficients, temperature) {
  const t = temperature - 5780;
  return coefficients.reduceRight((value, coefficient) => value * t + coefficient, 0);
}

function withinHabitableZone(temperature, flux) {
  return temperature >= 2600 && temperature <= 7200 &&
    flux >= hzBoundary(outerHZ, temperature) && flux <= hzBoundary(innerHZ, temperature);
}

function planetInHabitableZone(star, planet) {
  return star === solar ? withinHabitableZone(star.st_teff, 1 / planet.axis ** 2) : planet.tags.hz;
}

function stellarClass(star) {
  const type = star.st_spectype?.trim() || '';
  if (/^D[ABCOQXZ]?(?:\d|\b)|white dwarf/i.test(type)) return 'White dwarf';
  if (/pulsar|neutron/i.test(type) || /^PSR\b/i.test(star.hostname)) return 'Pulsar / neutron star';
  const spectral = type.match(/^([OBAFGKMLTY])(?:\d|$|\s)/i)?.[1].toUpperCase();
  if (!spectral) return type || 'Spectral type unlisted';
  if ('LTY'.includes(spectral)) return 'Cool substellar spectral class';
  const luminosity = type.match(/(?:^|[\d .-])(III|VII|VI|IV|II|Ia|Iab|Ib|I|V)(?:\b|$)/i)?.[1].toUpperCase();
  const stages = { I:'supergiant', IA:'supergiant', IAB:'supergiant', IB:'supergiant', II:'bright giant', III:'giant', IV:'subgiant', V:'dwarf', VI:'subdwarf' };
  return luminosity && stages[luminosity] ? starNames[spectral] + ' ' + stages[luminosity] : spectral + '-type star';
}

function galacticPosition(star) {
  if (!positive(star.sy_dist) || !Number.isFinite(star.ra) || !Number.isFinite(star.dec)) return null;
  const ra = star.ra * DEG, dec = star.dec * DEG, distance = star.sy_dist * LY_PER_PC;
  const x = distance * Math.cos(dec) * Math.cos(ra);
  const y = distance * Math.cos(dec) * Math.sin(ra);
  const z = distance * Math.sin(dec);
  // Standard ICRS to Galactic rotation. The x axis points toward the Galactic center.
  return [
    -0.0548755604*x - 0.8734370902*y - 0.4838350155*z,
     0.4941094279*x - 0.4448296300*y + 0.7469822445*z,
    -0.8676661490*x - 0.1980763734*y + 0.4559837762*z,
  ];
}

function preparePlanet(planet, star) {
  const radius = planet.pl_radelim ? null : planet.pl_rade;
  const density = planet.pl_denslim ? null : planet.pl_dens;
  const listedAxis = !planet.pl_orbsmaxlim && positive(planet.pl_orbsmax);
  const projected = ['Imaging', 'Microlensing'].includes(planet.discoverymethod);
  const derivedAxis = positive(planet.pl_orbper) && positive(star.st_mass) && star.sy_snum === 1
    ? Math.cbrt(star.st_mass * (planet.pl_orbper / 365.25) ** 2) : null;
  planet.axis = listedAxis && !projected ? planet.pl_orbsmax : derivedAxis;
  planet.axisEstimated = !!planet.axis && (!listedAxis || projected);
  planet.projectedSeparation = projected && listedAxis ? planet.pl_orbsmax : null;
  const flux = !planet.pl_insollim && positive(planet.pl_insol) ? planet.pl_insol
    : positive(planet.axis) && Number.isFinite(star.st_lum) ? 10 ** star.st_lum / planet.axis ** 2 : null;
  planet.tags = {
    water: Object.prototype.hasOwnProperty.call(evidence, planet.pl_name),
    rocky: positive(radius) && radius <= 1.6 && (!positive(density) || density >= 3.5),
    cold: !planet.pl_eqtlim && positive(planet.pl_eqt) && planet.pl_eqt <= 200,
    hz: trappistHZ.has(planet.pl_name) || withinHabitableZone(star.st_teff, flux),
    giant: radius >= 6,
  };
  planet.habitability = classifyHabitability(planet, radius, density);
  planet.tags['earth-like'] = planet.habitability !== null &&
    radius >= 0.8 && radius <= 1.25 && flux >= 0.5 && flux <= 1.25;
  planet.flux = flux;
  planet.fluxEstimated = !!flux && (!!planet.pl_insollim || !positive(planet.pl_insol));
  planet.search = normalize(planet.pl_name);
  planet.color = planet.tags.water ? '#7bd6ff' : planet.tags.hz ? '#82e3d1' : planet.tags.giant ? '#d2a1fd' : planet.tags.cold ? '#aac6ff' : '#edb48f';
  return planet;
}

function classifyHabitability(planet, radius, density) {
  if (!planet.tags.hz || !(radius > 0.5 && radius <= 2)) return null;
  const reportedMass = ['Mass', 'Msin(i)/sin(i)'].includes(planet.pl_bmassprov);
  if (reportedMass && planet.pl_bmasselim === 0 && positive(planet.pl_bmasse) && density >= 3.5) return 'density';
  return planet.tags.rocky ? 'radius' : null;
}

function fields(keys, values) {
  return Object.fromEntries(keys.map((key, index) => [key, values[index]]));
}

const catalog = window.ATLAS_CATALOG;
const systems = catalog.systems.map(([starRow, planetRows], index) => {
  const star = fields(catalog.hostFields, starRow);
  star.id = index;
  star.name = star.hostname;
  star.label = stellarClass(star);
  star.spectral = star.st_spectype?.trim().match(/^[OBAFGKMLTY]/i)?.[0].toUpperCase() || '';
  star.color = starColors[star.spectral] || '#c2afff';
  star.position = galacticPosition(star);
  star.distance = positive(star.sy_dist) ? star.sy_dist * LY_PER_PC : null;
  star.search = normalize(star.name);
  star.planets = planetRows.map((row) => preparePlanet(fields(catalog.planetFields, row), star));
  return star;
}).sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity) || a.name.localeCompare(b.name));

const solar = {
  id:-1, name:'Sol', hostname:'Sol', label:'Yellow dwarf', st_spectype:'G2 V', st_teff:5772, st_mass:1, st_rad:1,
  sy_snum:1, spectral:'G', color:'#ffc478', position:[0,0,0], distance:0,
  planets:[
    ['Mercury',0.3871,0.2056,0.383,0.0553,87.97], ['Venus',0.7233,0.0068,0.949,0.815,224.70],
    ['Earth',1,0.0167,1,1,365.25], ['Mars',1.5237,0.0934,0.532,0.107,686.98],
    ['Jupiter',5.2026,0.0484,11.21,317.83,4332.59], ['Saturn',9.5549,0.0555,9.45,95.16,10759.22],
    ['Uranus',19.2184,0.0463,4.01,14.54,30688.5], ['Neptune',30.1104,0.0095,3.88,17.15,60182],
  ].map(([pl_name, axis, pl_orbeccen, pl_rade, pl_bmasse, pl_orbper], index) => ({
    pl_name, axis, pl_orbeccen, pl_rade, pl_bmasse, pl_orbper, tags:{},
    color:['#b3b0b3','#e0bb85','#7bd6ff','#ee9273','#e9b598','#efd18f','#9ae9df','#83abff'][index],
  })),
};
const mappedTotal = systems.filter((s) => s.position).length;
const planetTotal = systems.reduce((total, s) => total + s.planets.length, 0);
const systemById = new Map(systems.map((s) => [s.id, s]));
const selectedTraits = new Set();
const NEARBY_DISTANCE_LY = 100;
let selected = systems.find((s) => s.name === 'TRAPPIST-1') ?? solar;
let selectedPlanet = null;
let matching = [];
let matchingPlanets = new Map();
let listed = 0;
const PAGE_SIZE = 100;

$('system-total').textContent = fmt(systems.length);
$('mapped-total').textContent = fmt(mappedTotal);
$('planet-total').textContent = fmt(planetTotal);
$('snapshot-date').textContent = 'Snapshot ' + new Date(catalog.date + 'T12:00:00Z').toLocaleDateString('en-US', {
  dateStyle:'medium', timeZone:'UTC',
});
$('position-note').textContent = fmt(systems.length - mappedTotal) + ' hosts searchable without a map position';
$('traits').innerHTML = traits.map((t) =>
  `<button class="trait" data-trait="${t.id}" title="${t.help}" aria-pressed="false"><span aria-hidden="true">${t.symbol}</span>${t.label}</button>`).join('');
const methods = [...new Set(systems.flatMap((s) => s.planets.map((p) => p.discoverymethod)))].filter(Boolean).sort();
for (const method of methods) $('method').add(new Option(method, method));
for (const spectral of 'OBAFGKMLTY') $('spectral').add(new Option(spectral + ' class', spectral));
$('spectral').add(new Option('Other / unlisted', 'other'));

function updateFilters() {
  const query = normalize($('search').value);
  const method = $('method').value;
  const spectral = $('spectral').value;
  const lifeSearch = $('life-search').value;
  const distanceLimit = Number($('distance-limit').value);
  const activeTraits = [...selectedTraits];
  const matchAllTraits = $('trait-match').value === 'all';
  const matchesTraits = (planet) => {
    if (!activeTraits.length) return true;
    const hasTrait = (id) => planet.tags[id];
    return matchAllTraits ? activeTraits.every(hasTrait) : activeTraits.some(hasTrait);
  };
  matchingPlanets = new Map();
  matching = systems.filter((star) => {
    if (spectral && (star.spectral || 'other') !== spectral) return false;
    if (distanceLimit && (star.distance === null || star.distance > distanceLimit)) return false;
    const hostMatches = !query || star.search.includes(query);
    const planets = star.planets.filter((planet) => (hostMatches || planet.search.includes(query)) &&
      (!method || planet.discoverymethod === method) && matchesTraits(planet) &&
      (!lifeSearch || (lifeSearch === 'candidate' ? planet.habitability : planet.habitability === lifeSearch)));
    if (!planets.length) return false;
    matchingPlanets.set(star.id, planets);
    return true;
  });
  $('matches').textContent = fmt(matching.length);
  listed = PAGE_SIZE;
  renderResults(true);
  if (matching.length && (selected === solar || !matchingPlanets.has(selected.id)) &&
      (query || method || spectral || lifeSearch || distanceLimit || selectedTraits.size)) {
    selectStar(matching[0], false);
  } else {
    const planets = matchingPlanets.get(selected.id);
    if (planets?.length === 1 && (lifeSearch || selected.planets.length > 1)) selectedPlanet = planets[0];
    else if (selectedPlanet && planets && !planets.includes(selectedPlanet)) selectedPlanet = null;
    renderDetail();
  }
  hideTip($('map-tip'));
  scheduleDraw();
}

function renderResults(reset = false) {
  const results = $('results');
  if (reset) {
    results.replaceChildren();
    results.scrollTop = 0;
  }
  results.querySelector('.load-more')?.remove();
  const previous = results.querySelectorAll('.result').length;
  results.insertAdjacentHTML('beforeend', matching.slice(previous, listed).map((star) => {
    const details = star.st_spectype ? escapeHtml(star.st_spectype) : 'Spectral type unlisted';
    const count = matchingPlanets.get(star.id).length;
    return `<div class="compare-item"><button class="result" data-star="${star.id}" aria-current="${star === selected}" title="${escapeHtml(star.name)}">
      <i class="star-dot" data-dot="${star.color}"></i><span><strong>${escapeHtml(star.name)}</strong><small>${details} · ${count} ${count === 1 ? 'planet' : 'planets'}</small></span><span>${star.distance === null ? '—' : fmt(star.distance, 1) + ' ly'}</span></button>
      <button class="quiet compare-host" data-compare-host="${star.id}" aria-haspopup="dialog" aria-label="Compare planets from ${escapeHtml(star.name)}" title="Choose planets to compare">+</button></div>`;
  }).join(''));
  colorDots(results);
  if (!matching.length) results.innerHTML = '<p class="empty">No systems match these filters.</p>';
  if (listed < matching.length) {
    results.insertAdjacentHTML('beforeend', '<button class="link-button load-more">Show more systems ↓</button>');
  }
}

function colorDots(container) {
  for (const dot of container.querySelectorAll('.star-dot[data-dot]')) {
    dot.style.setProperty('--dot', dot.dataset.dot);
    dot.removeAttribute('data-dot');
  }
}

function selectStar(star, reveal = true, planet) {
  if (!star) return;
  selected = star;
  const planets = matchingPlanets.get(star.id);
  selectedPlanet = planet !== undefined ? planet :
    planets?.length === 1 && ($('life-search').value || star.planets.length > 1) ? planets[0] : null;
  for (const result of $('results').querySelectorAll('.result[aria-current=true]')) result.setAttribute('aria-current','false');
  $('results').querySelector(`[data-star="${star.id}"]`)?.setAttribute('aria-current','true');
  renderDetail();
  if (reveal && star.position && chart.w && chart.h) {
    const point = project(star.position);
    const { w, h } = chart;
    const outsideDepth = camera.view === 'sol' && Math.abs(point[2]) > camera.radius * 1.45;
    if (outsideDepth || point[0] < w * .09 || point[0] > w * .91 || point[1] < h * .09 || point[1] > h * .91) {
      camera.panX += (w / 2 - point[0]) / chart.scale;
      camera.panY += (h / 2 - point[1]) / chart.scale;
      if (outsideDepth) camera.radius = Math.abs(point[2]) / 1.2;
    }
  }
  if (reveal && window.matchMedia('(max-width: 900px)').matches) $('inspector').scrollIntoView({ block:'nearest' });
  scheduleDraw();
}

$('results').addEventListener('click', (event) => {
  const compareHost = event.target.closest('[data-compare-host]');
  if (compareHost) openComparison(systemById.get(Number(compareHost.dataset.compareHost)));
  const row = event.target.closest('[data-star]');
  if (row) selectStar(systemById.get(Number(row.dataset.star)));
  if (event.target.closest('.load-more')) {
    const previous = listed;
    listed += PAGE_SIZE;
    renderResults();
    $('results').querySelectorAll('.result')[previous]?.focus();
  }
});
$('traits').addEventListener('click', (event) => {
  const button = event.target.closest('[data-trait]');
  if (!button) return;
  const id = button.dataset.trait;
  if (selectedTraits.has(id)) selectedTraits.delete(id);
  else selectedTraits.add(id);
  button.setAttribute('aria-pressed', String(selectedTraits.has(id)));
  updateFilters();
});
$('search').addEventListener('input', updateFilters);
$('method').addEventListener('change', updateFilters);
$('spectral').addEventListener('change', updateFilters);
$('life-search').addEventListener('change', updateFilters);
$('distance-limit').addEventListener('change', updateFilters);
$('trait-match').addEventListener('change', updateFilters);

function resetFilters(nearby = false) {
  $('search').value = $('method').value = $('spectral').value = $('life-search').value = '';
  $('distance-limit').value = nearby ? String(NEARBY_DISTANCE_LY) : '';
  $('trait-match').value = 'any';
  selectedTraits.clear();
  if (nearby) selectedTraits.add('earth-like');
  for (const button of $('traits').children) button.setAttribute('aria-pressed', String(selectedTraits.has(button.dataset.trait)));
  updateFilters();
}

$('clear').addEventListener('click', () => resetFilters());
$('nearby').addEventListener('click', () => resetFilters(true));
$('guide-open').addEventListener('click', () => $('guide').showModal());
$('compare-open').addEventListener('click', () => openComparison());

function showTip(tip, container, x, y, content) {
  tip.innerHTML = content;
  tip.hidden = false;
  tip.style.left = Math.max(4, Math.min(x + 12, container.clientWidth - tip.offsetWidth - 4)) + 'px';
  const preferredY = y + 12 + tip.offsetHeight < container.clientHeight ? y + 12 : y - tip.offsetHeight - 10;
  tip.style.top = Math.max(4, preferredY) + 'px';
}

function hideTip(tip) {
  if (tip) tip.hidden = true;
}

function starTip(star) {
  return `<strong>${escapeHtml(star.name)}</strong>${escapeHtml(star.label)}${star.st_spectype && star.label !== star.st_spectype ? ' · ' + escapeHtml(star.st_spectype) : ''}
    <br>${star.distance === null ? 'Distance unlisted' : fmt(star.distance,2) + ' ly from Sol'} · ${star.planets.length} planets
    <br>Tₑff ${numberWithUnit(star.st_teff,'K',0)} · Mass ${numberWithUnit(star.st_mass,'M☉')}`;
}

function planetTip(planet) {
  const orbit = planet.axis
    ? 'Orbit ' + (planet.axisEstimated ? '≈ ' : '') + numberWithUnit(planet.axis, 'AU', 5)
    : 'Orbit size unknown';
  return `<strong>${escapeHtml(planet.pl_name)}</strong>Radius ${planet.pl_radelim ? '—' : numberWithUnit(planet.pl_rade, 'R⊕')}
    · Period ${numberWithUnit(planet.pl_orbper,'d')}<br>${orbit} · Tₑq ${planet.pl_eqtlim ? '—' : numberWithUnit(planet.pl_eqt,'K',0)}
    ${!planet.axis && planet.projectedSeparation ? '<br>Projected separation ' + numberWithUnit(planet.projectedSeparation, 'AU', 4) : ''}
    ${planet.habitability ? '<br>' + habitabilityEvidence[planet.habitability] + ' habitability candidate' : ''}`;
}

function orbitPlanetMarker(planet, index, x, y, color) {
  const size = positive(planet.pl_rade) && !planet.pl_radelim ? Math.min(6, 2.5 + Math.sqrt(planet.pl_rade)) : 3;
  return `<g data-object="${index}" tabindex="0" role="button" aria-label="${escapeHtml(planet.pl_name)}" transform="translate(${x} ${y})">
    <circle r="${Math.max(6,size)}" fill="transparent"/><circle r="${size + 3}" fill="${color}" opacity="${selectedPlanet === planet ? '.36' : '.13'}"/>
    <circle class="body" r="${size}" fill="${color}"/></g>`;
}

function renderOrbitPlaceholders(star, planets, matchingInSystem) {
  return `<section class="orbit-placeholders" aria-label="Planets with unknown orbit sizes">
    <p>Dashed placeholders · Orbit sizes unknown</p>
    <div class="orbit-placeholder-grid">${planets.map((planet) => {
      const color = matchingInSystem.has(planet) ? planet.color : unmatchedPlanetColor;
      return `<div class="orbit-placeholder">
        <svg viewBox="0 0 156 136" aria-label="Placeholder for ${escapeHtml(planet.pl_name)}">
          <g transform="translate(78 68)">
            <circle class="unknown-orbit" r="54" fill="none" stroke="${color}" stroke-width="${selectedPlanet === planet ? 2 : 1.3}" stroke-dasharray="6 5"/>
            <g data-object="star" tabindex="0" role="img" aria-label="${escapeHtml(star.name)}">
              <circle r="13" fill="${star.color}" opacity=".2"/><circle class="body" r="7" fill="${star.color}"/>
            </g>
            ${orbitPlanetMarker(planet, star.planets.indexOf(planet), 38, -38, color)}
          </g>
        </svg>
        <span>${escapeHtml(planet.pl_name)}</span>
      </div>`;
    }).join('')}</div></section>`;
}

function renderOrbit(star, matchingInSystem) {
  const known = star.planets.filter((planet) => positive(planet.axis)).sort((a,b) => a.axis - b.axis);
  const unknown = star.planets.filter((planet) => !positive(planet.axis));
  const min = known[0]?.axis || 1;
  const compression = (axis) => Math.log1p(axis / min);
  const maxExtent = Math.max(1, ...known.map((planet) => compression(planet.axis) * (1 + eccentricity(planet))));
  const orbits = [];
  const habitableOrbits = [];
  const bodies = [];
  known.forEach((planet, index) => {
    const e = eccentricity(planet);
    const a = 94 * compression(planet.axis) / maxExtent;
    const b = a * Math.sqrt(1 - e * e);
    const angle = index * 2.39996 - 0.7;
    const x = -a * e + a * Math.cos(angle);
    const y = b * Math.sin(angle);
    const highlighted = selectedPlanet === planet;
    const planetIndex = star.planets.indexOf(planet);
    const matches = matchingInSystem.has(planet);
    const habitable = matches && planetInHabitableZone(star, planet);
    const color = matches ? planet.color : unmatchedPlanetColor;
    const stroke = habitable ? habitableOrbitColor : color;
    const strokeWidth = habitable ? (highlighted ? 2.5 : 1.8) : highlighted ? 1.8 : 1;
    (habitable ? habitableOrbits : orbits).push(`<ellipse cx="${-a*e}" cy="0" rx="${a}" ry="${b}" fill="none"
      stroke="${stroke}" stroke-opacity="${habitable ? 1 : highlighted ? .9 : matches ? .72 : .55}" stroke-width="${strokeWidth}"
      ${habitable ? 'class="habitable-orbit"' : ''}
      ${planet.axisEstimated ? 'stroke-dasharray="3 3"' : ''}/>`);
    bodies.push(orbitPlanetMarker(planet, planetIndex, x, y, color));
  });
  const scaled = known.length ? `<div class="orbit-scaled"><svg viewBox="0 0 250 221" aria-label="Face-on schematic of the system">
    <defs><radialGradient id="star-glow"><stop stop-color="${star.color}" stop-opacity=".65"/><stop offset="1" stop-color="${star.color}" stop-opacity="0"/></radialGradient></defs>
    <path d="M19 105h212M125 7v197" stroke="#25243c" stroke-dasharray="2 4"/>
    <g transform="translate(125 105)">${orbits.join('')}${habitableOrbits.join('')}
    <g data-object="star" tabindex="0" role="img" aria-label="${escapeHtml(star.name)}"><circle r="29" fill="url(#star-glow)"/><circle class="body" r="7" fill="${star.color}"/><circle cx="-1.5" cy="-1.5" r="4.2" fill="#fff5e8" opacity=".65"/></g>
    ${bodies.join('')}</g></svg>
    ${habitableOrbits.length ? '<div class="orbit-habitable-key">HABITABLE ZONE ORBIT</div>' : ''}
    <div class="orbit-caption">COMPRESSED ORBIT SCALE</div></div>` : '';
  return `<div class="orbit-frame" id="orbit-frame">${scaled}
    ${unknown.length ? renderOrbitPlaceholders(star, unknown, matchingInSystem) : ''}
    <div id="orbit-tip" class="tooltip" hidden></div></div>`;
}

function eccentricity(planet) {
  return Number.isFinite(planet.pl_orbeccen) && planet.pl_orbeccen >= 0 && planet.pl_orbeccen < 1 ? planet.pl_orbeccen : 0;
}

function referenceLink(value, label = 'Source') {
  if (!value) return '';
  let url;
  try {
    url = new URL(value);
  } catch {
    return '';
  }
  if (url.protocol !== 'https:' || !referenceHosts.has(url.host) || url.username || url.password) return '';
  return ` <a target="_blank" rel="noopener noreferrer" href="${escapeHtml(url.href)}">${escapeHtml(label)} ↗</a>`;
}

function measurementEvidence(label, value, source, description) {
  const origin = description || (source === nasaCalculated ? 'NASA calculated' : source ? 'Catalog source' : 'Source unavailable');
  return `<li>${label} ${value} <span>· ${origin}</span>${referenceLink(source, label + ' source')}</li>`;
}

function lifeEvidence(planet, star) {
  const density = planet.pl_denslim ? null : planet.pl_dens;
  const trappist = trappistHZ.has(planet.pl_name);
  const range = trappist ? 'NASA places this orbit in the habitable zone.' :
    `The model’s flux range at this stellar temperature is ${fmt(hzBoundary(outerHZ, star.st_teff), 3)}–${fmt(hzBoundary(innerHZ, star.st_teff), 3)} S⊕.`;
  const evidence = [
    measurementEvidence('Radius', numberWithUnit(planet.pl_rade, 'R⊕'), planet.pl_rade_reflink),
    positive(density) ? measurementEvidence('Bulk density', numberWithUnit(density, 'g/cm³'), planet.pl_dens_reflink) :
      '<li>Bulk density unavailable for the screen</li>',
    positive(planet.pl_bmasse) && !planet.pl_bmasselim
      ? measurementEvidence('Mass', numberWithUnit(planet.pl_bmasse, 'M⊕'), planet.pl_bmasse_reflink,
        Object.hasOwn(massType, planet.pl_bmassprov) ? massType[planet.pl_bmassprov] : null) : '',
    positive(planet.flux) ? measurementEvidence('Stellar flux', numberWithUnit(planet.flux, 'S⊕', 3),
      planet.fluxEstimated ? null : planet.pl_insol_reflink,
      planet.fluxEstimated ? 'Atlas estimate from luminosity and orbit size' : null) : '',
    planet.fluxEstimated ? measurementEvidence('Stellar luminosity', numberWithUnit(star.st_lum, 'log L☉', 3), star.st_lum_reflink) : '',
    planet.fluxEstimated && planet.axisEstimated
      ? measurementEvidence('Orbital period', numberWithUnit(planet.pl_orbper, 'days'), planet.pl_orbper_reflink) +
        measurementEvidence('Stellar mass', numberWithUnit(star.st_mass, 'M☉'), star.st_mass_reflink)
      : planet.fluxEstimated ? measurementEvidence('Orbit size', numberWithUnit(planet.axis, 'AU', 4), planet.pl_orbsmax_reflink) : '',
    measurementEvidence('Stellar temperature', numberWithUnit(star.st_teff, 'K', 0), star.st_teff_reflink),
  ];
  return `<section class="life-evidence"><h5>Why it qualifies · ${habitabilityEvidence[planet.habitability]}</h5>
    <p>${compositionEvidence(planet)}</p><ul>${evidence.join('')}</ul>
    <p>${range}${referenceLink(trappist ? trappistHZSource : hzModelSource, 'Habitable zone source')}</p>
    ${planet.tags['earth-like'] ? '<p>Earth-like candidate · Radius and stellar flux meet the atlas’s Earth-like screen.</p>' : ''}</section>`;
}

function compositionEvidence(planet) {
  return planet.habitability === 'density'
    ? 'Radius is over 0.5 and up to 2 R⊕, with a reported mass and density of at least 3.5 g/cm³.'
    : 'Radius is over 0.5 and up to 1.6 R⊕. The density evidence is limited.';
}

function compareToggle(star, planet, showName = false) {
  const included = comparison.has(planet);
  return `<button class="quiet${showName ? '' : ' compare-toggle'}" data-compare-star="${star.id}"
    data-compare-planet="${star.planets.indexOf(planet)}" aria-pressed="${included}"
    aria-label="Compare ${escapeHtml(planet.pl_name)}" title="Toggle comparison">
    <b aria-hidden="true">${included ? '✓' : '+'}</b>${showName ? ' ' + escapeHtml(planet.pl_name) : ''}</button>`;
}

function openComparison(star) {
  $('compare-picker').hidden = !star;
  $('compare-picker-title').textContent = star ? 'Matching planets in ' + star.name : '';
  $('compare-choices').innerHTML = star ? matchingPlanets.get(star.id).map((planet) => compareToggle(star, planet, true)).join('') : '';
  $('compare-message').textContent = '';
  renderComparison();
  $('compare').showModal();
}

function compareValue(value, unit, source, description, limit, digits = 2, extraSources = '') {
  if (!Number.isFinite(value)) return '—<small>Missing</small>';
  const origin = limit ? 'Catalog limit' : description || (source === nasaCalculated ? 'NASA calculated' : 'Catalog reported');
  return `<strong>${numberWithUnit(value, unit, digits)}</strong><small>${origin}</small>
    ${referenceLink(source)}${extraSources}`;
}

function compareFlux(planet, star) {
  if (!planet.fluxEstimated) return compareValue(planet.flux, 'S⊕', planet.pl_insol_reflink, null, false, 3);
  const orbitSources = planet.axisEstimated
    ? referenceLink(planet.pl_orbper_reflink, 'Period source') + referenceLink(star.st_mass_reflink, 'Stellar mass source')
    : referenceLink(planet.pl_orbsmax_reflink, 'Orbit source');
  return compareValue(planet.flux, 'S⊕', null, 'Atlas estimate from luminosity and orbit size', false, 3,
    referenceLink(star.st_lum_reflink, 'Luminosity source') + orbitSources);
}

function catalogOverview(star) {
  return 'https://exoplanetarchive.ipac.caltech.edu/overview/' + encodeURIComponent(star.name);
}

function renderComparison() {
  const entries = [...comparison];
  $('compare-count').textContent = entries.length + '/' + COMPARE_LIMIT;
  if (!entries.length) {
    $('compare-content').innerHTML = '<p>Use + next to a matching host or a planet in System detail to start.</p>';
    return;
  }
  const rows = [
    ['Distance from Sol', (_planet, star) => compareValue(star.distance, 'ly', star === solar ? null : catalogOverview(star),
      star === solar ? 'Solar System reference' : 'NASA catalog distance')],
    ['Radius', (p, star) => compareValue(p.pl_rade, 'R⊕', p.pl_rade_reflink,
      star === solar ? 'Solar System reference' : null, p.pl_radelim)],
    ['Mass', (p, star) => compareValue(p.pl_bmasse, 'M⊕', p.pl_bmasse_reflink,
      star === solar ? 'Solar System reference' : Object.hasOwn(massType, p.pl_bmassprov) ? massType[p.pl_bmassprov] : null, p.pl_bmasselim)],
    ['Bulk density', (p) => compareValue(p.pl_dens, 'g/cm³', p.pl_dens_reflink, null, p.pl_denslim)],
    ['Stellar flux', compareFlux],
    ['Orbital period', (p, star) => compareValue(p.pl_orbper, 'days', p.pl_orbper_reflink, star === solar ? 'Solar System reference' : null)],
    ['Life Search', (p, star) => star === solar ? 'Solar System reference' : p.habitability
      ? `<strong>${habitabilityEvidence[p.habitability]}</strong><small>${compositionEvidence(p)}</small>
        ${referenceLink(trappistHZ.has(p.pl_name) ? trappistHZSource : hzModelSource, 'Habitable zone source')}`
      : 'Outside the candidate shortlist'],
    ['Probability of life', (p, star) => star === solar && p.pl_name === 'Earth' ? 'Life observed' : 'Unknown'],
  ];
  $('compare-content').innerHTML = `<div class="compare-scroll" tabindex="0" role="region" aria-label="Scrollable planet comparison">
    <table class="compare-table" aria-label="Planet measurements and Life Search evidence">
      <thead><tr><th scope="col">Measurement</th>${entries.map(([planet, star]) =>
        `<th scope="col">${escapeHtml(planet.pl_name)}<small>${escapeHtml(star.name)}</small>
          <button class="quiet" data-remove-planet="${star.planets.indexOf(planet)}" data-remove-star="${star.id}"
            aria-label="Remove ${escapeHtml(planet.pl_name)} from comparison">Remove</button></th>`).join('')}</tr></thead>
      <tbody>${rows.map(([label, value]) => `<tr><th scope="row">${label}</th>${entries.map(([planet, star]) =>
        `<td>${value(planet, star)}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div>`;
}

function comparisonStar(id) {
  return Number(id) === solar.id ? solar : systemById.get(Number(id));
}

function toggleComparison(button) {
  const star = comparisonStar(button.dataset.compareStar);
  const planet = star.planets[Number(button.dataset.comparePlanet)];
  if (comparison.has(planet)) comparison.delete(planet);
  else if (comparison.size < COMPARE_LIMIT) comparison.set(planet, star);
  else {
    if (!$('compare').open) openComparison();
    $('compare-message').textContent = 'The comparison is full. Remove a planet to add another.';
    return;
  }
  updateComparison();
}

function updateComparison() {
  $('compare-message').textContent = '';
  renderComparison();
  for (const button of document.querySelectorAll('[data-compare-planet]')) {
    const star = comparisonStar(button.dataset.compareStar);
    const included = comparison.has(star.planets[Number(button.dataset.comparePlanet)]);
    button.setAttribute('aria-pressed', String(included));
    button.querySelector('b').textContent = included ? '✓' : '+';
  }
}

$('compare').addEventListener('click', (event) => {
  const toggle = event.target.closest('[data-compare-planet]');
  if (toggle) toggleComparison(toggle);
  const remove = event.target.closest('[data-remove-planet]');
  if (remove) {
    const star = comparisonStar(remove.dataset.removeStar);
    comparison.delete(star.planets[Number(remove.dataset.removePlanet)]);
    updateComparison();
    ($('compare').querySelector('[data-remove-planet]') || $('compare').querySelector('.close')).focus();
  }
});

function planetInfo(planet, star) {
  const mass = numberWithUnit(planet.pl_bmasse, 'M⊕');
  const orbit = planet.axis ? (planet.axisEstimated ? '≈ ' : '') + numberWithUnit(planet.axis, 'AU', 5) : '—';
  const flags = traits.filter((t) => planet.tags[t.id]).map((t) => t.label).join(' · ');
  return `<div class="planet-info"><h4>${escapeHtml(planet.pl_name)}</h4>
    <p>${planet.discoverymethod ? escapeHtml(planet.discoverymethod) + ' · ' + fmt(planet.disc_year,0) : 'Solar System planet'}</p>
    <p>Radius ${planet.pl_radelim ? '—' : numberWithUnit(planet.pl_rade,'R⊕')} · Mass ${mass}${planet.pl_bmassprov ? ' (' + escapeHtml(planet.pl_bmassprov) + ')' : ''}</p>
    <p>Orbit ${orbit} · Period ${numberWithUnit(planet.pl_orbper,'days')}</p>
    ${planet.projectedSeparation ? '<p>Projected separation ' + numberWithUnit(planet.projectedSeparation,'AU',4) +
      referenceLink(planet.pl_orbsmax_reflink, 'Separation source') + '</p>' : ''}
    <p>Tₑq ${planet.pl_eqtlim ? '—' : numberWithUnit(planet.pl_eqt,'K',0)} · Flux ${planet.fluxEstimated ? '≈ ' : ''}${numberWithUnit(planet.flux,'S⊕')}</p>
    ${flags ? '<p>' + flags + '</p>' : ''}
    ${planet.discoverymethod ? '<p>Probability of life · Unknown</p>' : ''}
    ${planet.habitability ? lifeEvidence(planet, star) : ''}
    ${planet.tags.water ? '<a target="_blank" rel="noopener" href="' + evidence[planet.pl_name] + '">Water vapor source ↗</a>' : ''}
    ${!planet.habitability && trappistHZ.has(planet.pl_name) ? referenceLink(trappistHZSource, 'Habitable zone source') : ''}</div>`;
}

function renderDetail() {
  const detail = $('system-detail');
  const previousScroll = detail.scrollTop;
  const changed = detail.dataset.system !== String(selected.id);
  detail.dataset.system = selected.id;
  const star = selected;
  const matchingInSystem = new Set(star === solar ? star.planets : matchingPlanets.get(star.id));
  const filtered = matchingInSystem.size < star.planets.length;
  const label = escapeHtml(star.label);
  detail.innerHTML = `<div class="system-heading"><h3>${escapeHtml(star.name)}</h3><p>${label}${star.st_spectype && star.st_spectype !== star.label ? ' · ' + escapeHtml(star.st_spectype) : ''}${Number.isInteger(star.sy_snum) && star.sy_snum > 1 ? ' · ' + star.sy_snum + ' stars' : ''}</p></div>
    <div class="measurements"><div><strong>${numberWithUnit(star.distance,'ly',1)}</strong><span>Distance</span></div><div><strong>${numberWithUnit(star.st_teff,'K',0)}</strong><span>Stellar temp.</span></div><div><strong>${numberWithUnit(star.st_mass,'M☉')}</strong><span>Stellar mass</span></div></div>
    ${renderOrbit(star, matchingInSystem)}
    <div class="planet-title"><span>PLANETS</span><span>${filtered ? matchingInSystem.size + ' OF ' + star.planets.length + ' MATCH' : star.planets.length + (star === solar ? ' TOTAL' : ' CONFIRMED')}</span></div>
    <div class="planet-list">${star.planets.map((planet, index) => {
      const matches = matchingInSystem.has(planet);
      const habitable = planetInHabitableZone(star, planet);
      const note = [habitable ? 'Habitable zone' : '', matches ? '' : 'Outside filters',
        !positive(planet.axis) ? 'Orbit size unknown' : ''].filter(Boolean).join(' · ');
      return `<div class="compare-item"><button class="planet-row${matches ? '' : ' outside-filter'}" data-object="${index}" aria-pressed="${selectedPlanet === planet}">
      <i class="star-dot" data-dot="${matches ? planet.color : unmatchedPlanetColor}"></i><span class="planet-name"><strong>${escapeHtml(planet.pl_name)}</strong>
      ${note ? '<small class="planet-note' + (habitable ? ' habitable-note' : '') + '">' + note + '</small>' : ''}</span>
      <span>${planet.axis ? (planet.axisEstimated ? '≈' : '') + numberWithUnit(planet.axis,'AU',4) : '—'}</span></button>
      ${compareToggle(star, planet)}</div>`;
    }).join('')}</div>
    ${selectedPlanet ? planetInfo(selectedPlanet, star) : ''}
    <div class="catalog-links">${star === solar ? '<a href="https://science.nasa.gov/solar-system/planets/" target="_blank" rel="noopener">Solar System reference ↗</a>'
      : `<a href="${catalogOverview(star)}" target="_blank" rel="noopener">Open NASA catalog entry ↗</a>`}</div>`;
  colorDots(detail);
  detail.scrollTop = changed ? 0 : previousScroll;
}

function showOrbitTip(target) {
  const frame = $('orbit-frame');
  const marker = target.closest('svg') ? target : frame.querySelector(`[data-object="${target.dataset.object}"]`);
  const rect = frame.getBoundingClientRect();
  const body = marker?.getBoundingClientRect();
  const item = target.dataset.object === 'star' ? null : selected.planets[Number(target.dataset.object)];
  const x = body ? body.left + body.width/2 - rect.left : rect.width/2;
  const y = body ? body.top + body.height/2 - rect.top : rect.height/2;
  showTip($('orbit-tip'), frame, x, y, item ? planetTip(item) : starTip(selected));
}

const detail = $('system-detail');
detail.addEventListener('pointerover', (event) => {
  const target = event.target.closest('[data-object]');
  if (target) showOrbitTip(target);
});
detail.addEventListener('pointerout', (event) => {
  const target = event.target.closest('[data-object]');
  if (target && !target.contains(event.relatedTarget)) hideTip($('orbit-tip'));
});
detail.addEventListener('focusin', (event) => {
  const target = event.target.closest('[data-object]');
  if (target) showOrbitTip(target);
});
detail.addEventListener('focusout', () => hideTip($('orbit-tip')));

function selectPlanet(target) {
  if (!target || target.dataset.object === 'star') return;
  const index = Number(target.dataset.object);
  selectedPlanet = selected.planets[index];
  const focus = document.activeElement === target;
  renderDetail();
  const newTarget = $(target.closest('svg') ? 'orbit-frame' : 'system-detail').querySelector(
    (target.closest('svg') ? 'g' : 'button') + `[data-object="${index}"]`);
  if (focus) newTarget?.focus({ preventScroll:true });
  detail.querySelector('.planet-info')?.scrollIntoView({ block:'nearest' });
}
detail.addEventListener('click', (event) => {
  const toggle = event.target.closest('[data-compare-planet]');
  if (toggle) toggleComparison(toggle);
  else selectPlanet(event.target.closest('[data-object]'));
});
detail.addEventListener('keydown', (event) => {
  if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('g[role=button]')) {
    event.preventDefault();
    selectPlanet(event.target);
  }
});

const canvas = $('map');
const context = canvas.getContext('2d');
const chart = { w:0, h:0, scale:1, frame:0, hits:[] };
const camera = { view:'sol', yaw:0, pitch:0, radius:1, panX:0, panY:0 };
let hovered = null;

function resetCamera() {
  Object.assign(camera, camera.view === 'sol'
    ? { yaw:-.38, pitch:.55, radius:142, panX:0, panY:0 }
    : { yaw:-.31, pitch:.87, radius:56000, panX:0, panY:0 });
  hovered = null;
  hideTip($('map-tip'));
  scheduleDraw();
}

function project([x,y,z], galactic = false) {
  if (!galactic && camera.view === 'galaxy') x += SUN_X;
  const xx = x * chart.cosYaw - y * chart.sinYaw;
  const yy = x * chart.sinYaw + y * chart.cosYaw;
  return [
    chart.w/2 + (xx + camera.panX) * chart.scale,
    chart.h/2 + (yy * chart.sinPitch - z * chart.cosPitch + camera.panY) * chart.scale,
    yy * chart.cosPitch + z * chart.sinPitch,
  ];
}

function scheduleDraw() {
  if (!chart.frame) chart.frame = requestAnimationFrame(draw);
}

function circle(x,y,r) {
  context.beginPath();
  context.arc(x,y,r,0,TAU);
}

function niceStep(target) {
  const factor = 10 ** Math.floor(Math.log10(target));
  return ([1,2,5,10].find((n) => target / factor <= n) || 10) * factor;
}

function gridLine(a, b) {
  const [x1,y1] = project(a, true), [x2,y2] = project(b, true);
  context.moveTo(x1,y1);
  context.lineTo(x2,y2);
}

function drawGrid() {
  const galactic = camera.view === 'galaxy';
  const step = niceStep(55 / chart.scale);
  // Find where the view center meets the chart plane so panning retains a local grid.
  const centerX = -camera.panX;
  const sinPitch = chart.sinPitch;
  const centerY = Math.abs(sinPitch) > .1 ? -camera.panY / sinPitch : 0;
  const baseX = step * Math.round((centerX * chart.cosYaw + centerY * chart.sinYaw) / step);
  const baseY = step * Math.round((-centerX * chart.sinYaw + centerY * chart.cosYaw) / step);
  const extent = step * 33;
  context.beginPath();
  for (let i = -33; i <= 33; i++) {
    const x = baseX + i * step, y = baseY + i * step;
    gridLine([x,baseY-extent,0],[x,baseY+extent,0]);
    gridLine([baseX-extent,y,0],[baseX+extent,y,0]);
  }
  context.strokeStyle = galactic ? '#7278bc26' : '#6e79ae30';
  context.lineWidth = 1;
  context.stroke();
  context.beginPath();
  gridLine([0,baseY-extent,0],[0,baseY+extent,0]);
  gridLine([baseX-extent,0,0],[baseX+extent,0,0]);
  context.strokeStyle = '#a08de947';
  context.stroke();

  const [cx,cy] = project([0,0,0], true);
  context.lineWidth = .85;
  context.setLineDash([3,6]);
  for (const radius of [step,step*2,step*4]) {
    context.beginPath();
    context.ellipse(cx,cy,radius*chart.scale,Math.max(.1,radius*chart.scale*Math.abs(sinPitch)),0,0,TAU);
    context.strokeStyle = '#a493f140';
    context.stroke();
  }
  context.setLineDash([]);
}

let seed = 6301;
function random() {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
}
function bell() {
  return random() + random() + random() + random() - 2;
}
const backdrop = Array.from({length:390}, () => [random(),random(),random()]);
const disk = Array.from({length:10500}, (_, index) => {
  if (index < 1900) {
    const radius = random() ** 2 * 14300;
    const angle = random() * TAU;
    return [radius*Math.cos(angle), radius*Math.sin(angle), bell()*2300, random(), true];
  }
  const radius = 3200 + random() ** .87 * 49300;
  const angle = index % 4 * TAU/4 + 1.33 * Math.log(radius / 3800) + bell() * (.20 + .12 * random());
  return [radius*Math.cos(angle),radius*Math.sin(angle),bell()*1450,random(),false];
});

function drawBackdrop() {
  const { w,h } = chart;
  const gradient = context.createRadialGradient(w*.51,h*.48,10,w*.51,h*.48,Math.max(w,h)*.62);
  gradient.addColorStop(0,'#151934');
  gradient.addColorStop(.57,'#0c1428');
  gradient.addColorStop(1,'#070c18');
  context.fillStyle = gradient;
  context.fillRect(0,0,w,h);
  context.fillStyle = '#bec8fa';
  for (const [x,y,brightness] of backdrop) {
    context.globalAlpha = .05 + brightness * .25;
    const size = brightness > .96 ? 1.25 : .7;
    context.fillRect(x*w,y*h,size,size);
  }
  context.globalAlpha = 1;
}

function drawGalaxy() {
  const [cx,cy] = project([0,0,0], true);
  const radius = 16500 * chart.scale;
  const glow = context.createRadialGradient(cx,cy,0,cx,cy,radius);
  glow.addColorStop(0,'#ffb37957');
  glow.addColorStop(.22,'#a27bd34a');
  glow.addColorStop(1,'#5e55ad00');
  context.fillStyle = glow;
  context.fillRect(cx-radius,cy-radius,2*radius,2*radius);
  for (const entry of disk) {
    const [x,y] = project(entry, true);
    if (x < 0 || y < 0 || x > chart.w || y > chart.h) continue;
    const brightness = entry[3];
    context.fillStyle = entry[4] ? '#f1c5a5' : brightness > .43 ? '#ada0f2' : '#7299e9';
    context.globalAlpha = .035 + brightness * (entry[4] ? .23 : .16);
    const size = brightness > .97 ? 2 : 1.05;
    context.fillRect(x,y,size,size);
  }
  context.globalAlpha = 1;
}

function drawMarker({star,x,y}, role = '') {
  const color = role === 'sol' ? '#ffc478' : role ? '#82e3d1' : star.color;
  const radius = role === 'selected' ? 3.8 : role === 'sol' ? 4.3 : role ? 2.8 : 1.25;
  if (role) {
    const glow = context.createRadialGradient(x,y,0,x,y,14);
    glow.addColorStop(0,color + '78');
    glow.addColorStop(1,color + '00');
    context.fillStyle = glow;
    circle(x,y,14);
    context.fill();
    context.strokeStyle = color + '85';
    context.lineWidth = 1;
    circle(x,y,role === 'hover' ? 6.4 : 8);
    context.stroke();
  }
  context.fillStyle = color;
  circle(x,y,radius);
  context.fill();
}

function drawLabel(text,x,y,color, side = 1) {
  context.font = '600 11px "Segoe UI", sans-serif';
  context.lineJoin = 'round';
  context.strokeStyle = '#070c18';
  context.lineWidth = 3;
  context.textAlign = side === 1 ? 'left' : 'right';
  context.strokeText(text,x,y);
  context.fillStyle = color;
  context.fillText(text,x,y);
  context.textAlign = 'left';
}

function draw() {
  chart.frame = 0;
  const rect = canvas.getBoundingClientRect();
  chart.w = rect.width;
  chart.h = rect.height;
  if (!chart.w || !chart.h) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.round(chart.w * dpr), height = Math.round(chart.h * dpr);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  context.setTransform(dpr,0,0,dpr,0,0);
  chart.scale = Math.min(chart.w,chart.h) / (camera.radius * 2);
  chart.cosYaw = Math.cos(camera.yaw);
  chart.sinYaw = Math.sin(camera.yaw);
  chart.cosPitch = Math.cos(camera.pitch);
  chart.sinPitch = Math.sin(camera.pitch);

  const galaxy = camera.view === 'galaxy';
  drawBackdrop();
  if (galaxy) drawGalaxy();
  drawGrid();
  const sol = project(solar.position);
  const points = [];
  let count = 0;
  const solVisible = sol[0] >= 0 && sol[0] <= chart.w && sol[1] >= 0 && sol[1] <= chart.h;
  for (const star of matching) {
    if (!star.position) continue;
    const [x,y,z] = project(star.position);
    if (x < 0 || x > chart.w || y < 0 || y > chart.h) continue;
    if (!galaxy && Math.abs(z) > camera.radius * 1.45) continue;
    points.push({star,x,y,z});
    count++;
  }
  points.sort((a,b) => b.z - a.z);
  context.globalAlpha = galaxy && camera.radius > 3500 ? .54 : .78;
  for (const p of points) drawMarker(p);
  context.globalAlpha = 1;
  const selectedPoint = points.find((point) => point.star === selected);
  const hoverPoint = points.find((point) => point.star === hovered);

  // Label a few nearby reference hosts, keeping the selected system legible.
  const labelLocations = [];
  if (solVisible) labelLocations.push([sol[0],sol[1]]);
  if (selectedPoint) labelLocations.push([selectedPoint.x,selectedPoint.y]);
  if (!galaxy) {
    const candidates = ['Proxima Cen','Barnard\'s star','Ross 128','GJ 273','LHS 1140','TOI-700'];
    for (const name of candidates) {
      const p = points.find((point) => point.star.name.toLowerCase() === name.toLowerCase());
      if (!p || p.x < 35 || p.y < 56 || p.x > chart.w - 85 || p.y > chart.h - 32) continue;
      if (labelLocations.some(([x,y]) => Math.abs(p.x-x) < 84 && Math.abs(p.y-y) < 24)) continue;
      drawLabel(p.star.name,p.x+6,p.y-6,'#b3bdd9');
      labelLocations.push([p.x,p.y]);
    }
  }
  if (galaxy) {
    const [x,y] = project([0,0,0],true);
    if (x > 20 && x < chart.w-80 && y > 60 && y < chart.h-30) {
      drawLabel('Galactic center',x+6,y-8,'#e7bc9f');
    }
  }
  if (solVisible) {
    const point = { star:solar, x:sol[0], y:sol[1] };
    points.push(point);
    drawMarker(point,'sol');
    drawLabel('Sol',point.x+11,point.y+4,'#ffd199');
  }
  if (hoverPoint && hoverPoint !== selectedPoint) drawMarker(hoverPoint,'hover');
  if (selectedPoint) {
    const p = selectedPoint;
    drawMarker(p,'selected');
    const side = p.x > chart.w - 108 ? -1 : 1;
    drawLabel(p.star.name,p.x+side*12,p.y-10,'#a1f0de',side);
  }
  chart.hits = points;
  $('plot-count').textContent = fmt(count) + ' host' + (count === 1 ? '' : 's') + ' in view';
  $('projection').textContent = galaxy ? 'MILKY WAY · SCHEMATIC DISK' : 'SOL-CENTERED · GALACTIC PLANE';
  $('map-notice').textContent = selected.position ? 'Select a star to inspect its system' : 'Selected host has no 3D position';
  const scale = niceStep(42/chart.scale);
  $('scale-label').textContent = fmt(scale,2) + ' ly';
  $('scale-bar').style.width = (scale * chart.scale) + 'px';
}

function updateHover(event, activate = false) {
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left, y = event.clientY - rect.top;
  let best = null, closest = 9 ** 2;
  for (const point of chart.hits) {
    const distance = (point.x-x) ** 2 + (point.y-y) ** 2;
    if (distance <= closest) {
      best = point.star;
      closest = distance;
    }
  }
  if (activate) {
    selectStar(best, false);
    if (best && window.matchMedia('(max-width: 900px)').matches) $('inspector').scrollIntoView({block:'nearest'});
  }
  canvas.style.cursor = best ? 'pointer' : '';
  if (hovered !== best) {
    hovered = best;
    scheduleDraw();
  }
  if (best && !activate) showTip($('map-tip'),$('sky'),x,y,starTip(best));
  else hideTip($('map-tip'));
}

function zoom(factor, point) {
  const oldRadius = camera.radius;
  camera.radius = Math.max(.65, Math.min(83000, camera.radius * factor));
  if (point && chart.w && chart.h) {
    const ratio = camera.radius / oldRadius;
    camera.panX += (point[0] - chart.w/2) * (ratio - 1) / chart.scale;
    camera.panY += (point[1] - chart.h/2) * (ratio - 1) / chart.scale;
  }
  hideTip($('map-tip'));
  scheduleDraw();
}

const pointers = new Map();
let moved = false;
let origin = null;
let pinch = 0;
canvas.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  canvas.setPointerCapture(event.pointerId);
  pointers.set(event.pointerId,[event.clientX,event.clientY]);
  if (pointers.size === 1) {
    moved = false;
    origin = [event.clientX,event.clientY];
  } else if (pointers.size === 2) {
    moved = true;
    pinch = pinchDistance();
  }
  hideTip($('map-tip'));
});

function pinchDistance() {
  const [a,b] = [...pointers.values()];
  return Math.hypot(b[0]-a[0],b[1]-a[1]);
}

canvas.addEventListener('pointermove', (event) => {
  const previous = pointers.get(event.pointerId);
  if (!previous) {
    if (!pointers.size) updateHover(event);
    return;
  }
  pointers.set(event.pointerId,[event.clientX,event.clientY]);
  if (pointers.size === 2) {
    const distance = pinchDistance();
    if (distance > 1 && pinch > 1) zoom(pinch / distance);
    pinch = distance;
    return;
  }
  if (pointers.size !== 1) return;
  const dx = event.clientX - previous[0], dy = event.clientY - previous[1];
  if (Math.hypot(event.clientX-origin[0],event.clientY-origin[1]) > 4) moved = true;
  if (!moved) return;
  if (event.shiftKey) {
    camera.panX += dx/chart.scale;
    camera.panY += dy/chart.scale;
  } else {
    camera.yaw -= dx*.008;
    camera.pitch = Math.max(-Math.PI/2,Math.min(Math.PI/2,camera.pitch + dy*.008));
  }
  hovered = null;
  scheduleDraw();
});

function endPointer(event, activate) {
  if (!pointers.delete(event.pointerId)) return;
  if (pointers.size === 1) origin = [...pointers.values()][0];
  if (!pointers.size && !moved && activate) updateHover(event,true);
}
canvas.addEventListener('pointerup',(event) => endPointer(event,true));
canvas.addEventListener('pointercancel',(event) => endPointer(event,false));
canvas.addEventListener('lostpointercapture',(event) => endPointer(event,false));
canvas.addEventListener('pointerleave', () => {
  hovered = null;
  canvas.style.cursor = '';
  hideTip($('map-tip'));
  scheduleDraw();
});
canvas.addEventListener('wheel', (event) => {
  event.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const units = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? chart.h : 1;
  zoom(Math.exp(Math.max(-.6, Math.min(.6, event.deltaY * units * .0014))),
    [event.clientX-rect.left,event.clientY-rect.top]);
}, {passive:false});
canvas.addEventListener('keydown',(event) => {
  switch (event.key) {
    case 'ArrowLeft': camera.yaw += .14; break;
    case 'ArrowRight': camera.yaw -= .14; break;
    case 'ArrowUp': camera.pitch = Math.max(-Math.PI/2,camera.pitch-.12); break;
    case 'ArrowDown': camera.pitch = Math.min(Math.PI/2,camera.pitch+.12); break;
    case '+': case '=': zoom(.75); break;
    case '-': zoom(1.33); break;
    case 'Home': resetCamera(); break;
    default: return;
  }
  event.preventDefault();
  hideTip($('map-tip'));
  scheduleDraw();
});

$('zoom-in').addEventListener('click',() => zoom(.73));
$('zoom-out').addEventListener('click',() => zoom(1.37));
$('recenter').addEventListener('click',resetCamera);

const mapModes = document.querySelectorAll('[data-view]');
function setMapView(view) {
  camera.view = view;
  for (const button of mapModes) button.setAttribute('aria-pressed', String(button.dataset.view === view));
  $('map-mode').textContent = view === 'sol' ? 'LOCAL NEIGHBORHOOD' : 'GALACTIC OVERVIEW';
  resetCamera();
}
for (const button of mapModes) button.addEventListener('click', () => setMapView(button.dataset.view));

const viewFilters = {
  method: 'method',
  spectral: 'spectral',
  life: 'life-search',
  distance: 'distance-limit',
  match: 'trait-match',
};

function viewLink() {
  const params = new URLSearchParams({ v:'1', system:selected.name, map:camera.view });
  if ($('search').value) params.set('q', $('search').value);
  for (const [key, id] of Object.entries(viewFilters)) {
    if ($(id).value) params.set(key, $(id).value);
  }
  for (const trait of selectedTraits) params.append('trait', trait);
  if (selectedPlanet) params.set('planet', selectedPlanet.pl_name);
  for (const planet of comparison.keys()) params.append('compare', planet.pl_name);
  params.set('camera', [camera.yaw % TAU, camera.pitch, camera.radius, camera.panX, camera.panY].join(','));
  const url = new URL(window.location.href);
  url.hash = params.toString();
  return url.href;
}

function restoreView() {
  const fragment = window.location.hash.slice(1);
  if (fragment.length > 12000) return false;
  const params = new URLSearchParams(fragment);
  if (params.get('v') !== '1') return false;
  $('search').value = params.get('q') || '';
  for (const [key, id] of Object.entries(viewFilters)) {
    const control = $(id);
    const value = params.get(key);
    control.value = [...control.options].some((option) => option.value === value) ? value : control.options[0].value;
  }
  const requestedTraits = new Set(params.getAll('trait'));
  selectedTraits.clear();
  for (const button of $('traits').children) {
    const active = requestedTraits.has(button.dataset.trait);
    if (active) selectedTraits.add(button.dataset.trait);
    button.setAttribute('aria-pressed', String(active));
  }
  comparison.clear();
  for (const name of params.getAll('compare').slice(0, COMPARE_LIMIT)) {
    const star = systems.find((host) => host.planets.some((planet) => planet.pl_name === name)) ?? solar;
    const planet = star.planets.find((candidate) => candidate.pl_name === name);
    if (planet) comparison.set(planet, star);
  }
  setMapView(params.get('map') === 'galaxy' ? 'galaxy' : 'sol');
  const framing = (params.get('camera') || '').split(',');
  if (framing.length === 5 && framing.every((value) => value.trim() && Number.isFinite(Number(value)))) {
    const [yaw, pitch, radius, panX, panY] = framing.map(Number);
    if (Math.abs(yaw) <= TAU && Math.abs(pitch) <= Math.PI / 2 &&
        radius >= .65 && radius <= 83000 && Math.abs(panX) <= 1e7 && Math.abs(panY) <= 1e7) {
      Object.assign(camera, {yaw, pitch, radius, panX, panY});
    }
  }
  updateFilters();
  const name = params.get('system');
  const star = name === solar.name ? solar : systems.find((host) => host.name === name);
  if (star) {
    const planet = star.planets.find((candidate) => candidate.pl_name === params.get('planet'));
    selectStar(star, false, planet ?? null);
  }
  updateComparison();
  return true;
}

let copyFeedbackTimer;
$('copy-view').addEventListener('click', async () => {
  const link = viewLink();
  try {
    await navigator.clipboard.writeText(link);
  } catch {
    const field = $('view-link');
    field.value = link;
    if (!$('view-link-dialog').open) $('view-link-dialog').showModal();
    field.focus();
    field.select();
    return;
  }
  $('copy-view').textContent = 'Link copied';
  $('copy-view-status').textContent = 'View link copied to clipboard';
  clearTimeout(copyFeedbackTimer);
  copyFeedbackTimer = setTimeout(() => {
    $('copy-view').textContent = 'Copy view link';
    $('copy-view-status').textContent = '';
  }, 2500);
});

new ResizeObserver(scheduleDraw).observe($('sky'));
if (!restoreView()) {
  resetCamera();
  updateFilters();
}
window.addEventListener('hashchange', restoreView);
