import 'dotenv/config';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NextFunction, Request, Response, json, static as serveStatic, urlencoded } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { frontendOrigins, publishedSitesDirectory } from './config/local-config';
import { PublicationService } from './publications/publication.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: false, bodyParser: false });
  const publicationService = app.get(PublicationService);

  app.use(async (request: Request, response: Response, next: NextFunction) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') return next();
    if (request.path.startsWith('/api') || request.path.startsWith('/p')) return next();
    if (['127.0.0.1', 'localhost'].includes(request.hostname)) return next();

    const publication = await publicationService.findByDomain(request.hostname);
    if (!publication) return next();

    const html = await publicationService.readPublishedIndex(publication);
    if (!html) return next();

    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.setHeader('Cache-Control', 'public, max-age=60');
    if (request.method === 'HEAD') return response.status(200).end();
    return response.status(200).send(html);
  });
  app.use('/p', serveStatic(publishedSitesDirectory, { extensions: ['html'], index: 'index.html' }));
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(json({ limit: '5mb', strict: true }));
  app.use(urlencoded({ extended: false, limit: '1mb' }));
  app.enableCors({
    origin(origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) {
      if (!origin || frontendOrigins.includes(origin)) callback(null, true);
      else callback(new Error('Origem não permitida pelo CORS.'));
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
  });
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true
  }));
  app.setGlobalPrefix('api');
  app.getHttpAdapter().getInstance().set('json spaces', 0);
  await publicationService.ensureTrackingForAllPublications();
  await app.listen(Number(process.env.PORT || 3000), '127.0.0.1');
}

bootstrap();
