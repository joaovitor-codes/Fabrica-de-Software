import { Injectable } from '@nestjs/common';
import { ReceitaDto } from './dto/receita';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateReceitaDto } from './dto/update.receita';

@Injectable()
export class ReceitaService {
  constructor(private prismaService: PrismaService){}
  async create(data: ReceitaDto, userId: string) {
    const user = await this.prismaService.receita.create({
      data: {
        nome: data.nome,
        descricao: data.descricao,
        modoPreparo: data.modoPreparo,
        tempoPreparoMin: data.tempoPreparoMin,
        porcoes: data.porcoes,
        nivelDificuldade: data.nivelDificuldade,
        avisoContaminacaoCruzada: data.avisoContaminacaoCruzada,
        criadoPor: userId,
      }
    });
    return user;
  }

  async findAll() {
    const receitas = await this.prismaService.receita.findMany();
    if (!receitas || receitas.length === 0) {
      return { error: 'Nenhuma receita encontrada',}
    }
    return receitas;
  }

  async findOne(id: string) {
    const receita = await this.prismaService.receita.findUnique({
      where: { id }
    });
    if (!receita) {
      return { error: 'Receita não encontrada',}
    }
    return receita;
  }

  async findByName(nome: string) {
    const receita = await this.prismaService.receita.findMany({
      where: { nome: { contains: nome , mode: 'insensitive' } }
    });
    if (!receita) {
      return { error: 'Receita não encontrada',}
    }
    return receita;
  }

  async findIngredients(id: string) {
    const receita = await this.prismaService.receita.findUnique({
      where: { id },
      include: { ingredientes: true }
    });
    if (!receita) {
      return { error: 'Receita não encontrada',}
    }
    return receita.ingredientes;
  }

  async findReplacementFor(id: string) { } // TODO: Implementar o método de encontrar substitutos para os ingredientes de uma receita

  async findAlerts(id: string) {
    const receita = await this.prismaService.receita.findUnique({
      where: { id },
      include: { pontosTransacoes: true }
    });
    if (!receita) {
      return { error: 'Receita não encontrada',}
    }
    return receita.pontosTransacoes;
  }

  async findSuggestions() {
    const receitas = await this.prismaService.receita.findMany({
      where: { status: 'aprovada', 
      OR: [{ nivelDificuldade: 'facil' }, 
        { nivelDificuldade: 'medio' }]},
    });
    if (!receitas || receitas.length === 0) {
      return { error: 'Nenhuma receita encontrada',}
    }

    return receitas;
  }

  async findValidated() {
    const receitas = await this.prismaService.receita.findMany({
      where: { status: 'aprovada' },
    });
    if (!receitas || receitas.length === 0) {
      return { error: 'Nenhuma receita encontrada',}
    }

    return receitas;
  }

  async findFeedbacks() {} // TODO: Implementar o método de encontrar feedbacks para uma receita

  async update(id: string, updateReceita: UpdateReceitaDto) {
    const receita = await this.prismaService.receita.update({
      where: { id },
      data: {
        nome: updateReceita?.nome,
        descricao: updateReceita?.descricao,
        modoPreparo: updateReceita?.modoPreparo,
        tempoPreparoMin: updateReceita?.tempoPreparoMin,
        porcoes: updateReceita?.porcoes,
        nivelDificuldade: updateReceita?.nivelDificuldade,
        avisoContaminacaoCruzada: updateReceita?.avisoContaminacaoCruzada,
      }
    });
    if (!receita) {
      return { error: 'Receita não encontrada',}
    }
    return receita;
  }

  async remove(id: string) {
    const receita = await this.prismaService.receita.delete({
      where: { id } 
    });
    if (!receita) {
      return { error: 'Receita não encontrada',}
    }
  }
}
