/// <reference types="jest" />

import { parse } from 'csv-parse/sync';
import {
  encontrarPorPalavraChave,
  gerarCsv,
  interpretarClassificacaoIa,
  montarLinhas,
  planejarAplicacao,
  resolverIngredientes,
} from './curadoria-alergenos';

describe('curadoria de alérgenos', () => {
  describe('encontrarPorPalavraChave', () => {
    it('ignora acento e maiúscula e aceita plural', () => {
      expect(encontrarPorPalavraChave('Pão, trigo, francês')).toEqual([
        'Alergia a trigo',
        'Doença celíaca',
      ]);
      expect(encontrarPorPalavraChave('Ovos, de galinha, inteiro')).toEqual([
        'Alergia a ovo',
      ]);
      expect(encontrarPorPalavraChave('Camarão, Rio Grande, cozido')).toEqual([
        'Alergia a crustáceos',
      ]);
    });

    it('casa só palavra inteira', () => {
      // "pao" dentro de "sapão" ou "ovo" dentro de "novo" não contam.
      expect(encontrarPorPalavraChave('Sapão, novo')).toEqual([]);
    });

    it('não entende negação: "sem leite" vira candidato (a IA e o curador resolvem)', () => {
      expect(encontrarPorPalavraChave('Chocolate amargo, sem leite')).toEqual([
        'Alergia a leite',
        'Intolerância à lactose',
      ]);
    });
  });

  describe('interpretarClassificacaoIa', () => {
    it('aceita nomes com acento ou caixa diferentes e descarta os desconhecidos', () => {
      const resultado = interpretarClassificacaoIa(
        {
          itens: [
            {
              i: 0,
              contem: ['alergia a OVO', 'Alergia a gato'],
              incertos: ['Intolerancia a lactose'],
            },
          ],
        },
        1,
      );

      expect(resultado.get(0)).toEqual({
        contem: ['Alergia a ovo'],
        incertos: ['Intolerância à lactose'],
      });
    });

    it('descarta índice fora do lote e item malformado', () => {
      const resultado = interpretarClassificacaoIa(
        { itens: [{ i: 5, contem: [] }, { i: '0' }, null, { i: 1.5 }] },
        2,
      );
      expect(resultado.size).toBe(0);
    });

    it('resposta sem "itens" vira Map vazio', () => {
      expect(interpretarClassificacaoIa('texto', 3).size).toBe(0);
      expect(interpretarClassificacaoIa(null, 3).size).toBe(0);
    });

    it('restrição em "contem" e "incertos" fica só em "contem"', () => {
      const resultado = interpretarClassificacaoIa(
        {
          itens: [
            { i: 0, contem: ['Alergia a ovo'], incertos: ['Alergia a ovo'] },
          ],
        },
        1,
      );
      expect(resultado.get(0)?.incertos).toEqual([]);
    });
  });

  describe('montarLinhas', () => {
    const ingrediente = { id: 'i1', nome: 'Bolo, mistura para' };

    it('fontes concordando não pedem atenção; todas as candidatas saem como vincular', () => {
      const linhas = montarLinhas(ingrediente, ['Alergia a trigo'], {
        contem: ['Alergia a trigo'],
        incertos: ['Alergia a ovo'],
      });

      expect(linhas).toEqual([
        expect.objectContaining({
          restricao: 'Alergia a ovo',
          fonte: 'ia',
          atencao: 'sim',
          decisao: 'vincular',
          motivo: 'IA incerta',
        }),
        expect.objectContaining({
          restricao: 'Alergia a trigo',
          fonte: 'ambos',
          atencao: 'nao',
          decisao: 'vincular',
        }),
      ]);
    });

    it('só palavra-chave, com a IA discordando, pede atenção', () => {
      const [linha] = montarLinhas(ingrediente, ['Alergia a leite'], {
        contem: [],
        incertos: [],
      });
      expect(linha).toMatchObject({
        fonte: 'palavra_chave',
        atencao: 'sim',
        motivo: 'só palavra-chave',
      });
    });

    it('sem candidatas e com resposta da IA, sai uma linha "revisado"', () => {
      expect(
        montarLinhas(ingrediente, [], { contem: [], incertos: [] }),
      ).toEqual([
        expect.objectContaining({ restricao: '', decisao: 'revisado' }),
      ]);
    });

    it('sem resposta da IA, sai uma linha "pendente" além das candidatas', () => {
      const linhas = montarLinhas(ingrediente, ['Alergia a trigo'], undefined);
      expect(linhas.map((l) => l.decisao)).toEqual(['vincular', 'pendente']);
      expect(linhas[0].motivo).toBe('IA sem resposta');
    });
  });

  describe('gerarCsv + planejarAplicacao', () => {
    const conhecidas = ['Alergia a ovo', 'Intolerancia a Lactose'];
    const lerCsv = (csv: string): Record<string, string>[] =>
      parse(csv, { columns: true, bom: true, trim: true });

    it('o CSV gerado volta igual (vírgula e aspas no nome)', () => {
      const linhas = montarLinhas(
        { id: 'i1', nome: 'Ovo, "caipira", cozido' },
        ['Alergia a ovo'],
        { contem: ['Alergia a ovo'], incertos: [] },
      );

      const [lida] = lerCsv(gerarCsv(linhas));
      expect(lida).toMatchObject({
        ingrediente_id: 'i1',
        ingrediente: 'Ovo, "caipira", cozido',
        restricao: 'Alergia a ovo',
        decisao: 'vincular',
      });
    });

    it('vincular cria vínculo, usando o nome da restrição que já existe', () => {
      const plano = planejarAplicacao(
        [
          {
            ingrediente_id: 'i1',
            restricao: 'Alergia a ovo',
            decisao: 'vincular',
          },
          {
            ingrediente_id: 'i1',
            restricao: 'Intolerância à lactose',
            decisao: 'Vincular',
          },
          {
            ingrediente_id: 'i1',
            restricao: 'Alergia a ovo',
            decisao: 'vincular',
          },
        ],
        conhecidas,
      );

      expect(plano.erros).toEqual([]);
      expect(plano.vinculos).toEqual([
        { ingredienteId: 'i1', restricao: 'Alergia a ovo' },
        { ingredienteId: 'i1', restricao: 'Intolerancia a Lactose' },
      ]);
      expect(plano.revisados).toEqual(['i1']);
    });

    it('qualquer linha pendente impede o ingrediente de ser marcado como revisado', () => {
      const plano = planejarAplicacao(
        [
          {
            ingrediente_id: 'i1',
            restricao: 'Alergia a ovo',
            decisao: 'descartar',
          },
          { ingrediente_id: 'i1', restricao: '', decisao: 'pendente' },
          { ingrediente_id: 'i2', restricao: '', decisao: 'revisado' },
        ],
        conhecidas,
      );

      expect(plano.vinculos).toEqual([]);
      expect(plano.pendentes).toEqual(['i1']);
      expect(plano.revisados).toEqual(['i2']);
    });

    it('acumula os erros em vez de parar no primeiro', () => {
      const plano = planejarAplicacao(
        [
          {
            ingrediente_id: '',
            restricao: 'Alergia a ovo',
            decisao: 'vincular',
          },
          {
            ingrediente_id: 'i1',
            restricao: 'Alergia a gato',
            decisao: 'vincular',
          },
          { ingrediente_id: 'i1', restricao: '', decisao: 'vincular' },
          { ingrediente_id: 'i1', restricao: '', decisao: 'talvez' },
        ],
        conhecidas,
      );

      expect(plano.erros).toEqual([
        'linha 2: ingrediente_id vazio',
        'linha 3: restrição "Alergia a gato" desconhecida',
        'linha 4: "vincular" sem restrição',
        'linha 5: decisão "talvez" inválida (use vincular, descartar, pendente, revisado)',
      ]);
    });
  });

  describe('resolverIngredientes', () => {
    const idPorCodigo = new Map([['TACO-4-1', 'id-local-1']]);
    const idsExistentes = new Set(['id-local-1', 'id-usuario']);

    it('usa o código da fonte no lugar do id do banco de origem', () => {
      const { linhas, erros } = resolverIngredientes(
        [
          {
            ingrediente_id: 'id-de-outro-banco',
            codigo_fonte_externo: 'TACO-4-1',
            decisao: 'revisado',
          },
        ],
        idPorCodigo,
        idsExistentes,
      );

      expect(erros).toEqual([]);
      expect(linhas[0]?.ingrediente_id).toBe('id-local-1');
    });

    it('código que não existe neste banco é erro', () => {
      const { erros } = resolverIngredientes(
        [{ ingrediente_id: 'x', codigo_fonte_externo: 'TACO-4-999' }],
        idPorCodigo,
        idsExistentes,
      );

      expect(erros).toEqual([
        'linha 2: código TACO-4-999 não existe neste banco',
      ]);
    });

    it('sem código: vale o id no banco de origem e é ignorado nos outros', () => {
      const resolucao = resolverIngredientes(
        [
          { ingrediente_id: 'id-usuario', codigo_fonte_externo: '' },
          { ingrediente_id: 'id-de-outro-banco', codigo_fonte_externo: '' },
        ],
        idPorCodigo,
        idsExistentes,
      );

      expect(resolucao.erros).toEqual([]);
      expect(resolucao.ignoradas).toBe(1);
      expect(resolucao.linhas.map((l) => l?.ingrediente_id ?? null)).toEqual([
        'id-usuario',
        null,
      ]);
    });

    it('CSV antigo, sem a coluna do código, continua funcionando', () => {
      const { linhas, ignoradas } = resolverIngredientes(
        [{ ingrediente_id: 'id-usuario', decisao: 'revisado' }],
        idPorCodigo,
        idsExistentes,
      );

      expect(ignoradas).toBe(0);
      expect(linhas[0]?.ingrediente_id).toBe('id-usuario');
    });

    it('linha ignorada não muda a numeração dos erros do plano', () => {
      const { linhas } = resolverIngredientes(
        [
          { ingrediente_id: 'id-de-outro-banco', decisao: 'revisado' },
          { ingrediente_id: 'id-usuario', decisao: 'talvez' },
        ],
        idPorCodigo,
        idsExistentes,
      );

      expect(planejarAplicacao(linhas, []).erros).toEqual([
        'linha 3: decisão "talvez" inválida (use vincular, descartar, pendente, revisado)',
      ]);
    });
  });

  it('o CSV gerado leva o código da fonte', () => {
    const linhas = montarLinhas(
      { id: 'i1', nome: 'Ovo, de galinha', codigoFonteExterno: 'TACO-4-488' },
      ['Alergia a ovo'],
      { contem: ['Alergia a ovo'], incertos: [] },
    );

    const lidas: Record<string, string>[] = parse(gerarCsv(linhas), {
      columns: true,
      bom: true,
    });
    const [lida] = lidas;
    expect(lida.codigo_fonte_externo).toBe('TACO-4-488');
  });
});
