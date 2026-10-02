import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, StatusReceita, TipoUsuario } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { CacheService } from '../../../common/cache/cache.service';
import { UsuarioAutenticado } from '../../../auth/auth.types';
import { IaService } from '../../ia/ia.service';
import { ReceitaService } from './receita.service';
import { ItemReceita, interpretarAdaptacao } from './adaptacao';
import {
  ingredientesSegurosPara,
  restricaoPorId,
  restricoesDoUsuario,
  violacoesDosIngredientes,
} from './restricoes-receita';

/**
 * Adaptação de receita para uma restrição (Fase 2 de
 * regra_negocio_receitas_seguras.md). A IA propõe; a checagem determinística
 * decide; a verificação é a aprovação da receita adaptada por um profissional.
 */
@Injectable()
export class AdaptacaoReceitaService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly iaService: IaService,
    private readonly receitaService: ReceitaService,
    private readonly cacheService: CacheService,
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

    const origem = await this.prismaService.receita.findFirst({
      where: { id: receitaId, deletedAt: null, ...this.podeVer(usuario) },
      include: {
        ingredientes: {
          include: {
            ingrediente: { select: { id: true, nome: true } },
            unidadeMedida: { select: { codigo: true } },
          },
        },
      },
    });
    if (!origem) {
      throw new NotFoundException('Receita não encontrada');
    }

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
    const itens: ItemReceita[] = origem.ingredientes.map((i) => ({
      ingredienteId: i.ingredienteId,
      nome: i.ingrediente.nome,
      quantidade: i.quantidade.toNumber(),
      unidadeMedidaId: i.unidadeMedidaId,
      unidade: i.unidadeMedida.codigo,
    }));
    const [violacao] = await violacoesDosIngredientes(
      this.prismaService,
      itens.map((i) => i.ingredienteId),
      [restricao],
    );
    if (!violacao && origem.ingredientesNaoListados.length === 0) {
      return {
        success: 'A receita já é segura para esta restrição.',
        jaSegura: true,
        receita: origem,
      };
    }

    // 3. Ingredientes a trocar: os que contêm a restrição, os não revisados
    // e os sem o dado da regra nutricional. Sem trocar os dois últimos, a
    // adaptada continuaria escondida.
    const idsProblematicos = new Set(
      [
        ...(violacao?.contem ?? []),
        ...(violacao?.naoRevisados ?? []),
        ...(violacao?.semDado ?? []),
      ].map((i) => i.id),
    );
    const problematicos = new Set(
      itens
        .map((item, i) => (idsProblematicos.has(item.ingredienteId) ? i : -1))
        .filter((i) => i >= 0),
    );

    const candidatos = await ingredientesSegurosPara(
      this.prismaService,
      restricao,
    );
    const indiceCandidato = new Map(candidatos.map((c, i) => [c.id, i]));
    const curados = await this.prismaService.ingredienteSubstituto.findMany({
      where: {
        restricaoId,
        ingredienteOrigemId: { in: [...idsProblematicos] },
      },
      orderBy: { prioridade: 'asc' },
      select: { ingredienteOrigemId: true, ingredienteDestinoId: true },
    });
    const preferidos: Record<number, number[]> = {};
    for (const i of problematicos) {
      const cs = curados
        .filter((s) => s.ingredienteOrigemId === itens[i].ingredienteId)
        .map((s) => indiceCandidato.get(s.ingredienteDestinoId))
        .filter((c): c is number => c !== undefined);
      if (cs.length > 0) preferidos[i] = cs;
    }

    // 4. A IA propõe as trocas.
    const resposta = await this.iaService.adaptarReceita({
      restricao: restricao.nome,
      nome: origem.nome,
      modoPreparo: origem.modoPreparo,
      itens: itens.map((item, i) => ({
        nome: item.nome,
        quantidade: item.quantidade,
        unidade: item.unidade,
        trocar: problematicos.has(i),
      })),
      candidatos: candidatos.map((c) => c.nome),
      preferidos,
    });
    const proposta = interpretarAdaptacao(
      resposta,
      itens,
      problematicos,
      candidatos,
    );
    if ('erro' in proposta) {
      throw this.naoAdaptou(proposta.erro);
    }

    // 5. Checagem determinística: a lista nova não pode ferir a restrição,
    // e o modo de preparo reescrito não pode citar nada fora dela.
    const idsNovos = proposta.ingredientes.map((i) => i.ingredienteId);
    const [aindaViola] = await violacoesDosIngredientes(
      this.prismaService,
      idsNovos,
      [restricao],
    );
    if (aindaViola) {
      throw this.naoAdaptou(
        'a lista adaptada ainda fere a restrição: ' +
          [
            ...aindaViola.contem,
            ...aindaViola.naoRevisados,
            ...aindaViola.semDado,
          ]
            .map((i) => i.nome)
            .join(', '),
      );
    }
    const modoPreparo = proposta.modoPreparo ?? origem.modoPreparo;
    const nomesNovos = (
      await this.prismaService.ingrediente.findMany({
        where: { id: { in: idsNovos } },
        select: { nome: true },
      })
    ).map((i) => i.nome);
    const foraDaLista = await this.receitaService.verificarIngredientesOcultos(
      modoPreparo,
      nomesNovos,
    );
    if (foraDaLista.length > 0) {
      throw this.naoAdaptou(
        `o modo de preparo adaptado cita ingredientes fora da lista: ${foraDaLista.join(', ')}`,
      );
    }

    // 6. Grava a receita adaptada (pendente = não verificada) e a ligação.
    // Uma adaptação antiga, de outra versão da origem, sai de circulação.
    const { adaptacaoId, adaptada } = await this.prismaService.$transaction(
      async (tx) => {
        if (existente) {
          await tx.receitaAdaptacao.delete({ where: { id: existente.id } });
          await tx.receita.update({
            where: { id: existente.receitaAdaptadaId },
            data: { deletedAt: new Date() },
          });
        }

        const adaptada = await tx.receita.create({
          data: {
            nome: `${origem.nome} (adaptada: ${restricao.nome})`.slice(0, 255),
            descricao: origem.descricao,
            modoPreparo,
            tempoPreparoMin: origem.tempoPreparoMin,
            porcoes: origem.porcoes,
            nivelDificuldade: origem.nivelDificuldade,
            avisoContaminacaoCruzada: origem.avisoContaminacaoCruzada,
            criadoPor: usuario.id,
            status: StatusReceita.pendente,
            ingredientes: { create: proposta.ingredientes },
          },
          include: {
            ingredientes: {
              include: { ingrediente: true, unidadeMedida: true },
            },
          },
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

  /** Quem pode pedir adaptação de qual receita: as que ele consegue ver. */
  private podeVer(usuario: UsuarioAutenticado): Prisma.ReceitaWhereInput {
    if (
      usuario.tipoUsuario === TipoUsuario.admin ||
      usuario.tipoUsuario === TipoUsuario.profissional
    ) {
      return {};
    }
    return {
      OR: [{ status: StatusReceita.aprovada }, { criadoPor: usuario.id }],
    };
  }
}
