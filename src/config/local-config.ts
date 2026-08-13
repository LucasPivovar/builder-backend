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
export const frontendOrigins = (process.env.FRONTEND_ORIGINS || 'http://localhost:8080,http://127.0.0.1:8080,http://localhost:8081,http://127.0.0.1:8081')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
