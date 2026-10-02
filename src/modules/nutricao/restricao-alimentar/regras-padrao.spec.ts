/// <reference types="jest" />

import {
  CampoNutricionalRegra,
  OperadorRegraNutricional,
  TipoRestricao,
} from '@prisma/client';
import { RestricaoExistente, planejarRegras } from './regras-padrao';

describe('planejarRegras', () => {
  const sodio = {
    campoNutricional: CampoNutricionalRegra.sodio_mg,
    operador: OperadorRegraNutricional.maior_que,
  };

  it('banco vazio: cria a hipertensão com a regra de sódio', () => {
    const plano = planejarRegras([]);

    expect(plano.restricoesACriar).toEqual([
      expect.objectContaining({
        nome: 'Hipertensão',
        tipo: TipoRestricao.doenca_cronica,
        regras: [
          {
            campo: CampoNutricionalRegra.sodio_mg,
            operador: OperadorRegraNutricional.maior_que,
            limite: 600,
          },
        ],
      }),
    ]);
    expect(plano.regrasACriar).toEqual([]);
    expect(plano.avisos).toEqual([]);
  });

  it('restrição já existe (nome sem acento): cria só a regra que falta', () => {
    const existentes: RestricaoExistente[] = [
      { nome: 'hipertensao', tipo: TipoRestricao.doenca_cronica, regras: [] },
    ];

    const plano = planejarRegras(existentes);

    expect(plano.restricoesACriar).toEqual([]);
    expect(plano.regrasACriar).toEqual([
      expect.objectContaining({ restricao: 'hipertensao' }),
    ]);
  });

  it('tudo igual ao padrão: não cria nada (pode rodar de novo)', () => {
    const plano = planejarRegras([
      {
        nome: 'Hipertensão',
        tipo: TipoRestricao.doenca_cronica,
        regras: [{ ...sodio, valorLimite: 600 }],
      },
    ]);

    expect(plano).toEqual({
      restricoesACriar: [],
      regrasACriar: [],
      avisos: [],
    });
  });

  it('limite ou tipo diferentes no banco viram aviso, sem alterar', () => {
    const plano = planejarRegras([
      {
        nome: 'Hipertensão',
        tipo: TipoRestricao.preferencia,
        regras: [{ ...sodio, valorLimite: 400 }],
      },
    ]);

    expect(plano.restricoesACriar).toEqual([]);
    expect(plano.regrasACriar).toEqual([]);
    expect(plano.avisos).toHaveLength(2);
    expect(plano.avisos[0]).toContain('preferencia');
    expect(plano.avisos[1]).toContain('limite 400');
  });
});
