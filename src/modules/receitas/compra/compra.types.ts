import {
  NivelDificuldade,
  Prisma,
  ReceitaIngrediente,
  ReceitaMidia,
  TipoMidia,
} from '@prisma/client';

/**
 * Conteúdo da versão comprada, gravado em ReceitaCompra.conteudoComprado.
 * A cópia nasce dele, não do estado atual da original, que o vendedor pode
 * ter editado enquanto a compra estava pendente.
 */
export interface ConteudoComprado {
  nome: string;
  descricao: string | null;
  modoPreparo: string | null;
  tempoPreparoMin: number | null;
  porcoes: number | null;
  nivelDificuldade: NivelDificuldade;
  avisoContaminacaoCruzada: boolean;
  ingredientesNaoListados: string[];
  ingredientes: {
    ingredienteId: string;
    quantidade: string;
    unidadeMedidaId: string;
  }[];
  midias: { url: string; tipo: TipoMidia; ordem: number }[];
}

type ReceitaComConteudo = Pick<
  ConteudoComprado,
  | 'nome'
  | 'descricao'
  | 'modoPreparo'
  | 'tempoPreparoMin'
  | 'porcoes'
  | 'nivelDificuldade'
  | 'avisoContaminacaoCruzada'
  | 'ingredientesNaoListados'
> & {
  ingredientes: Pick<
    ReceitaIngrediente,
    'ingredienteId' | 'quantidade' | 'unidadeMedidaId'
  >[];
  midias: Pick<ReceitaMidia, 'url' | 'tipo' | 'ordem'>[];
};

export function conteudoDaReceita(
  receita: ReceitaComConteudo,
): ConteudoComprado {
  return {
    nome: receita.nome,
    descricao: receita.descricao,
    modoPreparo: receita.modoPreparo,
    tempoPreparoMin: receita.tempoPreparoMin,
    porcoes: receita.porcoes,
    nivelDificuldade: receita.nivelDificuldade,
    avisoContaminacaoCruzada: receita.avisoContaminacaoCruzada,
    ingredientesNaoListados: receita.ingredientesNaoListados,
    ingredientes: receita.ingredientes.map((i) => ({
      ingredienteId: i.ingredienteId,
      quantidade: new Prisma.Decimal(i.quantidade).toString(),
      unidadeMedidaId: i.unidadeMedidaId,
    })),
    midias: [...receita.midias]
      .sort((a, b) => a.ordem - b.ordem)
      .map((m) => ({ url: m.url, tipo: m.tipo, ordem: m.ordem })),
  };
}
