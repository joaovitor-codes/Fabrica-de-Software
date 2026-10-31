/// <reference types="jest" />

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ReceitaComOfertaDto } from '../dtos/receita';
import {
  ReceitaOfertaDto,
  UpdateReceitaOfertaDto,
} from '../dtos/receita-oferta';

const UUID = '3f1c2a7e-8b4d-4c6a-9e2f-1a2b3c4d5e6f';

const RECEITA = {
  nome: 'Bolo sem lactose',
  ingredientes: [
    {
      ingredienteId: UUID,
      quantidade: 200,
      unidadeMedidaId: UUID,
    },
  ],
};

/** Campos com erro de validação para o body informado. */
async function errosDe(
  body: Record<string, unknown>,
  dto: new () => object = ReceitaOfertaDto,
) {
  const erros = await validate(plainToInstance(dto, body));
  return erros.map((e) => e.property);
}

describe('ReceitaOfertaDto', () => {
  it('aceita só o preço', async () => {
    await expect(errosDe({ preco: 12.9 })).resolves.toEqual([]);
  });

  it('aceita preço com público-alvo', async () => {
    await expect(
      errosDe({ preco: 12.9, restricaoIds: [UUID] }),
    ).resolves.toEqual([]);
  });

  it.each([undefined, 0, -1, 10.999, '12.90', 100000000])(
    'rejeita preco inválido: %p',
    async (preco) => {
      await expect(errosDe({ preco })).resolves.toEqual(['preco']);
    },
  );

  it.each([
    ['não array', UUID],
    ['id não UUID', ['abc']],
    ['ids repetidos', [UUID, UUID]],
  ])('rejeita restricaoIds com %s', async (_, restricaoIds) => {
    await expect(errosDe({ preco: 12.9, restricaoIds })).resolves.toEqual([
      'restricaoIds',
    ]);
  });
});

describe('ReceitaComOfertaDto', () => {
  it('aceita a receita com a oferta', async () => {
    await expect(
      errosDe({ ...RECEITA, oferta: { preco: 12.9 } }, ReceitaComOfertaDto),
    ).resolves.toEqual([]);
  });

  it('exige a oferta', async () => {
    await expect(errosDe(RECEITA, ReceitaComOfertaDto)).resolves.toEqual([
      'oferta',
    ]);
  });

  it('valida os campos da oferta', async () => {
    const erros = await validate(
      plainToInstance(ReceitaComOfertaDto, {
        ...RECEITA,
        oferta: { preco: -1 },
      }),
    );

    expect(erros.map((e) => e.property)).toEqual(['oferta']);
    expect(erros[0].children?.map((e) => e.property)).toEqual(['preco']);
  });

  it('continua validando a receita', async () => {
    await expect(
      errosDe({ oferta: { preco: 12.9 } }, ReceitaComOfertaDto),
    ).resolves.toEqual(['nome', 'ingredientes']);
  });
});

describe('UpdateReceitaOfertaDto', () => {
  const errosDoUpdate = (body: Record<string, unknown>) =>
    errosDe(body, UpdateReceitaOfertaDto);

  it('aceita corpo vazio e cada campo sozinho', async () => {
    await expect(errosDoUpdate({})).resolves.toEqual([]);
    await expect(errosDoUpdate({ preco: 14.9 })).resolves.toEqual([]);
    await expect(errosDoUpdate({ ativa: false })).resolves.toEqual([]);
    await expect(errosDoUpdate({ restricaoIds: [] })).resolves.toEqual([]);
  });

  it('rejeita null e valores inválidos', async () => {
    await expect(
      errosDoUpdate({ preco: null, restricaoIds: null, ativa: null }),
    ).resolves.toEqual(['preco', 'restricaoIds', 'ativa']);
    await expect(
      errosDoUpdate({ preco: -1, restricaoIds: [UUID, UUID], ativa: 'sim' }),
    ).resolves.toEqual(['preco', 'restricaoIds', 'ativa']);
  });
});
