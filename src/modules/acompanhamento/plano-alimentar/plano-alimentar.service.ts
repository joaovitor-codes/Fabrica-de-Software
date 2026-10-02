import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TipoUsuario } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  PlanoAlimentarDto,
  PlanoAlimentarItemDto,
  UpdatePlanoAlimentarDto,
  UpdatePlanoAlimentarItemDto,
} from './dtos/plano-alimentar';

@Injectable()
export class PlanoAlimentarService {
  constructor(private prismaService: PrismaService) {}

  async createPlanoAlimentar(
    planoAlimentarDto: PlanoAlimentarDto,
    profissionalId: string,
    pacienteId: string,
  ) {
    const profissionalExiste = await this.prismaService.profissional.findUnique(
      {
        where: { id: profissionalId },
      },
    );

    if (!profissionalExiste) {
      throw new NotFoundException('Profissional não encontrado');
    }

    const pacienteExiste = await this.prismaService.paciente.findUnique({
      where: { id: pacienteId },
    });

    if (!pacienteExiste) {
      throw new NotFoundException('Paciente não encontrado');
    }

    if (pacienteExiste.profissionalId !== profissionalId) {
      throw new NotFoundException('Paciente não pertence ao profissional');
    }

    const planoAlimentar = await this.prismaService.planoAlimentar.create({
      data: {
        pacienteId: pacienteId,
        profissionalId: profissionalId,
        nome: planoAlimentarDto.nome,
        dataInicio: new Date(planoAlimentarDto.dataInicio),
        dataFim: new Date(planoAlimentarDto.dataFim),
      },
    });

    return planoAlimentar;
  }

  async adicionarItemAoPlano(
    planoAlimentarId: string,
    item: PlanoAlimentarItemDto,
    profissionalId: string,
  ) {
    const planoAlimentar = await this.prismaService.planoAlimentar.findUnique({
      where: { id: planoAlimentarId },
    });

    if (!planoAlimentar) {
      throw new NotFoundException('Plano alimentar não encontrado');
    }

    if (planoAlimentar.profissionalId !== profissionalId) {
      throw new NotFoundException(
        'Plano alimentar não pertence ao profissional',
      );
    }

    const receitaExiste = await this.prismaService.receita.findUnique({
      where: { id: item.receitaId },
    });

    // Receita excluída continua nos planos antigos, mas não entra em novos itens.
    if (!receitaExiste || receitaExiste.deletedAt) {
      throw new NotFoundException('Receita não encontrada');
    }

    const itemDuplicado = await this.prismaService.planoAlimentarItem.findFirst(
      {
        where: {
          planoAlimentarId: planoAlimentarId,
          diaSemana: item.diaSemana,
          tipoRefeicao: item.tipoRefeicao,
        },
      },
    );

    if (itemDuplicado) {
      throw new ConflictException(
        'Já existe um item cadastrado para esse dia e refeição neste plano alimentar',
      );
    }

    const novoItem = await this.prismaService.planoAlimentarItem.create({
      data: {
        planoAlimentarId: planoAlimentarId,
        receitaId: item.receitaId,
        diaSemana: item.diaSemana,
        tipoRefeicao: item.tipoRefeicao,
        horarioSugerido: this.horarioSugeridoParaDate(item.horarioSugerido),
      },
    });

    return novoItem;
  }

  async deletePlanoAlimentar(
    planoAlimentarId: string,
    usuarioId: string,
    tipoUsuario: TipoUsuario,
  ) {
    const planoAlimentar = await this.prismaService.planoAlimentar.findUnique({
      where: { id: planoAlimentarId },
    });

    if (!planoAlimentar) {
      throw new NotFoundException('Plano alimentar não encontrado');
    }

    if (tipoUsuario !== TipoUsuario.admin) {
      const profissional = await this.prismaService.profissional.findUnique({
        where: { usuarioId },
      });

      if (profissional?.id !== planoAlimentar.profissionalId) {
        throw new NotFoundException(
          'Plano alimentar não pertence ao profissional',
        );
      }
    }

    if (!planoAlimentar.ativo) {
      throw new NotFoundException('Plano alimentar não encontrado');
    }

    return this.prismaService.planoAlimentar.update({
      where: { id: planoAlimentarId },
      data: { ativo: false },
    });
  }

  async findPlanoAlimentar(
    planoAlimentarId: string,
    usuarioId: string,
    tipoUsuario: TipoUsuario,
  ) {
    const planoAlimentar = await this.prismaService.planoAlimentar.findUnique({
      where: { id: planoAlimentarId },
      include: {
        itens: {
          include: { receita: { select: { id: true, nome: true } } },
          orderBy: [{ diaSemana: 'asc' }, { tipoRefeicao: 'asc' }],
        },
      },
    });

    if (!planoAlimentar) {
      throw new NotFoundException('Plano alimentar não encontrado');
    }

    if (tipoUsuario !== TipoUsuario.admin) {
      const [profissional, paciente] = await Promise.all([
        this.prismaService.profissional.findUnique({ where: { usuarioId } }),
        this.prismaService.paciente.findUnique({ where: { usuarioId } }),
      ]);

      const ehProfissionalDono =
        profissional?.id === planoAlimentar.profissionalId;
      const ehPacienteDono = paciente?.id === planoAlimentar.pacienteId;

      if (!ehProfissionalDono && !ehPacienteDono) {
        throw new NotFoundException('Plano alimentar não encontrado');
      }
    }

    return planoAlimentar;
  }

