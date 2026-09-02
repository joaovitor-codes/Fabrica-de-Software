import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateClinicaDto, UpdateClinicaDto } from './dtos/clinicas';

@Injectable()
export class ClinicasService {
    constructor(private readonly prismaService: PrismaService) {}

    async create(dto: CreateClinicaDto){
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
        await this.findOne(id);

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
}
