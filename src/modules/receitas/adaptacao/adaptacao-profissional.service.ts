import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, StatusReceita, TipoUsuario } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { UsuarioAutenticado } from '../../../auth/auth.types';
import { IngredientesReceitaService } from '../receita/ingredientes-receita.service';
import { restricoesDoPaciente } from '../visibilidade/restricoes-receita';
import { AdaptacaoBaseService, Origem } from './adaptacao-base.service';
import { Troca, interpretarAdaptacao, interpretarOpcoes } from './adaptacao';
import { AdaptacaoProfissionalDto } from './dtos/adaptar-receita';

/**
 * O profissional do paciente recebe sugestões de adaptação e decide
 * (regra_negocio_receitas_seguras.md, "Adaptação pelo profissional do
 * paciente"). A escolha dele já é a verificação, e a adaptação é só daquele
 * paciente. Considera todas as restrições do paciente de uma vez.
 */
@Injectable()
export class AdaptacaoProfissionalService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly base: AdaptacaoBaseService,
    private readonly ingredientesReceita: IngredientesReceitaService,
  ) {}

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
    const origem = await this.base.carregarOrigem(receitaId, {});
    const resumoRestricoes = restricoes.map((r) => ({
      id: r.restricaoId,
      nome: r.nome,
      estrita: r.estrita,
    }));

    const analise = await this.base.analisar(origem, restricoes);
    if (analise.problematicos.size === 0 && !this.base.temNaoListados(origem)) {
      return {
        receita: { id: origem.id, nome: origem.nome },
        restricoesDoPaciente: resumoRestricoes,
        segura: true,
      };
    }

    const { resposta, candidatos } = await this.base.pedirProposta(
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
    const curados = await this.base.substitutosCurados(analise, restricoes);
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
      const problema = await this.base.conferir(
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
    const origem = await this.base.carregarOrigem(receitaId, {});
    await this.ingredientesReceita.validarIngredientes(dto.ingredientes);

    const idsNovos = dto.ingredientes.map((i) => i.ingredienteId);
    const modoPreparo =
      dto.modoPreparo !== undefined ? dto.modoPreparo : origem.modoPreparo;
    const problema = await this.base.conferir(
      idsNovos,
      modoPreparo,
      restricoes,
    );
    if (problema) {
      throw new UnprocessableEntityException(
        `A adaptação não é segura para o paciente: ${problema}.`,
      );
    }

    const trocas = this.trocasValidas(dto.trocas ?? [], origem, idsNovos);
    const analise = await this.base.analisar(origem, restricoes);

    const adaptada = await this.prismaService.$transaction(async (tx) => {
      const adaptada = await this.base.criarAdaptada(tx, origem, {
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
}
