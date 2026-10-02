import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { UnidadeMedidaDto } from './dtos/unidade-medida';
import { UpdateUnidadeMedidaDto } from './dtos/update-unidade-medida';
import { PrismaService } from '../../../common/prisma/prisma.service';

@Injectable()
export class UnidadeMedidaService {
  constructor(private prismaService: PrismaService) {}

  async alreadyExists(id: string) {
    const unidadeMedida = await this.prismaService.unidadeMedida.findUnique({
      where: { id },
    });
    return !!unidadeMedida;
  }

  async create(createUnidadeMedidaDto: UnidadeMedidaDto) {
    const unidadeMedida = await this.prismaService.unidadeMedida.create({
      data: {
        codigo: createUnidadeMedidaDto.codigo,
        nome: createUnidadeMedidaDto.nome,
        ativo: createUnidadeMedidaDto.ativo,
      },
    });
    return {
      success: 'Unidade de medida criada com sucesso.',
      data: unidadeMedida,
    };
  }

  async findAll() {
    const unidadesMedida = await this.prismaService.unidadeMedida.findMany();
    if (!unidadesMedida || unidadesMedida.length === 0) {
      throw new NotFoundException('Nenhuma unidade de medida encontrada');
    }
    return unidadesMedida;
  }

  async findOne(id: string) {
    const unidadeMedidaExists = await this.alreadyExists(id);
    if (!unidadeMedidaExists) {
      throw new NotFoundException('Unidade de medida não encontrada');
    }
    const unidadeMedida = await this.prismaService.unidadeMedida.findUnique({
      where: {
        id: id,
      },
    });
    return unidadeMedida;
  }

  async update(id: string, updateUnidadeMedidaDto: UpdateUnidadeMedidaDto) {
    const unidadeMedidaExists = await this.alreadyExists(id);
    if (!unidadeMedidaExists) {
      throw new NotFoundException('Unidade de medida não encontrada');
    }
    const unidadeMedida = await this.prismaService.unidadeMedida.update({
      where: { id },
      data: {
        codigo: updateUnidadeMedidaDto.codigo,
        nome: updateUnidadeMedidaDto.nome,
        ativo: updateUnidadeMedidaDto.ativo,
      },
    });
    return {
      success: 'Unidade de medida atualizada com sucesso.',
      data: unidadeMedida,
    };
  }

  async remove(id: string) {
    const unidadeMedidaExists = await this.alreadyExists(id);
    if (!unidadeMedidaExists) {
      throw new NotFoundException('Unidade de medida não encontrada');
    }

    // Antes, os ingredientes de receita que usavam a unidade eram apagados
    // junto, tirando ingredientes das receitas sem aviso. Unidade em uso não
    // sai; para tirá-la de circulação, use `ativo: false`.
    try {
      await this.prismaService.unidadeMedida.delete({
        where: { id },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new ConflictException(
          'Não é possível remover: a unidade de medida é usada em receitas. Desative-a com ativo = false.',
        );
      }
      throw error;
    }
    return { success: 'Unidade de medida removida com sucesso.' };
  }
}
