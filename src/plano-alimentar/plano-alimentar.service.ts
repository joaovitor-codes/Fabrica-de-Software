import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProfissionalService } from '../profissional/profissional.service';

@Injectable()
export class PlanoAlimentarService {
  constructor(
    private prismaService: PrismaService,
    private profissionalService: ProfissionalService,
  ) {}

  async createPlanoAlimentar(planoAlimentarDto: any, profissionalId: string) {
    const profissionalExiste = await this.profissionalService.profissionalExists(profissionalId);
    if (!profissionalExiste) {
      throw new NotFoundException('Profissional não encontrado');
    }

    const planoAlimentar = await this.prismaService.planoAlimentar.create({
      data: {
        pacienteId: planoAlimentarDto.pacienteId,
        profissionalId: profissionalId,
        nome: planoAlimentarDto.nome,
        dataInicio: new Date(planoAlimentarDto.dataInicio),
        dataFim: new Date(planoAlimentarDto.dataFim),
        itens: {
          create: planoAlimentarDto.itens.map((item: any) => ({
            receitaId: item.receitaId,
            diaSemana: item.diaSemana,
            tipoRefeicao: item.tipoRefeicao,
            horarioSugerido: this.horarioSugeridoParaDate(item.horarioSugerido),
          })),
        },
      },
    });

    return planoAlimentar;
  }

  private horarioSugeridoParaDate(horario: string): Date {
    return new Date(`1970-01-01T${horario}${horario.length === 5 ? ':00' : ''}.000Z`);
  }
}
