import { Injectable } from '@nestjs/common';
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
