/**
 * Ingredientes citados no modo de preparo que faltam na lista da receita
 * (ex: "finalize com queijo ralado" sem queijo na lista). O filtro de
 * restrições só enxerga a lista; um ingrediente fora dela passaria sem ser
 * conferido. A IA aponta, a receita guarda em ingredientesNaoListados e o
 * filtro estrito trata a receita como não revisada enquanto houver algum.
 * Regras em regra_negocio_receitas_seguras.md (Fase 1, item 8).
 */

const MAX_ITENS = 20;
const MAX_TAMANHO = 80;

/**
 * Valida a resposta da IA (`{ "faltando": ["queijo ralado", ...] }`):
 * só textos, sem repetição (ignorando maiúsculas), aparados e limitados.
 * Qualquer outra coisa vira lista vazia.
 */
export function interpretarIngredientesNaoListados(
  resposta: unknown,
): string[] {
  const faltando = (resposta as { faltando?: unknown })?.faltando;
  if (!Array.isArray(faltando)) {
    return [];
  }

  const vistos = new Set<string>();
  const resultado: string[] = [];
  for (const item of faltando) {
    if (typeof item !== 'string') continue;
    const nome = item.trim().slice(0, MAX_TAMANHO);
    const chave = nome.toLowerCase();
    if (!nome || vistos.has(chave)) continue;
    vistos.add(chave);
    resultado.push(nome);
    if (resultado.length === MAX_ITENS) break;
  }
  return resultado;
}
