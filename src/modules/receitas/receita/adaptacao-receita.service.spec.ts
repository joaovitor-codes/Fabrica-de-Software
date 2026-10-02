/// <reference types="jest" />

import {
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, TipoUsuario } from '@prisma/client';
import { AdaptacaoReceitaService } from './adaptacao-receita.service';
import * as restricoesReceita from './restricoes-receita';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { CacheService } from '../../../common/cache/cache.service';
import { IaService } from '../../ia/ia.service';
import { ReceitaService } from './receita.service';
import { UsuarioAutenticado } from '../../../auth/auth.types';

jest.mock('./restricoes-receita');
const mocked = jest.mocked(restricoesReceita);

describe('AdaptacaoReceitaService.adaptar', () => {
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
  let service: AdaptacaoReceitaService;

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

    service = new AdaptacaoReceitaService(
      prisma as PrismaService,
      ia as unknown as IaService,
      { verificarIngredientesOcultos } as unknown as ReceitaService,
      { del: async () => {} } as unknown as CacheService,
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
        restricao: 'Hipertensão',
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

  it('resposta da IA que não trata o ingrediente problemático: 422', async () => {
    ia.adaptarReceita.mockResolvedValue({ trocas: [] });

    await expect(
      service.adaptar('arroz-feijao', 'hipertensao', usuario),
    ).rejects.toThrow('não tratou: Sal, grosso');
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
