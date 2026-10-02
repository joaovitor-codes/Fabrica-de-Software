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
import { StatusReceita, TipoUsuario } from '@prisma/client';
import { ReceitaController } from './receita.controller';
import { ReceitaService } from './receita.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { CacheService } from '../../../common/cache/cache.service';
import { UsuarioService } from '../../identidade/usuario/usuario.service';
import { PontosTransacaoService } from '../pontos-transacao/pontos-transacao.service';
import { AuthGuard } from '../../../auth/auth.guard';
import { OptionalAuthGuard } from '../../../auth/optional-auth.guard';

const usuarioDosHeaders = (req: any) => {
  const id = req.headers['x-user-id'];
  const tipoUsuario = req.headers['x-user-tipo'];
  return id && tipoUsuario ? { id, sub: id, tipoUsuario } : undefined;
};

/** Substitui o AuthGuard real (JWT + banco) por headers; RolesGuard segue real. */
class FakeAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    req.user = usuarioDosHeaders(req);
    if (!req.user) throw new UnauthorizedException();
    return true;
  }
}

class FakeOptionalAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    req.user = usuarioDosHeaders(req);
    return true;
  }
}

/** Avalia o subconjunto de `where` do Prisma usado pelas rotas de leitura. */
const atende = (r: any, where: any = {}): boolean =>
  Object.entries(where).every(([campo, cond]: [string, any]) => {
    if (campo === 'OR') return cond.some((w: any) => atende(r, w));
    if (campo === 'AND') return cond.every((w: any) => atende(r, w));
    if (cond && typeof cond === 'object' && 'contains' in cond) {
      return r[campo].toLowerCase().includes(cond.contains.toLowerCase());
    }
    return r[campo] === cond;
  });

class FakePrismaService {
  receitas: any[] = [];

  receita = {
    findMany: async ({ where }: any) =>
      this.receitas.filter((r) => atende(r, where)),
    findFirst: async ({ where }: any) =>
      this.receitas.find((r) => atende(r, where)) ?? null,
  };
}

describe('Receita - visibilidade nas rotas públicas (integration)', () => {
  let app: INestApplication;
  let prisma: FakePrismaService;

  const autor = { id: randomUUID(), tipo: TipoUsuario.comum };
  const outroUsuario = { id: randomUUID(), tipo: TipoUsuario.comum };
  const profissional = { id: randomUUID(), tipo: TipoUsuario.profissional };

  const como = (u: { id: string; tipo: TipoUsuario }) => ({
    'x-user-id': u.id,
    'x-user-tipo': u.tipo,
  });

  const nova = (nome: string, status: StatusReceita) => ({
    id: randomUUID(),
    nome,
    status,
    criadoPor: autor.id,
    createdAt: new Date(),
    deletedAt: null,
  });
  const aprovada = nova('Bolo aprovado', StatusReceita.aprovada);
  const pendente = nova('Bolo pendente', StatusReceita.pendente);
  const rejeitada = nova('Bolo rejeitado', StatusReceita.rejeitada);

  const excluida = {
    ...nova('Bolo excluído', StatusReceita.aprovada),
    deletedAt: new Date(),
  };

  const ids = (body: any[]) => body.map((r) => r.id).sort();

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [ReceitaController],
      providers: [
        ReceitaService,
        { provide: PrismaService, useClass: FakePrismaService },
        {
          provide: CacheService,
          useValue: {
            get: async () => null,
            set: async () => {},
            del: async () => {},
          },
        },
        { provide: UsuarioService, useValue: {} },
        { provide: PontosTransacaoService, useValue: {} },
      ],
    })
      .overrideGuard(AuthGuard)
      .useClass(FakeAuthGuard)
      .overrideGuard(OptionalAuthGuard)
      .useClass(FakeOptionalAuthGuard)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();

    prisma = moduleRef.get(PrismaService);
    prisma.receitas.push(aprovada, pendente, rejeitada, excluida);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /api/receita/all', () => {
    it('visitante sem login vê só as aprovadas', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/receita/all')
        .expect(200);

      expect(ids(res.body)).toEqual([aprovada.id]);
    });

    it('autor logado vê as aprovadas e as próprias pendentes/rejeitadas', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/receita/all')
        .set(como(autor))
        .expect(200);

      expect(ids(res.body)).toEqual(
        [aprovada.id, pendente.id, rejeitada.id].sort(),
      );
    });

    it('outro usuário logado não vê pendentes de terceiros', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/receita/all')
        .set(como(outroUsuario))
        .expect(200);

      expect(ids(res.body)).toEqual([aprovada.id]);
    });

    it('profissional vê todas (curadoria), menos as excluídas', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/receita/all')
        .set(como(profissional))
        .expect(200);

      expect(ids(res.body)).toEqual(
        [aprovada.id, pendente.id, rejeitada.id].sort(),
      );
    });
  });

  describe('GET /api/receita/:id e sub-rotas', () => {
    it('visitante recebe 404 para receita pendente', async () => {
      await request(app.getHttpServer())
        .get(`/api/receita/${pendente.id}`)
        .expect(404);

      await request(app.getHttpServer())
        .get(`/api/receita/${pendente.id}/ingredientes`)
        .expect(404);

      await request(app.getHttpServer())
        .get(`/api/receita/${pendente.id}/alertas`)
        .expect(404);
    });

    it('receita excluída segue acessível pelo id (planos que a usam)', async () => {
      await request(app.getHttpServer())
        .get(`/api/receita/${excluida.id}`)
        .expect(200);
    });

    it('visitante vê receita aprovada', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/receita/${aprovada.id}`)
        .expect(200);

      expect(res.body.id).toBe(aprovada.id);
    });

    it('autor vê a própria receita pendente', async () => {
      await request(app.getHttpServer())
        .get(`/api/receita/${pendente.id}`)
        .set(como(autor))
        .expect(200);
    });
  });

  describe('GET /api/receita/nome', () => {
    it('visitante não encontra receita pendente pelo nome', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/receita/nome?q=bolo')
        .expect(200);

      expect(ids(res.body)).toEqual([aprovada.id]);
    });
  });

  describe('rotas fixas não são capturadas por :id', () => {
    it('GET /api/receita/validadas responde a lista, não 400 de UUID', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/receita/validadas')
        .expect(200);

      expect(ids(res.body)).toEqual([aprovada.id]);
    });
  });

  describe('GET /api/receita/pendentes', () => {
    it('exige login', async () => {
      await request(app.getHttpServer())
        .get('/api/receita/pendentes')
        .expect(401);
    });

    it('rejeita usuário comum', async () => {
      await request(app.getHttpServer())
        .get('/api/receita/pendentes')
        .set(como(autor))
        .expect(403);
    });

    it('lista só as pendentes para profissional', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/receita/pendentes')
        .set(como(profissional))
        .expect(200);

      expect(ids(res.body)).toEqual([pendente.id]);
    });
  });
});
