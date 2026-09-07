import { Injectable, Logger } from '@nestjs/common';
import { OrigemVinculoRestricao, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const CAMPOS_NUMERICOS_INGREDIENTE = [
  'caloriasKcal',
  'proteinasG',
  'carboidratosG',
  'gordurasG',
  'fibrasG',
  'sodioMg',
] as const;

type CampoNumericoIngrediente = (typeof CAMPOS_NUMERICOS_INGREDIENTE)[number];

function isCampoNumericoIngrediente(campo: string): campo is CampoNumericoIngrediente {
  return (CAMPOS_NUMERICOS_INGREDIENTE as readonly string[]).includes(campo);
}

const COMPARADORES: Record<string, (valor: number, limite: number) => boolean> = {
  '>': (valor, limite) => valor > limite,
  '>=': (valor, limite) => valor >= limite,
  '<': (valor, limite) => valor < limite,
  '<=': (valor, limite) => valor <= limite,
};

/**
 * Avalia RestricaoRegraNutricional (ex: sódio > 600mg/100g -> hipertensão)
 * contra os dados de um Ingrediente e mantém IngredienteRestricao em sincronia
 * para vínculos com origem = automatico_regra_nutricional.
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

    for (const regra of regras) {
      await this.avaliarRegra(ingrediente, regra);
    }
  }

  private async avaliarRegra(
    ingrediente: Prisma.IngredienteGetPayload<Record<string, never>>,
    regra: Prisma.RestricaoRegraNutricionalGetPayload<Record<string, never>>,
  ): Promise<void> {
    if (regra.valorLimite === null) {
      return;
    }

    if (!isCampoNumericoIngrediente(regra.campoNutricional)) {
      this.logger.warn(
        `RestricaoRegraNutricional ${regra.id} referencia campo desconhecido "${regra.campoNutricional}" — ignorada.`,
      );
      return;
    }

    const comparar = COMPARADORES[regra.operador];
    if (!comparar) {
      this.logger.warn(
        `RestricaoRegraNutricional ${regra.id} usa operador desconhecido "${regra.operador}" — ignorada.`,
      );
      return;
    }

    const chave = {
      ingredienteId_restricaoId: {
        ingredienteId: ingrediente.id,
        restricaoId: regra.restricaoId,
      },
    };

    const valorCampo = ingrediente[regra.campoNutricional];

    if (valorCampo === null) {
      // Regra de segurança: dado nutricional ausente NUNCA é tratado como
      // "abaixo do limiar" (que marcaria o ingrediente como seguro
      // silenciosamente). Não vincula automaticamente e não mexe em nenhum
      // vínculo manual já existente — fica pendente de revisão humana.
      this.logger.warn(
        `Ingrediente ${ingrediente.id} sem dado em "${regra.campoNutricional}" — ` +
          `pendente de revisão manual para restrição ${regra.restricaoId}.`,
      );
      return;
    }

    const atendeRegra = comparar(valorCampo.toNumber(), regra.valorLimite.toNumber());

    if (atendeRegra) {
      await this.prismaService.ingredienteRestricao.upsert({
        where: chave,
        create: {
          ingredienteId: ingrediente.id,
          restricaoId: regra.restricaoId,
          origem: OrigemVinculoRestricao.automatico_regra_nutricional,
        },
        update: {},
      });
      return;
    }

    // Não atende (mais) a regra: remove o vínculo apenas se ele tiver sido
    // gerado por essa mesma regra automática. Curadoria manual é intocável.
    await this.prismaService.ingredienteRestricao.deleteMany({
      where: {
        ingredienteId: ingrediente.id,
        restricaoId: regra.restricaoId,
        origem: OrigemVinculoRestricao.automatico_regra_nutricional,
      },
    });
  }
}
