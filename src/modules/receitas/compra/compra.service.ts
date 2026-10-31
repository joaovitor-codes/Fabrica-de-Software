import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, ReceitaCompra, StatusCompraReceita } from '@prisma/client';
import { UsuarioAutenticado } from '../../../auth/auth.types';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { MercadoPagoService } from '../../marketplace/mercado-pago/mercado-pago.service';
import { RecebedorService } from '../../marketplace/recebedor/recebedor.service';
import { TermosService } from '../../marketplace/termos/termos.service';
import {
  restricoesDoUsuario,
  restricoesVioladas,
} from '../visibilidade/restricoes-receita';
import { VisibilidadeReceitaService } from '../visibilidade/visibilidade-receita.service';

// A preferência do Checkout Pro nasce com esta validade. Sem webhook para
// cancelar, uma pendente mais velha que isso dá lugar a uma compra nova.
export const VALIDADE_PREFERENCIA_MS = 24 * 60 * 60 * 1000;

// Compra "viva": a que o índice uq_receita_compra_viva deixa existir uma só.
const STATUS_VIVOS = [
  StatusCompraReceita.pendente,
  StatusCompraReceita.paga,
  StatusCompraReceita.reembolso_em_analise,
];

export interface ResultadoCompra {
  compraId: string;
  checkoutUrl: string;
  /** true quando devolveu o link de uma pendente que já existia (200, não 201). */
  reaproveitada: boolean;
}

@Injectable()
export class CompraService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly configService: ConfigService,
    private readonly termos: TermosService,
    private readonly visibilidade: VisibilidadeReceitaService,
    private readonly recebedor: RecebedorService,
    private readonly mercadoPago: MercadoPagoService,
  ) {}

  /**
   * Cria a compra de uma receita à venda e devolve o link do Checkout Pro.
   * Preço e taxa ficam congelados na compra; a cópia só nasce no webhook.
   */
  async comprar(
    receitaId: string,
    usuario: UsuarioAutenticado,
    agora = new Date(),
  ): Promise<ResultadoCompra> {
    await this.termos.garantirAceite(usuario.id);

    const receita = await this.prismaService.receita.findFirst({
      where: { id: receitaId, ...this.visibilidade.filtroAVenda() },
      include: { oferta: true },
    });
    if (!receita?.oferta) {
      throw new NotFoundException(
        'Receita não encontrada ou não está à venda.',
      );
    }
    if (receita.criadoPor === usuario.id) {
      throw new UnprocessableEntityException(
        'Você não pode comprar a própria receita.',
      );
    }

    // Restrição estrita impede a compra; a flexível só aparece como aviso na prévia.
    const restricoes = await restricoesDoUsuario(this.prismaService, usuario);
    const violadas =
      (
        await restricoesVioladas(this.prismaService, [receita.id], restricoes)
      ).get(receita.id) ?? [];
    const estritas = violadas.filter((r) => r.estrita);
    if (estritas.length > 0) {
      throw new UnprocessableEntityException({
        message: 'A receita fere uma restrição estrita sua.',
        restricoesVioladas: estritas,
      });
    }

    const viva = await this.prismaService.receitaCompra.findFirst({
      where: {
        ofertaId: receita.oferta.id,
        compradorId: usuario.id,
        status: { in: STATUS_VIVOS },
      },
    });
    if (viva) {
      if (viva.status !== StatusCompraReceita.pendente) {
        throw new ConflictException('Você já comprou esta receita.');
      }
      if (viva.checkoutUrl && !this.vencida(viva, agora)) {
        return {
          compraId: viva.id,
          checkoutUrl: viva.checkoutUrl,
          reaproveitada: true,
        };
      }
      await this.cancelar(viva.id);
    }

    const preco = receita.oferta.preco;
    const taxa = preco
      .mul(this.percentualTaxa())
      .div(100)
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    const compra = await this.criarCompra({
      ofertaId: receita.oferta.id,
      compradorId: usuario.id,
      precoPago: preco,
      taxaPlataforma: taxa,
      versaoComprada: receita.versaoAtual,
    });

    try {
      const token = await this.recebedor.tokenDoVendedor(receita.criadoPor);
      const preferencia = await this.mercadoPago.criarPreferencia(token, {
        referencia: compra.id,
        titulo: receita.nome,
        valor: preco.toNumber(),
        taxaPlataforma: taxa.toNumber(),
        expiraEm: new Date(
          compra.createdAt.getTime() + VALIDADE_PREFERENCIA_MS,
        ),
      });

      await this.prismaService.receitaCompra.update({
        where: { id: compra.id },
        data: {
          gatewayPreferenciaId: preferencia.id,
          checkoutUrl: preferencia.checkoutUrl,
        },
      });
      return {
        compraId: compra.id,
        checkoutUrl: preferencia.checkoutUrl,
        reaproveitada: false,
      };
    } catch (erro) {
      await this.cancelar(compra.id);
      throw erro;
    }
  }

  /** Situação de uma compra; só o comprador vê, para os outros ela não existe. */
  async consultar(compraId: string, usuario: UsuarioAutenticado) {
    const compra = await this.prismaService.receitaCompra.findFirst({
      where: { id: compraId, compradorId: usuario.id },
      include: {
        oferta: { select: { receita: { select: { id: true, nome: true } } } },
      },
    });
    if (!compra) {
      throw new NotFoundException('Compra não encontrada.');
    }

    return {
      id: compra.id,
      status: compra.status,
      receita: compra.oferta.receita,
      precoPago: compra.precoPago,
      checkoutUrl:
        compra.status === StatusCompraReceita.pendente
          ? compra.checkoutUrl
          : null,
      pagaEm: compra.pagaEm,
      receitaCopiaId: compra.receitaCopiaId,
      createdAt: compra.createdAt,
    };
  }

  private async criarCompra(data: Prisma.ReceitaCompraUncheckedCreateInput) {
    try {
      return await this.prismaService.receitaCompra.create({ data });
    } catch (erro) {
      if (
        erro instanceof Prisma.PrismaClientKnownRequestError &&
        erro.code === 'P2002'
      ) {
        throw new ConflictException(
          'Já existe uma compra em andamento desta receita.',
        );
      }
      throw erro;
    }
  }

  private cancelar(compraId: string) {
    return this.prismaService.receitaCompra.update({
      where: { id: compraId },
      data: { status: StatusCompraReceita.cancelada },
    });
  }

  private vencida(compra: ReceitaCompra, agora: Date) {
    return (
      compra.createdAt.getTime() + VALIDADE_PREFERENCIA_MS <= agora.getTime()
    );
  }

  private percentualTaxa() {
    return this.configService.get<number>('MARKETPLACE_TAXA_PERCENTUAL') ?? 15;
  }
}
