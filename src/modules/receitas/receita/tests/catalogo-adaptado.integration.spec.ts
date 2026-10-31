/// <reference types="jest" />

import {
  CanActivate,
  ExecutionContext,
  INestApplication,
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
import { IngredientesReceitaService } from './ingredientes-receita.service';
import { VisibilidadeReceitaService } from '../visibilidade/visibilidade-receita.service';
import { AdaptacaoCatalogoService } from '../adaptacao/adaptacao-catalogo.service';
import { AdaptacaoPacienteService } from '../adaptacao/adaptacao-paciente.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { CacheService } from '../../../common/cache/cache.service';
import { UsuarioService } from '../../identidade/usuario/usuario.service';
import { IaService } from '../../ia/ia.service';
import { AuthGuard } from '../../../auth/auth.guard';
import { OptionalAuthGuard } from '../../../auth/optional-auth.guard';

class UsuarioDosHeaders implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const id = req.headers['x-user-id'];
    const tipoUsuario = req.headers['x-user-tipo'];
    req.user = id ? { id, sub: id, tipoUsuario } : undefined;
    return true;
  }
}

/** Avalia o subconjunto de `where` do Prisma usado pelas consultas. */
const atende = (r: any, where: any = {}): boolean =>
  Object.entries(where).every(([campo, cond]: [string, any]) => {
    if (campo === 'OR') return cond.some((w: any) => atende(r, w));
    if (campo === 'AND') return cond.every((w: any) => atende(r, w));
    const valor = r[campo];
    if (cond && typeof cond === 'object') {
      if ('every' in cond)
        return valor.every((i: any) => atende(i, cond.every));
      if ('none' in cond) return !valor.some((i: any) => atende(i, cond.none));
      if ('in' in cond) return cond.in.includes(valor);
      if ('notIn' in cond) return !cond.notIn.includes(valor);
      if ('not' in cond) return valor !== cond.not;
      if ('gte' in cond) return valor !== null && valor >= cond.gte;
      if ('isEmpty' in cond) return (valor.length === 0) === cond.isEmpty;
      if ('is' in cond) {
        const v = valor ?? null;
        return cond.is === null ? v === null : v !== null && atende(v, cond.is);
      }
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
    findUnique: async ({ where }: any) =>
      this.receitas.find((r) => r.id === where.id) ?? null,
  };

  pacienteRestricao = {
    findMany: async ({ where }: any) =>
      this.pacienteRestricoes.filter((r) => atende(r, where)),
  };

  receitaIngrediente = {
    findMany: async ({ where }: any) =>
      this.receitas
        .filter((r) => where.receitaId.in.includes(r.id))
        .flatMap((r) =>
          r.ingredientes.map((i: any) => ({
            receitaId: r.id,
            ingrediente: i.ingrediente,
          })),
        ),
  };
}

describe('Catálogo que se adapta ao paciente (integration)', () => {
  let app: INestApplication;
  let prisma: FakePrismaService;
  const adaptar = jest.fn();

  const leite = randomUUID();
  const alergico = { id: randomUUID(), tipo: TipoUsuario.paciente };
  const intolerante = { id: randomUUID(), tipo: TipoUsuario.paciente };
  const semRestricao = { id: randomUUID(), tipo: TipoUsuario.paciente };
  const como = (u: { id: string; tipo: TipoUsuario }) => ({
    'x-user-id': u.id,
    'x-user-tipo': u.tipo,
  });

  const ingrediente = (restricoes: string[]) => ({
    ingrediente: {
      id: randomUUID(),
      nome: restricoes.length ? 'Leite' : 'Banana',
      restricoesRevisadasEm: new Date(),
      restricoes: restricoes.map((restricaoId) => ({ restricaoId })),
    },
  });
  const nova = (nome: string, ingredientes: any[], extra: any = {}) => ({
    id: randomUUID(),
    nome,
    status: StatusReceita.aprovada,
    nivelDificuldade: NivelDificuldade.facil,
    criadoPor: 'autor',
    deletedAt: null,
    ingredientesNaoListados: [],
    adaptacaoDe: null,
    ingredientes,
    ...extra,
  });

  const panqueca = nova('Panqueca', [ingrediente([leite])]);
  const panquecaAdaptada = nova('Panqueca (adaptada)', [ingrediente([])], {
    adaptacaoDe: {
      restricaoId: leite,
      pacienteId: null,
      receitaOrigemId: panqueca.id,
    },
  });
  const pudim = nova('Pudim', [ingrediente([leite])]);
  const pudimAdaptado = nova('Pudim (adaptado na hora)', [ingrediente([])]);
  const salada = nova('Salada', [ingrediente([])]);

  const restricaoDe = (usuarioId: string, gravidade: Gravidade) => ({
    restricaoId: leite,
    gravidade,
    paciente: { usuarioId },
    restricao: {
      nome: 'Leite',
      tipo: TipoRestricao.intolerancia,
      createdAt: new Date('2026-01-01'),
      regrasNutricionais: [],
    },
  });

  const ids = (body: any[]) => body.map((r) => r.id).sort();

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [ReceitaController],
      providers: [
        ReceitaService,
        VisibilidadeReceitaService,
        AdaptacaoCatalogoService,
        { provide: AdaptacaoPacienteService, useValue: { adaptar } },
        { provide: IngredientesReceitaService, useValue: {} },
        { provide: PrismaService, useClass: FakePrismaService },
        { provide: CacheService, useValue: { get: async () => null } },
        { provide: UsuarioService, useValue: {} },
        { provide: IaService, useValue: {} },
      ],
    })
      .overrideGuard(AuthGuard)
      .useClass(UsuarioDosHeaders)
      .overrideGuard(OptionalAuthGuard)
      .useClass(UsuarioDosHeaders)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
    prisma = moduleRef.get(PrismaService);
    prisma.receitas.push(panqueca, panquecaAdaptada, pudim, salada);
    prisma.pacienteRestricoes.push(
      restricaoDe(alergico.id, Gravidade.grave),
      restricaoDe(intolerante.id, Gravidade.moderada),
    );
  });

  beforeEach(() => adaptar.mockReset());

  afterAll(async () => {
    await app.close();
  });

  describe('listagem (só adaptações que já existem; não chama a IA)', () => {
    it('restrição estrita: a original escondida volta pela adaptada', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/receita/validadas')
        .set(como(alergico))
        .expect(200);

      expect(ids(res.body)).toEqual([panquecaAdaptada.id, salada.id].sort());
      const adaptada = res.body.find((r: any) => r.id === panquecaAdaptada.id);
      expect(adaptada.adaptadaDe).toEqual({
        id: panqueca.id,
        nome: 'Panqueca',
      });
      expect(adaptar).not.toHaveBeenCalled();
    });

    it('restrição leve/moderada: a original com aviso dá lugar à adaptada', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/receita/validadas')
        .set(como(intolerante))
        .expect(200);

      // O pudim não tem adaptação: continua, com o aviso.
      expect(ids(res.body)).toEqual(
        [panquecaAdaptada.id, pudim.id, salada.id].sort(),
      );
      const doPudim = res.body.find((r: any) => r.id === pudim.id);
      expect(doPudim.restricoesVioladas).toHaveLength(1);
    });

    it('sem restrição, a lista não muda', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/receita/validadas')
        .set(como(semRestricao))
        .expect(200);

      expect(ids(res.body)).toEqual(
        [panqueca.id, panquecaAdaptada.id, pudim.id, salada.id].sort(),
      );
      expect(res.body.some((r: any) => 'adaptadaDe' in r)).toBe(false);
    });
  });

  describe('abrir a receita', () => {
    it('com adaptação existente, recebe a adaptada sem chamar a IA', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/receita/${panqueca.id}`)
        .set(como(alergico))
        .expect(200);

      expect(res.body.id).toBe(panquecaAdaptada.id);
      expect(res.body.adaptadaDe).toEqual({
        id: panqueca.id,
        nome: 'Panqueca',
      });
      expect(adaptar).not.toHaveBeenCalled();
    });

    it('sem adaptação, cria na hora e devolve a adaptada', async () => {
      prisma.receitas.push(pudimAdaptado);
      adaptar.mockResolvedValue({
        disponivel: true,
        receita: { id: pudimAdaptado.id },
      });

      const res = await request(app.getHttpServer())
        .get(`/api/receita/${pudim.id}`)
        .set(como(intolerante))
        .expect(200);

      expect(adaptar).toHaveBeenCalledWith(
        pudim.id,
        leite,
        expect.objectContaining({ id: intolerante.id }),
        [],
      );
      expect(res.body.id).toBe(pudimAdaptado.id);
      expect(res.body.adaptadaDe).toEqual({ id: pudim.id, nome: 'Pudim' });
      prisma.receitas.splice(prisma.receitas.indexOf(pudimAdaptado), 1);
    });

    it('restrição estrita e adaptação nova pendente: 403 explicando', async () => {
      adaptar.mockResolvedValue({
        disponivel: false,
        adaptacao: { id: 'nova', restricao: 'Leite', resumoIa: null },
      });

      const res = await request(app.getHttpServer())
        .get(`/api/receita/${pudim.id}`)
        .set(como(alergico))
        .expect(403);

      expect(res.body.message).toContain('Criamos uma versão adaptada');
    });

    it('a IA não consegue adaptar: comportamento de antes (403 com o motivo)', async () => {
      adaptar.mockRejectedValue(new Error('falhou'));

      const res = await request(app.getHttpServer())
        .get(`/api/receita/${pudim.id}`)
        .set(como(alergico))
        .expect(403);

      expect(res.body.message).toBe(
        'Esta receita não é segura para as suas restrições',
      );
    });

    it('sem restrição, abre a original e não chama a IA', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/receita/${pudim.id}`)
        .set(como(semRestricao))
        .expect(200);

      expect(res.body.id).toBe(pudim.id);
      expect(adaptar).not.toHaveBeenCalled();
    });
  });
});
