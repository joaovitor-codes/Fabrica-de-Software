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
import { PrismaService } from '../../../../common/prisma/prisma.service';
import { NotificacaoService } from '../../../notificacao/notificacao.service';
import { TermosService } from '../../termos/termos.service';
import { ProdutoService } from '../produto/produto.service';
import { ProdutoMidiaService } from './produto-midia.service';

jest.mock('fs/promises', () => ({
  unlink: jest.fn().mockResolvedValue(undefined),
}));

type Produto = {
  id: string;
  vendedorId: string;
  status: StatusProduto;
  deletedAt: Date | null;
};
type Midia = { id: string; produtoId: string; url: string; ordem: number };

function casa(registro: Record<string, any>, where: Record<string, any> = {}) {
  return Object.entries(where).every(([campo, valor]) =>
    valor === null ? registro[campo] === null : registro[campo] === valor,
  );
}

/** Fake em memória de produtos e fotos. */
class FakePrismaService {
  produtos: Produto[] = [];
  midias: Midia[] = [];

  produto = {
    findFirst: async ({ where }: any) =>
      this.produtos.find((p) => casa(p, where)) ?? null,
  };

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
}

describe('ProdutoMidiaService', () => {
  let prisma: FakePrismaService;
  let service: ProdutoMidiaService;

  const VENDEDOR = 'vendedor';
  const OUTRO = 'outro';

  beforeEach(async () => {
    prisma = new FakePrismaService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProdutoMidiaService,
        ProdutoService,
        { provide: PrismaService, useValue: prisma },
        // Dependências do ProdutoService que as fotos não usam.
        { provide: NotificacaoService, useValue: {} },
        { provide: TermosService, useValue: {} },
      ],
    }).compile();

    service = module.get<ProdutoMidiaService>(ProdutoMidiaService);
  });

  async function criar() {
    const produto: Produto = {
      id: `prod${prisma.produtos.length + 1}`,
      vendedorId: VENDEDOR,
      status: StatusProduto.ativo,
      deletedAt: null,
    };
    prisma.produtos.push(produto);
    return produto;
  }

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
      prisma.produtos[0].status = StatusProduto.removido;

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
