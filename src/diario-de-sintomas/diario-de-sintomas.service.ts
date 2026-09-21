import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDiarioSintomasDto } from './dtos/diario-de-sintomas';
import { TipoUsuario } from '@prisma/client';

@Injectable()
export class DiarioDeSintomasService {
    constructor(
        private readonly prismaService: PrismaService,
    ){}

    async criarDiarioDeSintomas(pacienteId: string, dto: CreateDiarioSintomasDto, usuarioId: string, tipoUsuario: TipoUsuario){
        await this.validarAcessoAoPaciente(pacienteId, usuarioId, tipoUsuario);

        if(dto.checklistRefeicaoId){
            const checklist = await this.prismaService.checklistRefeicao.findUnique({
                where: { id: dto.checklistRefeicaoId }
            });

            if(!checklist){
                throw new NotFoundException('Checklist de refeição não encontrado');
            }

            if(checklist.pacienteId !== pacienteId){
                throw new ForbiddenException('Este checklist não pertence a este paciente');
            }
        }

        if(dto.tagIds?.length){
            const tagIds = [...new Set(dto.tagIds)];
            const encontradas = await this.prismaService.tagSintoma.count({ where: { id: { in: tagIds } } });

            if(encontradas !== tagIds.length){
                throw new BadRequestException('Uma ou mais tags de sintoma informadas não existem');
            }

            dto.tagIds = tagIds;
        }

        return await this.prismaService.diarioSintoma.create({
            data: {
                pacienteId,
                checklistRefeicaoId: dto.checklistRefeicaoId,
                observacao: dto.observacao,
                tags: dto.tagIds?.length ? { create: dto.tagIds.map((tagId) => ({ tagId })) } : undefined,
            },
            include: {
                tags: { include: { tag: true } }
            }
        });
    }

    async findAllPorPacienteId(pacienteId: string, usuarioId: string, tipoUsuario: TipoUsuario, page: number, limit: number){
        await this.validarAcessoAoPaciente(pacienteId, usuarioId, tipoUsuario);

        return this.prismaService.diarioSintoma.findMany({
            where: { pacienteId },
            skip: (page - 1) * limit,
            take: limit,
            orderBy: { dataRegistro: 'desc' },
            include: { tags: { include: { tag: true } } },
        });
    }

    async getDiario(diarioId: string, pacienteId: string, usuarioId: string, tipoUsuario: TipoUsuario){
        await this.validarAcessoAoPaciente(pacienteId, usuarioId, tipoUsuario);

        const diario = await this.prismaService.diarioSintoma.findUnique({
            where: { id: diarioId },
            include: { tags: { include: { tag: true } } },
        });

        if(!diario || diario.pacienteId !== pacienteId){
            throw new NotFoundException('Registro do diário de sintomas não encontrado');
        }

        return diario;
    }

    private async validarAcessoAoPaciente(pacienteId: string, usuarioId: string, tipoUsuario: TipoUsuario){
        const pacienteAlvo = await this.prismaService.paciente.findUnique({ where: { id: pacienteId } });

        if(!pacienteAlvo){
            throw new NotFoundException('Paciente não encontrado');
        }

        if(tipoUsuario === TipoUsuario.admin){
            return;
        }

        if(tipoUsuario === TipoUsuario.paciente){
            if(pacienteAlvo.usuarioId !== usuarioId){
                throw new ForbiddenException('Você não tem permissão para acessar o diário deste paciente.');
            }
            return;
        }

        const profissional = await this.prismaService.profissional.findUnique({ where: { usuarioId } });

        if(!profissional || profissional.id !== pacienteAlvo.profissionalId){
            throw new ForbiddenException('Você não tem permissão para acessar o diário deste paciente.');
        }
    }
}
