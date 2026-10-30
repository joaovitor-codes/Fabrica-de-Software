import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { unlink } from 'fs/promises';
import { join } from 'path';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import { ProdutoService } from '../produto/produto.service';

const TIPOS_FOTO = ['image/jpeg', 'image/png', 'image/webp'];
const TAMANHO_MAXIMO_FOTO = 5 * 1024 * 1024;

@Injectable()
export class ProdutoMidiaService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly produtoService: ProdutoService,
  ) {}

  async uploadMidia(
    produtoId: string,
    usuarioId: string,
    file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('file is required');
    }

    try {
      if (!TIPOS_FOTO.includes(file.mimetype)) {
        throw new BadRequestException('A foto precisa ser JPEG, PNG ou WebP');
      }

      if (file.size > TAMANHO_MAXIMO_FOTO) {
        throw new BadRequestException('A foto pode ter no máximo 5 MB');
      }

      const produto = await this.produtoService.buscarProdutoDoVendedor(
        produtoId,
        usuarioId,
      );
      this.produtoService.garantirNaoRemovido(produto);

      const ordem = await this.prismaService.produtoMidia.count({
        where: { produtoId },
      });

      const midia = await this.prismaService.produtoMidia.create({
        data: {
          produtoId,
          url: `/uploads/produtos/${file.filename}`,
          ordem,
        },
      });

      return {
        success: 'Mídia enviada com sucesso.',
        data: midia,
      };
    } catch (error) {
      await unlink(file.path).catch(() => undefined);
      throw error;
    }
  }

  async removerMidia(produtoId: string, midiaId: string, usuarioId: string) {
    const produto = await this.produtoService.buscarProdutoDoVendedor(
      produtoId,
      usuarioId,
    );
    this.produtoService.garantirNaoRemovido(produto);

    const midia = await this.prismaService.produtoMidia.findFirst({
      where: { id: midiaId, produtoId },
    });

    if (!midia) {
      throw new NotFoundException('Mídia não encontrada');
    }

    const caminho = join(process.cwd(), midia.url.replace(/^\/+/, ''));
    await unlink(caminho).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    });

    await this.prismaService.produtoMidia.delete({ where: { id: midiaId } });

    return { success: 'Mídia removida com sucesso.' };
  }
}
