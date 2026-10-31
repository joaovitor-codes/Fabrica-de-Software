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
import { StatusReceita, TipoMidia, TipoUsuario } from '@prisma/client';
import { ReceitaController } from '../receita.controller';
import { ReceitaService } from '../receita.service';
import { TermosService } from '../../../marketplace/termos/termos.service';
import { ConfigService } from '@nestjs/config';
import { AdaptacaoCatalogoService } from '../../adaptacao/adaptacao-catalogo.service';
import { CuradoriaReceitaController } from '../../curadoria/curadoria-receita.controller';
import { CuradoriaReceitaService } from '../../curadoria/curadoria-receita.service';
import { PontosTransacaoService } from '../../pontos-transacao/pontos-transacao.service';
import { IngredientesReceitaService } from '../ingredientes-receita.service';
import { VisibilidadeReceitaService } from '../../visibilidade/visibilidade-receita.service';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import { CacheService } from '../../../../common/cache/cache.service';
import { UsuarioService } from '../../../identidade/usuario/usuario.service';
import { IaService } from '../../../ia/ia.service';
import { AuthGuard } from '../../../../auth/auth.guard';
import { OptionalAuthGuard } from '../../../../auth/optional-auth.guard';

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
    if (cond && typeof cond === 'object' && 'is' in cond) {
      const valor = r[campo] ?? null;
      return cond.is === null
        ? valor === null
        : valor !== null && atende(valor, cond.is);
    }
    if (cond && typeof cond === 'object' && 'notIn' in cond) {
      return !cond.notIn.includes(r[campo]);
    }
    if (cond && typeof cond === 'object' && 'contains' in cond) {
      return r[campo].toLowerCase().includes(cond.contains.toLowerCase());
    }
    if (cond && typeof cond === 'object' && 'some' in cond) {
      return (r[campo] ?? []).some((i: any) => atende(i, cond.some));
    }
    // Filtro de relação sem operador (ex.: criador: { contaRecebedor: ... }).
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      return atende(r[campo] ?? {}, cond);
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
    findUnique: async ({ where }: any) =>
      this.receitas.find((r) => r.id === where.id) ?? null,
  };
}

