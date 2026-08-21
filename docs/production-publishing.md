# Publicação com domínio próprio

## DNS

No painel DNS do cliente, crie:

```txt
Tipo: CNAME
Host: oferta
Valor: pages.seudominio.com
```

Para domínio raiz, use `A` apontando para o IP do servidor ou ALIAS/ANAME se o provedor suportar.

## Variáveis do backend

```env
PUBLIC_BASE_URL=https://pages.seudominio.com
DNS_CNAME_TARGET=pages.seudominio.com
PUBLISHED_SITES_DIR=/www/wwwroot/astro-builder-sites
FRONTEND_ORIGINS=https://app.seudominio.com
DOMAIN_VERIFICATION_MODE=strict
PUBLIC_SERVER_IPS=SEU_IP_PUBLICO
```

## Nginx/aaPanel

Crie um site/proxy para `pages.seudominio.com` e inclua os domínios de clientes no mesmo proxy quando eles forem cadastrados:

```nginx
server {
    listen 80;
    server_name pages.seudominio.com *.seudominio.com dominio-cliente.com;

    location /.well-known/acme-challenge/ {
        root /www/wwwroot/acme;
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

O backend decide qual página entregar pelo cabeçalho `Host`. Se `oferta.cliente.com` estiver cadastrado em uma publicação, acessar esse domínio entrega o `index.html` dessa publicação.

Por segurança, o domínio só é servido quando `domainStatus=active`. Em modo `strict`, isso exige CNAME para `DNS_CNAME_TARGET` ou A/AAAA para algum IP listado em `PUBLIC_SERVER_IPS`.

## SSL

Use Let's Encrypt no aaPanel para cada domínio do cliente depois que o DNS propagar. Para automatizar depois, o próximo passo é integrar emissão SSL via acme.sh/Certbot quando o DNS estiver validado.
