import { normalizar } from './curadoria-alergenos';

/** Valores por 100g, como gravados em Ingrediente. */
export interface NutrientesSugeridos {
  caloriasKcal: number;
  proteinasG: number;
  carboidratosG: number;
  gordurasG: number;
  fibrasG: number;
  sodioMg: number;
}

/** Ingrediente novo, com a estimativa nutricional da IA. */
export interface SugestaoNova extends NutrientesSugeridos {
  tipo: 'nova';
  nome: string;
  justificativa: string | null;
}

/** Candidato do catálogo, pelo índice na lista enviada à IA. */
export interface SugestaoCatalogo {
  tipo: 'catalogo';
  c: number;
  justificativa: string | null;
}

export type SugestaoValida = SugestaoNova | SugestaoCatalogo;

export interface Descarte {
  indice: number;
  motivo: string;
}

export const MAX_OPCOES_SUBSTITUTO = 3;
const MAX_NOME = 255;
const MAX_JUSTIFICATIVA = 300;

/**
 * Faixas plausíveis por 100g. Gordura pura dá ~900 kcal; sal de cozinha,
 * ~39.000 mg de sódio. Fora disso a estimativa da IA está errada.
 */
export const FAIXAS_NUTRIENTES: Record<
  keyof NutrientesSugeridos,
  [number, number]
> = {
  caloriasKcal: [0, 900],
  proteinasG: [0, 100],
  carboidratosG: [0, 100],
  gordurasG: [0, 100],
  fibrasG: [0, 100],
  sodioMg: [0, 40_000],
};

/** Proteína, carboidrato e gordura não passam de 100g em 100g (com folga de arredondamento). */
const MAX_SOMA_MACROS = 102;

const CAMPOS = Object.keys(FAIXAS_NUTRIENTES) as (keyof NutrientesSugeridos)[];

/**
 * Aceita número ou texto só com o número ("12", "12.5", "12,5"). Texto com
 * unidade, faixa ou "aprox." é recusado: não dá para saber o que a IA quis.
 * Arredonda para 2 casas, como o banco grava.
 */
export function lerNumero(valor: unknown): number | null {
  let numero: number;
  if (typeof valor === 'number') {
    numero = valor;
  } else if (
    typeof valor === 'string' &&
    /^\s*\d+(?:[.,]\d+)?\s*$/.test(valor)
  ) {
    numero = Number(valor.trim().replace(',', '.'));
  } else {
    return null;
  }
  if (!Number.isFinite(numero)) {
    return null;
  }
  return Math.round(numero * 100) / 100;
}

function lerJustificativa(valor: unknown) {
  return typeof valor === 'string' && valor.trim()
    ? valor.trim().slice(0, MAX_JUSTIFICATIVA)
    : null;
}

function interpretarCatalogo(
  bruto: Record<string, unknown>,
  quantidadeCandidatos: number,
  vistos: Set<string>,
): SugestaoCatalogo | string {
  const c = bruto.c;
  if (
    typeof c !== 'number' ||
    !Number.isInteger(c) ||
    c < 0 ||
    c >= quantidadeCandidatos
  ) {
    return `índice de candidato inválido (${String(c)})`;
  }
  const chave = `c:${c}`;
  if (vistos.has(chave)) {
    return 'repetida na resposta';
  }
  vistos.add(chave);
  return {
    tipo: 'catalogo',
    c,
    justificativa: lerJustificativa(bruto.justificativa),
  };
}

function interpretarNova(
  bruto: Record<string, unknown>,
  nomeOriginal: string,
  vistos: Set<string>,
): SugestaoNova | string {
  if (typeof bruto.nome !== 'string') {
    return 'sem nome';
  }
  const nome = bruto.nome.replace(/\s+/g, ' ').trim();
  if (nome.length < 2 || nome.length > MAX_NOME) {
    return 'nome vazio ou longo demais';
  }
  const chave = normalizar(nome);
  if (chave === normalizar(nomeOriginal)) {
    return 'igual ao ingrediente original';
  }
  if (vistos.has(chave)) {
    return 'repetida na resposta';
  }

  const nutrientes = {} as NutrientesSugeridos;
  for (const campo of CAMPOS) {
    const valor = lerNumero(bruto[campo]);
    if (valor === null) {
      return `${campo} não é um número`;
    }
    const [minimo, maximo] = FAIXAS_NUTRIENTES[campo];
    if (valor < minimo || valor > maximo) {
      return `${campo} fora da faixa (${valor})`;
    }
    nutrientes[campo] = valor;
  }
  const somaMacros =
    nutrientes.proteinasG + nutrientes.carboidratosG + nutrientes.gordurasG;
  if (somaMacros > MAX_SOMA_MACROS) {
    return `proteína + carboidrato + gordura passam de 100g (${somaMacros})`;
  }

  vistos.add(chave);
  return {
    tipo: 'nova',
    nome,
    justificativa: lerJustificativa(bruto.justificativa),
    ...nutrientes,
  };
}

function interpretarOpcao(
  opcao: unknown,
  nomeOriginal: string,
  quantidadeCandidatos: number,
  vistos: Set<string>,
): SugestaoValida | string {
  if (typeof opcao !== 'object' || opcao === null || Array.isArray(opcao)) {
    return 'opção não é um objeto';
  }
  const bruto = opcao as Record<string, unknown>;
  // Com "c", é escolha do catálogo (mesmo que venha um "nome" junto).
  return bruto.c !== undefined && bruto.c !== null
    ? interpretarCatalogo(bruto, quantidadeCandidatos, vistos)
    : interpretarNova(bruto, nomeOriginal, vistos);
}

/**
 * Confere a resposta crua de `IaService.encontrarSubstituto`. Devolve
 * `null` quando a resposta não tem o formato `{"opcoes": [...]}` com ao
 * menos uma opção; senão, as opções válidas (no máximo 3, na ordem da IA) e
 * as descartadas com o motivo. Opção inválida é descartada sozinha: as
 * outras continuam valendo. Cada opção é um candidato do catálogo (`c`,
 * índice entre os `quantidadeCandidatos` enviados) ou um ingrediente novo.
 */
export function interpretarSubstitutos(
  resposta: unknown,
  nomeOriginal: string,
  quantidadeCandidatos: number,
): { opcoes: SugestaoValida[]; descartes: Descarte[] } | null {
  if (typeof resposta !== 'object' || resposta === null) {
    return null;
  }
  const opcoesBrutas = (resposta as Record<string, unknown>).opcoes;
  if (!Array.isArray(opcoesBrutas) || opcoesBrutas.length === 0) {
    return null;
  }

  const opcoes: SugestaoValida[] = [];
  const descartes: Descarte[] = [];
  const vistos = new Set<string>();

  opcoesBrutas.forEach((opcao, indice) => {
    if (opcoes.length >= MAX_OPCOES_SUBSTITUTO) {
      descartes.push({ indice, motivo: 'além das 3 opções pedidas' });
      return;
    }
    const resultado = interpretarOpcao(
      opcao,
      nomeOriginal,
      quantidadeCandidatos,
      vistos,
    );
    if (typeof resultado === 'string') {
      descartes.push({ indice, motivo: resultado });
    } else {
      opcoes.push(resultado);
    }
  });

  return { opcoes, descartes };
}
