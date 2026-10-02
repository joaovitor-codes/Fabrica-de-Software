/// <reference types="jest" />

import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { NivelDificuldade, TipoUsuario } from '@prisma/client';
import { ReceitaService } from './receita.service';
import { AdaptacaoCatalogoService } from '../adaptacao/adaptacao-catalogo.service';
import { IngredientesReceitaService } from './ingredientes-receita.service';
import { VisibilidadeReceitaService } from '../visibilidade/visibilidade-receita.service';
import { interpretarIngredientesNaoListados } from './ingredientes-ocultos';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { CacheService } from '../../../common/cache/cache.service';
import { UsuarioService } from '../../identidade/usuario/usuario.service';
import { IaService } from '../../ia/ia.service';
import { UsuarioAutenticado } from '../../../auth/auth.types';

describe('interpretarIngredientesNaoListados', () => {
  it('apara, tira repetição (ignorando maiúsculas) e descarta o que não é texto', () => {
    expect(
      interpretarIngredientesNaoListados({
        faltando: [' queijo ralado ', 'Queijo ralado', 3, '', null, 'sal'],
      }),
    ).toEqual(['queijo ralado', 'sal']);
  });

  it('resposta fora do formato vira lista vazia', () => {
    expect(interpretarIngredientesNaoListados('texto')).toEqual([]);
    expect(interpretarIngredientesNaoListados({ faltando: 'sal' })).toEqual([]);
    expect(interpretarIngredientesNaoListados(null)).toEqual([]);
  });

  it('limita a 20 itens', () => {
    const faltando = Array.from({ length: 30 }, (_, i) => `item ${i}`);
    expect(interpretarIngredientesNaoListados({ faltando })).toHaveLength(20);
  });
});

describe('ReceitaService - ingredientes citados fora da lista', () => {
  let service: ReceitaService;
  let ia: { ingredientesNaoListados: jest.Mock };
  let prisma: any;

  const autor = { id: randomUUID(), tipoUsuario: TipoUsuario.comum };
  const outro = { id: randomUUID(), tipoUsuario: TipoUsuario.comum };
  const receitaId = randomUUID();

  const dto = {
    nome: 'Macarrão',
    modoPreparo: 'Cozinhe o macarrão e finalize com queijo ralado.',
    nivelDificuldade: NivelDificuldade.facil,
    ingredientes: [
      { ingredienteId: 'macarrao', quantidade: 200, unidadeMedidaId: 'g' },
    ],
  } as any;

  beforeEach(async () => {
    ia = {
      ingredientesNaoListados: jest
        .fn()
        .mockResolvedValue({ faltando: ['queijo ralado'] }),
    };
    prisma = {
      ingrediente: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'macarrao', nome: 'Macarrão, trigo' }]),
      },
      unidadeMedida: {
        findMany: jest.fn().mockResolvedValue([{ id: 'g' }]),
      },
      receitaIngrediente: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ ingrediente: { nome: 'Macarrão, trigo' } }]),
      },
      receita: {
        create: jest.fn(async ({ data }: any) => ({ id: receitaId, ...data })),
        findUnique: jest.fn(async () => ({
          id: receitaId,
          criadoPor: autor.id,
          status: 'pendente',
          deletedAt: null,
        })),
        update: jest.fn(async ({ data }: any) => ({ id: receitaId, ...data })),
      },
      $transaction: (fn: any) => fn(prisma),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        ReceitaService,
        IngredientesReceitaService,
        VisibilidadeReceitaService,
        { provide: AdaptacaoCatalogoService, useValue: {} },
        { provide: PrismaService, useValue: prisma },
        { provide: CacheService, useValue: { del: async () => {} } },
        { provide: UsuarioService, useValue: { userExists: async () => true } },
        { provide: IaService, useValue: ia },
      ],
    }).compile();
    service = moduleRef.get(ReceitaService);
  });

  it('ao criar, guarda o que a IA apontou e avisa o autor', async () => {
    const resultado = await service.create(dto, autor.id);

    expect(ia.ingredientesNaoListados).toHaveBeenCalledWith(dto.modoPreparo, [
      'Macarrão, trigo',
    ]);
    expect(prisma.receita.create.mock.calls[0][0].data).toMatchObject({
      ingredientesNaoListados: ['queijo ralado'],
    });
    expect(resultado).toHaveProperty('aviso');
    expect((resultado as { aviso: string }).aviso).toContain('queijo ralado');
  });

  it('falha da IA não impede criar: salva lista vazia e sem aviso', async () => {
    ia.ingredientesNaoListados.mockRejectedValue(new Error('fora do ar'));

    const resultado = await service.create(dto, autor.id);

    expect(prisma.receita.create.mock.calls[0][0].data).toMatchObject({
      ingredientesNaoListados: [],
    });
    expect(resultado).not.toHaveProperty('aviso');
  });

  it('sem modo de preparo, nem chama a IA', async () => {
    await service.create({ ...dto, modoPreparo: undefined }, autor.id);

    expect(ia.ingredientesNaoListados).not.toHaveBeenCalled();
  });

  it('editar o modo de preparo confere de novo', async () => {
    ia.ingredientesNaoListados.mockResolvedValue({ faltando: [] });

    await service.update(
      receitaId,
      { modoPreparo: 'Cozinhe o macarrão.' },
      autor as UsuarioAutenticado,
    );

    expect(prisma.receita.update.mock.calls[0][0].data).toMatchObject({
      ingredientesNaoListados: [],
    });
  });

  it('quem não é o autor não gasta chamada de IA', async () => {
    await expect(
      service.update(
        receitaId,
        { modoPreparo: 'Outro texto.' } as any,
        outro as UsuarioAutenticado,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(ia.ingredientesNaoListados).not.toHaveBeenCalled();
  });

  it('editar outro campo não chama a IA nem mexe na lista', async () => {
    await service.update(
      receitaId,
      { nome: 'Macarrão simples' },
      autor as UsuarioAutenticado,
    );

    expect(ia.ingredientesNaoListados).not.toHaveBeenCalled();
    expect(
      prisma.receita.update.mock.calls[0][0].data.ingredientesNaoListados,
    ).toBeUndefined();
  });
});
