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
  const { port } = server.address() as AddressInfo;
  return { origin: `http://127.0.0.1:${port}`, server };
};

/** Starts the stack, resets the database onto the repository migrations, builds and serves. */
export const startLocalStack = async (): Promise<LocalStack> => {
  run('supabase', ['start']);
  run('supabase', ['db', 'reset', '--no-seed']);
  const status = readStatus();

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
    stop: async () => {
      server.close();
      await once(server, 'close');
    },
  };
};
