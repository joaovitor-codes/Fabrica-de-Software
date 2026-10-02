import { TipoRestricao } from '@prisma/client';

/**
 * Lógica da curadoria de restrições dos ingredientes (Fase 0 de
 * regra_negocio_receitas_seguras.md), usada por
 * scripts/curadoria-alergenos.ts. Fica aqui, sem dependência de banco ou de
 * IA, para poder ser testada.
 *
 * Fluxo: o script gera um CSV de candidatos (palavra-chave + IA), um curador
 * revisa a coluna `decisao` e o script aplica o CSV revisado. A IA nunca grava
 * vínculo direto.
 */

export interface RestricaoCuradoria {
  nome: string;
  tipo: TipoRestricao;
  /** Explicação passada à IA sobre o que fere a restrição. */
  criterio: string;
  /** Sem acento e em minúsculas; casam como palavra inteira, aceitando plural. */
  palavrasChave: string[];
}

const DERIVADOS_LEITE = [
  'leite',
  'queijo',
  'iogurte',
  'manteiga',
  'requeijao',
  'nata',
  'coalhada',
  'ricota',
  'mucarela',
  'mussarela',
  'parmesao',
  'provolone',
  'chantilly',
  'lactose',
  'caseina',
  'whey',
  'kefir',
  'ghee',
  'cream cheese',
  'bechamel',
  'sorvete',
];

const DERIVADOS_TRIGO = [
  'trigo',
  'pao',
  'paes',
  'macarrao',
  'massa',
  'biscoito',
  'bolacha',
  'bolo',
  'torrada',
  'pizza',
  'esfiha',
  'coxinha',
  'pastel',
  'empada',
  'empadinha',
  'lasanha',
  'nhoque',
  'panqueca',
  'croquete',
  'quibe',
  'kibe',
  'semola',
  'semolina',
  'farinha de rosca',
  'croissant',
  'waffle',
  'cookie',
  'bulgur',
  'seitan',
];

/**
 * Alérgenos da RDC nº 26/2015 da ANVISA que fazem sentido em receita, mais
 * as duas restrições mais comuns que não são alergia (lactose e glúten).
 * Os nomes casam com RestricaoAlimentar.nome ignorando acento e maiúsculas.
 */
export const RESTRICOES_CURADORIA: RestricaoCuradoria[] = [
  {
    nome: 'Alergia a leite',
    tipo: TipoRestricao.alergia,
    criterio:
      'contém leite de qualquer mamífero ou derivado (inclusive sem lactose)',
    palavrasChave: DERIVADOS_LEITE,
  },
  {
    nome: 'Intolerância à lactose',
    tipo: TipoRestricao.intolerancia,
    criterio:
      'contém lactose: leite e derivados, exceto os deslactosados ou sem lactose',
    palavrasChave: DERIVADOS_LEITE,
  },
  {
    nome: 'Alergia a ovo',
    tipo: TipoRestricao.alergia,
    criterio: 'contém ovo de qualquer ave, inteiro, gema ou clara',
    palavrasChave: [
      'ovo',
      'gema',
      'clara',
      'maionese',
      'merengue',
      'suspiro',
      'omelete',
      'gemada',
      'quindim',
    ],
  },
  {
    nome: 'Alergia a trigo',
    tipo: TipoRestricao.alergia,
    criterio: 'contém trigo ou farinha de trigo',
    palavrasChave: DERIVADOS_TRIGO,
  },
  {
    nome: 'Doença celíaca',
    tipo: TipoRestricao.doenca_cronica,
    criterio:
      'contém glúten: trigo, centeio, cevada, malte ou aveia não certificada',
    palavrasChave: [
      ...DERIVADOS_TRIGO,
      'centeio',
      'cevada',
      'malte',
      'aveia',
      'cerveja',
    ],
  },
  {
    nome: 'Alergia a soja',
    tipo: TipoRestricao.alergia,
    criterio: 'contém soja ou derivado',
    palavrasChave: [
      'soja',
      'tofu',
      'shoyu',
      'misso',
      'edamame',
      'proteina texturizada',
    ],
  },
  {
    nome: 'Alergia a amendoim',
    tipo: TipoRestricao.alergia,
    criterio: 'contém amendoim',
    palavrasChave: ['amendoim', 'pacoca', 'pe de moleque'],
  },
  {
    nome: 'Alergia a castanhas e nozes',
    tipo: TipoRestricao.alergia,
    criterio:
      'contém castanha, noz, amêndoa, avelã, macadâmia, pecã, pistache ou pinoli',
    palavrasChave: [
      'castanha',
      'noz',
      'amendoa',
      'avela',
      'macadamia',
      'pistache',
      'pinoli',
    ],
  },
  {
    nome: 'Alergia a peixe',
    tipo: TipoRestricao.alergia,
    criterio: 'contém peixe',
    palavrasChave: [
      'peixe',
      'pescado',
      'abadejo',
      'atum',
      'sardinha',
      'salmao',
      'bacalhau',
      'pescada',
      'pescadinha',
      'merluza',
      'tilapia',
      'corvina',
      'cacao',
      'pintado',
      'tucunare',
      'surubim',
      'anchova',
      'badejo',
      'dourada',
      'manjuba',
      'tainha',
      'pacu',
      'tambaqui',
      'robalo',
      'linguado',
      'truta',
      'pirarucu',
    ],
  },
  {
    nome: 'Alergia a crustáceos',
    tipo: TipoRestricao.alergia,
    criterio: 'contém camarão, caranguejo, siri, lagosta ou outro crustáceo',
    palavrasChave: [
      'camarao',
      'caranguejo',
      'siri',
      'lagosta',
      'lagostim',
      'frutos do mar',
    ],
  },
];

