// Stand-in for the `cloudflare:workers` runtime module, which only exists inside
// workerd. @cloudflare/workers-oauth-provider imports WorkerEntrypoint from it.
export class WorkerEntrypoint {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }
}
