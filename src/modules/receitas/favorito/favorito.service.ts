import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { VisibilidadeReceitaService } from '../visibilidade/visibilidade-receita.service';
import { restricoesDoPaciente } from '../visibilidade/restricoes-receita';

@Injectable()
export class FavoritoService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly visibilidade: VisibilidadeReceitaService,
  ) {}

  async findFavorites(usuarioId: string) {
    const favoritos = await this.prismaService.favorito.findMany({
      where: { usuarioId },
      include: {
        receita: {
          include: {
            ingredientes: {
              include: {
                ingrediente: true,
                unidadeMedida: true,
              },
            },
            midias: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!favoritos || favoritos.length === 0) {
      throw new NotFoundException('Nenhuma receita favorita encontrada');
    }

    // Favorito não some por causa de restrição nova: só ganha o aviso.
    return this.visibilidade.comRestricoesVioladas(
      favoritos.map(({ receita }) => receita),
      await restricoesDoPaciente(this.prismaService, { usuarioId }),
    );
  }

  async addFavorite(receitaId: string, usuarioId: string) {
    const receita = await this.prismaService.receita.findUnique({
      where: { id: receitaId },
    });
    if (!receita || receita.deletedAt) {
      throw new NotFoundException('Receita não encontrada');
    }

    const favoritoExists = await this.prismaService.favorito.findUnique({
      where: {
        usuarioId_receitaId: { usuarioId, receitaId },
      },
    });

    if (favoritoExists) {
      throw new ConflictException('A receita já foi favoritada');
    }

    const favorito = await this.prismaService.favorito.create({
      data: { usuarioId, receitaId },
    });

    return { success: 'Receita favoritada com sucesso.', data: favorito };
  }

  async removeFavorite(receitaId: string, usuarioId: string) {
    const favorito = await this.prismaService.favorito.findUnique({
      where: {
        usuarioId_receitaId: { usuarioId, receitaId },
      },
    });

    if (!favorito) {
      throw new NotFoundException('Receita não está nos favoritos');
    }

    await this.prismaService.favorito.delete({
      where: {
        usuarioId_receitaId: { usuarioId, receitaId },
      },
    });

    return { success: 'Receita removida dos favoritos com sucesso.' };
  }
}
