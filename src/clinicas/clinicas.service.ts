import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateClinicaDto, UpdateClinicaDto } from './dtos/clinicas';

@Injectable()
export class ClinicasService {
    constructor(private readonly prismaService: PrismaService) {}

    private validarCnpj(cnpj: string): void {
        const cleaned = cnpj.replace(/\D/g, '');

        if (cleaned.length !== 14 || /^(\d)\1{13}$/.test(cleaned)) {
            throw new BadRequestException('CNPJ inválido');
        }

        const calcularDigito = (base: string): number => {
            const pesos = base.length === 12
                ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
                : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
            const soma = base
                .split('')
                .reduce((acc, digito, index) => acc + Number(digito) * pesos[index], 0);
            const resto = soma % 11;
            return resto < 2 ? 0 : 11 - resto;
        };

        const base = cleaned.slice(0, 12);
        const digito1 = calcularDigito(base);
        const digito2 = calcularDigito(base + digito1);

        if (cleaned !== `${base}${digito1}${digito2}`) {
            throw new BadRequestException('CNPJ inválido');
        }
    }

    async create(dto: CreateClinicaDto){
        if(!dto){
            throw new BadRequestException('Corpo da requisição inválido');
        }

        if(dto.cnpj){
            this.validarCnpj(dto.cnpj);
        }

        try{
            return await this.prismaService.clinica.create({
                data:{
                    nome: dto.nome,
                    cnpj: dto.cnpj,
                    porte: dto.porte,
                },
            });
        }catch(error: any){
            if(error.code === 'P2002' && error.meta?.target?.includes('cnpj')) {
                throw new ConflictException('Já existe uma clínica cadastrada com este CNPJ');
            }
            throw error
        }
    }

    async findOne(id: string){
        const clinica = await this.prismaService.clinica.findUnique({
            where: { id },
        });
        
        if(!clinica){
            throw new NotFoundException('Clínica não encontrada');
        }

        return clinica;
    }

    async update(id: string, dto: UpdateClinicaDto){
        if(!dto){
            throw new BadRequestException('Corpo da requisição inválido');
        }

        await this.findOne(id);

        if(dto.cnpj){
            this.validarCnpj(dto.cnpj);
        }

        try{
            return await this.prismaService.clinica.update({
                where: { id },
                data: {
                    nome: dto.nome,
                    cnpj: dto.cnpj,
                    porte: dto.porte,
                },
            });
        }catch(error: any){
            if(error.code === 'P2002' && error.meta?.target?.includes('cnpj')) {
                throw new ConflictException('Já existe uma clínica cadastrada com este CNPJ');
            }
            throw error
        }


    }

    async findAll(page: number = 1, limit: number = 10){
        const skip = (page - 1) * limit;

        const [data, total] = await Promise.all([
            this.prismaService.clinica.findMany({
                skip,
                take: limit,
            }),
            this.prismaService.clinica.count(),
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

    async remove(id: string){
        await this.findOne(id);

        return this.prismaService.clinica.delete({
            where: { id },
        });
    }
}
