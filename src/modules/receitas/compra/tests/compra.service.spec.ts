/// <reference types="jest" />

import {
  BadGatewayException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma, StatusCompraReceita, TipoUsuario } from '@prisma/client';
import { UsuarioAutenticado } from '../../../../auth/auth.types';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import { MercadoPagoService } from '../../../marketplace/mercado-pago/mercado-pago.service';
import { RecebedorService } from '../../../marketplace/recebedor/recebedor.service';
import { TermosService } from '../../../marketplace/termos/termos.service';
import {
  restricoesDoUsuario,
  restricoesVioladas,
} from '../../visibilidade/restricoes-receita';
import { VisibilidadeReceitaService } from '../../visibilidade/visibilidade-receita.service';
import { CompraService, VALIDADE_PREFERENCIA_MS } from '../compra.service';

// As regras de restrição têm testes próprios; aqui só importa o resultado.
jest.mock('../../visibilidade/restricoes-receita', () => ({
  restricoesDoUsuario: jest.fn(),
  restricoesVioladas: jest.fn(),
}));

const RECEITA = '11111111-1111-4111-8111-111111111111';
const OFERTA = 'oferta-1';
const VENDEDOR = 'vendedor';
const AGORA = new Date('2026-10-31T12:00:00Z');

const quem = (id: string, tipoUsuario: TipoUsuario = TipoUsuario.comum) =>
  ({ id, sub: id, tipoUsuario }) as UsuarioAutenticado;
const comprador = quem('comprador', TipoUsuario.paciente);

const violacao = (estrita: boolean) => ({
  id: estrita ? 'alergia-leite' : 'hipertensao',
  nome: estrita ? 'Alergia ao leite' : 'Hipertensão',
  estrita,
  contem: [],
  naoRevisados: [],
  semDado: [],
});

/** Fake em memória das tabelas que a compra usa. */
class FakePrismaService {
  receitaAVenda: any = {
    id: RECEITA,
    nome: 'Bolo sem lactose',
    criadoPor: VENDEDOR,
    versaoAtual: 3,
    oferta: { id: OFERTA, preco: new Prisma.Decimal('29.90') },
  };
  compras: any[] = [];
  erroAoCriar: Error | null = null;

  receita = {
    findFirst: jest.fn(async ({ where }: any) =>
      where.id === this.receitaAVenda?.id ? this.receitaAVenda : null,
    ),
  };

  receitaCompra = {
    findFirst: jest.fn(async ({ where }: any) => {
      const compra = this.compras.find(
        (c) =>
          (where.id === undefined || c.id === where.id) &&
          (where.ofertaId === undefined || c.ofertaId === where.ofertaId) &&
          c.compradorId === where.compradorId &&
          (where.status === undefined || where.status.in.includes(c.status)),
      );
      return compra && where.id
        ? {
            ...compra,
            oferta: {
              receita: { id: RECEITA, nome: this.receitaAVenda.nome },
            },
          }
        : (compra ?? null);
    }),
    create: jest.fn(async ({ data }: any) => {
      if (this.erroAoCriar) throw this.erroAoCriar;
      const compra = {
        id: `compra-${this.compras.length + 1}`,
        status: StatusCompraReceita.pendente,
        checkoutUrl: null,
        gatewayPreferenciaId: null,
        pagaEm: null,
        receitaCopiaId: null,
        createdAt: AGORA,
        ...data,
      };
      this.compras.push(compra);
      return compra;
    }),
    update: jest.fn(async ({ where, data }: any) =>
      Object.assign(
        this.compras.find((c) => c.id === where.id),
        data,
      ),
    ),
  };
}

