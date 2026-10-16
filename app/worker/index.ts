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
        console.error('job failed', e);
        msg.retry();
      }
    }
  },
} satisfies ExportedHandler<Env>;
