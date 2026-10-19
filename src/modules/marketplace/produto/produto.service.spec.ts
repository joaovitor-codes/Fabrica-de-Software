/// <reference types="jest" />

import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { unlink } from 'fs/promises';
import { join } from 'path';
import { StatusProduto } from '@prisma/client';
import { ProdutoService } from './produto.service';
import { PrismaService } from '../../../common/prisma/prisma.service';

jest.mock('fs/promises', () => ({
  unlink: jest.fn().mockResolvedValue(undefined),
}));

type Usuario = { id: string; telefones: { id: string }[] };
type Restricao = { id: string; nome: string };
type Categoria = { id: string; nome: string; ativo: boolean };
type Produto = {
  id: string;
  vendedorId: string;
  categoriaId: string;
  titulo: string;
  descricao?: string;
  preco?: number;
  cidade?: string;
  estado?: string;
  telefoneContatoId: string | null;
  telefoneContato?: { ddi: string | null; numero: string; tipo: string } | null;
  status: StatusProduto;
  createdAt: Date;
  deletedAt: Date | null;
  publicoAlvo: { restricaoId: string; restricao: Restricao }[];
};
type Midia = {
  id: string;
  produtoId: string;
  url: string;
  ordem: number;
  createdAt?: Date;
};

/** Aplica o subconjunto de filtros do Prisma usado pelo service. */
function casa(registro: Record<string, any>, where: Record<string, any> = {}) {
  return Object.entries(where).every(([campo, filtro]) => {
    const valor = registro[campo];
    if (filtro === null) return valor === null;
    if (typeof filtro === 'object' && 'in' in filtro)
      return filtro.in.includes(valor);
    if (typeof filtro === 'object' && 'not' in filtro)
      return valor !== filtro.not;
    if (typeof filtro === 'object' && 'contains' in filtro) {
      const texto = String(valor ?? '');
      const trecho = String(filtro.contains);
      return filtro.mode === 'insensitive'
        ? texto.toLowerCase().includes(trecho.toLowerCase())
        : texto.includes(trecho);
    }
    if (typeof filtro === 'object' && 'some' in filtro)
      return valor.some((item: Record<string, any>) => casa(item, filtro.some));
    return valor === filtro;
  });
}

/** Fake em memória das tabelas usadas pelo ProdutoService. */
class FakePrismaService {
  usuarios: Usuario[] = [];
  restricoes: Restricao[] = [];
  categorias: Categoria[] = [];
  produtos: Produto[] = [];
  midias: Midia[] = [];

  /** Anexa as fotos do produto quando o include pede `midias`. */
  private comMidias<T extends Produto>(registro: T, include: any) {
    if (!include?.midias) return registro;
    const midias = this.midias
      .filter((m) => m.produtoId === registro.id)
      .sort(
        (a, b) =>
          a.ordem - b.ordem ||
          (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0),
      )
      .slice(0, include.midias.take ?? Infinity)
      .map(({ id, url, ordem }) => ({ id, url, ordem }));
    return { ...registro, midias };
  }

  produtoMidia = {
    count: async ({ where }: any) =>
      this.midias.filter((m) => casa(m, where)).length,
    create: async ({ data }: any) => {
      const registro: Midia = { id: `midia${this.midias.length + 1}`, ...data };
      this.midias.push(registro);
      return registro;
    },
    findFirst: async ({ where }: any) =>
      this.midias.find((m) => casa(m, where)) ?? null,
    delete: async ({ where }: any) => {
      const indice = this.midias.findIndex((m) => m.id === where.id);
      return this.midias.splice(indice, 1)[0];
    },
  };

  usuario = {
    findUnique: async ({ where }: any) =>
      this.usuarios.find((u) => u.id === where.id) ?? null,
  };

  restricaoAlimentar = {
    count: async ({ where }: any) =>
      this.restricoes.filter((r) => casa(r, where)).length,
    findMany: async () => this.restricoes,
  };

