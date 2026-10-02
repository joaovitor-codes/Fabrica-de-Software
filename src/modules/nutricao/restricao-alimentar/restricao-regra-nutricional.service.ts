import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  CreateRestricaoRegraNutricionalDto,
  UpdateRestricaoRegraNutricionalDto,
} from './dtos/restricao-regra-nutricional';
import { Prisma } from '@prisma/client';
import { RegraNutricionalService } from '../ingrediente-restricao/regra-nutricional.service';

@Injectable()
export class RestricaoRegraNutricionalService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly regraNutricionalService: RegraNutricionalService,
  ) {}

  async criarRegra(
    restricaoId: string,
    dto: CreateRestricaoRegraNutricionalDto,
  ) {
    const restricao = await this.prismaService.restricaoAlimentar.findUnique({
      where: {
        id: restricaoId,
      },
    });

    if (!restricao) {
      throw new NotFoundException('Restrição não encontrada');
    }

    try {
      const regra = await this.prismaService.restricaoRegraNutricional.create({
        data: {
          restricaoId: restricao.id,
          ...dto,
        },
      });

      await this.regraNutricionalService.reavaliarRestricao(restricao.id);

      return regra;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new NotFoundException('Regra já vinculada a restrição');
      }

      throw error;
    }
  }

  async getRegraByRestricaoId(restricaoId: string) {
    const restricao = await this.prismaService.restricaoAlimentar.findUnique({
      where: {
        id: restricaoId,
      },
      include: {
        regrasNutricionais: true,
      },
    });

    if (!restricao) {
      throw new NotFoundException('Restricao não encontrada');
    }

    return restricao;
  }

  async updateRegra(
    restricaoId: string,
    regraId: string,
    dto: UpdateRestricaoRegraNutricionalDto,
  ) {
    const restricao = await this.prismaService.restricaoAlimentar.findUnique({
      where: {
        id: restricaoId,
      },
    });

    if (!restricao) {
      throw new NotFoundException('Restricao não encontrada');
    }

    try {
      const regra = await this.prismaService.restricaoRegraNutricional.update({
        where: {
          id: regraId,
          restricaoId,
        },
        data: dto,
      });

      // Inclui o caso de valorLimite voltar a null: a reavaliação apaga os
      // vínculos que só essa regra sustentava.
      await this.regraNutricionalService.reavaliarRestricao(restricaoId);

      return regra;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException('Regra não encontrada nesta restrição');
      }

      throw error;
    }
  }

  async delete(restricaoId: string, regraId: string) {
    const restricao = await this.prismaService.restricaoAlimentar.findUnique({
      where: {
        id: restricaoId,
      },
    });

    if (!restricao) {
      throw new NotFoundException('Restricao não encontrada');
    }

    try {
      await this.prismaService.restricaoRegraNutricional.delete({
        where: {
          id: regraId,
          restricaoId,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException('Regra não encontrada nesta restrição');
      }

      throw error;
    }

    // Sem isso, os vínculos criados pela regra removida continuariam valendo.
    await this.regraNutricionalService.reavaliarRestricao(restricaoId);
  }
}
