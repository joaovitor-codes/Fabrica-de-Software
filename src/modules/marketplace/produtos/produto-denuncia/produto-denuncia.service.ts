import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, StatusDenuncia, StatusProduto } from '@prisma/client';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import { ProdutoService } from '../produto/produto.service';
import {
  CreateProdutoDenunciaDto,
  ResolverProdutoDenunciaDto,
} from './dtos/produto-denuncia';

@Injectable()
export class ProdutoDenunciaService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly produtoService: ProdutoService,
  ) {}

  async denunciar(
    produtoId: string,
    usuarioId: string,
    data: CreateProdutoDenunciaDto,
  ) {
    // Só se denuncia o que está na vitrine.
    const produto = await this.prismaService.produto.findFirst({
      where: {
        id: produtoId,
        status: StatusProduto.ativo,
        deletedAt: null,
      },
    });

    if (!produto) {
      throw new NotFoundException('Produto não encontrado');
    }

    if (produto.vendedorId === usuarioId) {
      throw new UnprocessableEntityException(
        'Não é possível denunciar o próprio produto',
      );
    }

    return this.prismaService.produtoDenuncia
      .create({
        data: {
          produtoId,
          denuncianteId: usuarioId,
          motivo: data.motivo,
        },
      })
      .catch(this.denunciaDuplicada);
  }

  async listarAbertas() {
    const denunciasAbertas = await this.prismaService.produtoDenuncia.findMany({
      where: { status: StatusDenuncia.aberta },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        motivo: true,
        createdAt: true,
        denunciante: { select: { id: true, nome: true } },
        produto: {
          select: { id: true, titulo: true, status: true, vendedorId: true },
        },
      },
    });
    if (!denunciasAbertas.length) {
      throw new NotFoundException('Não há denúncias abertas');
    }
    return denunciasAbertas;
  }

  async resolver(
    denunciaId: string,
    adminId: string,
    data: ResolverProdutoDenunciaDto,
  ) {
    const denuncia = await this.prismaService.produtoDenuncia.findUnique({
      where: { id: denunciaId },
      include: { produto: true },
    });

    if (!denuncia) {
      throw new NotFoundException('Denúncia não encontrada');
    }

    const status = data.procedente
      ? StatusDenuncia.procedente
      : StatusDenuncia.improcedente;
    const resolucao = {
      status,
      resolvidoPor: adminId,
      resolvidoEm: new Date(),
    };

    return this.prismaService.$transaction(async (tx) => {
      // O filtro por `aberta` evita resolver duas vezes em requisições
      // simultâneas.
      const { count } = await tx.produtoDenuncia.updateMany({
        where: { id: denunciaId, status: StatusDenuncia.aberta },
        data: resolucao,
      });

      if (!count) {
        throw new ConflictException('Denúncia já resolvida');
      }

      if (data.procedente) {
        await tx.produtoDenuncia.updateMany({
          where: {
            produtoId: denuncia.produtoId,
            status: StatusDenuncia.aberta,
          },
          data: resolucao,
        });
        await this.produtoService.marcarRemovido(denuncia.produto, tx);
      }

      return tx.produtoDenuncia.findUnique({ where: { id: denunciaId } });
    });
  }

  private denunciaDuplicada(this: void, error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException('Você já denunciou este produto');
    }
    throw error;
  }
}
