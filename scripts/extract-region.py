#!/usr/bin/env python3
"""Cuts the map region (scripts/data/region.json) out of an OpenStreetMap extract (.osm.pbf).

Usage:
    python3 scripts/extract-region.py [path/to/santa-catarina-latest.osm.pbf]

Default input: .cache/osm-pbf/santa-catarina-latest.osm.pbf, from
https://download.openstreetmap.fr/extracts/south-america/brazil/south/santa-catarina-latest.osm.pbf
(see `npm run data:download`).

Writes GeoJSON to .cache/region/ (not versioned: tens of MB): bairros, boundary (union of the chosen
neighbourhoods), buildings, roads (with surface and lighting tags), water, green (with its kind), trees and street
lamps mapped in OSM, plus meta.json. scripts/build-tiles.mjs turns them into
public/data/*.pmtiles; the listing/development generators read them directly.

Requires: pip install osmium shapely
"""
import json
import os
import sys
from datetime import datetime, timezone

import osmium
from shapely.geometry import Point, mapping, shape
from shapely.ops import transform, unary_union
from shapely.prepared import prep

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
REGION = json.load(open(os.path.join(ROOT, 'scripts', 'data', 'region.json'), encoding='utf-8'))
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, '.cache', 'osm-pbf', 'santa-catarina-latest.osm.pbf')
OUT = os.path.join(ROOT, '.cache', 'region')

# Tags kept on buildings: height rule (scripts/lib/height.mjs) and residential rule (scripts/lib/residential.mjs)
BUILDING_TAGS = ['building', 'building:levels', 'height', 'name', 'amenity', 'shop', 'office', 'healthcare',
                 'craft', 'tourism', 'leisure', 'religion', 'denomination', 'industrial']
# green areas and the kind kept for the style (parks, grass, woods, scrub, wetlands, fields)
GREEN = {
    ('leisure', 'park'): 'park', ('leisure', 'garden'): 'park', ('landuse', 'grass'): 'grass',
    ('landuse', 'meadow'): 'grass', ('natural', 'grassland'): 'grass', ('landuse', 'forest'): 'wood',
    ('natural', 'wood'): 'wood', ('natural', 'scrub'): 'scrub', ('natural', 'wetland'): 'wetland',
    ('landuse', 'farmland'): 'farm', ('landuse', 'orchard'): 'farm',
}
WATERWAYS = {'river', 'stream', 'canal'}
# ~ 60 m around the region, so streets and rivers on its edge are complete
MARGIN_DEG = 0.0006

factory = osmium.geom.GeoJSONFactory()


def rounded(geom):
    def r(c):
        return [r(x) for x in c] if isinstance(c[0], (list, tuple)) else [round(c[0], 7), round(c[1], 7)]
    g = mapping(geom) if not isinstance(geom, dict) else geom
    return {'type': g['type'], 'coordinates': r(g['coordinates'])}


def area_id(a):
    return f"{'way' if a.from_way() else 'relation'}/{a.orig_id()}"


# ---------------------------------------------------------------- 1. region
# Two ways to define it in region.json:
#   "municipios": ["Joinville", "Araquari"]   whole municipalities (admin_level 8);
#   "city" + "bairros": [...]                  chosen neighbourhoods (admin_level 10) of one city.
# Every neighbourhood and district inside the region gets an outline/label.
print(f'Lendo {SRC}')
MUNIS = REGION.get('municipios') or [REGION['city']]
munis = {}
districts = []  # admin_level 9 (e.g. Pirabeiraba, a district of Joinville)
all_bairros = []
for a in osmium.FileProcessor(SRC).with_areas(osmium.filter.TagFilter(('boundary', 'administrative'))) \
        .with_filter(osmium.filter.EntityFilter(osmium.osm.AREA)):
    t = dict(a.tags)
    level = t.get('admin_level')
    if level not in ('8', '9', '10') or (level == '8' and t.get('name') not in MUNIS):
        continue
    try:
        g = shape(json.loads(factory.create_multipolygon(a)))
    except RuntimeError:
        continue  # broken boundary somewhere else in the state
    if level == '8':
        munis[t['name']] = g
    elif level == '9':
        districts.append((t.get('name'), area_id(a), g))
    else:
        all_bairros.append((t.get('name'), area_id(a), g))
missing = [m for m in MUNIS if m not in munis]
if missing:
    sys.exit(f'Município(s) não encontrado(s) no extrato: {missing}')
