import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTelefoneDto, UpdateTelefoneDto } from './dtos/telefone';

@Injectable()
export class TelefoneService {
    constructor(private readonly prismaService: PrismaService) {}

    private validarDono(usuarioId?: string | null, clinicaId?: string | null): void {
        if (!!usuarioId === !!clinicaId) {
            throw new BadRequestException(
                'Informe exatamente um dono para o telefone: usuarioId ou clinicaId',
            );
        }
    }

    async create(dto: CreateTelefoneDto) {
        if (!dto) {
            throw new BadRequestException('Corpo da requisição inválido');
        }

        this.validarDono(dto.usuarioId, dto.clinicaId);

        return this.prismaService.telefone.create({
            data: {
                ddi: dto.ddi,
                numero: dto.numero,
                tipo: dto.tipo,
                principal: dto.principal,
                usuarioId: dto.usuarioId,
                clinicaId: dto.clinicaId,
            },
        });
    }

    async findAll(page: number = 1, limit: number = 10) {
        const skip = (page - 1) * limit;

        const [data, total] = await Promise.all([
            this.prismaService.telefone.findMany({
                skip,
                take: limit,
            }),
            this.prismaService.telefone.count(),
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

    async findByClinica(clinicaId: string, telefoneId: string) {
        return this.prismaService.telefone.findMany({
            where: {
                id: telefoneId,
                clinicaId: clinicaId
            },
        });
    }

    async findByUserId(usuarioId: string, telefoneId: string) {
        return this.prismaService.telefone.findMany({
            where: { 
                id: telefoneId,
                usuarioId: usuarioId,
            },
        });
    }

    async listarTelefones(usuarioId: string){
        return this.prismaService.telefone.findMany({
            where: {
                usuarioId: usuarioId
            }
        })
    }

    async findOne(id: string) {
        const telefone = await this.prismaService.telefone.findUnique({
            where: { id },
        });

        if (!telefone) {
            throw new NotFoundException('Telefone não encontrado');
        }

        return telefone;
    }

    async update(id: string, dto: UpdateTelefoneDto) {
        if (!dto) {
            throw new BadRequestException('Corpo da requisição inválido');
        }

        const telefone = await this.findOne(id);

        if (dto.usuarioId !== undefined || dto.clinicaId !== undefined) {
            const usuarioId = dto.usuarioId !== undefined ? dto.usuarioId : telefone.usuarioId;
            const clinicaId = dto.clinicaId !== undefined ? dto.clinicaId : telefone.clinicaId;
            this.validarDono(usuarioId, clinicaId);
        }

        return this.prismaService.telefone.update({
            where: { id },
            data: {
                ddi: dto.ddi,
                numero: dto.numero,
                tipo: dto.tipo,
                principal: dto.principal,
                usuarioId: dto.usuarioId,
                clinicaId: dto.clinicaId,
            },
        });
    }

    async remove(id: string): Promise<void> {
        await this.findOne(id);

        await this.prismaService.telefone.delete({
            where: { id },
        });
    }
}
