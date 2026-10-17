#!/usr/bin/env node
// ビルドした成果物を npm pack し、別のディレクトリに入れて、素の Node（ESM・CJS）・型（node16 の ESM・CJS）・
// Deno（あれば）・Cloudflare Workers（Miniflare）から使えることを確かめる。pnpm test の最後に流す。
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
const work = mkdtempSync(join(tmpdir(), 'wha-sdk-pack-'));
const require = createRequire(join(pkgDir, 'package.json'));

function step(name) {
  console.log(`[pack-check] ${name}`);
}
function fail(msg) {
  console.error(`[pack-check] NG: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  if (r.status !== 0) fail(`${cmd} ${args.join(' ')}\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
}

// 受け取った本文と見出しで検証し、送信は偽の fetch で 1 回流す。どの実行環境でも同じもの
const SMOKE = `
  const secret = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw';
  const body = JSON.stringify({ type: 'invoice.paid', timestamp: new Date().toISOString(), data: { n: 1 } });
  const wh = new Webhook(secret);
  const ts = Math.floor(Date.now() / 1000);
  const headers = { 'webhook-id': 'msg_1', 'webhook-timestamp': String(ts), 'webhook-signature': await wh.sign('msg_1', ts, body) };
  const event = await wh.verify(body, headers);
  if (event.data.n !== 1) throw new Error('verify returned ' + JSON.stringify(event));
  let bad = null;
  try { await wh.verify(body + ' ', headers); } catch (e) { bad = e; }
  if (!(bad instanceof WebhookVerificationError) || !(bad instanceof WebhookAdminError)) throw new Error('verify accepted a changed body');
  const seen = [];
  const client = new WebhookAdmin('sk_test_x', {
    baseUrl: 'https://api.test',
    fetch: async (url, init) => {
      seen.push({ url, init });
      return new Response(JSON.stringify({ id: 'msg_9', deliveries: 1 }), { status: 202, headers: { 'content-type': 'application/json' } });
    },
  });
  const r = await client.messages.send({ consumer: 'c', event_type: 'e', payload: {} });
  if (r.id !== 'msg_9') throw new Error('send returned ' + JSON.stringify(r));
  const h = seen[0].init.headers;
  if (h['user-agent'] !== 'webhookadmin-node/' + VERSION) throw new Error('user-agent ' + h['user-agent']);
  if (!h['idempotency-key']) throw new Error('no idempotency-key');
  const nf = new WebhookAdmin('sk_test_x', { fetch: async () => new Response('{"error":"not_found","message":"x"}', { status: 404 }) });
  let e404 = null;
  try { await nf.messages.get('m'); } catch (e) { e404 = e; }
  if (!(e404 instanceof NotFoundError)) throw new Error('404 was ' + e404);
`;

try {
  step('npm pack');
  const out = execFileSync('npm', ['pack', '--json', '--pack-destination', work], { cwd: pkgDir, encoding: 'utf8' });
  const [info] = JSON.parse(out);
  const files = info.files.map((f) => f.path).sort();
  const expected = [
    'CHANGELOG.md',
    'LICENSE',
    'README.md',
    'dist/index.cjs',
    'dist/index.d.cts',
    'dist/index.d.ts',
    'dist/index.js',
    'package.json',
  ];
  if (JSON.stringify(files) !== JSON.stringify(expected)) fail(`files in the tarball: ${files.join(', ')}`);
  const tgz = join(work, info.filename);

  step('the tarball has no dependencies and no workspace references');
  const packed = JSON.parse(execFileSync('tar', ['-xzOf', tgz, 'package/package.json'], { encoding: 'utf8' }));
  for (const k of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    if (packed[k] && Object.keys(packed[k]).length) fail(`${k} in package.json: ${JSON.stringify(packed[k])}`);
  }
  for (const f of ['dist/index.js', 'dist/index.cjs', 'dist/index.d.ts', 'dist/index.d.cts']) {
    const src = execFileSync('tar', ['-xzOf', tgz, `package/${f}`], { encoding: 'utf8' });
    if (/@wha\/|workspace:/.test(src)) fail(`${f} refers to a workspace package`);
    if (/from ["']node:|require\(["']node:/.test(src)) fail(`${f} imports a Node built-in statically`);
  }

  step('install into an empty project');
  const app = join(work, 'app');
  mkdirSync(app);
  writeFileSync(join(app, 'package.json'), JSON.stringify({ name: 'app', private: true, version: '0.0.0' }));
  run('npm', ['install', tgz, '--offline', '--no-audit', '--no-fund', '--ignore-scripts', '--no-package-lock'], { cwd: app });

  step('Node ESM (import)');
  writeFileSync(
    join(app, 'esm.mjs'),
    `import { Webhook, WebhookAdmin, WebhookAdminError, WebhookVerificationError, NotFoundError, VERSION } from 'webhookadmin';\n${SMOKE}\nconsole.log('esm ok ' + VERSION);\n`,
  );
  if (!run(process.execPath, ['esm.mjs'], { cwd: app }).includes(`esm ok ${pkg.version}`)) fail('esm');

  step('Node CJS (require)');
  writeFileSync(
    join(app, 'cjs.cjs'),
    `const { Webhook, WebhookAdmin, WebhookAdminError, WebhookVerificationError, NotFoundError, VERSION } = require('webhookadmin');\n(async () => {${SMOKE}\nconsole.log('cjs ok ' + VERSION);\n})().catch((e) => { console.error(e); process.exit(1); });\n`,
  );
  if (!run(process.execPath, ['cjs.cjs'], { cwd: app }).includes(`cjs ok ${pkg.version}`)) fail('cjs');

  // 追加の実行環境（例: PACK_CHECK_RUNTIMES=/path/to/node18,/path/to/bun）でも ESM・CJS を流す
  for (const bin of (process.env.PACK_CHECK_RUNTIMES ?? '').split(',').filter(Boolean)) {
    const v = run(bin, ['--version']).trim();
    step(`${bin} ${v}: ESM and CJS`);
    if (!run(bin, ['esm.mjs'], { cwd: app }).includes('esm ok')) fail(`esm on ${v}`);
    if (!run(bin, ['cjs.cjs'], { cwd: app }).includes('cjs ok')) fail(`cjs on ${v}`);
  }

  step('types under module node16 (ESM and CJS)');
  const typesNode = dirname(require.resolve('@types/node/package.json'));
  const TYPES = `
    const wh: WebhookAdmin = new WebhookAdmin('sk_test_x', { maxRetries: 1, timeout: 1000 });
    async function f(): Promise<void> {
      const m: SendMessageResponse = await wh.messages.send({ consumer: 'c', event_type: 'e', payload: 1 }, { idempotencyKey: 'k' });
      const page: Page<MessageSummary> = await wh.messages.list({ status: 'failed' });
      for await (const x of wh.consumers.list()) x.external_id.toUpperCase();
      const ep: EndpointWithSecret = await wh.endpoints.create({ consumer_id: 'c', url: 'https://x' });
      const link: PortalLink = await wh.portal.createLink('con_1', { locale: 'en' });
      const ev: WebhookEvent<{ n: number }> = await new Webhook('whsec_x').verify<WebhookEvent<{ n: number }>>(Buffer.from(''), {});
      void [m.id, page.next_cursor, ep.secret, link.url, ev.data.n];
      try { await wh.deliveries.retry('d'); } catch (e) { if (e instanceof RateLimitError) void e.retryAfter; }
    }
    void f;
  `;
  const imports =
    'WebhookAdmin, Webhook, RateLimitError, type SendMessageResponse, type Page, type MessageSummary, type EndpointWithSecret, type PortalLink, type WebhookEvent';
  writeFileSync(join(app, 'types.mts'), `import { ${imports} } from 'webhookadmin';\n${TYPES}`);
  writeFileSync(join(app, 'types.cts'), `import { ${imports} } from 'webhookadmin';\n${TYPES}`);
  writeFileSync(
    join(app, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        module: 'node16',
        moduleResolution: 'node16',
        target: 'ES2022',
        lib: ['ES2022'],
        strict: true,
        noEmit: true,
        typeRoots: [dirname(typesNode)],
        types: ['node'],
      },
      files: ['types.mts', 'types.cts'],
    }),
  );
  run(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', 'tsconfig.json'], { cwd: app });

  const deno = spawnSync('deno', ['--version'], { encoding: 'utf8' });
  if (deno.status === 0) {
    step('Deno (no permissions besides reading the package)');
    writeFileSync(
      join(app, 'deno.mjs'),
      `import { Webhook, WebhookAdmin, WebhookAdminError, WebhookVerificationError, NotFoundError, VERSION } from './node_modules/webhookadmin/dist/index.js';\n${SMOKE}\nlet missing = null; try { new WebhookAdmin(); } catch (e) { missing = e; }\nif (!(missing instanceof WebhookAdminError)) throw new Error('missing key did not throw');\nconsole.log('deno ok ' + VERSION);\n`,
    );
    if (!run('deno', ['run', '--no-prompt', '--allow-read=.', 'deno.mjs'], { cwd: app }).includes('deno ok')) fail('deno');
  } else {
    step('Deno is not installed; skipped');
  }

  step('Cloudflare Workers (Miniflare / workerd)');
  const { Miniflare, convertV4MiniflareOptions } = await import(require.resolve('miniflare'));
  const worker = `
    import { Webhook, WebhookAdmin, WebhookAdminError, WebhookVerificationError, NotFoundError, VERSION } from './sdk.js';
    export default {
      async fetch(req, env) {
        ${SMOKE}
        // 既定の fetch（globalThis.fetch を this なしで呼ぶ）でも動く。外への通信は outboundService が受ける
        const real = new WebhookAdmin(env.WEBHOOK_ADMIN_API_KEY, { baseUrl: 'https://api.webhookadmin.test' });
        const list = await real.consumers.list();
        return Response.json({ ok: true, version: VERSION, items: list.items.length });
      },
    };
  `;
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          name: 'sdk',
          compatibilityDate: '2025-09-01',
          modulesRoot: app,
          bindings: { WEBHOOK_ADMIN_API_KEY: 'sk_test_x' },
          modules: [
            { type: 'ESModule', path: join(app, 'worker.js'), contents: worker },
            {
              type: 'ESModule',
              path: join(app, 'sdk.js'),
              contents: readFileSync(join(app, 'node_modules/webhookadmin/dist/index.js'), 'utf8'),
            },
          ],
          outboundService: (req) => {
            const auth = req.headers.get('authorization');
            if (auth !== 'Bearer sk_test_x') return new Response('{"error":"unauthorized","message":"x"}', { status: 401 });
            return Response.json({ items: [{ id: 'con_1' }], next_cursor: null });
          },
        },
      ],
    }),
  );
  try {
    const res = await mf.dispatchFetch('http://localhost/');
    const text = await res.text();
    if (res.status !== 200 || JSON.parse(text).items !== 1) fail(`worker: ${res.status} ${text}`);
  } finally {
    await mf.dispose();
  }

  console.log('[pack-check] all ok');
} finally {
  rmSync(work, { recursive: true, force: true });
}
