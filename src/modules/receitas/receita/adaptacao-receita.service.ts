import {
  ForbiddenException,
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
import {
  ItemReceita,
  PropostaAdaptacao,
  Troca,
  interpretarAdaptacao,
  interpretarOpcoes,
} from './adaptacao';
import {
  RestricaoDoPaciente,
  RestricaoViolada,
  ingredientesSegurosPara,
  restricaoPorId,
  restricoesDoPaciente,
  restricoesDoUsuario,
  semAdaptacoesDeOutros,
  violacoesDosIngredientes,
} from './restricoes-receita';
import { AdaptacaoProfissionalDto } from './dtos/adaptar-receita';

const incluirIngredientes = {
  ingredientes: {
    include: {
      ingrediente: { select: { id: true, nome: true } },
      unidadeMedida: { select: { codigo: true } },
    },
  },
} satisfies Prisma.ReceitaInclude;

type Origem = Prisma.ReceitaGetPayload<{ include: typeof incluirIngredientes }>;

interface Analise {
  itens: ItemReceita[];
  violacoes: RestricaoViolada[];
  /** Índices em `itens` dos ingredientes a trocar. */
  problematicos: Set<number>;
}

/**
 * Adaptação de receita (regra_negocio_receitas_seguras.md). Dois fluxos:
 * - o paciente pede a adaptação para uma restrição: a IA decide e a
 *   adaptação é pública, verificada depois por um profissional (Fase 2);
 * - o profissional do paciente recebe sugestões e decide; a escolha dele
 *   já é a verificação, e a adaptação é só daquele paciente.
 * Nos dois, a IA propõe e a checagem determinística decide se é segura.
 */
@Injectable()
export class AdaptacaoReceitaService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly iaService: IaService,
    private readonly receitaService: ReceitaService,
    private readonly cacheService: CacheService,
  ) {}

  // ---------------------------------------------------------------------
  // Paciente: adaptação para uma restrição

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

    const origem = await this.carregarOrigem(receitaId, this.podeVer(usuario));

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
    const analise = await this.analisar(origem, [restricao]);
    if (analise.problematicos.size === 0 && !this.temNaoListados(origem)) {
      return {
        success: 'A receita já é segura para esta restrição.',
        jaSegura: true,
        receita: origem,
      };
    }

    // 3. A IA propõe e a checagem determinística confere.
    const { resposta, candidatos } = await this.pedirProposta(origem, analise, [
      restricao,
    ]);
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
    const problema = await this.conferir(
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
        const adaptada = await this.criarAdaptada(tx, origem, {
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

  // ---------------------------------------------------------------------
  // Profissional: sugestões e adaptação escolhida para um paciente dele

  /**
   * O que a receita fere para o paciente e o que fazer: opções de
   * substituto por ingrediente (curadas primeiro, depois as da IA) e a
   * receita inteira adaptada pela IA, como prévia. Nada é gravado.
   */
  async sugerir(
    receitaId: string,
    pacienteId: string,
    usuario: UsuarioAutenticado,
  ) {
    await this.garantirPacienteDoProfissional(pacienteId, usuario);
    const restricoes = await restricoesDoPaciente(this.prismaService, {
      id: pacienteId,
    });
    const origem = await this.carregarOrigem(receitaId, {});
    const resumoRestricoes = restricoes.map((r) => ({
      id: r.restricaoId,
      nome: r.nome,
      estrita: r.estrita,
    }));

    const analise = await this.analisar(origem, restricoes);
    if (analise.problematicos.size === 0 && !this.temNaoListados(origem)) {
      return {
        receita: { id: origem.id, nome: origem.nome },
        restricoesDoPaciente: resumoRestricoes,
        segura: true,
      };
    }

    const { resposta, candidatos } = await this.pedirProposta(
      origem,
      analise,
      restricoes,
    );
    const opcoesIa = interpretarOpcoes(
      resposta,
      analise.problematicos,
      candidatos.length,
    );
    const seguros = new Set(candidatos.map((c) => c.id));
    const curados = await this.substitutosCurados(analise, restricoes);
    const nomePorId = new Map(candidatos.map((c) => [c.id, c.nome]));

    const ingredientes = analise.itens.map((item, i) => {
      const trocar = analise.problematicos.has(i);
      const sugestoes = trocar
        ? [
            ...curados
              .filter(
                (s) =>
                  s.ingredienteOrigemId === item.ingredienteId &&
                  seguros.has(s.ingredienteDestino.id),
              )
              .map((s) => ({ ...s.ingredienteDestino, fonte: 'curado' })),
            ...(opcoesIa.get(i) ?? []).map((c) => ({
              ...candidatos[c],
              fonte: 'ia',
            })),
          ].filter(
            (s, idx, todas) => todas.findIndex((x) => x.id === s.id) === idx,
          )
        : [];
      return { ...item, trocar, sugestoes };
    });

    // A receita inteira da IA só é sugerida se passar na checagem.
    let receitaInteira: object;
    const proposta = interpretarAdaptacao(
      resposta,
      analise.itens,
      analise.problematicos,
      candidatos,
    );
    if ('erro' in proposta) {
      receitaInteira = { erro: proposta.erro };
    } else {
      const modoPreparo = proposta.modoPreparo ?? origem.modoPreparo;
      const problema = await this.conferir(
        proposta.ingredientes.map((i) => i.ingredienteId),
        modoPreparo,
        restricoes,
      );
      receitaInteira = problema
        ? { erro: problema }
        : {
            ingredientes: proposta.ingredientes.map((i) => ({
              ...i,
              nome:
                nomePorId.get(i.ingredienteId) ??
                analise.itens.find((x) => x.ingredienteId === i.ingredienteId)
                  ?.nome,
            })),
            trocas: proposta.trocas,
            modoPreparo,
            resumo: proposta.resumo,
          };
    }

    return {
      receita: { id: origem.id, nome: origem.nome },
      restricoesDoPaciente: resumoRestricoes,
      segura: false,
      restricoesVioladas: analise.violacoes,
      ingredientesNaoListados: origem.ingredientesNaoListados,
      ingredientes,
      receitaInteira,
    };
  }

  /**
   * Grava a adaptação que o profissional escolheu para o paciente dele. Ela
   * precisa ser segura para TODAS as restrições do paciente; a escolha do
   * profissional já é a verificação. As substituições viram substitutos
   * curados para as restrições que o ingrediente original feria.
   */
  async salvarDoProfissional(
    receitaId: string,
    dto: AdaptacaoProfissionalDto,
    usuario: UsuarioAutenticado,
  ) {
    const profissional = await this.garantirPacienteDoProfissional(
      dto.pacienteId,
      usuario,
    );
    const restricoes = await restricoesDoPaciente(this.prismaService, {
      id: dto.pacienteId,
    });
    const origem = await this.carregarOrigem(receitaId, {});
    await this.receitaService.validarIngredientes(dto.ingredientes);

    const idsNovos = dto.ingredientes.map((i) => i.ingredienteId);
    const modoPreparo =
      dto.modoPreparo !== undefined ? dto.modoPreparo : origem.modoPreparo;
    const problema = await this.conferir(idsNovos, modoPreparo, restricoes);
    if (problema) {
      throw new UnprocessableEntityException(
        `A adaptação não é segura para o paciente: ${problema}.`,
      );
    }

    const trocas = this.trocasValidas(dto.trocas ?? [], origem, idsNovos);
    const analise = await this.analisar(origem, restricoes);

    const adaptada = await this.prismaService.$transaction(async (tx) => {
      const adaptada = await this.criarAdaptada(tx, origem, {
        nome: `${origem.nome} (adaptada pelo nutricionista)`,
        modoPreparo,
        ingredientes: dto.ingredientes,
        criadoPor: usuario.id,
        status: StatusReceita.aprovada,
        profissionalAprovadorId: profissional.id,
      });
      await tx.receitaAdaptacao.create({
        data: {
          receitaOrigemId: origem.id,
          versaoOrigem: origem.versaoAtual,
          receitaAdaptadaId: adaptada.id,
          pacienteId: dto.pacienteId,
          resumoIa: dto.resumo ?? null,
          trocas: trocas as unknown as Prisma.InputJsonValue,
        },
      });

      // Aprendizado: cada substituição vale para as restrições que o
      // ingrediente original feria.
      const substitutos = trocas.flatMap((t) =>
        t.acao === 'substituir' && t.ingredienteDestinoId
          ? analise.violacoes
              .filter((v) =>
                v.contem.some((c) => c.id === t.ingredienteOrigemId),
              )
              .map((v) => ({
                ingredienteOrigemId: t.ingredienteOrigemId,
                ingredienteDestinoId: t.ingredienteDestinoId!,
                restricaoId: v.id,
                observacao: `Escolhido por nutricionista na receita "${origem.nome}"`,
              }))
          : [],
      );
      if (substitutos.length > 0) {
        await tx.ingredienteSubstituto.createMany({
          data: substitutos,
          skipDuplicates: true,
        });
      }
      return adaptada;
    });

    return {
      success: 'Adaptação gravada e verificada.',
      receita: adaptada,
    };
  }

  // ---------------------------------------------------------------------
  // Etapas comuns

  private async carregarOrigem(
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
  private async analisar(
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
  private async pedirProposta(
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

  private substitutosCurados(
    analise: Analise,
    restricoes: RestricaoDoPaciente[],
  ) {
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
  private async conferir(
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
    const foraDaLista = await this.receitaService.verificarIngredientesOcultos(
      modoPreparo,
      nomes,
    );
    if (foraDaLista.length > 0) {
      return `o modo de preparo cita ingredientes fora da lista: ${foraDaLista.join(', ')}`;
    }
    return null;
  }

  private criarAdaptada(
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

  /**
   * Trocas informadas pelo profissional: só valem as de ingrediente da
   * receita original que saiu da lista, com destino que está na lista nova.
   * Ingrediente original que saiu sem troca informada conta como removido.
   */
  private trocasValidas(
    informadas: Troca[],
    origem: Origem,
    idsNovos: string[],
  ): Troca[] {
    const novos = new Set(idsNovos);
    const saiu = origem.ingredientes
      .map((i) => i.ingredienteId)
      .filter((id) => !novos.has(id));
    return saiu.map((id) => {
      const troca = informadas.find(
        (t) =>
          t.ingredienteOrigemId === id &&
          t.acao === 'substituir' &&
          t.ingredienteDestinoId &&
          novos.has(t.ingredienteDestinoId),
      );
      return troca
        ? {
            ingredienteOrigemId: id,
            acao: 'substituir' as const,
            ingredienteDestinoId: troca.ingredienteDestinoId,
          }
        : { ingredienteOrigemId: id, acao: 'remover' as const };
    });
  }

  /** Só o profissional do paciente (ou admin) mexe na adaptação dele. */
  private async garantirPacienteDoProfissional(
    pacienteId: string,
    usuario: UsuarioAutenticado,
  ) {
    const [paciente, profissional] = await Promise.all([
      this.prismaService.paciente.findUnique({ where: { id: pacienteId } }),
      this.prismaService.profissional.findUnique({
        where: { usuarioId: usuario.id },
      }),
    ]);
    if (!paciente) {
      throw new NotFoundException('Paciente não encontrado');
    }
    const ehAdmin = usuario.tipoUsuario === TipoUsuario.admin;
    if (
      !ehAdmin &&
      (!profissional || paciente.profissionalId !== profissional.id)
    ) {
      throw new ForbiddenException(
        'Só o profissional do paciente pode adaptar receitas para ele',
      );
    }
    if (!profissional) {
      throw new ForbiddenException(
        'É preciso ter cadastro de profissional para verificar a adaptação',
      );
    }
    return profissional;
  }

  private temNaoListados(origem: Origem) {
    return origem.ingredientesNaoListados.length > 0;
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
      OR: [
        {
          status: StatusReceita.aprovada,
          AND: [semAdaptacoesDeOutros(usuario.id)],
        },
        { criadoPor: usuario.id },
      ],
    };
  }
}
