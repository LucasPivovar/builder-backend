# Integração Backend e Fluxos

Status: projeto local rodando com frontend em `http://localhost:8081/` e API em `http://127.0.0.1:3000/api`.

## Resumo rápido

O backend já cobre:

- autenticação e sessão JWT;
- workspace do usuário: páginas, pastas, templates, versões, métricas e settings;
- publicações em `/p/...`;
- DNS customizado com verificação;
- notificações;
- admin com usuários, alertas, histórico e restauração de backup;
- templates criados pelo admin disponíveis para usuários;
- analytics/rastreio de páginas publicadas.

Ainda está local no frontend:

- tickets de suporte;
- configurações da conta;
- tour visto pelo usuário;
- algumas métricas antigas em `localStorage` como fallback.

## Rotas atuais da API

Base: `http://127.0.0.1:3000/api`

### Sistema

| Método | Rota | Auth | Uso |
|---|---|---:|---|
| `GET` | `/health` | Não | Verifica se a API está viva. |

### Auth

| Método | Rota | Auth | Uso |
|---|---|---:|---|
| `POST` | `/auth/register` | Não | Cria conta. Primeiro usuário vira admin. |
| `POST` | `/auth/login` | Não | Login e retorno de JWT. |
| `GET` | `/auth/me` | Sim | Dados da sessão atual. |

### Workspace

| Método | Rota | Auth | Uso |
|---|---|---:|---|
| `GET` | `/workspace` | Sim | Carrega workspace do usuário. |
| `PUT` | `/workspace` | Sim | Salva páginas, pastas, templates, versões e métricas. |
| `GET` | `/workspace/platform-templates` | Sim | Lista templates criados por admins para usuários. |

### Publicações

| Método | Rota | Auth | Uso |
|---|---|---:|---|
| `GET` | `/publications` | Sim | Lista publicações do usuário. |
| `POST` | `/publications` | Sim | Publica ou republica página HTML. |
| `PATCH` | `/publications/:id/verify-domain` | Sim | Verifica DNS customizado. |
| `DELETE` | `/publications/:id` | Sim | Remove publicação. |

### Notificações

| Método | Rota | Auth | Uso |
|---|---|---:|---|
| `GET` | `/notifications` | Sim | Lista notificações do usuário. |
| `PATCH` | `/notifications/read-all` | Sim | Marca todas como lidas. |
| `PATCH` | `/notifications/:id/read` | Sim | Marca uma como lida. |

Tipos usados: `success`, `error`, `pending`, `warning`, `info`, além dos antigos `welcome`, `security`, `update`.

### Analytics

| Método | Rota | Auth | Uso |
|---|---|---:|---|
| `POST` | `/analytics/events` | Não | Recebe eventos das páginas publicadas. |
| `GET` | `/analytics/summary` | Sim | Retorna resumo das páginas do usuário logado. |

Eventos rastreados:

- `page_view`;
- `cta_click`;
- `form_submit`;
- `scroll_depth`;
- `time_on_page`;
- `video_play`;
- `video_progress`;
- `video_complete`;
- `quiz_answer`.

### Admin

| Método | Rota | Auth | Uso |
|---|---|---:|---|
| `GET` | `/admin/overview` | Admin | KPIs gerais. |
| `GET` | `/admin/users` | Admin | Lista usuários. |
| `GET` | `/admin/history` | Admin | Histórico da plataforma. |
| `POST` | `/admin/alerts` | Admin | Emite alerta/notificação. |
| `GET` | `/admin/users/:userId/workspace` | Admin | Abre workspace de um usuário. |
| `POST` | `/admin/users/:userId/backups/:backupId/restore` | Admin | Restaura backup. |

## Fluxos atuais

### 1. Login e sessão

1. Usuário entra em login/cadastro.
2. Front chama `/auth/login` ou `/auth/register`.
3. Backend retorna `accessToken` e `user`.
4. Front salva em `localStorage` ou `sessionStorage`.
5. Todas as chamadas protegidas usam `Authorization: Bearer <token>`.

