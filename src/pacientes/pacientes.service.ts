import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TipoUsuario } from '@prisma/client';
import { UpdatePacienteDto } from './dtos/pacientes';
import { CreatePacienteDto } from './dtos/pacientes';

@Injectable()
export class PacientesService {
    constructor(private prismaService: PrismaService) {}

    async createPaciente(CreatePacienteDto: CreatePacienteDto) {
        await this.prismaService.usuario.update({
            where: { id: CreatePacienteDto.userId },
            data: { tipoUsuario: TipoUsuario.paciente },
        });

        const paciente = await this.prismaService.paciente.create({
            data: {
                usuarioId: CreatePacienteDto.userId,
                profissionalId: CreatePacienteDto.profissionalId,
            },
        });

        if (!paciente) {
            await this.prismaService.usuario.update({
                where: { id: CreatePacienteDto.userId },
                data: { tipoUsuario: TipoUsuario.comum },
            });
            throw new NotFoundException('Erro ao criar paciente');
        }

        return paciente;
    }

    async getPacienteByUserId(userId: string) {
        const paciente = await this.prismaService.paciente.findUnique({
            where: { usuarioId: userId },
            include: {
                usuario: true,
                profissional: true,
            },
        });
        
        if (!paciente) {
            throw new NotFoundException('Paciente não encontrado');
        }

        return paciente;
    }

    async findAll(page: number, limit: number){
        const skip = ( page -1 ) * limit;

        const [data, total] = await Promise.all([
            this.prismaService.paciente.findMany({
                skip,
                take: limit,
                include: {
                    usuario: true,
                    profissional: true,
                },
            }),
            this.prismaService.paciente.count(),
        ]);
        
        return {
            data,
            meta:{
                total,
                page,
                last_page: Math.ceil(total / limit),
                limit
            }
        };
    }

    async updatePaciente(UpdatePacienteDto: UpdatePacienteDto, userId: string) {
        const paciente = await this.prismaService.paciente.update({
            where: { usuarioId: userId },
            data: UpdatePacienteDto,
        });

        if (!paciente) {
            throw new NotFoundException('Paciente não encontrado');
        }

        return paciente;
    }

    async deletePaciente(userId: string) {
        const paciente = await this.prismaService.paciente.delete({
            where: { usuarioId: userId },
        });
        
        if (!paciente) {
            throw new NotFoundException('Paciente não encontrado');
        }

        const user = await this.prismaService.usuario.update({
            where: { id: userId },
            data: { tipoUsuario: TipoUsuario.comum },
        });

        if (!user) {
            throw new NotFoundException('Usuário não encontrado');
        }
    }

}
