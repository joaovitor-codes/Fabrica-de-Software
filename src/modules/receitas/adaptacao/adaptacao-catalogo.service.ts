import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { Receita, StatusReceita } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { UsuarioAutenticado } from '../../../auth/auth.types';
import { VisibilidadeReceitaService } from '../visibilidade/visibilidade-receita.service';
import {
  RestricaoDoPaciente,
  RestricaoViolada,
  restricoesVioladas,
} from '../visibilidade/restricoes-receita';
import { AdaptacaoPacienteService } from './adaptacao-paciente.service';

export interface Adaptada {
  receita: Receita;
  restricoesVioladas: RestricaoViolada[];
}

/** Quanto pior, maior: estrita pesa mais que leve/moderada. */
export const peso = (violadas: RestricaoViolada[]) =>
  violadas.reduce((total, v) => total + (v.estrita ? 100 : 1), 0);

/**
 * Catálogo que se adapta ao paciente (Fase 3 de
 * regra_negocio_receitas_seguras.md): no lugar da receita que fere uma
 * restrição dele, a versão adaptada. Nas listagens só usa adaptações que já
 * existem; ao abrir uma receita, cria a adaptação se ela ainda não existir.
 */
@Injectable()
export class AdaptacaoCatalogoService {
  private readonly logger = new Logger(AdaptacaoCatalogoService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly visibilidade: VisibilidadeReceitaService,
    private readonly adaptacaoPaciente: AdaptacaoPacienteService,
  ) {}

  /**
   * Para cada receita de origem, a adaptação visível para o usuário que
   * menos fere as restrições dele (a verificada ganha no empate). Inclui a
   * adaptação que o profissional fez para ele. Uma consulta para todas.
   */
  async melhoresAdaptacoes(
    origemIds: string[],
    usuario: UsuarioAutenticado,
    restricoes: RestricaoDoPaciente[],
    somenteAprovadas = false,
  ): Promise<Map<string, Adaptada>> {
    const melhores = new Map<string, Adaptada>();
    if (origemIds.length === 0) {
      return melhores;
    }

    const adaptadas = await this.prismaService.receita.findMany({
      where: {
        deletedAt: null,
        adaptacaoDe: { is: { receitaOrigemId: { in: origemIds } } },
        ...(somenteAprovadas ? { status: StatusReceita.aprovada } : {}),
        AND: [this.visibilidade.filtroVisibilidade(usuario, restricoes)],
      },
      include: { adaptacaoDe: { select: { receitaOrigemId: true } } },
    });
    const violadas = await restricoesVioladas(
      this.prismaService,
      adaptadas.map((a) => a.id),
      restricoes,
    );

    for (const { adaptacaoDe, ...receita } of adaptadas) {
      const origemId = adaptacaoDe!.receitaOrigemId;
      const candidata = {
        receita: receita,
        restricoesVioladas: violadas.get(receita.id) ?? [],
      };
      const atual = melhores.get(origemId);
      if (!atual || this.melhor(candidata, atual)) {
        melhores.set(origemId, candidata);
      }
    }
    return melhores;
  }

  /**
   * O paciente abriu uma receita que fere restrição dele. Devolve a
   * adaptação que já existe ou cria uma, uma restrição de cada vez
   * (estritas primeiro). `null` quando não dá para adaptar com segurança: aí
   * vale o comportamento normal (aviso ou 403).
   */
  async abrirAdaptada(
    origem: { id: string; nome: string },
    violadasNaOrigem: RestricaoViolada[],
    usuario: UsuarioAutenticado,
    restricoes: RestricaoDoPaciente[],
  ): Promise<Adaptada | null> {
    const existente = (
      await this.melhoresAdaptacoes([origem.id], usuario, restricoes)
    ).get(origem.id);
    if (
      existente &&
      peso(existente.restricoesVioladas) < peso(violadasNaOrigem)
    ) {
      return existente;
    }

    const aAdaptar = [...violadasNaOrigem].sort(
      (a, b) => Number(b.estrita) - Number(a.estrita),
    );
    let atualId = origem.id;
    for (const restricao of aAdaptar) {
      let resultado: Awaited<ReturnType<AdaptacaoPacienteService['adaptar']>>;
      try {
        resultado = await this.adaptacaoPaciente.adaptar(
          atualId,
          restricao.id,
          usuario,
          restricoes.filter((r) => r.restricaoId !== restricao.id),
        );
      } catch (erro) {
        this.logger.warn(
          `Não foi possível adaptar a receita ${atualId} para ${restricao.nome}: ${erro}`,
        );
        return null;
      }
      if ('jaSegura' in resultado) {
        continue;
      }
      if (!('receita' in resultado) || !resultado.disponivel) {
        throw new ForbiddenException({
          statusCode: 403,
          error: 'Forbidden',
          message:
            'Esta receita não é segura para as suas restrições. Criamos uma versão adaptada, ' +
            'que fica disponível depois que um profissional a verificar.',
          adaptacao: resultado.adaptacao,
        });
      }
      atualId = resultado.receita.id;
    }
    if (atualId === origem.id) {
      return null;
    }

    // Uma troca para uma restrição pode ter reintroduzido outra: confere a
    // receita final contra todas as restrições do paciente.
    const final = await this.prismaService.receita.findUnique({
      where: { id: atualId },
    });
    const violadasNoFinal =
      (await restricoesVioladas(this.prismaService, [atualId], restricoes)).get(
        atualId,
      ) ?? [];
    if (!final || violadasNoFinal.some((v) => v.estrita)) {
      return null;
    }
    return { receita: final, restricoesVioladas: violadasNoFinal };
  }

  private melhor(a: Adaptada, b: Adaptada) {
    const diferenca = peso(a.restricoesVioladas) - peso(b.restricoesVioladas);
    if (diferenca !== 0) return diferenca < 0;
    return (
      a.receita.status === StatusReceita.aprovada &&
      b.receita.status !== StatusReceita.aprovada
    );
  }
}
