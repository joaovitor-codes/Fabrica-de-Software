/// <reference types="jest" />

import 'dotenv/config';
import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { StatusAprovacao, StatusReceita, TipoUsuario } from '@prisma/client';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import { CacheService } from '../../../../common/cache/cache.service';
import { UsuarioAutenticado } from '../../../../auth/auth.types';
import { UsuarioService } from '../../../identidade/usuario/usuario.service';
import { TermosService } from '../../../marketplace/termos/termos.service';
import { AdaptacaoCatalogoService } from '../../adaptacao/adaptacao-catalogo.service';
import { CuradoriaReceitaService } from '../../curadoria/curadoria-receita.service';
import { PontosTransacaoService } from '../../pontos-transacao/pontos-transacao.service';
import { VisibilidadeReceitaService } from '../../visibilidade/visibilidade-receita.service';
import { IngredientesReceitaService } from '../ingredientes-receita.service';
import { ReceitaService } from '../receita.service';

/**
 * Edição de receita junto com a curadoria, contra o Postgres de verdade: a
 * receita aprovada tem de ter o conteúdo que a aprovação gravou, nunca um
 * conteúdo editado depois dela sem nova curadoria.
 */
describe('Receita - edição concorrente (integração com Postgres)', () => {
  const sufixo = randomUUID().slice(0, 8);
  let prisma: PrismaService;
  let receitas: ReceitaService;
  let curadoria: CuradoriaReceitaService;
  let autor: UsuarioAutenticado;
  let curador: UsuarioAutenticado;
  const contas: string[] = [];
  const usuarios: string[] = [];
  const criadas: string[] = [];

  async function criarUsuario(nome: string, tipoUsuario: TipoUsuario) {
    const conta = await prisma.conta.create({
      data: { email: `${nome}-${sufixo}@teste.local`, senhaHash: 'x' },
    });
    const u = await prisma.usuario.create({
      data: { contaId: conta.id, nome, tipoUsuario },
    });
    contas.push(conta.id);
    usuarios.push(u.id);
    return { ...u, sub: u.id } as UsuarioAutenticado;
  }

  async function receita(status: StatusReceita) {
    const r = await prisma.receita.create({
      data: {
        nome: `Original ${sufixo}`,
        criadoPor: autor.id,
        status,
      },
    });
    criadas.push(r.id);
    return r;
  }

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    autor = await criarUsuario('autor', TipoUsuario.comum);
    curador = await criarUsuario('curador', TipoUsuario.profissional);
    await prisma.profissional.create({
      data: {
        usuarioId: curador.id,
        registroProfissional: `CRN-${sufixo}`,
        statusAprovacao: StatusAprovacao.aprovado,
      },
    });

    const cache = {
      del: async () => undefined,
    } as unknown as CacheService;
    const visibilidade = new VisibilidadeReceitaService(prisma);
    receitas = new ReceitaService(
      prisma,
      {} as UsuarioService,
      cache,
      visibilidade,
      {
        avisoIngredientesOcultos: () => ({}),
      } as unknown as IngredientesReceitaService,
      {} as AdaptacaoCatalogoService,
      {} as TermosService,
      {} as ConfigService,
    );
    curadoria = new CuradoriaReceitaService(
      prisma,
      cache,
      new PontosTransacaoService(prisma),
    );
  });

  afterAll(async () => {
    await prisma.pontosTransacao.deleteMany({
      where: { profissional: { usuarioId: curador.id } },
    });
    await prisma.receitaVersao.deleteMany({
      where: { receitaId: { in: criadas } },
    });
    await prisma.receita.deleteMany({ where: { id: { in: criadas } } });
    await prisma.profissional.deleteMany({
      where: { usuarioId: curador.id },
    });
    await prisma.usuario.deleteMany({ where: { id: { in: usuarios } } });
    await prisma.conta.deleteMany({ where: { id: { in: contas } } });
    await prisma.$disconnect();
  });

  it('editar e aprovar juntos: a aprovada fica com o conteúdo que a aprovação gravou', async () => {
    for (let rodada = 0; rodada < 15; rodada++) {
      const r = await receita(StatusReceita.pendente);
      const editado = `Editada ${rodada} ${sufixo}`;
      const espera = (ms: number) =>
        new Promise((ok) => setTimeout(ok, ms * Math.random()));

      const [edicao, aprovacao] = await Promise.allSettled([
        espera(5).then(() => receitas.update(r.id, { nome: editado }, autor)),
        espera(5).then(() => curadoria.aprovarReceita(r.id, curador.id, 1)),
      ]);

      for (const resultado of [edicao, aprovacao]) {
        if (resultado.status === 'rejected') {
          expect(resultado.reason).toBeInstanceOf(ConflictException);
        }
      }
      const final = await prisma.receita.findUniqueOrThrow({
        where: { id: r.id },
      });
      if (final.status === StatusReceita.aprovada) {
        expect(aprovacao.status).toBe('fulfilled');
        const aprovada = (aprovacao as PromiseFulfilledResult<any>).value.data;
        expect(final.nome).toBe(aprovada.nome);
        // O curador viu a revisão 1: só o conteúdo original pode ser aprovado.
        expect(final.nome).toBe(`Original ${sufixo}`);
      }
      // A edição que respondeu 200 nunca gravou sobre uma aprovada.
      if (edicao.status === 'fulfilled') {
        expect(edicao.value.data.status).not.toBe(StatusReceita.aprovada);
      }
    }
  });

  it('três edições juntas de uma aprovada: uma versão só no histórico, sem 500', async () => {
    const r = await receita(StatusReceita.aprovada);

    const resultados = await Promise.allSettled(
      ['A', 'B', 'C'].map((v) =>
        receitas.update(r.id, { nome: `Versão ${v} ${sufixo}` }, autor),
      ),
    );

    // Quem leu a aprovada junto com outra edição recebe 409; quem começou
    // depois já lê a pendente e edita normalmente.
    for (const x of resultados) {
      if (x.status === 'rejected') {
        expect(x.reason).toBeInstanceOf(ConflictException);
      }
    }
    expect(resultados.some((x) => x.status === 'fulfilled')).toBe(true);
    const final = await prisma.receita.findUniqueOrThrow({
      where: { id: r.id },
    });
    expect(final.status).toBe(StatusReceita.pendente);
    expect(final.versaoAtual).toBe(2);
    expect(
      await prisma.receitaVersao.count({ where: { receitaId: r.id } }),
    ).toBe(1);
  });
  describe('a curadoria avalia a revisão que viu', () => {
    it('edição depois de o curador abrir: aprovar e rejeitar a revisão antiga dão 409', async () => {
      const r = await receita(StatusReceita.pendente);
      expect(r.revisao).toBe(1);

      await receitas.update(r.id, { nome: `Trocada ${sufixo}` }, autor);

      for (const avaliar of [
        () => curadoria.aprovarReceita(r.id, curador.id, 1),
        () => curadoria.rejeitarReceita(r.id, curador.id, 1),
      ]) {
        await expect(avaliar()).rejects.toThrow('mudou desde que você abriu');
      }
      const depois = await prisma.receita.findUniqueOrThrow({
        where: { id: r.id },
      });
      expect(depois.status).toBe(StatusReceita.pendente);
      expect(depois.revisao).toBe(2);
      expect(
        await prisma.pontosTransacao.count({
          where: { profissional: { usuarioId: curador.id }, receitaId: r.id },
        }),
      ).toBe(0);

      // Revisando o conteúdo novo, a aprovação passa.
      const ok = await curadoria.aprovarReceita(r.id, curador.id, 2);
      expect(ok.data).toMatchObject({
        status: StatusReceita.aprovada,
        nome: `Trocada ${sufixo}`,
      });
    });

    it('mídia nova também muda a revisão', async () => {
      const r = await receita(StatusReceita.pendente);

      await receitas.uploadMedia(
        r.id,
        {
          mimetype: 'image/jpeg',
          size: 1000,
          path: '/tmp/inexistente.jpg',
          fieldname: 'image',
          filename: `capa-${sufixo}.jpg`,
        } as Express.Multer.File,
        'capa',
        0,
        autor,
      );

      await expect(
        curadoria.aprovarReceita(r.id, curador.id, 1),
      ).rejects.toBeInstanceOf(ConflictException);
      await prisma.receitaMidia.deleteMany({ where: { receitaId: r.id } });
    });
  });
  describe('mídia nova', () => {
    const imagem = (nome: string) =>
      ({
        mimetype: 'image/jpeg',
        size: 1000,
        path: '/tmp/inexistente.jpg',
        fieldname: 'image',
        filename: `${nome}-${sufixo}.jpg`,
      }) as Express.Multer.File;

    afterEach(() =>
      prisma.receitaMidia.deleteMany({ where: { receitaId: { in: criadas } } }),
    );

    it('em receita aprovada, volta para a curadoria e guarda a versão anterior', async () => {
      const r = await receita(StatusReceita.aprovada);

      await receitas.uploadMedia(r.id, imagem('capa'), 'capa', 0, autor);

      const depois = await prisma.receita.findUniqueOrThrow({
        where: { id: r.id },
      });
      expect(depois).toMatchObject({
        status: StatusReceita.pendente,
        versaoAtual: 2,
        revisao: 2,
        profissionalAprovadorId: null,
      });
      expect(
        await prisma.receitaVersao.findMany({ where: { receitaId: r.id } }),
      ).toEqual([expect.objectContaining({ versao: 1, nome: r.nome })]);
    });

    it('três mídias juntas numa aprovada: todas entram, uma versão no histórico', async () => {
      const r = await receita(StatusReceita.aprovada);

      await Promise.all(
        ['a', 'b', 'c'].map((n, i) =>
          receitas.uploadMedia(r.id, imagem(n), 'capa', i, autor),
        ),
      );

      const depois = await prisma.receita.findUniqueOrThrow({
        where: { id: r.id },
        include: { midias: true },
      });
      expect(depois.midias).toHaveLength(3);
      expect(depois).toMatchObject({
        status: StatusReceita.pendente,
        versaoAtual: 2,
        revisao: 4,
      });
      expect(
        await prisma.receitaVersao.count({ where: { receitaId: r.id } }),
      ).toBe(1);
    });

    it('em receita pendente, só a revisão sobe', async () => {
      const r = await receita(StatusReceita.pendente);

      await receitas.uploadMedia(r.id, imagem('passo'), 'capa', 0, autor);

      const depois = await prisma.receita.findUniqueOrThrow({
        where: { id: r.id },
      });
      expect(depois).toMatchObject({
        status: StatusReceita.pendente,
        versaoAtual: 1,
        revisao: 2,
      });
      expect(
        await prisma.receitaVersao.count({ where: { receitaId: r.id } }),
      ).toBe(0);
    });

    it('mídia e aprovação juntas: aprovada nunca fica com mídia que o curador não viu', async () => {
      for (let rodada = 0; rodada < 15; rodada++) {
        const r = await receita(StatusReceita.pendente);
        const espera = () =>
          new Promise((ok) => setTimeout(ok, 5 * Math.random()));

        const resultados = await Promise.allSettled([
          espera().then(() =>
            receitas.uploadMedia(r.id, imagem(`m${rodada}`), 'capa', 0, autor),
          ),
          espera().then(() => curadoria.aprovarReceita(r.id, curador.id, 1)),
        ]);

        for (const x of resultados) {
          if (x.status === 'rejected') {
            expect(x.reason).toBeInstanceOf(ConflictException);
          }
        }
        const final = await prisma.receita.findUniqueOrThrow({
          where: { id: r.id },
          include: { midias: true },
        });
        if (final.status === StatusReceita.aprovada) {
          expect(final.midias).toHaveLength(0);
        }
        // A mídia gravada depois da aprovação mandou a receita de volta.
        if (final.midias.length > 0) {
          expect(final.status).toBe(StatusReceita.pendente);
        }
      }
    });
  });
});
