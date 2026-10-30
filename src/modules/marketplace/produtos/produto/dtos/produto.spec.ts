/// <reference types="jest" />

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateProduto, UpdateProduto } from './produto';

const UUID = '3f1c2a7e-8b4d-4c6a-9e2f-1a2b3c4d5e6f';
const UUID2 = '7a9b8c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

/** Campos com erro de validação para o body informado. */
async function errosDe(
  body: Record<string, unknown>,
  dto: new () => object = CreateProduto,
) {
  const erros = await validate(plainToInstance(dto, body));
  return erros.map((e) => e.property);
}

describe('CreateProduto', () => {
  it('aceita só os campos obrigatórios', async () => {
    await expect(
      errosDe({ categoriaId: UUID, titulo: 'Pão sem glúten' }),
    ).resolves.toEqual([]);
  });

  it('aceita todos os campos preenchidos', async () => {
    await expect(
      errosDe({
        categoriaId: UUID,
        titulo: 'Pão sem glúten',
        descricao: 'Feito em casa',
        preco: 15.9,
        cidade: 'Goiânia',
        estado: 'GO',
        restricaoIds: [UUID, UUID2],
      }),
    ).resolves.toEqual([]);
  });

  it('rejeita obrigatórios ausentes ou inválidos', async () => {
    await expect(errosDe({})).resolves.toEqual(['categoriaId', 'titulo']);
    await expect(
      errosDe({ categoriaId: 'nao-uuid', titulo: '' }),
    ).resolves.toEqual(['categoriaId', 'titulo']);
  });

  it('respeita os limites de tamanho (titulo 255, cidade 100, estado 2)', async () => {
    const base = { categoriaId: UUID };
    await expect(
      errosDe({ ...base, titulo: 'a'.repeat(255), cidade: 'a'.repeat(100) }),
    ).resolves.toEqual([]);
    await expect(
      errosDe({
        ...base,
        titulo: 'a'.repeat(256),
        cidade: 'a'.repeat(101),
        estado: 'GOI',
      }),
    ).resolves.toEqual(['titulo', 'cidade', 'estado']);
    await expect(
      errosDe({ ...base, titulo: 'X', estado: 'G' }),
    ).resolves.toEqual(['estado']);
  });

  it.each([-1, 10.999, '15.90'])(
    'rejeita preco inválido: %p',
    async (preco) => {
      await expect(
        errosDe({ categoriaId: UUID, titulo: 'X', preco }),
      ).resolves.toEqual(['preco']);
    },
  );

  it('aceita preco zero', async () => {
    await expect(
      errosDe({ categoriaId: UUID, titulo: 'X', preco: 0 }),
    ).resolves.toEqual([]);
  });

  it.each([
    ['não array', UUID],
    ['id não UUID', ['abc']],
    ['ids repetidos', [UUID, UUID]],
  ])('rejeita restricaoIds com %s', async (_, restricaoIds) => {
    await expect(
      errosDe({ categoriaId: UUID, titulo: 'X', restricaoIds }),
    ).resolves.toEqual(['restricaoIds']);
  });
});

describe('UpdateProduto', () => {
  const errosDoUpdate = (body: Record<string, unknown>) =>
    errosDe(body, UpdateProduto);

  it('aceita corpo vazio', async () => {
    await expect(errosDoUpdate({})).resolves.toEqual([]);
  });

  it('aceita null nos campos opcionais do produto', async () => {
    await expect(
      errosDoUpdate({
        descricao: null,
        preco: null,
        cidade: null,
        estado: null,
      }),
    ).resolves.toEqual([]);
  });

  it('rejeita null nos campos obrigatórios no banco', async () => {
    await expect(
      errosDoUpdate({
        categoriaId: null,
        titulo: null,
        telefoneContatoId: null,
        restricaoIds: null,
        status: null,
      }),
    ).resolves.toEqual([
      'categoriaId',
      'titulo',
      'telefoneContatoId',
      'restricaoIds',
      'status',
    ]);
  });

  it.each(['ativo', 'pausado', 'vendido'])(
    'aceita status %s',
    async (status) => {
      await expect(errosDoUpdate({ status })).resolves.toEqual([]);
    },
  );

  it.each(['removido', 'outro'])('rejeita status %s', async (status) => {
    await expect(errosDoUpdate({ status })).resolves.toEqual(['status']);
  });

  it('aplica as mesmas validações do cadastro', async () => {
    await expect(
      errosDoUpdate({
        titulo: '',
        preco: -1,
        estado: 'GOI',
        telefoneContatoId: 'nao-uuid',
        restricaoIds: [UUID, UUID],
      }),
    ).resolves.toEqual([
      'titulo',
      'preco',
      'estado',
      'telefoneContatoId',
      'restricaoIds',
    ]);
  });
});
