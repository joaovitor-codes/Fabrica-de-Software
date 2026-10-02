import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, StatusReceita } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { CacheService } from '../../../common/cache/cache.service';
import { UsuarioAutenticado } from '../../../auth/auth.types';
import { VisibilidadeReceitaService } from '../visibilidade/visibilidade-receita.service';
import {
  restricaoPorId,
  restricoesDoUsuario,
} from '../visibilidade/restricoes-receita';
import { AdaptacaoBaseService } from './adaptacao-base.service';
import { interpretarAdaptacao } from './adaptacao';

/**
 * O paciente pede a adaptação de uma receita para uma restrição (Fase 2 de
 * regra_negocio_receitas_seguras.md). A IA decide as trocas; a adaptação é
 * pública, reaproveitada por quem tem a mesma restrição, e verificada depois
 * por um profissional (aprovação).
 */
@Injectable()
export class AdaptacaoPacienteService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly cacheService: CacheService,
    private readonly base: AdaptacaoBaseService,
    private readonly visibilidade: VisibilidadeReceitaService,
  ) {}

  async adaptar(
    receitaId: string,
    restricaoId: string,
    usuario: UsuarioAutenticado,
  ) {
    const restricao = await restricaoPorId(this.prismaService, restricaoId);
    if (!restricao) {
      throw new NotFoundException('Restrição alimentar não encontrada');
    }
    const estritaParaQuemPediu =
      (await restricoesDoUsuario(this.prismaService, usuario)).find(
        (r) => r.restricaoId === restricaoId,
      )?.estrita ?? false;

    const origem = await this.base.carregarOrigem(
      receitaId,
      this.visibilidade.filtroBase(usuario),
    );

    // 1. Já existe adaptação desta receita, nesta versão, para a restrição.
    const existente = await this.prismaService.receitaAdaptacao.findUnique({
      where: {
        receitaOrigemId_restricaoId: {
          receitaOrigemId: receitaId,
          restricaoId,
        },
      },
      include: {
        receitaAdaptada: {
          include: {
            ingredientes: {
              include: { ingrediente: true, unidadeMedida: true },
            },
          },
        },
      },
    });
    if (
      existente &&
      existente.versaoOrigem === origem.versaoAtual &&
      !existente.receitaAdaptada.deletedAt
    ) {
      return this.resposta(
        existente.id,
        existente.receitaAdaptada,
        existente.resumoIa,
        restricao.nome,
        estritaParaQuemPediu,
        true,
      );
    }

    // 2. A receita já é segura para a restrição: não há o que adaptar.
    const analise = await this.base.analisar(origem, [restricao]);
    if (analise.problematicos.size === 0 && !this.base.temNaoListados(origem)) {
      return {
        success: 'A receita já é segura para esta restrição.',
        jaSegura: true,
        receita: origem,
      };
    }

    // 3. A IA propõe e a checagem determinística confere.
    const { resposta, candidatos } = await this.base.pedirProposta(
      origem,
      analise,
      [restricao],
    );
    const proposta = interpretarAdaptacao(
      resposta,
      analise.itens,
      analise.problematicos,
      candidatos,
    );
    if ('erro' in proposta) {
      throw this.naoAdaptou(proposta.erro);
    }
    const modoPreparo = proposta.modoPreparo ?? origem.modoPreparo;
    const problema = await this.base.conferir(
      proposta.ingredientes.map((i) => i.ingredienteId),
      modoPreparo,
      [restricao],
    );
    if (problema) {
      throw this.naoAdaptou(problema);
    }

    // 4. Grava a adaptada (pendente = não verificada) e a ligação. Uma
    // adaptação antiga, de outra versão da origem, sai de circulação.
    const { adaptacaoId, adaptada } = await this.prismaService.$transaction(
      async (tx) => {
        if (existente) {
          await tx.receitaAdaptacao.delete({ where: { id: existente.id } });
          await tx.receita.update({
            where: { id: existente.receitaAdaptadaId },
            data: { deletedAt: new Date() },
          });
        }
        const adaptada = await this.base.criarAdaptada(tx, origem, {
          nome: `${origem.nome} (adaptada: ${restricao.nome})`,
          modoPreparo,
          ingredientes: proposta.ingredientes,
          criadoPor: usuario.id,
          status: StatusReceita.pendente,
        });
        const adaptacao = await tx.receitaAdaptacao.create({
          data: {
            receitaOrigemId: origem.id,
            versaoOrigem: origem.versaoAtual,
            receitaAdaptadaId: adaptada.id,
            restricaoId,
            resumoIa: proposta.resumo || null,
            trocas: proposta.trocas as unknown as Prisma.InputJsonValue,
          },
        });
        return { adaptacaoId: adaptacao.id, adaptada };
      },
    );

    await this.cacheService.del('receitas:all');
    return this.resposta(
      adaptacaoId,
      adaptada,
      proposta.resumo || null,
      restricao.nome,
      estritaParaQuemPediu,
      false,
    );
  }

  /**
   * Para restrição estrita de quem pediu, a adaptada só aparece depois da
   * verificação: a resposta não traz a receita enquanto ela estiver
   * pendente.
   */
  private resposta(
    adaptacaoId: string,
    adaptada: { status: StatusReceita },
    resumoIa: string | null,
    restricao: string,
    estritaParaQuemPediu: boolean,
    reaproveitada: boolean,
  ) {
    const verificada = adaptada.status === StatusReceita.aprovada;
    const disponivel = verificada || !estritaParaQuemPediu;
    return {
      success: reaproveitada
        ? 'Adaptação já existente.'
        : 'Receita adaptada com sucesso.',
      adaptacao: { id: adaptacaoId, restricao, resumoIa },
      reaproveitada,
      verificada,
      disponivel,
      ...(disponivel
        ? { receita: adaptada }
        : {
            aviso:
              'A adaptação foi criada e fica disponível para você depois que um profissional a verificar.',
          }),
    };
  }

  private naoAdaptou(motivo: string) {
    return new UnprocessableEntityException(
      `Não foi possível adaptar a receita com segurança: ${motivo}.`,
    );
  }
}
