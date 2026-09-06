import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { randomBytes } from 'crypto';

export const dataDirectory = resolve(process.env.DATA_DIR || join(process.cwd(), 'data'));
mkdirSync(dataDirectory, { recursive: true });

function resolveJwtSecret(): string {
  const configured = process.env.JWT_SECRET?.trim();
  if (configured && configured.length >= 32) return configured;

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
export const publicBaseUrl = (process.env.PUBLIC_BASE_URL || `http://127.0.0.1:${process.env.PORT || 3000}`).replace(/\/$/, '');
export const dnsCnameTarget = (process.env.DNS_CNAME_TARGET || 'pages.seudominio.com').trim();
export const domainVerificationMode = (process.env.DOMAIN_VERIFICATION_MODE || 'strict').trim().toLowerCase();
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
