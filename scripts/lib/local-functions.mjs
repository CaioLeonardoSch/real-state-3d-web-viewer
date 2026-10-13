// Serves the edge functions of the local Supabase with a fake e-mail provider (Resend API), so the lead
// notification can be tested end to end without sending anything. Used by test-backend and e2e-backend.
import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

/** Starts both; resolves to { mailLog, mails(), stop() }, or null when the functions cannot run here. */
export async function startLocalFunctions(apiUrl, siteUrl) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'functions-'));
  const mailLog = path.join(dir, 'mails.jsonl');
  writeFileSync(mailLog, '');
  const mock = http
    .createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        appendFileSync(mailLog, body.replace(/\n/g, ' ') + '\n');
        res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"id":"teste"}');
      });
    })
    .listen(0, '0.0.0.0');
  await new Promise((r) => mock.once('listening', r));
  const stopMock = () => mock.close();
  let gateway;
  try {
    // the functions run in a container: they reach this machine through the Docker network gateway
    gateway = execFileSync('docker', ['network', 'inspect', 'supabase_network_real-state-3d-web-viewer', '-f', '{{(index .IPAM.Config 0).Gateway}}'], {
      encoding: 'utf8',
    }).trim();
  } catch (err) {
    stopMock();
    console.warn(`Sem as funções (${err.message.split('\n')[0]}).`);
    return null;
  }
  const envFile = path.join(dir, 'functions.env');
  writeFileSync(
    envFile,
    [
      'RESEND_API_KEY=teste',
      `RESEND_API_URL=http://${gateway}:${mock.address().port}/emails`,
      `SITE_URL=${siteUrl}`,
      'LEAD_EMAIL_FROM=Contatos <contatos@teste.local>',
    ].join('\n'),
  );
  const proc = spawn('npx', ['supabase', 'functions', 'serve', '--env-file', envFile], { stdio: 'ignore', detached: true });
  const stop = () => {
    stopMock();
    try {
      process.kill(-proc.pid);
    } catch {}
  };
  for (let i = 0; i < 90; i++) {
    try {
      const r = await fetch(`${apiUrl}/functions/v1/notify-lead`, {
        method: 'POST',
        body: '{"lead_id":"00000000-0000-0000-0000-000000000000"}',
        headers: { 'Content-Type': 'application/json' },
      });
      if (r.ok) {
        const mails = () =>
          readFileSync(mailLog, 'utf8')
            .split('\n')
            .filter(Boolean)
            .map((l) => JSON.parse(l));
        return { mailLog, mails, stop };
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  stop();
  console.warn('As funções não subiram.');
  return null;
}
