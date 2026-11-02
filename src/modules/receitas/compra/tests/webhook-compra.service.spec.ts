/// <reference types="jest" />

import {
  BadGatewayException,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  Prisma,
  StatusCompraReceita,
  StatusPagamento,
  StatusReceita,
} from '@prisma/client';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import { MercadoPagoService } from '../../../marketplace/mercado-pago/mercado-pago.service';
import { PagamentoMercadoPago } from '../../../marketplace/mercado-pago/mercado-pago.types';
import { RecebedorService } from '../../../marketplace/recebedor/recebedor.service';
import { NotificacaoService } from '../../../notificacao/notificacao.service';
import { ConteudoComprado } from '../compra.types';
import { WebhookCompraService } from '../webhook-compra.service';

const COMPRA = '22222222-2222-4222-8222-222222222222';
const OUTRA_COMPRA = '33333333-3333-4333-8333-333333333333';
const CONTA_MP = '123456';
const VENDEDOR = 'vendedor';
const COMPRADOR = 'comprador';
const RECEITA_ORIGINAL = 'receita-original';
const AGORA = new Date('2026-11-02T12:00:00Z');
const PAGO_EM = new Date('2026-11-02T11:59:00Z');

const CONTEUDO: ConteudoComprado = {
  nome: 'Bolo sem lactose',
  descricao: 'Fofinho',
  modoPreparo: 'Misture e asse.',
  tempoPreparoMin: 40,
  porcoes: 8,
  nivelDificuldade: 'facil',
  avisoContaminacaoCruzada: true,
  ingredientesNaoListados: ['fermento'],
  ingredientes: [
    { ingredienteId: 'farinha', quantidade: '200.5', unidadeMedidaId: 'g' },
  ],
  midias: [{ url: 'https://cdn/1.jpg', tipo: 'capa', ordem: 0 }],
};

function compra(sobrescrever: Record<string, unknown> = {}) {
  return {
    id: COMPRA,
    ofertaId: 'oferta-1',
    compradorId: COMPRADOR,
    precoPago: new Prisma.Decimal('29.90'),
    conteudoComprado: CONTEUDO,
    status: StatusCompraReceita.pendente as StatusCompraReceita,
    pagaEm: null as Date | null,
    receitaCopiaId: null as string | null,
    ...sobrescrever,
  };
}

function pagamentoMp(
  sobrescrever: Partial<PagamentoMercadoPago> = {},
): PagamentoMercadoPago {
  return {
    id: 'pag-1',
    status: 'aprovado',
    valor: 29.9,
    referencia: COMPRA,
    metodo: 'pix',
    pagoEm: PAGO_EM,
    ...sobrescrever,
  };
}

/** Fake em memória das tabelas que o webhook usa; a transação usa o próprio fake. */
class FakePrismaService {
  compras = [compra()];
  pagamentos: any[] = [];
  receitas: any[] = [];
  contaDoVendedor: string | null = CONTA_MP;

  private semRelacoes = (c: any) => ({
    ...c,
    oferta: {
      receitaId: RECEITA_ORIGINAL,
      receita: {
        nome: CONTEUDO.nome,
        criadoPor: VENDEDOR,
        criador: {
          contaRecebedor: this.contaDoVendedor
            ? { gatewayRecebedorId: this.contaDoVendedor }
            : null,
        },
      },
    },
  });

  $transaction = jest.fn(async (fn: (tx: this) => Promise<unknown>) =>
    fn(this),
  );

  $queryRaw = jest.fn(async (_sql: TemplateStringsArray, id: string) => {
    const c = this.compras.find((x) => x.id === id);
    return c ? [{ status: c.status }] : [];
  });

  receitaCompra = {
    findUnique: jest.fn(async ({ where }: any) => {
      const c = this.compras.find((x) => x.id === where.id);
      return c ? this.semRelacoes(c) : null;
    }),
    findFirst: jest.fn(
      async ({ where }: any) =>
        this.compras.find(
          (c) =>
            c.ofertaId === where.ofertaId &&
            c.compradorId === where.compradorId &&
            where.status.in.includes(c.status) &&
            c.id !== where.id.not,
        ) ?? null,
    ),
    update: jest.fn(async ({ where, data }: any) =>
      Object.assign(
        this.compras.find((c) => c.id === where.id)!,
        data,
      ),
    ),
  };

  pagamento = {
    findUnique: jest.fn(
      async ({ where }: any) =>
        this.pagamentos.find(
          (p) => p.gatewayCobrancaId === where.gatewayCobrancaId,
        ) ?? null,
    ),
    create: jest.fn(async ({ data }: any) => {
      if (
        this.pagamentos.some(
          (p) => p.gatewayCobrancaId === data.gatewayCobrancaId,
        )
      ) {
        throw new Prisma.PrismaClientKnownRequestError('duplicado', {
          code: 'P2002',
          clientVersion: 'teste',
        });
      }
      this.pagamentos.push(data);
      return data;
    }),
  };

