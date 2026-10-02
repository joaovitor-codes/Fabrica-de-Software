import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  UpdatePacienteRestricaoDto,
  VincularPacienteRestricaoDto,
} from './dtos/paciente-restricao';
import { Paciente, Prisma, TipoUsuario } from '@prisma/client';

@Injectable()
export class PacienteRestricaoService {
  constructor(private readonly prismaService: PrismaService) {}

  async vincularRestricaoAoPaciente(
    userId: string,
    tipoUsuario: TipoUsuario,
    pacienteId: string,
    dto: VincularPacienteRestricaoDto,
  ) {
    const paciente = await this.prismaService.paciente.findUnique({
      where: {
        id: pacienteId,
      },
    });

    if (!paciente) {
      throw new NotFoundException();
    }

    await this.verificarProfissional(userId, paciente, tipoUsuario);

    return this.criarVinculo(pacienteId, dto);
  }

  async findAllByPaciente(
    userId: string,
    tipoUsuario: TipoUsuario,
    pacienteId: string,
  ) {
    const paciente = await this.prismaService.paciente.findUnique({
      where: {
        id: pacienteId,
      },
      include: {
        restricoes: {
          include: {
            restricao: true,
          },
        },
      },
    });

    if (!paciente) {
      throw new NotFoundException('Paciente não encontrado');
    }

    await this.verificarProfissional(userId, paciente, tipoUsuario);

    return paciente.restricoes;
  }

  async update(
    userId: string,
    tipoUsuario: TipoUsuario,
    pacienteId: string,
    restricaoId: string,
    dto: UpdatePacienteRestricaoDto,
  ) {
    const paciente = await this.prismaService.paciente.findUnique({
      where: {
        id: pacienteId,
      },
    });

    if (!paciente) {
      throw new NotFoundException('Paciente não encontrado');
    }

    await this.verificarProfissional(userId, paciente, tipoUsuario);

    return this.atualizarVinculo(pacienteId, restricaoId, dto);
  }

  async delete(
    userId: string,
    tipoUsuario: TipoUsuario,
    pacienteId: string,
    restricaoId: string,
  ) {
    const paciente = await this.prismaService.paciente.findUnique({
      where: {
        id: pacienteId,
      },
    });

    if (!paciente) {
      throw new NotFoundException('Paciente não foi encontrado');
    }

    await this.verificarProfissional(userId, paciente, tipoUsuario);

    await this.removerVinculo(pacienteId, restricaoId);
  }

  // Rotas `me/restricoes`: o paciente mexe nas próprias restrições, sem
  // depender do profissional. O paciente sai sempre do usuário autenticado.

  async vincularPropria(usuarioId: string, dto: VincularPacienteRestricaoDto) {
    const paciente = await this.pacienteDoUsuario(usuarioId);
    return this.criarVinculo(paciente.id, dto);
  }

  async findAllProprias(usuarioId: string) {
    const paciente = await this.pacienteDoUsuario(usuarioId);
    return this.prismaService.pacienteRestricao.findMany({
      where: { pacienteId: paciente.id },
      include: { restricao: true },
    });
  }

  async updatePropria(
    usuarioId: string,
    restricaoId: string,
    dto: UpdatePacienteRestricaoDto,
  ) {
    const paciente = await this.pacienteDoUsuario(usuarioId);
    return this.atualizarVinculo(paciente.id, restricaoId, dto);
  }

  async deletePropria(usuarioId: string, restricaoId: string) {
    const paciente = await this.pacienteDoUsuario(usuarioId);
    await this.removerVinculo(paciente.id, restricaoId);
  }

  private async pacienteDoUsuario(usuarioId: string) {
    const paciente = await this.prismaService.paciente.findUnique({
      where: { usuarioId },
    });

    if (!paciente) {
      throw new NotFoundException('Paciente não encontrado');
    }

    return paciente;
  }

  private async criarVinculo(
    pacienteId: string,
    dto: VincularPacienteRestricaoDto,
  ) {
    const restricao = await this.prismaService.restricaoAlimentar.findUnique({
      where: {
        id: dto.restricaoId,
      },
    });

    if (!restricao) {
      throw new NotFoundException();
    }

    try {
      return await this.prismaService.pacienteRestricao.create({
        data: {
          pacienteId,
          restricaoId: dto.restricaoId,
          gravidade: dto.gravidade,
          observacao: dto.observacao,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Restrição já vinculada a este paciente');
      }
      throw error;
    }
  }

  private async atualizarVinculo(
    pacienteId: string,
    restricaoId: string,
    dto: UpdatePacienteRestricaoDto,
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
      return await this.prismaService.pacienteRestricao.update({
        where: {
          // não tem chave unica então precisa dos dois para verificar
          pacienteId_restricaoId: {
            pacienteId,
            restricaoId,
          },
        },
        data: {
          gravidade: dto.gravidade,
          observacao: dto.observacao,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new ConflictException('Vinculo não encontrado');
      }
      throw error;
    }
  }

  private async removerVinculo(pacienteId: string, restricaoId: string) {
    try {
      await this.prismaService.pacienteRestricao.delete({
        where: {
          pacienteId_restricaoId: {
            pacienteId,
            restricaoId,
          },
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new ConflictException('Restrição desse paciente não encontrado');
      }
      throw error;
    }
  }

  /*
    ISSO AQUI É PARA VERIFICAR SE O PROFISSIONAL PODE OU NÃO MEXER NO PACIENTE, ELE SÓ PODE MEXER SE O PACIENTE FOR DELE !!!
    */

  private async verificarProfissional(
    userId: string,
    paciente: Paciente,
    tipoUsuario: TipoUsuario,
  ) {
    if (tipoUsuario !== TipoUsuario.admin) {
      const profissional = await this.prismaService.profissional.findUnique({
        where: {
          usuarioId: userId,
        },
      });

      if (!profissional || paciente.profissionalId !== profissional.id) {
        throw new ForbiddenException(
          'Você não pode associar restrições a pacientes que não sejam seus.',
        );
      }
    }
  }
}
