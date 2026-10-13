/// <reference types="jest" />

import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { CategoriaService } from './categoria.service';
import { PrismaService } from '../../../common/prisma/prisma.service';

type Categoria = { id: string; codigo: string; nome: string; ativo: boolean };

/** Erro que o Prisma lança ao violar o @unique de codigo. */
const codigoDuplicado = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });

/** Fake em memória da tabela categorias_produto. */
class FakePrismaService {
  categorias: Categoria[] = [];

  private codigoEmUso(codigo: string | undefined, exceto?: string) {
    return this.categorias.some((c) => c.codigo === codigo && c.id !== exceto);
  }

  categoriaProduto = {
    findUnique: async ({ where }: any) =>
      this.categorias.find((c) => c.id === where.id) ?? null,
    findMany: async ({ where }: any) =>
      this.categorias.filter((c) => c.ativo === where.ativo),
    create: async ({ data }: any) => {
      if (this.codigoEmUso(data.codigo)) throw codigoDuplicado();
      const registro = { id: `cat${this.categorias.length + 1}`, ...data };
      this.categorias.push(registro);
      return registro;
    },
    update: async ({ where, data }: any) => {
      if (this.codigoEmUso(data.codigo, where.id)) throw codigoDuplicado();
      const registro = this.categorias.find((c) => c.id === where.id)!;
      // Igual ao Prisma: campo undefined não é alterado.
      for (const [campo, valor] of Object.entries(data)) {
        if (valor !== undefined) (registro as any)[campo] = valor;
      }
      return registro;
    },
  };
}

describe('CategoriaService', () => {
  let prisma: FakePrismaService;
  let service: CategoriaService;

  beforeEach(async () => {
    prisma = new FakePrismaService();
    const module: TestingModule = await Test.createTestingModule({
      providers: [CategoriaService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<CategoriaService>(CategoriaService);
  });

  async function criar(codigo = 'alimentos', nome = 'Alimentos') {
    const { data } = await service.create({ codigo, nome });
    return data;
  }

  it('cria a categoria ativa', async () => {
    const resposta = await service.create({ codigo: 'alimentos', nome: 'Alimentos' });

    expect(resposta.success).toBe('Categoria criada com sucesso.');
    expect(prisma.categorias).toEqual([
      { id: 'cat1', codigo: 'alimentos', nome: 'Alimentos', ativo: true },
    ]);
  });

  it('recusa codigo duplicado com Conflict', async () => {
    await criar('alimentos');
    await expect(criar('alimentos', 'Outro')).rejects.toThrow(ConflictException);
    expect(prisma.categorias).toHaveLength(1);
  });

  describe('listagens', () => {
    it('separa ativas e desativadas', async () => {
      await criar('alimentos');
      const livros = await criar('livros', 'Livros');
      await service.remove(livros.id);

      await expect(service.findAllAtivos()).resolves.toMatchObject([{ codigo: 'alimentos' }]);
      await expect(service.findAllDesativados()).resolves.toMatchObject([{ codigo: 'livros' }]);
    });

    it('retorna lista vazia quando não há categorias', async () => {
      await expect(service.findAllAtivos()).resolves.toEqual([]);
      await expect(service.findAllDesativados()).resolves.toEqual([]);
    });
  });

  describe('findOne', () => {
    it('retorna a categoria ativa', async () => {
      const categoria = await criar();
      await expect(service.findOne(categoria.id)).resolves.toEqual(categoria);
    });

    it('lança NotFound para id inexistente', async () => {
      await expect(service.findOne('nao-existe')).rejects.toThrow(NotFoundException);
    });

    it('trata categoria inativa como não encontrada', async () => {
      const categoria = await criar();
      await service.remove(categoria.id);
      await expect(service.findOne(categoria.id)).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove / restaurar', () => {
    it('desativa e reativa a categoria', async () => {
      const categoria = await criar();

      await service.remove(categoria.id);
      expect(prisma.categorias[0].ativo).toBe(false);

      await expect(service.restaurar(categoria.id)).resolves.toMatchObject({ ativo: true });
    });

    it('recusa remover categoria já inativa ou inexistente', async () => {
      const categoria = await criar();
      await service.remove(categoria.id);

      await expect(service.remove(categoria.id)).rejects.toThrow(ConflictException);
      await expect(service.remove('nao-existe')).rejects.toThrow(NotFoundException);
    });

    it('recusa restaurar categoria já ativa ou inexistente', async () => {
      const categoria = await criar();

      await expect(service.restaurar(categoria.id)).rejects.toThrow(ConflictException);
      await expect(service.restaurar('nao-existe')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('altera só os campos enviados', async () => {
      const categoria = await criar();

      await expect(service.update(categoria.id, { nome: 'Comidas' } as any)).resolves.toEqual({
        ...categoria,
        nome: 'Comidas',
      });
      await expect(service.update(categoria.id, { codigo: 'comidas' } as any)).resolves.toEqual({
        ...categoria,
        nome: 'Comidas',
        codigo: 'comidas',
      });
    });

    it('recusa trocar para um codigo já usado por outra categoria', async () => {
      const categoria = await criar('alimentos');
      await criar('livros', 'Livros');

      await expect(service.update(categoria.id, { codigo: 'livros' } as any)).rejects.toThrow(
        ConflictException,
      );
      await expect(service.update(categoria.id, { codigo: 'alimentos' } as any)).resolves.toEqual(
        categoria,
      );
    });

    it('body vazio não altera nada', async () => {
      const categoria = await criar();
      await expect(service.update(categoria.id, {} as any)).resolves.toEqual(categoria);
    });

    it('lança NotFound para id inexistente', async () => {
      await expect(service.update('nao-existe', { nome: 'X' } as any)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('recusa atualizar categoria inativa', async () => {
      const categoria = await criar();
      await service.remove(categoria.id);
      await expect(service.update(categoria.id, { nome: 'X' } as any)).rejects.toThrow(
        ConflictException,
      );
    });
  });
});
