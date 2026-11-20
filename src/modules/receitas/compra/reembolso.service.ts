import {
  BadGatewayException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, StatusCompraReceita, StatusPagamento } from '@prisma/client';
import { randomUUID } from 'crypto';
import { UsuarioAutenticado } from '../../../auth/auth.types';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { MercadoPagoService } from '../../marketplace/mercado-pago/mercado-pago.service';
import { RecebedorService } from '../../marketplace/recebedor/recebedor.service';
import { NotificacaoService } from '../../notificacao/notificacao.service';
import { CreateReembolsoDto, ResolverReembolsoDto } from './dtos/reembolso';

const DIA_MS = 24 * 60 * 60 * 1000;

/** Status em que a compra deu (ou deu e devolveu) acesso à cópia. */
const STATUS_COM_ACESSO: StatusCompraReceita[] = [
  StatusCompraReceita.paga,
  StatusCompraReceita.reembolso_em_analise,
  StatusCompraReceita.reembolsada,
];

const ESTORNO_INCOMPLETO =
  'O Mercado Pago não estornou o valor inteiro (o vendedor pode estar sem saldo ou desconectado).';

/** O que o reembolso precisa saber da compra. */
const COMPRA_REEMBOLSO = {
  id: true,
  status: true,
  compradorId: true,
  precoPago: true,
  pagaEm: true,
  primeiroAcessoEm: true,
  reembolsoSolicitadoEm: true,
  receitaCopiaId: true,
  oferta: {
    select: {
      receitaId: true,
      receita: { select: { nome: true, criadoPor: true } },
    },
  },
} satisfies Prisma.ReceitaCompraSelect;

type CompraReembolso = Prisma.ReceitaCompraGetPayload<{
  select: typeof COMPRA_REEMBOLSO;
}>;

interface PagamentoEstornavel {
  id: string;
  gatewayCobrancaId: string | null;
  valor: Prisma.Decimal;
}

/**
 * Reembolso de receita comprada (seção 4.7 de decisoes_marketplace.md).
 *
 * O comprador pede em até MARKETPLACE_REEMBOLSO_DIAS. Cópia nunca usada
 * (sem primeiro acesso, sem adaptação e fora de plano alimentar) é estornada
 * na hora; o resto, ou o estorno automático que não sai inteiro, vai para a
 * análise do admin. O estorno no Mercado Pago é a fonte da verdade: depois
 * que ele sai, a compra fica `reembolsada`, mesmo que alguém tenha negado o
 * pedido no meio do caminho.
 *
 * Também estorna as cobranças em dobro: pagamento aprovado que o webhook
 * registrou sem liberar cópia, porque o comprador já tinha a receita.
 */
@Injectable()
export class ReembolsoService {
  private readonly logger = new Logger(ReembolsoService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly configService: ConfigService,
    private readonly recebedor: RecebedorService,
    private readonly mercadoPago: MercadoPagoService,
    private readonly notificacao: NotificacaoService,
  ) {}

