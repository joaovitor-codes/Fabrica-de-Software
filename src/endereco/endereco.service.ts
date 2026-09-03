import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEnderecoDto, UpdateEnderecoDto } from './dtos/endereco';

@Injectable()
export class EnderecoService {
    constructor(private readonly prismaService: PrismaService) {}

    private validarDono(usuarioId?: string | null, clinicaId?: string | null): void {
        if (!!usuarioId === !!clinicaId) {
            throw new BadRequestException(
                'Informe exatamente um dono para o endereço: usuarioId ou clinicaId',
            );
        }
    }

    async create(dto: CreateEnderecoDto) {
        if (!dto) {
            throw new BadRequestException('Corpo da requisição inválido');
        }

        this.validarDono(dto.usuarioId, dto.clinicaId);

        return this.prismaService.endereco.create({
            data: {
                cep: dto.cep,
                logradouro: dto.logradouro,
                numero: dto.numero,
                complemento: dto.complemento,
                bairro: dto.bairro,
                cidade: dto.cidade,
                estado: dto.estado,
                pais: dto.pais,
                principal: dto.principal,
                usuarioId: dto.usuarioId,
                clinicaId: dto.clinicaId,
            },
        });
    }

    async findAll(page: number = 1, limit: number = 10) {
        const skip = (page - 1) * limit;

        const [data, total] = await Promise.all([
            this.prismaService.endereco.findMany({
                skip,
                take: limit,
            }),
            this.prismaService.endereco.count(),
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

    async findByClinica(clinicaId: string) {
        return this.prismaService.endereco.findMany({
            where: { clinicaId },
        });
    }

    async findOne(id: string) {
        const endereco = await this.prismaService.endereco.findUnique({
            where: { id },
        });

        if (!endereco) {
            throw new NotFoundException('Endereço não encontrado');
        }

        return endereco;
    }

    async update(id: string, dto: UpdateEnderecoDto) {
        if (!dto) {
            throw new BadRequestException('Corpo da requisição inválido');
        }

        const endereco = await this.findOne(id);

        if (dto.usuarioId !== undefined || dto.clinicaId !== undefined) {
            const usuarioId = dto.usuarioId !== undefined ? dto.usuarioId : endereco.usuarioId;
            const clinicaId = dto.clinicaId !== undefined ? dto.clinicaId : endereco.clinicaId;
            this.validarDono(usuarioId, clinicaId);
        }

        return this.prismaService.endereco.update({
            where: { id },
            data: {
                cep: dto.cep,
                logradouro: dto.logradouro,
                numero: dto.numero,
                complemento: dto.complemento,
                bairro: dto.bairro,
                cidade: dto.cidade,
                estado: dto.estado,
                pais: dto.pais,
                principal: dto.principal,
                usuarioId: dto.usuarioId,
                clinicaId: dto.clinicaId,
            },
        });
    }

    async remove(id: string) {
        await this.findOne(id);

        return this.prismaService.endereco.delete({
            where: { id },
        });
    }
}
