import { Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import {
    ConfirmPasswordResetDto,
    RequestPasswordResetDto,
    ResetPasswordDto,
    SignInDto,
    SignUpDto,
} from './dtos/auth';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { MailerService } from '@nestjs-modules/mailer';
import { TipoUsuario } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';

@Injectable()
export class AuthService {
    constructor(
        private prismaService: PrismaService,
        private jwtService: JwtService,
        private mailerService: MailerService,
    ){}

    private userAlreadyExist(email: string){
        return this.prismaService.conta.findUnique({
            where:{
                email: email
            },
            include: {
                usuario: true
            }
        });
    }

    async signUp(data: SignUpDto){
        if(await this.userAlreadyExist(data.email)){
            throw new UnauthorizedException("User already exist");
        }

        const hashedPassword = await bcrypt.hash(data.password, 10);

        const user = await this.prismaService.usuario.create({
            data:{
                nome: data.name,
                tipoUsuario: TipoUsuario.comum,
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

    async signIn(data: SignInDto){
        const conta = await this.prismaService.conta.findUnique({
            where: {
                email: data.email
            },
            include: {
                usuario: true
            }
        });

        if(!conta || !conta.usuario){
            throw new UnauthorizedException("credentials are not valid");
        }

        if(!conta.ativo){
            throw new UnauthorizedException("User is not active");
        }

        const passwordMatch = await bcrypt.compare(data.password, conta.senhaHash);

        if(!passwordMatch){
            throw new UnauthorizedException("credentials are not valid");
        }

        const tokens = this.gerarToken(conta.usuario, conta);

        return { accessToken: tokens.accessToken };
    }

    async requestPasswordReset(data: RequestPasswordResetDto){
        const conta = await this.prismaService.conta.findUnique({
            where: { email: data.email },
        });

        if(!conta || !conta.ativo){
            return { message: 'Se o e-mail existir, um token de recuperação será gerado' };
        }

        const token = randomBytes(32).toString('hex');
        const tokenHash = createHash('sha256').update(token).digest('hex');
        const expiraEm = new Date(Date.now() + 60 * 60 * 1000);

        await this.prismaService.tokenResetSenha.create({
            data: {
                contaId: conta.id,
                token: tokenHash,
                expiraEm,
            },
        });

        try {
            await this.mailerService.sendMail({
                to: conta.email,
                subject: 'Recuperação de senha - Nutrify',
                text: `Seu código de recuperação de senha é: ${token}. Ele expira em 1 hora.`,
                html: `<p>Seu código de recuperação de senha é:</p><p><strong>${token}</strong></p><p>Ele expira em 1 hora.</p>`,
            });
        } catch {
            await this.prismaService.tokenResetSenha.deleteMany({
                where: { token: tokenHash, usadoEm: null },
            });
            throw new ServiceUnavailableException('Não foi possível enviar o e-mail de recuperação');
        }

        return { message: 'Se o e-mail existir, um código de recuperação será enviado' };
    }

    async confirmPasswordReset(data: ConfirmPasswordResetDto){
        const tokenHash = createHash('sha256').update(data.token).digest('hex');
        const resetToken = await this.prismaService.tokenResetSenha.findFirst({
            where: {
                token: tokenHash,
                usadoEm: null,
                expiraEm: { gt: new Date() },
                conta: { ativo: true },
            },
        });

        if(!resetToken){
            throw new UnauthorizedException('Token de recuperação inválido ou expirado');
        }

        const senhaHash = await bcrypt.hash(data.newPassword, 10);
        const usadoEm = new Date();

        await this.prismaService.$transaction(async (transaction) => {
            const updatedToken = await transaction.tokenResetSenha.updateMany({
                where: {
                    id: resetToken.id,
                    usadoEm: null,
                },
                data: { usadoEm },
            });

            if(updatedToken.count !== 1){
                throw new UnauthorizedException('Token de recuperação inválido ou expirado');
            }

            await transaction.conta.update({
                where: { id: resetToken.contaId },
                data: { senhaHash },
            });
        });

        return { message: 'Password updated successfully' };
    }

    async me(userId: string){
        const user = await this.prismaService.usuario.findUnique({
            where: {
                id: userId
            },
            include: {
                conta: true
            }
        })

        if(!user){
            throw new UnauthorizedException("User not found");
        }

        const { senhaHash, ...userWithoutPassword } = user.conta;

        return {
            ...user,
            conta: userWithoutPassword
        };
    }

    private gerarToken(usuario: {id: string; tipoUsuario: TipoUsuario }, conta?: { id: string}){
        const payload = {
            sub: usuario.id,
            tipoUsuario: usuario.tipoUsuario,
        };
        return { accessToken: this.jwtService.sign(payload) }
    }

    async resetPassword(userId: string, data: ResetPasswordDto){
        const user = await this.prismaService.usuario.findUnique({
            where: {
                id: userId
            },
            include: {
                conta: true
            }
        });

        if(!user || !user.conta){
            throw new UnauthorizedException("User not found");
        }

        const passwordMatch = await bcrypt.compare(data.currentPassword, user.conta.senhaHash);

        if(!passwordMatch){
            throw new UnauthorizedException("Current password is not valid");
        }

        if(data.currentPassword === data.newPassword){
            return { error: "New password cannot be the same as the current password" };
        }

        const hashedPassword = await bcrypt.hash(data.newPassword, 10);

        await this.prismaService.conta.update({
            where: {
                id: user.conta.id
            },
            data: {
                senhaHash: hashedPassword
            }
        });

        return { message: "Password updated successfully" };
    }
}