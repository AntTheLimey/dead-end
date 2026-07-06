#!/usr/bin/env node
// Post-build CSS override applier for the Dead End site.
//
// The gm-apprentice-publish build regenerates docs/css/theme.css on every run
// and (as of the pinned tool version) never wires in the scaffolded
// css/overrides.css. theme.css is linked on every page *after* style.css, so
// appending our overrides to it lets them win the cascade — durably, without
// editing the plugin's shared stylesheet. Vault/source files are untouched;
// this only appends to the generated docs/css/theme.css.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const OVERRIDES = join(ROOT, "css/overrides.css");
const THEME = join(ROOT, "docs/css/theme.css");
const MARKER = "/* == overrides.css (applied by apply-overrides.mjs) == */";

if (!existsSync(OVERRIDES)) {
  console.warn("apply-overrides: css/overrides.css not found — skipping");
  process.exit(0);
}
if (!existsSync(THEME)) {
  console.warn("apply-overrides: docs/css/theme.css not found (run the build first) — skipping");
  process.exit(0);
}

const overrides = readFileSync(OVERRIDES, "utf8");
let theme = readFileSync(THEME, "utf8");

// theme.css is regenerated each build, so the marker won't normally be present;
// the guard just keeps re-runs on a stale docs/ from stacking duplicates.
if (theme.includes(MARKER)) {
  console.log("apply-overrides: overrides already present in theme.css — skipping");
  process.exit(0);
}

theme += `\n\n${MARKER}\n${overrides}\n`;
writeFileSync(THEME, theme);
console.log("apply-overrides: appended css/overrides.css → docs/css/theme.css");
