/// <reference types="jest" />

import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma, StatusDenuncia, StatusProduto } from '@prisma/client';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import { NotificacaoService } from '../../../notificacao/notificacao.service';
import { TermosService } from '../../termos/termos.service';
import { ProdutoDenunciaService } from './produto-denuncia.service';
import { ProdutoService } from '../produto/produto.service';

type Produto = {
  id: string;
  vendedorId: string;
  titulo: string;
  status: StatusProduto;
  deletedAt: Date | null;
};
type Denuncia = {
  id: string;
  produtoId: string;
  denuncianteId: string;
  motivo: string;
  status: StatusDenuncia;
  resolvidoPor: string | null;
  resolvidoEm: Date | null;
  createdAt: Date;
};

function casa(registro: Record<string, any>, where: Record<string, any> = {}) {
  return Object.entries(where).every(([campo, valor]) =>
    valor === null ? registro[campo] === null : registro[campo] === valor,
  );
}

/** Fake em memória de produtos e denúncias, com a unique (produto, denunciante). */
class FakePrismaService {
  produtos: Produto[] = [];
  denuncias: Denuncia[] = [];

  $transaction = async (fn: (tx: this) => Promise<unknown>) => fn(this);

  produto = {
    findFirst: async ({ where }: any) =>
      this.produtos.find((p) => casa(p, where)) ?? null,
    update: async ({ where, data }: any) => {
      const registro = this.produtos.find((p) => p.id === where.id)!;
      Object.assign(registro, data);
      return registro;
    },
  };

  produtoDenuncia = {
    create: async ({ data }: any) => {
      const duplicada = this.denuncias.some(
        (d) =>
          d.produtoId === data.produtoId &&
          d.denuncianteId === data.denuncianteId,
      );
      if (duplicada) {
        throw new Prisma.PrismaClientKnownRequestError('unique', {
          code: 'P2002',
          clientVersion: 'test',
        });
      }
      const registro: Denuncia = {
        id: `den${this.denuncias.length + 1}`,
        status: StatusDenuncia.aberta,
        resolvidoPor: null,
        resolvidoEm: null,
        createdAt: new Date(2026, 0, 1, 0, 0, 0, this.denuncias.length),
        ...data,
      };
      this.denuncias.push(registro);
      return registro;
    },
    findMany: async ({ where }: any) =>
      this.denuncias.filter((d) => casa(d, where)),
    findUnique: async ({ where, include }: any) => {
      const registro = this.denuncias.find((d) => d.id === where.id);
      if (!registro) return null;
      return include?.produto
        ? {
            ...registro,
            produto: this.produtos.find((p) => p.id === registro.produtoId),
          }
        : registro;
    },
    updateMany: async ({ where, data }: any) => {
      const alvos = this.denuncias.filter((d) => casa(d, where));
      alvos.forEach((d) => Object.assign(d, data));
      return { count: alvos.length };
    },
  };
}