describe('CompraService', () => {
  let prisma: FakePrismaService;
  let termos: { garantirAceite: jest.Mock };
  let recebedor: { tokenDoVendedor: jest.Mock };
  let mercadoPago: { criarPreferencia: jest.Mock };
  let service: CompraService;

  beforeEach(async () => {
    prisma = new FakePrismaService();
    termos = { garantirAceite: jest.fn().mockResolvedValue(undefined) };
    recebedor = {
      tokenDoVendedor: jest.fn().mockResolvedValue('APP_USR-token-vendedor'),
    };
    let n = 0;
    mercadoPago = {
      criarPreferencia: jest.fn(async () => {
        n++;
        return { id: `pref-${n}`, checkoutUrl: `https://mp/checkout/${n}` };
      }),
    };
    (restricoesDoUsuario as jest.Mock).mockResolvedValue([]);
    (restricoesVioladas as jest.Mock).mockImplementation(
      async (_prisma, ids: string[]) =>
        new Map(ids.map((id: string) => [id, []])),
    );

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        CompraService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: ConfigService,
          useValue: { get: () => 15 },
        },
        { provide: TermosService, useValue: termos },
        {
          provide: VisibilidadeReceitaService,
          useValue: { filtroAVenda: () => ({}) },
        },
        { provide: RecebedorService, useValue: recebedor },
        { provide: MercadoPagoService, useValue: mercadoPago },
      ],
    }).compile();

    service = moduleRef.get(CompraService);
  });

  const comprar = (usuario = comprador, agora = AGORA) =>
    service.comprar(RECEITA, usuario, agora);

  describe('comprar', () => {
    it('cria a compra pendente e devolve o link do Checkout Pro', async () => {
      await expect(comprar()).resolves.toEqual({
        compraId: 'compra-1',
        checkoutUrl: 'https://mp/checkout/1',
        reaproveitada: false,
      });

      expect(prisma.compras[0]).toMatchObject({
        ofertaId: OFERTA,
        compradorId: comprador.id,
        status: StatusCompraReceita.pendente,
        versaoComprada: 3,
        gatewayPreferenciaId: 'pref-1',
        checkoutUrl: 'https://mp/checkout/1',
      });
    });

    it('congela preço e taxa (15%, arredondada) na compra', async () => {
      await comprar();

      const [compra] = prisma.compras;
      expect(compra.precoPago.toString()).toBe('29.9');
      // 29,90 × 15% = 4,485 → 4,49
      expect(compra.taxaPlataforma.toString()).toBe('4.49');
    });

    it('cria a preferência com o token do vendedor e os dados da compra', async () => {
      await comprar();

      expect(recebedor.tokenDoVendedor).toHaveBeenCalledWith(VENDEDOR);
      expect(mercadoPago.criarPreferencia).toHaveBeenCalledWith(
        'APP_USR-token-vendedor',
        {
          referencia: 'compra-1',
          titulo: 'Bolo sem lactose',
          valor: 29.9,
          taxaPlataforma: 4.49,
          expiraEm: new Date(AGORA.getTime() + VALIDADE_PREFERENCIA_MS),
        },
      );
    });

    it('mudar o preço da oferta depois não altera a compra existente', async () => {
      await comprar();
      prisma.receitaAVenda.oferta.preco = new Prisma.Decimal('99.00');

      expect(prisma.compras[0].precoPago.toString()).toBe('29.9');
      expect(prisma.compras[0].taxaPlataforma.toString()).toBe('4.49');
    });

    it('exige o aceite dos termos, sem gravar nada', async () => {
      termos.garantirAceite.mockRejectedValueOnce(
        new UnprocessableEntityException('termos'),
      );

      await expect(comprar()).rejects.toThrow(UnprocessableEntityException);
      expect(prisma.compras).toHaveLength(0);
    });

    it('responde 404 quando a receita não está à venda', async () => {
      prisma.receitaAVenda = null;

      await expect(comprar()).rejects.toThrow(NotFoundException);
    });

    it('recusa comprar a própria receita (422)', async () => {
      await expect(comprar(quem(VENDEDOR))).rejects.toThrow(
        new UnprocessableEntityException(
          'Você não pode comprar a própria receita.',
        ),
      );
      expect(prisma.compras).toHaveLength(0);
    });

    it('recusa receita que fere uma restrição estrita, com a lista (422)', async () => {
      (restricoesVioladas as jest.Mock).mockResolvedValueOnce(
        new Map([[RECEITA, [violacao(true), violacao(false)]]]),
      );

      const erro = await comprar().catch((e) => e);

      expect(erro).toBeInstanceOf(UnprocessableEntityException);
      expect(erro.getResponse()).toMatchObject({
        restricoesVioladas: [{ id: 'alergia-leite', estrita: true }],
      });
      expect(prisma.compras).toHaveLength(0);
    });

    it('deixa comprar quando a restrição violada é só flexível', async () => {
      (restricoesVioladas as jest.Mock).mockResolvedValueOnce(
        new Map([[RECEITA, [violacao(false)]]]),
      );

      await expect(comprar()).resolves.toMatchObject({ reaproveitada: false });
    });

    it('com compra pendente, devolve o mesmo link sem criar outra preferência', async () => {
      await comprar();

      await expect(
        comprar(comprador, new Date(AGORA.getTime() + 60_000)),
      ).resolves.toEqual({
        compraId: 'compra-1',
        checkoutUrl: 'https://mp/checkout/1',
        reaproveitada: true,
      });
      expect(mercadoPago.criarPreferencia).toHaveBeenCalledTimes(1);
      expect(prisma.compras).toHaveLength(1);
    });

    it('substitui a pendente vencida por uma compra nova', async () => {
      await comprar();

      const depois = new Date(AGORA.getTime() + VALIDADE_PREFERENCIA_MS);
      await expect(comprar(comprador, depois)).resolves.toMatchObject({
        compraId: 'compra-2',
        checkoutUrl: 'https://mp/checkout/2',
        reaproveitada: false,
      });
      expect(prisma.compras[0].status).toBe(StatusCompraReceita.cancelada);
      expect(prisma.compras[1].status).toBe(StatusCompraReceita.pendente);
    });

    it.each([
      StatusCompraReceita.paga,
      StatusCompraReceita.reembolso_em_analise,
    ])('responde 409 quando já existe uma compra %s', async (status) => {
      await comprar();
      prisma.compras[0].status = status;

      await expect(comprar()).rejects.toThrow(ConflictException);
      expect(prisma.compras).toHaveLength(1);
    });

    it('deixa comprar de novo depois de uma compra cancelada', async () => {
      await comprar();
      prisma.compras[0].status = StatusCompraReceita.cancelada;

      await expect(comprar()).resolves.toMatchObject({ compraId: 'compra-2' });
    });

    it('trata a violação do índice de compra viva como 409', async () => {
      prisma.erroAoCriar = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed',
        { code: 'P2002', clientVersion: 'teste' },
      );

      await expect(comprar()).rejects.toThrow(ConflictException);
      expect(mercadoPago.criarPreferencia).not.toHaveBeenCalled();
    });

    it('cancela a compra e repassa o erro quando o Mercado Pago recusa', async () => {
      mercadoPago.criarPreferencia.mockRejectedValueOnce(
        new BadGatewayException('O Mercado Pago recusou a operação.'),
      );

      await expect(comprar()).rejects.toThrow(BadGatewayException);
      expect(prisma.compras[0].status).toBe(StatusCompraReceita.cancelada);
    });

    it('cancela a compra quando o vendedor deixou de receber', async () => {
      recebedor.tokenDoVendedor.mockRejectedValueOnce(
        new UnprocessableEntityException('vendedor sem Mercado Pago'),
      );

      await expect(comprar()).rejects.toThrow(UnprocessableEntityException);
      expect(prisma.compras[0].status).toBe(StatusCompraReceita.cancelada);
      expect(mercadoPago.criarPreferencia).not.toHaveBeenCalled();
    });
  });

  describe('consultar', () => {
    it('mostra a situação da compra ao comprador, com o link enquanto pendente', async () => {
      await comprar();

      await expect(
        service.consultar('compra-1', comprador),
      ).resolves.toMatchObject({
        id: 'compra-1',
        status: StatusCompraReceita.pendente,
        receita: { id: RECEITA, nome: 'Bolo sem lactose' },
        checkoutUrl: 'https://mp/checkout/1',
        receitaCopiaId: null,
      });
    });

    it('esconde o link depois que a compra deixa de estar pendente', async () => {
      await comprar();
      prisma.compras[0].status = StatusCompraReceita.paga;

      const compra = await service.consultar('compra-1', comprador);
      expect(compra.checkoutUrl).toBeNull();
    });

    it('responde 404 para a compra de outro usuário', async () => {
      await comprar();

      await expect(
        service.consultar('compra-1', quem('intruso')),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
