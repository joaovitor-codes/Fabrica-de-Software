import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateUsuarioDto } from './dtos/usuario';

@Injectable()
export class UsuarioService {
    constructor(private prismaService: PrismaService){}

    async findAll(page: number = 1, limit: number = 10){
        const skip = ( page -1 ) * limit;

        const [data, total] = await Promise.all([
            this.prismaService.usuario.findMany({
                skip,
                take: limit,
            }),
            this.prismaService.usuario.count(),
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

    async findOne(id: string){
        const usuario = await this.prismaService.usuario.findUnique({
            where: { id }
        });
        
        if(!usuario){
            throw new NotFoundException('Usuario não encontrado');
        }
        return usuario;
    }

    async update(id: string, updateUsuarioDto: UpdateUsuarioDto){
        const usuario = await this.prismaService.usuario.findUnique({
            where: { id }
        });
        
        if(!usuario){
            throw new NotFoundException('Usuario não encontrado');
        }

        if(!(await this.isAtivo(id))){
            throw new UnauthorizedException('Usuario está desativado');
        }

        return this.prismaService.usuario.update({
            where: { id },
            data: {
                ...updateUsuarioDto,
                dataNascimento: updateUsuarioDto.dataNascimento 
                    ? new Date(updateUsuarioDto.dataNascimento) 
                    : undefined,
            }
        });
    }

    async updateByAdmin(id: string, updateUsuarioDto: UpdateUsuarioDto){
        const usuario = await this.prismaService.usuario.findUnique({
            where: { id }
        });

        if(!usuario){
            throw new NotFoundException('Usuario não encontrado');
        }
        
        return this.prismaService.usuario.update({
            where: { id },
            data: {
                ...updateUsuarioDto,
                dataNascimento: updateUsuarioDto.dataNascimento 
                    ? new Date(updateUsuarioDto.dataNascimento) 
                    : undefined,
            }
        });
    }

    async remove(id: string){
        const usuario = await this.prismaService.usuario.findUnique({
            where: { id }
        });
        
        if(!usuario){
            throw new NotFoundException('Usuario não encontrado');
        }

        return this.prismaService.usuario.delete({
            where: { id }
        });
    }

    async desativar(id: string){
        const usuario = await this.prismaService.usuario.findUnique({
            where: { id }
        });

        if(!usuario){
            throw new NotFoundException('Usuario não encontrado');
        }
        
        return this.prismaService.conta.update({
            where: { id: usuario.contaId },
            data: {
                ativo: false
            }
        });
    }

    async ativar(id: string){
        const usuario = await this.prismaService.usuario.findUnique({
            where: { id }
        });

        if(!usuario){
            throw new NotFoundException('Usuario não encontrado');
        }
        
        return this.prismaService.conta.update({
            where: { id: usuario.contaId },
            data: {
                ativo: true
            }
        });
    }

    async isAtivo(id: string): Promise<boolean> {
        const usuario = await this.prismaService.usuario.findUnique({
            where: { id },
            include: {
                conta: true
            }
        });

        if(!usuario){
            throw new NotFoundException('Usuario não encontrado');
        }

        return usuario.conta.ativo;
    }
}

