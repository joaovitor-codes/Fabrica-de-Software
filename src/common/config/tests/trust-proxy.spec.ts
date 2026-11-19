import { Controller, Get, Post, Req } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Request } from 'express';
import request from 'supertest';
import { ThrottlerConfigModule } from '../../throttler/throttler.module';
import { envValidationSchema } from '../env.validation';
import { configurarTrustProxy } from '../trust-proxy';

@Controller('teste')
class TesteController {
  @Get('ip')
  ip(@Req() req: Request) {
    return { ip: req.ip };
  }

  @Post('escrita')
  escrita() {
    return { ok: true };
  }
}

const LIMITE_ESCRITA = 30;

async function criarApp(saltos: number) {
  const moduleRef = await Test.createTestingModule({
    imports: [ThrottlerConfigModule],
    controllers: [TesteController],
  }).compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configurarTrustProxy(app, saltos);
  await app.init();
  return app;
}

async function esgotarEscrita(app: NestExpressApplication, ip: string) {
  for (let i = 0; i < LIMITE_ESCRITA; i++) {
    await request(app.getHttpServer())
      .post('/teste/escrita')
      .set('X-Forwarded-For', ip)
      .expect(201);
  }
}

describe('configurarTrustProxy', () => {
  let app: NestExpressApplication;

  afterEach(async () => {
    await app.close();
  });

  describe('atrás de um proxy (TRUST_PROXY=1)', () => {
    beforeEach(async () => {
      app = await criarApp(1);
    });

    it('usa o IP do cliente informado pelo proxy', async () => {
      const resposta = await request(app.getHttpServer())
        .get('/teste/ip')
        .set('X-Forwarded-For', '203.0.113.7')
        .expect(200);

      expect(resposta.body.ip).toBe('203.0.113.7');
    });

    it('limita cada cliente separadamente', async () => {
      await esgotarEscrita(app, '203.0.113.7');

      await request(app.getHttpServer())
        .post('/teste/escrita')
        .set('X-Forwarded-For', '203.0.113.7')
        .expect(429);

      await request(app.getHttpServer())
        .post('/teste/escrita')
        .set('X-Forwarded-For', '198.51.100.9')
        .expect(201);
    });

    it('não deixa o cliente forjar o IP com um X-Forwarded-For próprio', async () => {
      // O cliente manda um IP falso; o proxy acrescenta o IP real no fim.
      const resposta = await request(app.getHttpServer())
        .get('/teste/ip')
        .set('X-Forwarded-For', '1.2.3.4, 203.0.113.7')
        .expect(200);

      expect(resposta.body.ip).toBe('203.0.113.7');
    });
  });

  describe('sem proxy (TRUST_PROXY=0)', () => {
    beforeEach(async () => {
      app = await criarApp(0);
    });

    it('ignora o X-Forwarded-For', async () => {
      const resposta = await request(app.getHttpServer())
        .get('/teste/ip')
        .set('X-Forwarded-For', '203.0.113.7')
        .expect(200);

      expect(resposta.body.ip).not.toBe('203.0.113.7');
    });

    it('trocar o X-Forwarded-For não escapa do limite', async () => {
      await esgotarEscrita(app, '203.0.113.7');

      await request(app.getHttpServer())
        .post('/teste/escrita')
        .set('X-Forwarded-For', '198.51.100.9')
        .expect(429);
    });
  });
});

describe('TRUST_PROXY no envValidationSchema', () => {
  const base = {
    DATABASE_URL: 'postgresql://x',
    JWT_SECRET: 'a'.repeat(32),
    SMTP_HOST: 'smtp',
    SMTP_USER: 'u',
    SMTP_PASS: 'p',
    SMTP_FROM: 'f',
  };

  it('vale 0 quando não definido', () => {
    const { value, error } = envValidationSchema.validate(base);
    expect(error).toBeUndefined();
    expect(value.TRUST_PROXY).toBe(0);
  });

  it.each(['true', '-1', '1.5'])('recusa %s', (valor) => {
    const { error } = envValidationSchema.validate({
      ...base,
      TRUST_PROXY: valor,
    });
    expect(error).toBeDefined();
  });
});
