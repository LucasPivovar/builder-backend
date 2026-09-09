import { Injectable, Logger } from '@nestjs/common';
import { lookup } from 'dns/promises';
import { execFile } from 'child_process';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { promisify } from 'util';
import { domainProvisioning, publicServerIps } from '../config/local-config';

const execFileAsync = promisify(execFile);

@Injectable()
export class DomainProvisionerService {
  private readonly logger = new Logger(DomainProvisionerService.name);
  private readonly running = new Map<string, Promise<void>>();

  async provision(domain: string) {
    const normalized = this.normalize(domain);
    if (!domainProvisioning.enabled || !normalized) return;

    const current = this.running.get(normalized);
    if (current) return current;

    const task = this.provisionOnce(normalized).finally(() => this.running.delete(normalized));
    this.running.set(normalized, task);
    return task;
  }

  async remove(domain: string) {
    const normalized = this.normalize(domain);
    if (!domainProvisioning.enabled || !normalized) return;
    const confPath = this.confPath(normalized);
    await writeFile(confPath, this.disabledConfig(normalized), 'utf8').catch(() => undefined);
    await this.reloadNginx().catch((error) => this.logger.warn(`Falha ao recarregar Nginx removendo ${normalized}: ${error.message}`));
  }

  private async provisionOnce(domain: string) {
    await mkdir(domainProvisioning.nginxDirectory, { recursive: true });
    await mkdir(domainProvisioning.acmeWebroot, { recursive: true });
    await mkdir(domainProvisioning.logsDirectory, { recursive: true }).catch(() => undefined);

    const domains = await this.serverNames(domain);
    await writeFile(this.confPath(domain), this.httpConfig(domain, domains), 'utf8');
    await this.reloadNginx();

    await this.issueCertificate(domain, domains);

    await writeFile(this.confPath(domain), this.httpsConfig(domain, domains), 'utf8');
    await this.reloadNginx();
    this.logger.log(`Domínio provisionado: ${domains.join(', ')}`);
  }

  private async serverNames(domain: string) {
    if (!domainProvisioning.includeWww || domain.split('.').length !== 2) return [domain];
    const www = `www.${domain}`;
    if (await this.pointsToThisServer(www)) return [domain, www];
    return [domain];
  }

  private async pointsToThisServer(domain: string) {
    if (!publicServerIps.length) return false;
    const addresses = await lookup(domain, { all: true }).catch(() => []);
    return addresses.some((row) => publicServerIps.includes(row.address));
  }

  private async issueCertificate(primaryDomain: string, domains: string[]) {
    const liveCert = `/etc/letsencrypt/live/${primaryDomain}/fullchain.pem`;
    if (await this.fileContains(liveCert, 'BEGIN CERTIFICATE')) return;
    const args = [
      'certonly',
      '--webroot',
      '-w',
      domainProvisioning.acmeWebroot,
      '--agree-tos',
      '--register-unsafely-without-email',
      '--non-interactive',
      ...domains.flatMap((domain) => ['-d', domain])
    ];
    await execFileAsync(domainProvisioning.certbotBinary, args, { timeout: 120_000, maxBuffer: 1024 * 1024 });
  }

  private async reloadNginx() {
    await execFileAsync('nginx', ['-t'], { timeout: 30_000 });
    await execFileAsync('nginx', ['-s', 'reload'], { timeout: 30_000 });
  }

  private async fileContains(path: string, text: string) {
    const content = await readFile(path, 'utf8').catch(() => '');
    return content.includes(text);
  }

  private confPath(domain: string) {
    return join(domainProvisioning.nginxDirectory, `${domain}.conf`);
  }

  private httpConfig(primaryDomain: string, domains: string[]) {
    return `server {
    listen 80;
    server_name ${domains.join(' ')};

    location ^~ /.well-known/acme-challenge/ {
        root ${domainProvisioning.acmeWebroot};
        try_files $uri =404;
    }

    ${this.proxyLocations(primaryDomain)}
}
`;
  }

  private httpsConfig(primaryDomain: string, domains: string[]) {
    return `server {
    listen 80;
    server_name ${domains.join(' ')};

    location ^~ /.well-known/acme-challenge/ {
        root ${domainProvisioning.acmeWebroot};
        try_files $uri =404;
    }

    return 301 https://${primaryDomain}$request_uri;
}

server {
    listen 443 ssl;
    http2 on;
    server_name ${domains.join(' ')};

    ssl_certificate /etc/letsencrypt/live/${primaryDomain}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${primaryDomain}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL_${this.cacheName(primaryDomain)}:10m;
    ssl_session_timeout 10m;

    ${this.proxyLocations(primaryDomain)}
}
`;
  }

  private disabledConfig(domain: string) {
    return `server {
    listen 80;
    server_name ${domain};
    return 410;
}
`;
  }

  private proxyLocations(primaryDomain: string) {
    return `access_log ${domainProvisioning.logsDirectory}/${primaryDomain}.log;
    error_log ${domainProvisioning.logsDirectory}/${primaryDomain}.error.log;
    client_max_body_size 64m;

    location /api/ {
        proxy_pass http://127.0.0.1:${domainProvisioning.appPort}/api/;
        proxy_set_header Host astrobuilder.com.br;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /media/ {
        proxy_pass http://127.0.0.1:${domainProvisioning.appPort}/media/;
        proxy_set_header Host astrobuilder.com.br;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
    }

    location / {
        proxy_pass http://127.0.0.1:${domainProvisioning.appPort};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }`;
  }

  private cacheName(domain: string) {
    return domain.replace(/[^A-Za-z0-9]/g, '_').slice(0, 40);
  }

  private normalize(domain: string) {
    const normalized = domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\.$/, '');
    return /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(normalized) ? normalized : '';
  }
}
