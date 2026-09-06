import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import http from 'node:http';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const port = 3107;
const baseUrl = `http://127.0.0.1:${port}/api`;
const publicBaseUrl = `http://127.0.0.1:${port}`;
const dataDir = await mkdtemp(join(tmpdir(), 'funil-builder-api-'));
let server;
let serverOutput = '';

function startServer() {
  serverOutput = '';
  server = spawn(process.execPath, ['dist/main.js'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, DOMAIN_VERIFICATION_MODE: 'off' },
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

async function requestPublic(path, { host } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: '127.0.0.1',
      port,
      path,
      method: 'GET',
      headers: host ? { Host: host } : undefined
    }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({
        status: response.statusCode,
        text: async () => body
      }));
    });
    request.on('error', reject);
    request.end();
  });
}

try {
  startServer();
  await waitForServer();

  const suffix = Date.now();
  const password = 'TesteSeguro123';
  const registration = await request('/auth/register', {
    method: 'POST',
    body: { name: 'Teste', lastName: 'Persistência', phone: '+5511999998888', email: `persist-${suffix}@local.test`, password }
  });
  assert.equal(registration.response.status, 201);
  assert.ok(registration.data.accessToken);
  assert.equal('password' in registration.data.user, false);
  assert.equal(registration.data.user.phone, '5511999998888');
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
      pages: [
        { id: 'page-e2e', name: 'Página persistente', folderId: 'folder-e2e', rows: [{ id: 'row-e2e', columns: [] }] },
        { id: 'page-sub-2', name: 'Segunda Página', folderId: 'folder-e2e', rows: [{ id: 'row-sub-2', columns: [] }] }
      ],
      folders: [{ id: 'folder-e2e', name: 'Pasta persistente', parentId: null, color: '#0ea5e9', customDomain: 'oferta.exemplo.com' }],
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

  const publication = await request('/publications', {
    method: 'POST',
    token,
    body: {
      pageId: 'page-e2e',
      pageName: 'Página persistente',
      slug: 'pagina-persistente',
      customDomain: 'oferta.exemplo.com',
      html: '<!doctype html><html><head><title>Teste</title></head><body><h1>Publicado E2E</h1></body></html>'
    }
  });
  assert.equal(publication.response.status, 201);
  assert.match(publication.data.publicUrl, /\/p\/.*pagina-persistente\//);
  assert.equal(publication.data.dns.type, 'CNAME');
  assert.equal(publication.data.dns.host, 'oferta.exemplo.com');
  assert.equal(publication.data.domainStatus, 'active');

    // Teste de republicação: deve manter a mesma URL exatamente
  const republish = await request('/publications', {
    method: 'POST',
    token,
    body: {
      pageId: 'page-e2e',
      pageName: 'Página persistente atualizada',
      slug: 'pagina-persistente',
      customDomain: 'oferta.exemplo.com',
      html: '<!doctype html><html><head><title>Atualizado</title></head><body><h1>Publicado E2E</h1><p>Atualizado</p></body></html>'
    }
  });
  assert.equal(republish.response.status, 201);
  assert.equal(republish.data.publicUrl, publication.data.publicUrl, 'URL pública deve ser exatamente a mesma após republicar');

  // Teste de pasta com domínio e subpáginas (ex.: oferta.exemplo.com/segunda-pagina)
  const secondPagePub = await request('/publications', {
    method: 'POST',
    token,
    body: {
      pageId: 'page-sub-2',
      pageName: 'Segunda Página',
      slug: 'segunda-pagina',
      customDomain: 'oferta.exemplo.com',
      html: '<!doctype html><html><body><h1>Segunda Pagina na Pasta</h1></body></html>'
    }
  });
  assert.equal(secondPagePub.response.status, 201);
  const subpageCustomDomain = await requestPublic('/segunda-pagina', { host: 'oferta.exemplo.com' });
  assert.equal(subpageCustomDomain.status, 200);
  assert.match(await subpageCustomDomain.text(), /Segunda Pagina na Pasta/);

  // Teste endpoint Admin Pages (GET /api/admin/pages)
  const adminPages = await request('/admin/pages', { token });
  assert.equal(adminPages.response.status, 200);
  assert.ok(Array.isArray(adminPages.data));
  assert.ok(adminPages.data.some(p => p.pageId === 'page-e2e'));

  const popupPreflight = await fetch(`${baseUrl}/analytics/popup-submissions`, { method: 'OPTIONS', headers: { Origin: 'https://publicada.exemplo.com', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } });
  assert.equal(popupPreflight.headers.get('access-control-allow-origin'), 'https://publicada.exemplo.com');
  const privatePopupCors = await request('/analytics/popup-submissions?pageId=page-e2e', { token, origin: 'https://publicada.exemplo.com' });
  assert.equal(privatePopupCors.response.headers.get('access-control-allow-origin'), null);

  for (let index = 0; index < 7; index++) {
    const submission = await request('/analytics/popup-submissions', { method: 'POST', body: {
      pageId: 'page-e2e', popupId: 'popup-test', fields: [{ id: 'name', label: 'Nome', value: index === 0 ? '=1+1' : `Pessoa ${index}` }]
    } });
    assert.equal(submission.response.status, 201);
  }
  assert.equal((await request('/analytics/popup-submissions', { method: 'POST', body: { pageId: 'missing', popupId: 'test', fields: [{ id: 'name', label: 'Nome', value: 'Teste' }] } })).response.status, 404);
  assert.equal((await request('/analytics/popup-submissions', { method: 'POST', body: { pageId: 'page-e2e', popupId: 'test', fields: [{ id: 'name', label: 'Nome', value: 'x'.repeat(2001) }] } })).response.status, 400);
  assert.equal((await request('/analytics/popup-submissions?pageId=page-e2e')).response.status, 401);
  const firstResponses = await request('/analytics/popup-submissions?pageId=page-e2e&page=1', { token });
  const nextResponses = await request('/analytics/popup-submissions?pageId=page-e2e&page=2', { token });
  assert.equal(firstResponses.data.total, 7);
  assert.equal(firstResponses.data.items.length, 5);
  assert.equal(nextResponses.data.items.length, 2);
  assert.equal(new Set([...firstResponses.data.items, ...nextResponses.data.items].map(row => row.id)).size, 7);

  const publishedPage = await fetch(publication.data.publicUrl);
  assert.equal(publishedPage.status, 200);
  assert.match(await publishedPage.text(), /Publicado E2E/);

  const customDomainPage = await requestPublic('/', { host: 'oferta.exemplo.com' });
  assert.equal(customDomainPage.status, 200);
  assert.match(await customDomainPage.text(), /Publicado E2E/);

  const unknownDomainPage = await requestPublic('/', { host: 'sem-cadastro.exemplo.com' });
  assert.equal(unknownDomainPage.status, 404);

  const listedPublications = await request('/publications', { token });
  assert.equal(listedPublications.response.status, 200);
  assert.equal(listedPublications.data[0].pageId, 'page-e2e');

  const invalidPublication = await request('/publications', {
    method: 'POST',
    token,
    body: { pageId: 'page-e2e-2', pageName: 'Inválida', html: 'sem html completo' }
  });
  assert.equal(invalidPublication.response.status, 400);

  const blockedDomain = await request('/publications', {
    method: 'POST',
    token,
    body: {
      pageId: 'page-e2e-3',
      pageName: 'Bloqueada',
      customDomain: 'pages.seudominio.com',
      html: '<!doctype html><html><body>Bloqueada</body></html>'
    }
  });
  assert.equal(blockedDomain.response.status, 400);

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
  const persistedPage = await fetch(`${publicBaseUrl}/p/${publication.data.publicUrl.split('/p/')[1]}`);
  assert.equal(persistedPage.status, 200);
  const persistedCustomDomainPage = await requestPublic('/', { host: 'oferta.exemplo.com' });
  assert.equal(persistedCustomDomainPage.status, 200);

  const secondRegistration = await request('/auth/register', {
    method: 'POST',
    body: { name: 'Outro', email: `isolado-${suffix}@local.test`, password }
  });
  const isolated = await request('/workspace', { token: secondRegistration.data.accessToken });
  assert.equal(isolated.data.data.pages.length, 0);
  const savedResponses = await request('/analytics/popup-submissions?pageId=page-e2e', { token: login.data.accessToken });
  assert.equal(savedResponses.data.total, 7, 'Popup submissions persist after restart');
  const isolatedResponses = await request('/analytics/popup-submissions?pageId=page-e2e', { token: secondRegistration.data.accessToken });
  assert.equal(isolatedResponses.data.total, 0);
  const csvResponses = await request('/analytics/popup-submissions/export?pageId=page-e2e', { token: login.data.accessToken });
  assert.equal(csvResponses.data.csv.split('\r\n').length, 8);
  assert.ok(csvResponses.data.csv.includes("'=1+1"), 'CSV formulas must be escaped');
  const isolatedCsv = await request('/analytics/popup-submissions/export?pageId=page-e2e', { token: secondRegistration.data.accessToken });
  assert.equal(isolatedCsv.data.csv.split('\r\n').length, 1);

  const duplicatedDomain = await request('/publications', {
    method: 'POST',
    token: secondRegistration.data.accessToken,
    body: {
      pageId: 'page-other',
      pageName: 'Domínio duplicado',
      customDomain: 'oferta.exemplo.com',
      html: '<!doctype html><html><body>Duplicado</body></html>'
    }
  });
  assert.equal(duplicatedDomain.response.status, 409);

  const allowedCors = await request('/health', { origin: 'http://localhost:8080' });
  assert.equal(allowedCors.response.headers.get('access-control-allow-origin'), 'http://localhost:8080');
  assert.ok(allowedCors.response.headers.get('x-content-type-options'));
  assert.ok(allowedCors.response.headers.get('content-security-policy'));
  const deniedCors = await request('/health', { origin: 'https://site-invalido.test' });
  assert.equal(deniedCors.response.headers.get('access-control-allow-origin'), null);

  const databaseFile = join(dataDir, 'builder.sqlite');
  assert.equal(existsSync(databaseFile), true);
  assert.ok((await stat(databaseFile)).size > 0);

  console.log('OK: autenticação, autorização, conflito, CORS, publicação, isolamento e persistência após reinício.');
} finally {
  await stopServer();
  await rm(dataDir, { recursive: true, force: true });
}
