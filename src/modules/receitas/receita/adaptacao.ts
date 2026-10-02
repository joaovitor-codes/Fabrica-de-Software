/**
 * Adaptação de receita por IA (Fase 2 de regra_negocio_receitas_seguras.md).
 * Aqui fica só a parte sem banco: ler a resposta da IA e montar a lista nova
 * de ingredientes. A IA só escolhe entre os candidatos que recebeu, por
 * índice; qualquer coisa fora disso invalida a adaptação.
 */

export type AcaoTroca = 'substituir' | 'remover';

export interface ItemReceita {
  ingredienteId: string;
  nome: string;
  quantidade: number;
  unidadeMedidaId: string;
  unidade: string;
}

export interface Troca {
  ingredienteOrigemId: string;
  acao: AcaoTroca;
  ingredienteDestinoId?: string;
}

export interface PropostaAdaptacao {
  ingredientes: {
    ingredienteId: string;
    quantidade: number;
    unidadeMedidaId: string;
  }[];
  trocas: Troca[];
  modoPreparo?: string;
  resumo: string;
}

// receita_ingredientes.quantidade é Decimal(8, 2).
const QUANTIDADE_MAXIMA = 999999.99;
const RESUMO_MAXIMO = 2000;

const arredondar = (n: number) => Math.round(n * 100) / 100;

/**
 * Valida a resposta da IA:
 * `{ "trocas": [{ "i", "acao", "c"?, "quantidade"? }], "modoPreparo", "resumo" }`
 * - `i`: índice em `itens`; só os de `problematicos` podem ser trocados, e
 *   todos eles precisam ser tratados.
 * - `c`: índice em `candidatos` (obrigatório para substituir).
 * - `quantidade`: na unidade do ingrediente original; sem ela, mantém a
 *   original.
 * Ingrediente que acaba repetido (o substituto já estava na receita) tem as
 * quantidades somadas, se a unidade for a mesma.
 */
export function interpretarAdaptacao(
  resposta: unknown,
  itens: ItemReceita[],
  problematicos: Set<number>,
  candidatos: { id: string; nome: string }[],
): PropostaAdaptacao | { erro: string } {
  const r = resposta as {
    trocas?: unknown;
    modoPreparo?: unknown;
    resumo?: unknown;
  } | null;
  if (!r || !Array.isArray(r.trocas)) {
    return { erro: 'resposta da IA sem a lista de trocas' };
  }

  const porItem = new Map<
    number,
    { acao: AcaoTroca; candidato?: number; quantidade?: number }
  >();
  for (const t of r.trocas as unknown[]) {
    const troca = t as {
      i?: unknown;
      acao?: unknown;
      c?: unknown;
      quantidade?: unknown;
    } | null;
    const i = troca?.i;
    if (typeof i !== 'number' || !problematicos.has(i) || porItem.has(i)) {
      continue;
    }
    if (troca!.acao === 'remover') {
      porItem.set(i, { acao: 'remover' });
      continue;
    }
    const c = troca!.c;
    if (
      troca!.acao !== 'substituir' ||
      typeof c !== 'number' ||
      !Number.isInteger(c) ||
      c < 0 ||
      c >= candidatos.length
    ) {
      return {
        erro: `troca inválida para "${itens[i].nome}"`,
      };
    }
    const quantidade =
      typeof troca!.quantidade === 'number' &&
      troca!.quantidade > 0 &&
      troca!.quantidade <= QUANTIDADE_MAXIMA
        ? arredondar(troca!.quantidade)
        : undefined;
    porItem.set(i, { acao: 'substituir', candidato: c, quantidade });
  }

  const faltando = [...problematicos].filter((i) => !porItem.has(i));
  if (faltando.length > 0) {
    return {
      erro: `a IA não tratou: ${faltando.map((i) => itens[i].nome).join(', ')}`,
    };
  }

  const ingredientes: PropostaAdaptacao['ingredientes'] = [];
  const trocas: Troca[] = [];
  const adicionar = (
    ingredienteId: string,
    quantidade: number,
    unidadeMedidaId: string,
  ): string | null => {
    const existente = ingredientes.find(
      (x) => x.ingredienteId === ingredienteId,
    );
    if (!existente) {
      ingredientes.push({ ingredienteId, quantidade, unidadeMedidaId });
      return null;
    }
    if (existente.unidadeMedidaId !== unidadeMedidaId) {
      return 'o mesmo ingrediente ficaria duas vezes, em unidades diferentes';
    }
    existente.quantidade = arredondar(existente.quantidade + quantidade);
    return null;
  };

  for (const [i, item] of itens.entries()) {
    const troca = porItem.get(i);
    let erro: string | null = null;
    if (!troca) {
      erro = adicionar(
        item.ingredienteId,
        item.quantidade,
        item.unidadeMedidaId,
      );
    } else if (troca.acao === 'remover') {
      trocas.push({ ingredienteOrigemId: item.ingredienteId, acao: 'remover' });
    } else {
      const destino = candidatos[troca.candidato!];
      trocas.push({
        ingredienteOrigemId: item.ingredienteId,
        acao: 'substituir',
        ingredienteDestinoId: destino.id,
      });
      erro = adicionar(
        destino.id,
        troca.quantidade ?? item.quantidade,
        item.unidadeMedidaId,
      );
    }
    if (erro) return { erro };
  }

  if (ingredientes.length === 0) {
    return { erro: 'a adaptação removeria todos os ingredientes' };
  }

  const modoPreparo =
    typeof r.modoPreparo === 'string' && r.modoPreparo.trim()
      ? r.modoPreparo.trim()
      : undefined;
  const resumo =
    typeof r.resumo === 'string' ? r.resumo.trim().slice(0, RESUMO_MAXIMO) : '';

  return { ingredientes, trocas, modoPreparo, resumo };
}
