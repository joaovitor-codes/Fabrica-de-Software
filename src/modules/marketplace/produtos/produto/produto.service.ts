import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import { NotificacaoService } from '../../../notificacao/notificacao.service';
import { TermosService } from '../../termos/termos.service';
import { CreateProduto, UpdateProduto } from './dtos/produto';
import { ListarProdutosQuery } from './dtos/listar-produtos';
import { Prisma, Produto, StatusProduto } from '@prisma/client';

// Fotos expostas na vitrine, na ordem em que o vendedor enviou. O createdAt
// desempata, porque remover uma foto pode deixar duas com a mesma ordem.
const MIDIAS_DA_VITRINE = {
  select: { id: true, url: true, ordem: true },
  orderBy: [{ ordem: 'asc' }, { createdAt: 'asc' }],
} satisfies Prisma.Produto$midiasArgs;

@Injectable()
export class ProdutoService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly notificacaoService: NotificacaoService,
    private readonly termosService: TermosService,
  ) {}

  async createProduto(usuarioid: string, data: CreateProduto) {
    await this.termosService.garantirAceite(usuarioid);

    const usuario = await this.prismaService.usuario.findUnique({
      where: {
        id: usuarioid,
      },
      include: {
        telefones: true,
      },
    });

    if (!usuario) {
      throw new NotFoundException('Usuário não encontrado');
    }

    await this.garantirCategoriaAtiva(data.categoriaId);

    const restricaoIds = data.restricaoIds ?? [];
    await this.garantirRestricoesExistem(restricaoIds);

    return this.prismaService.produto.create({
      data: {
        vendedorId: usuarioid,
        categoriaId: data.categoriaId,
        titulo: data.titulo,
        descricao: data.descricao,
        preco: data.preco,
        cidade: data.cidade,
        estado: data.estado,
        telefoneContatoId: usuario.telefones[0]?.id,
        publicoAlvo: {
          create: restricaoIds.map((restricaoId) => ({ restricaoId })),
        },
      },
      include: {
        publicoAlvo: {
          include: { restricao: true },
        },
      },
    });
  }

  private async garantirCategoriaAtiva(categoriaId: string) {
    const categoria = await this.prismaService.categoriaProduto.findUnique({
      where: {
        id: categoriaId,
      },
    });

    if (!categoria || !categoria.ativo) {
      throw new UnprocessableEntityException('Categoria não encontrada');
    }
  }

  private async garantirRestricoesExistem(restricaoIds: string[]) {
    if (!restricaoIds.length) {
      return;
    }

    const encontradas = await this.prismaService.restricaoAlimentar.count({
      where: {
        id: { in: restricaoIds },
      },
    });

    if (encontradas !== restricaoIds.length) {
      throw new UnprocessableEntityException(
        'Restrição alimentar não encontrada',
      );
    }
  }

  async updateProduto(
    produtoId: string,
    usuarioId: string,
    data: UpdateProduto,
  ) {
    const produto = await this.buscarProdutoDoVendedor(produtoId, usuarioId);
    this.garantirNaoRemovido(produto);

    const { restricaoIds, ...campos } = data;

    if (campos.categoriaId) {
      await this.garantirCategoriaAtiva(campos.categoriaId);
    }

    if (restricaoIds) {
      await this.garantirRestricoesExistem(restricaoIds);
    }

    if (campos.telefoneContatoId) {
      const telefone = await this.prismaService.telefone.findFirst({
        where: {
          id: campos.telefoneContatoId,
          usuarioId,
        },
      });

      if (!telefone) {
        throw new UnprocessableEntityException('Telefone não encontrado');
      }
    }

    return this.prismaService.produto.update({
      where: {
        id: produtoId,
      },
      data: {
        ...campos,
        // Na mesma escrita: apaga o público-alvo antigo e grava o novo.
        ...(restricaoIds
          ? {
              publicoAlvo: {
                deleteMany: {},
                create: restricaoIds.map((restricaoId) => ({ restricaoId })),
              },
            }
          : {}),
      },
      include: {
        publicoAlvo: {
          include: { restricao: true },
        },
      },
    });
  }

  async produtoCategoriasOpcoes() {
    const categorias = await this.prismaService.categoriaProduto.findMany({
      where: { ativo: true },
    });

    if (!categorias.length) {
      throw new NotFoundException('Nenhuma categoria de produto encontrada');
    }

    return [
      ...categorias.map((categoria) => ({
        id: categoria.id,
        nome: categoria.nome,
      })),
    ];
  }

  async produtoRestricoesAlimentaresOpcoes() {
    const restricoes = await this.prismaService.restricaoAlimentar.findMany();

    if (!restricoes.length) {
      throw new NotFoundException('Nenhuma restrição alimentar encontrada');
    }

    return [
      ...restricoes.map((restricao) => ({
        id: restricao.id,
        nome: restricao.nome,
      })),
    ];
  }

  // Também usados pelo ProdutoMidiaService.
  async buscarProdutoDoVendedor(produtoId: string, usuarioId: string) {
    const produto = await this.prismaService.produto.findFirst({
      where: {
        id: produtoId,
        deletedAt: null,
      },
    });

    if (!produto) {
      throw new NotFoundException('Produto não encontrado');
    }

    if (produto.vendedorId !== usuarioId) {
      throw new ForbiddenException('Produto não pertence ao usuário');
    }

    return produto;
  }

  garantirNaoRemovido(produto: Produto) {
    if (produto.status === StatusProduto.removido) {
      throw new ForbiddenException('Produto removido pela moderação');
    }
  }

  async desativarProduto(produtoId: string, usuarioId: string) {
    const produto = await this.buscarProdutoDoVendedor(produtoId, usuarioId);
    this.garantirNaoRemovido(produto);

    return this.prismaService.produto.update({
      where: {
        id: produtoId,
      },
      data: {
        status: StatusProduto.pausado,
      },
    });
  }

  async ativarProduto(produtoId: string, usuarioId: string) {
    const produto = await this.buscarProdutoDoVendedor(produtoId, usuarioId);
    this.garantirNaoRemovido(produto);

    return this.prismaService.produto.update({
      where: {
        id: produtoId,
      },
      data: {
        status: StatusProduto.ativo,
      },
    });
  }

  async apagarProduto(produtoId: string, usuarioId: string) {
    await this.buscarProdutoDoVendedor(produtoId, usuarioId);

    return this.prismaService.produto.update({
      where: {
        id: produtoId,
      },
      data: {
        deletedAt: new Date(),
      },
    });
  }

  async removerProduto(produtoId: string) {
    const produto = await this.prismaService.produto.findFirst({
      where: {
        id: produtoId,
        deletedAt: null,
      },
    });

    if (!produto) {
      throw new NotFoundException('Produto não encontrado');
    }

    return this.prismaService.$transaction((tx) =>
      this.marcarRemovido(produto, tx),
    );
  }

  // Usado pela remoção direta e pela denúncia procedente. Se o produto já
  // estava removido, não notifica o vendedor de novo.
  async marcarRemovido(produto: Produto, tx: Prisma.TransactionClient) {
    if (produto.status === StatusProduto.removido) {
      return produto;
    }

    const removido = await tx.produto.update({
      where: {
        id: produto.id,
      },
      data: {
        status: StatusProduto.removido,
      },
    });

    await this.notificacaoService.criar(
      {
        usuarioId: produto.vendedorId,
        codigo: 'produto_removido',
        titulo: 'Seu produto foi removido da vitrine',
        mensagem: `O produto "${produto.titulo}" foi removido pela moderação.`,
        referencia: { produtoId: produto.id },
      },
      tx,
    );

    return removido;
  }

  async getProdutoById(produtoId: string, usuarioId?: string) {
    const produto = await this.prismaService.produto.findFirst({
      where: {
        id: produtoId,
        deletedAt: null,
      },
      include: {
        publicoAlvo: {
          include: { restricao: true },
        },
        midias: MIDIAS_DA_VITRINE,
        ...(usuarioId
          ? {
              telefoneContato: {
                select: { ddi: true, numero: true, tipo: true },
              },
            }
          : {}),
      },
    });

    if (
      !produto ||
      (produto.vendedorId !== usuarioId &&
        produto.status !== StatusProduto.ativo)
    ) {
      throw new NotFoundException('Produto não encontrado');
    }

    if (usuarioId && 'telefoneContato' in produto) {
      const { telefoneContato, ...produtoSemRelacao } = produto;

      return {
        ...produtoSemRelacao,
        contato: telefoneContato,
      };
    }

    return produto;
  }

  async findAll(
    page: number = 1,
    limit: number = 10,
    filters: ListarProdutosQuery = {},
  ) {
    if (page < 1 || limit < 1) {
      throw new BadRequestException('page e limit devem ser maiores que 0');
    }

    const skip = (page - 1) * limit;
    const where: Prisma.ProdutoWhereInput = {
      status: StatusProduto.ativo,
      deletedAt: null,
      telefoneContatoId: { not: null },
      ...(filters.categoria ? { categoriaId: filters.categoria } : {}),
      ...(filters.estado ? { estado: filters.estado } : {}),
      ...(filters.cidade ? { cidade: filters.cidade } : {}),
      ...(filters.publicoAlvo
        ? { publicoAlvo: { some: { restricaoId: filters.publicoAlvo } } }
        : {}),
      ...(filters.q
        ? { titulo: { contains: filters.q, mode: 'insensitive' } }
        : {}),
    };

    const [data, total] = await Promise.all([
      this.prismaService.produto.findMany({
        where,
        skip,
        take: limit,
        include: {
          publicoAlvo: {
            include: { restricao: true },
          },
          // Na listagem basta a capa.
          midias: { ...MIDIAS_DA_VITRINE, take: 1 },
        },
      }),
      this.prismaService.produto.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        last_page: Math.ceil(total / limit),
        limit,
      },
    };
  }

  async reativarProduto(produtoId: string) {
    const produto = await this.prismaService.produto.findFirst({
      where: {
        id: produtoId,
        deletedAt: null,
      },
    });

    if (!produto) {
      throw new NotFoundException('Produto não encontrado');
    }

    return this.prismaService.produto.update({
      where: {
        id: produtoId,
      },
      data: {
        status: StatusProduto.ativo,
      },
    });
  }

  async getProdutosMeus(usuarioId: string) {
    const produtos = await this.prismaService.produto.findMany({
      where: {
        vendedorId: usuarioId,
        deletedAt: null,
      },
      orderBy: { createdAt: 'desc' },
      include: {
        publicoAlvo: {
          include: { restricao: true },
        },
      },
    });

    return produtos.map((produto) => ({
      id: produto.id,
      categoriaId: produto.categoriaId,
      titulo: produto.titulo,
      descricao: produto.descricao,
      preco: produto.preco,
      cidade: produto.cidade,
      estado: produto.estado,
      status: produto.status,
      createdAt: produto.createdAt,
      publicoAlvo: produto.publicoAlvo.map(({ restricao }) => ({
        id: restricao.id,
        nome: restricao.nome,
      })),
    }));
  }
}
