import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { unlink } from 'fs/promises';
import { StatusAprovacao, TipoMidia, TipoTransacaoPontos } from '@prisma/client';
import { ReceitaDto } from './dto/receita';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateReceitaDto } from './dto/update.receita';

@Injectable()
export class ReceitaService {
  constructor(private prismaService: PrismaService) {}

  async alreadyExists(id: string) {
    const receita = await this.prismaService.receita.findUnique({
      where: { id },
    });
    return !!receita;
  }

  async create(data: ReceitaDto, userId: string) {
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
    const receitas = await this.prismaService.receita.findMany({});
    if (!receitas || receitas.length === 0) {
      return { error: 'Nenhuma receita encontrada' };
    }
    return receitas;
  }

  async findOne(id: string) {
    const receitaExists = await this.alreadyExists(id);
    if (!receitaExists) {
      return { error: 'Receita não encontrada' };
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
      return { error: 'Nenhuma receita encontrada' };
    }
    return receita;
  }

  async findIngredients(id: string) {
    const receitaExists = await this.alreadyExists(id);
    if (!receitaExists) {
      return { error: 'Receita não encontrada' };
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
      return { error: 'Receita não encontrada' };
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
      return { error: 'Nenhuma receita encontrada' };
    }

    return receitas;
  }

  async findValidated() {
    const receitas = await this.prismaService.receita.findMany({
      where: { status: 'aprovada' },
    });
    if (!receitas || receitas.length === 0) {
      return { error: 'Nenhuma receita encontrada' };
    }
    return receitas;
  }

  async findFeedbacks() {} // TODO: Implementar o método de encontrar feedbacks para uma receita

  async update(id: string, updateReceita: UpdateReceitaDto) {
    const receitaExists = await this.alreadyExists(id);
    if (!receitaExists) {
      return { error: 'Receita não encontrada' };
    }

    const receita = await this.prismaService.receita.update({
      where: { id },
      data: {
        nome: updateReceita.nome,
        descricao: updateReceita.descricao,
        modoPreparo: updateReceita.modoPreparo,
        tempoPreparoMin: updateReceita.tempoPreparoMin,
        porcoes: updateReceita.porcoes,
        nivelDificuldade: updateReceita.nivelDificuldade,
        avisoContaminacaoCruzada: updateReceita.avisoContaminacaoCruzada,
      },
    });
    return { success: 'Receita atualizada com sucesso.', data: receita };
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

  async remove(id: string) {
    const receitaExists = await this.alreadyExists(id);
    if (!receitaExists) {
      return { error: 'Receita não encontrada' };
    }

    await this.prismaService.receitaIngrediente.deleteMany({
      where: { receitaId: id },
    });
    await this.prismaService.receita.delete({
      where: { id },
    });
    return { success: 'Receita removida com sucesso.' };
  }
}
