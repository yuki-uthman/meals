import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';

/**
 * Acceptance support: brings up the Supabase CLI local Docker stack, applies the
 * repository migrations, builds the static bundle against that stack and serves
 * dist/ as plain static files. Nothing here is production code; the oracle drives
 * the same bytes GitHub Pages would publish.
 */

export type LocalStack = {
  readonly supabaseUrl: string;
  readonly anonKey: string;
  readonly serviceRoleKey: string;
  readonly siteUrl: string;
  stop(): Promise<void>;
};

const repositoryRoot = resolve(__dirname, '..', '..');

const run = (command: string, args: readonly string[]): string =>
  execFileSync(command, [...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    env: process.env,
  });

const runWithEnv = (
  command: string,
  args: readonly string[],
  env: Readonly<Record<string, string>>,
): void => {
  execFileSync(command, [...args], {
    cwd: repositoryRoot,
    stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, ...env },
  });
};

type SupabaseStatus = {
  readonly API_URL: string;
  readonly ANON_KEY: string;
  readonly SERVICE_ROLE_KEY: string;
};

const readStatus = (): SupabaseStatus => {
  const parsed = JSON.parse(run('supabase', ['status', '-o', 'json'])) as Partial<SupabaseStatus>;
  const { API_URL, ANON_KEY, SERVICE_ROLE_KEY } = parsed;
  if (!API_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
    throw new Error('supabase status did not report the local API URL and keys');
  }
  return { API_URL, ANON_KEY, SERVICE_ROLE_KEY };
};

/**
 * `supabase db reset` restarts the containers, so `supabase status` can report the URL and
 * keys while gotrue and postgrest are still coming back up. Returning then makes the second
 * spec of a whole-suite run fail with 'fetch failed', which reads as a product defect and is
 * not one. So wait until both endpoints actually answer, with a bounded deadline.
 *
 * "Answers" means any HTTP response: a 401 from PostgREST is the service replying, which is
 * all that is being waited for. Only a transport failure counts as not yet up.
 */
const READINESS_DEADLINE_MS = 120_000;
const READINESS_POLL_MS = 250;

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

const answers = async (url: string, apiKey: string): Promise<boolean> => {
  try {
    await fetch(url, { headers: { apikey: apiKey, authorization: `Bearer ${apiKey}` } });
    return true;
  } catch {
    return false;
  }
};

const awaitLocalStackReady = async (status: SupabaseStatus): Promise<void> => {
  const endpoints = [
    `${status.API_URL}/auth/v1/health`,
    `${status.API_URL}/rest/v1/`,
  ] as const;
  const deadline = Date.now() + READINESS_DEADLINE_MS;

  for (const endpoint of endpoints) {
    for (;;) {
      if (await answers(endpoint, status.SERVICE_ROLE_KEY)) {
        break;
      }
      if (Date.now() >= deadline) {
        throw new Error(
          `the local stack did not answer ${endpoint} within ${READINESS_DEADLINE_MS} ms`,
        );
      }
      await sleep(READINESS_POLL_MS);
    }
  }
};

const contentTypes: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

const serveStatic = async (root: string): Promise<{ origin: string; server: Server }> => {
  const index = join(root, 'index.html');
  if (!existsSync(index)) {
    throw new Error(`the built bundle is missing: ${index}`);
  }
  const server = createServer((request, response) => {
    const requested = new URL(request.url ?? '/', 'http://localhost');
    const relative = normalize(decodeURIComponent(requested.pathname)).replace(/^([/\\]|\.\.)+/, '');
    const candidate = join(root, relative);
    const file =
      candidate.startsWith(root) && existsSync(candidate) && statSync(candidate).isFile()
        ? candidate
        : index;
    response.writeHead(200, {
      'content-type': contentTypes[extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    createReadStream(file).pipe(response);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  // Unreferenced so an open static server never keeps the worker process alive
  // after the last spec: the bundle is served for the whole run and nothing has
  // to close it at a spec boundary.
  server.unref();
  const { port } = server.address() as AddressInfo;
  return { origin: `http://127.0.0.1:${port}`, server };
};

let sharedStack: Promise<LocalStack> | null = null;

const bringUp = async (): Promise<LocalStack> => {
  run('supabase', ['start']);
  run('supabase', ['db', 'reset', '--no-seed']);
  const status = readStatus();
  await awaitLocalStackReady(status);

  runWithEnv('npm', ['run', 'build'], {
    VITE_SUPABASE_URL: status.API_URL,
    VITE_SUPABASE_ANON_KEY: status.ANON_KEY,
  });

  const { origin, server } = await serveStatic(join(repositoryRoot, 'dist'));

  return {
    supabaseUrl: status.API_URL,
    anonKey: status.ANON_KEY,
    serviceRoleKey: status.SERVICE_ROLE_KEY,
    siteUrl: origin,
    // The stack outlives every individual spec, so stopping is deliberately a
    // no-op: the served bundle and the containers are torn down when the run
    // ends, not when one spec finishes.
    stop: async () => {},
  };
};

/**
 * Starts the stack, resets the database onto the repository migrations, builds and
 * serves -- once per run, not once per spec. A reset restarts containers and costs
 * about ninety seconds, and the suite is a verification vector that grows with every
 * value, so the first caller pays for it and every later caller shares it. Specs
 * isolate themselves by owning their own accounts and rows, never by resetting.
 */
export const startLocalStack = (): Promise<LocalStack> => {
  sharedStack ??= bringUp();
  return sharedStack;
};
