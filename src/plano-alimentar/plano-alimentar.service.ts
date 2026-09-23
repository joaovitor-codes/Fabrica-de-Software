import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PlanoAlimentarDto, PlanoAlimentarItemDto } from './dto/plano-alimentar';

@Injectable()
export class PlanoAlimentarService {
  constructor(
    private prismaService: PrismaService,
  ) {}

  async createPlanoAlimentar(planoAlimentarDto: PlanoAlimentarDto, profissionalId: string, pacienteId: string) {
    const profissionalExiste = await this.prismaService.profissional.findUnique({
      where: { id: profissionalId },
    });

    if (!profissionalExiste) {
      throw new NotFoundException('Profissional não encontrado');
    }

    const pacienteExiste = await this.prismaService.paciente.findUnique({
      where: { id: pacienteId },
    });

    if (!pacienteExiste) {
      throw new NotFoundException('Paciente não encontrado');
    }

    if(pacienteExiste.profissionalId !== profissionalId){
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

  async adicionarItemAoPlano(planoAlimentarId: string, item: PlanoAlimentarItemDto, profissionalId: string) {
    const planoAlimentar = await this.prismaService.planoAlimentar.findUnique({
      where: { id: planoAlimentarId },
    });

    if(!planoAlimentar){
      throw new NotFoundException('Plano alimentar não encontrado');
    }

    if(planoAlimentar.profissionalId !== profissionalId){
      throw new NotFoundException('Plano alimentar não pertence ao profissional');
    }

    const receitaExiste = await this.prismaService.receita.findUnique({
      where: { id: item.receitaId },
    });

    if(!receitaExiste){
      throw new NotFoundException('Receita não encontrada');
    }

    const itemDuplicado = await this.prismaService.planoAlimentarItem.findFirst({
      where: {
        planoAlimentarId: planoAlimentarId,
        diaSemana: item.diaSemana,
        tipoRefeicao: item.tipoRefeicao,
      },
    });

    if(itemDuplicado){
      throw new ConflictException('Já existe um item cadastrado para esse dia e refeição neste plano alimentar');
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

  private horarioSugeridoParaDate(horario: string): Date {
    return new Date(`1970-01-01T${horario}${horario.length === 5 ? ':00' : ''}.000Z`);
  }
}
