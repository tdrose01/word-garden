import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const forbiddenFontHosts = /fonts\.(?:googleapis|gstatic)\.com/i;
const sourcePaths = ['src/main.js', 'src/style.css', 'index.html'];

for (const sourcePath of sourcePaths) {
  const source = await readFile(new URL(`../${sourcePath}`, import.meta.url), 'utf8');
  assert.doesNotMatch(source, forbiddenFontHosts, `${sourcePath} must not load Google Fonts at runtime`);
}

const assetsDirectory = new URL('../dist/assets/', import.meta.url);
const assetNames = await readdir(assetsDirectory);
const cssNames = assetNames.filter((name) => name.endsWith('.css'));
const fontNames = assetNames.filter((name) => name.endsWith('.woff2'));

assert.ok(cssNames.length > 0, 'production build must emit CSS');
assert.ok(fontNames.length >= 4, 'production build must emit the four self-hosted font weights');

for (const cssName of cssNames) {
  const css = await readFile(new URL(cssName, assetsDirectory), 'utf8');
  assert.doesNotMatch(css, forbiddenFontHosts, `${cssName} must not load Google Fonts at runtime`);
}

console.log(`font regression passed (${fontNames.length} self-hosted WOFF2 assets)`);
