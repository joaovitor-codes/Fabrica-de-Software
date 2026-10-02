/// <reference types="jest" />

import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { TipoUsuario } from '@prisma/client';
import { ReceitaService } from './receita.service';
import { IngredientesReceitaService } from './ingredientes-receita.service';
import { VisibilidadeReceitaService } from '../visibilidade/visibilidade-receita.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { CacheService } from '../../../common/cache/cache.service';
import { UsuarioService } from '../../identidade/usuario/usuario.service';
import { IaService } from '../../ia/ia.service';
import { UsuarioAutenticado } from '../../../auth/auth.types';

describe('ReceitaService - lista de ingredientes', () => {
  let service: ReceitaService;
  let prisma: any;
  let ia: { ingredientesNaoListados: jest.Mock };

  const autor = {
    id: randomUUID(),
    tipoUsuario: TipoUsuario.comum,
  } as UsuarioAutenticado;
  const outro = {
    id: randomUUID(),
    tipoUsuario: TipoUsuario.comum,
  } as UsuarioAutenticado;
  const receitaId = randomUUID();

  const catalogo = [
    { id: 'arroz', nome: 'Arroz, tipo 1, cozido' },
    { id: 'queijo', nome: 'Queijo, minas, frescal' },
  ];
  const item = (ingredienteId: string, unidadeMedidaId = 'g') => ({
    ingredienteId,
    quantidade: 100,
    unidadeMedidaId,
  });

  beforeEach(async () => {
    ia = {
      ingredientesNaoListados: jest.fn().mockResolvedValue({ faltando: [] }),
    };
    prisma = {
      ingrediente: {
        findMany: jest.fn(async ({ where }: any) =>
          catalogo.filter((i) => where.id.in.includes(i.id)),
        ),
      },
      unidadeMedida: {
        findMany: jest.fn(async ({ where }: any) =>
          ['g'].filter((id) => where.id.in.includes(id)).map((id) => ({ id })),
        ),
      },
      receitaIngrediente: {
        findMany: jest.fn(async () => [{ ingrediente: catalogo[0] }]),
        deleteMany: jest.fn(async () => ({})),
        createMany: jest.fn(async () => ({})),
      },
      receita: {
        findUnique: jest.fn(async () => ({
          id: receitaId,
          criadoPor: autor.id,
          status: 'aprovada',
          versaoAtual: 3,
          modoPreparo: 'Cozinhe o arroz e cubra com queijo.',
          deletedAt: null,
        })),
        update: jest.fn(async ({ data }: any) => ({ id: receitaId, ...data })),
        create: jest.fn(async ({ data }: any) => ({ id: receitaId, ...data })),
      },
      receitaVersao: { create: jest.fn(async () => ({})) },
      $transaction: (fn: any) => fn(prisma),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        ReceitaService,
        IngredientesReceitaService,
        VisibilidadeReceitaService,
        { provide: PrismaService, useValue: prisma },
        { provide: CacheService, useValue: { del: async () => {} } },
        { provide: UsuarioService, useValue: { userExists: async () => true } },
        { provide: IaService, useValue: ia },
      ],
    }).compile();
    service = moduleRef.get(ReceitaService);
  });

  it('a lista nova substitui a antiga e a receita aprovada volta para curadoria', async () => {
    await service.update(
      receitaId,
      { ingredientes: [item('arroz'), item('queijo')] },
      autor,
    );

    expect(prisma.receitaIngrediente.deleteMany).toHaveBeenCalledWith({
      where: { receitaId },
    });
    expect(prisma.receitaIngrediente.createMany.mock.calls[0][0].data).toEqual([
      expect.objectContaining({ receitaId, ingredienteId: 'arroz' }),
      expect.objectContaining({ receitaId, ingredienteId: 'queijo' }),
    ]);
    expect(prisma.receita.update.mock.calls[0][0].data).toMatchObject({
      status: 'pendente',
      versaoAtual: { increment: 1 },
    });
  });

  it('confere o modo de preparo atual contra a lista nova', async () => {
    await service.update(
      receitaId,
      { ingredientes: [item('arroz'), item('queijo')] },
      autor,
    );

    expect(ia.ingredientesNaoListados).toHaveBeenCalledWith(
      'Cozinhe o arroz e cubra com queijo.',
      ['Arroz, tipo 1, cozido', 'Queijo, minas, frescal'],
    );
    expect(prisma.receita.update.mock.calls[0][0].data).toMatchObject({
      ingredientesNaoListados: [],
    });
  });

  it.each([
    ['repetido', [item('arroz'), item('arroz')], 'repetido'],
    ['inexistente', [item('arroz'), item('nao-existe')], 'não encontrado'],
    ['com unidade inativa', [item('arroz', 'xicara')], 'Unidade de medida'],
  ])(
    'ingrediente %s responde 400 sem gravar nada',
    async (_caso, ingredientes, mensagem) => {
      const erro = await service
        .update(receitaId, { ingredientes }, autor)
        .catch((e: unknown) => e);

      expect(erro).toBeInstanceOf(BadRequestException);
      expect((erro as BadRequestException).message).toContain(mensagem);
      expect(prisma.receitaIngrediente.deleteMany).not.toHaveBeenCalled();
      expect(ia.ingredientesNaoListados).not.toHaveBeenCalled();
    },
  );

  it('quem não é o autor recebe 403 antes de qualquer validação', async () => {
    await expect(
      service.update(receitaId, { ingredientes: [item('arroz')] }, outro),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.ingrediente.findMany).not.toHaveBeenCalled();
  });

  it('criar com ingrediente repetido responde 400, não 500', async () => {
    await expect(
      service.create(
        { nome: 'Arroz', ingredientes: [item('arroz'), item('arroz')] },
        autor.id,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.receita.create).not.toHaveBeenCalled();
  });
});
