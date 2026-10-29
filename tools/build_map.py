#!/usr/bin/env python3
"""Build a compact, self-contained China province map for the tomb atlas.

Source: DataV GeoAtlas 100000_full.json (province boundaries, WGS84).
Projection: Albers equal-area conic, standard parallels 25N/47N, central meridian 105E.
Output: assets/china-map.js  ->  window.CHINA_MAP
"""
import json, math, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "tools", "china_raw.json")
OUT = os.path.join(ROOT, "assets", "china-map.js")

W, H = 1000.0, 720.0
PAD = 38.0
LAT1, LAT2, LON0 = math.radians(25), math.radians(47), 105.0

N = (math.sin(LAT1) + math.sin(LAT2)) / 2
C = math.cos(LAT1) ** 2 + 2 * N * math.sin(LAT1)
RHO0 = math.sqrt(C) / N


def albers(lon, lat):
    lat = max(-85.0, min(85.0, lat))
    rho = math.sqrt(C - 2 * N * math.sin(math.radians(lat))) / N
    theta = N * math.radians(lon - LON0)
    return rho * math.sin(theta), RHO0 - rho * math.cos(theta)


def ring_area(ring):
    s = 0.0
    for i in range(len(ring) - 1):
        x1, y1 = ring[i][0], ring[i][1]
        x2, y2 = ring[i + 1][0], ring[i + 1][1]
        s += x1 * y2 - x2 * y1
    return abs(s) / 2


def rdp(points, eps):
    if len(points) < 3:
        return points
    # iterative Douglas-Peucker
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        a, b = stack.pop()
        if b <= a + 1:
            continue
        ax, ay = points[a][0], points[a][1]
        bx, by = points[b][0], points[b][1]
        dx, dy = bx - ax, by - ay
        norm = math.hypot(dx, dy)
        best, idx = -1.0, -1
        for i in range(a + 1, b):
            px, py = points[i][0], points[i][1]
            if norm == 0:
                d = math.hypot(px - ax, py - ay)
            else:
                d = abs(dy * px - dx * py + bx * ay - by * ax) / norm
            if d > best:
                best, idx = d, i
        if best > eps and idx > 0:
            keep[idx] = True
            stack.append((a, idx))
            stack.append((idx, b))
    return [p for p, k in zip(points, keep) if k]


def simplify_ring(ring, eps):
    closed = ring[0] == ring[-1]
    pts = ring[:-1] if closed else ring[:]
    if len(pts) < 4:
        return ring
    simp = rdp(pts, eps)
    if len(simp) < 3:
        return ring
    # ensure orientation preserved and close
    simp = simp + [simp[0]]
    return simp


def collect(features, min_area=0.006, eps=0.022):
    """Return list of (feature_name, [rings]) with simplified lon/lat rings."""
    out = []
    for f in features:
        name = f["properties"].get("name") or "南海诸岛"
        geom = f["geometry"]
        polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
        rings = []
        for poly in polys:
            for ri, ring in enumerate(poly):
                if len(ring) < 4:
                    continue
                if ring_area(ring) < min_area:
                    continue
                rings.append(simplify_ring(ring, eps))
        out.append((name, rings))
    return out


def bounds(rings):
    xs = [p[0] for r in rings for p in r]
    ys = [p[1] for r in rings for p in r]
    return min(xs), max(xs), min(ys), max(ys)


