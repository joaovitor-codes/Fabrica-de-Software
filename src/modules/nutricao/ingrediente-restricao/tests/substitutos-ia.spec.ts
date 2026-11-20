/// <reference types="jest" />

import {
  interpretarSubstitutos,
  lerNumero,
  SugestaoValida,
} from '../substitutos-ia';
import { padraoNomeNormalizado } from '../ingrediente-substituto.service';

const opcao = (extra: Record<string, unknown> = {}) => ({
  nome: 'Bebida de aveia',
  justificativa: 'Sem lactose',
  caloriasKcal: '45',
  proteinasG: '1,0',
  carboidratosG: 7.5,
  gordurasG: '1.5',
  fibrasG: '0.8',
  sodioMg: '40',
  ...extra,
});

/** 5 candidatos do catálogo foram enviados à IA. */
const interpretar = (resposta: unknown, nomeOriginal: string) =>
  interpretarSubstitutos(resposta, nomeOriginal, 5);

const rotulos = (opcoes: SugestaoValida[] = []) =>
  opcoes.map((o) => (o.tipo === 'nova' ? o.nome : `c${o.c}`));

describe('interpretarSubstitutos', () => {
  it('aceita opções válidas e converte os números', () => {
    const r = interpretar({ opcoes: [opcao()] }, 'Leite, de vaca');
    expect(r?.descartes).toEqual([]);
    expect(r?.opcoes).toEqual([
      {
        tipo: 'nova',
        nome: 'Bebida de aveia',
        justificativa: 'Sem lactose',
        caloriasKcal: 45,
        proteinasG: 1,
        carboidratosG: 7.5,
        gordurasG: 1.5,
        fibrasG: 0.8,
        sodioMg: 40,
      },
    ]);
  });

  it.each([
    ['null', null],
    ['texto', 'opcoes'],
    ['sem opcoes', {}],
    ['opcoes não é lista', { opcoes: { nome: 'x' } }],
    ['lista vazia', { opcoes: [] }],
  ])('fora do formato (%s) devolve null', (_, resposta) => {
    expect(interpretar(resposta, 'Leite')).toBeNull();
  });

  it('descarta a sugestão igual ao original, sem olhar acento e caixa', () => {
    const r = interpretar(
      { opcoes: [opcao({ nome: '  MAÇÃ  verde ' }), opcao()] },
      'Maca verde',
    );
    expect(rotulos(r?.opcoes)).toEqual(['Bebida de aveia']);
    expect(r?.descartes[0]).toEqual({
      indice: 0,
      motivo: 'igual ao ingrediente original',
    });
  });

  it('descarta repetidas e o que passar de 3', () => {
    const r = interpretar(
      {
        opcoes: [
          opcao({ nome: 'A1' }),
          opcao({ nome: 'a1' }),
          opcao({ nome: 'B2' }),
          opcao({ nome: 'C3' }),
          opcao({ nome: 'D4' }),
        ],
      },
      'Leite',
    );
    expect(rotulos(r?.opcoes)).toEqual(['A1', 'B2', 'C3']);
    expect(r?.descartes.map((d) => d.indice)).toEqual([1, 4]);
  });

  it.each([
    ['sem nome', { nome: undefined }],
    ['nome vazio', { nome: '   ' }],
    ['nome que não é texto', { nome: 12 }],
    ['número com unidade', { caloriasKcal: '45 kcal' }],
    ['número aproximado', { sodioMg: '~40' }],
    ['número ausente', { fibrasG: undefined }],
    ['negativo', { gordurasG: -1 }],
    ['calorias acima de 900', { caloriasKcal: '950' }],
    ['sódio acima do sal puro', { sodioMg: 50_000 }],
    ['infinito', { proteinasG: Infinity }],
    [
      'macros somando mais de 100g',
      { proteinasG: 40, carboidratosG: 40, gordurasG: 40 },
    ],
  ])('descarta opção inválida: %s', (_, extra) => {
    const r = interpretar(
      { opcoes: [opcao(extra), opcao({ nome: 'Outra' })] },
      'Leite',
    );
    expect(rotulos(r?.opcoes)).toEqual(['Outra']);
    expect(r?.descartes).toHaveLength(1);
    expect(r?.descartes[0].indice).toBe(0);
  });

  it('opção que não é objeto é descartada, as outras ficam', () => {
    const r = interpretar(
      { opcoes: ['Bebida de soja', null, opcao()] },
      'Leite',
    );
    expect(r?.opcoes).toHaveLength(1);
    expect(r?.descartes).toHaveLength(2);
  });

  it('justificativa ausente vira null e longa é cortada', () => {
    const r = interpretar(
      {
        opcoes: [
          opcao({ nome: 'A1', justificativa: undefined }),
          opcao({ nome: 'B2', justificativa: 'x'.repeat(1000) }),
        ],
      },
      'Leite',
    );
    expect(r?.opcoes[0].justificativa).toBeNull();
    expect(r?.opcoes[1].justificativa).toHaveLength(300);
  });

  it('aceita escolha do catálogo pelo índice, junto com novas', () => {
    const r = interpretar(
      {
        opcoes: [
          { c: 3, justificativa: 'Mesma função' },
          opcao(),
          { c: 0, nome: 'ignorado: vale o índice' },
        ],
      },
      'Leite',
    );
    expect(rotulos(r?.opcoes)).toEqual(['c3', 'Bebida de aveia', 'c0']);
    expect(r?.opcoes[0]).toEqual({
      tipo: 'catalogo',
      c: 3,
      justificativa: 'Mesma função',
    });
    expect(r?.descartes).toEqual([]);
  });

  it.each([
    ['fora da lista', 5],
    ['negativo', -1],
    ['fracionário', 1.5],
    ['texto', '2'],
  ])('descarta índice de candidato inválido (%s)', (_, c) => {
    const r = interpretar({ opcoes: [{ c }, { c: 1 }] }, 'Leite');
    expect(rotulos(r?.opcoes)).toEqual(['c1']);
    expect(r?.descartes[0].motivo).toMatch(/índice de candidato inválido/);
  });

  it('descarta candidato repetido', () => {
    const r = interpretar({ opcoes: [{ c: 2 }, { c: 2 }] }, 'Leite');
    expect(rotulos(r?.opcoes)).toEqual(['c2']);
    expect(r?.descartes).toEqual([
      { indice: 1, motivo: 'repetida na resposta' },
    ]);
  });

  it('sem candidatos enviados, qualquer índice é inválido', () => {
    const r = interpretarSubstitutos({ opcoes: [{ c: 0 }] }, 'Leite', 0);
    expect(r?.opcoes).toEqual([]);
  });

  it('todas inválidas: devolve lista vazia, não null', () => {
    const r = interpretar({ opcoes: [opcao({ nome: 'Leite' })] }, 'Leite');
    expect(r).toEqual({
      opcoes: [],
      descartes: [{ indice: 0, motivo: 'igual ao ingrediente original' }],
    });
  });
});

describe('lerNumero', () => {
  it('arredonda para 2 casas, como o banco', () => {
    expect(lerNumero('1.239')).toBe(1.24);
    expect(lerNumero(' 3,5 ')).toBe(3.5);
    expect(lerNumero('1e3')).toBeNull();
    expect(lerNumero('')).toBeNull();
    expect(lerNumero(NaN)).toBeNull();
  });
});

describe('padraoNomeNormalizado', () => {
  it('troca letras que podem ter acento por _ e espaços por %', () => {
    expect(padraoNomeNormalizado('pao de lo')).toBe('p__%d_%l_');
    expect(padraoNomeNormalizado('acucar')).toBe('_____r');
  });

  it('escapa os curingas do LIKE', () => {
    expect(padraoNomeNormalizado('50%_x')).toBe('50\\%\\_x');
  });
});