### 2. Carregamento do workspace

1. Ao abrir o app logado, front chama `/workspace`.
2. Backend retorna:
   - `revision`;
   - `initialized`;
   - `data.pages`;
   - `data.folders`;
   - `data.templates`;
   - `data.versions`;
   - `data.metrics`;
   - `data.settings`.
3. Front hidrata os registries locais.
4. Front também chama `/workspace/platform-templates`.

### 3. Salvamento de páginas

1. Usuário salva página no builder.
2. Front atualiza `pagesRegistry`.
3. Front sincroniza workspace com `PUT /workspace`.
4. Backend:
   - valida revision;
   - cria backup se workspace já existia;
   - salva dados;
   - cria notificação `Página salva`;
   - registra evento no histórico.

Observação: hoje salvamento automático também pode gerar notificação. Pode ser refinado para notificar só salvamento manual.

### 4. Publicação

1. Usuário clica `Publicar`.
2. Front gera HTML com `htmlExporter`.
3. Front chama `POST /publications`.
4. Backend:
   - valida tamanho e formato HTML;
   - cria pasta em `published-sites`;
   - grava `index.html`;
   - cria/atualiza `PublicationEntity`;
   - verifica DNS se domínio foi informado;
   - cria notificação;
   - registra histórico.
5. Página fica disponível em:
   - `PUBLIC_BASE_URL/p/<siteKey>/`;
   - domínio customizado quando `domainStatus = active`.

### 5. DNS customizado

1. Usuário publica página.
2. Se já publicada, abre modal `Atribuir DNS`.
3. Usuário informa domínio.
4. Backend valida domínio:
   - bloqueia localhost, domínio da plataforma, `.local`, `.test`, etc.;
   - garante domínio único;
   - verifica CNAME/A/AAAA conforme configuração.
5. Status pode ser:
   - `active`;
   - `pending`;
   - `none`.

### 6. Admin emite alerta

1. Admin abre aba `Alertas`.
2. Preenche título, mensagem, tipo e destino.
3. Front chama `POST /admin/alerts`.
4. Backend cria notificações para:
   - todos usuários ativos; ou
   - usuário específico.
5. Backend registra no histórico.
6. Usuário vê no modal de notificações.

### 7. Templates do admin para usuários

1. Admin cria template no Admin.
2. Builder abre em modo template.
3. Ao publicar template, ele entra em `customTemplatesRegistry` do workspace do admin.
4. Usuário comum chama `/workspace/platform-templates`.
5. Backend busca templates dos workspaces de admins ativos.
6. Front mistura esses templates com a biblioteca.
7. Usuário clica e usa como ponto de partida.

### 8. Analytics/rastreio

1. Ao publicar, o HTML exportado inclui script de rastreio.
2. Quando visitante abre a página, script envia:
   - visualização;
   - cliques em links/botões;
   - envio de formulário;
   - rolagem máxima;
   - tempo na página;
   - eventos de vídeo quando existe `<video>`;
   - conclusão do quiz.
3. Endpoint público recebe em `POST /analytics/events`.
4. Dashboard chama `GET /analytics/summary`.
5. Tela `Páginas` mostra:
   - views;
   - cliques;
   - sessões;
   - tempo médio;
   - rolagem;
   - dashboard de vídeos.

Limite atual: player externo tipo VTurb pode não expor `<video>` diretamente no DOM. Se não expor, conseguimos rastrear cliques/pitch/tempo/rolagem, mas não tempo real de vídeo. Para VTurb 100% preciso evento/API do player ou interceptar eventos oficiais dele.

## O que ainda falta integrar com backend

Resumo honesto:

