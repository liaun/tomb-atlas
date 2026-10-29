#!/usr/bin/env python3
"""Create a GitHub repo and upload the static site via the Git Data API.

Usage:
    GITHUB_TOKEN=... python3 tools/deploy_github.py [repo-name]

No git installation required. The token needs repo creation + contents + pages
permissions (classic: `repo`; fine-grained: Administration/Contents/Pages read-write).
"""
import base64, json, os, sys, time, urllib.error, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API = "https://api.github.com"
REPO = sys.argv[1] if len(sys.argv) > 1 else "tomb-atlas"
TOKEN = os.environ.get("GITHUB_TOKEN", "").strip()
if not TOKEN:
    sys.exit("GITHUB_TOKEN is not set")

def req(method, path, data=None):
    body = json.dumps(data).encode() if data is not None else None
    r = urllib.request.Request(API + path, data=body, method=method, headers={
        "Authorization": "Bearer " + TOKEN,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "tomb-atlas-deploy",
        "Content-Type": "application/json",
    })
    try:
        with urllib.request.urlopen(r, timeout=60) as resp:
            return resp.status, json.loads(resp.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        print(e.code, e.read().decode()[:400])
        raise

_, user = req("GET", "/user")
owner = user["login"]
print("owner:", owner)

# Create repo (or reuse)
try:
    _, repo = req("GET", f"/repos/{owner}/{REPO}")
    print("repo exists:", repo["html_url"])
except urllib.error.HTTPError as e:
    if e.code != 404:
        raise
    _, repo = req("POST", "/user/repos", {
        "name": REPO,
        "description": "九州陵墓志 · 中国墓葬遗址交互地图",
        "homepage": f"https://{owner}.github.io/{REPO}/",
        "private": False,
        "has_issues": True,
        "has_projects": False,
        "has_wiki": False,
        "auto_init": False,
    })
    print("repo created:", repo["html_url"])

# The Git Data API refuses to create blobs in a completely empty repository,
# so initialize it with a tiny README on the default branch first.
try:
    _, ref0 = req("GET", f"/repos/{owner}/{REPO}/git/ref/heads/main")
    parent = ref0["object"]["sha"]
    print("base commit:", parent[:8])
except urllib.error.HTTPError as e:
    if e.code not in (404, 409):
        raise
    _, init = req("PUT", f"/repos/{owner}/{REPO}/contents/README.md", {
        "message": "Initialize repository",
        "content": base64.b64encode(b"# tomb-atlas\n").decode(),
    })
    parent = init["commit"]["sha"]
    print("initialized:", parent[:8])

# Collect files, excluding dev/build artifacts.
files = []
for dirpath, dirnames, filenames in os.walk(ROOT):
    dirnames[:] = [d for d in dirnames if d not in (".git", "node_modules", ".tools")]
    for fn in filenames:
        if fn in (".DS_Store", ".github_token", "shot.mjs", "shoot.mjs"):
            continue
        p = os.path.join(dirpath, fn)
        rel = os.path.relpath(p, ROOT).replace(os.sep, "/")
        if rel.startswith("tools/china_raw.json"):
            # keep the source map for rebuilds; it is part of the project
            pass
        files.append((p, rel))
files.sort(key=lambda x: x[1])
print("files:", len(files))

# Build blobs and tree
blobs = []
for p, rel in files:
    raw = open(p, "rb").read()
    _, blob = req("POST", f"/repos/{owner}/{REPO}/git/blobs", {
        "content": base64.b64encode(raw).decode(),
        "encoding": "base64",
    })
    blobs.append({"path": rel, "mode": "100644", "type": "blob", "sha": blob["sha"]})
    print("  blob", rel)

_, tree = req("POST", f"/repos/{owner}/{REPO}/git/trees", {"tree": blobs})
_, commit = req("POST", f"/repos/{owner}/{REPO}/git/commits", {
    "message": "Deploy 九州陵墓志 · 中国墓葬遗址地图",
    "tree": tree["sha"],
    "parents": [parent],
})
_, ref = req("PATCH", f"/repos/{owner}/{REPO}/git/refs/heads/main", {"sha": commit["sha"]})

# Enable Pages (main / root)
try:
    _, pages = req("POST", f"/repos/{owner}/{REPO}/pages", {
        "source": {"branch": "main", "path": "/"},
    })
    print("pages:", pages.get("html_url"))
except urllib.error.HTTPError as e:
    if e.code == 409:
        _, pages = req("PUT", f"/repos/{owner}/{REPO}/pages", {
            "source": {"branch": "main", "path": "/"},
        })
        print("pages updated:", pages.get("html_url"))
    else:
        raise

print("PAGES_URL", f"https://{owner}.github.io/{REPO}/")
