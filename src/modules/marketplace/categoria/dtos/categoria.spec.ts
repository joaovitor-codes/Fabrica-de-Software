/// <reference types="jest" />

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateCategoria, UpdateCategoria } from './categoria';

/** Campos com erro de validação para o body informado. */
async function errosDe<T extends object>(
  dto: new () => T,
  body: Record<string, unknown>,
) {
  const erros = await validate(plainToInstance(dto, body));
  return erros.map((e) => e.property);
}

describe('CreateCategoria', () => {
  it('aceita codigo snake_case e nome', async () => {
    await expect(
      errosDe(CreateCategoria, { codigo: 'utensilios_cozinha', nome: 'Utensílios de Cozinha' }),
    ).resolves.toEqual([]);
  });

  it.each(['CAT001', 'Alimentos', 'com espaco', 'com-hifen', '_alimentos', 'alimentos_'])(
    'rejeita codigo fora do padrão: %s',
    async (codigo) => {
      await expect(errosDe(CreateCategoria, { codigo, nome: 'X' })).resolves.toEqual(['codigo']);
    },
  );

  it('rejeita campos ausentes, vazios ou null', async () => {
    await expect(errosDe(CreateCategoria, {})).resolves.toEqual(['codigo', 'nome']);
    await expect(errosDe(CreateCategoria, { codigo: '', nome: '' })).resolves.toEqual([
      'codigo',
      'nome',
    ]);
    await expect(errosDe(CreateCategoria, { codigo: null, nome: null })).resolves.toEqual([
      'codigo',
      'nome',
    ]);
  });

  it('respeita os limites das colunas (codigo 50, nome 100)', async () => {
    await expect(
      errosDe(CreateCategoria, { codigo: 'a'.repeat(50), nome: 'a'.repeat(100) }),
    ).resolves.toEqual([]);
    await expect(
      errosDe(CreateCategoria, { codigo: 'a'.repeat(51), nome: 'a'.repeat(101) }),
    ).resolves.toEqual(['codigo', 'nome']);
  });
});

describe('UpdateCategoria', () => {
  it('aceita body vazio e campos omitidos', async () => {
    await expect(errosDe(UpdateCategoria, {})).resolves.toEqual([]);
    await expect(errosDe(UpdateCategoria, { nome: 'Alimentos' })).resolves.toEqual([]);
    await expect(errosDe(UpdateCategoria, { codigo: 'alimentos' })).resolves.toEqual([]);
  });

  it('rejeita null (a coluna é NOT NULL; senão vira 500 no Prisma)', async () => {
    await expect(errosDe(UpdateCategoria, { nome: null })).resolves.toEqual(['nome']);
    await expect(errosDe(UpdateCategoria, { codigo: null })).resolves.toEqual(['codigo']);
  });

  it('rejeita string vazia', async () => {
    await expect(errosDe(UpdateCategoria, { nome: '' })).resolves.toEqual(['nome']);
    await expect(errosDe(UpdateCategoria, { codigo: '' })).resolves.toEqual(['codigo']);
  });

  it('rejeita codigo fora do padrão e acima dos limites', async () => {
    await expect(errosDe(UpdateCategoria, { codigo: 'CAT001' })).resolves.toEqual(['codigo']);
    await expect(
      errosDe(UpdateCategoria, { codigo: 'a'.repeat(51), nome: 'a'.repeat(101) }),
    ).resolves.toEqual(['nome', 'codigo']);
  });
});
