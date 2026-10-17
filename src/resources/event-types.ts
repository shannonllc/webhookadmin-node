import { ConflictError } from '../errors';
import type { Http } from '../http';
import type { EnsureEventTypesResult, EventType, EventTypeCreateParams, EventTypeList, RequestOptions } from '../types';

export class EventTypes {
  /** @internal */
  constructor(private readonly http: Http) {}

  /** Lists the event types of the key's environment, by name. Any API key of the environment can call it. */
  list(options?: RequestOptions): Promise<EventTypeList> {
    return this.http.request({ method: 'GET', path: '/v1/event-types', idempotent: true }, options);
  }

  /** Registers an event type. A duplicate `name` throws `ConflictError`. Requires `endpoints:write`. */
  create(params: EventTypeCreateParams, options?: RequestOptions): Promise<EventType> {
    return this.http.request({ method: 'POST', path: '/v1/event-types', body: params, idempotent: false }, options);
  }

  /**
   * Registers the event types that do not exist yet, and leaves existing ones unchanged (their description included).
   * Safe to call on every deploy. Requires `endpoints:write`.
   */
  async ensure(types: Array<string | EventTypeCreateParams>, options?: RequestOptions): Promise<EnsureEventTypesResult> {
    const wanted = new Map<string, EventTypeCreateParams>();
    for (const t of types) {
      const p = typeof t === 'string' ? { name: t } : t;
      if (!wanted.has(p.name)) wanted.set(p.name, p);
    }
    const known = new Map((await this.list(options)).items.map((t) => [t.name, t]));
    const created: EventType[] = [];
    const existing: EventType[] = [];
    const raced: string[] = [];
    for (const [name, p] of wanted) {
      const have = known.get(name);
      if (have) {
        existing.push(have);
        continue;
      }
      try {
        created.push(await this.create(p, options));
      } catch (e) {
        // 一覧を読んだ後に、ほかの呼び出しが同じ名前を登録した
        if (!(e instanceof ConflictError)) throw e;
        raced.push(name);
      }
    }
    if (raced.length > 0) existing.push(...(await this.list(options)).items.filter((t) => raced.includes(t.name)));
    return { created, existing };
  }
}
