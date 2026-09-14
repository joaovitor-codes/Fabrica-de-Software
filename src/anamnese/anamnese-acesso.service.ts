import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AnamneseAcessoService {
    constructor(private readonly prismaService: PrismaService) {}

    async resolverProfissionalPorUsuario(usuarioId: string){
        const profissional = await this.prismaService.profissional.findUnique({
            where: { usuarioId },
        });

        if(!profissional){
            throw new NotFoundException('Você ainda não possui cadastro profissional');
        }

        return profissional;
    }

    async resolverAnamneseDoProfissional(anamneseId: string, usuarioId: string){
        const [anamnese, profissional] = await Promise.all([
            this.prismaService.anamnese.findUnique({ where: { id: anamneseId } }),
            this.resolverProfissionalPorUsuario(usuarioId),
        ]);

        if(!anamnese){
            throw new NotFoundException('Anamnese não encontrada');
        }

        if(anamnese.profissionalId !== profissional.id){
            throw new ForbiddenException('Você só pode gerenciar respostas de anamneses que você criou.');
        }

        return anamnese;
    }
}
