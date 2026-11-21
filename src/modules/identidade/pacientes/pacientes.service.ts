import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { CacheService } from '../../../common/cache/cache.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { Prisma, TipoUsuario } from '@prisma/client';
import { UpdatePacienteDto } from './dtos/pacientes';
import { CreatePacienteDto } from './dtos/pacientes';

export const PACIENTE_DE_SI_MESMO =
  'O profissional não pode ser responsável pelo próprio registro de paciente.';

@Injectable()
export class PacientesService {
  constructor(
    private prismaService: PrismaService,
    private cacheService: CacheService,
  ) {}

  /**
   * Cria o registro de paciente (admin). A conta `comum` vira `paciente`; a
   * `profissional` continua profissional e ganha o papel de paciente (os
   * papéis vêm dos registros). Tudo numa transação: o tipo muda antes do
   * registro porque o trigger do banco só aceita paciente em conta
   * `paciente` ou `profissional`.
   */
  async createPaciente(CreatePacienteDto: CreatePacienteDto) {
    const { userId, profissionalId } = CreatePacienteDto;

    const paciente = await this.prismaService
      .$transaction(async (tx) => {
        const usuario = await tx.usuario.findUnique({ where: { id: userId } });
        if (!usuario) {
          throw new NotFoundException('Usuário não encontrado');
        }
        if (usuario.tipoUsuario === TipoUsuario.admin) {
          throw new UnprocessableEntityException(
            'A conta de admin não pode ser paciente.',
          );
        }
        await this.garantirNaoEhOProprio(tx, userId, profissionalId);

        if (usuario.tipoUsuario === TipoUsuario.comum) {
          await tx.usuario.update({
            where: { id: userId },
            data: { tipoUsuario: TipoUsuario.paciente },
          });
        }
        return tx.paciente.create({
          data: { usuarioId: userId, profissionalId },
        });
      })
      .catch((error: unknown) => {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          throw new ConflictException('Este usuário já é paciente');
        }
        throw error;
      });

    await this.limparCacheDoMe(userId);
    return paciente;
  }

  /** Ninguém é paciente de si mesmo (#168). */
  async garantirNaoEhOProprio(
    db: Prisma.TransactionClient,
    usuarioDoPaciente: string,
    profissionalId?: string | null,
  ) {
    if (!profissionalId) {
      return;
    }
    const profissional = await db.profissional.findUnique({
      where: { id: profissionalId },
      select: { usuarioId: true },
    });
    if (profissional?.usuarioId === usuarioDoPaciente) {
      throw new UnprocessableEntityException(PACIENTE_DE_SI_MESMO);
    }
  }

  /** O /auth/me mostra os papéis da conta. */
  private limparCacheDoMe(usuarioId: string) {
    return this.cacheService.del(`auth:me:${usuarioId}`);
  }

  async getPacienteByUserId(userId: string) {
    const paciente = await this.prismaService.paciente.findUnique({
      where: { usuarioId: userId },
      include: {
        usuario: true,
        profissional: true,
        restricoes: true,
      },
    });

    if (!paciente) {
      throw new NotFoundException('Paciente não encontrado');
    }

    return paciente;
  }

  async findAll(page: number, limit: number) {
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prismaService.paciente.findMany({
        skip,
        take: limit,
        include: {
          usuario: true,
          profissional: true,
          restricoes: true,
        },
      }),
      this.prismaService.paciente.count(),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        last_page: Math.ceil(total / limit),
        limit,
      },
    };
  }

  async updatePaciente(UpdatePacienteDto: UpdatePacienteDto, userId: string) {
    await this.garantirNaoEhOProprio(
      this.prismaService,
      userId,
      UpdatePacienteDto.profissionalId,
    );
    const paciente = await this.prismaService.paciente.update({
      where: { usuarioId: userId },
      data: UpdatePacienteDto,
    });

    if (!paciente) {
      throw new NotFoundException('Paciente não encontrado');
    }

    return paciente;
  }

  /**
   * Remove o registro de paciente. A conta `paciente` volta a `comum`; a
   * `profissional` só perde o papel de paciente.
   */
  async deletePaciente(userId: string) {
    await this.prismaService.$transaction(async (tx) => {
      const paciente = await tx.paciente.findUnique({
        where: { usuarioId: userId },
      });
      if (!paciente) {
        throw new NotFoundException('Paciente não encontrado');
      }
      await tx.paciente.delete({ where: { usuarioId: userId } });
      await tx.usuario.updateMany({
        where: { id: userId, tipoUsuario: TipoUsuario.paciente },
        data: { tipoUsuario: TipoUsuario.comum },
      });
    });
    await this.limparCacheDoMe(userId);
  }

  async findOne(pacienteId: string) {
    const paciente = await this.prismaService.paciente.findUnique({
      where: { id: pacienteId },
      include: {
        usuario: true,
        profissional: true,
        restricoes: true,
      },
    });

    if (!paciente) {
      throw new NotFoundException('Paciente não encontrado');
    }

    return paciente;
  }
}
