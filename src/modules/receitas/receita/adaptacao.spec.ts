/// <reference types="jest" />

import { ItemReceita, interpretarAdaptacao } from './adaptacao';

describe('interpretarAdaptacao', () => {
  const itens: ItemReceita[] = [
    {
      ingredienteId: 'arroz',
      nome: 'Arroz',
      quantidade: 200,
      unidadeMedidaId: 'g',
      unidade: 'g',
    },
    {
      ingredienteId: 'leite',
      nome: 'Leite',
      quantidade: 250,
      unidadeMedidaId: 'g',
      unidade: 'g',
    },
    {
      ingredienteId: 'sal',
      nome: 'Sal',
      quantidade: 3,
      unidadeMedidaId: 'g',
      unidade: 'g',
    },
  ];
  const candidatos = [
    { id: 'bebida-aveia', nome: 'Bebida de aveia' },
    { id: 'arroz', nome: 'Arroz' },
  ];
  const problematicos = new Set([1, 2]);

  it('substitui e remove, mantendo os ingredientes que não eram problema', () => {
    const proposta = interpretarAdaptacao(
      {
        trocas: [
          { i: 1, acao: 'substituir', c: 0, quantidade: 240 },
          { i: 2, acao: 'remover' },
        ],
        modoPreparo: '  Cozinhe o arroz com a bebida de aveia.  ',
        resumo: 'Leite trocado por bebida de aveia; sal removido.',
      },
      itens,
      problematicos,
      candidatos,
    );

    expect(proposta).toEqual({
      ingredientes: [
        { ingredienteId: 'arroz', quantidade: 200, unidadeMedidaId: 'g' },
        {
          ingredienteId: 'bebida-aveia',
          quantidade: 240,
          unidadeMedidaId: 'g',
        },
      ],
      trocas: [
        {
          ingredienteOrigemId: 'leite',
          acao: 'substituir',
          ingredienteDestinoId: 'bebida-aveia',
        },
        { ingredienteOrigemId: 'sal', acao: 'remover' },
      ],
      modoPreparo: 'Cozinhe o arroz com a bebida de aveia.',
      resumo: 'Leite trocado por bebida de aveia; sal removido.',
    });
  });

  it('sem quantidade (ou inválida), mantém a do original', () => {
    const proposta = interpretarAdaptacao(
      {
        trocas: [
          { i: 1, acao: 'substituir', c: 0, quantidade: -5 },
          { i: 2, acao: 'remover' },
        ],
      },
      itens,
      problematicos,
      candidatos,
    );

    expect(proposta).toMatchObject({
      ingredientes: [
        { ingredienteId: 'arroz' },
        { ingredienteId: 'bebida-aveia', quantidade: 250 },
      ],
    });
  });

  it('substituto que já estava na receita soma as quantidades', () => {
    const proposta = interpretarAdaptacao(
      {
        trocas: [
          { i: 1, acao: 'substituir', c: 1, quantidade: 50 },
          { i: 2, acao: 'remover' },
        ],
      },
      itens,
      problematicos,
      candidatos,
    );

    expect(proposta).toMatchObject({
      ingredientes: [{ ingredienteId: 'arroz', quantidade: 250 }],
    });
  });

  it('ignora troca de ingrediente que não era problema', () => {
    const proposta = interpretarAdaptacao(
      {
        trocas: [
          { i: 0, acao: 'remover' },
          { i: 1, acao: 'remover' },
          { i: 2, acao: 'remover' },
        ],
      },
      itens,
      problematicos,
      candidatos,
    );

    expect(proposta).toMatchObject({
      ingredientes: [{ ingredienteId: 'arroz', quantidade: 200 }],
    });
  });

  it.each([
    ['sem lista de trocas', { modoPreparo: 'x' }, 'sem a lista de trocas'],
    [
      'ingrediente problemático sem troca',
      { trocas: [{ i: 1, acao: 'remover' }] },
      'não tratou: Sal',
    ],
    [
      'candidato fora da lista',
      {
        trocas: [
          { i: 1, acao: 'substituir', c: 9 },
          { i: 2, acao: 'remover' },
        ],
      },
      'troca inválida para "Leite"',
    ],
    [
      'ação desconhecida',
      {
        trocas: [
          { i: 1, acao: 'reduzir' },
          { i: 2, acao: 'remover' },
        ],
      },
      'troca inválida',
    ],
  ])('erro: %s', (_caso, resposta, mensagem) => {
    const proposta = interpretarAdaptacao(
      resposta,
      itens,
      problematicos,
      candidatos,
    );
    expect(proposta).toEqual({ erro: expect.stringContaining(mensagem) });
  });

  it('erro quando a adaptação removeria todos os ingredientes', () => {
    const proposta = interpretarAdaptacao(
      { trocas: [{ i: 0, acao: 'remover' }] },
      [itens[0]],
      new Set([0]),
      candidatos,
    );
    expect(proposta).toEqual({
      erro: 'a adaptação removeria todos os ingredientes',
    });
  });
});
