import { Gravidade, Prisma, TipoRestricao, TipoUsuario } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { CAMPO_INGREDIENTE } from '../../nutricao/ingrediente-restricao/regra-nutricional.service';

/**
 * Quais receitas um paciente pode comer, e por quê não. Usado pelo filtro e
 * pelos avisos de ReceitaService e pelo plano alimentar. Regras em
 * regra_negocio_receitas_seguras.md.
 */

type CampoIngrediente =
  (typeof CAMPO_INGREDIENTE)[keyof typeof CAMPO_INGREDIENTE];

export interface RestricaoDoPaciente {
  restricaoId: string;
  nome: string;
  /** Alergia ou gravidade grave: esconde a receita em vez de só avisar. */
  estrita: boolean;
  /** A revisão do ingrediente só vale se for posterior a isso. */
  criadaEm: Date;
  /** Campos das regras nutricionais da restrição (ex: sodioMg). */
  campos: CampoIngrediente[];
}

export interface IngredienteResumo {
  id: string;
  nome: string;
}

export interface RestricaoViolada {
  id: string;
  nome: string;
  estrita: boolean;
  /** Ingredientes vinculados à restrição. */
  contem: IngredienteResumo[];
  /** Ninguém conferiu (ou conferiu antes de a restrição existir). */
  naoRevisados: IngredienteResumo[];
  /** Sem o dado que a regra nutricional da restrição precisa. */
  semDado: IngredienteResumo[];
}

export const ehEstrita = (tipo: TipoRestricao, gravidade: Gravidade) =>
  tipo === TipoRestricao.alergia || gravidade === Gravidade.grave;

/** Restrições do paciente que satisfaz `paciente` (ex: `{ usuarioId }`). */
export async function restricoesDoPaciente(
  prisma: PrismaService,
  paciente: Prisma.PacienteWhereInput,
): Promise<RestricaoDoPaciente[]> {
  const vinculos = await prisma.pacienteRestricao.findMany({
    where: { paciente },
    select: {
      restricaoId: true,
      gravidade: true,
      restricao: {
        select: {
          nome: true,
          tipo: true,
          createdAt: true,
          regrasNutricionais: {
            where: { valorLimite: { not: null } },
            select: { campoNutricional: true },
          },
        },
      },
    },
  });

  return vinculos.map((v) => ({
    restricaoId: v.restricaoId,
    nome: v.restricao.nome,
    estrita: ehEstrita(v.restricao.tipo, v.gravidade),
    criadaEm: v.restricao.createdAt,
    campos: [
      ...new Set(
        v.restricao.regrasNutricionais.map(
          (r) => CAMPO_INGREDIENTE[r.campoNutricional],
        ),
      ),
    ],
  }));
}

/**
 * Uma restrição qualquer no formato de RestricaoDoPaciente, tratada como
 * estrita (ex: `?seguraPara=`). `null` se não existe.
 */
export async function restricaoPorId(
  prisma: PrismaService,
  restricaoId: string,
): Promise<RestricaoDoPaciente | null> {
  const restricao = await prisma.restricaoAlimentar.findUnique({
    where: { id: restricaoId },
    select: {
      nome: true,
      createdAt: true,
      regrasNutricionais: {
        where: { valorLimite: { not: null } },
        select: { campoNutricional: true },
      },
    },
  });
  if (!restricao) {
    return null;
  }
  return {
    restricaoId,
    nome: restricao.nome,
    estrita: true,
    criadaEm: restricao.createdAt,
    campos: [
      ...new Set(
        restricao.regrasNutricionais.map(
          (r) => CAMPO_INGREDIENTE[r.campoNutricional],
        ),
      ),
    ],
  };
}

