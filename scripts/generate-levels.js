import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dictionaryStats, generateLevels } from '../src/generator.js';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = resolve(rootDir, 'data/generated-levels.json');
const levels = generateLevels();
const payload = {
  generatedAt: 'deterministic',
  dictionary: dictionaryStats(),
  levels
};

if (process.argv.includes('--stdout')) {
  process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
} else {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(payload, null, 2) + '\n');
  process.stdout.write(`Wrote ${levels.length} levels to data/generated-levels.json\n`);
}