  /** Pedido do comprador. Devolve o novo status da compra. */
  async solicitar(
    compraId: string,
    usuario: UsuarioAutenticado,
    dto: CreateReembolsoDto,
    agora = new Date(),
  ) {
    const compra = await this.prismaService.receitaCompra.findFirst({
      where: { id: compraId, compradorId: usuario.id },
      select: COMPRA_REEMBOLSO,
    });
    if (!compra) {
      throw new NotFoundException('Compra não encontrada.');
    }
    if (
      compra.status !== StatusCompraReceita.paga ||
      compra.reembolsoSolicitadoEm
    ) {
      throw new ConflictException(
        'Só uma compra paga, sem pedido de reembolso anterior, pode ser reembolsada.',
      );
    }
    const prazo = new Date(compra.pagaEm!.getTime() + this.dias() * DIA_MS);
    if (agora > prazo) {
      throw new UnprocessableEntityException(
        `O prazo de ${this.dias()} dias para pedir o reembolso terminou.`,
      );
    }

    // Um pedido por compra: dois pedidos ao mesmo tempo, só um passa.
    const { count } = await this.prismaService.receitaCompra.updateMany({
      where: {
        id: compra.id,
        status: StatusCompraReceita.paga,
        reembolsoSolicitadoEm: null,
      },
      data: {
        status: StatusCompraReceita.reembolso_em_analise,
        reembolsoSolicitadoEm: agora,
        reembolsoMotivo: dto.motivo?.trim() || null,
      },
    });
    if (count === 0) {
      throw new ConflictException(
        'Só uma compra paga, sem pedido de reembolso anterior, pode ser reembolsada.',
      );
    }

    // Lido depois de marcar o pedido: uma abertura até aqui já conta.
    if (await this.copiaUsada(compra.id)) {
      return {
        compraId: compra.id,
        status: StatusCompraReceita.reembolso_em_analise,
      };
    }

    const pagamento = await this.pagamentoDaCompra(compra);
    try {
      await this.estornar(pagamento, compra.oferta.receita.criadoPor);
    } catch (erro) {
      // Não saiu inteiro ou o Mercado Pago não respondeu: cai na análise.
      this.logger.warn(
        `Estorno automático da compra ${compra.id} não saiu (${(erro as Error).message}); vai para a análise.`,
      );
      return {
        compraId: compra.id,
        status: StatusCompraReceita.reembolso_em_analise,
      };
    }
    await this.concluir(compra, pagamento.id, agora);
    return { compraId: compra.id, status: StatusCompraReceita.reembolsada };
  }

  /**
   * Fila do admin: os pedidos em análise, mais antigos primeiro, e as
   * cobranças em dobro cujo estorno automático não saiu.
   */
  async fila() {
    const pedidos = await this.prismaService.receitaCompra.findMany({
      where: { status: StatusCompraReceita.reembolso_em_analise },
      select: {
        id: true,
        precoPago: true,
        pagaEm: true,
        primeiroAcessoEm: true,
        reembolsoSolicitadoEm: true,
        reembolsoMotivo: true,
        receitaCopiaId: true,
        comprador: { select: { id: true, nome: true } },
        oferta: { select: { receita: { select: { id: true, nome: true } } } },
      },
      orderBy: { reembolsoSolicitadoEm: 'asc' },
    });

    const comUso = await Promise.all(
      pedidos.map(async ({ oferta, receitaCopiaId, ...pedido }) => ({
        ...pedido,
        precoPago: Number(pedido.precoPago),
        receita: oferta.receita,
        receitaCopiaId,
        ...(await this.usoDaCopia(receitaCopiaId)),
      })),
    );

    return {
      pedidos: comUso,
      cobrancasDuplicadas: await this.cobrancasDuplicadas(),
    };
  }

  /** Decisão do admin sobre um pedido em análise. */
  async resolver(
    compraId: string,
    dto: ResolverReembolsoDto,
    agora = new Date(),
  ) {
    const compra = await this.prismaService.receitaCompra.findUnique({
      where: { id: compraId },
      select: COMPRA_REEMBOLSO,
    });
    if (!compra) {
      throw new NotFoundException('Compra não encontrada.');
    }
    if (compra.status !== StatusCompraReceita.reembolso_em_analise) {
      throw new ConflictException('A compra não está em análise de reembolso.');
    }

    if (!dto.aprovado) {
      const { count } = await this.prismaService.$transaction(async (tx) => {
        const resultado = await tx.receitaCompra.updateMany({
          where: {
            id: compra.id,
            status: StatusCompraReceita.reembolso_em_analise,
          },
          data: {
            status: StatusCompraReceita.paga,
            reembolsoResolvidoEm: agora,
          },
        });
        if (resultado.count > 0) {
          await this.notificacao.criar(
            {
              usuarioId: compra.compradorId,
              codigo: 'reembolso_resolvido',
              titulo: 'Reembolso negado',
              mensagem: `O pedido de reembolso da receita "${compra.oferta.receita.nome}" foi negado. A receita continua com você.`,
              referencia: { receitaId: compra.oferta.receitaId },
            },
            tx,
          );
        }
        return resultado;
      });
      if (count === 0) {
        throw new ConflictException(
          'A compra não está em análise de reembolso.',
        );
      }
      return { compraId: compra.id, status: StatusCompraReceita.paga };
    }

    const pagamento = await this.pagamentoDaCompra(compra);
    try {
      await this.estornar(pagamento, compra.oferta.receita.criadoPor);
    } catch (erro) {
      if (erro instanceof UnprocessableEntityException) {
        throw new UnprocessableEntityException(
          `${ESTORNO_INCOMPLETO} O pedido continua em análise.`,
        );
      }
      throw erro;
    }
    await this.concluir(compra, pagamento.id, agora);
    return { compraId: compra.id, status: StatusCompraReceita.reembolsada };
  }

