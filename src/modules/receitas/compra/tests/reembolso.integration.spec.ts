/// <reference types="jest" />

import 'dotenv/config';
import {
  BadGatewayException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import {
  DiaSemana,
  Prisma,
  StatusAprovacao,
  StatusCompraReceita,
  StatusPagamento,
  StatusReceita,
  TipoRefeicao,
  TipoUsuario,
} from '@prisma/client';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import { UsuarioAutenticado } from '../../../../auth/auth.types';
import { MercadoPagoService } from '../../../marketplace/mercado-pago/mercado-pago.service';
import { RecebedorService } from '../../../marketplace/recebedor/recebedor.service';
import { NotificacaoService } from '../../../notificacao/notificacao.service';
import { PlanoAlimentarService } from '../../../acompanhamento/plano-alimentar/plano-alimentar.service';
import { ChecklistRefeicaoService } from '../../../acompanhamento/plano-alimentar/checklist-refeicao.service';
import { ReembolsoService } from '../reembolso.service';

/**
 * Reembolso de receita comprada (#128) contra o Postgres de verdade, com o
 * Mercado Pago dublado.
 */
describe('Reembolso de receita comprada (integração com Postgres)', () => {
  const sufixo = randomUUID().slice(0, 8);
  const PRECO = new Prisma.Decimal('29.90');
  let prisma: PrismaService;
  let service: ReembolsoService;
  let planos: PlanoAlimentarService;
  let checklist: ChecklistRefeicaoService;
  const mercadoPago = { estornar: jest.fn(), buscarPagamento: jest.fn() };

  const ids = { contas: [] as string[], usuarios: [] as string[] };
  let vendedor: UsuarioAutenticado;
  let comprador: UsuarioAutenticado;
  let outro: UsuarioAutenticado;
  let profissionalId: string;
  let pacienteId: string;
  let originalId: string;
  let ofertaId: string;
  let compraId: string;
  let copiaId: string;
  let pagamentoId: string;
  let gatewayId: string;

  async function criarUsuario(nome: string, tipoUsuario: TipoUsuario) {
    const conta = await prisma.conta.create({
      data: { email: `${nome}-${sufixo}@teste.local`, senhaHash: 'x' },
    });
    const usuario = await prisma.usuario.create({
      data: { contaId: conta.id, nome, tipoUsuario },
    });
    ids.contas.push(conta.id);
    ids.usuarios.push(usuario.id);
    return { ...usuario, sub: usuario.id } as UsuarioAutenticado;
  }

  const estornoAprovado = () =>
    mercadoPago.estornar.mockResolvedValue({
      id: 'r1',
      valor: 29.9,
      status: 'aprovado',
    });

  const compraAtual = () =>
    prisma.receitaCompra.findUniqueOrThrow({ where: { id: compraId } });
  const pagamentoAtual = () =>
    prisma.pagamento.findUniqueOrThrow({ where: { id: pagamentoId } });
  const copiaAtual = () =>
    prisma.receita.findUniqueOrThrow({ where: { id: copiaId } });
  const notificacoesDe = (usuarioId: string) =>
    prisma.notificacao.findMany({ where: { usuarioId } });

  async function adaptacaoDaCopia() {
    const adaptada = await prisma.receita.create({
      data: {
        nome: `Bolo adaptado ${sufixo}`,
        criadoPor: comprador.id,
        status: StatusReceita.pendente,
      },
    });
    await prisma.receitaAdaptacao.create({
      data: {
        receitaOrigemId: copiaId,
        versaoOrigem: 1,
        receitaAdaptadaId: adaptada.id,
        trocas: [],
      },
    });
    return adaptada;
  }

  async function planoCom(receitaId: string) {
    const plano = await prisma.planoAlimentar.create({
      data: {
        pacienteId,
        profissionalId,
        nome: `Plano ${sufixo}`,
        dataInicio: new Date(),
      },
    });
    const item = await prisma.planoAlimentarItem.create({
      data: {
        planoAlimentarId: plano.id,
        receitaId,
        diaSemana: DiaSemana.segunda,
        tipoRefeicao: TipoRefeicao.almoco,
      },
    });
    return { plano, item };
  }

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();

    vendedor = await criarUsuario('vendedor', TipoUsuario.comum);
    comprador = await criarUsuario('comprador', TipoUsuario.paciente);
    outro = await criarUsuario('outro', TipoUsuario.comum);
    const nutri = await criarUsuario('nutri', TipoUsuario.profissional);
    profissionalId = (
      await prisma.profissional.create({
        data: {
          usuarioId: nutri.id,
          registroProfissional: `CRN-${sufixo}`,
          statusAprovacao: StatusAprovacao.aprovado,
        },
      })
    ).id;
    pacienteId = (
      await prisma.paciente.create({
        data: { usuarioId: comprador.id, profissionalId },
      })
    ).id;

    originalId = (
      await prisma.receita.create({
        data: {
          nome: `Bolo ${sufixo}`,
          criadoPor: vendedor.id,
          status: StatusReceita.aprovada,
        },
      })
    ).id;
    ofertaId = (
      await prisma.receitaOferta.create({
        data: { receitaId: originalId, preco: PRECO },
      })
    ).id;

    service = new ReembolsoService(
      prisma,
      { get: () => 7 } as unknown as ConfigService,
      {
        tokenDoVendedor: async () => 'token-vendedor',
      } as unknown as RecebedorService,
      mercadoPago as unknown as MercadoPagoService,
      new NotificacaoService(prisma),
    );
    planos = new PlanoAlimentarService(prisma);
    checklist = new ChecklistRefeicaoService(prisma);
  });

  /** Compra paga com cópia, como o webhook deixa. */
  beforeEach(async () => {
    mercadoPago.estornar.mockReset();
    mercadoPago.buscarPagamento.mockReset();
    estornoAprovado();

    const pagaEm = new Date(Date.now() - 60_000);
    copiaId = (
      await prisma.receita.create({
        data: {
          nome: `Bolo ${sufixo}`,
          criadoPor: vendedor.id,
          status: StatusReceita.aprovada,
        },
      })
    ).id;
    compraId = (
      await prisma.receitaCompra.create({
        data: {
          ofertaId,
          compradorId: comprador.id,
          precoPago: PRECO,
          taxaPlataforma: new Prisma.Decimal('4.49'),
          versaoComprada: 1,
          conteudoComprado: {},
          status: StatusCompraReceita.paga,
          pagaEm,
          receitaCopiaId: copiaId,
        },
      })
    ).id;
    gatewayId = `mp-${randomUUID()}`;
    pagamentoId = (
      await prisma.pagamento.create({
        data: {
          receitaCompraId: compraId,
          valor: PRECO,
          statusPagamento: StatusPagamento.pago,
          gatewayCobrancaId: gatewayId,
          dataPagamento: pagaEm,
        },
      })
    ).id;
  });

  afterEach(async () => {
    const dosTestes = {
      criadoPor: { in: ids.usuarios },
      id: { not: originalId },
    };
    await prisma.notificacao.deleteMany({
      where: { usuarioId: { in: ids.usuarios } },
    });
    await prisma.checklistRefeicao.deleteMany({ where: { pacienteId } });
    await prisma.planoAlimentarItem.deleteMany({
      where: { planoAlimentar: { profissionalId } },
    });
    await prisma.planoAlimentar.deleteMany({ where: { profissionalId } });
    await prisma.receitaAdaptacao.deleteMany({
      where: { receitaOrigem: dosTestes },
    });
    await prisma.pagamento.deleteMany({
      where: { receitaCompra: { compradorId: comprador.id } },
    });
    await prisma.receitaCompra.deleteMany({
      where: { compradorId: comprador.id },
    });
    await prisma.receita.deleteMany({ where: dosTestes });
  });

  afterAll(async () => {
    await prisma.receitaOferta.deleteMany({ where: { id: ofertaId } });
    await prisma.receita.deleteMany({ where: { id: originalId } });
    await prisma.paciente.deleteMany({ where: { id: pacienteId } });
    await prisma.profissional.deleteMany({ where: { id: profissionalId } });
    await prisma.usuario.deleteMany({ where: { id: { in: ids.usuarios } } });
    await prisma.conta.deleteMany({ where: { id: { in: ids.contas } } });
    await prisma.$disconnect();
  });

  describe('pedido do comprador', () => {
    it('cópia nunca usada: estorna na hora, tira a cópia do ar e avisa os dois lados', async () => {
      const r = await service.solicitar(compraId, comprador, {
        motivo: 'Comprei por engano',
      });

      expect(r).toEqual({ compraId, status: StatusCompraReceita.reembolsada });
      expect(mercadoPago.estornar).toHaveBeenCalledWith(
        'token-vendedor',
        gatewayId,
        expect.any(String),
      );
      const compra = await compraAtual();
      expect(compra.status).toBe(StatusCompraReceita.reembolsada);
      expect(compra.reembolsoMotivo).toBe('Comprei por engano');
      expect(compra.reembolsoSolicitadoEm).not.toBeNull();
      expect(compra.reembolsoResolvidoEm).not.toBeNull();
      expect((await pagamentoAtual()).statusPagamento).toBe(
        StatusPagamento.reembolsado,
      );
      expect((await copiaAtual()).deletedAt).not.toBeNull();
      expect(await notificacoesDe(comprador.id)).toHaveLength(1);
      expect(await notificacoesDe(vendedor.id)).toHaveLength(1);
    });

    it.each([
      [
        'aberta',
        async () => {
          await prisma.receitaCompra.update({
            where: { id: compraId },
            data: { primeiroAcessoEm: new Date() },
          });
        },
      ],
      ['adaptada', () => adaptacaoDaCopia()],
      ['em plano alimentar', () => planoCom(copiaId)],
      [
        'com uma adaptação em plano alimentar',
        async () => planoCom((await adaptacaoDaCopia()).id),
      ],
      [
        'em plano alimentar desativado',
        async () => {
          const { plano } = await planoCom(copiaId);
          await prisma.planoAlimentar.update({
            where: { id: plano.id },
            data: { ativo: false },
          });
        },
      ],
    ])('cópia %s: vai para a análise, sem estorno', async (_, usar) => {
      await usar();

      const r = await service.solicitar(compraId, comprador, {});

      expect(r.status).toBe(StatusCompraReceita.reembolso_em_analise);
      expect(mercadoPago.estornar).not.toHaveBeenCalled();
      expect((await copiaAtual()).deletedAt).toBeNull();
      expect((await pagamentoAtual()).statusPagamento).toBe(
        StatusPagamento.pago,
      );
    });

    it.each([
      [
        'o Mercado Pago recusa (vendedor sem saldo)',
        () => mercadoPago.estornar.mockRejectedValue(new BadGatewayException()),
      ],
      [
        'o estorno fica pendente',
        () =>
          mercadoPago.estornar.mockResolvedValue({
            id: 'r',
            valor: 29.9,
            status: 'pendente',
          }),
      ],
      [
        'o estorno sai parcial',
        () =>
          mercadoPago.estornar.mockResolvedValue({
            id: 'r',
            valor: 10,
            status: 'aprovado',
          }),
      ],
    ])(
      'estorno automático que não sai inteiro (%s): cai na análise',
      async (_, falhar) => {
        falhar();
        mercadoPago.buscarPagamento.mockResolvedValue({ status: 'aprovado' });

        const r = await service.solicitar(compraId, comprador, {});

        expect(r.status).toBe(StatusCompraReceita.reembolso_em_analise);
        expect((await copiaAtual()).deletedAt).toBeNull();
        expect((await pagamentoAtual()).statusPagamento).toBe(
          StatusPagamento.pago,
        );
      },
    );

    it('a resposta do estorno se perdeu, mas ele saiu: conta como feito', async () => {
      mercadoPago.estornar.mockRejectedValue(new BadGatewayException());
      mercadoPago.buscarPagamento.mockResolvedValue({ status: 'estornado' });

      const r = await service.solicitar(compraId, comprador, {});

      expect(r.status).toBe(StatusCompraReceita.reembolsada);
    });

    it('depois do prazo: 422 e a compra continua paga', async () => {
      await expect(
        service.solicitar(
          compraId,
          comprador,
          {},
          new Date(Date.now() + 8 * 24 * 60 * 60 * 1000),
        ),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect((await compraAtual()).status).toBe(StatusCompraReceita.paga);
    });

    it('compra de outro usuário: 404', async () => {
      await expect(
        service.solicitar(compraId, outro, {}),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('um pedido por compra, mesmo depois de negado', async () => {
      await prisma.receitaCompra.update({
        where: { id: compraId },
        data: { primeiroAcessoEm: new Date() },
      });
      await service.solicitar(compraId, comprador, {});
      await service.resolver(compraId, { aprovado: false });

      await expect(
        service.solicitar(compraId, comprador, {}),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('dois pedidos ao mesmo tempo: um passa, o outro 409, um estorno só', async () => {
      const resultados = await Promise.allSettled([
        service.solicitar(compraId, comprador, {}),
        service.solicitar(compraId, comprador, {}),
      ]);

      expect(resultados.map((r) => r.status).sort()).toEqual([
        'fulfilled',
        'rejected',
      ]);
      const falha = resultados.find(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      )!;
      expect(falha.reason).toBeInstanceOf(ConflictException);
      expect(mercadoPago.estornar).toHaveBeenCalledTimes(1);
    });
  });

  describe('decisão do admin', () => {
    beforeEach(async () => {
      await prisma.receitaCompra.update({
        where: { id: compraId },
        data: { primeiroAcessoEm: new Date() },
      });
      await service.solicitar(compraId, comprador, { motivo: 'Não gostei' });
    });

    it('a fila mostra o pedido com o motivo e o uso da cópia', async () => {
      const { pedidos } = await service.fila();

      expect(pedidos.find((p) => p.id === compraId)).toMatchObject({
        reembolsoMotivo: 'Não gostei',
        precoPago: 29.9,
        receita: { id: originalId },
        comprador: { id: comprador.id },
        adaptada: false,
        emPlano: false,
      });
    });

    it('negado: volta para paga e avisa o comprador', async () => {
      const r = await service.resolver(compraId, { aprovado: false });

      expect(r.status).toBe(StatusCompraReceita.paga);
      expect((await compraAtual()).reembolsoResolvidoEm).not.toBeNull();
      expect(mercadoPago.estornar).not.toHaveBeenCalled();
      expect(await notificacoesDe(comprador.id)).toHaveLength(1);
      expect(await notificacoesDe(vendedor.id)).toHaveLength(0);
    });

    it('aprovado: estorna e tira do ar a cópia, as adaptações e os itens de plano', async () => {
      const adaptada = await adaptacaoDaCopia();
      const { plano, item } = await planoCom(adaptada.id);

      const r = await service.resolver(compraId, { aprovado: true });

      expect(r.status).toBe(StatusCompraReceita.reembolsada);
      expect((await copiaAtual()).deletedAt).not.toBeNull();
      expect(
        (await prisma.receita.findUniqueOrThrow({ where: { id: adaptada.id } }))
          .deletedAt,
      ).not.toBeNull();

      // O item some do plano, mas fica no banco com o histórico.
      const visto = await planos.findPlanoAlimentar(
        plano.id,
        comprador.id,
        TipoUsuario.paciente,
      );
      expect(visto.itens).toEqual([]);
      expect(
        await prisma.planoAlimentarItem.findUnique({ where: { id: item.id } }),
      ).not.toBeNull();
      await expect(
        checklist.marcarCheckList(item.id, pacienteId, {
          dataReferencial: '2026-11-20',
          concluido: true,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('aprovado: outro item no mesmo dia e refeição toma o lugar do que saiu', async () => {
      const { plano, item } = await planoCom(copiaId);
      await service.resolver(compraId, { aprovado: true });
      const outra = await prisma.receita.create({
        data: {
          nome: `Salada ${sufixo}`,
          criadoPor: vendedor.id,
          status: StatusReceita.aprovada,
        },
      });

      const novo = await planos.adicionarItemAoPlano(
        plano.id,
        {
          receitaId: outra.id,
          diaSemana: DiaSemana.segunda,
          tipoRefeicao: TipoRefeicao.almoco,
          horarioSugerido: '12:30',
        },
        profissionalId,
      );

      expect(novo.id).toBe(item.id);
      const visto = await planos.findPlanoAlimentar(
        plano.id,
        comprador.id,
        TipoUsuario.paciente,
      );
      expect(visto.itens.map((i) => i.receita.id)).toEqual([outra.id]);
    });

    it('aprovado, mas o estorno não sai inteiro: 422 e continua em análise', async () => {
      mercadoPago.estornar.mockRejectedValue(new BadGatewayException());
      mercadoPago.buscarPagamento.mockResolvedValue({ status: 'aprovado' });

      await expect(
        service.resolver(compraId, { aprovado: true }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect((await compraAtual()).status).toBe(
        StatusCompraReceita.reembolso_em_analise,
      );
      expect((await copiaAtual()).deletedAt).toBeNull();
    });

    it('negado enquanto o estorno saía: fica reembolsada, porque o dinheiro voltou', async () => {
      mercadoPago.estornar.mockImplementation(async () => {
        await service.resolver(compraId, { aprovado: false });
        return { id: 'r', valor: 29.9, status: 'aprovado' };
      });

      await service.resolver(compraId, { aprovado: true });

      expect((await compraAtual()).status).toBe(
        StatusCompraReceita.reembolsada,
      );
    });

    it('compra que não está em análise: 409', async () => {
      await service.resolver(compraId, { aprovado: false });

      await expect(
        service.resolver(compraId, { aprovado: true }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('estorno feito fora da API (aviso do webhook)', () => {
    it('do pagamento que liberou a cópia: conclui como reembolso', async () => {
      await service.sincronizarEstorno(gatewayId);

      const compra = await compraAtual();
      expect(compra.status).toBe(StatusCompraReceita.reembolsada);
      expect((await pagamentoAtual()).statusPagamento).toBe(
        StatusPagamento.reembolsado,
      );
      expect((await copiaAtual()).deletedAt).not.toBeNull();
      expect(await notificacoesDe(comprador.id)).toHaveLength(1);
      expect(await notificacoesDe(vendedor.id)).toHaveLength(1);
      expect(mercadoPago.estornar).not.toHaveBeenCalled();
    });

    it('com pedido em análise: também conclui', async () => {
      await prisma.receitaCompra.update({
        where: { id: compraId },
        data: { primeiroAcessoEm: new Date() },
      });
      await service.solicitar(compraId, comprador, {});

      await service.sincronizarEstorno(gatewayId);

      expect((await compraAtual()).status).toBe(
        StatusCompraReceita.reembolsada,
      );
    });

    it('aviso repetido não notifica de novo', async () => {
      await service.sincronizarEstorno(gatewayId);
      await service.sincronizarEstorno(gatewayId);

      expect(await notificacoesDe(comprador.id)).toHaveLength(1);
    });

    it('pagamento que a API não conhece: não faz nada', async () => {
      await expect(
        service.sincronizarEstorno('mp-que-nao-existe'),
      ).resolves.toBeUndefined();
      expect((await compraAtual()).status).toBe(StatusCompraReceita.paga);
    });
  });

  describe('cobrança em dobro', () => {
    let duplicadoId: string;

    beforeEach(async () => {
      // Segundo link pago: compra cancelada com um pagamento aprovado.
      const cancelada = await prisma.receitaCompra.create({
        data: {
          ofertaId,
          compradorId: comprador.id,
          precoPago: PRECO,
          taxaPlataforma: new Prisma.Decimal('4.49'),
          versaoComprada: 1,
          conteudoComprado: {},
          status: StatusCompraReceita.cancelada,
        },
      });
      duplicadoId = (
        await prisma.pagamento.create({
          data: {
            receitaCompraId: cancelada.id,
            valor: PRECO,
            statusPagamento: StatusPagamento.pago,
            gatewayCobrancaId: `mp-${randomUUID()}`,
            dataPagamento: new Date(),
          },
        })
      ).id;
    });

    it('aparece na fila; o pagamento que liberou a cópia não', async () => {
      const { cobrancasDuplicadas } = await service.fila();
      const ids = cobrancasDuplicadas.map((c) => c.pagamentoId);

      expect(ids).toContain(duplicadoId);
      expect(ids).not.toContain(pagamentoId);
    });

    it('estorna, sai da fila e não estorna duas vezes', async () => {
      const r = await service.estornarCobrancaDuplicada(duplicadoId);

      expect(r.statusPagamento).toBe(StatusPagamento.reembolsado);
      const { cobrancasDuplicadas } = await service.fila();
      expect(cobrancasDuplicadas.map((c) => c.pagamentoId)).not.toContain(
        duplicadoId,
      );
      await expect(
        service.estornarCobrancaDuplicada(duplicadoId),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(mercadoPago.estornar).toHaveBeenCalledTimes(1);
      // A compra paga do comprador não muda.
      expect((await compraAtual()).status).toBe(StatusCompraReceita.paga);
    });

    it('compra cancelada que chegou a ter cópia: o pagamento também volta', async () => {
      const cancelada = await prisma.receitaCompra.create({
        data: {
          ofertaId,
          compradorId: comprador.id,
          precoPago: PRECO,
          taxaPlataforma: new Prisma.Decimal('4.49'),
          versaoComprada: 1,
          conteudoComprado: {},
          status: StatusCompraReceita.cancelada,
          pagaEm: new Date(),
          receitaCopiaId: (
            await prisma.receita.create({
              data: {
                nome: `Cópia antiga ${sufixo}`,
                criadoPor: vendedor.id,
                status: StatusReceita.aprovada,
              },
            })
          ).id,
        },
      });
      const pago = await prisma.pagamento.create({
        data: {
          receitaCompraId: cancelada.id,
          valor: PRECO,
          statusPagamento: StatusPagamento.pago,
          gatewayCobrancaId: `mp-${randomUUID()}`,
          dataPagamento: cancelada.pagaEm,
        },
      });

      const { cobrancasDuplicadas } = await service.fila();

      expect(cobrancasDuplicadas.map((c) => c.pagamentoId)).toContain(pago.id);
    });

    it('estornada fora da API: só o pagamento muda, a compra paga fica', async () => {
      const duplicado = await prisma.pagamento.findUniqueOrThrow({
        where: { id: duplicadoId },
      });

      await service.sincronizarEstorno(duplicado.gatewayCobrancaId!);

      expect(
        (
          await prisma.pagamento.findUniqueOrThrow({
            where: { id: duplicadoId },
          })
        ).statusPagamento,
      ).toBe(StatusPagamento.reembolsado);
      expect((await compraAtual()).status).toBe(StatusCompraReceita.paga);
      expect((await copiaAtual()).deletedAt).toBeNull();
    });

    it('o pagamento que liberou a cópia não é cobrança em dobro', async () => {
      await expect(
        service.estornarCobrancaDuplicada(pagamentoId),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(mercadoPago.estornar).not.toHaveBeenCalled();
    });
  });
});
