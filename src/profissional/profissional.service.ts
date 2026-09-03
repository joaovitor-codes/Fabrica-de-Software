import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { createProfissionalDto, UpdateProfissionalDto } from './dtos/profissional';
import { Prisma, StatusAprovacao, TipoUsuario } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { CreateUsuarioDto } from '../usuario/dtos/usuario';

@Injectable()
export class ProfissionalService {
  constructor(private readonly prismaService: PrismaService) {}

  async solicitarCadastroProfissional(userId: string, dto: createProfissionalDto) {
    const usuario = await this.prismaService.usuario.findUnique({
      where: { id: userId },
      include: { profissional: true },
    });

    if (!usuario) {
      throw new NotFoundException('Usuário não encontrado');
    }

    if (usuario.profissional) {
      if (usuario.profissional.statusAprovacao !== StatusAprovacao.rejeitado) {
        throw new ConflictException('Já existe uma solicitação profissional pendente ou aprovada para este usuário');
      }

      return this.prismaService.profissional.update({
        where: { id: usuario.profissional.id },
        data: {
          registroProfissional: dto.registroProfissional,
          especialidade: dto.especialidade,
          bio: dto.bio,
          clinicaId: dto.clinicaId,
          statusAprovacao: StatusAprovacao.pendente,
          aprovadoPor: null,
          aprovadoEm: null,
        },
      });
    }

    return this.prismaService.$transaction(async (tx) => {
      await tx.usuario.update({
        where: { id: userId },
        data: { tipoUsuario: TipoUsuario.profissional },
      });

      return tx.profissional.create({
        data: {
          usuarioId: userId,
          registroProfissional: dto.registroProfissional,
          especialidade: dto.especialidade,
          bio: dto.bio,
          clinicaId: dto.clinicaId,
          statusAprovacao: StatusAprovacao.pendente,
        },
      });
    });
  }

  async aprovarCadastroProfissional(adminId: string, profissionalId: string) {
    const profissional = await this.prismaService.profissional.findUnique({
      where: { id: profissionalId },
    });

    if (!profissional) {
      throw new NotFoundException('Profissional não encontrado');
    }

    if (profissional.statusAprovacao !== StatusAprovacao.pendente) {
      throw new ConflictException('Esta solicitação já foi avaliada');
    }

    return this.prismaService.profissional.update({
      where: { id: profissionalId },
      data: {
        statusAprovacao: StatusAprovacao.aprovado,
        aprovadoPor: adminId,
        aprovadoEm: new Date(),
      },
    });
  }

  async rejeitarCadastroProfissional(adminId: string, profissionalId: string) {
    const profissional = await this.prismaService.profissional.findUnique({
      where: { id: profissionalId },
    });

    if (!profissional) {
      throw new NotFoundException('Profissional não encontrado');
    }

    if (profissional.statusAprovacao !== StatusAprovacao.pendente) {
      throw new ConflictException('Esta solicitação já foi avaliada');
    }

    return this.prismaService.$transaction(async (tx) => {
      await tx.usuario.update({
        where: { id: profissional.usuarioId },
        data: { tipoUsuario: TipoUsuario.comum },
      });

      return tx.profissional.update({
        where: { id: profissionalId },
        data: {
          statusAprovacao: StatusAprovacao.rejeitado,
          aprovadoPor: adminId,
          aprovadoEm: new Date(),
        },
      });
    });
  }

