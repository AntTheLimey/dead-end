#!/usr/bin/env python3
"""Post-build: rebuild docs/locations/index.html as a star-system grouped chart.

The native gm-apprentice renderer roots the Locations listing at a single
political node (Federal Republic of Worlds), which funnels every location into
one deep tree. This regroups the published locations by their nearest star-system
ancestor and collapses single-child chains into breadcrumb lines, so each system
(Corwin, Eris, Thides, Meridian, …) is its own section with its bodies flowing in
columns. Reads the vault for the tree; only renders published pages (a docs page
must exist). Filed upstream as a gm-apprentice enhancement; remove when native.

Runs LAST in the postbuild chain so images are already WebP-optimized on disk.
"""
import re, os, glob, json, urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CFG = json.load(open(os.path.join(ROOT, "vault.config.json"), encoding="utf-8"))
VAULT = os.path.join(CFG["vaultPath"], "Locations")
DOCS = os.path.join(ROOT, "docs", "locations")
IMGDIR = os.path.join(ROOT, "docs", "images", "locations")

slugify = lambda t: re.sub(r"[^a-z0-9]+", "-", t.lower()).strip("-")
esc = lambda s: s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

def frontmatter(path):
    m = re.match(r"^---\n(.*?)\n---", open(path, encoding="utf-8").read(), re.S)
    d = {}
    if m:
        for line in m.group(1).splitlines():
            mm = re.match(r"^([A-Za-z_]+):\s*(.*)$", line)
            if mm:
                d[mm.group(1)] = mm.group(2).strip().strip('"').strip("'")
    return d

def resolve_img(name):
    for ext in ("webp", "jpg", "jpeg", "png"):
        if os.path.exists(os.path.join(IMGDIR, f"{name}.{ext}")):
            return "../images/locations/" + urllib.parse.quote(f"{name}.{ext}")
    return None

# ---- Build the tree from vault frontmatter, published nodes only ------------
nodes = {}
for p in glob.glob(os.path.join(VAULT, "*.md")):
    name = os.path.splitext(os.path.basename(p))[0]
    d = frontmatter(p)
    parent = re.sub(r"\[\[|\]\]", "", d.get("parent_location", "")).split("|")[0].strip()
    slug = slugify(name)
    nodes[name] = {"name": name, "slug": slug, "type": d.get("location_type", ""),
                   "parent": parent, "published": os.path.exists(f"{DOCS}/{slug}.html"),
                   "img": resolve_img(name), "children": []}
for n in nodes.values():
    par = nodes.get(n["parent"])
    if par:
        par["children"].append(n)

def pub_children(n):
    return sorted([c for c in n["children"] if c["published"]], key=lambda x: x["name"])

def count_desc(n):
    return sum(1 + count_desc(c) for c in pub_children(n))

is_system = lambda n: "system" in (n.get("type") or "").lower()

def system_of(n):
    cur = n
    while cur:
        if is_system(cur):
            return cur
        cur = nodes.get(cur["parent"])
    return None

systems = sorted([n for n in nodes.values() if n["published"] and is_system(n)],
                 key=lambda s: -count_desc(s))
groups = [{"node": s} for s in systems]
deep_space = sorted([n for n in nodes.values() if n["published"] and not is_system(n)
                     and system_of(n) is None and not pub_children(n)], key=lambda x: x["name"])
top_crumb = sorted([n for n in nodes.values() if n["published"] and not is_system(n)
                    and pub_children(n) and system_of(n) is None], key=lambda x: -count_desc(x))

# ---- Render ----------------------------------------------------------------
badge = lambda t: f' <span class="loc-type-badge">{esc(t)}</span>' if t else ""
thumb = lambda n: (f'<img class="loc-thumb" src="{n["img"]}" alt="" loading="lazy">'
                   if n.get("img") else '<span class="loc-thumb loc-thumb-none"></span>')
link = lambda n: f'<a href="{esc(n["slug"])}.html">{esc(n["name"])}</a>'
SEP = ' <span class="crumb-sep">&rsaquo;</span> '

def render_items(children):
    # Every body is a first-class row with its own thumbnail; children nest
    # beneath it (single-child chains included). Only the top scaffolding
    # (Federal Republic › Sector) is collapsed, and that's the caption above.
    out = []
    for c in children:
        kids = pub_children(c)
        if kids:
            out.append(f'<li class="loc-branch">{thumb(c)}{link(c)}{badge(c["type"])}'
                       f'<ul class="loc-sub">{render_items(kids)}</ul></li>')
        else:
            out.append(f'<li class="loc-leaf">{thumb(c)}{link(c)}{badge(c["type"])}</li>')
    return "".join(out)

def group_head(n):
    sys_thumb = (f'<img class="loc-sys-thumb" src="{n["img"]}" alt="" loading="lazy">'
                 if n.get("img") else '')
    return sys_thumb + link(n) + badge(n["type"])

def render():
    parts = []
    if top_crumb:
        parts.append(f'<div class="loc-context">{SEP.join(link(n) for n in top_crumb)}</div>')
    parts.append('<div class="loc-sections">')
    for g in groups:
        parts.append(f'<section class="loc-section"><h2 class="loc-region-title">{group_head(g["node"])}</h2>')
        parts.append(f'<ul class="loc-colflow">{render_items(pub_children(g["node"]))}</ul></section>')
    if deep_space:
        parts.append('<section class="loc-section"><h2 class="loc-region-title">Deep Space &amp; Routes</h2>')
        parts.append(f'<ul class="loc-colflow">{render_items(deep_space)}</ul></section>')
    parts.append('</div>')
    return "".join(parts)

# ---- Splice into index.html ------------------------------------------------
INDEX = os.path.join(DOCS, "index.html")
template = open(INDEX, encoding="utf-8").read()
start = template.find('<div class="locations-page">')
if start == -1:
    print("locations-index: <div class=\"locations-page\"> not found — skipping")
    raise SystemExit(0)
depth, end = 0, -1
for m in re.finditer(r'</?div\b[^>]*>', template[start:]):
    depth += -1 if m.group(0).startswith("</") else 1
    if depth == 0:
        end = start + m.end()
        break
open(INDEX, "w", encoding="utf-8").write(
    template[:start] + f'<div class="locations-page">{render()}</div>' + template[end:])
pub = sum(1 for n in nodes.values() if n["published"])
print(f"locations-index: regrouped {pub} locations into {len(groups)} systems + "
      f"{len(deep_space)} deep-space ({sum(1 for n in nodes.values() if n['published'] and n['img'])} thumbnails)")
