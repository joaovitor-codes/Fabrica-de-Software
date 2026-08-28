import { Injectable } from '@nestjs/common';
import { UnidadeMedidaDto } from './dto/unidade-medida.dto';
import { UpdateUnidadeMedidaDto } from './dto/update-unidade-medida.dto';
import { PrismaService } from '../prisma/prisma.service';

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
    return { success: 'Unidade de medida criada com sucesso.', data: unidadeMedida };
  }

  async findAll() {
    const unidadesMedida = await this.prismaService.unidadeMedida.findMany();
    if (!unidadesMedida || unidadesMedida.length === 0) {
      return { error: 'Nenhuma unidade de medida encontrada' };
    }
    return unidadesMedida;
  }

  async findOne(id: string) {
    const unidadeMedidaExists = await this.alreadyExists(id);
    if (!unidadeMedidaExists) {
      return { error: 'Unidade de medida não encontrada' };
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
      return { error: 'Unidade de medida não encontrada' };
    }
    const unidadeMedida = await this.prismaService.unidadeMedida.update({
      where: { id },
      data: {
        codigo: updateUnidadeMedidaDto.codigo,
        nome: updateUnidadeMedidaDto.nome,
        ativo: updateUnidadeMedidaDto.ativo,
      },
    });
    return { success: 'Unidade de medida atualizada com sucesso.', data: unidadeMedida,
    };
  }

  async remove(id: string) {
    const unidadeMedidaExists = await this.alreadyExists(id);
    if (!unidadeMedidaExists) {
      return { error: 'Unidade de medida não encontrada' };
    }

    await this.prismaService.receitaIngrediente.deleteMany({
      where: {
        unidadeMedidaId: id,
      },
    });
    await this.prismaService.unidadeMedida.delete({
      where: { id },
    });
    return { success: 'Unidade de medida removida com sucesso.' };
  }
}
