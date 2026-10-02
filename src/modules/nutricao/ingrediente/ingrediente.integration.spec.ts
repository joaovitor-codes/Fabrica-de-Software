/// <reference types="jest" />

import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { Prisma, TipoUsuario } from '@prisma/client';
import { IngredienteController } from './ingrediente.controller';
import { IngredienteService } from './ingrediente.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RegraNutricionalService } from '../ingrediente-restricao/regra-nutricional.service';
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

class FakePrismaService {
  ingredientes: any[] = [];
  usados = new Set<string>();

  ingrediente = {
    findUnique: async ({ where }: any) =>
      this.ingredientes.find((i) => i.id === where.id) ?? null,
    update: async ({ where, data }: any) => {
      const i = this.ingredientes.findIndex((x) => x.id === where.id);
      const definidos = Object.fromEntries(
        Object.entries(data).filter(([, v]) => v !== undefined),
      );
      this.ingredientes[i] = { ...this.ingredientes[i], ...definidos };
      return this.ingredientes[i];
    },
    delete: async ({ where }: any) => {
      if (this.usados.has(where.id)) {
        throw new Prisma.PrismaClientKnownRequestError('P2003', {
          code: 'P2003',
          clientVersion: 'test',
        });
      }
      this.ingredientes = this.ingredientes.filter((x) => x.id !== where.id);
    },
  };
}

describe('Ingrediente - edição e remoção (integration)', () => {
  let app: INestApplication;
  let prisma: FakePrismaService;
  const avaliarIngrediente = jest.fn().mockResolvedValue(undefined);

  const paciente = { id: randomUUID(), tipo: TipoUsuario.paciente };
  const comum = { id: randomUUID(), tipo: TipoUsuario.comum };
  const profissional = { id: randomUUID(), tipo: TipoUsuario.profissional };

  const como = (u: { id: string; tipo: TipoUsuario }) => ({
    'x-user-id': u.id,
    'x-user-tipo': u.tipo,
  });

  const revisadoEm = new Date('2026-10-01T00:00:00Z');
  const novo = (nome: string) => ({
    id: randomUUID(),
    nome,
    sodioMg: 39943,
    codigoFonteExterno: `TACO-4-${nome}`,
    restricoesRevisadasEm: revisadoEm,
  });

  let sal: any;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [IngredienteController],
      providers: [
        IngredienteService,
        { provide: PrismaService, useClass: FakePrismaService },
        { provide: RegraNutricionalService, useValue: { avaliarIngrediente } },
      ],
    })
      .overrideGuard(AuthGuard)
      .useClass(FakeAuthGuard)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe());
    await app.init();
    prisma = moduleRef.get(PrismaService);
  });

  beforeEach(() => {
    sal = novo('Sal, grosso');
    prisma.ingredientes = [sal];
    prisma.usados = new Set();
    avaliarIngrediente.mockClear();
  });

  afterAll(async () => {
    await app.close();
  });

  const atual = () => prisma.ingredientes.find((i) => i.id === sal.id);

  it('paciente e usuário comum não editam nem removem ingrediente', async () => {
    for (const usuario of [paciente, comum]) {
      await request(app.getHttpServer())
        .patch(`/api/ingrediente/${sal.id}`)
        .set(como(usuario))
        .send({ sodioMg: 0 })
        .expect(403);

      await request(app.getHttpServer())
        .delete(`/api/ingrediente/${sal.id}`)
        .set(como(usuario))
        .expect(403);
    }

    expect(atual().sodioMg).toBe(39943);
  });

  it('o body não marca o ingrediente como revisado nem troca o código da fonte', async () => {
    sal.restricoesRevisadasEm = null;

    await request(app.getHttpServer())
      .patch(`/api/ingrediente/${sal.id}`)
      .set(como(profissional))
      .send({
        sodioMg: 38000,
        restricoesRevisadasEm: '2026-10-02T00:00:00Z',
        codigoFonteExterno: 'OUTRO',
      })
      .expect(200);

    expect(atual()).toMatchObject({
      sodioMg: 38000,
      restricoesRevisadasEm: null,
      codigoFonteExterno: 'TACO-4-Sal, grosso',
    });
  });

  it('mudar nutriente mantém a revisão e reavalia as regras nutricionais', async () => {
    await request(app.getHttpServer())
      .patch(`/api/ingrediente/${sal.id}`)
      .set(como(profissional))
      .send({ sodioMg: 38000 })
      .expect(200);

    expect(atual().restricoesRevisadasEm).toEqual(revisadoEm);
    expect(avaliarIngrediente).toHaveBeenCalledWith(sal.id);
  });

  it('mudar o nome devolve o ingrediente para a curadoria', async () => {
    await request(app.getHttpServer())
      .patch(`/api/ingrediente/${sal.id}`)
      .set(como(profissional))
      .send({ nome: 'Queijo, minas' })
      .expect(200);

    expect(atual().restricoesRevisadasEm).toBeNull();
  });

  it('reenviar o mesmo nome não desfaz a revisão', async () => {
    await request(app.getHttpServer())
      .patch(`/api/ingrediente/${sal.id}`)
      .set(como(profissional))
      .send({ nome: 'Sal, grosso', sodioMg: 38000 })
      .expect(200);

    expect(atual().restricoesRevisadasEm).toEqual(revisadoEm);
  });

  it('remover ingrediente em uso responde 409, não 500', async () => {
    prisma.usados.add(sal.id);

    await request(app.getHttpServer())
      .delete(`/api/ingrediente/${sal.id}`)
      .set(como(profissional))
      .expect(409);

    expect(atual()).toBeDefined();
  });

  it('profissional remove ingrediente que não está em uso', async () => {
    await request(app.getHttpServer())
      .delete(`/api/ingrediente/${sal.id}`)
      .set(como(profissional))
      .expect(200);

    expect(atual()).toBeUndefined();
  });
});