  async listarProfissionaisPendentes(page: number = 1, limit: number = 10) {
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prismaService.profissional.findMany({
        where: { statusAprovacao: StatusAprovacao.pendente },
        skip,
        take: limit,
        include: { usuario: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prismaService.profissional.count({
        where: { statusAprovacao: StatusAprovacao.pendente },
      }),
    ]);

    return {
      data,
      meta: { total, page, last_page: Math.ceil(total / limit), limit },
    };
  }

  async findAll(page: number = 1, limit: number = 10, statusAprovacao?: StatusAprovacao) {
    const skip = (page - 1) * limit;
    const where = statusAprovacao ? { statusAprovacao } : {};

    const [data, total] = await Promise.all([
      this.prismaService.profissional.findMany({
        where,
        skip,
        take: limit,
        include: { usuario: true, clinica: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prismaService.profissional.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, last_page: Math.ceil(total / limit), limit },
    };
  }

  async findOne(id: string) {
    const profissional = await this.prismaService.profissional.findUnique({
      where: { id },
      include: { usuario: true, clinica: true },
    });

    if (!profissional) {
      throw new NotFoundException('Profissional não encontrado');
    }

    return profissional;
  }

  async findByUsuarioId(usuarioId: string) {
    const profissional = await this.prismaService.profissional.findUnique({
      where: { usuarioId },
      include: { usuario: true, clinica: true },
    });

    if (!profissional) {
      throw new NotFoundException('Você ainda não possui cadastro profissional');
    }

    return profissional;
  }

  async update(id: string, data: UpdateProfissionalDto) {
    try {
      return await this.prismaService.profissional.update({
        where: { id },
        data: {
          especialidade: data.especialidade,
          bio: data.bio,
          clinicaId: data.clinicaId,
        },
        include: { clinica: true },
      });
    } catch (error: any) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new NotFoundException('Profissional não encontrado');
      }
      throw error;
    }
  }

  private async exigirProfissionalAprovado(profissionalId: string) {
    const profissional = await this.prismaService.profissional.findUnique({
      where: { id: profissionalId },
    });

    if (!profissional) {
      throw new NotFoundException('Profissional não encontrado');
    }

    if (profissional.statusAprovacao !== StatusAprovacao.aprovado) {
      throw new UnauthorizedException(
        'Apenas profissionais aprovados podem realizar esta ação',
      );
    }

    return profissional;
  }

  async associarPaciente(profissionalId: string, pacienteId: string) {
    await this.exigirProfissionalAprovado(profissionalId);

    const paciente = await this.prismaService.paciente.findUnique({
      where: { id: pacienteId },
    });

    if (!paciente) {
      throw new NotFoundException('Paciente não encontrado');
    }

    if (paciente.profissionalId && paciente.profissionalId !== profissionalId) {
      throw new ConflictException(
        'Este paciente já possui um profissional responsável',
      );
    }

    return this.prismaService.paciente.update({
      where: { id: pacienteId },
      data: { profissionalId },
    });
  }

  async criarNovoPacienteAssociado(data: CreateUsuarioDto, profissionalId: string) {
    await this.exigirProfissionalAprovado(profissionalId);

    const hashedPassword = await bcrypt.hash(data.password, 10);

    try {
      return await this.prismaService.$transaction(async (tx) => {
        const usuario = await tx.usuario.create({
          data: {
            nome: data.name,
            tipoUsuario: TipoUsuario.paciente,
            dataNascimento: data.dataNascimento ? new Date(data.dataNascimento) : undefined,
            fotoPerfilUrl: data.fotoPerfilUrl,
            conta: {
              create: {
                email: data.email,
                senhaHash: hashedPassword,
              },
            },
          },
          include: { conta: true },
        });

        const paciente = await tx.paciente.create({
          data: {
            usuarioId: usuario.id,
            profissionalId,
          },
        });

        return { usuario, paciente };
      });
    } catch (error: any) {
      if (error?.code === 'P2002' && error?.meta?.target?.includes('email')) {
        throw new ConflictException('Email já está em uso');
      }
      throw new BadRequestException(
        'Não foi possível criar o paciente. Verifique os dados e tente novamente.',
      );
    }
  }

  async listarPacientesDoProfissional(profissionalId: string) {
    return this.prismaService.paciente.findMany({
      where: { 
        profissionalId: profissionalId 
      },
      include: {
        usuario: {
          select: {
            nome: true,
            fotoPerfilUrl: true,
            dataNascimento: true,
            conta: {
              select: {
                email: true
              }
            }
          }
        },
        dadosSocioeconomicos: true, 
      },
      orderBy: {
        usuario: {
          nome: 'asc' 
        }
      }
    });
  }
}