  receita = {
    create: jest.fn(async ({ data }: any) => {
      const receita = { id: `copia-${this.receitas.length + 1}`, ...data };
      this.receitas.push(receita);
      return { id: receita.id, nome: receita.nome };
    }),
  };
}

describe('WebhookCompraService', () => {
  let prisma: FakePrismaService;
  let recebedor: { tokenPorContaMercadoPago: jest.Mock };
  let mercadoPago: { buscarPagamento: jest.Mock };
  let notificacao: { criar: jest.Mock };
  let service: WebhookCompraService;

  beforeEach(async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    prisma = new FakePrismaService();
    recebedor = {
      tokenPorContaMercadoPago: jest
        .fn()
        .mockResolvedValue('APP_USR-token-vendedor'),
    };
    mercadoPago = {
      buscarPagamento: jest.fn().mockResolvedValue(pagamentoMp()),
    };
    notificacao = { criar: jest.fn().mockResolvedValue(null) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        WebhookCompraService,
        { provide: PrismaService, useValue: prisma },
        { provide: RecebedorService, useValue: recebedor },
        { provide: MercadoPagoService, useValue: mercadoPago },
        { provide: NotificacaoService, useValue: notificacao },
      ],
    }).compile();

    service = moduleRef.get(WebhookCompraService);
  });

  afterEach(() => jest.restoreAllMocks());

  const processar = () => service.processar(CONTA_MP, 'pag-1', AGORA);
  const minhaCompra = () => prisma.compras.find((c) => c.id === COMPRA)!;

  describe('pagamento aprovado', () => {
    it('busca o pagamento com o token da conta do aviso', async () => {
      await processar();

      expect(recebedor.tokenPorContaMercadoPago).toHaveBeenCalledWith(CONTA_MP);
      expect(mercadoPago.buscarPagamento).toHaveBeenCalledWith(
        'APP_USR-token-vendedor',
        'pag-1',
      );
    });

    it('registra o pagamento e marca a compra como paga, com a cópia', async () => {
      await processar();

      expect(prisma.pagamentos).toEqual([
        {
          receitaCompraId: COMPRA,
          valor: new Prisma.Decimal('29.90'),
          statusPagamento: StatusPagamento.pago,
          metodoPagamento: 'pix',
          gatewayCobrancaId: 'pag-1',
          dataPagamento: PAGO_EM,
        },
      ]);
      expect(minhaCompra()).toMatchObject({
        status: StatusCompraReceita.paga,
        pagaEm: PAGO_EM,
        receitaCopiaId: 'copia-1',
      });
    });

    it('sem data de aprovação no pagamento, usa a hora do aviso', async () => {
      mercadoPago.buscarPagamento.mockResolvedValue(
        pagamentoMp({ pagoEm: null }),
      );

      await processar();

      expect(minhaCompra().pagaEm).toEqual(AGORA);
    });

    it('cria a cópia a partir do conteúdo guardado na compra', async () => {
      await processar();

      const [copia] = prisma.receitas;
      expect(copia).toMatchObject({
        nome: 'Bolo sem lactose',
        descricao: 'Fofinho',
        modoPreparo: 'Misture e asse.',
        tempoPreparoMin: 40,
        porcoes: 8,
        nivelDificuldade: 'facil',
        avisoContaminacaoCruzada: true,
        ingredientesNaoListados: ['fermento'],
        criadoPor: VENDEDOR,
        status: StatusReceita.aprovada,
        midias: { createMany: { data: CONTEUDO.midias } },
      });
      const [ingrediente] = copia.ingredientes.createMany.data;
      expect(ingrediente).toMatchObject({
        ingredienteId: 'farinha',
        unidadeMedidaId: 'g',
      });
      expect(ingrediente.quantidade.toString()).toBe('200.5');
    });

    it('notifica o vendedor (receita original) e o comprador (cópia)', async () => {
      await processar();

      expect(notificacao.criar).toHaveBeenCalledWith(
        expect.objectContaining({
          usuarioId: VENDEDOR,
          codigo: 'receita_vendida',
          referencia: { receitaId: RECEITA_ORIGINAL },
        }),
        prisma,
      );
      expect(notificacao.criar).toHaveBeenCalledWith(
        expect.objectContaining({
          usuarioId: COMPRADOR,
          codigo: 'compra_liberada',
          referencia: { receitaId: 'copia-1' },
        }),
        prisma,
      );
    });

    it('o mesmo aviso duas vezes cria um pagamento e uma cópia só', async () => {
      await processar();
      await processar();

      expect(prisma.pagamentos).toHaveLength(1);
      expect(prisma.receitas).toHaveLength(1);
      expect(notificacao.criar).toHaveBeenCalledTimes(2);
    });

    it('trata a violação de unicidade do pagamento já registrado como processado', async () => {
      prisma.$transaction.mockImplementationOnce(async () => {
        prisma.pagamentos.push({ gatewayCobrancaId: 'pag-1' });
        throw new Prisma.PrismaClientKnownRequestError('duplicado', {
          code: 'P2002',
          clientVersion: 'teste',
        });
      });

      await expect(processar()).resolves.toBeUndefined();
    });

    it('relança outra violação de unicidade, para o Mercado Pago reenviar', async () => {
      prisma.$transaction.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('compra viva', {
          code: 'P2002',
          clientVersion: 'teste',
        }),
      );

      await expect(processar()).rejects.toThrow('compra viva');
    });
  });

  describe('compra cancelada (aviso depois do vencimento)', () => {
    beforeEach(() => {
      minhaCompra().status = StatusCompraReceita.cancelada;
    });

    it('libera a cópia quando o comprador não tem outra compra viva', async () => {
      await processar();

      expect(minhaCompra()).toMatchObject({
        status: StatusCompraReceita.paga,
        receitaCopiaId: 'copia-1',
      });
    });

    it('cancela a pendente mais nova e libera esta', async () => {
      prisma.compras.push(compra({ id: OUTRA_COMPRA }));

      await processar();

      expect(prisma.compras.find((c) => c.id === OUTRA_COMPRA)!.status).toBe(
        StatusCompraReceita.cancelada,
      );
      expect(minhaCompra().status).toBe(StatusCompraReceita.paga);
    });

    it('com outra compra já paga, registra o pagamento sem criar cópia', async () => {
      prisma.compras.push(
        compra({ id: OUTRA_COMPRA, status: StatusCompraReceita.paga }),
      );

      await processar();

      expect(prisma.pagamentos).toHaveLength(1);
      expect(prisma.receitas).toHaveLength(0);
      expect(minhaCompra().status).toBe(StatusCompraReceita.cancelada);
      expect(notificacao.criar).not.toHaveBeenCalled();
    });
  });

  describe('não libera a cópia', () => {
    it.each(['recusado', 'pendente', 'estornado'] as const)(
      'pagamento %s não muda a compra',
      async (status) => {
        mercadoPago.buscarPagamento.mockResolvedValue(pagamentoMp({ status }));

        await processar();

        expect(minhaCompra().status).toBe(StatusCompraReceita.pendente);
        expect(prisma.pagamentos).toHaveLength(0);
        expect(prisma.$transaction).not.toHaveBeenCalled();
      },
    );

    it('valor pago diferente do preço da compra', async () => {
      mercadoPago.buscarPagamento.mockResolvedValue(
        pagamentoMp({ valor: 1.0 }),
      );

      await processar();

      expect(minhaCompra().status).toBe(StatusCompraReceita.pendente);
      expect(prisma.receitas).toHaveLength(0);
    });

    it('compra que já está paga com outro pagamento: registra sem nova cópia', async () => {
      Object.assign(minhaCompra(), {
        status: StatusCompraReceita.paga,
        receitaCopiaId: 'copia-antiga',
      });

      await processar();

      expect(prisma.pagamentos).toHaveLength(1);
      expect(prisma.receitas).toHaveLength(0);
      expect(minhaCompra().receitaCopiaId).toBe('copia-antiga');
    });

    it.each([
      ['referência que não é UUID', 'nao-e-uuid'],
      ['compra inexistente', '44444444-4444-4444-8444-444444444444'],
    ])('%s', async (_caso, referencia) => {
      mercadoPago.buscarPagamento.mockResolvedValue(
        pagamentoMp({ referencia }),
      );

      await expect(processar()).resolves.toBeUndefined();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('compra de outro vendedor que não o da conta do aviso', async () => {
      prisma.contaDoVendedor = '999999';

      await processar();

      expect(minhaCompra().status).toBe(StatusCompraReceita.pendente);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('conta do Mercado Pago desconectada: responde sem buscar o pagamento', async () => {
      recebedor.tokenPorContaMercadoPago.mockRejectedValue(
        new UnprocessableEntityException('desconectada'),
      );

      await expect(processar()).resolves.toBeUndefined();
      expect(mercadoPago.buscarPagamento).not.toHaveBeenCalled();
    });
  });

  it('relança a falha do Mercado Pago, para ele reenviar o aviso', async () => {
    mercadoPago.buscarPagamento.mockRejectedValue(new BadGatewayException());

    await expect(processar()).rejects.toThrow(BadGatewayException);
  });
});