| Área | Status atual | Falta para ficar produção |
|---|---|---|
| Login/usuários | Integrado no backend | Recuperação de senha, troca de senha, edição real de perfil. |
| Workspace/páginas | Integrado no backend | Separar autosave de salvamento manual para reduzir notificações. |
| Publicação `/p/...` | Integrado no backend | Configurar servidor real, storage/backup e Nginx. |
| DNS customizado | Parcialmente integrado | Configuração real no aaPanel/Nginx + SSL automático. |
| Notificações | Integrado no backend | Preferências do usuário e limpeza/arquivamento. |
| Admin alertas | Integrado no backend | Filtros por plano/status e agendamento. |
| Histórico admin | Integrado no backend | Filtros por período/usuário/tipo e export CSV. |
| Templates admin para usuários | Integrado no backend | Permissões/categorias/publicar/despublicar template. |
| Analytics | Integrado básico | Dashboard avançado por período, UTM, device, retenção real VTurb. |
| Tickets suporte | Apenas localStorage | Criar backend de tickets. |
| Configurações da conta | Apenas localStorage | Criar backend de settings da conta. |
| Billing/planos | Não implementado | Criar plano, limite, cobrança e permissões. |
| Produção | Não configurado | Deploy, domínio, SSL, backups, logs e monitoramento. |

### 1. Tickets de suporte

Hoje está no frontend via `localStorage`.

Falta criar:

- `SupportTicketEntity`;
- `POST /support/tickets`;
- `GET /support/tickets`;
- `PATCH /support/tickets/:id`;
- painel admin para responder/fechar tickets.

### 2. Configurações da conta

Hoje está no frontend via `localStorage`.

Falta criar:

- coluna `settings` no usuário ou entidade `UserSettings`;
- `GET /account/settings`;
- `PUT /account/settings`;
- aplicar preferências reais, como página inicial e modo compacto.

### 3. Analytics avançado por usuário/visitante

Hoje o rastreio usa `sessionId` anônimo.

Pode melhorar com:

- IP anonimizado/hash;
- país/cidade via provider;
- UTM source/campaign;
- device/browser;
- funil por etapa;
- filtro por período;
- export CSV.

### 4. Dashboard individual por vídeo

Hoje existe lista/resumo de vídeos.

Falta tela dedicada por vídeo com:

- gráfico de retenção por segundo;
- quedas por percentual;
- plays únicos;
- replay;
- conclusão;
- comparação entre páginas.

### 5. Reduzir notificações de salvamento

Hoje `PUT /workspace` pode gerar notificação a cada sync.

Melhor seria:

- salvar `silent: true` em autosave;
- notificar só clique manual em `Salvar`;
- ou limitar 1 notificação por página a cada X minutos.

### 6. Produção/servidor

Ainda precisa fechar em produção:

- domínio principal apontado para servidor;
- Nginx/aaPanel roteando `/api`, `/p` e domínios customizados;
- SSL automático dos domínios;
- backup real do banco e publicações;
- logs e monitoramento.

## Arquivos principais

Backend:

- `builder-backend/src/auth/*`
- `builder-backend/src/workspace/*`
- `builder-backend/src/publications/*`
- `builder-backend/src/notifications/*`
- `builder-backend/src/admin/*`
- `builder-backend/src/analytics/*`
- `builder-backend/src/audit/*`

Frontend:

- `builder-frontend/src/services/api.js`
- `builder-frontend/src/composables/useBuilderStore.js`
- `builder-frontend/src/views/DashboardView.vue`
- `builder-frontend/src/views/AdminView.vue`
- `builder-frontend/src/components/dashboard/PagesTableSection.vue`
- `builder-frontend/src/components/dashboard/AnalyticsOverview.vue`
- `builder-frontend/src/components/dashboard/NotificationsModal.vue`
- `builder-frontend/src/utils/htmlExporter.js`

## Como testar local

Na pasta `builder-frontend`:

```bash
npm run dev
```

URLs:

- Frontend: `http://localhost:8081/`
- API: `http://127.0.0.1:3000/api`

Teste rápido:

1. Login/cadastro.
2. Criar página.
3. Salvar.
4. Publicar.
5. Abrir URL `/p/...`.
6. Clicar botão, rolar página, ficar alguns segundos.
7. Voltar em `Dashboard > Páginas`.
8. Ver métricas atualizadas.
9. Abrir Admin > Alertas e enviar alerta.
10. Ver notificação no usuário.

