import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { unlink } from 'fs/promises';
import { Receita, StatusAprovacao, TipoMidia, TipoTransacaoPontos } from '@prisma/client';
import { ReceitaDto } from './dto/receita';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateReceitaDto } from './dto/update.receita';
import { CacheService } from '../cache/cache.service';

@Injectable()
export class ReceitaService {
  constructor(private prismaService: PrismaService,
    private cacheService: CacheService,
  ) {}

  async alreadyExists(id: string) {
    const receita = await this.prismaService.receita.findUnique({
      where: { id },
    });
    return !!receita;
  }

  async create(data: ReceitaDto, userId: string) {
    await this.cacheService.del('receitas:all');
    const receita = await this.prismaService.receita.create({
      data: {
        nome: data.nome,
        descricao: data.descricao,
        modoPreparo: data.modoPreparo,
        tempoPreparoMin: data.tempoPreparoMin,
        porcoes: data.porcoes,
        nivelDificuldade: data.nivelDificuldade,
        avisoContaminacaoCruzada: data.avisoContaminacaoCruzada,
        criadoPor: userId,

        ingredientes: {
          create: data.ingredientes.map((ingrediente) => ({
            ingredienteId: ingrediente.ingredienteId,
            quantidade: ingrediente.quantidade,
            unidadeMedidaId: ingrediente.unidadeMedidaId,
          })),
        },
      },
      include: {
        ingredientes: {
          include: {
            ingrediente: true,
            unidadeMedida: true,
          },
        },
      },
    });
    return { success: 'Receita criada com sucesso.', data: receita };
  }

