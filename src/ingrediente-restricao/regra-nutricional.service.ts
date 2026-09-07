import { Injectable, Logger } from '@nestjs/common';
import {
  CampoNutricionalRegra,
  OperadorRegraNutricional,
  OrigemVinculoRestricao,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type CampoDecimalIngrediente =
  | 'caloriasKcal'
  | 'proteinasG'
  | 'carboidratosG'
  | 'gordurasG'
  | 'fibrasG'
  | 'sodioMg';

// Liga o enum de banco (snake_case, estável) ao nome do campo real em
// Ingrediente (camelCase, gerado pelo Prisma Client).
const CAMPO_INGREDIENTE: Record<CampoNutricionalRegra, CampoDecimalIngrediente> = {
  [CampoNutricionalRegra.calorias_kcal]: 'caloriasKcal',
  [CampoNutricionalRegra.proteinas_g]: 'proteinasG',
  [CampoNutricionalRegra.carboidratos_g]: 'carboidratosG',
  [CampoNutricionalRegra.gorduras_g]: 'gordurasG',
  [CampoNutricionalRegra.fibras_g]: 'fibrasG',
  [CampoNutricionalRegra.sodio_mg]: 'sodioMg',
};

const COMPARADORES: Record<OperadorRegraNutricional, (valor: number, limite: number) => boolean> = {
  [OperadorRegraNutricional.maior_que]: (valor, limite) => valor > limite,
  [OperadorRegraNutricional.maior_igual]: (valor, limite) => valor >= limite,
  [OperadorRegraNutricional.menor_que]: (valor, limite) => valor < limite,
  [OperadorRegraNutricional.menor_igual]: (valor, limite) => valor <= limite,
};

type ResultadoRegra = 'atende' | 'nao_atende' | 'pendente';

type RegraComLimite = Prisma.RestricaoRegraNutricionalGetPayload<Record<string, never>>;
type IngredienteRow = Prisma.IngredienteGetPayload<Record<string, never>>;

/**
 * Avalia RestricaoRegraNutricional (ex: sódio > 600mg/100g -> hipertensão)
 * contra os dados de um Ingrediente e mantém IngredienteRestricao em sincronia
 * para vínculos com origem = automatico_regra_nutricional.
 *
 * Uma restrição pode ter MAIS DE UMA regra nutricional. Elas se combinam com
 * semântica OR: qualquer regra que bater já vincula o ingrediente àquela
 * restrição. Por isso as regras de uma mesma restrição são sempre avaliadas
 * juntas (nunca uma isolada decidindo criar/apagar o vínculo), senão uma
 * regra que não bate apagaria silenciosamente um vínculo válido criado por
 * outra regra da mesma restrição.
 *
 * Nunca cria/apaga vínculo com origem = manual (curadoria humana) — só
 * gerencia os vínculos que ela mesma gerou.
 */
@Injectable()
export class RegraNutricionalService {
  private readonly logger = new Logger(RegraNutricionalService.name);

  constructor(private readonly prismaService: PrismaService) {}

  async avaliarIngrediente(ingredienteId: string): Promise<void> {
    const ingrediente = await this.prismaService.ingrediente.findUnique({
      where: { id: ingredienteId },
    });
    if (!ingrediente) {
      return;
    }

    const regras = await this.prismaService.restricaoRegraNutricional.findMany({
      where: { valorLimite: { not: null } },
    });

    for (const [restricaoId, regrasDaRestricao] of this.agruparPorRestricao(regras)) {
      await this.avaliarRestricaoParaIngrediente(ingrediente, restricaoId, regrasDaRestricao);
    }
  }

  /**
   * Retroaplica uma regra (nova ou com valorLimite alterado) sobre a base de
   * ingredientes já existente. Reavalia junto com as OUTRAS regras da mesma
   * restrição (semântica OR) — senão essa regra isolada poderia apagar um
   * vínculo válido criado por outra regra da mesma restrição.
   */
  async aplicarRegraATodosIngredientes(regraId: string): Promise<void> {
    const regra = await this.prismaService.restricaoRegraNutricional.findUnique({
      where: { id: regraId },
    });
    if (!regra) {
      return;
    }

    const regrasDaRestricao = await this.prismaService.restricaoRegraNutricional.findMany({
      where: { restricaoId: regra.restricaoId, valorLimite: { not: null } },
    });
    if (regrasDaRestricao.length === 0) {
      return;
    }

    const ingredientes = await this.prismaService.ingrediente.findMany();

    for (const ingrediente of ingredientes) {
      await this.avaliarRestricaoParaIngrediente(ingrediente, regra.restricaoId, regrasDaRestricao);
    }
  }

  private agruparPorRestricao(regras: RegraComLimite[]): Map<string, RegraComLimite[]> {
    const grupos = new Map<string, RegraComLimite[]>();
    for (const regra of regras) {
      const grupo = grupos.get(regra.restricaoId) ?? [];
      grupo.push(regra);
      grupos.set(regra.restricaoId, grupo);
    }
    return grupos;
  }

  /**
   * Combina todas as regras nutricionais de UMA restrição sobre UM
   * ingrediente com semântica OR: qualquer regra que bater já vincula.
   * Só desvincula (remove o automático) se TODAS as regras avaliarem
   * definitivamente "não atende" — uma pendência de dado ausente nunca
   * pode, por si só, causar um desvínculo silencioso.
   */
  private async avaliarRestricaoParaIngrediente(
    ingrediente: IngredienteRow,
    restricaoId: string,
    regras: RegraComLimite[],
  ): Promise<void> {
    const resultados = regras.map((regra) => this.avaliarRegra(ingrediente, regra));

    const algumaAtende = resultados.some((resultado) => resultado === 'atende');
    const todasNaoAtendem = resultados.every((resultado) => resultado === 'nao_atende');

    const chave = {
      ingredienteId_restricaoId: { ingredienteId: ingrediente.id, restricaoId },
    };

    if (algumaAtende) {
      await this.prismaService.ingredienteRestricao.upsert({
        where: chave,
        create: {
          ingredienteId: ingrediente.id,
          restricaoId,
          origem: OrigemVinculoRestricao.automatico_regra_nutricional,
        },
        update: {},
      });
      return;
    }

    if (todasNaoAtendem) {
      await this.prismaService.ingredienteRestricao.deleteMany({
        where: {
          ingredienteId: ingrediente.id,
          restricaoId,
          origem: OrigemVinculoRestricao.automatico_regra_nutricional,
        },
      });
      return;
    }

    // Nenhuma regra bateu, mas pelo menos uma ficou "pendente" (dado
    // ausente): não cria (não está provado perigoso) e não apaga (não dá
    // pra confirmar que é seguro) — mantém como está até revisão manual.
  }

  private avaliarRegra(ingrediente: IngredienteRow, regra: RegraComLimite): ResultadoRegra {
    if (regra.valorLimite === null) {
      return 'pendente';
    }

    const campoIngrediente = CAMPO_INGREDIENTE[regra.campoNutricional];
    const comparar = COMPARADORES[regra.operador];
    const valorCampo = ingrediente[campoIngrediente];

    if (valorCampo === null) {
      // Regra de segurança: dado nutricional ausente NUNCA é tratado como
      // "abaixo do limiar" (que marcaria o ingrediente como seguro
      // silenciosamente).
      this.logger.warn(
        `Ingrediente ${ingrediente.id} sem dado em "${campoIngrediente}" — ` +
          `pendente de revisão manual para restrição ${regra.restricaoId}.`,
      );
      return 'pendente';
    }

    return comparar(valorCampo.toNumber(), regra.valorLimite.toNumber()) ? 'atende' : 'nao_atende';
  }
}