describe('ProdutoDenunciaService', () => {
  let prisma: FakePrismaService;
  let notificacao: { criar: jest.Mock };
  let service: ProdutoDenunciaService;

  const VENDEDOR = 'vendedor';
  const ADMIN = 'admin';
  const motivo = { motivo: 'Rótulo lista farinha de trigo' };

  beforeEach(async () => {
    prisma = new FakePrismaService();
    prisma.produtos = [
      {
        id: 'prod1',
        vendedorId: VENDEDOR,
        titulo: 'Pão sem glúten',
        status: StatusProduto.ativo,
        deletedAt: null,
      },
      {
        id: 'prod2',
        vendedorId: VENDEDOR,
        titulo: 'Bolo sem lactose',
        status: StatusProduto.ativo,
        deletedAt: null,
      },
    ];
    notificacao = { criar: jest.fn().mockResolvedValue(null) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProdutoDenunciaService,
        ProdutoService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificacaoService, useValue: notificacao },
        // Dependência do ProdutoService; a denúncia não passa pelos termos.
        { provide: TermosService, useValue: {} },
      ],
    }).compile();

    service = module.get(ProdutoDenunciaService);
  });

  describe('denunciar', () => {
    it('registra a denúncia como aberta', async () => {
      await expect(
        service.denunciar('prod1', 'u1', motivo),
      ).resolves.toMatchObject({
        produtoId: 'prod1',
        denuncianteId: 'u1',
        status: StatusDenuncia.aberta,
      });
    });

    it('lança Conflict ao denunciar o mesmo produto duas vezes', async () => {
      await service.denunciar('prod1', 'u1', motivo);

      await expect(service.denunciar('prod1', 'u1', motivo)).rejects.toThrow(
        ConflictException,
      );
    });

    it('lança UnprocessableEntity ao denunciar o próprio produto', async () => {
      await expect(
        service.denunciar('prod1', VENDEDOR, motivo),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('lança NotFound para produto fora da vitrine', async () => {
      prisma.produtos[0].status = StatusProduto.pausado;
      prisma.produtos[1].deletedAt = new Date();

      await expect(service.denunciar('prod1', 'u1', motivo)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.denunciar('prod2', 'u1', motivo)).rejects.toThrow(
        NotFoundException,
      );
      await expect(
        service.denunciar('nao-existe', 'u1', motivo),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('listarAbertas', () => {
    it('retorna só as denúncias abertas', async () => {
      const aberta = await service.denunciar('prod1', 'u1', motivo);
      const resolvida = await service.denunciar('prod2', 'u1', motivo);
      await service.resolver(resolvida.id, ADMIN, { procedente: false });

      const fila = await service.listarAbertas();

      expect(fila.map((d) => d.id)).toEqual([aberta.id]);
    });
  });

  describe('resolver', () => {
    it('procedente remove o produto, fecha as outras abertas e notifica', async () => {
      const d1 = await service.denunciar('prod1', 'u1', motivo);
      const d2 = await service.denunciar('prod1', 'u2', motivo);
      const outroProduto = await service.denunciar('prod2', 'u1', motivo);

      await expect(
        service.resolver(d1.id, ADMIN, { procedente: true }),
      ).resolves.toMatchObject({
        status: StatusDenuncia.procedente,
        resolvidoPor: ADMIN,
        resolvidoEm: expect.any(Date),
      });

      expect(prisma.produtos[0].status).toBe(StatusProduto.removido);
      expect(prisma.denuncias.find((d) => d.id === d2.id)).toMatchObject({
        status: StatusDenuncia.procedente,
        resolvidoPor: ADMIN,
      });
      expect(
        prisma.denuncias.find((d) => d.id === outroProduto.id)?.status,
      ).toBe(StatusDenuncia.aberta);
      expect(notificacao.criar).toHaveBeenCalledTimes(1);
      expect(notificacao.criar).toHaveBeenCalledWith(
        expect.objectContaining({
          usuarioId: VENDEDOR,
          codigo: 'produto_removido',
          referencia: { produtoId: 'prod1' },
        }),
        prisma,
      );
    });

    it('improcedente fecha só a denúncia e não altera o produto', async () => {
      const d1 = await service.denunciar('prod1', 'u1', motivo);
      const d2 = await service.denunciar('prod1', 'u2', motivo);

      await expect(
        service.resolver(d1.id, ADMIN, { procedente: false }),
      ).resolves.toMatchObject({ status: StatusDenuncia.improcedente });

      expect(prisma.produtos[0].status).toBe(StatusProduto.ativo);
      expect(prisma.denuncias.find((d) => d.id === d2.id)?.status).toBe(
        StatusDenuncia.aberta,
      );
      expect(notificacao.criar).not.toHaveBeenCalled();
    });

    it('procedente sobre produto já removido não notifica de novo', async () => {
      const d1 = await service.denunciar('prod1', 'u1', motivo);
      prisma.produtos[0].status = StatusProduto.removido;

      await service.resolver(d1.id, ADMIN, { procedente: true });

      expect(notificacao.criar).not.toHaveBeenCalled();
    });

    it('lança Conflict para denúncia já resolvida', async () => {
      const d1 = await service.denunciar('prod1', 'u1', motivo);
      await service.resolver(d1.id, ADMIN, { procedente: false });

      await expect(
        service.resolver(d1.id, ADMIN, { procedente: true }),
      ).rejects.toThrow(ConflictException);
      expect(prisma.produtos[0].status).toBe(StatusProduto.ativo);
    });

    it('lança NotFound para denúncia inexistente', async () => {
      await expect(
        service.resolver('nao-existe', ADMIN, { procedente: true }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
