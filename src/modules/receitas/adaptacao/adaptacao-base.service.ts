import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, StatusReceita } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { IaService } from '../../ia/ia.service';
import { IngredientesReceitaService } from '../receita/ingredientes-receita.service';
import { ItemReceita, PropostaAdaptacao } from './adaptacao';
import {
  RestricaoDoPaciente,
  RestricaoViolada,
  ingredientesSegurosPara,
  violacoesDosIngredientes,
} from '../visibilidade/restricoes-receita';

const incluirIngredientes = {
  ingredientes: {
    include: {
      ingrediente: { select: { id: true, nome: true } },
      unidadeMedida: { select: { codigo: true } },
    },
  },
} satisfies Prisma.ReceitaInclude;

export type Origem = Prisma.ReceitaGetPayload<{
  include: typeof incluirIngredientes;
}>;

export interface Analise {
  itens: ItemReceita[];
  violacoes: RestricaoViolada[];
  /** Índices em `itens` dos ingredientes a trocar. */
  problematicos: Set<number>;
}

/**
 * Etapas comuns da adaptação de receita (regra_negocio_receitas_seguras.md),
 * usadas pelo fluxo do paciente e pelo do profissional: carregar a receita,
 * analisar o que ela fere, pedir a proposta à IA, conferir a lista final e
 * gravar a adaptada. A IA propõe; a checagem determinística decide.
 */
