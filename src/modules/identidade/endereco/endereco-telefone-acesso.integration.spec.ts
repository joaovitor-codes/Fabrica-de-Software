/// <reference types="jest" />

import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  UnauthorizedException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { TipoUsuario } from '@prisma/client';
import { EnderecoController } from './endereco.controller';
import { EnderecoService } from './endereco.service';
import { TelefoneController } from '../telefone/telefone.controller';
import { TelefoneService } from '../telefone/telefone.service';
import { AuthGuard } from '../../../auth/auth.guard';

/** Substitui o AuthGuard real (JWT + banco) por headers; RolesGuard segue real. */
class FakeAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const id = req.headers['x-user-id'];
    const tipoUsuario = req.headers['x-user-tipo'];
    if (!id || !tipoUsuario) throw new UnauthorizedException();
    req.user = { id, sub: id, tipoUsuario };
    return true;
  }
}

const serviceFake = () => ({
  findAll: async () => ({ data: [], total: 0 }),
  findOne: async (id: string) => ({ id }),
  create: async () => ({}),
  update: async () => ({}),
  remove: async () => ({}),
});

describe('Endereço e telefone - rotas genéricas só para admin (integration)', () => {
  let app: INestApplication;

  const como = (tipo: TipoUsuario) => ({
    'x-user-id': randomUUID(),
    'x-user-tipo': tipo,
  });

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [EnderecoController, TelefoneController],
      providers: [
        { provide: EnderecoService, useValue: serviceFake() },
        { provide: TelefoneService, useValue: serviceFake() },
      ],
    })
      .overrideGuard(AuthGuard)
      .useClass(FakeAuthGuard)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const rotas = (base: string) => {
    const id = randomUUID();
    return [
      ['get', `${base}/page/1/limit/10`],
      ['get', `${base}/${id}`],
      ['post', base],
      ['patch', `${base}/${id}`],
      ['delete', `${base}/${id}`],
    ] as const;
  };

  describe.each(['/api/endereco', '/api/telefone'])('%s', (base) => {
    it.each(rotas(base))('%s %s exige login', async (metodo, url) => {
      await request(app.getHttpServer())[metodo](url).expect(401);
    });

    it.each(rotas(base))(
      '%s %s rejeita usuário que não é admin',
      async (metodo, url) => {
        await request(app.getHttpServer())
          [metodo](url)
          .set(como(TipoUsuario.profissional))
          .expect(403);
      },
    );

    it('permite que o admin liste', async () => {
      await request(app.getHttpServer())
        .get(`${base}/page/1/limit/10`)
        .set(como(TipoUsuario.admin))
        .expect(200);
    });
  });
});
