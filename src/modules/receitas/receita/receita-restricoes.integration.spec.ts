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
  CampoNutricionalRegra,
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
import { IaService } from '../../ia/ia.service';
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
    if (campo === 'AND') return cond.every((w: any) => atende(r, w));
    const valor = r[campo];
    if (cond && typeof cond === 'object') {
      if ('contains' in cond) {
        return valor.toLowerCase().includes(cond.contains.toLowerCase());
      }
      if ('every' in cond)
        return valor.every((i: any) => atende(i, cond.every));
      if ('none' in cond) return !valor.some((i: any) => atende(i, cond.none));
      if ('in' in cond) return cond.in.includes(valor);
      if ('notIn' in cond) return !cond.notIn.includes(valor);
      if ('is' in cond) {
        const v = valor ?? null;
        return cond.is === null ? v === null : v !== null && atende(v, cond.is);
      }
      if ('isEmpty' in cond) return (valor.length === 0) === cond.isEmpty;
      if ('gte' in cond) return valor !== null && valor >= cond.gte;
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

  restricoesAlimentares: any[] = [];

  restricaoAlimentar = {
    findUnique: async ({ where }: any) =>
      this.restricoesAlimentares.find((r) => r.id === where.id) ?? null,
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

describe('Receita - filtro por restrições do paciente (integration)', () => {
  let app: INestApplication;
  let prisma: FakePrismaService;

  const leite = randomUUID();
  const gluten = randomUUID();
  const hipertensao = randomUUID();
  const gergelim = randomUUID();

  const alergico = { id: randomUUID(), tipo: TipoUsuario.paciente };
  const intolerante = { id: randomUUID(), tipo: TipoUsuario.paciente };
  const intoleranteGrave = { id: randomUUID(), tipo: TipoUsuario.paciente };
  const hipertensoGrave = { id: randomUUID(), tipo: TipoUsuario.paciente };
  const alergicoGergelim = { id: randomUUID(), tipo: TipoUsuario.paciente };
  const semRestricao = { id: randomUUID(), tipo: TipoUsuario.paciente };
  const profissional = { id: randomUUID(), tipo: TipoUsuario.profissional };
  const autor = { id: randomUUID(), tipo: TipoUsuario.comum };

  const como = (u: { id: string; tipo: TipoUsuario }) => ({
    'x-user-id': u.id,
    'x-user-tipo': u.tipo,
  });

  const ingrediente = (
    restricoes: string[],
    revisado = true,
    sodioMg: number | null = 100,
  ) => ({
    ingrediente: {
      id: randomUUID(),
      nome: `ingrediente ${restricoes.join(',')}`,
      restricoesRevisadasEm: revisado ? new Date() : null,
      sodioMg,
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
    ingredientesNaoListados: [],
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
  // Tudo revisado e sem vínculo, mas um ingrediente sem dado de sódio.
  const semDadoSodio = nova('Sopa de legumes', [
    ingrediente([]),
    ingrediente([], true, null),
  ]);
  // Tudo revisado e seguro na lista, mas o modo de preparo cita queijo.
  const comQueijoFora = nova('Macarrão gratinado', [ingrediente([])], {
    ingredientesNaoListados: ['queijo ralado'],
  });
  // Adaptações para leite ainda não verificadas (pendentes).
  const adaptadaPorOutro = nova('Bolo de leite (adaptada)', [ingrediente([])], {
    status: StatusReceita.pendente,
    adaptacaoDe: { restricaoId: leite },
  });
  const adaptadaPeloAlergico = nova(
    'Pudim (adaptada, pedida pelo alérgico)',
    [ingrediente([])],
    {
      status: StatusReceita.pendente,
      criadoPor: alergico.id,
      adaptacaoDe: { restricaoId: leite },
    },
  );
  const adaptadaPeloIntolerante = nova(
    'Vitamina (adaptada, pedida pelo intolerante)',
    [ingrediente([])],
    {
      status: StatusReceita.pendente,
      criadoPor: intolerante.id,
      adaptacaoDe: { restricaoId: leite },
    },
  );
  const propriaComLeite = nova('Pudim do alérgico', [ingrediente([leite])], {
    status: StatusReceita.pendente,
    criadoPor: alergico.id,
  });

  const restricaoDe = (
    usuarioId: string,
    restricaoId: string,
    tipo: TipoRestricao,
    gravidade: Gravidade,
    camposDasRegras: CampoNutricionalRegra[] = [],
    criadaEm = new Date('2026-01-01T00:00:00Z'),
  ) => ({
    restricaoId,
    gravidade,
    paciente: { usuarioId },
    restricao: {
      nome: `restrição ${restricaoId}`,
      tipo,
      createdAt: criadaEm,
      regrasNutricionais: camposDasRegras.map((campoNutricional) => ({
        campoNutricional,
      })),
    },
  });

  const ids = (body: any[]) => body.map((r) => r.id).sort();
  const todasAprovadas = [
    comLeite.id,
    segura.id,
    naoRevisada.id,
    semDadoSodio.id,
    comQueijoFora.id,
  ].sort();

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
        { provide: IaService, useValue: {} },
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
    prisma.receitas.push(
      comLeite,
      segura,
      naoRevisada,
      semDadoSodio,
      comQueijoFora,
      propriaComLeite,
      adaptadaPorOutro,
      adaptadaPeloAlergico,
      adaptadaPeloIntolerante,
    );
    prisma.restricoesAlimentares.push({
      id: leite,
      nome: 'Alergia a leite',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      regrasNutricionais: [],
    });
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
      restricaoDe(
        hipertensoGrave.id,
        hipertensao,
        TipoRestricao.doenca_cronica,
        Gravidade.grave,
        [CampoNutricionalRegra.sodio_mg],
      ),
      // Cadastrada depois que os ingredientes foram revisados.
      restricaoDe(
        alergicoGergelim.id,
        gergelim,
        TipoRestricao.alergia,
        Gravidade.leve,
        [],
        new Date(Date.now() + 24 * 60 * 60 * 1000),
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

      expect(ids(res.body)).toEqual(
        [segura.id, semDadoSodio.id, propriaComLeite.id].sort(),
      );
    });

    it('recebe 403 com o motivo ao abrir a receita com o alérgeno pelo id', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/receita/${comLeite.id}`)
        .set(como(alergico))
        .expect(403);

      expect(res.body.restricoesVioladas).toEqual([
        expect.objectContaining({
          id: leite,
          estrita: true,
          contem: [expect.objectContaining({ nome: `ingrediente ${leite}` })],
        }),
      ]);

      // Os alertas da receita escondida também respondem 403.
      await request(app.getHttpServer())
        .get(`/api/receita/${comLeite.id}/alertas`)
        .set(como(alergico))
        .expect(403);

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
      expect(ids(validadas.body)).toEqual([segura.id, semDadoSodio.id].sort());

      const sugestoes = await request(app.getHttpServer())
        .get('/api/receita/sugestoes')
        .set(como(alergico))
        .expect(200);
      expect(ids(sugestoes.body)).toEqual([segura.id, semDadoSodio.id].sort());
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

    it('moderada ganha o aviso de restricoesVioladas em cada receita', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/receita/validadas')
        .set(como(intolerante))
        .expect(200);

      const porId = new Map(res.body.map((r: any) => [r.id, r]));
      expect((porId.get(comLeite.id) as any).restricoesVioladas).toEqual([
        expect.objectContaining({
          id: leite,
          estrita: false,
          contem: [expect.objectContaining({ nome: `ingrediente ${leite}` })],
          naoRevisados: [],
        }),
      ]);
      expect((porId.get(naoRevisada.id) as any).restricoesVioladas).toEqual([
        expect.objectContaining({
          id: leite,
          contem: [],
          naoRevisados: [expect.anything()],
        }),
      ]);
      expect((porId.get(segura.id) as any).restricoesVioladas).toEqual([]);
    });

    it('grave é tratada como estrita', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/receita/validadas')
        .set(como(intoleranteGrave))
        .expect(200);

      expect(ids(res.body)).toEqual([segura.id, semDadoSodio.id].sort());
    });
  });

  describe('restrição com regra nutricional', () => {
    it('hipertensão grave esconde receita com ingrediente sem dado de sódio', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/receita/validadas')
        .set(como(hipertensoGrave))
        .expect(200);

      // comLeite e segura: tudo revisado e com sódio informado.
      // naoRevisada: ingrediente não revisado. semDadoSodio: sódio null.
      expect(ids(res.body)).toEqual([comLeite.id, segura.id].sort());
    });
  });

  describe('restrição criada depois da curadoria', () => {
    it('esconde tudo: a revisão anterior não conferiu essa restrição', async () => {
      await request(app.getHttpServer())
        .get('/api/receita/validadas')
        .set(como(alergicoGergelim))
        .expect(404);
    });
  });

  describe('ingrediente citado no modo de preparo e fora da lista', () => {
    it('esconde do paciente com alergia e explica no 403', async () => {
      const lista = await request(app.getHttpServer())
        .get('/api/receita/validadas')
        .set(como(alergico))
        .expect(200);
      expect(ids(lista.body)).not.toContain(comQueijoFora.id);

      const res = await request(app.getHttpServer())
        .get(`/api/receita/${comQueijoFora.id}`)
        .set(como(alergico))
        .expect(403);
      expect(res.body.ingredientesNaoListados).toEqual(['queijo ralado']);
    });

    it('não esconde de quem só tem restrição leve ou moderada', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/receita/validadas')
        .set(como(intolerante))
        .expect(200);
      expect(ids(res.body)).toContain(comQueijoFora.id);
    });
  });

  describe('adaptação ainda não verificada', () => {
    const abrir = (receita: { id: string }, usuario: any) =>
      request(app.getHttpServer())
        .get(`/api/receita/${receita.id}`)
        .set(como(usuario));

    it('aparece para quem tem a restrição como leve ou moderada', async () => {
      await abrir(adaptadaPorOutro, intolerante).expect(200);
    });

    it('não aparece para quem tem a restrição como estrita nem para quem não a tem', async () => {
      await abrir(adaptadaPorOutro, alergico).expect(404);
      await abrir(adaptadaPorOutro, semRestricao).expect(404);
    });

    it('quem pediu vê, exceto se a restrição for estrita para ele', async () => {
      await abrir(adaptadaPeloIntolerante, intolerante).expect(200);

      const res = await abrir(adaptadaPeloAlergico, alergico).expect(403);
      expect(res.body.message).toContain('ainda não foi verificada');
    });
  });

  describe('?seguraPara=<restricaoId>', () => {
    it('visitante filtra pelas receitas seguras para uma restrição', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/receita/all?seguraPara=${leite}`)
        .expect(200);

      expect(ids(res.body)).toEqual([segura.id, semDadoSodio.id].sort());
    });

    it('restrição inexistente responde 404 e ID inválido 400', async () => {
      await request(app.getHttpServer())
        .get(`/api/receita/all?seguraPara=${randomUUID()}`)
        .expect(404);

      await request(app.getHttpServer())
        .get('/api/receita/nome?q=bolo&seguraPara=leite')
        .expect(400);
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
        [
          ...todasAprovadas,
          propriaComLeite.id,
          adaptadaPorOutro.id,
          adaptadaPeloAlergico.id,
          adaptadaPeloIntolerante.id,
        ].sort(),
      );
    });
  });
});