  async findPlanosDoPaciente(
    pacienteId: string,
    usuarioId: string,
    tipoUsuario: TipoUsuario,
  ) {
    const paciente = await this.prismaService.paciente.findUnique({
      where: { id: pacienteId },
    });

    if (!paciente) {
      throw new NotFoundException('Paciente não encontrado');
    }

    if (tipoUsuario !== TipoUsuario.admin) {
      const profissional = await this.prismaService.profissional.findUnique({
        where: { usuarioId },
      });

      const ehProprioPaciente = paciente.usuarioId === usuarioId;
      const ehProfissionalResponsavel =
        !!profissional && profissional.id === paciente.profissionalId;

      if (!ehProprioPaciente && !ehProfissionalResponsavel) {
        throw new NotFoundException('Paciente não encontrado');
      }
    }

    return this.prismaService.planoAlimentar.findMany({
      where: { pacienteId },
      include: { _count: { select: { itens: true } } },
      orderBy: { dataInicio: 'desc' },
    });
  }

  async updatePlanoAlimentar(
    planoAlimentarId: string,
    dto: UpdatePlanoAlimentarDto,
    profissionalId: string,
  ) {
    const planoAlimentar = await this.findPlanoAtivoDoProfissional(
      planoAlimentarId,
      profissionalId,
    );

    const dataInicio = dto.dataInicio
      ? new Date(dto.dataInicio)
      : planoAlimentar.dataInicio;
    const dataFim = dto.dataFim
      ? new Date(dto.dataFim)
      : planoAlimentar.dataFim;

    if (dataFim && dataFim < dataInicio) {
      throw new BadRequestException(
        'dataFim não pode ser anterior a dataInicio',
      );
    }

    return this.prismaService.planoAlimentar.update({
      where: { id: planoAlimentarId },
      data: {
        nome: dto.nome,
        dataInicio: dto.dataInicio ? dataInicio : undefined,
        dataFim: dto.dataFim ? dataFim : undefined,
      },
    });
  }

  async updateItemDoPlano(
    itemId: string,
    dto: UpdatePlanoAlimentarItemDto,
    profissionalId: string,
  ) {
    const item = await this.findItemDoProfissional(itemId, profissionalId);

    if (dto.receitaId) {
      const receitaExiste = await this.prismaService.receita.findUnique({
        where: { id: dto.receitaId },
      });

      if (!receitaExiste || receitaExiste.deletedAt) {
        throw new NotFoundException('Receita não encontrada');
      }
    }

    const diaSemana = dto.diaSemana ?? item.diaSemana;
    const tipoRefeicao = dto.tipoRefeicao ?? item.tipoRefeicao;

    if (diaSemana !== item.diaSemana || tipoRefeicao !== item.tipoRefeicao) {
      const itemDuplicado =
        await this.prismaService.planoAlimentarItem.findFirst({
          where: {
            planoAlimentarId: item.planoAlimentarId,
            diaSemana,
            tipoRefeicao,
            id: { not: itemId },
          },
        });

      if (itemDuplicado) {
        throw new ConflictException(
          'Já existe um item cadastrado para esse dia e refeição neste plano alimentar',
        );
      }
    }

    return this.prismaService.planoAlimentarItem.update({
      where: { id: itemId },
      data: {
        receitaId: dto.receitaId,
        diaSemana: dto.diaSemana,
        tipoRefeicao: dto.tipoRefeicao,
        horarioSugerido: dto.horarioSugerido
          ? this.horarioSugeridoParaDate(dto.horarioSugerido)
          : undefined,
      },
    });
  }

  async deleteItemDoPlano(itemId: string, profissionalId: string) {
    await this.findItemDoProfissional(itemId, profissionalId);

    // Checklist e comentários são histórico do paciente e não têm cascade
    // no schema; apagar o item levaria esse histórico junto (ou quebraria
    // a FK). Nesse caso o profissional deve editar o item em vez de remover.
    const [totalChecklists, totalComentarios] = await Promise.all([
      this.prismaService.checklistRefeicao.count({
        where: { planoAlimentarItemId: itemId },
      }),
      this.prismaService.comentarioRefeicao.count({
        where: { planoAlimentarItemId: itemId },
      }),
    ]);

    if (totalChecklists > 0 || totalComentarios > 0) {
      throw new ConflictException(
        'Item possui histórico de checklist ou comentários do paciente e não pode ser removido; edite o item em vez disso',
      );
    }

    return this.prismaService.planoAlimentarItem.delete({
      where: { id: itemId },
    });
  }

  private async findPlanoAtivoDoProfissional(
    planoAlimentarId: string,
    profissionalId: string,
  ) {
    const planoAlimentar = await this.prismaService.planoAlimentar.findUnique({
      where: { id: planoAlimentarId },
    });

    if (!planoAlimentar || !planoAlimentar.ativo) {
      throw new NotFoundException('Plano alimentar não encontrado');
    }

    if (planoAlimentar.profissionalId !== profissionalId) {
      throw new NotFoundException(
        'Plano alimentar não pertence ao profissional',
      );
    }

    return planoAlimentar;
  }

  private async findItemDoProfissional(itemId: string, profissionalId: string) {
    const item = await this.prismaService.planoAlimentarItem.findUnique({
      where: { id: itemId },
      include: { planoAlimentar: true },
    });

    if (!item || !item.planoAlimentar.ativo) {
      throw new NotFoundException('Item do plano alimentar não encontrado');
    }

    if (item.planoAlimentar.profissionalId !== profissionalId) {
      throw new NotFoundException(
        'Item do plano alimentar não pertence ao profissional',
      );
    }

    return item;
  }

  private horarioSugeridoParaDate(horario: string): Date {
    return new Date(
      `1970-01-01T${horario}${horario.length === 5 ? ':00' : ''}.000Z`,
    );
  }
}
