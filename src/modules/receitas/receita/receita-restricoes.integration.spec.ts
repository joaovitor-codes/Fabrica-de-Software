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
import {
  Gravidade,
  NivelDificuldade,
  StatusReceita,
  TipoRestricao,
  TipoUsuario,
} from '@prisma/client';
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

/**
 * Avalia o subconjunto de `where` do Prisma usado pelas rotas de leitura,
 * incluindo os filtros de relação (`every`/`none`) do filtro de restrições.
 */
const atende = (r: any, where: any = {}): boolean =>
  Object.entries(where).every(([campo, cond]: [string, any]) => {
    if (campo === 'OR') return cond.some((w: any) => atende(r, w));
    const valor = r[campo];
    if (cond && typeof cond === 'object') {
      if ('contains' in cond) {
        return valor.toLowerCase().includes(cond.contains.toLowerCase());
      }
      if ('every' in cond)
        return valor.every((i: any) => atende(i, cond.every));
      if ('none' in cond) return !valor.some((i: any) => atende(i, cond.none));
      if ('in' in cond) return cond.in.includes(valor);
      if ('not' in cond) return valor !== cond.not;
      return atende(valor, cond);
    }
    return valor === cond;
  });

class FakePrismaService {
  receitas: any[] = [];
  pacienteRestricoes: any[] = [];

  receita = {
    findMany: async ({ where }: any) =>
      this.receitas.filter((r) => atende(r, where)),
    findFirst: async ({ where }: any) =>
      this.receitas.find((r) => atende(r, where)) ?? null,
  };

  pacienteRestricao = {
    findMany: async ({ where }: any) =>
      this.pacienteRestricoes.filter((r) => atende(r, where)),
  };
}

describe('Receita - filtro por restrições do paciente (integration)', () => {
  let app: INestApplication;
  let prisma: FakePrismaService;

  const leite = randomUUID();
  const gluten = randomUUID();

  const alergico = { id: randomUUID(), tipo: TipoUsuario.paciente };
  const intolerante = { id: randomUUID(), tipo: TipoUsuario.paciente };
  const intoleranteGrave = { id: randomUUID(), tipo: TipoUsuario.paciente };
  const semRestricao = { id: randomUUID(), tipo: TipoUsuario.paciente };
  const profissional = { id: randomUUID(), tipo: TipoUsuario.profissional };
  const autor = { id: randomUUID(), tipo: TipoUsuario.comum };

  const como = (u: { id: string; tipo: TipoUsuario }) => ({
    'x-user-id': u.id,
    'x-user-tipo': u.tipo,
  });

  const ingrediente = (restricoes: string[], revisado = true) => ({
    ingrediente: {
      restricoesRevisadasEm: revisado ? new Date() : null,
      restricoes: restricoes.map((restricaoId) => ({ restricaoId })),
    },
  });

  const nova = (
    nome: string,
    ingredientes: any[],
    extra: Partial<Record<string, unknown>> = {},
  ) => ({
    id: randomUUID(),
    nome,
    status: StatusReceita.aprovada,
    nivelDificuldade: NivelDificuldade.facil,
    criadoPor: autor.id,
    createdAt: new Date(),
    deletedAt: null,
    ingredientes,
    ...extra,
  });

  const comLeite = nova('Bolo de leite', [
    ingrediente([]),
    ingrediente([leite]),
  ]);
  const segura = nova('Bolo de banana', [
    ingrediente([]),
    ingrediente([gluten]),
  ]);
  const naoRevisada = nova('Bolo de queijo caseiro', [
    ingrediente([]),
    ingrediente([], false),
  ]);
  const propriaComLeite = nova('Pudim do alérgico', [ingrediente([leite])], {
    status: StatusReceita.pendente,
    criadoPor: alergico.id,
  });

  const restricaoDe = (
    usuarioId: string,
    restricaoId: string,
    tipo: TipoRestricao,
    gravidade: Gravidade,
  ) => ({
    restricaoId,
    gravidade,
    paciente: { usuarioId },
    restricao: { tipo },
  });

  const ids = (body: any[]) => body.map((r) => r.id).sort();
  const todasAprovadas = [comLeite.id, segura.id, naoRevisada.id].sort();

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
    prisma.receitas.push(comLeite, segura, naoRevisada, propriaComLeite);
    prisma.pacienteRestricoes.push(
      restricaoDe(alergico.id, leite, TipoRestricao.alergia, Gravidade.leve),
      restricaoDe(
        intolerante.id,
        leite,
        TipoRestricao.intolerancia,
        Gravidade.moderada,
      ),
      restricaoDe(
        intoleranteGrave.id,
        leite,
        TipoRestricao.intolerancia,
        Gravidade.grave,
      ),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  describe('paciente com alergia', () => {
    it('não vê receita com o alérgeno nem com ingrediente não revisado', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/receita/all')
        .set(como(alergico))
        .expect(200);

      expect(ids(res.body)).toEqual([segura.id, propriaComLeite.id].sort());
    });

    it('recebe 404 ao abrir a receita com o alérgeno pelo id', async () => {
      await request(app.getHttpServer())
        .get(`/api/receita/${comLeite.id}`)
        .set(como(alergico))
        .expect(404);

      await request(app.getHttpServer())
        .get(`/api/receita/${segura.id}`)
        .set(como(alergico))
        .expect(200);
    });

    it('o filtro vale também na busca por nome, validadas e sugestões', async () => {
      const porNome = await request(app.getHttpServer())
        .get('/api/receita/nome?q=bolo')
        .set(como(alergico))
        .expect(200);
      expect(ids(porNome.body)).toEqual([segura.id]);

      const validadas = await request(app.getHttpServer())
        .get('/api/receita/validadas')
        .set(como(alergico))
        .expect(200);
      expect(ids(validadas.body)).toEqual([segura.id]);

      const sugestoes = await request(app.getHttpServer())
        .get('/api/receita/sugestoes')
        .set(como(alergico))
        .expect(200);
      expect(ids(sugestoes.body)).toEqual([segura.id]);
    });

    it('continua vendo a própria receita, mesmo com o alérgeno', async () => {
      await request(app.getHttpServer())
        .get(`/api/receita/${propriaComLeite.id}`)
        .set(como(alergico))
        .expect(200);
    });
  });

  describe('paciente com intolerância', () => {
    it('moderada não esconde nada', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/receita/validadas')
        .set(como(intolerante))
        .expect(200);

      expect(ids(res.body)).toEqual(todasAprovadas);
    });

    it('grave é tratada como estrita', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/receita/validadas')
        .set(como(intoleranteGrave))
        .expect(200);

      expect(ids(res.body)).toEqual([segura.id]);
    });
  });

  describe('sem filtro de restrição', () => {
    it('paciente sem restrições vê todas as aprovadas', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/receita/validadas')
        .set(como(semRestricao))
        .expect(200);

      expect(ids(res.body)).toEqual(todasAprovadas);
    });

    it('visitante vê todas as aprovadas', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/receita/validadas')
        .expect(200);

      expect(ids(res.body)).toEqual(todasAprovadas);
    });

    it('profissional vê todas (curadoria)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/receita/all')
        .set(como(profissional))
        .expect(200);

      expect(ids(res.body)).toEqual(
        [...todasAprovadas, propriaComLeite.id].sort(),
      );
    });
  });
});
