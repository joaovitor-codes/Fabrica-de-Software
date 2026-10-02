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
import { ReceitaController } from './receita.controller';
import { ReceitaService } from './receita.service';
import { AuthGuard } from '../../../auth/auth.guard';
import { OptionalAuthGuard } from '../../../auth/optional-auth.guard';

class FakeAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const id = randomUUID();
    req.user = { id, sub: id, tipoUsuario: TipoUsuario.comum };
    return true;
  }
}

/** Só a validação do body: o service é falso e só registra a chamada. */
describe('Receita - validação do body (integration)', () => {
  let app: INestApplication;
  const create = jest.fn(async () => ({ success: 'ok' }));
  const update = jest.fn(async () => ({ success: 'ok' }));

  const ingrediente = {
    ingredienteId: randomUUID(),
    quantidade: 200,
    unidadeMedidaId: randomUUID(),
  };
  const valida = { nome: 'Arroz', ingredientes: [ingrediente] };
  const receitaId = randomUUID();

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [ReceitaController],
      providers: [{ provide: ReceitaService, useValue: { create, update } }],
    })
      .overrideGuard(AuthGuard)
      .useClass(FakeAuthGuard)
      .overrideGuard(OptionalAuthGuard)
      .useClass(FakeAuthGuard)
      .compile();

    app = moduleRef.createNestApplication();
    // Mesmo pipe do main.ts.
    app.useGlobalPipes(new ValidationPipe());
    await app.init();
  });

  beforeEach(() => {
    create.mockClear();
    update.mockClear();
  });

  afterAll(async () => {
    await app.close();
  });

  const post = (body: unknown) =>
    request(app.getHttpServer())
      .post('/api/receita')
      .send(body as object);

  it('cria só com nome e ingredientes: versaoAtual não é mais exigido', async () => {
    await post(valida).expect(201);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['sem ingredientes', { nome: 'Arroz', ingredientes: [] }],
    ['sem nome', { ingredientes: [ingrediente] }],
    [
      'quantidade em texto',
      { nome: 'Arroz', ingredientes: [{ ...ingrediente, quantidade: '200' }] },
    ],
    [
      'quantidade zero',
      { nome: 'Arroz', ingredientes: [{ ...ingrediente, quantidade: 0 }] },
    ],
    [
      'ingrediente sem id',
      {
        nome: 'Arroz',
        ingredientes: [
          { quantidade: 1, unidadeMedidaId: ingrediente.unidadeMedidaId },
        ],
      },
    ],
    ['porções zero', { ...valida, porcoes: 0 }],
    ['dificuldade inválida', { ...valida, nivelDificuldade: 'impossivel' }],
  ])('rejeita %s (400)', async (_caso, body) => {
    await post(body).expect(400);
    expect(create).not.toHaveBeenCalled();
  });

  it('edição aceita body parcial, mas não lista de ingredientes vazia', async () => {
    await request(app.getHttpServer())
      .patch(`/api/receita/${receitaId}`)
      .send({ nome: 'Arroz soltinho' })
      .expect(200);

    const res = await request(app.getHttpServer())
      .patch(`/api/receita/${receitaId}`)
      .send({ ingredientes: [] })
      .expect(400);
    expect(JSON.stringify(res.body.message)).toContain(
      'pelo menos um ingrediente',
    );
  });
});