  categoriaProduto = {
    findUnique: async ({ where }: any) =>
      this.categorias.find((c) => c.id === where.id) ?? null,
    findMany: async ({ where }: any) =>
      this.categorias.filter((c) => casa(c, where)),
  };

  produto = {
    create: async ({ data }: any) => {
      const { publicoAlvo, ...campos } = data;
      const registro: Produto = {
        id: `prod${this.produtos.length + 1}`,
        status: StatusProduto.ativo,
        // Um ms por registro para a ordenação por createdAt ser determinística.
        createdAt: new Date(2026, 0, 1, 0, 0, 0, this.produtos.length),
        deletedAt: null,
        ...campos,
        telefoneContatoId: campos.telefoneContatoId ?? null,
        publicoAlvo: publicoAlvo.create.map(
          ({ restricaoId }: { restricaoId: string }) => ({
            restricaoId,
            restricao: this.restricoes.find((r) => r.id === restricaoId)!,
          }),
        ),
      };
      this.produtos.push(registro);
      return registro;
    },
    findFirst: async ({ where, include }: any) => {
      const registro = this.produtos.find((p) => casa(p, where)) ?? null;
      if (
        registro &&
        !include?.telefoneContato &&
        'telefoneContato' in registro
      ) {
        const { telefoneContato, ...semTelefone } = registro;
        return this.comMidias(semTelefone, include);
      }
      return registro && this.comMidias(registro, include);
    },
    findMany: async ({
      where,
      skip = 0,
      take = Infinity,
      orderBy,
      include,
    }: any) => {
      const lista = this.produtos.filter((p) => casa(p, where));
      if (orderBy?.createdAt === 'desc') {
        lista.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      }
      return lista
        .slice(skip, skip + take)
        .map((p) => this.comMidias(p, include));
    },
    count: async ({ where }: any) =>
      this.produtos.filter((p) => casa(p, where)).length,
    update: async ({ where, data }: any) => {
      const registro = this.produtos.find((p) => p.id === where.id)!;
      Object.assign(registro, data);
      return registro;
    },
  };
}

