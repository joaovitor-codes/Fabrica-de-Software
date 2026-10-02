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
import { UnidadeMedidaController } from './unidade-medida.controller';
import { UnidadeMedidaService } from './unidade-medida.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
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
  unidades: any[] = [];
  receitaIngredientes: any[] = [];

  unidadeMedida = {
    findUnique: async ({ where }: any) =>
      this.unidades.find((u) => u.id === where.id) ?? null,
    delete: async ({ where }: any) => {
      // FK RESTRICT de receita_ingredientes.unidade_medida_id.
      if (
        this.receitaIngredientes.some((r) => r.unidadeMedidaId === where.id)
      ) {
        throw new Prisma.PrismaClientKnownRequestError('P2003', {
          code: 'P2003',
          clientVersion: 'test',
        });
      }
      this.unidades = this.unidades.filter((u) => u.id !== where.id);
    },
  };

  receitaIngrediente = {
    deleteMany: async ({ where }: any) => {
      this.receitaIngredientes = this.receitaIngredientes.filter(
        (r) => r.unidadeMedidaId !== where.unidadeMedidaId,
      );
    },
  };
}

describe('UnidadeMedida - alteração e remoção (integration)', () => {
  let app: INestApplication;
  let prisma: FakePrismaService;

  const admin = { id: randomUUID(), tipo: TipoUsuario.admin };
  const comum = { id: randomUUID(), tipo: TipoUsuario.comum };
  const profissional = { id: randomUUID(), tipo: TipoUsuario.profissional };

  const como = (u: { id: string; tipo: TipoUsuario }) => ({
    'x-user-id': u.id,
    'x-user-tipo': u.tipo,
  });

  const grama = { id: randomUUID(), codigo: 'g', nome: 'Grama', ativo: true };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [UnidadeMedidaController],
      providers: [
        UnidadeMedidaService,
        { provide: PrismaService, useClass: FakePrismaService },
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
    prisma.unidades = [{ ...grama }];
    prisma.receitaIngredientes = [
      {
        receitaId: 'bolo',
        ingredienteId: 'farinha',
        unidadeMedidaId: grama.id,
      },
    ];
  });

  afterAll(async () => {
    await app.close();
  });

  it('só admin cria, altera ou remove unidade', async () => {
    for (const usuario of [comum, profissional]) {
      await request(app.getHttpServer())
        .post('/api/unidade-medida')
        .set(como(usuario))
        .send({ codigo: 'xic', nome: 'Xícara' })
        .expect(403);

      await request(app.getHttpServer())
        .patch(`/api/unidade-medida/${grama.id}`)
        .set(como(usuario))
        .send({ nome: 'Outro' })
        .expect(403);

      await request(app.getHttpServer())
        .delete(`/api/unidade-medida/${grama.id}`)
        .set(como(usuario))
        .expect(403);
    }
  });

  it('unidade em uso não é removida e as receitas mantêm os ingredientes', async () => {
    await request(app.getHttpServer())
      .delete(`/api/unidade-medida/${grama.id}`)
      .set(como(admin))
      .expect(409);

    expect(prisma.receitaIngredientes).toHaveLength(1);
    expect(prisma.unidades).toHaveLength(1);
  });

  it('admin remove unidade que não está em uso', async () => {
    prisma.receitaIngredientes = [];

    await request(app.getHttpServer())
      .delete(`/api/unidade-medida/${grama.id}`)
      .set(como(admin))
      .expect(200);

    expect(prisma.unidades).toHaveLength(0);
  });
});
