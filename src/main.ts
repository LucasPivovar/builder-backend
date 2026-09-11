import 'dotenv/config';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NextFunction, Request, Response, json, static as serveStatic, urlencoded } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { frontendOrigins, hostedAssetsDirectory, hostedVideosDirectory, publishedSitesDirectory } from './config/local-config';
import { PublicationService } from './publications/publication.service';
import { randomUUID } from 'crypto';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

const publishedCsp = "default-src 'self'; script-src 'self' 'unsafe-inline' https:; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: blob: https:; media-src 'self' blob: https:; frame-src https:; connect-src 'self' https:; font-src 'self' data: https:; object-src 'none'; base-uri 'self'; form-action 'self' https:; frame-ancestors 'self'";
function setPublishedHeaders(response: Response){response.setHeader('Content-Security-Policy',publishedCsp);response.setHeader('Referrer-Policy','strict-origin-when-cross-origin');response.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');response.setHeader('X-Content-Type-Options','nosniff');}

function isReservedPath(pathname: string) {
  return pathname === '/api' || pathname.startsWith('/api/')
    || pathname === '/p' || pathname.startsWith('/p/');
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: false, bodyParser: false });
  const publicationService = app.get(PublicationService);

  app.use((request:Request,response:Response,next:NextFunction)=>{const supplied=String(request.headers['x-request-id']||'');const requestId=/^[a-zA-Z0-9_-]{8,80}$/.test(supplied)?supplied:randomUUID();const started=Date.now();response.setHeader('X-Request-Id',requestId);response.on('finish',()=>{if(process.env.STRUCTURED_LOGS!=='false')console.log(JSON.stringify({level:'info',requestId,method:request.method,path:request.originalUrl,status:response.statusCode,durationMs:Date.now()-started}));});next();});

  app.use(async (request: Request, response: Response, next: NextFunction) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') return next();
    if (isReservedPath(request.path)) return next();
    if (['127.0.0.1', 'localhost'].includes(request.hostname)) return next();

    const publication = await publicationService.findByDomain(request.hostname, request.path);
    if (!publication) return next();

    const html = await publicationService.readPublishedIndex(publication);
    if (!html) return next();

    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.setHeader('Cache-Control', 'public, max-age=60');
    setPublishedHeaders(response);
    if (request.method === 'HEAD') return response.status(200).end();
    return response.status(200).send(html);
  });
  app.use('/p', serveStatic(publishedSitesDirectory, { extensions: ['html'], index: 'index.html', setHeaders(response){setPublishedHeaders(response);} }));
  app.use('/media/videos', serveStatic(hostedVideosDirectory, {
    fallthrough: false,
    immutable: true,
    maxAge: '30d',
    setHeaders(response) {
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    }
  }));
  app.use('/media/assets', serveStatic(hostedAssetsDirectory, { fallthrough: false, immutable: true, maxAge: '30d', setHeaders(response) { response.setHeader('X-Content-Type-Options', 'nosniff'); response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin'); } }));
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(json({ limit: '5mb', strict: true }));
  app.use(urlencoded({ extended: false, limit: '1mb' }));
  app.enableCors((request: Request, done: (error: Error | null, options: any) => void) => done(null, {
    origin(origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) {
      const publicSubmission = ['/api/analytics/popup-submissions', '/api/analytics/events'].includes(request.path) &&
        (request.method === 'POST' || (request.method === 'OPTIONS' && request.headers['access-control-request-method'] === 'POST'));
      const isLocalhost = origin ? /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) : true;
      if (publicSubmission || !origin || isLocalhost || frontendOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(null, false);
      }
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id']
  }));
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true
  }));
  app.setGlobalPrefix('api');
  if (process.env.ENABLE_API_DOCS === 'true' || process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder().setTitle('Astro Builder API').setDescription('Contrato HTTP do backend do Astro Builder.').setVersion('1.0').addBearerAuth().build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, config), { jsonDocumentUrl:'api/docs/openapi.json' });
  }
  app.getHttpAdapter().getInstance().set('json spaces', 0);
  await publicationService.ensureTrackingForAllPublications().catch((error) => {
    console.error('[bootstrap] falha ao preparar o rastreamento das publicacoes:', error?.message || error);
  });
  await app.listen(Number(process.env.PORT || 3000), process.env.HOST || '127.0.0.1');
}

bootstrap();