cities = unary_union(list(munis.values()))
in_cities = [(n, i, g) for n, i, g in all_bairros if cities.contains(g.representative_point())]
if REGION.get('bairros'):
    chosen = {}
    for name in REGION['bairros']:
        # names repeat in neighbouring towns (e.g. "Santo Antônio"): keep the one inside the city
        inside = [(i, g) for n, i, g in in_cities if n == name]
        if len(inside) != 1:
            sys.exit(f'Bairro "{name}": {len(inside)} polígonos em {MUNIS} (esperado 1)')
        chosen[name] = inside[0]
    region = unary_union([g for _, g in chosen.values()])
    labels = [(n, 'bairro', i, g) for n, (i, g) in chosen.items()]
else:
    region = cities
    labels = [(n, 'bairro', i, g) for n, i, g in in_cities]
    labels += [(n, 'distrito', i, g) for n, i, g in districts if cities.contains(g.representative_point())]
    labels += [(n, 'cidade', None, g) for n, g in munis.items()]
region_buf = prep(region.buffer(MARGIN_DEG))
region_prep = prep(region)
minx, miny, maxx, maxy = region.buffer(MARGIN_DEG).bounds
print(f'Região: {", ".join(MUNIS)}; {sum(1 for l in labels if l[1] == "bairro")} bairros, bbox {minx:.4f},{miny:.4f},{maxx:.4f},{maxy:.4f}')


def in_bbox(g):
    bx = g.bounds
    return bx[0] <= maxx and bx[2] >= minx and bx[1] <= maxy and bx[3] >= miny


# ---------------------------------------------------------------- 2. features
buildings, roads, water, green, trees, lamps = [], [], [], [], [], []
keys = ('building', 'highway', 'natural', 'waterway', 'leisure', 'landuse')
fp = osmium.FileProcessor(SRC).with_areas(osmium.filter.KeyFilter(*keys)).with_filter(osmium.filter.KeyFilter(*keys))
for o in fp:
    t = o.tags
    if o.is_node():
        # mapped trees and street lamps (few in OSM; the tile builder adds illustrative ones)
        kind = 'tree' if t.get('natural') == 'tree' else 'lamp' if t.get('highway') == 'street_lamp' else None
        if kind:
            x, y = o.location.lon, o.location.lat
            if minx <= x <= maxx and miny <= y <= maxy and region_buf.contains(Point(x, y)):
                (trees if kind == 'tree' else lamps).append(
                    {'type': 'Feature', 'properties': {'osmId': f'node/{o.id}'},
                     'geometry': {'type': 'Point', 'coordinates': [round(x, 7), round(y, 7)]}})
        continue
    if o.is_area():
        a = o
        try:
            g = shape(json.loads(factory.create_multipolygon(a)))
        except Exception:
            continue
        if not in_bbox(g):
            continue
        if 'building' in t:
            # a building belongs to the region when its centre is inside it
            if not region_prep.contains(g.representative_point()):
                continue
            props = {'osmId': area_id(a)}
            for k in BUILDING_TAGS:
                if k in t:
                    props[k] = t[k]
            buildings.append({'type': 'Feature', 'properties': props, 'geometry': rounded(g)})
        elif t.get('natural') == 'water' or t.get('waterway') == 'riverbank':
            if region_buf.intersects(g):
                kind = 'river' if t.get('waterway') == 'riverbank' else t.get('water', 'water')
                water.append({'type': 'Feature', 'properties': {'osmId': area_id(a), 'water': kind},
                              'geometry': rounded(g)})
        else:
            kind = next((GREEN[(k, t.get(k))] for k in ('leisure', 'landuse', 'natural') if (k, t.get(k)) in GREEN), None)
            if kind and region_buf.intersects(g):
                green.append({'type': 'Feature', 'properties': {'osmId': area_id(a), 'kind': kind},
                              'geometry': rounded(g)})
    elif o.is_way() and t.get('natural') == 'tree_row':
        try:
            g = shape(json.loads(factory.create_linestring(o)))
        except Exception:
            continue
        if in_bbox(g) and region_buf.intersects(g):
            trees.append({'type': 'Feature', 'properties': {'osmId': f'way/{o.id}', 'row': True}, 'geometry': rounded(g)})
    elif o.is_way() and ('highway' in t or t.get('waterway') in WATERWAYS):
        try:
            g = shape(json.loads(factory.create_linestring(o)))
        except Exception:
            continue
        if not in_bbox(g) or not region_buf.intersects(g):
            continue
        if 'highway' in t:
            props = {'osmId': f'way/{o.id}', 'highway': t['highway']}
            # pavement (asphalt, paving stones, dirt…) and street lighting, when mapped
            for k in ('name', 'surface', 'lit', 'bridge', 'tunnel', 'layer'):
                if k in t:
                    props[k] = t[k]
            roads.append({'type': 'Feature', 'properties': props, 'geometry': rounded(g)})
        else:
            water.append({'type': 'Feature', 'properties': {'osmId': f'way/{o.id}', 'waterway': t['waterway']},
                          'geometry': rounded(g)})

