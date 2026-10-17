#!/usr/bin/env node
// Merges listings exported from the app ("Anunciar imóvel" → "Exportar meus anúncios") into
// public/data/listings.json, so they are published for everyone.
//
// Usage: npm run listings:add -- meus-anuncios.json
//
// The export is validated first (same rules as listings.json). Ids already in use get a numeric suffix.
// A listing on a building that already has one is refused. Only the part of the address the advertiser chose to show
// is published (never the CEP). If the merged file fails validation, listings.json is left untouched.
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeListings } from './lib/merge-listings.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = path.join(ROOT, 'public', 'data', 'listings.json');
const VALIDATE = path.join(ROOT, 'scripts', 'validate-listings.mjs');

const input = process.argv[2];
if (!input) {
  console.error('Uso: npm run listings:add -- <arquivo exportado.json>');
  process.exit(1);
}
const validate = (file) => execFileSync(process.execPath, [VALIDATE, ...(file ? [file] : [])], { stdio: 'inherit' });

console.log(`Validando ${input}…`);
try {
  validate(path.resolve(input));
} catch {
  console.error(`\n${input} não passou na validação; nada foi alterado.`);
  process.exit(1);
}

const original = await readFile(TARGET, 'utf8');
const target = JSON.parse(original);
const incoming = JSON.parse(await readFile(path.resolve(input), 'utf8'));

let added;
try {
  let renamed;
  ({ added, renamed } = mergeListings(target, incoming));
  for (const [from, to] of renamed) console.log(`  id ${from} já existia: renomeado para ${to}`);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

await writeFile(TARGET, JSON.stringify(target, null, 2) + '\n');
console.log(`\nValidando o listings.json com ${added.length} anúncio(s) novo(s)…`);
try {
  validate(null);
} catch {
  await writeFile(TARGET, original);
  console.error('\nO arquivo combinado não passou na validação; listings.json foi restaurado.');
  process.exit(1);
}
console.log(`\nAdicionados: ${added.map((l) => l.id).join(', ')}`);
