import type { Page } from './types';

/**
 * Result of a `list()` call.
 * `await` it for the first page, or iterate with `for await` to walk every item across pages.
 */
export class PagePromise<T> implements PromiseLike<Page<T>>, AsyncIterable<T> {
  private first: Promise<Page<T>> | undefined;

  /** @internal */
  constructor(
    private readonly fetchPage: (cursor: string | undefined) => Promise<Page<T>>,
    private readonly cursor: string | undefined,
  ) {}

  private firstPage(): Promise<Page<T>> {
    this.first ??= this.fetchPage(this.cursor);
    return this.first;
  }

  // biome-ignore lint/suspicious/noThenProperty: PagePromise is intentionally awaitable
  then<A = Page<T>, B = never>(
    onfulfilled?: ((value: Page<T>) => A | PromiseLike<A>) | null,
    // biome-ignore lint/suspicious/noExplicitAny: same signature as Promise
    onrejected?: ((reason: any) => B | PromiseLike<B>) | null,
  ): Promise<A | B> {
    return this.firstPage().then(onfulfilled, onrejected);
  }

  // biome-ignore lint/suspicious/noExplicitAny: same signature as Promise
  catch<B = never>(onrejected?: ((reason: any) => B | PromiseLike<B>) | null): Promise<Page<T> | B> {
    return this.firstPage().catch(onrejected);
  }

  finally(onfinally?: (() => void) | null): Promise<Page<T>> {
    return this.firstPage().finally(onfinally);
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    let page = await this.firstPage();
    for (;;) {
      yield* page.items;
      if (!page.next_cursor) return;
      page = await this.fetchPage(page.next_cursor);
    }
  }
}
