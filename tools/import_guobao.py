#!/usr/bin/env python3
"""Import the 420 national-level protected 'ancient tombs' (古墓葬).

Source: RelicsAtlas heritage_sites.json (derived from the official list of
National Key Cultural Relics Protection Units, 1961-2019).
https://github.com/lukemyself-hub/RelicsAtlas

This produces *catalogue-level* records (name, era, address, batch, coords).
They are intentionally marked status=未详 / quality=名录: the source does not
tell us whether a tomb was excavated, nor its exact form or owner. Details must
be filled from local gazetteers and archaeological reports later.
"""
import json, glob, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "tools", "guobao_tombs_raw.json")
OUT = os.path.join(ROOT, "data", "17-guobao.json")

PROVINCES = [
    ("北京市", "北京"), ("天津市", "天津"), ("河北省", "河北"), ("山西省", "山西"),
    ("内蒙古自治区", "内蒙古"), ("辽宁省", "辽宁"), ("吉林省", "吉林"),
    ("黑龙江省", "黑龙江"), ("上海市", "上海"), ("江苏省", "江苏"),
    ("浙江省", "浙江"), ("安徽省", "安徽"), ("福建省", "福建"), ("江西省", "江西"),
    ("山东省", "山东"), ("河南省", "河南"), ("湖北省", "湖北"), ("湖南省", "湖南"),
    ("广东省", "广东"), ("广西壮族自治区", "广西"), ("海南省", "海南"),
    ("重庆市", "重庆"), ("四川省", "四川"), ("贵州省", "贵州"), ("云南省", "云南"),
    ("西藏自治区", "西藏"), ("陕西省", "陕西"), ("甘肃省", "甘肃"), ("青海省", "青海"),
    ("宁夏回族自治区", "宁夏"), ("新疆维吾尔自治区", "新疆"), ("台湾省", "台湾"),
    ("香港特别行政区", "香港"), ("澳门特别行政区", "澳门"),
]

PREFIX = r"^(西汉|东汉|西晋|东晋|北魏|东魏|西魏|北齐|北周|北朝|南朝|前蜀|后蜀|南唐|吴越|南汉|后周|北宋|南宋|新石器时代|旧石器时代|青铜时代|战国|春秋|西周|东周|商周|秦|汉|周|商|夏|三国|晋|隋|唐|宋|辽|金|元|明|清|民国|近现代)"
SUFFIX = r"(墓和祠|古墓群|墓群|墓地|墓葬|古墓|陵墓|陵|墓|遗址|祠)$"

def core(name):
    s = re.sub(SUFFIX, "", name.strip())
    s = re.sub(PREFIX, "", s)
    return s.strip()

def era_group(e):
    if not e:
        return "待考"
    if any(k in e for k in ["旧石器", "新石器", "仰韶", "龙山", "良渚", "红山", "大汶口", "马家窑", "齐家", "屈家岭", "石家河", "北辛", "大溪", "昂昂溪", "卑南", "圆山", "青铜时代"]):
        return "史前" if "青铜时代" not in e else "夏商周"
    if any(k in e for k in ["夏", "商", "周", "春秋", "战国"]):
        return "夏商周"
    if any(k in e for k in ["秦", "汉"]):
        return "秦汉"
    if any(k in e for k in ["三国", "晋", "北魏", "东魏", "西魏", "北齐", "北周", "北朝", "南朝", "南北朝"]):
        return "魏晋南北朝"
    if any(k in e for k in ["隋", "唐", "五代", "前蜀", "后蜀", "南唐", "吴越", "闽", "南汉", "后周"]):
        return "隋唐"
    if any(k in e for k in ["宋", "辽", "金", "西夏"]):
        return "宋辽金西夏"
    if any(k in e for k in ["元", "明", "清"]):
        return "元明清"
    if any(k in e for k in ["民国", "近现代", "现代"]):
        return "近现代"
    return "待考"

def addr_parts(addr):
    for full, short in PROVINCES:
        if addr.startswith(full):
            return short, addr[len(full):].strip() or short
    return None, addr

def main():
    src = json.load(open(SRC, encoding="utf-8"))
    existing = []
    for p in glob.glob(os.path.join(ROOT, "data", "*.json")):
        if os.path.basename(p).startswith("17-"):
            continue
        existing.extend(json.load(open(p, encoding="utf-8")))

    existing_names = {t["name"] for t in existing}
    imported, skipped, bad_prov = [], [], []
    for idx, x in enumerate(src):
        address = x["address"].replace("新疆维吾尔自区", "新疆维吾尔自治区")
        prov, city = addr_parts(address)
        if not prov:
            bad_prov.append((x["name"], x["address"]))
            continue
        sname = x["name"].strip()
        sc = core(sname)
        dup = False
        for e in existing:
            if e["province"] != prov:
                continue
            en = e["name"]
            ec = core(en)
            if sname == en or (len(sname) >= 2 and sname in en) or (len(en) >= 2 and en in sname):
                dup = True; break
            if sc and ec and len(sc) >= 2 and len(ec) >= 2 and (sc in ec or ec in sc):
                dup = True; break
        if dup:
            skipped.append(sname)
            continue
        era = x.get("era") or "待考"
        rec = {
            "id": f"guobao-{idx:04d}",
            "name": sname,
            "alias": "",
            "cat": "国保古墓葬",
            "status": "未详",
            "dynasty": era,
            "era": era_group(era),
            "province": prov,
            "city": city,
            "lat": round(float(x["latitude"]), 6),
            "lng": round(float(x["longitude"]), 6),
            "coordNote": "国保名录坐标（可能为地址点，精度有限）",
            "level": "全国重点文物保护单位·" + x["batch"],
            "excavation": "待结合地方志与考古报告补充",
            "structure": "国保名录列为古墓葬；形制、墓主待补",
            "finds": [],
            "summary": f"{sname}，{era}，位于{address}，全国重点文物保护单位（{x['batch']}）。",
            "detail": f"本条来自全国重点文物保护单位名录（{x['batch']}），类型为古墓葬，已录入名称、时代、地址与坐标。墓主、形制、发掘经过及出土物等细节，待结合地方志、考古报告和文物保护单位档案补充。",
            "dispute": "",
            "tags": ["国保名录", "资料待补"],
            "source": "全国重点文物保护单位名录（1961—2019）",
            "quality": "名录",
            "batch": x["batch"],
        }
        imported.append(rec)

    # Disambiguate duplicate names (including names already used by curated entries).
    used = set(existing_names)
    for rec in imported:
        n = rec["name"]
        if n in used:
            n = f"{n}（{rec['city']}）"
        base = n
        i = 2
        while n in used:
            n = f"{base}-{i}"; i += 1
        rec["name"] = n
        used.add(n)

    imported.sort(key=lambda r: (r["province"], r["batch"], r["name"]))
    json.dump(imported, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"source={len(src)} imported={len(imported)} skipped={len(skipped)} no_province={len(bad_prov)}")
    if bad_prov:
        print("NO PROVINCE:", bad_prov[:10])
    print("skipped sample:", skipped[:30])

if __name__ == "__main__":
    main()
