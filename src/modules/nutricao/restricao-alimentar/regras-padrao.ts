import {
  CampoNutricionalRegra,
  OperadorRegraNutricional,
  TipoRestricao,
} from '@prisma/client';
import { normalizar } from '../ingrediente-restricao/curadoria-alergenos';

/**
 * Restrições com regra nutricional que todo banco deve ter, usadas por
 * scripts/regras-nutricionais.ts (passo do `npm run db:preparar`). As regras
 * são dado, não código: o RegraNutricionalService avalia qualquer uma.
 * Uma doença nova entra aqui quando o limite for definido (ver
 * regra_negocio.md, "Limiares de doença crônica").
 */

export interface RegraPadrao {
  campo: CampoNutricionalRegra;
  operador: OperadorRegraNutricional;
  limite: number;
}

export interface RestricaoComRegrasPadrao {
  nome: string;
  tipo: TipoRestricao;
  descricao: string;
  regras: RegraPadrao[];
}

export const REGRAS_PADRAO: RestricaoComRegrasPadrao[] = [
  {
    nome: 'Hipertensão',
    tipo: TipoRestricao.doenca_cronica,
    descricao:
      'Sódio acima de 600 mg por 100 g (alto teor, RDC nº 429/2020 da ANVISA).',
    regras: [
      {
        campo: CampoNutricionalRegra.sodio_mg,
        operador: OperadorRegraNutricional.maior_que,
        limite: 600,
      },
    ],
  },
];

export interface RestricaoExistente {
  nome: string;
  tipo: TipoRestricao;
  regras: {
    campoNutricional: CampoNutricionalRegra;
    operador: OperadorRegraNutricional;
    valorLimite: number | null;
  }[];
}

export interface PlanoRegras {
  restricoesACriar: RestricaoComRegrasPadrao[];
  /** Regras de restrições que já existem no banco. */
  regrasACriar: { restricao: string; regra: RegraPadrao }[];
  avisos: string[];
}

/**
 * Compara a lista padrão com o banco e diz o que falta criar. Nunca altera o
 * que existe: um limite diferente no banco pode ser decisão de quem
 * administra aquele ambiente, então vira aviso.
 */
export function planejarRegras(
  existentes: RestricaoExistente[],
  padrao: RestricaoComRegrasPadrao[] = REGRAS_PADRAO,
): PlanoRegras {
  const porNome = new Map(existentes.map((r) => [normalizar(r.nome), r]));
  const plano: PlanoRegras = {
    restricoesACriar: [],
    regrasACriar: [],
    avisos: [],
  };

  for (const restricao of padrao) {
    const existente = porNome.get(normalizar(restricao.nome));
    if (!existente) {
      plano.restricoesACriar.push(restricao);
      continue;
    }

    if (existente.tipo !== restricao.tipo) {
      plano.avisos.push(
        `"${existente.nome}" está como ${existente.tipo}; o padrão é ${restricao.tipo}. Mantido como está.`,
      );
    }

    for (const regra of restricao.regras) {
      const igual = existente.regras.find(
        (r) =>
          r.campoNutricional === regra.campo && r.operador === regra.operador,
      );
      if (!igual) {
        plano.regrasACriar.push({ restricao: existente.nome, regra });
      } else if (igual.valorLimite !== regra.limite) {
        plano.avisos.push(
          `"${existente.nome}": ${regra.campo} ${regra.operador} está com limite ${igual.valorLimite ?? 'vazio'}; o padrão é ${regra.limite}. Mantido como está.`,
        );
      }
    }
  }

  return plano;
}
