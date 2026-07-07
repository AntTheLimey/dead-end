#!/usr/bin/env node
// Post-build fix for the Locations index page.
//
// The pinned gm-apprentice-publish (tool 1.6.0) renders the Locations listing
// with a flat, two-level grouper (renderLocationsPage) that only shows a card
// when a location's parent is unpublished, plus that card's *direct* children.
// This vault's location tree is 6 levels deep, so ~57 of 67 locations silently
// vanish from the index (their individual pages still build and are reachable).
// Tracked upstream as tool issue #7 in the vault's _meta/gm-apprentice-tool-issues.md.
//
// This rebuilds docs/locations/index.html's listing as a complete, recursive
// nested tree of every published location, using the tool's own existing
// .location-tree / .location-tree-item / .location-tree-children CSS classes so
// it looks native. It reads only docs/ (self-contained like optimize-images):
// each location page carries a breadcrumb naming its direct parent, and its
// <h1> + first .metadata-badge give the title and location_type.
//
// Remove this script (and its postbuild entry) once the tool renders deep
// location hierarchies itself.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const LOC_DIR = new URL("../docs/locations", import.meta.url).pathname;
const INDEX = join(LOC_DIR, "index.html");
const MARKER = "<!-- locations index rebuilt by fix-locations-index.mjs -->";

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function firstMatch(re, s) {
  const m = s.match(re);
  return m ? m[1] : "";
}

// ── Parse every location page into a node ──────────────────────────────────
const files = readdirSync(LOC_DIR).filter((f) => f.endsWith(".html") && f !== "index.html");
const nodes = new Map();

for (const file of files) {
  const slug = file.replace(/\.html$/, "");
  const html = readFileSync(join(LOC_DIR, file), "utf8");
  const title = firstMatch(/<h1[^>]*>([^<]*)<\/h1>/, html) || slug;
  const type = firstMatch(/<span class="metadata-badge">([^<]*)<\/span>/, html);

  // Parent = the one breadcrumb <a> that isn't Home (../index.html) or the
  // Locations index (index.html). Unpublished/secret parents are omitted by the
  // tool, so those pages simply have no parent link → they become roots.
  const crumb = firstMatch(/<nav class="breadcrumbs"[^>]*>([\s\S]*?)<\/nav>/, html);
  let parentSlug = null;
  for (const m of crumb.matchAll(/<a href="([^"]+)"/g)) {
    const href = m[1];
    if (href.includes("/") || href === "index.html") continue; // Home / Locations
    parentSlug = href.replace(/\.html$/, "");
  }
  nodes.set(slug, { slug, title, type, parentSlug, children: [] });
}

// ── Build the tree ─────────────────────────────────────────────────────────
const roots = [];
for (const node of nodes.values()) {
  const parent = node.parentSlug && nodes.get(node.parentSlug);
  if (parent) parent.children.push(node);
  else roots.push(node);
}
const byTitle = (a, b) => a.title.localeCompare(b.title);
const sortRec = (list) => {
  list.sort(byTitle);
  for (const n of list) sortRec(n.children);
};
sortRec(roots);

// ── Render, mirroring the tool's own renderLocationTreeHTML markup ──────────
function render(list, depth) {
  return list
    .map((n) => {
      const badge = n.type ? ` <span class="sidebar-badge">${esc(n.type)}</span>` : "";
      const item = `<div class="location-tree-item" style="padding-left:${depth * 1.5}rem">
  <a href="${esc(n.slug)}.html">${esc(n.title)}</a>${badge}
</div>`;
      const kids = n.children.length
        ? `<div class="location-tree-children">${render(n.children, depth + 1)}</div>`
        : "";
      return item + kids;
    })
    .join("\n");
}

const total = nodes.size;
const tree = `<div class="locations-page">${MARKER}
<div class="location-tree">
${render(roots, 0)}
</div>
</div>`;

// ── Splice into index.html, replacing the flat .locations-page block ────────
let index = readFileSync(INDEX, "utf8");
if (index.includes(MARKER)) {
  console.log("fix-locations-index: already rebuilt — skipping");
  process.exit(0);
}
const start = index.indexOf('<div class="locations-page">');
if (start === -1) {
  console.warn("fix-locations-index: <div class=\"locations-page\"> not found — skipping");
  process.exit(0);
}
// Walk the DOM depth for balanced <div> matching from `start`.
let i = start, depth = 0, end = -1;
const tagRe = /<\/?div\b[^>]*>/g;
tagRe.lastIndex = start;
let m;
while ((m = tagRe.exec(index))) {
  depth += m[0].startsWith("</") ? -1 : 1;
  if (depth === 0) { end = m.index + m[0].length; break; }
}
if (end === -1) {
  console.warn("fix-locations-index: could not match closing </div> — skipping");
  process.exit(0);
}
index = index.slice(0, start) + tree + index.slice(end);
writeFileSync(INDEX, index);
console.log(`fix-locations-index: rebuilt Locations index as a full tree (${total} locations)`);