@Injectable()
export class AdaptacaoBaseService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly iaService: IaService,
    private readonly ingredientesReceita: IngredientesReceitaService,
  ) {}

  async carregarOrigem(
    receitaId: string,
    visibilidade: Prisma.ReceitaWhereInput,
  ): Promise<Origem> {
    const origem = await this.prismaService.receita.findFirst({
      where: { id: receitaId, deletedAt: null, ...visibilidade },
      include: incluirIngredientes,
    });
    if (!origem) {
      throw new NotFoundException('Receita não encontrada');
    }
    return origem;
  }

  /**
   * O que a receita fere e quais ingredientes trocar: os que contêm alguma
   * restrição, os não revisados e os sem o dado das regras nutricionais
   * (sem trocar os dois últimos, a adaptada continuaria escondida).
   */
  async analisar(
    origem: Origem,
    restricoes: RestricaoDoPaciente[],
  ): Promise<Analise> {
    const itens: ItemReceita[] = origem.ingredientes.map((i) => ({
      ingredienteId: i.ingredienteId,
      nome: i.ingrediente.nome,
      quantidade: i.quantidade.toNumber(),
      unidadeMedidaId: i.unidadeMedidaId,
      unidade: i.unidadeMedida.codigo,
    }));
    const violacoes = await violacoesDosIngredientes(
      this.prismaService,
      itens.map((i) => i.ingredienteId),
      restricoes,
    );
    const ids = new Set(
      violacoes.flatMap((v) =>
        [...v.contem, ...v.naoRevisados, ...v.semDado].map((i) => i.id),
      ),
    );
    const problematicos = new Set(
      itens
        .map((item, i) => (ids.has(item.ingredienteId) ? i : -1))
        .filter((i) => i >= 0),
    );
    return { itens, violacoes, problematicos };
  }

  /** Uma chamada à IA, com candidatos seguros para todas as restrições. */
  async pedirProposta(
    origem: Origem,
    analise: Analise,
    restricoes: RestricaoDoPaciente[],
  ) {
    const candidatos = await ingredientesSegurosPara(
      this.prismaService,
      restricoes,
    );
    const indice = new Map(candidatos.map((c, i) => [c.id, i]));
    const curados = await this.substitutosCurados(analise, restricoes);
    const preferidos: Record<number, number[]> = {};
    for (const i of analise.problematicos) {
      const cs = curados
        .filter((s) => s.ingredienteOrigemId === analise.itens[i].ingredienteId)
        .map((s) => indice.get(s.ingredienteDestino.id))
        .filter((c): c is number => c !== undefined);
      if (cs.length > 0) preferidos[i] = cs;
    }

    const resposta = await this.iaService.adaptarReceita({
      restricoes: restricoes.map((r) => r.nome),
      nome: origem.nome,
      modoPreparo: origem.modoPreparo,
      itens: analise.itens.map((item, i) => ({
        nome: item.nome,
        quantidade: item.quantidade,
        unidade: item.unidade,
        trocar: analise.problematicos.has(i),
      })),
      candidatos: candidatos.map((c) => c.nome),
      preferidos,
    });
    return { resposta, candidatos };
  }

  substitutosCurados(analise: Analise, restricoes: RestricaoDoPaciente[]) {
    return this.prismaService.ingredienteSubstituto.findMany({
      where: {
        restricaoId: { in: restricoes.map((r) => r.restricaoId) },
        ingredienteOrigemId: {
          in: [...analise.problematicos].map(
            (i) => analise.itens[i].ingredienteId,
          ),
        },
      },
      orderBy: { prioridade: 'asc' },
      select: {
        ingredienteOrigemId: true,
        ingredienteDestino: { select: { id: true, nome: true } },
      },
    });
  }

  /**
   * Checagem determinística da lista final: não pode ferir nenhuma das
   * restrições, e o modo de preparo não pode citar ingrediente fora dela.
   * Devolve o motivo, ou null se estiver tudo certo.
   */
  async conferir(
    ingredienteIds: string[],
    modoPreparo: string | null,
    restricoes: RestricaoDoPaciente[],
  ): Promise<string | null> {
    const violacoes = await violacoesDosIngredientes(
      this.prismaService,
      ingredienteIds,
      restricoes,
    );
    if (violacoes.length > 0) {
      return (
        'a lista ainda fere: ' +
        violacoes
          .map(
            (v) =>
              `${v.nome} (${[...v.contem, ...v.naoRevisados, ...v.semDado]
                .map((i) => i.nome)
                .join(', ')})`,
          )
          .join('; ')
      );
    }
    const nomes = (
      await this.prismaService.ingrediente.findMany({
        where: { id: { in: ingredienteIds } },
        select: { nome: true },
      })
    ).map((i) => i.nome);
    const foraDaLista =
      await this.ingredientesReceita.verificarIngredientesOcultos(
        modoPreparo,
        nomes,
      );
    if (foraDaLista.length > 0) {
      return `o modo de preparo cita ingredientes fora da lista: ${foraDaLista.join(', ')}`;
    }
    return null;
  }

  criarAdaptada(
    tx: Prisma.TransactionClient,
    origem: Origem,
    dados: {
      nome: string;
      modoPreparo: string | null;
      ingredientes: PropostaAdaptacao['ingredientes'];
      criadoPor: string;
      status: StatusReceita;
      profissionalAprovadorId?: string;
    },
  ) {
    const aprovada = dados.status === StatusReceita.aprovada;
    return tx.receita.create({
      data: {
        nome: dados.nome.slice(0, 255),
        descricao: origem.descricao,
        modoPreparo: dados.modoPreparo,
        tempoPreparoMin: origem.tempoPreparoMin,
        porcoes: origem.porcoes,
        nivelDificuldade: origem.nivelDificuldade,
        avisoContaminacaoCruzada: origem.avisoContaminacaoCruzada,
        criadoPor: dados.criadoPor,
        status: dados.status,
        ...(aprovada
          ? {
              profissionalAprovadorId: dados.profissionalAprovadorId,
              dataAprovacao: new Date(),
            }
          : {}),
        ingredientes: { create: dados.ingredientes },
      },
      include: {
        ingredientes: { include: { ingrediente: true, unidadeMedida: true } },
      },
    });
  }

  temNaoListados(origem: Origem) {
    return origem.ingredientesNaoListados.length > 0;
  }
}
