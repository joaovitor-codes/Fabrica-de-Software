import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  StatusAprovacao,
  StatusReceita,
  TipoTransacaoPontos,
} from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { CacheService } from '../../../common/cache/cache.service';
import { PontosTransacaoService } from '../pontos-transacao/pontos-transacao.service';

/**
 * Curadoria de receitas pelos profissionais: fila de pendentes, aprovação e
 * rejeição (com pontos). Aprovar uma adaptação também é verificá-la.
 */
@Injectable()
export class CuradoriaReceitaService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly cacheService: CacheService,
    private readonly pontosTransacaoService: PontosTransacaoService,
  ) {}

  async findPendentes() {
    return this.prismaService.receita.findMany({
      where: { status: StatusReceita.pendente, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      // Adaptação pendente = adaptação a verificar: o profissional vê de
      // qual receita veio, para qual restrição e o resumo da IA.
      include: {
        adaptacaoDe: {
          select: {
            resumoIa: true,
            trocas: true,
            restricao: { select: { id: true, nome: true } },
            receitaOrigem: { select: { id: true, nome: true } },
          },
        },
      },
    });
  }

  async aprovarReceita(id: string, usuarioId: string) {
    const profissional = await this.prismaService.profissional.findUnique({
      where: { usuarioId },
    });

    if (!profissional) {
      throw new NotFoundException(
        'Você ainda não possui cadastro profissional',
      );
    }

    if (profissional.statusAprovacao !== StatusAprovacao.aprovado) {
      throw new UnauthorizedException(
        'Apenas profissionais aprovados podem realizar esta ação',
      );
    }

    const resultado = await this.prismaService.$transaction(async (tx) => {
      const receita = await tx.receita.findUnique({ where: { id } });

      if (!receita || receita.deletedAt) {
        throw new NotFoundException('Receita não encontrada');
      }

      if (receita.criadoPor === usuarioId) {
        throw new ForbiddenException(
          'Não é possível aprovar a própria receita',
        );
      }

      if (receita.status === 'aprovada') {
        throw new ConflictException('A receita já foi aprovada');
      }

      const receitaAprovada = await tx.receita.update({
        where: { id },
        data: {
          status: 'aprovada',
          profissionalAprovadorId: profissional.id,
          dataAprovacao: new Date(),
        },
      });

      await this.pontosTransacaoService.createPontoTransacao(
        profissional.id,
        TipoTransacaoPontos.ganho_aprovacao,
        10,
        `Aprovação da receita: ${receita.nome}`,
        tx,
      );

      // Adaptação verificada: as substituições que a IA fez viram
      // substitutos curados. Na próxima adaptação do mesmo ingrediente para
      // a mesma restrição, a IA recebe estes como preferidos.
      const adaptacao = await tx.receitaAdaptacao.findUnique({
        where: { receitaAdaptadaId: id },
        select: { restricaoId: true, trocas: true },
      });
      const restricaoAdaptada = adaptacao?.restricaoId;
      if (adaptacao && restricaoAdaptada) {
        const substituicoes = (
          adaptacao.trocas as unknown as {
            ingredienteOrigemId: string;
            acao: string;
            ingredienteDestinoId?: string;
          }[]
        ).filter((t) => t.acao === 'substituir' && t.ingredienteDestinoId);
        await tx.ingredienteSubstituto.createMany({
          data: substituicoes.map((t) => ({
            ingredienteOrigemId: t.ingredienteOrigemId,
            ingredienteDestinoId: t.ingredienteDestinoId!,
            restricaoId: restricaoAdaptada,
            observacao: `Aprovado na adaptação da receita "${receita.nome}"`,
          })),
          skipDuplicates: true,
        });
      }

      return {
        success: 'Receita aprovada com sucesso.',
        data: receitaAprovada,
      };
    });

    // O status mudou: a lista pública em cache ficou desatualizada.
    await this.cacheService.del('receitas:all');
    return resultado;
  }

  async rejeitarReceita(id: string, usuarioId: string) {
    const profissional = await this.prismaService.profissional.findUnique({
      where: { usuarioId },
    });

    if (!profissional) {
      throw new NotFoundException(
        'Você ainda não possui cadastro profissional',
      );
    }

    const resultado = await this.prismaService.$transaction(async (tx) => {
      const receita = await tx.receita.findUnique({ where: { id } });

      if (!receita || receita.deletedAt) {
        throw new NotFoundException('Receita não encontrada');
      }

      if (receita.criadoPor === usuarioId) {
        throw new ForbiddenException(
          'Não é possível rejeitar a própria receita',
        );
      }

      if (receita.status === 'rejeitada') {
        throw new ConflictException('A receita já foi rejeitada');
      }

      const receitaRejeitada = await tx.receita.update({
        where: { id },
        data: {
          status: 'rejeitada',
        },
      });

      await this.pontosTransacaoService.createPontoTransacao(
        profissional.id,
        TipoTransacaoPontos.ganho_rejeicao,
        5,
        `Rejeição da receita: ${receita.nome}`,
        tx,
      );

      return {
        success: 'Receita rejeitada com sucesso.',
        data: receitaRejeitada,
      };
    });

    // O status mudou: a lista pública em cache ficou desatualizada.
    await this.cacheService.del('receitas:all');
    return resultado;
  }
}
