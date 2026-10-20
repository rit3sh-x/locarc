// One fake Receiver speaking the phone's protocol: redeem a pairing code, mint ES256 tokens,
// subscribe to its control doc over the WebSocket client and call sync over the HTTP API.
// Runs under Node (the journeys) and Bun (`bun run sim`), so no runtime-specific APIs.
import { ConvexClient, ConvexHttpClient } from "convex/browser";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export type Control = FunctionReturnType<typeof api.control.mine>;
export type SyncArgs = FunctionArgs<typeof api.sync.sync>;
export type SyncResult = FunctionReturnType<typeof api.sync.sync>;

export class SimReceiver {
  id: Id<"receivers"> | null = null;
  name = "";
  secret: string | null = null;
  control: Control = null;
  stopped: string | null = null;
  private token: { token: string; expiresAt: number } | null = null;
  private readonly http: ConvexHttpClient;
  private ws: ConvexClient | null = null;
  private listeners = new Set<(c: Control) => void>();

  constructor(
    readonly url: string,
    readonly appVersion = "1.0.0",
  ) {
    this.http = new ConvexHttpClient(url);
  }

  async pair(code: string) {
    const r = await this.http.action(api.receiverAuth.pair, { code });
    this.id = r.receiverId;
    this.name = r.name;
    this.secret = r.secret;
    this.token = { token: r.token, expiresAt: r.expiresAt };
    this.subscribe();
    return r;
  }

  /** Resume with a saved secret (a real phone keeps it across restarts). */
  async resume(id: Id<"receivers">, secret: string) {
    this.id = id;
    this.secret = secret;
    await this.freshToken(true);
    this.subscribe();
  }

  private subscribe() {
    this.ws?.close();
    this.ws = new ConvexClient(this.url);
    this.ws.setAuth(({ forceRefreshToken }) =>
      this.freshToken(forceRefreshToken).catch(() => null),
    );
    this.ws.onUpdate(
      api.control.mine,
      {},
      (c) => {
        this.control = c;
        for (const l of this.listeners) l(c);
      },
      (e) => this.stop(`control subscription failed: ${e.message}`),
    );
  }

  onControl(listener: (c: Control) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** A removed or re-paired Receiver's mint fails; like the app, stop and forget the secret. */
  async freshToken(force = false): Promise<string> {
    if (!this.secret) throw new Error("not paired");
    if (force || !this.token || this.token.expiresAt - Date.now() < 10 * 60_000) {
      try {
        this.token = await this.http.action(api.receiverAuth.token, { secret: this.secret });
      } catch (e) {
        this.stop(`token refused: ${(e as Error).message}`);
        throw e;
      }
    }
    return this.token.token;
  }

  async sync(args: SyncArgs): Promise<SyncResult> {
    this.http.setAuth(await this.freshToken());
    return await this.http.mutation(api.sync.sync, args);
  }

  stop(reason: string) {
    if (this.stopped) return;
    this.stopped = reason;
    this.secret = null;
    void this.ws?.close();
    this.ws = null;
  }

  close() {
    void this.ws?.close();
    this.ws = null;
  }
}
