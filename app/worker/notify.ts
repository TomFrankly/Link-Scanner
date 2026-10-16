// Emails the admin when a full scan finishes or any scan fails. Uses the `send_email`
// binding, which on Workers Free can only deliver to verified destination addresses;
// that's fine here since the only recipient is the admin. Without the binding this is a no-op.
import type { Env } from './env.ts';

export async function notifyScanEnded(env: Env, scanId: number) {
  if (!env.EMAIL || !env.NOTIFY_FROM) return;
  try {
    const s = await env.DB.prepare(
      `SELECT s.kind, s.status, s.total, s.error, s.created_by, s.created_at, s.finished_at, w.name AS workspace
       FROM scans s JOIN workspaces w ON w.id = s.workspace_id WHERE s.id = ?`,
    )
      .bind(scanId)
      .first<{ kind: string; status: string; total: number; error: string | null; created_by: string; created_at: string; finished_at: string | null; workspace: string }>();
    if (!s || (s.kind !== 'full' && s.status !== 'failed')) return;

    const kind = s.kind === 'full' ? 'Full scan' : s.kind === 'all' ? 'Recheck' : 'Link recheck';
    const mins = s.finished_at ? Math.max(1, Math.round((Date.parse(s.finished_at) - Date.parse(s.created_at)) / 60_000)) : null;
    const subject =
      s.status === 'failed' ? `${kind} failed: ${s.workspace}` : `${kind} finished: ${s.workspace} (${s.total.toLocaleString('en-US')} links checked)`;
    const lines = [
      `${kind} for "${s.workspace}" ${s.status === 'failed' ? 'failed' : 'finished'}.`,
      '',
      `Started by: ${s.created_by}`,
      s.status === 'failed' ? `Reason: ${s.error ?? 'unknown'}` : `Links checked: ${s.total.toLocaleString('en-US')}`,
      ...(mins ? [`Took: about ${mins} min`] : []),
      '',
      env.APP_URL ? `Open the report: ${env.APP_URL}` : '',
    ];
    await env.EMAIL.send({
      to: env.ADMIN_EMAIL,
      from: { email: env.NOTIFY_FROM, name: 'Link Checker' },
      subject,
      text: lines.join('\n').trim(),
    });
  } catch (e) {
    // Never let a notification problem affect the scan itself.
    console.error('notify failed', (e as { code?: string }).code, (e as Error).message);
  }
}
