/** Tiny client for the Guild Hall's runner-only HTTP endpoints. */
export class Hall {
  token = "";
  constructor(readonly base: string) {}

  async post<T = unknown>(p: string, body: unknown = {}): Promise<T> {
    const r = await fetch(this.base + p, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.token}` },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`Guild Hall ${p} → ${r.status} ${await r.text()}`);
    return (await r.json()) as T;
  }

  async get<T = unknown>(p: string): Promise<T> {
    const r = await fetch(this.base + p, { headers: { authorization: `Bearer ${this.token}` } });
    if (!r.ok) throw new Error(`Guild Hall ${p} → ${r.status} ${await r.text()}`);
    return (await r.json()) as T;
  }
}
