// Worker entry point. Cloudflare calls one of three handlers:
//   fetch      browser requests: /api/* goes to api.ts, everything else is the static web app
//   queue      scan work (see scan.ts); wrangler sets max_batch_size 1, so each invocation
//              handles one message and gets the full Workers Free per-invocation limits
//   scheduled  a cron that restarts scans whose queue messages were lost
import { handleApi } from './api.ts';
import type { Env, Job } from './env.ts';
import { handleJob, sweepStalledScans } from './scan.ts';

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(req.url);
    if (pathname === '/api' || pathname.startsWith('/api/')) return handleApi(req, env);
    return env.ASSETS.fetch(req);
  },

  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    await sweepStalledScans(env);
  },

  async queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
    for (const msg of batch.messages) {
      try {
        await handleJob(env, msg.body as Job);
        msg.ack();
      } catch (e) {
        // Unexpected errors retry the message; the queue drops it after its retry limit,
        // and sweepStalledScans picks up the pieces.
        console.error('job failed', e);
        msg.retry();
      }
    }
  },
} satisfies ExportedHandler<Env>;
