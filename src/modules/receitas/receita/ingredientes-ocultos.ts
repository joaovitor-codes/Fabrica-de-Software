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
 * Fora do formato, null: a conferência não aconteceu, e quem chama não pode
 * tratar isso como "nada a apontar".
 */
export function interpretarIngredientesNaoListados(
  resposta: unknown,
): string[] | null {
  const faltando = (resposta as { faltando?: unknown })?.faltando;
  if (!Array.isArray(faltando)) {
    return null;
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

/** Minúsculas e sem acento, para comparar texto do autor com nomes do catálogo. */
export function normalizar(texto: string) {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * Alimentos que mais disparam restrição (os alérgenos principais, leite e
 * glúten). A checagem por palavra não depende da IA: um modo de preparo que
 * tente convencer a IA a não apontar nada ainda tem o "queijo" achado aqui.
 * - `palavras`: como aparecem no texto (sem acento);
 * - `cobertoPor`: trechos que, no nome de um ingrediente da lista, mostram
 *   que o alimento está nela.
 */
const ALIMENTOS_SENSIVEIS: {
  nome: string;
  palavras: string[];
  cobertoPor: string[];
}[] = [
  { nome: 'leite', palavras: ['leite', 'leites'], cobertoPor: ['leite'] },
  { nome: 'queijo', palavras: ['queijo', 'queijos'], cobertoPor: ['queijo'] },
  { nome: 'manteiga', palavras: ['manteiga'], cobertoPor: ['manteiga'] },
  {
    nome: 'creme de leite',
    palavras: ['creme de leite'],
    cobertoPor: ['creme de leite'],
  },
  { nome: 'requeijão', palavras: ['requeijao'], cobertoPor: ['requeijao'] },
  {
    nome: 'iogurte',
    palavras: ['iogurte', 'iogurtes'],
    cobertoPor: ['iogurte'],
  },
  { nome: 'nata', palavras: ['nata'], cobertoPor: ['nata'] },
  { nome: 'ricota', palavras: ['ricota'], cobertoPor: ['ricota'] },
  { nome: 'chantilly', palavras: ['chantilly'], cobertoPor: ['chantilly'] },
  { nome: 'ovo', palavras: ['ovo', 'ovos'], cobertoPor: ['ovo'] },
  { nome: 'gema', palavras: ['gema', 'gemas'], cobertoPor: ['ovo', 'gema'] },
  { nome: 'maionese', palavras: ['maionese'], cobertoPor: ['maionese'] },
  { nome: 'trigo', palavras: ['trigo'], cobertoPor: ['trigo'] },
  {
    nome: 'farinha',
    palavras: ['farinha', 'farinhas'],
    cobertoPor: ['farinha'],
  },
  { nome: 'pão', palavras: ['pao', 'paes'], cobertoPor: ['pao'] },
  {
    nome: 'macarrão',
    palavras: ['macarrao'],
    cobertoPor: ['macarrao', 'massa'],
  },
  { nome: 'centeio', palavras: ['centeio'], cobertoPor: ['centeio'] },
  { nome: 'cevada', palavras: ['cevada'], cobertoPor: ['cevada'] },
  { nome: 'malte', palavras: ['malte'], cobertoPor: ['malte'] },
  { nome: 'soja', palavras: ['soja'], cobertoPor: ['soja'] },
  { nome: 'shoyu', palavras: ['shoyu'], cobertoPor: ['shoyu', 'soja'] },
  { nome: 'tofu', palavras: ['tofu'], cobertoPor: ['tofu'] },
  {
    nome: 'amendoim',
    palavras: ['amendoim', 'amendoins'],
    cobertoPor: ['amendoim'],
  },
  {
    nome: 'castanha',
    palavras: ['castanha', 'castanhas'],
    cobertoPor: ['castanha'],
  },
  { nome: 'nozes', palavras: ['noz', 'nozes'], cobertoPor: ['noz'] },
  {
    nome: 'amêndoa',
    palavras: ['amendoa', 'amendoas'],
    cobertoPor: ['amendoa'],
  },
  { nome: 'avelã', palavras: ['avela', 'avelas'], cobertoPor: ['avela'] },
  { nome: 'pistache', palavras: ['pistache'], cobertoPor: ['pistache'] },
  { nome: 'macadâmia', palavras: ['macadamia'], cobertoPor: ['macadamia'] },
  {
    nome: 'peixe',
    palavras: ['peixe', 'peixes'],
    cobertoPor: [
      'peixe',
      'atum',
      'salmao',
      'bacalhau',
      'sardinha',
      'tilapia',
      'merluza',
      'pescada',
      'corvina',
      'cacao',
    ],
  },
  { nome: 'atum', palavras: ['atum'], cobertoPor: ['atum'] },
  { nome: 'salmão', palavras: ['salmao'], cobertoPor: ['salmao'] },
  { nome: 'bacalhau', palavras: ['bacalhau'], cobertoPor: ['bacalhau'] },
  {
    nome: 'sardinha',
    palavras: ['sardinha', 'sardinhas'],
    cobertoPor: ['sardinha'],
  },
  {
    nome: 'camarão',
    palavras: ['camarao', 'camaroes'],
    cobertoPor: ['camarao'],
  },
  { nome: 'lagosta', palavras: ['lagosta'], cobertoPor: ['lagosta'] },
  {
    nome: 'caranguejo',
    palavras: ['caranguejo', 'caranguejos'],
    cobertoPor: ['caranguejo'],
  },
  { nome: 'siri', palavras: ['siri'], cobertoPor: ['siri'] },
  { nome: 'lula', palavras: ['lula', 'lulas'], cobertoPor: ['lula'] },
  { nome: 'polvo', palavras: ['polvo'], cobertoPor: ['polvo'] },
  {
    nome: 'marisco',
    palavras: ['marisco', 'mariscos', 'mexilhao', 'mexilhoes'],
    cobertoPor: ['marisco', 'mexilhao', 'ostra', 'vieira'],
  },
];

const escapar = (texto: string) => texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const PADROES = ALIMENTOS_SENSIVEIS.map((alimento) => ({
  ...alimento,
  // Palavra inteira; "sem leite" ou "livre de leite" não é uso do alimento.
  regex: new RegExp(
    `(?<!\\bsem\\s)(?<!\\blivre de\\s)\\b(?:${alimento.palavras
      .map(escapar)
      .join('|')})\\b`,
  ),
}));

/**
 * Alimentos sensíveis que o modo de preparo cita e a lista não tem, achados
 * por palavra, sem IA. Não substitui a IA (ela acha "calda de chocolate", que
 * não está aqui): soma-se a ela.
 */
export function alimentosSensiveisCitados(
  modoPreparo: string,
  nomesIngredientes: string[],
): string[] {
  const texto = normalizar(modoPreparo);
  const lista = nomesIngredientes.map(normalizar);
  return PADROES.filter(
    (alimento) =>
      alimento.regex.test(texto) &&
      !lista.some((nome) => alimento.cobertoPor.some((c) => nome.includes(c))),
  ).map((alimento) => alimento.nome);
}

/**
 * O que a IA apontou mais o que a checagem por palavra achou. Um alimento
 * que a IA já apontou com outro nome ("queijo ralado") não se repete.
 */
export function juntarApontados(daIa: string[], porPalavra: string[]) {
  const apontados = daIa.map(normalizar);
  const extras = porPalavra.filter((nome) => {
    const chave = normalizar(nome);
    return !apontados.some((a) => a.includes(chave));
  });
  return [...daIa, ...extras].slice(0, MAX_ITENS);
}