/** Minúsculas, sem acento e com espaços simples. */
export const normalizar = (texto: string) =>
  texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const escaparRegex = (texto: string) =>
  texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Restrições cujas palavras-chave aparecem no nome do ingrediente. */
export function encontrarPorPalavraChave(
  nomeIngrediente: string,
  restricoes: RestricaoCuradoria[] = RESTRICOES_CURADORIA,
): string[] {
  const nome = normalizar(nomeIngrediente);
  return restricoes
    .filter((r) =>
      r.palavrasChave.some((palavra) =>
        new RegExp(`\\b${escaparRegex(palavra)}(s|es)?\\b`).test(nome),
      ),
    )
    .map((r) => r.nome);
}

export interface ClassificacaoIa {
  contem: string[];
  incertos: string[];
}

/**
 * Valida a resposta da IA para um lote de `quantidade` ingredientes,
 * indexados de 0 em diante. Descarta índices fora do lote e nomes de
 * restrição que não estão na lista; o ingrediente que ficar sem resposta
 * simplesmente não aparece no Map.
 */
export function interpretarClassificacaoIa(
  resposta: unknown,
  quantidade: number,
  restricoes: RestricaoCuradoria[] = RESTRICOES_CURADORIA,
): Map<number, ClassificacaoIa> {
  const porNomeNormalizado = new Map(
    restricoes.map((r) => [normalizar(r.nome), r.nome]),
  );
  const nomesValidos = (lista: unknown): string[] =>
    Array.isArray(lista)
      ? lista
          .filter((n): n is string => typeof n === 'string')
          .map((n) => porNomeNormalizado.get(normalizar(n)))
          .filter((n): n is string => n !== undefined)
      : [];

  const resultado = new Map<number, ClassificacaoIa>();
  const itens = (resposta as { itens?: unknown })?.itens;
  if (!Array.isArray(itens)) {
    return resultado;
  }

  for (const item of itens) {
    const i = (item as { i?: unknown })?.i;
    if (typeof i !== 'number' || !Number.isInteger(i)) continue;
    if (i < 0 || i >= quantidade) continue;

    const contem = nomesValidos((item as { contem?: unknown }).contem);
    const incertos = nomesValidos(
      (item as { incertos?: unknown }).incertos,
    ).filter((n) => !contem.includes(n));
    resultado.set(i, { contem, incertos });
  }
  return resultado;
}

export const DECISOES = [
  'vincular',
  'descartar',
  'pendente',
  'revisado',
] as const;
export type Decisao = (typeof DECISOES)[number];

export type Fonte = 'palavra_chave' | 'ia' | 'ambos' | 'manual' | '';

