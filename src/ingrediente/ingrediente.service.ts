import { Injectable } from '@nestjs/common';
import { IngredienteDTO } from './dto/ingrediente';
import { UpdateIngredienteDto } from './dto/update-ingrediente.dto';
import { PrismaService } from '../prisma/prisma.service';
import { RegraNutricionalService } from '../ingrediente-restricao/regra-nutricional.service';

@Injectable()
export class IngredienteService {
  constructor(
    private prismaService: PrismaService,
    private readonly regraNutricionalService: RegraNutricionalService,
  ) {}

  async alreadyExists(id: string) {
    const ingrediente = await this.prismaService.ingrediente.findUnique({
      where: { id },
    });
    return !!ingrediente;
  }
  async create(data: IngredienteDTO) {
    const ingrediente = await this.prismaService.ingrediente.create({
      data: {
        nome: data.nome,
        caloriasKcal: data.caloriasKcal,
        proteinasG: data.proteinasG,
        carboidratosG: data.carboidratosG,
        gordurasG: data.gordurasG,
        fibrasG: data.fibrasG,
        sodioMg: data.sodioMg,
        fonteDados: data.fonteDados,
      },
    });

    await this.regraNutricionalService.avaliarIngrediente(ingrediente.id);

    return { success: 'Ingrediente criado com sucesso.', data: ingrediente };
  }

  async findAll() {
    const ingredientes = await this.prismaService.ingrediente.findMany();
    if (!ingredientes || ingredientes.length === 0) {
      return { error: 'Nenhum ingrediente encontrado' };
    }
    return ingredientes;
  }

  async findOne(id: string) {
    const ingredienteExists = await this.alreadyExists(id);
    if (!ingredienteExists) {
      return { error: 'Ingrediente não encontrado' };
    }
    const ingrediente = await this.prismaService.ingrediente.findUnique({
      where: { id },
    });
    return ingrediente;
  }

  async update(id: string, updateIngredienteDto: UpdateIngredienteDto) {
    const ingredienteExists = await this.alreadyExists(id);
    if (!ingredienteExists) {
      return { error: 'Ingrediente não encontrado' };
    }
    const ingredienteUpdated = await this.prismaService.ingrediente.update({
      where: { id },
      data: updateIngredienteDto,
    });

    await this.regraNutricionalService.avaliarIngrediente(id);

    return {
      success: 'Ingrediente atualizado com sucesso.',
      data: ingredienteUpdated,
    };
  }

  async remove(id: string) {
    const ingredienteExists = await this.alreadyExists(id);
    if (!ingredienteExists) {
      return { error: 'Ingrediente não encontrado' };
    }
    await this.prismaService.ingrediente.delete({
      where: { id },
    });
    return { success: 'Ingrediente removido com sucesso.' };
  }
}
