import {
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  Prisma,
  StatusCompraReceita,
  StatusPagamento,
  StatusReceita,
} from '@prisma/client';
import { isUUID } from 'class-validator';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { MercadoPagoService } from '../../marketplace/mercado-pago/mercado-pago.service';
import { PagamentoMercadoPago } from '../../marketplace/mercado-pago/mercado-pago.types';
import { RecebedorService } from '../../marketplace/recebedor/recebedor.service';
import { NotificacaoService } from '../../notificacao/notificacao.service';
import { STATUS_VIVOS } from './compra.service';
import { ConteudoComprado } from './compra.types';

const COMPRA_DO_AVISO = {
  id: true,
  ofertaId: true,
  compradorId: true,
  precoPago: true,
  conteudoComprado: true,
  oferta: {
    select: {
      receitaId: true,
      receita: {
        select: {
          nome: true,
          criadoPor: true,
          criador: {
            select: {
              contaRecebedor: { select: { gatewayRecebedorId: true } },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.ReceitaCompraSelect;

type CompraDoAviso = Prisma.ReceitaCompraGetPayload<{
  select: typeof COMPRA_DO_AVISO;
}>;

/**
 * Processa os avisos de pagamento do Mercado Pago. Só o pagamento aprovado
 * muda a compra: recusado deixa a compra pendente (o comprador pode tentar
 * outro cartão no mesmo link) e quem cancela é o vencimento da preferência.
 *
 * Erro relançado vira resposta não-2xx, e o Mercado Pago reenvia o aviso.
 * Casos que um reenvio não resolve só vão para o log e respondem 200.
 */
@Injectable()
export class WebhookCompraService {
  private readonly logger = new Logger(WebhookCompraService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly recebedor: RecebedorService,
    private readonly mercadoPago: MercadoPagoService,
    private readonly notificacao: NotificacaoService,
  ) {}

  async processar(
    contaMercadoPagoId: string,
    pagamentoId: string,
    agora = new Date(),
  ): Promise<void> {
    let token: string;
    try {
      token = await this.recebedor.tokenPorContaMercadoPago(contaMercadoPagoId);
    } catch (erro) {
      if (erro instanceof UnprocessableEntityException) {
        this.logger.warn(
          `Aviso do pagamento ${pagamentoId} para a conta ${contaMercadoPagoId}, que não está conectada.`,
        );
        return;
      }
      throw erro;
    }

    const pagamento = await this.mercadoPago.buscarPagamento(
      token,
      pagamentoId,
    );
    // Estorno é da issue de reembolso; pendente e recusado não mudam nada.
    if (pagamento.status !== 'aprovado') return;

    const compra = isUUID(pagamento.referencia)
      ? await this.prismaService.receitaCompra.findUnique({
          where: { id: pagamento.referencia },
          select: COMPRA_DO_AVISO,
        })
      : null;
    if (!compra) {
      this.logger.warn(
        `Pagamento ${pagamento.id} aprovado sem compra (referência ${pagamento.referencia}).`,
      );
      return;
    }

    const vendedorDaCompra =
      compra.oferta.receita.criador.contaRecebedor?.gatewayRecebedorId;
    if (vendedorDaCompra !== contaMercadoPagoId) {
      this.logger.warn(
        `Pagamento ${pagamento.id} da conta ${contaMercadoPagoId} aponta para a compra ${compra.id}, de outro vendedor.`,
      );
      return;
    }

    if (!new Prisma.Decimal(pagamento.valor).equals(compra.precoPago)) {
      this.logger.warn(
        `Pagamento ${pagamento.id} de ${pagamento.valor} difere do preço ${compra.precoPago.toString()} da compra ${compra.id}; cópia não liberada.`,
      );
      return;
    }

    await this.liberar(compra, pagamento, agora);
  }

  /**
   * Em uma transação: registra o pagamento, cria a cópia, marca a compra
   * como paga e notifica. A linha da compra fica travada (FOR UPDATE), então
   * dois avisos ao mesmo tempo são processados um depois do outro, e o
   * segundo encontra o pagamento já registrado.
   */
  private async liberar(
    compra: CompraDoAviso,
    pagamento: PagamentoMercadoPago,
    agora: Date,
  ) {
    try {
      await this.prismaService.$transaction(async (tx) => {
        const [linha] = await tx.$queryRaw<{ status: StatusCompraReceita }[]>`
          SELECT status FROM receita_compras WHERE id = ${compra.id}::uuid FOR UPDATE`;

        const registrado = await tx.pagamento.findUnique({
          where: { gatewayCobrancaId: pagamento.id },
          select: { id: true },
        });
        if (registrado) return;

        const liberavel = await this.liberavel(tx, compra, linha.status);
        const pagaEm = pagamento.pagoEm ?? agora;

        await tx.pagamento.create({
          data: {
            receitaCompraId: compra.id,
            valor: compra.precoPago,
            statusPagamento: StatusPagamento.pago,
            metodoPagamento: pagamento.metodo,
            gatewayCobrancaId: pagamento.id,
            dataPagamento: pagaEm,
          },
        });
        if (!liberavel) {
          this.logger.warn(
            `Pagamento ${pagamento.id} aprovado para a compra ${compra.id} (${linha.status}), mas o comprador já tem esta receita; precisa de estorno.`,
          );
          return;
        }

        const copia = await this.criarCopia(tx, compra);
        await tx.receitaCompra.update({
          where: { id: compra.id },
          data: {
            status: StatusCompraReceita.paga,
            pagaEm,
            receitaCopiaId: copia.id,
          },
        });

        const { receita } = compra.oferta;
        await this.notificacao.criar(
          {
            usuarioId: receita.criadoPor,
            codigo: 'receita_vendida',
            titulo: 'Receita vendida',
            mensagem: `Sua receita "${receita.nome}" foi comprada.`,
            referencia: { receitaId: compra.oferta.receitaId },
          },
          tx,
        );
        await this.notificacao.criar(
          {
            usuarioId: compra.compradorId,
            codigo: 'compra_liberada',
            titulo: 'Compra liberada',
            mensagem: `O pagamento foi aprovado e a receita "${copia.nome}" já está disponível.`,
            referencia: { receitaId: copia.id },
          },
          tx,
        );
      });
    } catch (erro) {
      // Só é "já processado" se o pagamento está mesmo registrado; outra
      // violação de unicidade é relançada para o Mercado Pago reenviar.
      if (
        erro instanceof Prisma.PrismaClientKnownRequestError &&
        erro.code === 'P2002' &&
        (await this.prismaService.pagamento.findUnique({
          where: { gatewayCobrancaId: pagamento.id },
          select: { id: true },
        }))
      ) {
        return;
      }
      throw erro;
    }
  }

  /**
   * Pendente libera. Cancelada (o aviso chegou depois do vencimento) libera
   * se o comprador não tem outra compra paga desta receita; uma pendente
   * mais nova é cancelada para dar lugar a esta. O resto não libera.
   */
  private async liberavel(
    tx: Prisma.TransactionClient,
    compra: CompraDoAviso,
    status: StatusCompraReceita,
  ): Promise<boolean> {
    if (status === StatusCompraReceita.pendente) return true;
    if (status !== StatusCompraReceita.cancelada) return false;

    const outra = await tx.receitaCompra.findFirst({
      where: {
        ofertaId: compra.ofertaId,
        compradorId: compra.compradorId,
        status: { in: STATUS_VIVOS },
        id: { not: compra.id },
      },
      select: { id: true, status: true },
    });
    if (!outra) return true;
    if (outra.status !== StatusCompraReceita.pendente) return false;

    await tx.receitaCompra.update({
      where: { id: outra.id },
      data: { status: StatusCompraReceita.cancelada },
    });
    return true;
  }

  /** A cópia: Receita aprovada do vendedor, com o conteúdo guardado na compra. */
  private criarCopia(tx: Prisma.TransactionClient, compra: CompraDoAviso) {
    const conteudo = compra.conteudoComprado as unknown as ConteudoComprado;

    return tx.receita.create({
      data: {
        nome: conteudo.nome,
        descricao: conteudo.descricao,
        modoPreparo: conteudo.modoPreparo,
        tempoPreparoMin: conteudo.tempoPreparoMin,
        porcoes: conteudo.porcoes,
        nivelDificuldade: conteudo.nivelDificuldade,
        avisoContaminacaoCruzada: conteudo.avisoContaminacaoCruzada,
        ingredientesNaoListados: conteudo.ingredientesNaoListados,
        criadoPor: compra.oferta.receita.criadoPor,
        status: StatusReceita.aprovada,
        ingredientes: {
          createMany: {
            data: conteudo.ingredientes.map((i) => ({
              ingredienteId: i.ingredienteId,
              quantidade: new Prisma.Decimal(i.quantidade),
              unidadeMedidaId: i.unidadeMedidaId,
            })),
          },
        },
        midias: { createMany: { data: conteudo.midias } },
      },
      select: { id: true, nome: true },
    });
  }
}