describe('Receita - visibilidade nas rotas públicas (integration)', () => {
  let app: INestApplication;
  let prisma: FakePrismaService;

  const autor = { id: randomUUID(), tipo: TipoUsuario.comum };
  const outroUsuario = { id: randomUUID(), tipo: TipoUsuario.comum };
  const profissional = { id: randomUUID(), tipo: TipoUsuario.profissional };
  const admin = { id: randomUUID(), tipo: TipoUsuario.admin };

  const como = (u: { id: string; tipo: TipoUsuario }) => ({
    'x-user-id': u.id,
    'x-user-tipo': u.tipo,
  });

  const nova = (nome: string, status: StatusReceita) => ({
    id: randomUUID(),
    nome,
    status,
    criadoPor: autor.id,
    nivelDificuldade: 'facil',
    createdAt: new Date(),
    deletedAt: null,
  });
  const aprovada = nova('Bolo aprovado', StatusReceita.aprovada);
  const pendente = nova('Bolo pendente', StatusReceita.pendente);
  const rejeitada = nova('Bolo rejeitado', StatusReceita.rejeitada);

  // Paga (D13): fica fora das listagens gratuitas, mesmo com a oferta pausada.
  const oferta = (ativa: boolean) => ({
    id: randomUUID(),
    preco: 12.9,
    ativa,
    publicoAlvo: [
      {
        restricaoId: 'r-lactose',
        restricao: { id: 'r-lactose', nome: 'Lactose' },
      },
    ],
  });
  const vendedorComMp = { contaRecebedor: { status: 'ativo' } };
  const conteudoPago = {
    modoPreparo: 'Bata tudo e asse por 40 minutos.',
    ingredientes: [{ ingredienteId: 'farinha', quantidade: 200 }],
    midias: [
      { id: 'capa', tipo: TipoMidia.capa, url: '/capa.jpg' },
      { id: 'passo', tipo: TipoMidia.passo_a_passo, url: '/passo.jpg' },
    ],
  };
  const paga = {
    ...nova('Bolo pago', StatusReceita.aprovada),
    ...conteudoPago,
    oferta: oferta(true),
    criador: vendedorComMp,
  };
  const pagaRejeitada = {
    ...nova('Bolo pago reprovado', StatusReceita.rejeitada),
    ...conteudoPago,
    oferta: oferta(true),
    criador: vendedorComMp,
  };
  // Oferta ativa e aprovada, mas o vendedor desconectou o Mercado Pago.
  const pagaSemMp = {
    ...nova('Torta paga sem MP', StatusReceita.aprovada),
    ...conteudoPago,
    oferta: oferta(true),
    criador: { contaRecebedor: { status: 'desconectado' } },
  };
  const pagaPausada = {
    ...nova('Bolo pago pausado', StatusReceita.aprovada),
    ...conteudoPago,
    oferta: oferta(false),
    criador: vendedorComMp,
  };
  const pagaPendente = {
    ...nova('Bolo pago na curadoria', StatusReceita.pendente),
    ...conteudoPago,
    oferta: oferta(true),
    criador: vendedorComMp,
  };

  const excluida = {
    ...nova('Bolo excluído', StatusReceita.aprovada),
    deletedAt: new Date(),
  };

  const ids = (body: any[]) => body.map((r) => r.id).sort();

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      // Mesma ordem do ReceitasModule: rotas fixas antes de GET :id.
      controllers: [CuradoriaReceitaController, ReceitaController],
      providers: [
        ReceitaService,
        // Só a criação com oferta usa; estes testes não passam por ela.
        { provide: TermosService, useValue: {} },
        { provide: ConfigService, useValue: {} },
        IngredientesReceitaService,
        VisibilidadeReceitaService,
        { provide: AdaptacaoCatalogoService, useValue: {} },
        CuradoriaReceitaService,
        { provide: PontosTransacaoService, useValue: {} },
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
      aprovada,
      pendente,
      rejeitada,
      excluida,
      paga,
      pagaPausada,
      pagaPendente,
      pagaSemMp,
      pagaRejeitada,
    );
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

  describe('receita paga fica fora das listagens gratuitas (D13)', () => {
    it.each(['/all', '/nome?q=bolo', '/sugestoes', '/validadas'])(
      'GET %s não traz receita paga, ativa ou pausada',
      async (rota) => {
        const res = await request(app.getHttpServer())
          .get(`/api/receita${rota}`)
          .expect(200);

        expect(ids(res.body)).toEqual([aprovada.id]);
      },
    );

    it.each([
      ['o autor', autor],
      ['o profissional', profissional],
    ])('%s também não vê a paga em /all', async (_quem, usuario) => {
      const res = await request(app.getHttpServer())
        .get('/api/receita/all')
        .set(como(usuario))
        .expect(200);

      expect(ids(res.body)).not.toContain(paga.id);
      expect(ids(res.body)).not.toContain(pagaPausada.id);
    });
  });

  describe('GET /api/receita/:id de receita paga', () => {
    const detalhe = (
      id: string,
      usuario?: { id: string; tipo: TipoUsuario },
    ) => {
      const req = request(app.getHttpServer()).get(`/api/receita/${id}`);
      return usuario ? req.set(como(usuario)) : req;
    };

    it.each([
      ['o visitante', undefined],
      ['outro usuário', outroUsuario],
      ['o profissional, fora da curadoria', profissional],
    ])('%s recebe só a prévia', async (_quem, usuario) => {
      const res = await detalhe(paga.id, usuario).expect(200);

      expect(res.body).toMatchObject({
        id: paga.id,
        nome: 'Bolo pago',
        oferta: {
          preco: 12.9,
          publicoAlvo: [{ id: 'r-lactose', nome: 'Lactose' }],
          comprada: false,
        },
      });
      expect(res.body).not.toHaveProperty('modoPreparo');
      expect(res.body).not.toHaveProperty('ingredientes');
      expect(res.body.midias.map((m: any) => m.id)).toEqual(['capa']);
    });

    it('a prévia vale também com a oferta pausada', async () => {
      const res = await detalhe(pagaPausada.id).expect(200);

      expect(res.body).not.toHaveProperty('modoPreparo');
    });

    it.each([
      ['o autor', autor, paga],
      ['o admin', admin, paga],
      ['o profissional na curadoria', profissional, pagaPendente],
    ])('%s vê a receita inteira', async (_quem, usuario, receita) => {
      const res = await detalhe(receita.id, usuario).expect(200);

      expect(res.body.modoPreparo).toBe(conteudoPago.modoPreparo);
      expect(res.body.midias).toHaveLength(2);
    });
  });

  describe('GET /api/receita/:id/ingredientes de receita paga', () => {
    it.each([
      ['o visitante', undefined],
      ['outro usuário', outroUsuario],
    ])('%s recebe 403', async (_quem, usuario) => {
      const req = request(app.getHttpServer()).get(
        `/api/receita/${paga.id}/ingredientes`,
      );
      const res = await (usuario ? req.set(como(usuario)) : req).expect(403);

      expect(res.body.message).toBe(
        'Receita paga: os ingredientes ficam disponíveis depois da compra.',
      );
    });

    it('o autor recebe os ingredientes', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/receita/${paga.id}/ingredientes`)
        .set(como(autor))
        .expect(200);

      expect(res.body).toEqual(conteudoPago.ingredientes);
    });
  });

  describe('GET /api/receita/a-venda', () => {
    it('lista só as que estão à venda, sempre como prévia', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/receita/a-venda')
        .expect(200);

      // Fora: gratuita, pausada, na curadoria, reprovada e vendedor sem
      // Mercado Pago.
      expect(ids(res.body)).toEqual([paga.id]);
      expect(res.body[0]).toMatchObject({
        nome: 'Bolo pago',
        oferta: { preco: 12.9, comprada: false },
      });
      expect(res.body[0]).not.toHaveProperty('modoPreparo');
      expect(res.body[0].midias.map((m: any) => m.id)).toEqual(['capa']);
    });

    it('o autor também vê a prévia na vitrine', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/receita/a-venda')
        .set(como(autor))
        .expect(200);

      expect(res.body[0]).not.toHaveProperty('modoPreparo');
    });

    it('filtra pelo nome', async () => {
      await request(app.getHttpServer())
        .get('/api/receita/a-venda?q=torta')
        .expect(404);

      const res = await request(app.getHttpServer())
        .get('/api/receita/a-venda?q=BOLO')
        .expect(200);
      expect(ids(res.body)).toEqual([paga.id]);
    });

    it('publicoAlvo precisa ser o ID de uma restrição', async () => {
      await request(app.getHttpServer())
        .get('/api/receita/a-venda?publicoAlvo=lactose')
        .expect(400);
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

    it('lista só as pendentes para profissional, pagas inclusive', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/receita/pendentes')
        .set(como(profissional))
        .expect(200);

      expect(ids(res.body)).toEqual([pendente.id, pagaPendente.id].sort());
    });
  });
});