export interface LinhaCuradoria {
  ingredienteId: string;
  /** Código estável entre bancos (ex: TACO-4-123); vazio se não houver. */
  codigoFonteExterno: string;
  ingrediente: string;
  /** Vazio na linha que fala do ingrediente como um todo. */
  restricao: string;
  fonte: Fonte;
  atencao: 'sim' | 'nao';
  decisao: Decisao;
  motivo: string;
}

export interface IngredienteCuradoria {
  id: string;
  nome: string;
  codigoFonteExterno?: string | null;
}

/**
 * Monta as linhas do CSV de um ingrediente.
 *
 * - Cada restrição candidata vira uma linha com `decisao = vincular`. Na
 *   dúvida o padrão é vincular: um falso positivo só esconde uma receita, um
 *   falso negativo expõe o paciente ao alérgeno.
 * - Se a IA respondeu e não há candidatas, uma linha `revisado` (sem
 *   restrição) registra que o ingrediente foi analisado.
 * - Se a IA não respondeu, uma linha `pendente` impede que o ingrediente seja
 *   marcado como revisado sem alguém olhar as outras restrições.
 */
export function montarLinhas(
  ingrediente: IngredienteCuradoria,
  porPalavraChave: string[],
  ia: ClassificacaoIa | undefined,
  restricoes: RestricaoCuradoria[] = RESTRICOES_CURADORIA,
): LinhaCuradoria[] {
  const base = {
    ingredienteId: ingrediente.id,
    codigoFonteExterno: ingrediente.codigoFonteExterno ?? '',
    ingrediente: ingrediente.nome,
  };
  const candidatas = restricoes
    .map((r) => r.nome)
    .filter(
      (nome) =>
        porPalavraChave.includes(nome) ||
        ia?.contem.includes(nome) ||
        ia?.incertos.includes(nome),
    );

  const linhas: LinhaCuradoria[] = candidatas.map((restricao) => {
    const naPalavraChave = porPalavraChave.includes(restricao);
    const naIa =
      !!ia &&
      (ia.contem.includes(restricao) || ia.incertos.includes(restricao));

    let motivo = '';
    if (!ia) motivo = 'IA sem resposta';
    else if (ia.incertos.includes(restricao)) motivo = 'IA incerta';
    else if (!naIa) motivo = 'só palavra-chave';
    else if (!naPalavraChave) motivo = 'só IA';

    return {
      ...base,
      restricao,
      fonte: naPalavraChave && naIa ? 'ambos' : naIa ? 'ia' : 'palavra_chave',
      atencao: motivo ? 'sim' : 'nao',
      decisao: 'vincular',
      motivo,
    };
  });

  if (!ia) {
    linhas.push({
      ...base,
      restricao: '',
      fonte: '',
      atencao: 'sim',
      decisao: 'pendente',
      motivo: 'IA sem resposta: conferir as outras restrições',
    });
  } else if (linhas.length === 0) {
    linhas.push({
      ...base,
      restricao: '',
      fonte: '',
      atencao: 'nao',
      decisao: 'revisado',
      motivo: 'nenhuma restrição encontrada',
    });
  }

  return linhas;
}

export const COLUNAS_CSV = [
  'ingrediente_id',
  'codigo_fonte_externo',
  'ingrediente',
  'restricao',
  'fonte',
  'atencao',
  'decisao',
  'motivo',
] as const;

const celula = (valor: string) => `"${valor.replace(/"/g, '""')}"`;

/** CSV com BOM, para o Excel abrir os acentos certo. */
export function gerarCsv(linhas: LinhaCuradoria[]): string {
  const corpo = linhas.map((l) =>
    [
      l.ingredienteId,
      l.codigoFonteExterno,
      l.ingrediente,
      l.restricao,
      l.fonte,
      l.atencao,
      l.decisao,
      l.motivo,
    ]
      .map(celula)
      .join(','),
  );
  return '﻿' + [COLUNAS_CSV.join(','), ...corpo].join('\n') + '\n';
}

export interface PlanoAplicacao {
  vinculos: { ingredienteId: string; restricao: string }[];
  /** Ingredientes sem nenhuma linha `pendente`: serão marcados como revisados. */
  revisados: string[];
  pendentes: string[];
  erros: string[];
}

