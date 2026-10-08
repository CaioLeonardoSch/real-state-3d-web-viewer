#!/usr/bin/env node
// Merges listings exported from the app ("Anunciar imóvel" → "Exportar meus anúncios") into
// public/data/listings.json, so they are published for everyone.
//
// Usage: npm run listings:add -- meus-anuncios.json
//
// The export is validated first (same rules as listings.json). Ids already in use get a numeric suffix.
// A listing on a building that already has one is refused. If the merged file fails validation,
// listings.json is left untouched.
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

// agencies referenced by the export but missing from listings.json are added
const agencyIds = new Set(target.agencies.map((a) => a.id));
for (const a of incoming.agencies ?? []) {
  if (!agencyIds.has(a.id) && incoming.listings.some((l) => l.agency === a.id)) {
    target.agencies.push(a);
    agencyIds.add(a.id);
  }
}

const ids = new Set(target.listings.map((l) => l.id));
const buildings = new Map(target.listings.filter((l) => l.buildingOsmId).map((l) => [l.buildingOsmId, l.id]));
const added = [];
for (const raw of incoming.listings) {
  const l = { ...raw };
  delete l.userAdded;
  if (l.buildingOsmId && buildings.has(l.buildingOsmId)) {
    console.error(`Recusado: "${l.title}" usa o prédio ${l.buildingOsmId}, que já tem o anúncio ${buildings.get(l.buildingOsmId)}.`);
    process.exit(1);
  }
  let id = l.id;
  for (let n = 2; ids.has(id); n++) id = `${l.id}-${n}`;
  if (id !== l.id) console.log(`  id ${l.id} já existia: renomeado para ${id}`);
  l.id = id;
  ids.add(id);
  if (l.buildingOsmId) buildings.set(l.buildingOsmId, id);
  target.listings.push(l);
  added.push(l);
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
