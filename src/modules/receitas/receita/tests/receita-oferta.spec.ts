/// <reference types="jest" />

import {
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { StatusRecebedor, TipoUsuario } from '@prisma/client';
import { ReceitaService } from '../receita.service';
import { IngredientesReceitaService } from '../ingredientes-receita.service';
import { TermosService } from '../../../marketplace/termos/termos.service';
import { AdaptacaoCatalogoService } from '../../adaptacao/adaptacao-catalogo.service';
import { VisibilidadeReceitaService } from '../../visibilidade/visibilidade-receita.service';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import { CacheService } from '../../../../common/cache/cache.service';
import { UsuarioService } from '../../../identidade/usuario/usuario.service';
import { IaService } from '../../../ia/ia.service';
import { UsuarioAutenticado } from '../../../../auth/auth.types';

const PRECO_MINIMO = 10;
const RECEITA = 'receita-paga';
const OFERTA = 'oferta';

describe('ReceitaService - oferta', () => {
  let service: ReceitaService;
  let visibilidade: VisibilidadeReceitaService;
  let termos: { garantirAceite: jest.Mock };
  let prisma: any;

  const quem = (id: string, tipoUsuario = TipoUsuario.comum) =>
    ({ id, sub: id, tipoUsuario }) as UsuarioAutenticado;
  const autor = quem('autor');
  const outro = quem('outro');

  const semAceite = new UnprocessableEntityException(
    'É preciso aceitar a versão atual dos termos do marketplace.',
  );
  const semMp = new UnprocessableEntityException(
    'Conecte uma conta do Mercado Pago para vender receitas.',
  );

  beforeEach(async () => {
    termos = { garantirAceite: jest.fn().mockResolvedValue(undefined) };
    prisma = {
      receita: {
        findFirst: jest.fn(async () => ({
          criadoPor: autor.id,
          oferta: { id: OFERTA },
        })),
        findMany: jest.fn(async () => []),
        // Segura para tudo, salvo o que o teste disser.
        count: jest.fn(async () => 1),
      },
      receitaOferta: {
        update: jest.fn(async ({ data }: any) => ({
          preco: data.preco ?? 12.9,
          ativa: data.ativa ?? true,
          publicoAlvo: (data.publicoAlvo?.create ?? []).map((p: any) => ({
            restricao: { id: p.restricaoId, nome: p.restricaoId },
          })),
        })),
      },
      contaRecebedor: {
        findUnique: jest.fn(async () => ({ status: StatusRecebedor.ativo })),
      },
      restricaoAlimentar: {
        findUnique: jest.fn(async ({ where }: any) =>
          where.id === 'nao-existe'
            ? null
            : { nome: where.id, createdAt: new Date(), regrasNutricionais: [] },
        ),
      },
    };

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
        { provide: UsuarioService, useValue: {} },
        { provide: IaService, useValue: {} },
        { provide: AdaptacaoCatalogoService, useValue: {} },
      ],
    }).compile();

    service = moduleRef.get(ReceitaService);
    visibilidade = moduleRef.get(VisibilidadeReceitaService);
  });

  describe('atualizarOferta', () => {
    const dadosDoUpdate = () => prisma.receitaOferta.update.mock.calls[0][0];

    it('muda o preço e devolve a oferta, com o preço como número', async () => {
      const resultado = await service.atualizarOferta(
        RECEITA,
        { preco: 14.9 },
        autor,
      );

      expect(dadosDoUpdate()).toMatchObject({
        where: { id: OFERTA },
        data: { preco: 14.9 },
      });
      expect(dadosDoUpdate().data).not.toHaveProperty('publicoAlvo');
      expect(resultado).toEqual({
        success: 'Oferta atualizada com sucesso.',
        data: { preco: 14.9, ativa: true, publicoAlvo: [] },
      });
    });

    it('substitui o público-alvo inteiro, conferindo a segurança', async () => {
      await service.atualizarOferta(
        RECEITA,
        { restricaoIds: ['lactose', 'gluten'] },
        autor,
      );

      expect(prisma.receita.count).toHaveBeenCalledTimes(2);
      expect(dadosDoUpdate().data.publicoAlvo).toEqual({
        deleteMany: {},
        create: [{ restricaoId: 'lactose' }, { restricaoId: 'gluten' }],
      });
    });

    it('lista vazia limpa o público-alvo', async () => {
      await service.atualizarOferta(RECEITA, { restricaoIds: [] }, autor);

      expect(dadosDoUpdate().data.publicoAlvo).toEqual({
        deleteMany: {},
        create: [],
      });
    });

    it('pausar não exige termos nem Mercado Pago', async () => {
      termos.garantirAceite.mockRejectedValue(semAceite);
      prisma.contaRecebedor.findUnique.mockResolvedValue(null);

      await expect(
        service.atualizarOferta(RECEITA, { ativa: false }, autor),
      ).resolves.toMatchObject({ data: { ativa: false } });
    });

    it.each([
      ['reativar', { ativa: true }],
      ['mudar o preço', { preco: 14.9 }],
      ['pausar e mudar o preço juntos', { ativa: false, preco: 14.9 }],
    ])('%s exige o Mercado Pago ativo', async (_caso, dados) => {
      prisma.contaRecebedor.findUnique.mockResolvedValue({
        status: StatusRecebedor.desconectado,
      });

      await expect(
        service.atualizarOferta(RECEITA, dados, autor),
      ).rejects.toThrow(semMp);
      expect(prisma.receitaOferta.update).not.toHaveBeenCalled();
    });

    it('exige os termos para mudar o preço', async () => {
      termos.garantirAceite.mockRejectedValue(semAceite);

      await expect(
        service.atualizarOferta(RECEITA, { preco: 14.9 }, autor),
      ).rejects.toThrow(semAceite);
    });

    it('preço abaixo do mínimo: 422', async () => {
      await expect(
        service.atualizarOferta(RECEITA, { preco: 9.99 }, autor),
      ).rejects.toThrow(UnprocessableEntityException);
      expect(prisma.receitaOferta.update).not.toHaveBeenCalled();
    });

    it('público-alvo inseguro: 422 com as recusadas, nada gravado', async () => {
      prisma.receita.count.mockResolvedValueOnce(1).mockResolvedValueOnce(0);

      const erro = await service
        .atualizarOferta(
          RECEITA,
          { restricaoIds: ['lactose', 'gluten'] },
          autor,
        )
        .catch((e: unknown) => e);

      expect((erro as UnprocessableEntityException).getResponse()).toEqual({
        message: 'A receita não é segura para parte do público-alvo.',
        restricoesRecusadas: ['gluten'],
      });
      expect(prisma.receitaOferta.update).not.toHaveBeenCalled();
    });

    it('restrição inexistente: 422', async () => {
      await expect(
        service.atualizarOferta(
          RECEITA,
          { restricaoIds: ['nao-existe'] },
          autor,
        ),
      ).rejects.toThrow(
        new UnprocessableEntityException('Restrição alimentar não encontrada'),
      );
    });

    it('quem não é o autor: 403', async () => {
      await expect(
        service.atualizarOferta(RECEITA, { ativa: false }, outro),
      ).rejects.toThrow(
        new ForbiddenException('Só o autor altera a oferta da receita.'),
      );
    });

    it('receita sem oferta: 404', async () => {
      prisma.receita.findFirst.mockResolvedValue({
        criadoPor: autor.id,
        oferta: null,
      });

      await expect(
        service.atualizarOferta(RECEITA, { preco: 14.9 }, autor),
      ).rejects.toThrow(new NotFoundException('A receita não tem oferta.'));
    });

    it('receita inexistente ou excluída: 404', async () => {
      prisma.receita.findFirst.mockResolvedValue(null);

      await expect(
        service.atualizarOferta(RECEITA, { preco: 14.9 }, autor),
      ).rejects.toThrow(new NotFoundException('Receita não encontrada'));
      expect(prisma.receita.findFirst.mock.calls[0][0].where).toEqual({
        id: RECEITA,
        deletedAt: null,
      });
    });
  });

  describe('findAVenda', () => {
    const whereDaBusca = () => prisma.receita.findMany.mock.calls[0][0].where;

    it('usa o filtro "à venda"', async () => {
      await service.findAVenda().catch(() => undefined);

      expect(whereDaBusca().AND).toContainEqual(visibilidade.filtroAVenda());
    });

    it('publicoAlvo: marcada pelo vendedor e ainda segura hoje', async () => {
      const seguraPara = { marcador: 'segura para lactose' } as any;
      const filtroSeguraPara = jest
        .spyOn(visibilidade, 'filtroSeguraPara')
        .mockResolvedValue(seguraPara);

      await service
        .findAVenda(undefined, { publicoAlvo: 'lactose' })
        .catch(() => undefined);

      expect(whereDaBusca().AND).toEqual(
        expect.arrayContaining([
          {
            oferta: {
              is: { publicoAlvo: { some: { restricaoId: 'lactose' } } },
            },
          },
          seguraPara,
        ]),
      );
      expect(filtroSeguraPara).toHaveBeenCalledWith('lactose');
    });

    it('sem receitas à venda: 404', async () => {
      await expect(service.findAVenda()).rejects.toThrow(
        new NotFoundException('Nenhuma receita à venda encontrada'),
      );
    });
  });
});