def main():
    data = json.load(open(SRC, encoding="utf-8"))
    feats = data["features"]
    jd = [f for f in feats if f["properties"].get("adcode") == "100000_JD"]
    provinces = [f for f in feats if f["properties"].get("adcode") != "100000_JD"]

    # Split southern islands (for inset) from the main map.
    main_rings = []
    inset_rings = []
    for f in provinces:
        name = f["properties"]["name"]
        geom = f["geometry"]
        polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
        for poly in polys:
            for ri, ring in enumerate(poly):
                if len(ring) < 4 or ring_area(ring) < 1e-5:
                    continue
                lats = [p[1] for p in ring]
                target = inset_rings if max(lats) < 17.6 else main_rings
                target.append((name, ring))

    # Main projection fitted to the main map extent.
    mx0, mx1, my0, my1 = 1e9, -1e9, 1e9, -1e9
    for _, ring in main_rings:
        for lon, lat in ring:
            x, y = albers(lon, lat)
            mx0, mx1 = min(mx0, x), max(mx1, x)
            my0, my1 = min(my0, y), max(my1, y)
    scale = min((W - PAD * 2) / (mx1 - mx0), (H - PAD * 2) / (my1 - my0))
    ox = (W - (mx1 - mx0) * scale) / 2 - mx0 * scale
    oy = (H - (my1 - my0) * scale) / 2 + my1 * scale  # y flipped

    def px(lon, lat):
        x, y = albers(lon, lat)
        return x * scale + ox, oy - y * scale

    # Province paths (grouped by province to allow a single path per name).
    by_prov = {}
    for name, ring in main_rings:
        simp = simplify_ring(ring, 0.016)
        if ring_area(simp) < 0.004:
            continue
        pts = [px(lon, lat) for lon, lat in simp]
        d = "M" + " L".join(f"{x:.1f},{y:.1f}" for x, y in pts) + "Z"
        by_prov.setdefault(name, []).append(d)

    short = {
        "内蒙古自治区": "内蒙古", "广西壮族自治区": "广西", "宁夏回族自治区": "宁夏",
        "新疆维吾尔自治区": "新疆", "西藏自治区": "西藏", "香港特别行政区": "香港",
        "澳门特别行政区": "澳门",
    }
    provinces_js = []
    labels_js = []
    for f in provinces:
        name = f["properties"]["name"]
        if name not in by_prov:
            continue
        sname = short.get(name, name.replace("省", "").replace("市", ""))
        provinces_js.append({"name": name, "short": sname, "d": " ".join(by_prov[name])})
        c = f["properties"].get("center") or f["properties"].get("centroid")
        if c:
            lx, ly = px(c[0], c[1])
            if 20 < lx < W - 20 and 20 < ly < H - 20:
                labels_js.append({"name": sname, "x": round(lx, 1), "y": round(ly, 1)})

    # Inset: South China Sea islands + the nine-dash line.
    ix0, iy0, iw, ih = 858.0, 525.0, 118.0, 160.0
    all_inset = [(n, r) for n, r in inset_rings]
    jd_rings = []
    for f in jd:
        geom = f["geometry"]
        polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
        for poly in polys:
            for ring in poly:
                if len(ring) >= 4:
                    jd_rings.append(("南海诸岛", ring))
    if jd_rings:
        # keep the inset framed on the sea, not on distant outliers
        lons = [p[0] for _, r in jd_rings for p in r] + [p[0] for _, r in all_inset for p in r]
        lats = [p[1] for _, r in jd_rings for p in r] + [p[1] for _, r in all_inset for p in r]
        bx0, bx1, by0, by1 = min(lons) - 1, max(lons) + 1, min(lats) - 1, max(lats) + 1
        sx = (iw - 8) / (bx1 - bx0)
        sy = (ih - 22) / (by1 - by0)
        s = min(sx, sy)
        cx = ix0 + iw / 2
        cy = iy0 + 10 + (ih - 22) / 2
        mcx, mcy = (bx0 + bx1) / 2, (by0 + by1) / 2

        def ip(lon, lat):
            return cx + (lon - mcx) * s, cy - (lat - mcy) * s

        inset_paths = []
        for _, ring in all_inset:
            simp = simplify_ring(ring, 0.01)
            if ring_area(simp) < 2e-6:
                continue
            pts = [ip(lon, lat) for lon, lat in simp]
            inset_paths.append("M" + " L".join(f"{x:.1f},{y:.1f}" for x, y in pts) + "Z")
        jd_paths = []
        for _, ring in jd_rings:
            simp = simplify_ring(ring, 0.006)
            if ring_area(simp) < 1e-7:
                continue
            pts = [ip(lon, lat) for lon, lat in simp]
            jd_paths.append("M" + " L".join(f"{x:.1f},{y:.1f}" for x, y in pts) + "Z")
        inset = {
            "x": ix0, "y": iy0, "w": iw, "h": ih,
            "labelX": cx, "labelY": iy0 + ih - 12,
            "islands": " ".join(inset_paths),
            "dash": " ".join(jd_paths),
        }
    else:
        inset = None

    # Major rivers for orientation (approximate courses, WGS84).
    yellow = [(96.2, 35.0), (98.5, 35.2), (100.8, 35.8), (102.8, 36.1), (104.2, 36.5),
              (105.6, 37.6), (106.8, 39.2), (107.6, 40.4), (109.4, 40.8), (110.8, 40.2),
              (111.2, 39.2), (110.7, 37.4), (110.4, 35.9), (111.8, 34.9), (113.6, 34.9),
              (115.4, 35.4), (117.0, 36.6), (118.4, 37.6)]
    yangtze = [(91.2, 33.6), (93.5, 32.9), (96.5, 31.8), (98.6, 30.2), (99.2, 28.4),
               (100.4, 26.9), (101.6, 26.2), (103.5, 28.3), (105.5, 29.2), (107.2, 30.1),
               (109.0, 30.7), (110.8, 30.5), (112.4, 30.3), (114.2, 30.7), (115.8, 29.8),
               (117.2, 30.8), (118.6, 31.6), (120.0, 32.0), (121.5, 31.6), (121.9, 31.3)]
    rivers = []
    for name, pts in (("黄河", yellow), ("长江", yangtze)):
        proj = [px(lon, lat) for lon, lat in pts]
        rivers.append({"name": name, "d": "M" + " L".join(f"{x:.1f},{y:.1f}" for x, y in proj)})

    payload = {
        "width": W, "height": H,
        "proj": {"n": N, "c": C, "rho0": RHO0, "scale": scale, "ox": ox, "oy": oy, "lon0": LON0},
        "provinces": provinces_js,
        "labels": labels_js,
        "rivers": rivers,
        "inset": inset,
    }
    js = "/* Generated by tools/build_map.py — DataV GeoAtlas, WGS84 */\n"
    js += "window.CHINA_MAP = " + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n"
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    open(OUT, "w", encoding="utf-8").write(js)
    print(f"wrote {OUT} ({len(js)/1024:.1f} KB), {len(provinces_js)} provinces, {len(labels_js)} labels")
    print(f"scale={scale:.3f} ox={ox:.1f} oy={oy:.1f}")
    for test in [("北京", 116.4, 39.9), ("西安", 108.95, 34.27), ("乌鲁木齐", 87.6, 43.8),
                 ("三亚", 109.5, 18.25), ("台北", 121.56, 25.03), ("漠河", 122.3, 53.5)]:
        print(test[0], tuple(round(v, 1) for v in px(test[1], test[2])))
    if inset:
        print("inset", inset["x"], inset["y"], inset["w"], inset["h"])


if __name__ == "__main__":
    main()
