import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRestricaoAlimentarDto, UpdateRestricaoAlimentarDto } from './dtos/restricao-alimentar';
import { IngredienteService } from '../ingrediente/ingrediente.service';

@Injectable()
export class RestricaoAlimentarService {
    constructor(private readonly prismaService: PrismaService, private readonly ingredienteService: IngredienteService) {}

    async create(dto: CreateRestricaoAlimentarDto) {
        try {
            return await this.prismaService.restricaoAlimentar.create({
                data: {
                    nome: dto.nome,
                    tipo: dto.tipo,
                    descricao: dto.descricao,
                },
            });
        } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
                throw new ConflictException('Já existe uma restrição alimentar com esse nome');
            }
            throw error;
        }
    }

    async findAll(page: number = 1, limit: number = 10) {
        const skip = (page - 1) * limit;

        const [data, total] = await Promise.all([
            this.prismaService.restricaoAlimentar.findMany({
                skip,
                take: limit,
            }),
            this.prismaService.restricaoAlimentar.count(),
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

    async findOne(id: string) {
        const restricao = await this.prismaService.restricaoAlimentar.findUnique({
            where: { id },
        });

        if (!restricao) {
            throw new NotFoundException('Restrição alimentar não encontrada');
        }

        return restricao;
    }

    async update(id: string, dto: UpdateRestricaoAlimentarDto) {
        await this.findOne(id);

        try {
            return await this.prismaService.restricaoAlimentar.update({
                where: { id },
                data: {
                    nome: dto.nome,
                    tipo: dto.tipo,
                    descricao: dto.descricao,
                },
            });
        } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
                throw new ConflictException('Já existe uma restrição alimentar com esse nome');
            }
            throw error;
        }
    }

    async remove(id: string): Promise<void> {
        await this.findOne(id);

        try {
            await this.prismaService.restricaoAlimentar.delete({
                where: { id },
            });
        } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
                throw new ConflictException(
                    'Não é possível remover: existem pacientes, ingredientes ou campanhas vinculados a esta restrição alimentar',
                );
            }
            throw error;
        }
    }

    async ingredienteEhCompativel(ingredienteId: string, restricaoId: string): Promise<boolean> {
        const ingrediente = await this.prismaService.ingrediente.findUnique({
            where: { id: ingredienteId },
            include: { restricoes: true },
        })

        if (!ingrediente) {
            throw new NotFoundException('Ingrediente não encontrado');
        }

        const restricaos = ingrediente.restricoes;

        if(restricaos.some((r) => r.ingredienteId === restricaoId)) {
            return false;
        }

        return true;
    }
}
