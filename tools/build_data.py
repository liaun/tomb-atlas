#!/usr/bin/env python3
"""Validate the tomb dataset and bundle it for the static site."""
import glob, json, math, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
OUT = os.path.join(ROOT, "assets", "tombs.js")
GEO = os.path.join(ROOT, "tools", "china_raw.json")

CATS = ["帝王陵寝", "王侯陵墓", "将相名臣", "文人名士", "史前墓地", "壁画画像石墓", "崖墓悬棺", "边疆民族", "传说纪念", "近现代陵园", "国保古墓葬"]
STATUS = ["已发掘", "部分发掘", "未发掘", "未证实", "未详", "已毁"]
ERAS = ["史前", "夏商周", "秦汉", "魏晋南北朝", "隋唐", "宋辽金西夏", "元明清", "近现代", "待考"]
PROVS = ["北京", "天津", "河北", "山西", "内蒙古", "辽宁", "吉林", "黑龙江", "上海", "江苏", "浙江", "安徽", "福建", "江西", "山东", "河南", "湖北", "湖南", "广东", "广西", "海南", "重庆", "四川", "贵州", "云南", "西藏", "陕西", "甘肃", "青海", "宁夏", "新疆", "台湾", "香港", "澳门"]
FULL = {
    "北京": "北京市", "天津": "天津市", "河北": "河北省", "山西": "山西省", "内蒙古": "内蒙古自治区",
    "辽宁": "辽宁省", "吉林": "吉林省", "黑龙江": "黑龙江省", "上海": "上海市", "江苏": "江苏省",
    "浙江": "浙江省", "安徽": "安徽省", "福建": "福建省", "江西": "江西省", "山东": "山东省",
    "河南": "河南省", "湖北": "湖北省", "湖南": "湖南省", "广东": "广东省", "广西": "广西壮族自治区",
    "海南": "海南省", "重庆": "重庆市", "四川": "四川省", "贵州": "贵州省", "云南": "云南省",
    "西藏": "西藏自治区", "陕西": "陕西省", "甘肃": "甘肃省", "青海": "青海省", "宁夏": "宁夏回族自治区",
    "新疆": "新疆维吾尔自治区", "台湾": "台湾省", "香港": "香港特别行政区", "澳门": "澳门特别行政区",
}
REQUIRED = ["id", "name", "cat", "status", "dynasty", "era", "province", "city", "lat", "lng", "summary", "detail"]


def point_in_ring(x, y, ring):
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi + 1e-15) + xi):
            inside = not inside
        j = i
    return inside


def point_in_feature(x, y, geom):
    polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
    for poly in polys:
        if poly and point_in_ring(x, y, poly[0]):
            # holes
            if not any(point_in_ring(x, y, h) for h in poly[1:]):
                return True
    return False


def main():
    geo = json.load(open(GEO, encoding="utf-8"))
    feats = {}
    for f in geo["features"]:
        n = f["properties"].get("name")
        if n:
            feats[n] = f

    files = sorted(glob.glob(os.path.join(DATA, "*.json")))
    tombs, errors, warnings = [], [], []
    ids, names = set(), set()
    for path in files:
        try:
            arr = json.load(open(path, encoding="utf-8"))
        except Exception as e:
            errors.append(f"{os.path.basename(path)}: JSON 解析失败: {e}")
            continue
        if not isinstance(arr, list):
            errors.append(f"{os.path.basename(path)}: 顶层必须是数组")
            continue
        for i, t in enumerate(arr):
            tag = f"{os.path.basename(path)}[{i}] {t.get('name', '?')}"
            for k in REQUIRED:
                if k not in t or t[k] in (None, ""):
                    errors.append(f"{tag}: 缺少字段 {k}")
            if t.get("id") in ids:
                errors.append(f"{tag}: id 重复 {t.get('id')}")
            ids.add(t.get("id"))
            if t.get("name") in names:
                warnings.append(f"{tag}: 名称重复 {t.get('name')}")
            names.add(t.get("name"))
            if t.get("cat") not in CATS:
                errors.append(f"{tag}: 未知类别 {t.get('cat')}")
            if t.get("status") not in STATUS:
                errors.append(f"{tag}: 未知状态 {t.get('status')}")
            if t.get("era") not in ERAS:
                errors.append(f"{tag}: 未知时代 {t.get('era')}")
            if t.get("province") not in PROVS:
                errors.append(f"{tag}: 未知省份 {t.get('province')}")
            lat, lng = t.get("lat"), t.get("lng")
            if not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)):
                errors.append(f"{tag}: 经纬度不是数字")
                continue
            if not (17.0 <= lat <= 54.0 and 73.0 <= lng <= 136.0):
                errors.append(f"{tag}: 经纬度超出中国范围 ({lat},{lng})")
            full = FULL.get(t.get("province"))
            if full and full in feats:
                if not point_in_feature(lng, lat, feats[full]["geometry"]):
                    # find which province it actually falls in
                    actual = [n for n, f in feats.items() if n != "100000_JD" and point_in_feature(lng, lat, f["geometry"])]
                    warnings.append(f"{tag}: 坐标可能不在{t.get('province')}，实际落在 {actual or '境外/海上'} ({lat},{lng})")
            t.setdefault("alias", "")
            t.setdefault("coordNote", "")
            t.setdefault("level", "")
            t.setdefault("excavation", "")
            t.setdefault("structure", "")
            t.setdefault("finds", [])
            t.setdefault("dispute", "")
            t.setdefault("tags", [])
            tombs.append(t)

    # Keep the authored order of data/*.json; the front-end handles display sorting.

    payload = "/* Generated from data/*.json by tools/build_data.py */\nwindow.TOMBS = " + json.dumps(tombs, ensure_ascii=False, separators=(",", ":")) + ";\n"
    open(OUT, "w", encoding="utf-8").write(payload)

    print(f"files={len(files)} tombs={len(tombs)} -> {OUT} ({len(payload)/1024:.1f} KB)")
    from collections import Counter
    print("categories:", dict(Counter(t["cat"] for t in tombs)))
    print("status:", dict(Counter(t["status"] for t in tombs)))
    print("eras:", dict(Counter(t["era"] for t in tombs)))
    print("provinces:", len(set(t["province"] for t in tombs)))
    if warnings:
        print("\nWARNINGS:")
        for w in warnings:
            print(" !", w)
    if errors:
        print("\nERRORS:")
        for e in errors:
            print(" x", e)
        sys.exit(1)
    print("\nOK")


if __name__ == "__main__":
    main()
