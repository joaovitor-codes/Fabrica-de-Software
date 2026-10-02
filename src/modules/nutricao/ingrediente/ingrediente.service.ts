import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { IngredienteDTO } from './dtos/ingrediente';
import { UpdateIngredienteDto } from './dtos/update-ingrediente';
import { PrismaService } from '../../../common/prisma/prisma.service';
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

  async findAll(page: number, limit: number) {
    const ingredientes = await this.prismaService.ingrediente.findMany({
      skip: (page - 1) * limit,
      take: limit,
    });
    if (!ingredientes || ingredientes.length === 0) {
      throw new NotFoundException('Nenhum ingrediente encontrado.');
    }

    return ingredientes;
  }

  async findOne(id: string) {
    const ingredienteExists = await this.alreadyExists(id);
    if (!ingredienteExists) {
      throw new NotFoundException('Ingrediente não encontrado.');
    }
    const ingrediente = await this.prismaService.ingrediente.findUnique({
      where: { id },
      include: {
        restricoes: true,
      },
    });
    return ingrediente;
  }

  async update(id: string, updateIngredienteDto: UpdateIngredienteDto) {
    const atual = await this.prismaService.ingrediente.findUnique({
      where: { id },
      select: { nome: true },
    });
    if (!atual) {
      throw new NotFoundException('Ingrediente não encontrado.');
    }

    // Campos copiados um a um: o body não pode marcar o ingrediente como
    // revisado nem mexer em codigoFonteExterno.
    const nomeMudou =
      updateIngredienteDto.nome !== undefined &&
      updateIngredienteDto.nome !== atual.nome;

    const ingredienteUpdated = await this.prismaService.ingrediente.update({
      where: { id },
      data: {
        nome: updateIngredienteDto.nome,
        caloriasKcal: updateIngredienteDto.caloriasKcal,
        proteinasG: updateIngredienteDto.proteinasG,
        carboidratosG: updateIngredienteDto.carboidratosG,
        gordurasG: updateIngredienteDto.gordurasG,
        fibrasG: updateIngredienteDto.fibrasG,
        sodioMg: updateIngredienteDto.sodioMg,
        fonteDados: updateIngredienteDto.fonteDados,
        // Outro nome é outro alimento: volta para a fila de curadoria. Os
        // nutrientes não precisam disso, a regra nutricional reavalia abaixo.
        ...(nomeMudou ? { restricoesRevisadasEm: null } : {}),
      },
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
      throw new NotFoundException('Ingrediente não encontrado.');
    }
    try {
      await this.prismaService.ingrediente.delete({
        where: { id },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new ConflictException(
          'Não é possível remover: o ingrediente é usado em receitas, restrições ou substitutos',
        );
      }
      throw error;
    }
    return { success: 'Ingrediente removido com sucesso.' };
  }
}
