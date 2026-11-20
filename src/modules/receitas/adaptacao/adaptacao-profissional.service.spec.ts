/// <reference types="jest" />

import {
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, TipoUsuario } from '@prisma/client';
import {
  AdaptacaoProfissionalService,
  SUGESTAO_ADAPTACAO_TTL_MS,
} from './adaptacao-profissional.service';
import { AdaptacaoBaseService } from './adaptacao-base.service';
import { interpretarOpcoes } from './adaptacao';
import * as restricoesReceita from '../visibilidade/restricoes-receita';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { IaService } from '../../ia/ia.service';
import { IngredientesReceitaService } from '../receita/ingredientes-receita.service';
import { UsuarioAutenticado } from '../../../auth/auth.types';
import { CacheService } from '../../../common/cache/cache.service';

jest.mock('../visibilidade/restricoes-receita');
const mocked = jest.mocked(restricoesReceita);

describe('interpretarOpcoes', () => {
  it('junta "opcoes" e "c", sem repetir, só índices válidos, até 3', () => {
    const opcoes = interpretarOpcoes(
      {
        trocas: [
          { i: 1, c: 2, opcoes: [2, 0, 9, 'x', 1, 3] },
          { i: 0, opcoes: [0] },
        ],
      },
      new Set([1]),
      4,
    );
    expect([...opcoes]).toEqual([[1, [2, 0, 1]]]);
  });

  it('resposta sem trocas vira mapa vazio', () => {
    expect(interpretarOpcoes(null, new Set([0]), 3).size).toBe(0);
  });
});

