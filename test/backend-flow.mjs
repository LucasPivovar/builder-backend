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
const mailPort = 3108;
const dataDir = await mkdtemp(join(tmpdir(), 'funil-builder-api-'));
let server;
let serverOutput = '';
let mailServer;
const deliveredMessages = [];

async function startMailSink() {
  mailServer = http.createServer((request, response) => {
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      const message = JSON.parse(body || '{}'); message.providerId=`provider-${deliveredMessages.length+1}`; deliveredMessages.push(message);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ id: message.providerId }));
    });
  });
  mailServer.listen(mailPort, '127.0.0.1');
  await once(mailServer, 'listening');
}

function startServer() {
  serverOutput = '';
  server = spawn(process.execPath, ['dist/main.js'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, PUBLIC_BASE_URL: publicBaseUrl, DOMAIN_VERIFICATION_MODE: 'off', MAIL_DELIVERY_WEBHOOK_URL: `http://127.0.0.1:${mailPort}/send`, MAIL_WEBHOOK_SECRET: 'e2e-mail-webhook-secret', REQUIRE_ANALYTICS_SIGNATURE:'true', REQUIRE_EMAIL_VERIFICATION:'true', EXPOSE_EMAIL_VERIFICATION_TOKEN:'true' },
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
        headers: { get: name => response.headers[String(name).toLowerCase()] || null },
        text: async () => body
      }));
    });
    request.on('error', reject);
    request.end();
  });
}