  async uploadMedia(
  id: string,
  file: Express.Multer.File,
  tipo: TipoMidia,
  ordem: number,
) {
  if (!file) {
    throw new BadRequestException('file is required');
  }

  const allowedMimeTypes = [
    'image/jpeg',
    'image/png',
    'video/mp4',
  ];

  if (!allowedMimeTypes.includes(file.mimetype)) {
    await unlink(file.path).catch(() => undefined);

    throw new BadRequestException('invalid file type');
  }

  const maxSize = 5 * 1024 * 1024;

  if (file.size > maxSize) {
    await unlink(file.path).catch(() => undefined);

    throw new BadRequestException('file is too large!');
  }

  const receitaExists = await this.alreadyExists(id);

  if (!receitaExists) {
    await unlink(file.path).catch(() => undefined);

    throw new NotFoundException('Receita não encontrada');
  }

  let folder: string;

  if (file.fieldname === 'image') {
    folder = 'images';
  } else if (file.fieldname === 'video') {
    folder = 'videos';
  } else {
    await unlink(file.path).catch(() => undefined);

    throw new BadRequestException('Invalid file field');
  }

  try {
    const midia = await this.prismaService.receitaMidia.create({
      data: {
        receitaId: id,
        url: `/uploads/receitas/${folder}/${file.filename}`,
        tipo,
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

  async findAll() {
  const cacheKey = 'receitas:all';

  const cachedReceitas = await this.cacheService.get<Receita[]>(cacheKey);

  if (cachedReceitas) {
    return cachedReceitas;
  }

  const receitas = await this.prismaService.receita.findMany({});

  if (!receitas || receitas.length === 0) {
    throw new NotFoundException('Nenhuma receita encontrada');
  }
  await this.cacheService.set(cacheKey, receitas, 300_000);

  return receitas;
}

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

    return favoritos.map(({ receita }) => receita);
  }

  async addFavorite(receitaId: string, usuarioId: string) {
    const receitaExists = await this.alreadyExists(receitaId);
    if (!receitaExists) {
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

  async findOne(id: string) {
    const receitaExists = await this.alreadyExists(id);
    if (!receitaExists) {
      throw new NotFoundException('Receita não encontrada');
    }
    const receita = await this.prismaService.receita.findUnique({
      where: { id },
      include: {
        ingredientes: {
          include: {
            ingrediente: true,
            unidadeMedida: true,
          },
        },
        midias: true,
      },
    });
    return receita;
  }

  async findByName(nome: string) {
    const receita = await this.prismaService.receita.findMany({
      where: { nome: { contains: nome, mode: 'insensitive' } },
    });
    if (!receita || receita.length === 0) {
      throw new NotFoundException('Nenhuma receita encontrada com esse nome');
    }
    return receita;
  }

  async findIngredients(id: string) {
    const receitaExists = await this.alreadyExists(id);
    if (!receitaExists) {
      throw new NotFoundException('Receita não encontrada');
    }

    const receita = await this.prismaService.receita.findUnique({
      where: { id },
      include: { ingredientes: true },
    });
    return receita!.ingredientes;
  }

  async findReplacementFor(id: string) {} // TODO: Implementar o método de encontrar substitutos para os ingredientes de uma receita

  async findAlerts(id: string) {
    const receitaExists = await this.alreadyExists(id);
    if (!receitaExists) {
      throw new NotFoundException('Receita não encontrada');
    }

    const receita = await this.prismaService.receita.findUnique({
      where: { id },
      include: { pontosTransacoes: true },
    });
    return receita!.pontosTransacoes;
  }

  async findSuggestions() {
    const receitas = await this.prismaService.receita.findMany({
      where: {
        status: 'aprovada',
        OR: [{ nivelDificuldade: 'facil' }, { nivelDificuldade: 'medio' }],
      },
    });
    if (!receitas || receitas.length === 0) {
      throw new NotFoundException('Nenhuma receita encontrada');
    }

    return receitas;
  }

  async findValidated() {
    const receitas = await this.prismaService.receita.findMany({
      where: { status: 'aprovada' },
    });
    if (!receitas || receitas.length === 0) {
      throw new NotFoundException('Nenhuma receita encontrada');
    }
    return receitas;
  }

  async findFeedbacks() {} // TODO: Implementar o método de encontrar feedbacks para uma receita

  async update(id: string, updateReceita: UpdateReceitaDto, usuarioId: string) {
    const cacheKey = 'receitas:all';
    return this.prismaService.$transaction(async (tx) => {
      const receitaAtual = await tx.receita.findUnique({ where: { id } });

      if (!receitaAtual) {
        throw new NotFoundException('Receita não encontrada');
      }
      
      await this.cacheService.del(cacheKey);

      if (receitaAtual.status === 'aprovada') {
        await tx.receitaVersao.create({
          data: {
            receitaId: receitaAtual.id,
            versao: receitaAtual.versaoAtual,
            nome: receitaAtual.nome,
            descricao: receitaAtual.descricao,
            modoPreparo: receitaAtual.modoPreparo,
            alteradoPor: usuarioId,
          },
        });
      }

      const receita = await tx.receita.update({
        where: { id },
        data: {
          nome: updateReceita.nome,
          descricao: updateReceita.descricao,
          modoPreparo: updateReceita.modoPreparo,
          tempoPreparoMin: updateReceita.tempoPreparoMin,
          porcoes: updateReceita.porcoes,
          nivelDificuldade: updateReceita.nivelDificuldade,
          avisoContaminacaoCruzada: updateReceita.avisoContaminacaoCruzada,
          ...(receitaAtual.status === 'aprovada'
            ? { versaoAtual: { increment: 1 } }
            : {}),
        },
      });

      return { success: 'Receita atualizada com sucesso.', data: receita };
    });
  }

  async aprovarReceita(id: string, usuarioId: string) {
    const profissional = await this.prismaService.profissional.findUnique({
      where: { usuarioId },
    });

    if (!profissional) {
      throw new NotFoundException('Você ainda não possui cadastro profissional');
    }

    if (profissional.statusAprovacao !== StatusAprovacao.aprovado) {
      throw new UnauthorizedException(
        'Apenas profissionais aprovados podem realizar esta ação',
      );
    }

    return this.prismaService.$transaction(async (tx) => {
      const receita = await tx.receita.findUnique({ where: { id } });

      if (!receita) {
        throw new NotFoundException('Receita não encontrada');
      }

      if (receita.status === 'aprovada') {
        throw new ConflictException('A receita já foi aprovada');
      }

      const receitaAprovada = await tx.receita.update({
        where: { id },
        data: {
          status: 'aprovada',
          profissionalAprovadorId: profissional.id,
          dataAprovacao: new Date(),
        },
      });

      await tx.pontosTransacao.create({
        data: {
          profissionalId: profissional.id,
          receitaId: receita.id,
          pontos: 10,
          tipo: TipoTransacaoPontos.ganho_aprovacao,
          descricao: 'Pontos por aprovação de receita',
        },
      });

      return { success: 'Receita aprovada com sucesso.', data: receitaAprovada };
    });
  }

  async rejeitarReceita(id: string, usuarioId: string) {
    const profissional = await this.prismaService.profissional.findUnique({
      where: { usuarioId },
    });
    
    if (!profissional) {
      throw new NotFoundException('Você ainda não possui cadastro profissional');
    }

    return this.prismaService.$transaction(async (tx) => {
      const receita = await tx.receita.findUnique({ where: { id } });

      if (!receita) {
        throw new NotFoundException('Receita não encontrada');
      }

      if (receita.status === 'rejeitada') {
        throw new ConflictException('A receita já foi rejeitada');
      }

      const receitaRejeitada = await tx.receita.update({
        where: { id },
        data: {
          status: 'rejeitada',
        },
      });

      return { success: 'Receita rejeitada com sucesso.', data: receitaRejeitada };
    });
  }

  async remove(id: string) {
    const receitaExists = await this.alreadyExists(id);
    if (!receitaExists) {
      throw new NotFoundException('Receita não encontrada');
    }

    await this.prismaService.receitaMidia.deleteMany({
      where: { receitaId: id },
    });
    await this.prismaService.receitaIngrediente.deleteMany({
      where: { receitaId: id },
    });
    await this.prismaService.receita.delete({
      where: { id },
    });
    return { success: 'Receita removida com sucesso.' };
  }
}