/** Restrições do usuário autenticado; vazio se ele não é paciente. */
export function restricoesDoUsuario(
  prisma: PrismaService,
  usuario?: { id: string; tipoUsuario: TipoUsuario },
): Promise<RestricaoDoPaciente[]> {
  if (usuario?.tipoUsuario !== TipoUsuario.paciente) {
    return Promise.resolve([]);
  }
  return restricoesDoPaciente(prisma, { usuarioId: usuario.id });
}

/**
 * `where` de receita que só deixa passar as seguras para TODAS as
 * restrições informadas: todo ingrediente revisado depois da criação da
 * restrição mais recente, com o dado das regras nutricionais e sem vínculo
 * com nenhuma delas. Lista vazia não filtra nada.
 */
export function clausulaSegura(
  restricoes: Pick<
    RestricaoDoPaciente,
    'restricaoId' | 'criadaEm' | 'campos'
  >[],
): Prisma.ReceitaWhereInput {
  if (restricoes.length === 0) {
    return {};
  }

  const criadaPorUltimo = new Date(
    Math.max(...restricoes.map((r) => r.criadaEm.getTime())),
  );
  const campos = [...new Set(restricoes.flatMap((r) => r.campos))];

  return {
    ingredientes: {
      every: {
        ingrediente: {
          restricoesRevisadasEm: { gte: criadaPorUltimo },
          ...Object.fromEntries(campos.map((c) => [c, { not: null }])),
          restricoes: {
            none: {
              restricaoId: { in: restricoes.map((r) => r.restricaoId) },
            },
          },
        },
      },
    },
  };
}

/**
 * O que cada receita fere, por restrição. Receitas sem nenhuma violação
 * ficam com lista vazia. Uma consulta só para todas as receitas.
 */
export async function restricoesVioladas(
  prisma: PrismaService,
  receitaIds: string[],
  restricoes: RestricaoDoPaciente[],
): Promise<Map<string, RestricaoViolada[]>> {
  const resultado = new Map<string, RestricaoViolada[]>(
    receitaIds.map((id) => [id, []]),
  );
  if (receitaIds.length === 0 || restricoes.length === 0) {
    return resultado;
  }

  const itens = await prisma.receitaIngrediente.findMany({
    where: { receitaId: { in: receitaIds } },
    select: {
      receitaId: true,
      ingrediente: {
        select: {
          id: true,
          nome: true,
          restricoesRevisadasEm: true,
          caloriasKcal: true,
          proteinasG: true,
          carboidratosG: true,
          gordurasG: true,
          fibrasG: true,
          sodioMg: true,
          restricoes: {
            where: {
              restricaoId: { in: restricoes.map((r) => r.restricaoId) },
            },
            select: { restricaoId: true },
          },
        },
      },
    },
  });

  const porReceita = new Map<string, (typeof itens)[number]['ingrediente'][]>();
  for (const { receitaId, ingrediente } of itens) {
    porReceita.set(receitaId, [
      ...(porReceita.get(receitaId) ?? []),
      ingrediente,
    ]);
  }

  for (const [receitaId, ingredientes] of porReceita) {
    const resumo = (i: { id: string; nome: string }) => ({
      id: i.id,
      nome: i.nome,
    });
    const violadas = restricoes
      .map((r) => ({
        id: r.restricaoId,
        nome: r.nome,
        estrita: r.estrita,
        contem: ingredientes
          .filter((i) =>
            i.restricoes.some((v) => v.restricaoId === r.restricaoId),
          )
          .map(resumo),
        naoRevisados: ingredientes
          .filter(
            (i) =>
              !i.restricoesRevisadasEm || i.restricoesRevisadasEm < r.criadaEm,
          )
          .map(resumo),
        semDado: ingredientes
          .filter((i) => r.campos.some((campo) => i[campo] === null))
          .map(resumo),
      }))
      .filter(
        (v) =>
          v.contem.length > 0 ||
          v.naoRevisados.length > 0 ||
          v.semDado.length > 0,
      );
    resultado.set(receitaId, violadas);
  }

  return resultado;
}