  /**
   * Estorna uma cobrança em dobro (pagamento aprovado registrado sem
   * cópia). Chamado pelo webhook logo depois de registrar o pagamento e
   * pelo admin, quando aquela tentativa não saiu.
   */
  async estornarCobrancaDuplicada(pagamentoId: string) {
    const duplicada = (await this.cobrancasDuplicadas()).find(
      (c) => c.pagamentoId === pagamentoId,
    );
    if (!duplicada) {
      throw new ConflictException(
        'O pagamento não é uma cobrança em dobro pendente de estorno.',
      );
    }
    const pagamento = await this.prismaService.pagamento.findUniqueOrThrow({
      where: { id: pagamentoId },
      select: { id: true, gatewayCobrancaId: true, valor: true },
    });
    await this.estornar(pagamento, duplicada.vendedorId);

    await this.prismaService.pagamento.updateMany({
      where: { id: pagamentoId, statusPagamento: StatusPagamento.pago },
      data: { statusPagamento: StatusPagamento.reembolsado },
    });
    return { pagamentoId, statusPagamento: StatusPagamento.reembolsado };
  }

  /**
   * Estorno feito fora da API (painel do Mercado Pago, contestação no
   * cartão), avisado pelo webhook. Se foi o pagamento que liberou a cópia,
   * conclui como um reembolso: compra `reembolsada`, cópia e adaptações
   * fora do ar e os dois lados avisados. Senão, só marca o pagamento.
   * Pagamento que a API não conhece ou já marcado: não faz nada.
   */
  async sincronizarEstorno(gatewayCobrancaId: string, agora = new Date()) {
    const pagamento = await this.prismaService.pagamento.findUnique({
      where: { gatewayCobrancaId },
      select: {
        id: true,
        statusPagamento: true,
        dataPagamento: true,
        receitaCompra: { select: COMPRA_REEMBOLSO },
      },
    });
    if (
      !pagamento ||
      pagamento.statusPagamento !== StatusPagamento.pago ||
      !pagamento.receitaCompra
    ) {
      return;
    }

    const compra = pagamento.receitaCompra;
    const liberouACopia =
      STATUS_COM_ACESSO.includes(compra.status) &&
      !!compra.receitaCopiaId &&
      !!compra.pagaEm &&
      pagamento.dataPagamento?.getTime() === compra.pagaEm.getTime();

    if (liberouACopia) {
      await this.concluir(compra, pagamento.id, agora);
    }
    // Cobrança em dobro, ou compra já reembolsada por outro caminho.
    await this.prismaService.pagamento.updateMany({
      where: { id: pagamento.id, statusPagamento: StatusPagamento.pago },
      data: { statusPagamento: StatusPagamento.reembolsado },
    });
    this.logger.log(
      `Estorno do pagamento ${gatewayCobrancaId} feito fora da API sincronizado (compra ${compra.id}${liberouACopia ? ', cópia fora do ar' : ''}).`,
    );
  }

