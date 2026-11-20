/// <reference types="jest" />

import {
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, TipoUsuario } from '@prisma/client';
import { AdaptacaoPacienteService } from './adaptacao-paciente.service';
import { AdaptacaoBaseService } from './adaptacao-base.service';
import { VisibilidadeReceitaService } from '../visibilidade/visibilidade-receita.service';
import * as restricoesReceita from '../visibilidade/restricoes-receita';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { CacheService } from '../../../common/cache/cache.service';
import { IaService } from '../../ia/ia.service';
import { IngredientesReceitaService } from '../receita/ingredientes-receita.service';
import { UsuarioAutenticado } from '../../../auth/auth.types';

jest.mock('../visibilidade/restricoes-receita');
const mocked = jest.mocked(restricoesReceita);

describe('AdaptacaoPacienteService.adaptar', () => {
  const usuario = {
    id: 'carla',
    tipoUsuario: TipoUsuario.paciente,
  } as UsuarioAutenticado;
  const hipertensao = {
    restricaoId: 'hipertensao',
    nome: 'Hipertensão',
    estrita: true,
    criadaEm: new Date('2026-01-01'),
    campos: ['sodioMg' as const],
  };

  const origem = {
    id: 'arroz-feijao',
    nome: 'Arroz com feijão',
    descricao: null,
    modoPreparo: 'Cozinhe o arroz e o feijão com sal.',
    tempoPreparoMin: 40,
    porcoes: 2,
    nivelDificuldade: 'facil',
    avisoContaminacaoCruzada: false,
    versaoAtual: 1,
    ingredientesNaoListados: [],
    ingredientes: [
      {
        ingredienteId: 'arroz',
        quantidade: new Prisma.Decimal(200),
        unidadeMedidaId: 'g',
        ingrediente: { id: 'arroz', nome: 'Arroz' },
        unidadeMedida: { codigo: 'g' },
      },
      {
        ingredienteId: 'sal',
        quantidade: new Prisma.Decimal(3),
        unidadeMedidaId: 'g',
        ingrediente: { id: 'sal', nome: 'Sal, grosso' },
        unidadeMedida: { codigo: 'g' },
      },
    ],
  };
  const violacaoSal = {
    id: 'hipertensao',
    nome: 'Hipertensão',
    estrita: true,
    contem: [{ id: 'sal', nome: 'Sal, grosso' }],
    naoRevisados: [],
    semDado: [],
  };

  let prisma: any;
  let tx: any;
  let ia: { adaptarReceita: jest.Mock };
  let verificarIngredientesOcultos: jest.Mock;
  let service: AdaptacaoPacienteService;

  beforeEach(() => {
    jest.resetAllMocks();
    mocked.restricaoPorId.mockResolvedValue(hipertensao);
    mocked.restricoesDoUsuario.mockResolvedValue([hipertensao]);
    mocked.ingredientesSegurosPara.mockResolvedValue([
      { id: 'salsinha', nome: 'Salsinha' },
    ]);
    // 1ª chamada: a origem fere; 2ª: a lista adaptada não fere.
    mocked.violacoesDosIngredientes
      .mockResolvedValueOnce([violacaoSal])
      .mockResolvedValueOnce([]);

    tx = {
      receita: {
        create: jest.fn(async ({ data }: any) => ({
          id: 'adaptada',
          ...data,
        })),
        update: jest.fn(async () => ({})),
      },
      receitaAdaptacao: {
        create: jest.fn(async () => ({ id: 'adaptacao' })),
        delete: jest.fn(async () => ({})),
      },
    };
    prisma = {
      receita: { findFirst: jest.fn(async () => origem) },
      receitaAdaptacao: { findUnique: jest.fn(async () => null) },
      ingredienteSubstituto: { findMany: jest.fn(async () => []) },
      ingrediente: {
        findMany: jest.fn(async () => [{ nome: 'Arroz' }]),
      },
      $transaction: (fn: any) => fn(tx),
    };
    ia = {
      adaptarReceita: jest.fn(async () => ({
        trocas: [{ i: 1, acao: 'remover' }],
        modoPreparo: 'Cozinhe o arroz e o feijão com ervas.',
        resumo: 'Sal removido.',
      })),
    };
    verificarIngredientesOcultos = jest.fn(async () => []);

    const base = new AdaptacaoBaseService(
      prisma as PrismaService,
      ia as unknown as IaService,
      { verificarIngredientesOcultos } as unknown as IngredientesReceitaService,
    );
    service = new AdaptacaoPacienteService(
      prisma as PrismaService,
      { del: async () => {} } as unknown as CacheService,
      base,
      new VisibilidadeReceitaService(prisma as PrismaService),
    );
  });

  it('cria a adaptada pendente; para restrição estrita, não a devolve ainda', async () => {
    const resultado = await service.adaptar(
      'arroz-feijao',
      'hipertensao',
      usuario,
    );

    expect(ia.adaptarReceita).toHaveBeenCalledWith(
      expect.objectContaining({
        restricoes: ['Hipertensão'],
        itens: [
          expect.objectContaining({ nome: 'Arroz', trocar: false }),
          expect.objectContaining({ nome: 'Sal, grosso', trocar: true }),
        ],
        candidatos: ['Salsinha'],
      }),
    );
    expect(tx.receita.create.mock.calls[0][0].data).toMatchObject({
      status: 'pendente',
      criadoPor: 'carla',
      modoPreparo: 'Cozinhe o arroz e o feijão com ervas.',
      ingredientes: {
        create: [
          { ingredienteId: 'arroz', quantidade: 200, unidadeMedidaId: 'g' },
        ],
      },
    });
    expect(tx.receitaAdaptacao.create.mock.calls[0][0].data).toMatchObject({
      receitaOrigemId: 'arroz-feijao',
      versaoOrigem: 1,
      restricaoId: 'hipertensao',
      resumoIa: 'Sal removido.',
      trocas: [{ ingredienteOrigemId: 'sal', acao: 'remover' }],
    });
    expect(resultado).toMatchObject({ verificada: false, disponivel: false });
    expect(resultado).not.toHaveProperty('receita');
    expect(resultado).toHaveProperty('aviso');
  });

  it('para restrição leve ou moderada, já devolve a adaptada', async () => {
    mocked.restricoesDoUsuario.mockResolvedValue([
      { ...hipertensao, estrita: false },
    ]);

    const resultado = await service.adaptar(
      'arroz-feijao',
      'hipertensao',
      usuario,
    );

    expect(resultado).toMatchObject({ disponivel: true });
    expect(resultado).toHaveProperty('receita');
  });

  it('reaproveita a adaptação da mesma versão, sem chamar a IA', async () => {
    prisma.receitaAdaptacao.findUnique.mockResolvedValue({
      id: 'adaptacao',
      versaoOrigem: 1,
      resumoIa: 'Sal removido.',
      receitaAdaptadaId: 'adaptada',
      receitaAdaptada: { id: 'adaptada', status: 'aprovada', deletedAt: null },
    });

    const resultado = await service.adaptar(
      'arroz-feijao',
      'hipertensao',
      usuario,
    );

    expect(ia.adaptarReceita).not.toHaveBeenCalled();
    expect(resultado).toMatchObject({
      reaproveitada: true,
      verificada: true,
      disponivel: true,
    });
  });

  describe('pedidos simultâneos para a mesma receita e restrição', () => {
    const p2002 = () =>
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'teste',
      });
    const vencedora = {
      id: 'adaptacao-vencedora',
      versaoOrigem: 1,
      resumoIa: 'Sal removido.',
      receitaAdaptadaId: 'adaptada-vencedora',
      receitaAdaptada: {
        id: 'adaptada-vencedora',
        status: 'pendente',
        deletedAt: null,
      },
    };

    describe('no mesmo processo, uma chamada à IA só', () => {
      let gravada: unknown = null;
      let liberarIa: () => void;

      beforeEach(() => {
        gravada = null;
        mocked.violacoesDosIngredientes.mockReset();
        mocked.violacoesDosIngredientes.mockImplementation(async (_p, ids) =>
          ids.includes('sal') ? [violacaoSal] : [],
        );
        prisma.receitaAdaptacao.findUnique.mockImplementation(
          async () => gravada,
        );
        tx.receitaAdaptacao.create.mockImplementation(async () => {
          gravada = { ...vencedora, id: 'adaptacao' };
          return { id: 'adaptacao' };
        });
        // A IA só responde quando o teste mandar: os dois pedidos chegam
        // enquanto ela pensa.
        const resposta = ia.adaptarReceita.getMockImplementation()!;
        ia.adaptarReceita.mockImplementation(
          (...args: unknown[]) =>
            new Promise((ok) => {
              liberarIa = () => ok(resposta(...args));
            }),
        );
      });

      const esperarIa = async () => {
        while (ia.adaptarReceita.mock.calls.length === 0) {
          await new Promise((ok) => setImmediate(ok));
        }
        // Dá tempo ao segundo pedido de chegar até a espera.
        for (let i = 0; i < 20; i++) {
          await new Promise((ok) => setImmediate(ok));
        }
      };

      it('o segundo pedido espera o primeiro e recebe a adaptação dele', async () => {
        const primeiro = service.adaptar(
          'arroz-feijao',
          'hipertensao',
          usuario,
        );
        const segundo = service.adaptar('arroz-feijao', 'hipertensao', usuario);
        await esperarIa();
        liberarIa();

        const [a, b] = await Promise.all([primeiro, segundo]);

        expect(ia.adaptarReceita).toHaveBeenCalledTimes(1);
        expect(tx.receitaAdaptacao.create).toHaveBeenCalledTimes(1);
        expect(a).toMatchObject({
          adaptacao: { id: 'adaptacao' },
          reaproveitada: false,
        });
        expect(b).toMatchObject({
          adaptacao: { id: 'adaptacao' },
          reaproveitada: true,
        });
      });

      it('se o primeiro falha, o segundo recebe o mesmo erro sem chamar a IA', async () => {
        ia.adaptarReceita.mockImplementation(
          () =>
            new Promise((_, falha) => {
              liberarIa = () => falha(new Error('IA fora do ar'));
            }),
        );
        const primeiro = service.adaptar(
          'arroz-feijao',
          'hipertensao',
          usuario,
        );
        const segundo = service.adaptar('arroz-feijao', 'hipertensao', usuario);
        await esperarIa();
        liberarIa();

        const resultados = await Promise.allSettled([primeiro, segundo]);

        expect(resultados.map((r) => r.status)).toEqual([
          'rejected',
          'rejected',
        ]);
        expect(ia.adaptarReceita).toHaveBeenCalledTimes(1);
      });

      it('depois que termina, a próxima falha não fica presa no anterior', async () => {
        ia.adaptarReceita.mockRejectedValueOnce(new Error('IA fora do ar'));
        await expect(
          service.adaptar('arroz-feijao', 'hipertensao', usuario),
        ).rejects.toThrow();

        ia.adaptarReceita.mockResolvedValueOnce({
          trocas: [{ i: 1, acao: 'remover' }],
          modoPreparo: 'Cozinhe o arroz e o feijão com ervas.',
          resumo: 'Sal removido.',
        });
        await expect(
          service.adaptar('arroz-feijao', 'hipertensao', usuario),
        ).resolves.toMatchObject({ reaproveitada: false });
        expect(ia.adaptarReceita).toHaveBeenCalledTimes(2);
      });
    });

    it('quem perde a corrida recebe a adaptação que venceu, sem erro', async () => {
      mocked.restricoesDoUsuario.mockResolvedValue([
        { ...hipertensao, estrita: false },
      ]);
      // 1ª busca: ainda não existe; depois do P2002, a que o outro gravou.
      prisma.receitaAdaptacao.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(vencedora);
      tx.receitaAdaptacao.create.mockRejectedValue(p2002());

      const resultado = await service.adaptar(
        'arroz-feijao',
        'hipertensao',
        usuario,
      );

      expect(resultado).toMatchObject({
        reaproveitada: true,
        adaptacao: { id: 'adaptacao-vencedora' },
        receita: { id: 'adaptada-vencedora' },
      });
    });

    it('a adaptação antiga já trocada por outro pedido (P2025) também reaproveita', async () => {
      prisma.receitaAdaptacao.findUnique
        .mockResolvedValueOnce({ ...vencedora, id: 'antiga', versaoOrigem: 0 })
        .mockResolvedValueOnce(vencedora);
      tx.receitaAdaptacao.delete.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Record not found', {
          code: 'P2025',
          clientVersion: 'teste',
        }),
      );

      await expect(
        service.adaptar('arroz-feijao', 'hipertensao', usuario),
      ).resolves.toMatchObject({
        reaproveitada: true,
        adaptacao: { id: 'adaptacao-vencedora' },
      });
    });

    it('P2002 sem adaptação vigente para devolver: o erro sobe', async () => {
      prisma.receitaAdaptacao.findUnique.mockResolvedValue(null);
      tx.receitaAdaptacao.create.mockRejectedValue(p2002());

      await expect(
        service.adaptar('arroz-feijao', 'hipertensao', usuario),
      ).rejects.toMatchObject({ code: 'P2002' });
    });

    it('outro erro na gravação não é tratado como corrida', async () => {
      tx.receitaAdaptacao.create.mockRejectedValue(new Error('banco fora'));

      await expect(
        service.adaptar('arroz-feijao', 'hipertensao', usuario),
      ).rejects.toThrow('banco fora');
      expect(prisma.receitaAdaptacao.findUnique).toHaveBeenCalledTimes(1);
    });
  });

  it('adaptação de versão antiga da origem é refeita e a antiga sai', async () => {
    prisma.receitaAdaptacao.findUnique.mockResolvedValue({
      id: 'adaptacao-antiga',
      versaoOrigem: 0,
      receitaAdaptadaId: 'adaptada-antiga',
      receitaAdaptada: {
        id: 'adaptada-antiga',
        status: 'aprovada',
        deletedAt: null,
      },
    });

    await service.adaptar('arroz-feijao', 'hipertensao', usuario);

    expect(ia.adaptarReceita).toHaveBeenCalled();
    expect(tx.receitaAdaptacao.delete).toHaveBeenCalledWith({
      where: { id: 'adaptacao-antiga' },
    });
    expect(tx.receita.update).toHaveBeenCalledWith({
      where: { id: 'adaptada-antiga' },
      data: { deletedAt: expect.any(Date) },
    });
  });

  it('receita já segura não é adaptada', async () => {
    mocked.violacoesDosIngredientes.mockReset().mockResolvedValue([]);

    const resultado = await service.adaptar(
      'arroz-feijao',
      'hipertensao',
      usuario,
    );

    expect(resultado).toMatchObject({ jaSegura: true });
    expect(ia.adaptarReceita).not.toHaveBeenCalled();
  });

  it('lista adaptada que ainda fere a restrição: 422 e nada gravado', async () => {
    mocked.violacoesDosIngredientes
      .mockReset()
      .mockResolvedValueOnce([violacaoSal])
      .mockResolvedValueOnce([violacaoSal]);
    ia.adaptarReceita.mockResolvedValue({
      trocas: [{ i: 1, acao: 'substituir', c: 0 }],
    });

    await expect(
      service.adaptar('arroz-feijao', 'hipertensao', usuario),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(tx.receita.create).not.toHaveBeenCalled();
  });

  it('modo de preparo adaptado citando ingrediente fora da lista: 422', async () => {
    verificarIngredientesOcultos.mockResolvedValue(['sal']);

    await expect(
      service.adaptar('arroz-feijao', 'hipertensao', usuario),
    ).rejects.toThrow('fora da lista: sal');
    expect(tx.receita.create).not.toHaveBeenCalled();
  });

  it('conferência do modo de preparo fora do ar: 503 e nada gravado', async () => {
    verificarIngredientesOcultos.mockRejectedValue(
      new ServiceUnavailableException('fora do ar'),
    );

    await expect(
      service.adaptar('arroz-feijao', 'hipertensao', usuario),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(tx.receita.create).not.toHaveBeenCalled();
  });

  it('resposta da IA que não trata o ingrediente problemático: 422', async () => {
    ia.adaptarReceita.mockResolvedValue({ trocas: [] });

    await expect(
      service.adaptar('arroz-feijao', 'hipertensao', usuario),
    ).rejects.toThrow('não tratou: Sal, grosso');
  });

  it('receita paga de outro autor: 403, sem chamar a IA nem gravar', async () => {
    prisma.receita.findFirst.mockResolvedValue({
      ...origem,
      criadoPor: 'vendedor',
      status: 'aprovada',
      oferta: { id: 'oferta' },
    });

    await expect(
      service.adaptar('arroz-feijao', 'hipertensao', usuario),
    ).rejects.toThrow(
      new ForbiddenException(
        'Receita paga: só pode ser adaptada a cópia de quem comprou.',
      ),
    );
    expect(ia.adaptarReceita).not.toHaveBeenCalled();
  });

  it('receita ou restrição inexistentes: 404', async () => {
    prisma.receita.findFirst.mockResolvedValue(null);
    await expect(
      service.adaptar('x', 'hipertensao', usuario),
    ).rejects.toBeInstanceOf(NotFoundException);

    mocked.restricaoPorId.mockResolvedValue(null);
    await expect(
      service.adaptar('arroz-feijao', 'x', usuario),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