try {
  await startMailSink();
  startServer();
  await waitForServer();

  const suffix = Date.now();
  let password = 'TesteSeguro123';
  const registration = await request('/auth/register', {
    method: 'POST',
    body: { name: 'Teste', lastName: 'Persistência', phone: '+5511999998888', email: `persist-${suffix}@local.test`, password }
  });
  assert.equal(registration.response.status, 201);
  assert.equal(registration.data.emailVerificationRequired, true);
  assert.equal(registration.data.email, `persist-${suffix}@local.test`);
  assert.ok(registration.data.verificationToken);
  assert.equal((await request('/auth/email-verification/confirm',{method:'POST',body:{token:registration.data.verificationToken}})).response.status,201);
  const verifiedLogin = await request('/auth/login', { method:'POST', body:{ email:`persist-${suffix}@local.test`, password, remember:true } });
  assert.equal(verifiedLogin.response.status, 200);
  assert.equal('password' in verifiedLogin.data.user, false);
  assert.equal(verifiedLogin.data.user.phone, '5511999998888');
  let token = verifiedLogin.data.accessToken;
  assert.equal((await request('/auth/me',{token})).data.emailVerified,true);

  const resetRequest = await request('/auth/password-reset/request', { method: 'POST', body: { email: `persist-${suffix}@local.test` } });
  assert.equal(resetRequest.response.status, 201);
  assert.ok(resetRequest.data.resetToken, 'Ambiente E2E deve expor token local de recuperação');
  const newPassword = 'NovaSenhaSegura456';
  const resetConfirmation = await request('/auth/password-reset/confirm', { method: 'POST', body: { token: resetRequest.data.resetToken, password: newPassword } });
  assert.equal(resetConfirmation.response.status, 201);
  assert.equal((await request('/auth/password-reset/confirm', { method: 'POST', body: { token: resetRequest.data.resetToken, password: password } })).response.status, 400);
  assert.equal((await request('/auth/login', { method: 'POST', body: { email: `persist-${suffix}@local.test`, password } })).response.status, 401);
  password = newPassword;
  assert.equal((await request('/auth/me', { token })).response.status, 401, 'Reset de senha deve revogar sessões existentes');
  const afterResetLogin = await request('/auth/login', { method: 'POST', body: { email: `persist-${suffix}@local.test`, password, remember: true } });
  assert.equal(afterResetLogin.response.status, 200);
  token = afterResetLogin.data.accessToken;
  assert.ok(afterResetLogin.data.refreshToken);
  const rotatedSession = await request('/auth/refresh', { method: 'POST', body: { refreshToken: afterResetLogin.data.refreshToken } });
  assert.equal(rotatedSession.response.status, 200);
  assert.notEqual(rotatedSession.data.refreshToken, afterResetLogin.data.refreshToken);
  assert.equal((await request('/auth/refresh', { method: 'POST', body: { refreshToken: afterResetLogin.data.refreshToken } })).response.status, 401);
  token = rotatedSession.data.accessToken;
  const activeSessions = await request('/auth/sessions', { token });
  assert.equal(activeSessions.response.status, 200);
  assert.equal(activeSessions.data.filter(session => session.current).length, 1);

  const videoForm = new FormData();
  videoForm.append('video', new Blob([Buffer.from([0, 0, 0, 16]), Buffer.from('ftypisom'), Buffer.from('e2e-video')], { type: 'video/mp4' }), 'vsl-e2e.mp4');
  const videoUploadResponse = await fetch(`${baseUrl}/videos`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: videoForm
  });
  const uploadedVideo = await videoUploadResponse.json();
  assert.equal(videoUploadResponse.status, 201);
  assert.equal(uploadedVideo.name, 'vsl-e2e.mp4');
  assert.match(uploadedVideo.url, /\/media\/videos\/[a-f0-9-]+\.mp4$/);
  const videoRange = await fetch(uploadedVideo.url, { headers: { Range: 'bytes=0-3' } });
  assert.equal(videoRange.status, 206);
  assert.equal(videoRange.headers.get('accept-ranges'), 'bytes');
  assert.equal((await request('/videos', { token })).data.length, 1);
  const videoUsage = await request('/videos/usage', { token });
  assert.equal(videoUsage.data.count, 1);
  assert.ok(videoUsage.data.maxBytes >= videoUsage.data.bytes);
  const invalidVideoForm = new FormData();
  invalidVideoForm.append('video', new Blob([Buffer.from('<script>alert(1)</script>')], { type: 'video/mp4' }), 'falso.mp4');
  const invalidVideo = await fetch(`${baseUrl}/videos`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: invalidVideoForm });
  assert.equal(invalidVideo.status, 400);
  const assetForm = new FormData();
  assetForm.append('asset', new Blob([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.from('asset-e2e')], { type:'image/png' }), 'capa.png');
  const assetUploadResponse = await fetch(`${baseUrl}/assets`, { method:'POST', headers:{Authorization:`Bearer ${token}`}, body:assetForm });
  const uploadedAsset = await assetUploadResponse.json();
  assert.equal(assetUploadResponse.status, 201);
  assert.match(uploadedAsset.url, /\/media\/assets\/[a-f0-9-]+\.png$/);
  assert.equal((await fetch(uploadedAsset.url)).status, 200);
  assert.equal((await request('/assets', { token })).data.length, 1);

  const supportTicket = await request('/support/tickets', {
    method: 'POST', token, body: {
      subject: 'DNS não validou no teste', category: 'Publicação / DNS', priority: 'Alta',
      pageUrl: 'https://oferta.exemplo.com', message: 'O domínio continua pendente depois da configuração.'
    }
  });
  assert.equal(supportTicket.response.status, 201);
  assert.equal(supportTicket.data.status, 'open');
  const attachmentForm = new FormData();
  attachmentForm.append('attachment', new Blob([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.from('support-e2e')], { type:'image/png' }), 'evidencia.png');
  const attachmentUploadResponse = await fetch(`${baseUrl}/support/tickets/${supportTicket.data.id}/attachments`, { method:'POST', headers:{Authorization:`Bearer ${token}`}, body:attachmentForm });
  const ticketWithAttachment = await attachmentUploadResponse.json();
  assert.equal(attachmentUploadResponse.status, 201);
  assert.equal(ticketWithAttachment.attachments[0].name, 'evidencia.png');
  const attachmentDownload = await fetch(`${baseUrl}/support/tickets/${supportTicket.data.id}/attachments/${ticketWithAttachment.attachments[0].id}`, { headers:{Authorization:`Bearer ${token}`} });
  assert.equal(attachmentDownload.status, 200);
  assert.match(attachmentDownload.headers.get('content-disposition'), /evidencia\.png/);
  assert.equal((await request('/support/tickets', { token })).data.length, 1);
  const adminTickets = await request('/admin/support/tickets', { token });
  assert.equal(adminTickets.response.status, 200);
  assert.equal(adminTickets.data[0].userEmail, `persist-${suffix}@local.test`);
  const adminReply = await request(`/admin/support/tickets/${supportTicket.data.id}`, { method: 'POST', token, body: { status: 'resolved', reply: 'Verificamos o apontamento e o domínio já pode ser validado novamente.' } });
  assert.equal(adminReply.data.status, 'resolved');
  assert.match(adminReply.data.adminReply, /domínio/);
  const reopenedTicket = await request(`/admin/support/tickets/${supportTicket.data.id}`, { method: 'POST', token, body: { status: 'open' } });
  assert.equal(reopenedTicket.data.status, 'open');
  const invalidTicket = await request('/support/tickets', { method: 'POST', token, body: { subject: 'x', category: 'Inválida', priority: 'Normal', message: 'curta' } });
  assert.equal(invalidTicket.response.status, 400);
  const userTicketMessage = await request(`/support/tickets/${supportTicket.data.id}/messages`, { method: 'POST', token, body: { message: 'Ainda preciso de ajuda com a propagação.' } });
  assert.equal(userTicketMessage.data.messages.at(-1).author, 'user');

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
  const catalog = await request('/billing/plans', { token });
  assert.equal(catalog.response.status, 200);
  assert.deepEqual(catalog.data.map(plan => plan.id), ['essential', 'pro', 'agency']);
  const initialSubscription = await request('/billing/subscription', { token });
  assert.equal(initialSubscription.data.plan, 'essential');
  assert.equal(initialSubscription.data.limits.maxPages, 5);

  const savedWorkspace = await request('/workspace', {
    method: 'PUT',
    token,
    body: {
      revision: initialWorkspace.data.revision,
      pages: [
        { id: 'page-e2e', name: 'Página persistente', folderId: 'folder-e2e', rows: [{ id: 'row-e2e', columns: [] }] },
        { id: 'page-sub-2', name: 'Segunda Página', folderId: 'folder-e2e', rows: [{ id: 'row-sub-2', columns: [] }] },
        { id: 'page-email', name: 'E-mail E2E', type: 'email', builderMode: 'email', rows: [{ id: 'row-email', columns: [] }] }
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
  const changedWorkspace = await request('/workspace', {
    method: 'PUT', token,
    body: { ...savedWorkspace.data.data, revision: savedWorkspace.data.revision, pages: savedWorkspace.data.data.pages.map((page, index) => index === 0 ? { ...page, name: 'Página alterada' } : page) }
  });
  assert.equal(changedWorkspace.response.status, 200);
  const ownBackups = await request('/workspace/backups', { token });
  assert.equal(ownBackups.response.status, 200);
  assert.ok(ownBackups.data.length >= 1);
  const ownBackupDiff = await request(`/workspace/backups/${ownBackups.data[0].id}/diff`, { token });
  assert.ok(ownBackupDiff.data.pages.changed.includes('Página alterada'));
  const selfRestore = await request(`/workspace/backups/${ownBackups.data[0].id}/restore`, { method:'POST', token });
  assert.equal(selfRestore.response.status, 201);
  assert.equal(selfRestore.data.data.pages[0].name, 'Página persistente');

  const contact = await request('/email/contacts', { method:'POST', token, body:{ email:`lead-${suffix}@local.test`, name:'Lead Consentido', consentSource:'Formulário E2E' } });
  assert.equal(contact.response.status, 201);
  assert.equal(contact.data.status, 'subscribed');
  const emailCampaign = await request('/email/campaigns', { method:'POST', token, body:{ name:'Campanha E2E', subject:'Assunto E2E', fromName:'Astro', pageId:'page-email', html:'<!doctype html><html><body><a href="https://example.com">Oferta</a></body></html>' } });
  assert.equal(emailCampaign.response.status, 201);
  const sentCampaign = await request(`/email/campaigns/${emailCampaign.data.id}/send`, { method:'POST', token });
  assert.equal(sentCampaign.response.status, 201);
  assert.equal(sentCampaign.data.campaign.status, 'sent');
  const campaignMessage=deliveredMessages.find(message=>message.subject==='Assunto E2E');
  assert.ok(campaignMessage);
  assert.match(campaignMessage.html, /Descadastrar/);
  const openUrl = campaignMessage.html.match(/src="(http[^\"]+\/api\/email\/open\/[^\"]+)"/)?.[1];
  const unsubscribeUrl = campaignMessage.html.match(/href="(http[^\"]+\/api\/email\/unsubscribe\/[^\"]+)"/)?.[1];
  assert.ok(openUrl && unsubscribeUrl);
  assert.equal((await fetch(openUrl)).status, 200);
  assert.equal((await fetch(unsubscribeUrl)).status, 200);
  const unsubscribedContacts = await request('/email/contacts?status=unsubscribed', { token });
  assert.equal(unsubscribedContacts.data.total, 1);
  assert.equal((await request('/email/webhooks/delivery', { method:'POST', body:{ providerId:campaignMessage.providerId, event:'bounce' } })).response.status, 400);
  const bounceResponse = await fetch(`${baseUrl}/email/webhooks/delivery`, { method:'POST', headers:{'content-type':'application/json','x-webhook-secret':'e2e-mail-webhook-secret'}, body:JSON.stringify({providerId:campaignMessage.providerId,event:'bounce'}) });
  assert.equal(bounceResponse.status, 200);
  assert.equal((await request('/email/contacts?status=bounced', { token })).data.total, 1);

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
  const trackingHtml = await (await fetch(publication.data.publicUrl)).text();
  const analyticsSignature = trackingHtml.match(/__builderAnalyticsSignature="([a-f0-9]{64})"/)?.[1];
  assert.ok(analyticsSignature, 'Publicação deve incorporar assinatura de analytics');
  const subpageCustomDomain = await requestPublic('/segunda-pagina', { host: 'oferta.exemplo.com' });
  assert.equal(subpageCustomDomain.status, 200);
  assert.match(await subpageCustomDomain.text(), /Segunda Pagina na Pasta/);

  // Teste endpoint Admin Pages (GET /api/admin/pages)
  const adminPages = await request('/admin/pages', { token });
  assert.equal(adminPages.response.status, 200);
  assert.ok(Array.isArray(adminPages.data));
  assert.ok(adminPages.data.some(p => p.pageId === 'page-e2e'));
  assert.equal((await request('/analytics/summary?pageId=inexistente', { token })).response.status, 400);
  assert.equal((await request('/analytics/summary?pageId=page-e2e&from=invalid', { token })).response.status, 400);
  assert.equal((await request('/analytics/events', { method:'POST', body:{ pageId:'page-e2e', type:'page_view' } })).response.status, 400);
  assert.equal((await request('/analytics/events', { method:'POST', body:{ pageId:'page-e2e', type:'page_view', signature:analyticsSignature } })).response.status, 201);

  const popupPreflight = await fetch(`${baseUrl}/analytics/popup-submissions`, { method: 'OPTIONS', headers: { Origin: 'https://publicada.exemplo.com', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } });
  assert.equal(popupPreflight.headers.get('access-control-allow-origin'), 'https://publicada.exemplo.com');
  const privatePopupCors = await request('/analytics/popup-submissions?pageId=page-e2e', { token, origin: 'https://publicada.exemplo.com' });
  assert.equal(privatePopupCors.response.headers.get('access-control-allow-origin'), null);

  for (let index = 0; index < 7; index++) {
    const submission = await request('/analytics/popup-submissions', { method: 'POST', body: {
      pageId: 'page-e2e', signature:analyticsSignature, popupId: 'popup-test', fields: [{ id: 'name', label: 'Nome', value: index === 0 ? '=1+1' : `Pessoa ${index}` }]
    } });
    assert.equal(submission.response.status, 201);
  }
  assert.equal((await request('/analytics/popup-submissions', { method: 'POST', body: { pageId: 'missing', popupId: 'test', fields: [{ id: 'name', label: 'Nome', value: 'Teste' }] } })).response.status, 404);
  assert.equal((await request('/analytics/popup-submissions', { method: 'POST', body: { pageId: 'page-e2e', signature:analyticsSignature, popupId: 'test', fields: [{ id: 'name', label: 'Nome', value: 'x'.repeat(2001) }] } })).response.status, 400);
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
  assert.match(customDomainPage.headers?.get?.('content-security-policy') || '', /default-src/);

  const unknownDomainPage = await requestPublic('/', { host: 'sem-cadastro.exemplo.com' });
  assert.equal(unknownDomainPage.status, 404);

  const listedPublications = await request('/publications', { token });
  assert.equal(listedPublications.response.status, 200);
  assert.ok(listedPublications.data.some(item => item.pageId === 'page-e2e'));

  const invalidPublication = await request('/publications', {
    method: 'POST',
    token,
    body: { pageId: 'page-e2e-2', pageName: 'Inválida', html: 'sem html completo' }
  });
  assert.equal(invalidPublication.response.status, 400);

  const ignoredPageDomain = await request('/publications', {
    method: 'POST',
    token,
    body: {
      pageId: 'page-e2e-3',
      pageName: 'Domínio solto ignorado',
      customDomain: 'pages.seudominio.com',
      html: '<!doctype html><html><body>Sem domínio de pasta</body></html>'
    }
  });
  assert.equal(ignoredPageDomain.response.status, 201);
  assert.equal(ignoredPageDomain.data.customDomain, null);
  assert.equal(ignoredPageDomain.data.domainStatus, 'none');

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
  assert.equal(secondRegistration.data.emailVerificationRequired, true);
  assert.equal((await request('/auth/email-verification/confirm', { method:'POST', body:{ token:secondRegistration.data.verificationToken } })).response.status, 201);
  const secondInitialLogin = await request('/auth/login', { method:'POST', body:{ email:`isolado-${suffix}@local.test`, password } });
  assert.equal(secondInitialLogin.response.status, 200);
  const secondInitialToken = secondInitialLogin.data.accessToken;
  const isolated = await request('/workspace', { token: secondInitialToken });
  assert.equal(isolated.data.data.pages.length, 0);
  const tooManyPages = await request('/workspace', {
    method: 'PUT', token: secondInitialToken,
    body: { revision: isolated.data.revision, pages: Array.from({ length: 6 }, (_, index) => ({ id: `limited-${index}`, name: `Página ${index}`, rows: [] })), folders: [], templates: [], versions: [], metrics: [], settings: {} }
  });
  assert.equal(tooManyPages.response.status, 409);
  const planRequest = await request('/billing/checkout', { method: 'POST', token: secondInitialToken, body: { plan: 'pro' } });
  assert.equal(planRequest.response.status, 201);
  assert.equal(planRequest.data.request.status, 'pending');
  const pendingPlans = await request('/admin/billing/requests', { token: login.data.accessToken });
  assert.equal(pendingPlans.response.status, 200);
  assert.ok(pendingPlans.data.some(item => item.id === planRequest.data.request.id && item.userEmail === `isolado-${suffix}@local.test`));
  const approvedPlan = await request(`/admin/billing/requests/${planRequest.data.request.id}`, { method: 'POST', token: login.data.accessToken, body: { status: 'approved' } });
  assert.equal(approvedPlan.data.status, 'approved');
  assert.equal((await request('/billing/subscription', { token: secondInitialToken })).data.plan, 'pro');
  const expandedWorkspace = await request('/workspace', {
    method: 'PUT', token: secondInitialToken,
    body: { revision: isolated.data.revision, pages: Array.from({ length: 6 }, (_, index) => ({ id: `expanded-${index}`, name: `Página ${index}`, rows: [] })), folders: [], templates: [], versions: [], metrics: [], settings: {} }
  });
  assert.equal(expandedWorkspace.response.status, 200);
  assert.equal((await request('/videos', { token: secondInitialToken })).data.length, 0);
  assert.equal((await request('/assets', { token: secondInitialToken })).data.length, 0);
  assert.equal((await request('/videos', { token: login.data.accessToken })).data.length, 1);
  assert.equal((await request('/support/tickets', { token: secondInitialToken })).data.length, 0);
  assert.equal((await request('/admin/support/tickets', { token: secondInitialToken })).response.status, 403);
  const secondUserAdminView = await request(`/admin/users/${secondInitialLogin.data.user.id}/workspace`, { token: login.data.accessToken });
  assert.equal(secondUserAdminView.response.status, 200);
  assert.ok(secondUserAdminView.data.sessions.length >= 1, 'Admin deve enxergar sessões ativas da conta');
  const disableSecond = await request(`/admin/users/${secondInitialLogin.data.user.id}/access`, { method: 'PATCH', token: login.data.accessToken, body: { active: false } });
  assert.equal(disableSecond.data.active, false);
  assert.equal((await request('/auth/me', { token: secondInitialToken })).response.status, 401, 'Desativar conta deve revogar as sessões existentes');
  assert.equal((await request('/auth/login', { method: 'POST', body: { email: `isolado-${suffix}@local.test`, password } })).response.status, 401);
  const enableSecond = await request(`/admin/users/${secondInitialLogin.data.user.id}/access`, { method: 'PATCH', token: login.data.accessToken, body: { active: true } });
  assert.equal(enableSecond.data.active, true);
  const reenabledLogin = await request('/auth/login', { method: 'POST', body: { email: `isolado-${suffix}@local.test`, password } });
  assert.equal(reenabledLogin.response.status, 200);
  const secondToken = reenabledLogin.data.accessToken;
  const secondWorkspace = await request('/workspace', { token: secondToken });
  assert.equal(secondWorkspace.response.status, 200);
  const secondWorkspaceWithDomain = await request('/workspace', {
    method: 'PUT',
    token: secondToken,
    body: {
      revision: secondWorkspace.data.revision,
      pages: [{ id: 'page-other', name: 'Domínio duplicado', folderId: 'folder-other', rows: [{ id: 'row-other', columns: [] }] }],
      folders: [{ id: 'folder-other', name: 'Pasta duplicada', parentId: null, color: '#7c3aed', customDomain: 'oferta.exemplo.com' }],
      templates: [],
      versions: [],
      metrics: [],
      settings: {}
    }
  });
  assert.equal(secondWorkspaceWithDomain.response.status, 200);
  assert.equal((await request(`/admin/users/${login.data.user.id}/access`, { method: 'PATCH', token: login.data.accessToken, body: { role: 'user' } })).response.status, 400);
  assert.equal((await request('/support/tickets', { token: login.data.accessToken })).data.length, 1);
  const resolvedTicket = await request(`/support/tickets/${supportTicket.data.id}/resolve`, { method: 'PATCH', token: login.data.accessToken });
  assert.equal(resolvedTicket.data.status, 'resolved');
  const savedResponses = await request('/analytics/popup-submissions?pageId=page-e2e', { token: login.data.accessToken });
  assert.equal(savedResponses.data.total, 7, 'Popup submissions persist after restart');
  const isolatedResponses = await request('/analytics/popup-submissions?pageId=page-e2e', { token: secondToken });
  assert.equal(isolatedResponses.data.total, 0);
  const csvResponses = await request('/analytics/popup-submissions/export?pageId=page-e2e', { token: login.data.accessToken });
  assert.equal(csvResponses.data.csv.split('\r\n').length, 8);
  assert.ok(csvResponses.data.csv.includes("'=1+1"), 'CSV formulas must be escaped');
  const isolatedCsv = await request('/analytics/popup-submissions/export?pageId=page-e2e', { token: secondToken });
  assert.equal(isolatedCsv.data.csv.split('\r\n').length, 1);

  const duplicatedDomain = await request('/publications', {
    method: 'POST',
    token: secondToken,
    body: {
      pageId: 'page-other',
      pageName: 'Domínio duplicado',
      customDomain: 'oferta.exemplo.com',
      html: '<!doctype html><html><body>Duplicado</body></html>'
    }
  });
  assert.equal(duplicatedDomain.response.status, 409);

  const personalExport = await request('/privacy/export', { token: secondToken });
  assert.equal(personalExport.response.status, 200);
  assert.equal(personalExport.data.profile.email, `isolado-${suffix}@local.test`);
  assert.equal(personalExport.data.workspace.data.pages.length, 1);
  const deletedAccount = await request('/privacy/account', { method:'DELETE', token:secondToken, body:{password} });
  assert.equal(deletedAccount.response.status, 200);
  assert.equal((await request('/auth/me', { token:secondToken })).response.status, 401);
  assert.equal((await request('/privacy/account', { method:'DELETE', token:login.data.accessToken, body:{password} })).response.status, 400, 'Último administrador não pode excluir a própria conta');

  const allowedCors = await request('/health', { origin: 'http://localhost:8080' });
  assert.equal(allowedCors.response.headers.get('access-control-allow-origin'), 'http://localhost:8080');
  assert.ok(allowedCors.response.headers.get('x-content-type-options'));
  assert.ok(allowedCors.response.headers.get('content-security-policy'));
  assert.ok(allowedCors.response.headers.get('x-request-id'));
  assert.equal((await request('/health/ready')).data.database, 'ok');
  const deniedCors = await request('/health', { origin: 'https://site-invalido.test' });
  assert.equal(deniedCors.response.headers.get('access-control-allow-origin'), null);

  const databaseFile = join(dataDir, 'builder.sqlite');
  assert.equal(existsSync(databaseFile), true);
  assert.ok((await stat(databaseFile)).size > 0);

  const removedVideo = await request(`/videos/${uploadedVideo.id}`, { method: 'DELETE', token: login.data.accessToken });
  assert.equal(removedVideo.response.status, 200);
  assert.equal((await fetch(uploadedVideo.url)).status, 404);
  assert.equal((await request(`/assets/${uploadedAsset.id}`, { method:'DELETE', token:login.data.accessToken })).response.status, 200);

  console.log('OK: autenticação, planos, limites, vídeos, autorização, conflito, CORS, publicação, isolamento e persistência após reinício.');
} finally {
  await stopServer();
  if (mailServer) await new Promise(resolve => mailServer.close(resolve));
  await rm(dataDir, { recursive: true, force: true });
}