  /**
   * Pagamentos aprovados que não deram acesso a uma cópia: os de compras
   * fora dos status com cópia (ex.: `cancelada`, mesmo que uma cópia tenha
   * chegado a ser criada) e, nas outras, os que não são o que a liberou (a
   * data dele é o `pagaEm` da compra, gravados juntos no webhook).
   */
  private async cobrancasDuplicadas() {
    const pagos = await this.prismaService.pagamento.findMany({
      where: {
        statusPagamento: StatusPagamento.pago,
        receitaCompraId: { not: null },
      },
      select: {
        id: true,
        valor: true,
        dataPagamento: true,
        createdAt: true,
        receitaCompra: {
          select: {
            id: true,
            status: true,
            pagaEm: true,
            receitaCopiaId: true,
            comprador: { select: { id: true, nome: true } },
            oferta: {
              select: {
                receita: { select: { id: true, nome: true, criadoPor: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const liberadores = new Set<string>();
    const comprasLiberadas = new Set<string>();
    for (const p of pagos) {
      const compra = p.receitaCompra!;
      if (
        STATUS_COM_ACESSO.includes(compra.status) &&
        compra.receitaCopiaId &&
        compra.pagaEm &&
        !comprasLiberadas.has(compra.id) &&
        p.dataPagamento?.getTime() === compra.pagaEm.getTime()
      ) {
        liberadores.add(p.id);
        comprasLiberadas.add(compra.id);
      }
    }

    return pagos
      .filter((p) => !liberadores.has(p.id))
      .map((p) => {
        const compra = p.receitaCompra!;
        return {
          pagamentoId: p.id,
          valor: Number(p.valor),
          pagoEm: p.dataPagamento,
          compraId: compra.id,
          statusCompra: compra.status,
          comprador: compra.comprador,
          receita: {
            id: compra.oferta.receita.id,
            nome: compra.oferta.receita.nome,
          },
          vendedorId: compra.oferta.receita.criadoPor,
        };
      });
  }

  /**
   * Estorno total no Mercado Pago. Só vale se sair aprovado e com o valor
   * inteiro. Se a resposta se perder depois de o estorno sair, a consulta do
   * pagamento mostra `estornado` e conta como feito.
   */
  private async estornar(pagamento: PagamentoEstornavel, vendedorId: string) {
    if (!pagamento.gatewayCobrancaId) {
      throw new UnprocessableEntityException(ESTORNO_INCOMPLETO);
    }
    const token = await this.recebedor.tokenDoVendedor(vendedorId);
    let estorno: Awaited<ReturnType<MercadoPagoService['estornar']>>;
    try {
      estorno = await this.mercadoPago.estornar(
        token,
        pagamento.gatewayCobrancaId,
        randomUUID(),
      );
    } catch (erro) {
      if (await this.jaEstornado(token, pagamento.gatewayCobrancaId)) return;
      // Recusa do Mercado Pago (ex.: vendedor sem saldo) é estorno que não
      // saiu; falha de rede continua 503.
      if (erro instanceof BadGatewayException) {
        throw new UnprocessableEntityException(ESTORNO_INCOMPLETO);
      }
      throw erro;
    }
    if (
      estorno.status !== 'aprovado' ||
      new Prisma.Decimal(estorno.valor).lessThan(pagamento.valor)
    ) {
      throw new UnprocessableEntityException(ESTORNO_INCOMPLETO);
    }
  }

  private async jaEstornado(token: string, gatewayCobrancaId: string) {
    try {
      const p = await this.mercadoPago.buscarPagamento(
        token,
        gatewayCobrancaId,
      );
      return p.status === 'estornado';
    } catch {
      return false;
    }
  }

  /**
   * Depois do estorno: compra `reembolsada`, pagamento `reembolsado`, cópia
   * e adaptações dela fora do ar (os itens de plano que as usam somem das
   * leituras do plano) e os dois lados notificados. Aceita a compra `paga`
   * também: se o admin negou enquanto o estorno saía, o dinheiro já voltou.
   */
  private async concluir(
    compra: CompraReembolso,
    pagamentoId: string,
    agora: Date,
  ) {
    await this.prismaService.$transaction(async (tx) => {
      const { count } = await tx.receitaCompra.updateMany({
        where: {
          id: compra.id,
          status: {
            in: [
              StatusCompraReceita.reembolso_em_analise,
              StatusCompraReceita.paga,
            ],
          },
        },
        data: {
          status: StatusCompraReceita.reembolsada,
          reembolsoResolvidoEm: agora,
        },
      });
      if (count === 0) return;

      await tx.pagamento.update({
        where: { id: pagamentoId },
        data: { statusPagamento: StatusPagamento.reembolsado },
      });

      if (compra.receitaCopiaId) {
        const adaptadas = await tx.receitaAdaptacao.findMany({
          where: { receitaOrigemId: compra.receitaCopiaId },
          select: { receitaAdaptadaId: true },
        });
        await tx.receita.updateMany({
          where: {
            id: {
              in: [
                compra.receitaCopiaId,
                ...adaptadas.map((a) => a.receitaAdaptadaId),
              ],
            },
            deletedAt: null,
          },
          data: { deletedAt: agora },
        });
      }

      const { receitaId, receita } = compra.oferta;
      await this.notificacao.criar(
        {
          usuarioId: compra.compradorId,
          codigo: 'reembolso_resolvido',
          titulo: 'Reembolso aprovado',
          mensagem: `O valor da receita "${receita.nome}" foi devolvido.`,
          referencia: { receitaId },
        },
        tx,
      );
      await this.notificacao.criar(
        {
          usuarioId: receita.criadoPor,
          codigo: 'reembolso_resolvido',
          titulo: 'Venda reembolsada',
          mensagem: `Uma compra da sua receita "${receita.nome}" foi reembolsada ao comprador.`,
          referencia: { receitaId },
        },
        tx,
      );
    });
  }

  /** O pagamento que liberou a cópia. */
  private async pagamentoDaCompra(
    compra: CompraReembolso,
  ): Promise<PagamentoEstornavel> {
    const pagamento = await this.prismaService.pagamento.findFirst({
      where: {
        receitaCompraId: compra.id,
        statusPagamento: StatusPagamento.pago,
        ...(compra.pagaEm ? { dataPagamento: compra.pagaEm } : {}),
      },
      select: { id: true, gatewayCobrancaId: true, valor: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!pagamento) {
      throw new ConflictException('A compra não tem pagamento para estornar.');
    }
    return pagamento;
  }

  /**
   * A cópia foi usada: aberta, adaptada (a adaptada traz o conteúdo inteiro)
   * ou posta em algum plano alimentar, ela ou uma adaptação dela.
   */
  private async copiaUsada(compraId: string) {
    const compra = await this.prismaService.receitaCompra.findUniqueOrThrow({
      where: { id: compraId },
      select: { primeiroAcessoEm: true, receitaCopiaId: true },
    });
    if (compra.primeiroAcessoEm || !compra.receitaCopiaId) return true;
    const uso = await this.usoDaCopia(compra.receitaCopiaId);
    return uso.adaptada || uso.emPlano;
  }

  private async usoDaCopia(copiaId: string | null) {
    if (!copiaId) return { adaptada: false, emPlano: false };
    const [adaptacoes, itensDePlano] = await Promise.all([
      this.prismaService.receitaAdaptacao.count({
        where: { receitaOrigemId: copiaId },
      }),
      this.prismaService.planoAlimentarItem.count({
        where: {
          receita: {
            OR: [
              { id: copiaId },
              { adaptacaoDe: { is: { receitaOrigemId: copiaId } } },
            ],
          },
        },
      }),
    ]);
    return { adaptada: adaptacoes > 0, emPlano: itensDePlano > 0 };
  }

  private dias() {
    return this.configService.get<number>('MARKETPLACE_REEMBOLSO_DIAS') ?? 7;
  }
}