describe('ProdutoService', () => {
  let prisma: FakePrismaService;
  let service: ProdutoService;

  const VENDEDOR = 'vendedor';
  const OUTRO = 'outro';

  beforeEach(async () => {
    prisma = new FakePrismaService();
    prisma.usuarios = [
      { id: VENDEDOR, telefones: [{ id: 'tel1' }, { id: 'tel2' }] },
      { id: OUTRO, telefones: [] },
    ];
    prisma.restricoes = [
      { id: 'r1', nome: 'Glúten' },
      { id: 'r2', nome: 'Lactose' },
    ];
    prisma.categorias = [
      { id: 'cat1', nome: 'Alimentos', ativo: true },
      { id: 'cat2', nome: 'Livros', ativo: false },
    ];

    const module: TestingModule = await Test.createTestingModule({
      providers: [ProdutoService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<ProdutoService>(ProdutoService);
  });

  function criar(usuarioId = VENDEDOR, restricaoIds?: string[]) {
    return service.createProduto(usuarioId, {
      categoriaId: 'cat1',
      titulo: 'Pão sem glúten',
      preco: 15.9,
      restricaoIds,
    });
  }

  describe('createProduto', () => {
    it('cria o produto com o primeiro telefone do vendedor e o público-alvo', async () => {
      const produto = await criar(VENDEDOR, ['r1', 'r2']);

      expect(produto).toMatchObject({
        vendedorId: VENDEDOR,
        categoriaId: 'cat1',
        titulo: 'Pão sem glúten',
        preco: 15.9,
        telefoneContatoId: 'tel1',
        status: StatusProduto.ativo,
      });
      expect(produto.publicoAlvo.map((p) => p.restricao.nome)).toEqual([
        'Glúten',
        'Lactose',
      ]);
    });

    it('cria sem restrições e sem telefone de contato', async () => {
      const produto = await criar(OUTRO);

      expect(produto.publicoAlvo).toEqual([]);
      expect(produto.telefoneContatoId).toBeNull();
    });

    it('lança NotFound para usuário inexistente', async () => {
      await expect(criar('nao-existe')).rejects.toThrow(
        new NotFoundException('Usuário não encontrado'),
      );
      expect(prisma.produtos).toHaveLength(0);
    });

    it.each(['nao-existe', 'cat2'])(
      'lança NotFound para categoria inexistente ou inativa: %s',
      async (categoriaId) => {
        await expect(
          service.createProduto(VENDEDOR, { categoriaId, titulo: 'X' }),
        ).rejects.toThrow(new NotFoundException('Categoria não encontrada'));
        expect(prisma.produtos).toHaveLength(0);
      },
    );

    it('lança NotFound se alguma restrição não existe', async () => {
      await expect(criar(VENDEDOR, ['r1', 'nao-existe'])).rejects.toThrow(
        new NotFoundException('Restrição alimentar não encontrada'),
      );
      expect(prisma.produtos).toHaveLength(0);
    });
  });

  describe('opções do formulário', () => {
    it('lista só categorias ativas, com id e nome', async () => {
      await expect(service.produtoCategoriasOpcoes()).resolves.toEqual([
        { id: 'cat1', nome: 'Alimentos' },
      ]);
    });

    it('lista restrições só com id e nome', async () => {
      await expect(
        service.produtoRestricoesAlimentaresOpcoes(),
      ).resolves.toEqual([
        { id: 'r1', nome: 'Glúten' },
        { id: 'r2', nome: 'Lactose' },
      ]);
    });

    it('lança NotFound quando as listas estão vazias', async () => {
      prisma.categorias = [];
      prisma.restricoes = [];
      await expect(service.produtoCategoriasOpcoes()).rejects.toThrow(
        NotFoundException,
      );
      await expect(
        service.produtoRestricoesAlimentaresOpcoes(),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getProdutoById', () => {
    it('retorna produto ativo para qualquer usuário', async () => {
      const produto = await criar();
      await expect(service.getProdutoById(produto.id, OUTRO)).resolves.toEqual({
        ...produto,
        midias: [],
      });
    });

    it('retorna todas as fotos na ordem de envio', async () => {
      const produto = await criar();
      prisma.midias = [
        { id: 'm2', produtoId: produto.id, url: '/b.jpg', ordem: 1 },
        { id: 'm1', produtoId: produto.id, url: '/a.jpg', ordem: 0 },
        { id: 'mx', produtoId: 'outro-produto', url: '/x.jpg', ordem: 0 },
      ];

      await expect(service.getProdutoById(produto.id)).resolves.toMatchObject({
        midias: [
          { id: 'm1', url: '/a.jpg', ordem: 0 },
          { id: 'm2', url: '/b.jpg', ordem: 1 },
        ],
      });
    });

    it('produto não ativo só aparece para o dono', async () => {
      const produto = await criar();
      await service.desativarProduto(produto.id, VENDEDOR);

      await expect(
        service.getProdutoById(produto.id, VENDEDOR),
      ).resolves.toMatchObject({ status: StatusProduto.pausado });
      await expect(service.getProdutoById(produto.id, OUTRO)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('lança NotFound para inexistente ou apagado', async () => {
      const produto = await criar();
      await service.apagarProduto(produto.id, VENDEDOR);

      await expect(
        service.getProdutoById(produto.id, VENDEDOR),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.getProdutoById('nao-existe', VENDEDOR),
      ).rejects.toThrow(NotFoundException);
    });

    it('só inclui o telefone no detalhe quando há usuário autenticado', async () => {
      const produto = await criar();
      produto.telefoneContato = {
        ddi: '+55',
        numero: '62999999999',
        tipo: 'celular',
      };

      const anonimo = await service.getProdutoById(produto.id);
      expect(anonimo).not.toHaveProperty('contato');

      await expect(service.getProdutoById(produto.id, OUTRO)).resolves.toEqual(
        expect.objectContaining({
          contato: produto.telefoneContato,
        }),
      );
    });
  });

  describe('findAll', () => {
    it('lista só ativos, não apagados e com telefone, paginado', async () => {
      const [p1, p2, p3] = [await criar(), await criar(), await criar()];
      const pausado = await criar();
      await service.desativarProduto(pausado.id, VENDEDOR);
      const apagado = await criar();
      await service.apagarProduto(apagado.id, VENDEDOR);
      await criar(OUTRO); // sem telefone

      await expect(service.findAll(1, 2)).resolves.toEqual({
        data: [
          { ...p1, midias: [] },
          { ...p2, midias: [] },
        ],
        meta: { total: 3, page: 1, last_page: 2, limit: 2 },
      });
      await expect(service.findAll(2, 2)).resolves.toMatchObject({
        data: [p3],
      });
    });

    it('traz só a primeira foto de cada produto como capa', async () => {
      const produto = await criar();
      prisma.midias = [
        { id: 'm2', produtoId: produto.id, url: '/b.jpg', ordem: 1 },
        { id: 'm1', produtoId: produto.id, url: '/a.jpg', ordem: 0 },
      ];

      const { data } = await service.findAll();
      expect(data[0].midias).toEqual([{ id: 'm1', url: '/a.jpg', ordem: 0 }]);
    });

    it.each([
      [0, 10],
      [-1, 10],
      [1, 0],
      [1, -5],
    ])('recusa page %p / limit %p com BadRequest', async (page, limit) => {
      await expect(service.findAll(page, limit)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('usa page 1 e limit 10 por padrão', async () => {
      await expect(service.findAll()).resolves.toEqual({
        data: [],
        meta: { total: 0, page: 1, last_page: 0, limit: 10 },
      });
    });

    it('combina os filtros de categoria, local, público-alvo e título', async () => {
      const alvo = await criar();
      Object.assign(alvo, {
        categoriaId: 'cat-especial',
        cidade: 'Recife',
        estado: 'PE',
        titulo: 'Bolo de aveia',
      });
      alvo.publicoAlvo = [
        { restricaoId: 'r1', restricao: prisma.restricoes[0] },
      ];

      const foraDaCategoria = await criar();
      Object.assign(foraDaCategoria, {
        categoriaId: 'cat-outra',
        cidade: 'Recife',
        estado: 'PE',
        titulo: 'Bolo de aveia',
      });
      foraDaCategoria.publicoAlvo = alvo.publicoAlvo;

      await expect(
        service.findAll(1, 10, {
          categoria: 'cat-especial',
          estado: 'PE',
          cidade: 'Recife',
          publicoAlvo: 'r1',
          q: 'AVEIA',
        }),
      ).resolves.toMatchObject({ data: [alvo], meta: { total: 1 } });
    });
  });

  describe('getProdutosMeus', () => {
    it('lista os produtos do usuário em qualquer status, mais novos primeiro', async () => {
      const antigo = await criar(VENDEDOR, ['r1']);
      const pausado = await criar();
      await service.desativarProduto(pausado.id, VENDEDOR);
      const removido = await criar();
      await service.removerProduto(removido.id);

      const meus = await service.getProdutosMeus(VENDEDOR);

      expect(meus.map((p) => [p.id, p.status])).toEqual([
        [removido.id, StatusProduto.removido],
        [pausado.id, StatusProduto.pausado],
        [antigo.id, StatusProduto.ativo],
      ]);
      expect(meus[2]).toEqual({
        id: antigo.id,
        categoriaId: 'cat1',
        titulo: 'Pão sem glúten',
        descricao: undefined,
        preco: 15.9,
        cidade: undefined,
        estado: undefined,
        status: StatusProduto.ativo,
        createdAt: antigo.createdAt,
        publicoAlvo: [{ id: 'r1', nome: 'Glúten' }],
      });
    });

    it('não inclui produtos apagados nem de outros usuários', async () => {
      const meu = await criar();
      const apagado = await criar();
      await service.apagarProduto(apagado.id, VENDEDOR);
      await criar(OUTRO);

      await expect(service.getProdutosMeus(VENDEDOR)).resolves.toMatchObject([
        { id: meu.id },
      ]);
    });

    it('retorna lista vazia quando o usuário não tem produtos', async () => {
      await criar(OUTRO);
      await expect(service.getProdutosMeus(VENDEDOR)).resolves.toEqual([]);
    });
  });

  describe('ações do vendedor', () => {
    it('desativa e ativa o próprio produto', async () => {
      const produto = await criar();

      await expect(
        service.desativarProduto(produto.id, VENDEDOR),
      ).resolves.toMatchObject({ status: StatusProduto.pausado });
      await expect(
        service.ativarProduto(produto.id, VENDEDOR),
      ).resolves.toMatchObject({ status: StatusProduto.ativo });
    });

    it('apaga com soft delete', async () => {
      const produto = await criar();
      await service.apagarProduto(produto.id, VENDEDOR);

      expect(prisma.produtos[0].deletedAt).toBeInstanceOf(Date);
      await expect(service.apagarProduto(produto.id, VENDEDOR)).rejects.toThrow(
        NotFoundException,
      );
    });

    it.each(['desativarProduto', 'ativarProduto', 'apagarProduto'] as const)(
      '%s recusa produto de outro usuário ou inexistente',
      async (acao) => {
        const produto = await criar();

        await expect(service[acao](produto.id, OUTRO)).rejects.toThrow(
          ForbiddenException,
        );
        await expect(service[acao]('nao-existe', VENDEDOR)).rejects.toThrow(
          NotFoundException,
        );
        expect(prisma.produtos[0]).toMatchObject({
          status: StatusProduto.ativo,
          deletedAt: null,
        });
      },
    );

    it.each(['desativarProduto', 'ativarProduto'] as const)(
      '%s recusa produto removido pela moderação',
      async (acao) => {
        const produto = await criar();
        await service.removerProduto(produto.id);

        await expect(service[acao](produto.id, VENDEDOR)).rejects.toThrow(
          new ForbiddenException('Produto removido pela moderação'),
        );
        expect(prisma.produtos[0].status).toBe(StatusProduto.removido);
      },
    );

    it('permite apagar produto removido pela moderação', async () => {
      const produto = await criar();
      await service.removerProduto(produto.id);

      await expect(
        service.apagarProduto(produto.id, VENDEDOR),
      ).resolves.toMatchObject({ deletedAt: expect.any(Date) });
    });
  });

  describe('moderação', () => {
    it('remove e reativa o produto', async () => {
      const produto = await criar();

      await expect(service.removerProduto(produto.id)).resolves.toMatchObject({
        status: StatusProduto.removido,
      });
      await expect(service.reativarProduto(produto.id)).resolves.toMatchObject({
        status: StatusProduto.ativo,
      });
    });

    it.each(['removerProduto', 'reativarProduto'] as const)(
      '%s lança NotFound para inexistente ou apagado',
      async (acao) => {
        const produto = await criar();
        await service.apagarProduto(produto.id, VENDEDOR);

        await expect(service[acao](produto.id)).rejects.toThrow(
          NotFoundException,
        );
        await expect(service[acao]('nao-existe')).rejects.toThrow(
          NotFoundException,
        );
      },
    );
  });

  describe('fotos', () => {
    const unlinkMock = unlink as jest.Mock;

    function arquivo(mimetype = 'image/png', size = 1024) {
      return {
        mimetype,
        size,
        filename: 'foto.png',
        path: '/tmp/uploads/produtos/foto.png',
      } as Express.Multer.File;
    }

    beforeEach(() => unlinkMock.mockClear());

    it('o vendedor envia fotos com ordem crescente', async () => {
      const produto = await criar();

      await expect(
        service.uploadMidia(produto.id, VENDEDOR, arquivo()),
      ).resolves.toMatchObject({
        data: {
          produtoId: produto.id,
          url: '/uploads/produtos/foto.png',
          ordem: 0,
        },
      });
      await expect(
        service.uploadMidia(produto.id, VENDEDOR, arquivo('image/jpeg')),
      ).resolves.toMatchObject({ data: { ordem: 1 } });
      expect(unlinkMock).not.toHaveBeenCalled();
    });

    it('lança BadRequest sem arquivo', async () => {
      const produto = await criar();

      await expect(
        service.uploadMidia(produto.id, VENDEDOR, undefined as any),
      ).rejects.toThrow(BadRequestException);
    });

    it.each([
      ['não é imagem', arquivo('application/pdf')],
      ['é grande demais', arquivo('image/png', 6 * 1024 * 1024)],
    ])('recusa e apaga o arquivo que %s', async (_caso, file) => {
      const produto = await criar();

      await expect(
        service.uploadMidia(produto.id, VENDEDOR, file),
      ).rejects.toThrow(BadRequestException);
      expect(unlinkMock).toHaveBeenCalledWith(file.path);
      expect(prisma.midias).toHaveLength(0);
    });

    it('outro usuário recebe Forbidden e o arquivo é apagado', async () => {
      const produto = await criar();

      await expect(
        service.uploadMidia(produto.id, OUTRO, arquivo()),
      ).rejects.toThrow(ForbiddenException);
      expect(unlinkMock).toHaveBeenCalledWith(arquivo().path);
      expect(prisma.midias).toHaveLength(0);
    });

    it('não aceita foto em produto removido pela moderação', async () => {
      const produto = await criar();
      await service.removerProduto(produto.id);

      await expect(
        service.uploadMidia(produto.id, VENDEDOR, arquivo()),
      ).rejects.toThrow(ForbiddenException);
    });

    it('lança NotFound para produto inexistente', async () => {
      await expect(
        service.uploadMidia('nao-existe', VENDEDOR, arquivo()),
      ).rejects.toThrow(NotFoundException);
    });

    it('o vendedor remove a foto e o arquivo sai do disco', async () => {
      const produto = await criar();
      const { data: midia } = await service.uploadMidia(
        produto.id,
        VENDEDOR,
        arquivo(),
      );

      await expect(
        service.removerMidia(produto.id, midia.id, VENDEDOR),
      ).resolves.toEqual({ success: 'Mídia removida com sucesso.' });
      expect(prisma.midias).toHaveLength(0);
      expect(unlinkMock).toHaveBeenCalledWith(
        join(process.cwd(), 'uploads', 'produtos', 'foto.png'),
      );
    });

    it('outro usuário não remove a foto', async () => {
      const produto = await criar();
      const { data: midia } = await service.uploadMidia(
        produto.id,
        VENDEDOR,
        arquivo(),
      );

      await expect(
        service.removerMidia(produto.id, midia.id, OUTRO),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.midias).toHaveLength(1);
      expect(unlinkMock).not.toHaveBeenCalled();
    });

    it('lança NotFound para foto de outro produto', async () => {
      const produto = await criar();
      const outroProduto = await criar();
      const { data: midia } = await service.uploadMidia(
        produto.id,
        VENDEDOR,
        arquivo(),
      );

      await expect(
        service.removerMidia(outroProduto.id, midia.id, VENDEDOR),
      ).rejects.toThrow(new NotFoundException('Mídia não encontrada'));
      expect(prisma.midias).toHaveLength(1);
    });
  });
});
