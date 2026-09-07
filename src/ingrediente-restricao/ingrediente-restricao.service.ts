import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { VincularIngredienteRestricaoDto } from './dtos/ingrediente-restricao';

@Injectable()
export class IngredienteRestricaoService {
  constructor(private readonly prismaService: PrismaService) {}

  async vincular(ingredienteId: string, dto: VincularIngredienteRestricaoDto) {
    const ingrediente = await this.prismaService.ingrediente.findUnique({
      where: { id: ingredienteId },
    });

    if (!ingrediente) {
      throw new NotFoundException('Ingrediente não encontrado');
    }

    const restricao = await this.prismaService.restricaoAlimentar.findUnique({
      where: { id: dto.restricaoId },
    });

    if (!restricao) {
      throw new NotFoundException('Restrição alimentar não encontrada');
    }

    try {
      return await this.prismaService.ingredienteRestricao.create({
        data: { ingredienteId, restricaoId: dto.restricaoId },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Ingrediente já vinculado a esta restrição');
      }
      throw error;
    }
  }

  async findAllByIngrediente(ingredienteId: string) {
    const ingrediente = await this.prismaService.ingrediente.findUnique({
      where: { id: ingredienteId },
    });

    if (!ingrediente) {
      throw new NotFoundException('Ingrediente não encontrado');
    }

    return this.prismaService.ingredienteRestricao.findMany({
      where: { ingredienteId },
      include: { restricao: true },
    });
  }

  async remove(ingredienteId: string, restricaoId: string): Promise<void> {
    try {
      await this.prismaService.ingredienteRestricao.delete({
        where: {
          ingredienteId_restricaoId: { ingredienteId, restricaoId },
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new NotFoundException('Vínculo não encontrado');
      }
      throw error;
    }
  }
  
  async regraDiabete(ingredienteId: string){
    
  }
}
