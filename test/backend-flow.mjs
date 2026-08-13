import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const port = 3107;
const baseUrl = `http://127.0.0.1:${port}/api`;
const dataDir = await mkdtemp(join(tmpdir(), 'funil-builder-api-'));
let server;
let serverOutput = '';

function startServer() {
  serverOutput = '';
  server = spawn(process.execPath, ['dist/main.js'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stdout.on('data', chunk => { serverOutput += chunk.toString(); });
  server.stderr.on('data', chunk => { serverOutput += chunk.toString(); });
}

async function stopServer() {
  if (!server || server.exitCode !== null) return;
  server.kill('SIGTERM');
  await Promise.race([once(server, 'exit'), new Promise(resolve => setTimeout(resolve, 3000))]);
}

async function waitForServer() {
  // O sql.js pode levar mais tempo para inicializar em máquinas Windows ocupadas.
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`API encerrou durante o teste.\n${serverOutput}`);
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 120));
  }
  throw new Error(`API não iniciou no tempo esperado.\n${serverOutput}`);
}

async function request(path, { method = 'GET', token, body, origin } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(origin ? { Origin: origin } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  return { response, data: await response.json().catch(() => ({})) };
}

try {
  startServer();
  await waitForServer();

  const suffix = Date.now();
  const password = 'TesteSeguro123';
  const registration = await request('/auth/register', {
    method: 'POST',
    body: { name: 'Teste', lastName: 'Persistência', email: `persist-${suffix}@local.test`, password }
  });
  assert.equal(registration.response.status, 201);
  assert.ok(registration.data.accessToken);
  assert.equal('password' in registration.data.user, false);
  const token = registration.data.accessToken;

  const duplicateRegistration = await request('/auth/register', {
    method: 'POST',
    body: { name: 'Duplicado', email: `persist-${suffix}@local.test`, password }
  });
  assert.equal(duplicateRegistration.response.status, 409);

  const invalidPayload = await request('/auth/register', {
    method: 'POST',
    body: { name: 'Teste', email: `invalid-${suffix}@local.test`, password, admin: true }
  });
  assert.equal(invalidPayload.response.status, 400);

  assert.equal((await request('/workspace')).response.status, 401);
  assert.equal((await request('/auth/login', {
    method: 'POST',
    body: { email: `persist-${suffix}@local.test`, password: 'SenhaErrada123' }
  })).response.status, 401);

  const initialWorkspace = await request('/workspace', { token });
  assert.equal(initialWorkspace.response.status, 200);
  assert.equal(initialWorkspace.data.initialized, false);

  const savedWorkspace = await request('/workspace', {
    method: 'PUT',
    token,
    body: {
      revision: initialWorkspace.data.revision,
      pages: [{ id: 'page-e2e', name: 'Página persistente', rows: [{ id: 'row-e2e', columns: [] }] }],
      folders: [{ id: 'folder-e2e', name: 'Pasta persistente', parentId: null, color: '#0ea5e9' }],
      templates: [],
      versions: [{ id: 'version-e2e', pageKey: 'page-e2e', label: 'Versão E2E' }],
      metrics: [{ id: 'metric-e2e', pageKey: 'page-e2e', type: 'page_view' }],
      settings: {}
    }
  });
  assert.equal(savedWorkspace.response.status, 200);
  assert.equal(savedWorkspace.data.initialized, true);

  const conflict = await request('/workspace', {
    method: 'PUT',
    token,
    body: { revision: 0, pages: [], folders: [], templates: [], versions: [], metrics: [], settings: {} }
  });
  assert.equal(conflict.response.status, 409);

  await stopServer();
  startServer();
  await waitForServer();

  const login = await request('/auth/login', {
    method: 'POST',
    body: { email: `persist-${suffix}@local.test`, password }
  });
  assert.equal(login.response.status, 200);
  const persisted = await request('/workspace', { token: login.data.accessToken });
  assert.equal(persisted.data.data.pages[0].name, 'Página persistente');
  assert.equal(persisted.data.data.folders[0].name, 'Pasta persistente');
  assert.equal(persisted.data.data.versions[0].label, 'Versão E2E');
  assert.equal(persisted.data.data.metrics[0].type, 'page_view');

  const secondRegistration = await request('/auth/register', {
    method: 'POST',
    body: { name: 'Outro', email: `isolado-${suffix}@local.test`, password }
  });
  const isolated = await request('/workspace', { token: secondRegistration.data.accessToken });
  assert.equal(isolated.data.data.pages.length, 0);

  const allowedCors = await request('/health', { origin: 'http://localhost:8080' });
  assert.equal(allowedCors.response.headers.get('access-control-allow-origin'), 'http://localhost:8080');
  assert.ok(allowedCors.response.headers.get('x-content-type-options'));
  assert.ok(allowedCors.response.headers.get('content-security-policy'));
  const deniedCors = await request('/health', { origin: 'https://site-invalido.test' });
  assert.equal(deniedCors.response.headers.get('access-control-allow-origin'), null);

  const databaseFile = join(dataDir, 'builder.sqlite');
  assert.equal(existsSync(databaseFile), true);
  assert.ok((await stat(databaseFile)).size > 0);

  console.log('OK: autenticação, autorização, conflito, CORS, isolamento e persistência após reinício.');
} finally {
  await stopServer();
  await rm(dataDir, { recursive: true, force: true });
}