describe('AdaptacaoProfissionalService', () => {
  const nutri = {
    id: 'usuario-nutri',
    tipoUsuario: TipoUsuario.profissional,
  } as UsuarioAutenticado;
  const lactose = {
    restricaoId: 'lactose',
    nome: 'Intolerância à lactose',
    estrita: false,
    criadaEm: new Date('2026-01-01'),
    campos: [],
  };
  const soja = {
    ...lactose,
    restricaoId: 'soja',
    nome: 'Alergia a soja',
    estrita: true,
  };

  const origem = {
    id: 'vitamina',
    nome: 'Vitamina de banana',
    descricao: null,
    modoPreparo: 'Bata a banana com o leite.',
    tempoPreparoMin: 5,
    porcoes: 1,
    nivelDificuldade: 'facil',
    avisoContaminacaoCruzada: false,
    versaoAtual: 2,
    revisao: 1,
    ingredientesNaoListados: [],
    ingredientes: [
      {
        ingredienteId: 'banana',
        quantidade: new Prisma.Decimal(1),
        unidadeMedidaId: 'un',
        ingrediente: { id: 'banana', nome: 'Banana' },
        unidadeMedida: { codigo: 'unidade' },
      },
      {
        ingredienteId: 'leite',
        quantidade: new Prisma.Decimal(250),
        unidadeMedidaId: 'g',
        ingrediente: { id: 'leite', nome: 'Leite' },
        unidadeMedida: { codigo: 'g' },
      },
    ],
  };
  const violacaoLeite = {
    id: 'lactose',
    nome: 'Intolerância à lactose',
    estrita: false,
    contem: [{ id: 'leite', nome: 'Leite' }],
    naoRevisados: [],
    semDado: [],
  };
  const candidatos = [
    { id: 'aveia', nome: 'Bebida de aveia' },
    { id: 'coco', nome: 'Leite de coco' },
  ];

  let prisma: any;
  let tx: any;
  let ia: { adaptarReceita: jest.Mock };
  let receitaService: {
    verificarIngredientesOcultos: jest.Mock;
    validarIngredientes: jest.Mock;
  };
  let service: AdaptacaoProfissionalService;
  let guardado: Map<string, unknown>;
  let cache: { get: jest.Mock; set: jest.Mock };

  beforeEach(() => {
    jest.resetAllMocks();
    mocked.restricoesDoPaciente.mockResolvedValue([lactose, soja]);
    mocked.ingredientesSegurosPara.mockResolvedValue(candidatos);
    mocked.violacoesDosIngredientes.mockImplementation(async (_p, ids) =>
      ids.includes('leite') ? [violacaoLeite] : [],
    );

    tx = {
      receita: {
        create: jest.fn(async ({ data }: any) => ({ id: 'adaptada', ...data })),
      },
      receitaAdaptacao: { create: jest.fn(async () => ({ id: 'adaptacao' })) },
      ingredienteSubstituto: { createMany: jest.fn(async () => ({})) },
    };
    prisma = {
      paciente: {
        findUnique: jest.fn(async () => ({
          id: 'ana',
          profissionalId: 'prof-1',
        })),
      },
      profissional: {
        findUnique: jest.fn(async () => ({
          id: 'prof-1',
          usuarioId: nutri.id,
        })),
      },
      receita: { findFirst: jest.fn(async () => origem) },
      ingredienteSubstituto: {
        findMany: jest.fn(async () => [
          {
            ingredienteOrigemId: 'leite',
            ingredienteDestino: { id: 'coco', nome: 'Leite de coco' },
          },
        ]),
      },
      ingrediente: { findMany: jest.fn(async () => []) },
      $transaction: (fn: any) => fn(tx),
    };
    ia = {
      adaptarReceita: jest.fn(async () => ({
        trocas: [
          { i: 1, acao: 'substituir', c: 0, quantidade: 250, opcoes: [0, 1] },
        ],
        modoPreparo: 'Bata a banana com a bebida de aveia.',
        resumo: 'Leite trocado por bebida de aveia.',
      })),
    };
    receitaService = {
      verificarIngredientesOcultos: jest.fn(async () => []),
      validarIngredientes: jest.fn(async () => []),
    };
    const ingredientesReceita =
      receitaService as unknown as IngredientesReceitaService;
    // Cache em memória, que devolve uma cópia como o Redis devolveria.
    guardado = new Map();
    cache = {
      get: jest.fn(async (chave: string) =>
        guardado.has(chave)
          ? JSON.parse(JSON.stringify(guardado.get(chave)))
          : undefined,
      ),
      set: jest.fn(async (chave: string, valor: unknown) => {
        guardado.set(chave, valor);
      }),
    };
    service = new AdaptacaoProfissionalService(
      prisma as PrismaService,
      new AdaptacaoBaseService(
        prisma as PrismaService,
        ia as unknown as IaService,
        ingredientesReceita,
      ),
      ingredientesReceita,
      cache as unknown as CacheService,
    );
  });

  describe('sugerir', () => {
    it('candidatos e IA consideram todas as restrições do paciente', async () => {
      await service.sugerir('vitamina', 'ana', nutri);

      expect(mocked.ingredientesSegurosPara).toHaveBeenCalledWith(prisma, [
        lactose,
        soja,
      ]);
      expect(ia.adaptarReceita).toHaveBeenCalledWith(
        expect.objectContaining({
          restricoes: ['Intolerância à lactose', 'Alergia a soja'],
        }),
      );
    });

    it('sugere por ingrediente (curado primeiro, sem repetir) e a receita inteira', async () => {
      const r: any = await service.sugerir('vitamina', 'ana', nutri);

      expect(r.segura).toBe(false);
      expect(r.ingredientes[0]).toMatchObject({
        nome: 'Banana',
        trocar: false,
        sugestoes: [],
      });
      expect(r.ingredientes[1]).toMatchObject({ nome: 'Leite', trocar: true });
      expect(r.ingredientes[1].sugestoes).toEqual([
        { id: 'coco', nome: 'Leite de coco', fonte: 'curado' },
        { id: 'aveia', nome: 'Bebida de aveia', fonte: 'ia' },
      ]);
      expect(r.receitaInteira).toMatchObject({
        modoPreparo: 'Bata a banana com a bebida de aveia.',
        ingredientes: [
          { ingredienteId: 'banana', nome: 'Banana' },
          { ingredienteId: 'aveia', nome: 'Bebida de aveia', quantidade: 250 },
        ],
      });
      // Sugestão não grava nada.
      expect(tx.receita.create).not.toHaveBeenCalled();
    });

    it('receita inteira que falha na checagem vira erro, mas as sugestões continuam', async () => {
      receitaService.verificarIngredientesOcultos.mockResolvedValue(['mel']);

      const r: any = await service.sugerir('vitamina', 'ana', nutri);

      expect(r.receitaInteira).toEqual({
        erro: expect.stringContaining('fora da lista: mel'),
      });
      expect(r.ingredientes[1].sugestoes).toHaveLength(2);
    });

    it('paciente sem restrição: receita segura, sem chamar a IA', async () => {
      mocked.restricoesDoPaciente.mockResolvedValue([]);
      mocked.violacoesDosIngredientes.mockResolvedValue([]);

      const r: any = await service.sugerir('vitamina', 'ana', nutri);

      expect(r.segura).toBe(true);
      expect(ia.adaptarReceita).not.toHaveBeenCalled();
    });

    describe('cache da proposta da IA', () => {
      it('reabrir a mesma prévia não chama a IA de novo e devolve o mesmo', async () => {
        const primeira = await service.sugerir('vitamina', 'ana', nutri);
        const segunda = await service.sugerir('vitamina', 'ana', nutri);

        expect(ia.adaptarReceita).toHaveBeenCalledTimes(1);
        expect(segunda).toEqual(primeira);
        expect(cache.set).toHaveBeenCalledWith(
          expect.stringMatching(/^adaptacao:sugestao:vitamina:2:1:/),
          expect.anything(),
          SUGESTAO_ADAPTACAO_TTL_MS,
        );
      });

      it.each([
        [
          'a receita foi editada (revisão)',
          () => {
            prisma.receita.findFirst.mockResolvedValue({
              ...origem,
              revisao: 2,
            });
          },
        ],
        [
          'a receita ganhou versão nova',
          () => {
            prisma.receita.findFirst.mockResolvedValue({
              ...origem,
              versaoAtual: 3,
            });
          },
        ],
        [
          'as restrições do paciente mudaram',
          () => {
            mocked.restricoesDoPaciente.mockResolvedValue([lactose]);
          },
        ],
        [
          'a curadoria mudou o que a receita fere',
          () => {
            mocked.violacoesDosIngredientes.mockResolvedValue([
              {
                ...violacaoLeite,
                contem: [
                  { id: 'leite', nome: 'Leite' },
                  { id: 'banana', nome: 'Banana' },
                ],
              },
            ]);
          },
        ],
      ])('chama a IA de novo quando %s', async (_, mudar) => {
        await service.sugerir('vitamina', 'ana', nutri);
        mudar();
        await service.sugerir('vitamina', 'ana', nutri);

        expect(ia.adaptarReceita).toHaveBeenCalledTimes(2);
      });

      it('candidato que deixou de ser seguro sai da prévia guardada', async () => {
        await service.sugerir('vitamina', 'ana', nutri);
        // A bebida de aveia ganhou vínculo com uma restrição do paciente.
        mocked.ingredientesSegurosPara.mockResolvedValue([candidatos[1]]);
        mocked.violacoesDosIngredientes.mockImplementation(async (_p, ids) => [
          ...(ids.includes('leite') ? [violacaoLeite] : []),
          ...(ids.includes('aveia')
            ? [
                {
                  ...violacaoLeite,
                  contem: [{ id: 'aveia', nome: 'Bebida de aveia' }],
                },
              ]
            : []),
        ]);

        const r: any = await service.sugerir('vitamina', 'ana', nutri);

        expect(ia.adaptarReceita).toHaveBeenCalledTimes(1);
        expect(r.ingredientes[1].sugestoes).toEqual([
          { id: 'coco', nome: 'Leite de coco', fonte: 'curado' },
        ]);
        // A receita inteira da IA usava a aveia: a checagem barra.
        expect(r.receitaInteira).toHaveProperty('erro');
      });

      it('falha da IA não fica guardada', async () => {
        ia.adaptarReceita.mockRejectedValueOnce(new Error('timeout'));

        await expect(
          service.sugerir('vitamina', 'ana', nutri),
        ).rejects.toThrow();
        await service.sugerir('vitamina', 'ana', nutri);

        expect(ia.adaptarReceita).toHaveBeenCalledTimes(2);
        expect(cache.set).toHaveBeenCalledTimes(1);
      });
    });

    it('profissional que não é o do paciente: 403', async () => {
      prisma.paciente.findUnique.mockResolvedValue({
        id: 'ana',
        profissionalId: 'outro-prof',
      });

      await expect(
        service.sugerir('vitamina', 'ana', nutri),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('receita paga', () => {
    const paga = {
      ...origem,
      criadoPor: 'vendedor',
      status: 'aprovada',
      oferta: { id: 'oferta' },
    };
    const recusa = new ForbiddenException(
      'Receita paga: só pode ser adaptada a cópia de quem comprou.',
    );

    it('sugerir: 403, sem chamar a IA', async () => {
      prisma.receita.findFirst.mockResolvedValue(paga);

      await expect(service.sugerir('vitamina', 'ana', nutri)).rejects.toThrow(
        recusa,
      );
      expect(ia.adaptarReceita).not.toHaveBeenCalled();
    });

    it('salvarDoProfissional: 403', async () => {
      prisma.receita.findFirst.mockResolvedValue(paga);

      await expect(
        service.salvarDoProfissional(
          'vitamina',
          { pacienteId: 'ana', ingredientes: [], trocas: [] } as any,
          nutri,
        ),
      ).rejects.toThrow(recusa);
    });
  });

  describe('salvarDoProfissional', () => {
    const escolha = {
      pacienteId: 'ana',
      ingredientes: [
        { ingredienteId: 'banana', quantidade: 1, unidadeMedidaId: 'un' },
        { ingredienteId: 'coco', quantidade: 200, unidadeMedidaId: 'g' },
      ],
      trocas: [
        {
          ingredienteOrigemId: 'leite',
          acao: 'substituir' as const,
          ingredienteDestinoId: 'coco',
        },
      ],
    };

    it('grava aprovada pelo profissional, só para o paciente, e aprende a troca', async () => {
      await service.salvarDoProfissional('vitamina', escolha, nutri);

      expect(tx.receita.create.mock.calls[0][0].data).toMatchObject({
        status: 'aprovada',
        profissionalAprovadorId: 'prof-1',
        criadoPor: nutri.id,
        modoPreparo: 'Bata a banana com o leite.',
      });
      expect(tx.receitaAdaptacao.create.mock.calls[0][0].data).toMatchObject({
        receitaOrigemId: 'vitamina',
        versaoOrigem: 2,
        pacienteId: 'ana',
        trocas: [
          {
            ingredienteOrigemId: 'leite',
            acao: 'substituir',
            ingredienteDestinoId: 'coco',
          },
        ],
      });
      expect(
        tx.receitaAdaptacao.create.mock.calls[0][0].data,
      ).not.toHaveProperty('restricaoId');
      expect(tx.ingredienteSubstituto.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            ingredienteOrigemId: 'leite',
            ingredienteDestinoId: 'coco',
            restricaoId: 'lactose',
          }),
        ],
        skipDuplicates: true,
      });
    });

    it('ingrediente original que saiu sem troca informada conta como removido', async () => {
      await service.salvarDoProfissional(
        'vitamina',
        { ...escolha, trocas: undefined },
        nutri,
      );

      expect(tx.receitaAdaptacao.create.mock.calls[0][0].data.trocas).toEqual([
        { ingredienteOrigemId: 'leite', acao: 'remover' },
      ]);
      expect(tx.ingredienteSubstituto.createMany).not.toHaveBeenCalled();
    });

    it('escolha que ainda fere uma restrição do paciente: 422, nada gravado', async () => {
      await expect(
        service.salvarDoProfissional(
          'vitamina',
          {
            ...escolha,
            ingredientes: [
              { ingredienteId: 'banana', quantidade: 1, unidadeMedidaId: 'un' },
              { ingredienteId: 'leite', quantidade: 250, unidadeMedidaId: 'g' },
            ],
          },
          nutri,
        ),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(tx.receita.create).not.toHaveBeenCalled();
    });
  });
});
