import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { VisibilidadeReceitaService } from '../visibilidade/visibilidade-receita.service';
import { restricoesDoPaciente } from '../visibilidade/restricoes-receita';
import {
  OFERTA_NA_PREVIA,
  previaDaReceita,
  veConteudoPago,
} from '../visibilidade/conteudo-pago';
import { UsuarioAutenticado } from '../../../auth/auth.types';

@Injectable()
export class FavoritoService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly visibilidade: VisibilidadeReceitaService,
  ) {}

  async findFavorites(usuario: UsuarioAutenticado) {
    const usuarioId = usuario.id;
    const favoritos = await this.prismaService.favorito.findMany({
      // Só o que o usuário pode ver hoje: receita aprovada que voltou para
      // a curadoria sai da lista até ser aprovada de novo.
      where: { usuarioId, receita: this.visibilidade.filtroBase(usuario) },
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
            oferta: OFERTA_NA_PREVIA,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!favoritos || favoritos.length === 0) {
      throw new NotFoundException('Nenhuma receita favorita encontrada');
    }

    // Favorito não some por causa de restrição nova: só ganha o aviso.
    const anotadas = await this.visibilidade.comRestricoesVioladas(
      favoritos.map(({ receita }) => receita),
      await restricoesDoPaciente(this.prismaService, { usuarioId }),
    );
    // Receita paga favoritada continua na lista, mas como prévia.
    return anotadas.map((receita) =>
      receita.oferta && !veConteudoPago(receita, usuario)
        ? previaDaReceita(receita)
        : receita,
    );
  }

  async addFavorite(receitaId: string, usuario: UsuarioAutenticado) {
    const usuarioId = usuario.id;
    // Só se favorita o que se pode ver (aprovada, ou a própria). Restrição
    // alimentar não impede: o favorito só ganha o aviso.
    const receita = await this.prismaService.receita.findFirst({
      where: {
        id: receitaId,
        deletedAt: null,
        ...this.visibilidade.filtroBase(usuario),
      },
      select: { id: true },
    });
    if (!receita) {
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
