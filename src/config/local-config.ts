import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { randomBytes } from 'crypto';

export const dataDirectory = resolve(process.env.DATA_DIR || join(process.cwd(), 'data'));
mkdirSync(dataDirectory, { recursive: true });

function resolveJwtSecret(): string {
  const configured = process.env.JWT_SECRET?.trim();
  if (configured && configured.length >= 32) return configured;

  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET é obrigatório em produção e deve ter pelo menos 32 caracteres.');
  }

  const secretPath = join(dataDirectory, '.jwt-secret');
  if (existsSync(secretPath)) return readFileSync(secretPath, 'utf8').trim();

  const generated = randomBytes(48).toString('hex');
  writeFileSync(secretPath, generated, { encoding: 'utf8', mode: 0o600 });
  return generated;
}

export const jwtSecret = resolveJwtSecret();
export const databasePath = resolve(process.env.DB_PATH || join(dataDirectory, 'builder.sqlite'));
export const publishedSitesDirectory = resolve(process.env.PUBLISHED_SITES_DIR || join(dataDirectory, 'published-sites'));
mkdirSync(publishedSitesDirectory, { recursive: true });
export const hostedVideosDirectory = resolve(process.env.HOSTED_VIDEOS_DIR || join(dataDirectory, 'hosted-videos'));
mkdirSync(hostedVideosDirectory, { recursive: true });
export const hostedVideoLimits = {
  maxBytes: Number(process.env.MAX_HOSTED_VIDEO_BYTES || 1_000_000_000),
  maxVideosPerUser: Number(process.env.MAX_HOSTED_VIDEOS_PER_USER || 50),
  maxTotalBytesPerUser: Number(process.env.MAX_HOSTED_VIDEO_STORAGE_BYTES || 10_000_000_000)
};
export const hostedAssetsDirectory = resolve(process.env.HOSTED_ASSETS_DIR || join(dataDirectory, 'hosted-assets'));
mkdirSync(hostedAssetsDirectory, { recursive: true });
export const hostedAssetLimits = { maxBytes: Number(process.env.MAX_HOSTED_ASSET_BYTES || 10_000_000), maxTotalBytesPerUser: Number(process.env.MAX_HOSTED_ASSET_STORAGE_BYTES || 500_000_000) };
export const supportAttachmentsDirectory = resolve(process.env.SUPPORT_ATTACHMENTS_DIR || join(dataDirectory, 'support-attachments'));
mkdirSync(supportAttachmentsDirectory, { recursive: true });
export const maxSupportAttachmentBytes = Number(process.env.MAX_SUPPORT_ATTACHMENT_BYTES || 5_000_000);
export const publicBaseUrl = (process.env.PUBLIC_BASE_URL || `http://127.0.0.1:${process.env.PORT || 3000}`).replace(/\/$/, '');
export const dnsCnameTarget = (process.env.DNS_CNAME_TARGET || 'pages.seudominio.com').trim();
export const domainVerificationMode = (process.env.DOMAIN_VERIFICATION_MODE || 'strict').trim().toLowerCase();
export const domainProvisioning = {
  enabled: process.env.DOMAIN_PROVISIONING_ENABLED === 'true',
  nginxDirectory: resolve(process.env.DOMAIN_NGINX_DIR || '/www/server/panel/vhost/nginx'),
  acmeWebroot: resolve(process.env.DOMAIN_ACME_WEBROOT || join(dataDirectory, 'acme-challenge')),
  certbotBinary: process.env.CERTBOT_BIN || 'certbot',
  appPort: Number(process.env.DOMAIN_BACKEND_PORT || process.env.PORT || 3001),
  includeWww: process.env.DOMAIN_INCLUDE_WWW === 'true',
  logsDirectory: resolve(process.env.DOMAIN_LOG_DIR || '/www/wwwlogs')
};
export const publicServerIps = (process.env.PUBLIC_SERVER_IPS || '')
  .split(',')
  .map((ip) => ip.trim())
  .filter(Boolean);
export const publicationLimits = {
  maxHtmlBytes: Number(process.env.MAX_PUBLICATION_HTML_BYTES || 2_000_000),
  maxPublicationsPerUser: Number(process.env.MAX_PUBLICATIONS_PER_USER || 200),
  maxCustomDomainsPerUser: Number(process.env.MAX_CUSTOM_DOMAINS_PER_USER || 50)
};
export const frontendOrigins = (process.env.FRONTEND_ORIGINS || 'http://localhost:8080,http://127.0.0.1:8080,http://localhost:8081,http://127.0.0.1:8081,http://localhost:8082,http://127.0.0.1:8082')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const configuredDbType = process.env.DB_TYPE || 'sqljs';
if (!['sqljs', 'postgres'].includes(configuredDbType)) {
  throw new Error('DB_TYPE deve ser "sqljs" ou "postgres".');
}
if (configuredDbType === 'postgres' && !process.env.DATABASE_URL?.trim()) {
  throw new Error('DATABASE_URL é obrigatório quando DB_TYPE=postgres.');
}
if (process.env.NODE_ENV === 'production') {
  if (!/^https:\/\//.test(publicBaseUrl)) throw new Error('PUBLIC_BASE_URL deve usar HTTPS em produção.');
  if (!frontendOrigins.length || frontendOrigins.some(origin => !/^https:\/\//.test(origin))) throw new Error('FRONTEND_ORIGINS deve conter somente origens HTTPS em produção.');
}