# ---------------------------------------------------------------- 2b. canopy of woods
# The map draws woods as a low canopy mass with trees along the edge. The mass is the wood shrunk by
# CANOPY_INSET_M (so the edge trees stand in front of it) and simplified (≈ 2 m): small in the tiles.
CANOPY_INSET_M = 6
lat0 = (miny + maxy) / 2
KX = 111320 * __import__('math').cos(__import__('math').radians(lat0))
KY = 110540
to_m = lambda x, y, z=None: (x * KX, y * KY)
to_deg = lambda x, y, z=None: (x / KX, y / KY)
canopy = []
for f in green:
    if f['properties']['kind'] != 'wood':
        continue
    g = transform(to_m, shape(f['geometry']))
    inner = g.buffer(-CANOPY_INSET_M).simplify(2)
    if inner.is_empty or inner.area < 150:
        continue
    canopy.append({'type': 'Feature', 'properties': {'osmId': f['properties']['osmId']},
                   'geometry': rounded(transform(to_deg, inner))})

# ---------------------------------------------------------------- 2c. neighbourhoods plus 100 m
# The "bairro" filter cuts the map to a neighbourhood and BAIRRO_MARGIN_M around it (the rest is masked).
BAIRRO_MARGIN_M = 100
bairro_buffers = []
for n, kind, i, g in labels:
    if kind != 'bairro':
        continue
    grown = transform(to_deg, transform(to_m, g).buffer(BAIRRO_MARGIN_M).simplify(4))
    bairro_buffers.append({'type': 'Feature', 'properties': {'name': n}, 'geometry': rounded(grown)})

# ---------------------------------------------------------------- 3. write
os.makedirs(OUT, exist_ok=True)


def write(name, features):
    with open(os.path.join(OUT, name), 'w', encoding='utf-8') as f:
        json.dump({'type': 'FeatureCollection', 'features': features}, f, ensure_ascii=False, separators=(',', ':'))


write('bairros.geojson', [{'type': 'Feature', 'properties': {'name': n, 'kind': kind, **({'osmId': i} if i else {})},
                           'geometry': rounded(g)} for n, kind, i, g in labels])
write('boundary.geojson', [{'type': 'Feature', 'properties': {'name': REGION['name']}, 'geometry': rounded(region)}])
# simplified outline (≈ 10 m) for the browser, which tests points against it
write('boundary-simple.geojson', [{'type': 'Feature', 'properties': {'name': REGION['name']},
                                   'geometry': rounded(region.simplify(0.0001, preserve_topology=True))}])
write('buildings.geojson', buildings)
write('roads.geojson', roads)
write('water.geojson', water)
write('green.geojson', green)
write('trees.geojson', trees)
write('canopy.geojson', canopy)
write('bairros-buffer.geojson', bairro_buffers)
write('lamps.geojson', lamps)
header_ts = osmium.io.Reader(SRC, osmium.osm.osm_entity_bits.NOTHING).header().get('osmosis_replication_timestamp', '')
c = region.centroid
meta = {
    'region': REGION['id'],
    'regionName': REGION['name'],
    'municipios': MUNIS,
    'bairros': sorted({n for n, kind, _, _ in labels if kind == 'bairro'}),
    'source': os.path.basename(SRC),
    'osmTimestamp': header_ts,
    'extractedAt': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
    'center': [round(c.x, 7), round(c.y, 7)],
    'boundaryBbox': [round(v, 6) for v in region.bounds],
    'counts': {'buildings': len(buildings), 'roads': len(roads), 'water': len(water), 'green': len(green),
               'osmTrees': len(trees), 'osmLamps': len(lamps)},
}
json.dump(meta, open(os.path.join(OUT, 'meta.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
print(json.dumps(meta['counts']))