## Checklist DNS e produção

Para o domínio do cliente funcionar de verdade, não basta digitar o domínio no modal. Precisa fechar estes pontos no servidor.

### 1. Domínio principal da plataforma

Você precisa escolher os domínios da sua plataforma, por exemplo:

- `app.seudominio.com` para o painel/builder;
- `api.seudominio.com` para a API;
- `pages.seudominio.com` para páginas publicadas;
- domínios próprios dos clientes apontando para seu servidor.

Você disse que ainda não vai separar `app/api/pages`, então pode começar tudo no mesmo servidor/domínio, mas em produção é melhor separar depois.

### 2. DNS da plataforma

No provedor DNS do seu domínio principal:

| Registro | Tipo | Valor |
|---|---|---|
| `app` | `A` | IP do servidor |
| `api` | `A` | IP do servidor |
| `pages` | `A` | IP do servidor |

Se for usar Cloudflare, pode deixar proxy ativado para `app` e `api`, mas para domínios de clientes talvez seja melhor começar sem proxy até validar.

### 3. DNS do cliente

Quando o cliente quiser usar `www.cliente.com`, ele deve criar:

| Registro | Tipo | Nome | Valor |
|---|---|---|---|
| CNAME | `CNAME` | `www` | `pages.seudominio.com` |

Se quiser domínio raiz `cliente.com`, alguns provedores não aceitam CNAME no root. Aí precisa uma destas opções:

- `A` para o IP do servidor;
- `ALIAS`/`ANAME` se o provedor suportar;
- usar Cloudflare CNAME flattening.

No backend, a variável importante é:

```env
DNS_CNAME_TARGET=pages.seudominio.com
PUBLIC_SERVER_IPS=SEU_IP_DO_SERVIDOR
DOMAIN_VERIFICATION_MODE=strict
```

### 4. aaPanel/Nginx

No aaPanel/Nginx você precisa aceitar:

- domínio principal;
- `pages.seudominio.com`;
- domínios customizados dos clientes.

Modelo de regra:

