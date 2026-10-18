#!/usr/bin/env node
// New-listing alerts (workflow "Alertas de imóveis", once a day): for each alert of the clients' sites (table
// search_alerts) sends the confirmation e-mail, and after it is confirmed, the listings of its search published
// since the last e-mail. Unconfirmed requests older than 30 days are deleted. Messages: src/site/alerts.ts.
//
//   npm run alerts:send            (needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY and SITE_URL, the
//                                   platform address where site.html is; ALERT_EMAIL_FROM is the sender)
//   options: --local      the local Supabase (npm run db:start)
//            --dry-run    only print what would be sent
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { summaryToListing } from '../src/backend/mapping.ts';
import { normalizeSiteConfig } from '../src/site/config.ts';
import { confirmMail, newForAlert, newListingsMail } from '../src/site/alerts.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const LOCAL = args.includes('--local');
const DRY = args.includes('--dry-run');
const STALE_MS = 30 * 24 * 3600 * 1000;

let url = process.env.SUPABASE_URL;
let key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (LOCAL) {
  const status = JSON.parse(execFileSync('npx', ['supabase', 'status', '-o', 'json'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  [url, key] = [status.API_URL, status.SERVICE_ROLE_KEY];
}
const siteUrl = process.env.SITE_URL ?? '';
const resendKey = process.env.RESEND_API_KEY ?? '';
if (!url || !key) fail('defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY (ou use --local)');
if (!siteUrl) fail('defina SITE_URL (o endereço da plataforma, onde fica o site.html)');
if (!resendKey && !DRY) fail('defina RESEND_API_KEY (ou use --dry-run)');

function fail(msg) {
  console.error(`Erro: ${msg}`);
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });
const photoUrl = (p) => db.storage.from('listing-photos').getPublicUrl(p).data.publicUrl;

async function send(to, mail) {
  if (DRY) {
    console.log(JSON.stringify({ to, subject: mail.subject }));
    return true;
  }
  const r = await fetch(process.env.RESEND_API_URL ?? 'https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.ALERT_EMAIL_FROM ?? process.env.LEAD_EMAIL_FROM ?? 'Alertas <onboarding@resend.dev>', to: [to], ...mail }),
  });
  if (!r.ok) console.warn(`  envio recusado (${r.status}) para um alerta`);
  return r.ok;
}

// the time before reading the listings: one published while this runs goes in the next e-mail
const now = new Date().toISOString();
const stale = new Date(Date.now() - STALE_MS).toISOString();
if (!DRY) {
  const { error } = await db.from('search_alerts').delete().is('confirmed_at', null).lt('created_at', stale);
  if (error) fail(error.message);
}
const { data: alerts, error } = await db.from('search_alerts').select('*').order('org_id').limit(50000);
if (error) fail(error.message);
const byOrg = Map.groupBy(alerts, (a) => a.org_id);
let confirms = 0;
let digests = 0;
for (const [orgId, list] of byOrg) {
  const { data: org, error: orgErr } = await db.from('organizations').select('id, name, slug, custom_domain, branding').eq('id', orgId).single();
  if (orgErr) fail(orgErr.message);
  const site = { id: org.id, name: org.name, slug: org.slug, customDomain: org.custom_domain };
  const config = normalizeSiteConfig(org.branding, org.name);
  let listings = null;
  let publishedAt = null;
  for (const a of list) {
    if (!a.confirmed_at) {
      if (a.confirm_sent_at) continue;
      if ((await send(a.email, confirmMail(site, a.label, a.token, siteUrl))) && !DRY) {
        await db.from('search_alerts').update({ confirm_sent_at: now }).eq('id', a.id);
        confirms++;
      }
      continue;
    }
    if (!listings) {
      const { data: rows, error: e } = await db.rpc('map_listings', { p_org: orgId });
      if (e) fail(e.message);
      listings = rows.map((r) => summaryToListing(r, photoUrl, false));
      publishedAt = new Map(rows.map((r) => [r.id, r.published_at]));
    }
    const found = newForAlert(listings, publishedAt, a.query, a.last_sent_at ?? a.confirmed_at, { id: orgId, search: config.search });
    if (!found.length) continue;
    if ((await send(a.email, newListingsMail(site, a.label, a.query, found, a.token, siteUrl))) && !DRY) {
      await db.from('search_alerts').update({ last_sent_at: now }).eq('id', a.id);
      digests++;
    }
  }
}
console.log(`${alerts.length} alertas; ${confirms} confirmações e ${digests} e-mails de imóveis novos enviados${DRY ? ' (simulação)' : ''}.`);
