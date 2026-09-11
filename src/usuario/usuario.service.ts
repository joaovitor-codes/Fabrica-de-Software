import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUsuarioDto, UpdateUsuarioDto } from './dtos/usuario';
import * as bcrypt from 'bcrypt';
import { TipoUsuario } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { CacheService } from '../cache/cache.service';

@Injectable()
export class UsuarioService {
    constructor(
        private prismaService: PrismaService,
        private jwtService: JwtService,
        private cacheService: CacheService
    ){}

    async userExists(userId: string): Promise<boolean> {
        const user = await this.prismaService.usuario.findFirst({
            where: {
                id: userId
            }
        });
        return !!user;
    }

    async create(data: CreateUsuarioDto){
        const hashedPassword = await bcrypt.hash(data.password, 10);
        
        const user = await this.prismaService.usuario.create({
            data:{
                nome: data.name,
                tipoUsuario: TipoUsuario.comum,
                dataNascimento: data.dataNascimento ? new Date(data.dataNascimento) : undefined,
                fotoPerfilUrl: data.fotoPerfilUrl,
                conta: {
                    create: {
                        email: data.email,
                        senhaHash: hashedPassword
                        },
                    },
                },
                include: {
                    conta: true
                },
            }) 
            return this.gerarToken(user);
    }


    async findAll(page: number = 1, limit: number = 10){
        const skip = ( page -1 ) * limit;

        const [data, total] = await Promise.all([
            this.prismaService.usuario.findMany({
                skip,
                take: limit,
                include: {
                    enderecos: true,
                }
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
            where: { id },
            include: {
                enderecos: true,
            }
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

        const updatedUser = await this.prismaService.usuario.update({
            where: { id },
            data: {
                ...updateUsuarioDto,
                dataNascimento: updateUsuarioDto.dataNascimento 
                    ? new Date(updateUsuarioDto.dataNascimento) 
                    : undefined,
            }
        });

        await this.cacheService.del(`auth:me:${id}`);
        return updatedUser;
    }

    async updateByAdmin(id: string, updateUsuarioDto: UpdateUsuarioDto){
        const usuario = await this.prismaService.usuario.findUnique({
            where: { id }
        });

        if(!usuario){
            throw new NotFoundException('Usuario não encontrado');
        }
        
        const updatedUser = await this.prismaService.usuario.update({
            where: { id },
            data: {
                ...updateUsuarioDto,
                dataNascimento: updateUsuarioDto.dataNascimento 
                    ? new Date(updateUsuarioDto.dataNascimento) 
                    : undefined,
            }
        });

        await this.cacheService.del(`auth:me:${id}`);
        return updatedUser;
    }

    async remove(id: string){
        const usuario = await this.prismaService.usuario.findUnique({
            where: { id }
        });
        
        if(!usuario){
            throw new NotFoundException('Usuario não encontrado');
        }

        const deletedUser = await this.prismaService.usuario.delete({
            where: { id }
        });

        await this.cacheService.del(`auth:me:${id}`);
        return deletedUser;
    }

    async desativar(id: string){
        const usuario = await this.prismaService.usuario.findUnique({
            where: { id }
        });

        if(!usuario){
            throw new NotFoundException('Usuario não encontrado');
        }
        
        const updatedAccount = await this.prismaService.conta.update({
            where: { id: usuario.contaId },
            data: {
                ativo: false
            }
        });

        await this.cacheService.del(`auth:me:${id}`);
        return updatedAccount;
    }

    async ativar(id: string){
        const usuario = await this.prismaService.usuario.findUnique({
            where: { id }
        });

        if(!usuario){
            throw new NotFoundException('Usuario não encontrado');
        }
        
        const updatedAccount = await this.prismaService.conta.update({
            where: { id: usuario.contaId },
            data: {
                ativo: true
            }
        });

        await this.cacheService.del(`auth:me:${id}`);
        return updatedAccount;
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

    private gerarToken(usuario: {id: string; tipoUsuario: TipoUsuario }, conta?: { id: string}){
        const payload = {
            sub: usuario.id,
            tipoUsuario: usuario.tipoUsuario,
        };
        return { accessToken: this.jwtService.sign(payload) }
    }
}

