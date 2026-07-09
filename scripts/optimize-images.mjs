#!/usr/bin/env node
// Post-build image optimizer for the Dead End site.
//
// Converts the PNG/JPEG images the build copies into docs/images/ to WebP
// (capped at 1600px wide) and rewrites references in the generated HTML.
// Vault originals in _attachments/ are untouched — this only touches docs/.
// Requires cwebp (brew install webp); if absent, the site ships originals.

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync, statSync, unlinkSync } from "node:fs";
import { join, extname, relative } from "node:path";

const DOCS = new URL("../docs", import.meta.url).pathname;
const IMAGES = join(DOCS, "images");
const MAX_WIDTH = 1600;
const QUALITY = "82";

try {
  execFileSync("cwebp", ["-version"], { stdio: "ignore" });
} catch {
  console.warn("optimize-images: cwebp not found — skipping (shipping original images)");
  process.exit(0);
}

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]
  );

const converted = []; // [oldRelPath, newRelPath] relative to docs/images
let before = 0, after = 0;

for (const file of walk(IMAGES)) {
  const ext = extname(file).toLowerCase();
  if (![".png", ".jpg", ".jpeg"].includes(ext)) continue;
  const origSize = statSync(file).size;
  const width = parseInt(
    execFileSync("sips", ["-g", "pixelWidth", file]).toString().match(/pixelWidth: (\d+)/)?.[1] ?? "0"
  );
  const out = file.slice(0, -ext.length) + ".webp";
  const args = ["-quiet", "-q", QUALITY];
  if (width > MAX_WIDTH) args.push("-resize", String(MAX_WIDTH), "0");
  execFileSync("cwebp", [...args, file, "-o", out]);
  const newSize = statSync(out).size;
  if (newSize < origSize) {
    unlinkSync(file);
    converted.push([relative(IMAGES, file), relative(IMAGES, out)]);
    before += origSize;
    after += newSize;
  } else {
    unlinkSync(out); // conversion didn't help; keep the original
  }
}

if (converted.length) {
  // The build tool URL-encodes image src paths (spaces → %20, non-ASCII → %XX),
  // so match each converted path in both its raw and URL-encoded form. Without
  // the encoded pass, every filename containing a space (most portraits) keeps
  // its reference pointed at the now-deleted original and 404s on the site.
  const pairs = [];
  for (const [oldRel, newRel] of converted) {
    pairs.push([oldRel, newRel]);
    const encOld = encodeURI(oldRel);
    const encNew = encodeURI(newRel);
    if (encOld !== oldRel) pairs.push([encOld, encNew]);
  }
  for (const html of walk(DOCS).filter((f) => f.endsWith(".html"))) {
    let text = readFileSync(html, "utf8");
    let changed = false;
    for (const [oldRel, newRel] of pairs) {
      if (text.includes(oldRel)) {
        text = text.split(oldRel).join(newRel);
        changed = true;
      }
    }
    if (changed) writeFileSync(html, text);
  }
}

const mb = (n) => (n / 1024 / 1024).toFixed(1);
console.log(
  `optimize-images: ${converted.length} images → WebP, ${mb(before)}MB → ${mb(after)}MB`
);
