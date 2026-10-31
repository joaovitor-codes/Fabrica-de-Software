/// <reference types="jest" />

import {
  BadRequestException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { StatusRecebedor } from '@prisma/client';
import { ReceitaService } from '../receita.service';
import { ReceitaComOfertaDto } from '../dtos/receita';
import { IngredientesReceitaService } from '../ingredientes-receita.service';
import { TermosService } from '../../../marketplace/termos/termos.service';
import { AdaptacaoCatalogoService } from '../../adaptacao/adaptacao-catalogo.service';
import { VisibilidadeReceitaService } from '../../visibilidade/visibilidade-receita.service';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import { CacheService } from '../../../../common/cache/cache.service';
import { UsuarioService } from '../../../identidade/usuario/usuario.service';
import { IaService } from '../../../ia/ia.service';

const PRECO_MINIMO = 10;

/**
 * Prisma falso com transação de verdade no sentido que importa aqui: o que é
 * escrito pelo `tx` só vai para `receitas` e `ofertas` se o callback terminar
 * sem erro. Erro dentro do callback descarta tudo, como o rollback do banco.
 */
class FakePrismaService {
  receitas: any[] = [];
  ofertas: any[] = [];
  recebedor: { status: StatusRecebedor } | null = {
    status: StatusRecebedor.ativo,
  };
  restricoes = new Map([
    ['r-lactose', 'Lactose'],
    ['r-gluten', 'Glúten'],
  ]);
  /** Restrições para as quais a receita gravada NÃO é segura. */
  inseguras = new Set<string>();

  ingrediente = {
    findMany: async () => [{ id: 'farinha', nome: 'Farinha de arroz' }],
  };
  unidadeMedida = { findMany: async () => [{ id: 'g' }] };
  contaRecebedor = {
    findUnique: jest.fn(async () => this.recebedor),
  };
  restricaoAlimentar = {
    findUnique: async ({ where }: any) => {
      const nome = this.restricoes.get(where.id);
      return nome
        ? { nome, createdAt: new Date(2026, 0, 1), regrasNutricionais: [] }
        : null;
    },
  };

  $transaction = jest.fn(async (fn: (tx: any) => Promise<unknown>) => {
    const receitas: any[] = [];
    const ofertas: any[] = [];
    const tx = {
      receita: {
        create: async ({ data }: any) => {
          const registro = { id: randomUUID(), status: 'pendente', ...data };
          receitas.push(registro);
          return registro;
        },
        // A cláusula de segurança é de uma restrição só por vez; o
        // restricaoId dela aparece no where gerado pelo clausulaSegura.
        count: async ({ where }: any) => {
          const texto = JSON.stringify(where);
          return [...this.inseguras].some((id) => texto.includes(id)) ? 0 : 1;
        },
      },
      receitaOferta: {
        create: async ({ data }: any) => {
          const registro = { id: randomUUID(), ativa: true, ...data };
          ofertas.push(registro);
          return registro;
        },
      },
    };
    const resultado = await fn(tx);
    this.receitas.push(...receitas);
    this.ofertas.push(...ofertas);
    return resultado;
  });
}

describe('ReceitaService - createComOferta', () => {
  let service: ReceitaService;
  let prisma: FakePrismaService;
  let termos: { garantirAceite: jest.Mock };
  let usuarioExiste: boolean;

  const vendedor = randomUUID();

  const dto = (oferta: Partial<ReceitaComOfertaDto['oferta']> = {}) =>
    ({
      nome: 'Bolo sem lactose',
      ingredientes: [
        { ingredienteId: 'farinha', quantidade: 200, unidadeMedidaId: 'g' },
      ],
      oferta: { preco: 12.9, restricaoIds: ['r-lactose'], ...oferta },
    }) as ReceitaComOfertaDto;

  const semAceite = new UnprocessableEntityException(
    'É preciso aceitar a versão atual dos termos do marketplace.',
  );

  beforeEach(async () => {
    prisma = new FakePrismaService();
    termos = { garantirAceite: jest.fn().mockResolvedValue(undefined) };
    usuarioExiste = true;

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        ReceitaService,
        IngredientesReceitaService,
        VisibilidadeReceitaService,
        { provide: PrismaService, useValue: prisma },
        { provide: TermosService, useValue: termos },
        {
          provide: ConfigService,
          useValue: { getOrThrow: () => PRECO_MINIMO },
        },
        { provide: CacheService, useValue: { del: async () => {} } },
        {
          provide: UsuarioService,
          useValue: { userExists: async () => usuarioExiste },
        },
        // Sem modo de preparo, a IA não é chamada.
        { provide: IaService, useValue: {} },
        { provide: AdaptacaoCatalogoService, useValue: {} },
      ],
    }).compile();

    service = moduleRef.get(ReceitaService);
  });

  it('cria a receita pendente e a oferta com o público-alvo', async () => {
    const resultado = await service.createComOferta(
      dto({ restricaoIds: ['r-lactose', 'r-gluten'] }),
      vendedor,
    );

    expect(prisma.receitas).toHaveLength(1);
    expect(prisma.receitas[0]).toMatchObject({
      nome: 'Bolo sem lactose',
      criadoPor: vendedor,
      status: 'pendente',
    });
    expect(prisma.ofertas).toEqual([
      expect.objectContaining({
        receitaId: prisma.receitas[0].id,
        preco: 12.9,
        publicoAlvo: {
          create: [{ restricaoId: 'r-lactose' }, { restricaoId: 'r-gluten' }],
        },
      }),
    ]);
    expect(resultado).toMatchObject({
      success: 'Receita criada com sucesso.',
      data: { id: prisma.receitas[0].id },
    });
    expect(termos.garantirAceite).toHaveBeenCalledWith(vendedor);
  });

  it('cria a oferta sem público-alvo', async () => {
    await service.createComOferta(dto({ restricaoIds: undefined }), vendedor);

    expect(prisma.ofertas[0].publicoAlvo).toEqual({ create: [] });
  });

  it('aceita o preço igual ao mínimo', async () => {
    await expect(
      service.createComOferta(dto({ preco: PRECO_MINIMO }), vendedor),
    ).resolves.toBeDefined();
    expect(prisma.ofertas).toHaveLength(1);
  });

  describe('recusa antes de abrir a transação', () => {
    afterEach(() => {
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.receitas).toHaveLength(0);
      expect(prisma.ofertas).toHaveLength(0);
    });

    it('sem o aceite dos termos do marketplace', async () => {
      termos.garantirAceite.mockRejectedValue(semAceite);

      await expect(service.createComOferta(dto(), vendedor)).rejects.toThrow(
        semAceite,
      );
      expect(prisma.contaRecebedor.findUnique).not.toHaveBeenCalled();
    });

    it.each([
      ['sem conta Mercado Pago', null],
      ['com a conta desconectada', { status: StatusRecebedor.desconectado }],
    ])('%s', async (_caso, recebedor) => {
      prisma.recebedor = recebedor;

      await expect(service.createComOferta(dto(), vendedor)).rejects.toThrow(
        new UnprocessableEntityException(
          'Conecte uma conta do Mercado Pago para vender receitas.',
        ),
      );
    });

    it('com o preço abaixo do mínimo', async () => {
      await expect(
        service.createComOferta(dto({ preco: 9.99 }), vendedor),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('com restrição do público-alvo que não existe', async () => {
      await expect(
        service.createComOferta(
          dto({ restricaoIds: ['r-lactose', 'nao-existe'] }),
          vendedor,
        ),
      ).rejects.toThrow(
        new UnprocessableEntityException('Restrição alimentar não encontrada'),
      );
    });
  });

  describe('dentro da transação, desfaz a receita', () => {
    it('quando ela não é segura para parte do público-alvo', async () => {
      prisma.inseguras.add('r-gluten');

      const erro = await service
        .createComOferta(
          dto({ restricaoIds: ['r-lactose', 'r-gluten'] }),
          vendedor,
        )
        .catch((e: unknown) => e);

      expect(erro).toBeInstanceOf(UnprocessableEntityException);
      expect((erro as UnprocessableEntityException).getResponse()).toEqual({
        message: 'A receita não é segura para parte do público-alvo.',
        restricoesRecusadas: ['Glúten'],
      });
      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.receitas).toHaveLength(0);
      expect(prisma.ofertas).toHaveLength(0);
    });

    it('quando a receita em si é inválida', async () => {
      usuarioExiste = false;

      await expect(service.createComOferta(dto(), vendedor)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.receitas).toHaveLength(0);
      expect(prisma.ofertas).toHaveLength(0);
    });
  });
});
