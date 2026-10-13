/// <reference types="jest" />

import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { TipoUsuario } from '@prisma/client';
import { CategoriaController } from './categoria.controller';
import { CategoriaService } from './categoria.service';
import { AuthGuard } from '../../../auth/auth.guard';

/** Autentica com o tipo de usuário enviado no header `x-tipo` (padrão: comum). */
class FakeAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const id = randomUUID();
    req.user = {
      id,
      sub: id,
      tipoUsuario: req.headers['x-tipo'] ?? TipoUsuario.comum,
    };
    return true;
  }
}

/** Rotas, permissões e validação do body: o service é falso. */
describe('CategoriaController (integration)', () => {
  let app: INestApplication;
  const service = {
    create: jest.fn(async () => ({ success: 'ok' })),
    findAllAtivos: jest.fn(async () => []),
    findAllDesativados: jest.fn(async () => []),
    findOne: jest.fn(async () => ({})),
    update: jest.fn(async () => ({})),
    restaurar: jest.fn(async () => ({})),
    remove: jest.fn(async () => undefined),
  };
  const id = randomUUID();
  const base = '/api/marketplace/categorias';

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [CategoriaController],
      providers: [{ provide: CategoriaService, useValue: service }],
    })
      .overrideGuard(AuthGuard)
      .useClass(FakeAuthGuard)
      .compile();

    app = moduleRef.createNestApplication();
    // Mesmo pipe do main.ts.
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();
  });

  beforeEach(() => {
    Object.values(service).forEach((fn) => fn.mockClear());
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const admin = { 'x-tipo': TipoUsuario.admin };

  describe('qualquer usuário autenticado', () => {
    it('lista as categorias ativas', async () => {
      await http().get(base).expect(200);
      expect(service.findAllAtivos).toHaveBeenCalledTimes(1);
    });

    it('busca uma categoria pelo id', async () => {
      await http().get(`${base}/${id}`).expect(200);
      expect(service.findOne).toHaveBeenCalledWith(id);
    });

    it('recusa id que não é UUID', async () => {
      await http().get(`${base}/abc`).expect(400);
      expect(service.findOne).not.toHaveBeenCalled();
    });
  });

  describe('só admin', () => {
    it.each([
      ['POST', () => http().post(base).send({ codigo: 'alimentos', nome: 'Alimentos' })],
      ['GET desativadas', () => http().get(`${base}/desativadas`)],
      ['PATCH', () => http().patch(`${base}/${id}`).send({ nome: 'X' })],
      ['PATCH restaurar', () => http().patch(`${base}/${id}/restaurar`)],
      ['DELETE', () => http().delete(`${base}/${id}`)],
    ])('%s retorna 403 para usuário comum', async (_, chamada) => {
      await chamada().expect(403);
    });

    it('cria a categoria', async () => {
      await http().post(base).set(admin).send({ codigo: 'alimentos', nome: 'Alimentos' }).expect(201);
      expect(service.create).toHaveBeenCalledWith({ codigo: 'alimentos', nome: 'Alimentos' });
    });

    it('lista as desativadas (não confunde com :id)', async () => {
      await http().get(`${base}/desativadas`).set(admin).expect(200);
      expect(service.findAllDesativados).toHaveBeenCalledTimes(1);
      expect(service.findOne).not.toHaveBeenCalled();
    });

    it('atualiza só o campo enviado', async () => {
      await http().patch(`${base}/${id}`).set(admin).send({ nome: 'Comidas' }).expect(200);
      expect(service.update).toHaveBeenCalledWith(id, { nome: 'Comidas' });
    });

    it('restaura e desativa', async () => {
      await http().patch(`${base}/${id}/restaurar`).set(admin).expect(200);
      expect(service.restaurar).toHaveBeenCalledWith(id);

      await http().delete(`${base}/${id}`).set(admin).expect(200);
      expect(service.remove).toHaveBeenCalledWith(id);
    });
  });

  describe('validação do body', () => {
    it.each([
      ['codigo fora do padrão', { codigo: 'CAT001', nome: 'Alimentos' }],
      ['sem nome', { codigo: 'alimentos' }],
      ['campo extra', { codigo: 'alimentos', nome: 'Alimentos', ativo: false }],
    ])('POST recusa %s', async (_, body) => {
      await http().post(base).set(admin).send(body).expect(400);
      expect(service.create).not.toHaveBeenCalled();
    });

    it.each([
      ['nome null', { nome: null }],
      ['nome vazio', { nome: '' }],
      ['codigo null', { codigo: null }],
      ['campo extra', { ativo: false }],
    ])('PATCH recusa %s', async (_, body) => {
      await http().patch(`${base}/${id}`).set(admin).send(body).expect(400);
      expect(service.update).not.toHaveBeenCalled();
    });
  });
});
