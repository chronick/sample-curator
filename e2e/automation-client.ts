/**
 * Automation control channel client for e2e tests.
 * Connects to the WebSocket server at ws://127.0.0.1:9514.
 */

import WebSocket from "ws";

const WS_URL = "ws://127.0.0.1:9514";
const DEFAULT_TIMEOUT = 15_000;

interface AutomationResponse {
  id: string;
  ok: boolean;
  result?: any;
  error?: { code: string; message: string };
  method?: string;  // for push messages
  params?: any;     // for push messages
}

export class AutomationClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, {
    resolve: (resp: AutomationResponse) => void;
    reject: (err: Error) => void;
  }>();
  private pushMessages: AutomationResponse[] = [];
  private reqCounter = 0;

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(WS_URL);
      this.ws.on("open", () => resolve());
      this.ws.on("error", (err) => reject(err));
      this.ws.on("message", (data) => {
        const msg: AutomationResponse = JSON.parse(data.toString());
        // Check if it's a response to a pending request
        const pending = this.pending.get(msg.id);
        if (pending) {
          this.pending.delete(msg.id);
          pending.resolve(msg);
        } else {
          // Push message (console stream, etc.)
          this.pushMessages.push(msg);
        }
      });
    });
  }

  async close(): Promise<void> {
    this.ws?.close();
    this.ws = null;
  }

  drainPushMessages(): AutomationResponse[] {
    const msgs = [...this.pushMessages];
    this.pushMessages = [];
    return msgs;
  }

  private nextId(): string {
    return `req-${++this.reqCounter}`;
  }

  async send(
    method: string,
    params: Record<string, any> = {},
    timeout = DEFAULT_TIMEOUT
  ): Promise<AutomationResponse> {
    if (!this.ws) throw new Error("Not connected");
    const id = this.nextId();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timeout waiting for response to ${method} (${id})`));
      }, timeout);

      this.pending.set(id, {
        resolve: (resp) => {
          clearTimeout(timer);
          resolve(resp);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });

      this.ws!.send(JSON.stringify({ id, method, params }));
    });
  }

  // --- Convenience methods ---

  async ping() {
    return this.send("ping");
  }

  async evalJs(script: string, timeoutSecs = 10) {
    return this.send("eval_js", { script, timeout_secs: timeoutSecs });
  }

  async screenshot(appName?: string) {
    return this.send("screenshot", appName ? { app_name: appName } : {}, 30_000);
  }

  async invoke(command: string, args: Record<string, any> = {}) {
    return this.send("invoke", { command, args }, 30_000);
  }

  async queryState() {
    return this.send("query_state");
  }

  async domQuery(selector: string) {
    return this.send("dom_query", { selector });
  }

  async domQueryAll(selector: string) {
    return this.send("dom_query_all", { selector });
  }

  async domClick(selector: string) {
    return this.send("dom_click", { selector });
  }

  async domType(selector: string, text: string, clear = false) {
    return this.send("dom_type", { selector, text, clear });
  }

  async getConsole(since?: number, clear = false) {
    return this.send("get_console", { since, clear });
  }

  async subscribeConsole() {
    return this.send("subscribe_console");
  }

  async unsubscribeConsole() {
    return this.send("unsubscribe_console");
  }

  /** Wait for the UI to settle after an action */
  async waitForIdle(ms = 300) {
    await new Promise((r) => setTimeout(r, ms));
  }

  /** Wait until state predicate is true, polling at interval */
  async waitForState(
    predicate: (state: any) => boolean,
    { timeout = 5000, interval = 200 } = {}
  ): Promise<any> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const resp = await this.queryState();
      if (resp.ok && predicate(resp.result.state)) {
        return resp.result.state;
      }
      await new Promise((r) => setTimeout(r, interval));
    }
    throw new Error("waitForState timed out");
  }
}
