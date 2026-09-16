import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTagSintomaDto, UpdateTagSintomaDto } from './dtos/tag-sintoma';

@Injectable()
export class TagSintomasService {
    constructor(private readonly prismaService: PrismaService) {}

    async create (data: CreateTagSintomaDto){
        try{
            return await this.prismaService.tagSintoma.create({
            data: {
                nome: data.nome
            }
        })
        }catch (error){
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
                throw new ConflictException('Já existe uma tag de sintoma com esse nome');
            }
            throw error;
        }
    }

    async findOne(id: string){
        const tagSintoma = await this.prismaService.tagSintoma.findUnique({
            where: {
                id: id
            }
        })

        if(!tagSintoma){
            throw new NotFoundException('Tag Sintoma não encontrada')
        }

        return tagSintoma
    }

    async findAll(){
        return await this.prismaService.tagSintoma.findMany()
    }

    async update(id: string, data: UpdateTagSintomaDto){
        const tagSintoma = await this.prismaService.tagSintoma.findUnique({
            where: {
                id: id
            }
        })

        if(!tagSintoma){
            throw new NotFoundException('Tag Sintoma não encontrada')
        }

        try{
            return await this.prismaService.tagSintoma.update({
                where: {
                    id: id
                },
                data: {
                    nome: data.nome
                }
            })
        }catch (error){
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
                throw new ConflictException('Já existe uma tag de sintoma com esse nome');
            }
            throw error;
        }
    }

    async delete(id: string){
        const tagSintoma = await this.prismaService.tagSintoma.findUnique({
            where: {
                id: id
            }
        })
        
        if(!tagSintoma){
            throw new NotFoundException('Tag Sintoma não encontrada')
        }

        try{
            return await this.prismaService.tagSintoma.delete({
                where: {
                    id: id
                }
            })
        }catch (error){
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
                throw new ConflictException(
                    'Não é possível remover: existem registros de diário de sintomas vinculados a esta tag',
                );
            }
            throw error;
        }
    }

}
