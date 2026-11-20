import {
  BadGatewayException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  CAMPO_INGREDIENTE,
  COMPARADORES,
  RegraNutricionalService,
} from './regra-nutricional.service';
import { IaService } from '../../ia/ia.service';
import { normalizar } from './curadoria-alergenos';
import {
  Descarte,
  interpretarSubstitutos,
  SugestaoNova,
} from './substitutos-ia';
import {
  ingredientesSegurosPara,
  restricaoPorId,
} from '../../receitas/visibilidade/restricoes-receita';

/** fonteDados dos ingredientes criados a partir de sugestão da IA. */
export const FONTE_ESTIMATIVA_IA = 'ia_estimativa_nao_verificada';

type Regra = Prisma.RestricaoRegraNutricionalGetPayload<Record<string, never>>;

/**
 * Padrão de ILIKE que acha um nome do catálogo pelo nome normalizado: as
 * letras que podem ter acento (a, e, i, o, u, c, n) viram `_`, e os espaços,
 * `%`. Pega a mais; quem chama confere com `normalizar`.
 */
export function padraoNomeNormalizado(nomeNormalizado: string) {
  return nomeNormalizado
    .split(' ')
    .map((parte) => parte.replace(/[\\%_]/g, '\\$&').replace(/[aeioucn]/g, '_'))
    .join('%');
}

@Injectable()
export class IngredienteSubstitutoService {
  private readonly logger = new Logger(IngredienteSubstitutoService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly regraNutricionalService: RegraNutricionalService,
    private readonly iaService: IaService,
  ) {}

  private async validarIngredienteRestricao(
    ingredienteId: string,
    restricaoId: string,
  ) {
    const [ingrediente, restricao] = await Promise.all([
      this.prismaService.ingrediente.findUnique({
        where: { id: ingredienteId },
      }),
      this.prismaService.restricaoAlimentar.findUnique({
        where: { id: restricaoId },
      }),
    ]);

    if (!ingrediente) {
      throw new NotFoundException(`Ingrediente não encontrado.`);
    }

    if (!restricao) {
      throw new NotFoundException(`Restrição alimentar não encontrada.`);
    }

    return { ingrediente, restricao };
  }

  async findAll(ingredienteId: string, restricaoId: string) {
    await this.validarIngredienteRestricao(ingredienteId, restricaoId);

    return this.prismaService.ingredienteSubstituto.findMany({
      where: { ingredienteOrigemId: ingredienteId, restricaoId },
      include: { restricao: true, ingredienteDestino: true },
      orderBy: { prioridade: 'asc' },
    });
  }