/**
 * Transforma as linhas do CSV revisado (já lidas como objetos, com os nomes
 * de `COLUNAS_CSV`) no que será gravado. Linhas `descartar` não apagam
 * nada: um vínculo que já existe (ex: curado manualmente) continua.
 */
export function planejarAplicacao(
  linhasCsv: (Record<string, string> | null)[],
  restricoesConhecidas: string[],
): PlanoAplicacao {
  const conhecidas = new Map(
    restricoesConhecidas.map((n) => [normalizar(n), n]),
  );
  const plano: PlanoAplicacao = {
    vinculos: [],
    revisados: [],
    pendentes: [],
    erros: [],
  };
  const ingredientes = new Set<string>();
  const comPendencia = new Set<string>();
  const vistos = new Set<string>();

  linhasCsv.forEach((linha, indice) => {
    if (!linha) return; // ignorada por resolverIngredientes
    const numero = indice + 2; // linha 1 é o cabeçalho
    const ingredienteId = (linha.ingrediente_id ?? '').trim();
    const decisao = normalizar(linha.decisao ?? '') as Decisao;
    const restricaoCsv = (linha.restricao ?? '').trim();

    if (!ingredienteId) {
      plano.erros.push(`linha ${numero}: ingrediente_id vazio`);
      return;
    }
    if (!DECISOES.includes(decisao)) {
      plano.erros.push(
        `linha ${numero}: decisão "${linha.decisao}" inválida (use ${DECISOES.join(', ')})`,
      );
      return;
    }

    ingredientes.add(ingredienteId);
    if (decisao === 'pendente') {
      comPendencia.add(ingredienteId);
      return;
    }
    if (decisao !== 'vincular') {
      return;
    }

    const restricao = conhecidas.get(normalizar(restricaoCsv));
    if (!restricao) {
      plano.erros.push(
        restricaoCsv
          ? `linha ${numero}: restrição "${restricaoCsv}" desconhecida`
          : `linha ${numero}: "vincular" sem restrição`,
      );
      return;
    }

    const chave = `${ingredienteId}|${restricao}`;
    if (!vistos.has(chave)) {
      vistos.add(chave);
      plano.vinculos.push({ ingredienteId, restricao });
    }
  });

  for (const id of ingredientes) {
    (comPendencia.has(id) ? plano.pendentes : plano.revisados).push(id);
  }
  return plano;
}

export interface ResolucaoIngredientes {
  /** Mesmo tamanho e ordem do CSV; `null` nas linhas ignoradas. */
  linhas: (Record<string, string> | null)[];
  ignoradas: number;
  erros: string[];
}

/**
 * Troca o `ingrediente_id` de cada linha pelo id deste banco. O id é gerado
 * por cada banco; o `codigo_fonte_externo` (ex: TACO-4-123) é o mesmo em
 * todos, então tem prioridade. Assim um CSV revisado num banco aplica em
 * qualquer outro.
 *
 * - Código que não existe aqui é erro (ex: TACO não importada).
 * - Linha sem código (ingrediente criado por usuário) só vale no banco de
 *   origem: se o id não existe aqui, a linha é ignorada e o ingrediente
 *   continua não revisado.
 */
export function resolverIngredientes(
  linhasCsv: Record<string, string>[],
  idPorCodigo: Map<string, string>,
  idsExistentes: Set<string>,
): ResolucaoIngredientes {
  const resolucao: ResolucaoIngredientes = {
    linhas: [],
    ignoradas: 0,
    erros: [],
  };

  linhasCsv.forEach((linha, indice) => {
    const codigo = (linha.codigo_fonte_externo ?? '').trim();
    if (codigo) {
      const id = idPorCodigo.get(codigo);
      if (!id) {
        resolucao.erros.push(
          `linha ${indice + 2}: código ${codigo} não existe neste banco`,
        );
        resolucao.linhas.push(null);
        return;
      }
      resolucao.linhas.push({ ...linha, ingrediente_id: id });
      return;
    }

    const id = (linha.ingrediente_id ?? '').trim();
    if (id && !idsExistentes.has(id)) {
      resolucao.ignoradas += 1;
      resolucao.linhas.push(null);
      return;
    }
    resolucao.linhas.push(linha);
  });

  return resolucao;
}
