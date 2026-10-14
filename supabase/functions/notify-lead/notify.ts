// The e-mail about a new lead, apart from Deno (shared by the edge function and the unit tests). The lead is claimed
// first, in one conditional update (notified_at set only where it is still empty): of two calls arriving together,
// only one gets the lead back and sends; the other finds nothing to do. A failed send gives the claim back, so a later
// call can retry.
import { leadEmail, type LeadForEmail } from './email.ts';

export type ClaimedLead = LeadForEmail & { org_id: string; assigned_to: string | null };

export interface NotifyDeps {
  /** Sets notified_at = stamp on the lead if it is recent (created after `since`) and not notified yet; the lead, or null. */
  claim(leadId: string, since: string, stamp: string): Promise<ClaimedLead | null>;
  /** Gives the claim back (only if notified_at is still this call's stamp). */
  release(leadId: string, stamp: string): Promise<void>;
  /** The broker in charge; without one, the client's owners and admins. */
  recipients(lead: ClaimedLead): Promise<string[]>;
  orgName(orgId: string): Promise<string>;
  send(mail: { to: string[]; subject: string; text: string; html: string; replyTo?: string | null }): Promise<{ sent: true } | { sent: false; reason: string }>;
  siteUrl: string;
}

export interface NotifyResult {
  status: number;
  body: { sent: boolean; reason?: string; to?: number };
}

/** Notifies the lead once; only leads of the last 10 minutes (the site calls right after recording one). */
export async function notifyLead(deps: NotifyDeps, leadId: string, now = Date.now()): Promise<NotifyResult> {
  const stamp = new Date(now).toISOString();
  const lead = await deps.claim(leadId, new Date(now - 10 * 60_000).toISOString(), stamp);
  if (!lead) return { status: 200, body: { sent: false, reason: 'nada a avisar' } };
  const to = await deps.recipients(lead);
  if (!to.length) {
    await deps.release(leadId, stamp);
    return { status: 200, body: { sent: false, reason: 'sem destinatário' } };
  }
  const mail = leadEmail(lead, await deps.orgName(lead.org_id), deps.siteUrl);
  const result = await deps.send({ to, ...mail, replyTo: lead.email });
  if (!result.sent) {
    await deps.release(leadId, stamp);
    return { status: result.reason.startsWith('envio') ? 502 : 200, body: { sent: false, reason: result.reason, to: to.length } };
  }
  return { status: 200, body: { sent: true, to: to.length } };
}
