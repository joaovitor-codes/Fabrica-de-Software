/// <reference types="jest" />

import { InternalServerErrorException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { NotificacaoService } from './notificacao.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CriarNotificacaoInput } from './dtos/notificacao.types';

const TIPO_ATIVO = { id: 'tipo-1', codigo: 'receita_vendida', ativo: true };

/** Mock das duas tabelas que o criar usa. */
function criarPrismaMock() {
  return {
    tipoNotificacao: {
      findUnique: jest.fn().mockResolvedValue(TIPO_ATIVO),
    },
    notificacao: {
      create: jest
        .fn()
        .mockImplementation(({ data }) =>
          Promise.resolve({ id: 'notificacao-1', ...data }),
        ),
    },
  };
}

function input(
  referencia: CriarNotificacaoInput['referencia'],
): CriarNotificacaoInput {
  return {
    usuarioId: 'usuario-1',
    codigo: 'receita_vendida',
    titulo: 'Sua receita foi vendida',
    referencia,
  };
}

describe('NotificacaoService', () => {
  let prisma: ReturnType<typeof criarPrismaMock>;
  let service: NotificacaoService;

  beforeEach(async () => {
    prisma = criarPrismaMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificacaoService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<NotificacaoService>(NotificacaoService);
  });

  it('grava notificação com produtoId e as outras referências nulas', async () => {
    await service.criar(input({ produtoId: 'produto-1' }));

    expect(prisma.notificacao.create).toHaveBeenCalledWith({
      data: {
        usuarioId: 'usuario-1',
        tipoNotificacaoId: 'tipo-1',
        titulo: 'Sua receita foi vendida',
        mensagem: null,
        receitaId: null,
        assinaturaId: null,
        planoAlimentarItemId: null,
        indicacaoId: null,
        anamneseId: null,
        produtoId: 'produto-1',
      },
    });
  });

  it('grava notificação com receitaId', async () => {
    const notificacao = await service.criar(input({ receitaId: 'receita-1' }));

    expect(notificacao).toMatchObject({
      receitaId: 'receita-1',
      produtoId: null,
    });
  });

  it('recusa duas referências sem tocar no banco', async () => {
    await expect(
      service.criar(input({ receitaId: 'receita-1', produtoId: 'produto-1' })),
    ).rejects.toThrow(InternalServerErrorException);

    expect(prisma.tipoNotificacao.findUnique).not.toHaveBeenCalled();
    expect(prisma.notificacao.create).not.toHaveBeenCalled();
  });

  it('recusa nenhuma referência', async () => {
    await expect(service.criar(input({}))).rejects.toThrow(
      InternalServerErrorException,
    );

    expect(prisma.notificacao.create).not.toHaveBeenCalled();
  });

  it('trata string vazia como referência ausente', async () => {
    await expect(service.criar(input({ receitaId: '' }))).rejects.toThrow(
      InternalServerErrorException,
    );

    expect(prisma.notificacao.create).not.toHaveBeenCalled();
  });

  it('lança erro quando o tipo não está cadastrado', async () => {
    prisma.tipoNotificacao.findUnique.mockResolvedValue(null);

    await expect(
      service.criar(input({ receitaId: 'receita-1' })),
    ).rejects.toThrow(InternalServerErrorException);

    expect(prisma.notificacao.create).not.toHaveBeenCalled();
  });

  it('não grava e retorna null quando o tipo está inativo', async () => {
    prisma.tipoNotificacao.findUnique.mockResolvedValue({
      ...TIPO_ATIVO,
      ativo: false,
    });

    await expect(
      service.criar(input({ receitaId: 'receita-1' })),
    ).resolves.toBeNull();

    expect(prisma.notificacao.create).not.toHaveBeenCalled();
  });

  it('usa o tx recebido em vez do PrismaService', async () => {
    const tx = criarPrismaMock();

    await service.criar(input({ receitaId: 'receita-1' }), tx as any);

    expect(tx.tipoNotificacao.findUnique).toHaveBeenCalled();
    expect(tx.notificacao.create).toHaveBeenCalled();
    expect(prisma.tipoNotificacao.findUnique).not.toHaveBeenCalled();
    expect(prisma.notificacao.create).not.toHaveBeenCalled();
  });
});