```nginx
server {
  listen 80;
  server_name pages.seudominio.com *.pages.seudominio.com;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

Para domínio de cliente, você precisa que o Nginx também aceite hosts dinâmicos. Em produção, o ideal é automatizar criação de server block ou usar uma regra catch-all:

```nginx
server {
  listen 80 default_server;
  server_name _;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

O backend já usa o `Host` para encontrar a publicação:

- se `Host = dominio-cliente.com`;
- busca publicação com `customDomain = dominio-cliente.com`;
- só serve se `domainStatus = active`.

### 5. SSL dos clientes

Hoje o backend prepara `customDomainUrl` como `https://dominio/`, mas SSL real depende do servidor.

Falta implementar uma destas opções:

1. aaPanel manual: criar site/domínio e emitir SSL pelo painel.
2. Certbot automático: gerar certificado quando DNS estiver ativo.
3. Caddy/Traefik: proxy que emite SSL automático por domínio.
4. Cloudflare for SaaS: solução mais profissional para domínio customizado.

Para começar simples:

- validar DNS no backend;
- criar domínio no aaPanel;
- emitir SSL manualmente;
- depois automatizar.

### 6. Variáveis `.env` importantes

No backend:

```env
PORT=3000
FRONTEND_ORIGINS=https://app.seudominio.com,http://localhost:8081
PUBLIC_BASE_URL=https://pages.seudominio.com
PUBLISHED_SITES_DIR=/www/wwwroot/published-sites
DNS_CNAME_TARGET=pages.seudominio.com
DOMAIN_VERIFICATION_MODE=strict
PUBLIC_SERVER_IPS=SEU_IP_DO_SERVIDOR
MAX_HTML_BYTES=5242880
MAX_PUBLICATIONS_PER_USER=200
MAX_CUSTOM_DOMAINS_PER_USER=50
```

### 7. O que falta automatizar no DNS/publicação

Ainda falta:

- criar server block Nginx automaticamente para domínio do cliente;
- emitir SSL automaticamente;
- renovar SSL automaticamente;
- mostrar instrução DNS diferente para root domain e subdomain;
- checar CAA/DNS problemático;
- tela admin para ver domínios pendentes;
- job periódico para revalidar DNS pendente;
- bloquear domínios perigosos com lista maior;
- logs por domínio.

### 8. Fluxo ideal final do DNS

1. Usuário publica página.
2. Sistema gera URL temporária em `pages.seudominio.com/p/...`.
3. Usuário clica `Atribuir DNS`.
4. Sistema mostra:
   - `CNAME www -> pages.seudominio.com`; ou
   - `A @ -> IP`.
5. Usuário aponta DNS.
6. Backend verifica.
7. Se ativo:
   - marca `domainStatus = active`;
   - cria/atualiza Nginx;
   - emite SSL;
   - notifica usuário.
8. Domínio passa a abrir a publicação certa pelo `Host`.

## Pendências técnicas prioritárias

Ordem recomendada:

1. Backend de tickets.
2. Backend de configurações da conta.
3. Separar autosave de salvamento manual.
4. Job para revalidar DNS pendente.
5. Automação SSL/Nginx.
6. Dashboard analytics com filtro por período.
7. Retenção real VTurb via API/eventos oficiais do player.
8. Permissões/planos/limites por usuário.
9. Backups externos do banco e das páginas publicadas.
10. Deploy com Nginx/PM2/systemd.

## Fluxo atualizado de métricas

As métricas funcionam assim:

1. Usuário publica uma página.
2. Backend salva o HTML em `PUBLISHED_SITES_DIR`.
3. Backend injeta automaticamente um script de rastreio no `<head>` do HTML publicado.
4. Ao abrir `/p/...`, o script envia eventos para:

```http
POST /api/analytics/events
```

5. A dashboard busca o resumo em:

```http
GET /api/analytics/summary
```

6. A tela exclusiva de cada página fica em:

```txt
/dashboard/metricas/:pageId
```

Eventos rastreados:

- `page_view`: visita na página publicada;
- `cta_click`: clique em link, botão, elemento com `role="button"`, `.canvas-btn` ou `.canvas-pitch-btn`;
- `form_submit`: envio de formulário;
- `scroll_depth`: maior rolagem;
- `time_on_page`: tempo na página;
- `video_play`: play/visualização de vídeo;
- `video_progress`: progresso quando o player expõe tempo;
- `video_complete`: conclusão quando o player expõe fim.

Observação importante:

- Métrica só conta em página publicada, por exemplo `http://127.0.0.1:3000/p/...`.
- Prévia do builder e tela `localhost:8081` não contam como publicação.
- Para páginas antigas, o backend agora tenta reinjetar o rastreio automaticamente ao subir.
- Vídeo VTurb pode aparecer como rastreado por visualização/clique no player; retenção precisa depende do VTurb expor `window.smartplayer.instances[].video.currentTime`.

## Como testar métricas no local

1. Subir backend:

```bash
cd builder-backend
npm run build
npm run start
```

2. Subir frontend:

```bash
cd builder-frontend
npm run serve -- --port 8081
```

3. Abrir:

```txt
http://localhost:8081/
```

4. Publicar uma página.
5. Abrir a URL publicada em `http://127.0.0.1:3000/p/...`.
6. Clicar em botões, rolar a página e esperar pelo menos 15 segundos.
7. Voltar no dashboard e abrir `Métricas`.

Se não aparecer:

- confirme se a URL aberta é `3000/p/...`;
- publique novamente ou reinicie o backend para reinjetar o script;
- confira se `POST /api/analytics/events` está chegando no backend;
- confira se o `pageId` do evento é igual ao ID da página no workspace.

## Notificações

Rotas atuais:

```http
GET /api/notifications
PATCH /api/notifications/read-all
PATCH /api/notifications/:id/read
DELETE /api/notifications
```

O botão `Limpar` no modal remove todas as notificações do usuário logado.