  /**
   * Pede substitutos à IA e os grava. A IA escolhe de preferência entre os
   * ingredientes do catálogo seguros para a restrição; ingrediente novo só
   * quando nenhum serve, e um novo com o nome (normalizado) de um do
   * catálogo reaproveita o existente. Opção inválida, igual ao original,
   * que fere uma regra nutricional da restrição ou que cai num ingrediente
   * vinculado à restrição é descartada; sem nenhuma válida, 502 e nada é
   * gravado.
   */
  async gerarSubstituto(ingredienteId: string, restricaoId: string) {
    const { ingrediente, restricao } = await this.validarIngredienteRestricao(
      ingredienteId,
      restricaoId,
    );

    // Confere antes de pagar a chamada à IA; a transação confere de novo.
    await this.garantirSemSubstitutos(
      this.prismaService,
      ingredienteId,
      restricaoId,
    );

    const candidatos = await this.candidatosSeguros(ingredienteId, restricaoId);
    const resposta = await this.iaService.encontrarSubstituto(
      ingrediente.nome,
      restricao.nome,
      candidatos.map((c) => c.nome),
    );
    const interpretadas = interpretarSubstitutos(
      resposta,
      ingrediente.nome,
      candidatos.length,
    );
    if (!interpretadas) {
      this.logger.warn(
        `Resposta da IA fora do formato ao gerar substitutos de ${ingredienteId}: ${JSON.stringify(resposta)}`,
      );
      throw new BadGatewayException(
        'A IA respondeu fora do formato esperado. Tente novamente.',
      );
    }
    const descartes = [...interpretadas.descartes];

    const regras = await this.prismaService.restricaoRegraNutricional.findMany({
      where: { restricaoId, valorLimite: { not: null } },
    });
    const opcoes = interpretadas.opcoes.filter((opcao) => {
      if (opcao.tipo === 'catalogo') {
        return true;
      }
      const regra = regras.find((r) => this.fereRegra(opcao, r));
      if (regra) {
        descartes.push({
          indice: -1,
          motivo: `"${opcao.nome}" fere a regra ${regra.campoNutricional} ${regra.operador} ${regra.valorLimite?.toString()}`,
        });
      }
      return !regra;
    });

    const { criados, vinculos } = await this.prismaService.$transaction(
      async (tx) => {
        // Uma geração por ingrediente+restrição de cada vez: a segunda espera
        // a primeira gravar e cai no 409.
        await this.travar(tx, `substituto:${ingredienteId}:${restricaoId}`);
        await this.garantirSemSubstitutos(tx, ingredienteId, restricaoId);

        // Duas gerações (de ingredientes diferentes) que sugerem o mesmo nome
        // novo não criam duas cópias. Ordem fixa para não haver deadlock.
        const chaves = opcoes.map((o) =>
          o.tipo === 'nova' ? normalizar(o.nome) : null,
        );
        for (const chave of chaves.filter((c) => c !== null).sort()) {
          await this.travar(tx, `ingrediente-nome:${chave}`);
        }

        const criados: string[] = [];
        const destinos: { id: string; justificativa: string | null }[] = [];
        for (const [i, opcao] of opcoes.entries()) {
          let existente: { id: string; nome: string } | undefined;
          if (opcao.tipo === 'catalogo') {
            existente = candidatos[opcao.c];
          } else {
            existente = await this.buscarPorNome(tx, chaves[i]!);
            if (!existente) {
              const novo = await tx.ingrediente.create({
                data: {
                  nome: opcao.nome,
                  caloriasKcal: opcao.caloriasKcal,
                  proteinasG: opcao.proteinasG,
                  carboidratosG: opcao.carboidratosG,
                  gordurasG: opcao.gordurasG,
                  fibrasG: opcao.fibrasG,
                  sodioMg: opcao.sodioMg,
                  fonteDados: FONTE_ESTIMATIVA_IA,
                },
              });
              criados.push(novo.id);
              destinos.push({
                id: novo.id,
                justificativa: opcao.justificativa,
              });
              continue;
            }
          }

          // Um novo com o nome de um candidato já escolhido cai no mesmo.
          if (destinos.some((d) => d.id === existente.id)) {
            descartes.push({
              indice: -1,
              motivo: `"${existente.nome}" repetido`,
            });
            continue;
          }
          // O original não está entre os candidatos e, como novo, já foi
          // descartado pelo nome em interpretarSubstitutos. Confere o vínculo
          // aqui também para o candidato: pode ter mudado desde a consulta.
          const contemRestricao = await tx.ingredienteRestricao.findUnique({
            where: {
              ingredienteId_restricaoId: {
                ingredienteId: existente.id,
                restricaoId,
              },
            },
          });
          if (contemRestricao) {
            descartes.push({
              indice: -1,
              motivo: `"${existente.nome}" do catálogo fere a restrição`,
            });
            continue;
          }
          destinos.push({
            id: existente.id,
            justificativa: opcao.justificativa,
          });
        }

        if (destinos.length === 0) {
          // Lançar aqui desfaz os ingredientes criados neste laço.
          this.logDescartes(ingredienteId, descartes);
          throw new BadGatewayException(
            'A IA não sugeriu nenhum substituto válido. Tente novamente.',
          );
        }

        const vinculos: unknown[] = [];
        for (const [prioridade, destino] of destinos.entries()) {
          vinculos.push(
            await tx.ingredienteSubstituto.create({
              data: {
                ingredienteOrigemId: ingredienteId,
                restricaoId,
                ingredienteDestinoId: destino.id,
                prioridade,
                observacao: destino.justificativa,
              },
              include: { restricao: true, ingredienteDestino: true },
            }),
          );
        }
        return { criados, vinculos };
      },
    );

    if (descartes.length > 0) {
      this.logDescartes(ingredienteId, descartes);
    }

    // Só os novos: os do catálogo já foram avaliados quando entraram.
    for (const id of criados) {
      await this.regraNutricionalService.avaliarIngrediente(id);
    }

    return vinculos;
  }

  /**
   * Ingredientes do catálogo seguros para a restrição (os mesmos que a
   * adaptação de receitas oferece à IA), sem o próprio ingrediente.
   */
  private async candidatosSeguros(ingredienteId: string, restricaoId: string) {
    const restricao = await restricaoPorId(this.prismaService, restricaoId);
    if (!restricao) {
      return [];
    }
    const seguros = await ingredientesSegurosPara(this.prismaService, [
      restricao,
    ]);
    return seguros.filter((i) => i.id !== ingredienteId);
  }

  private async garantirSemSubstitutos(
    db: Prisma.TransactionClient,
    ingredienteId: string,
    restricaoId: string,
  ) {
    const jaExiste = await db.ingredienteSubstituto.findFirst({
      where: { ingredienteOrigemId: ingredienteId, restricaoId },
      select: { id: true },
    });
    if (jaExiste) {
      throw new ConflictException(
        `Já existe um substituto para esse ingrediente e restrição`,
      );
    }
  }

  private async travar(tx: Prisma.TransactionClient, chave: string) {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${chave}))::text`;
  }

  /** O mais antigo do catálogo com esse nome normalizado, se houver. */
  private async buscarPorNome(
    tx: Prisma.TransactionClient,
    chave: string,
  ): Promise<{ id: string; nome: string } | undefined> {
    const parecidos = await tx.$queryRaw<{ id: string; nome: string }[]>`
      SELECT id, nome FROM ingredientes
      WHERE nome ILIKE ${padraoNomeNormalizado(chave)}
      ORDER BY created_at, id`;
    return parecidos.find((i) => normalizar(i.nome) === chave);
  }

  private fereRegra(opcao: SugestaoNova, regra: Regra) {
    if (regra.valorLimite === null) {
      return false;
    }
    const valor = opcao[CAMPO_INGREDIENTE[regra.campoNutricional]];
    return COMPARADORES[regra.operador](valor, regra.valorLimite.toNumber());
  }

  private logDescartes(ingredienteId: string, descartes: Descarte[]) {
    this.logger.warn(
      `Sugestões da IA descartadas para ${ingredienteId}: ${descartes
        .map((d) => (d.indice >= 0 ? `#${d.indice} ${d.motivo}` : d.motivo))
        .join('; ')}`,
    );
  }
}
