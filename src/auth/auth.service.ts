import { HttpException, HttpStatus, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import {
    ConfirmPasswordResetDto,
    RequestPasswordResetDto,
    ResendEmailVerificationDto,
    ResetPasswordDto,
    SignInDto,
    SignUpDto,
    VerifyEmailDto,
} from './dtos/auth';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';

type SessionMetadata = {
    userAgent?: string;
    ipAddress?: string;
};
import { MailerService } from '@nestjs-modules/mailer';
import { TipoUsuario } from '@prisma/client';
import { createHash, randomBytes, randomInt } from 'node:crypto';

@Injectable()
export class AuthService {
    constructor(
        private prismaService: PrismaService,
        private jwtService: JwtService,
        private configService: ConfigService,
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

        try {
            await this.sendVerificationCode(user.conta);
        } catch {
            // Não bloqueia o cadastro caso o envio do e-mail de verificação falhe.
            // O usuário pode solicitar um novo código pelo endpoint de reenvio.
        }

        return this.gerarTokens(user, user.conta);
    }

    async signIn(data: SignInDto, metadata: SessionMetadata = {}){
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
            throw new UnauthorizedException("User is not active.");
        }

        const passwordMatch = await bcrypt.compare(data.password, conta.senhaHash);

        if(!passwordMatch){
            throw new UnauthorizedException("credentials are not valid");
        }

        return this.gerarTokens(conta.usuario, conta, metadata);
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

    async verifyEmail(data: VerifyEmailDto){
        const conta = await this.prismaService.conta.findUnique({
            where: { email: data.email },
        });

        if(!conta){
            throw new UnauthorizedException('Código de verificação inválido ou expirado');
        }

        if(conta.emailVerificado){
            return { message: 'E-mail já verificado' };
        }

        const codeHash = createHash('sha256').update(data.code).digest('hex');

        const verificationToken = await this.prismaService.tokenVerificacaoEmail.findFirst({
            where: {
                contaId: conta.id,
                token: codeHash,
                usadoEm: null,
                expiraEm: { gt: new Date() },
            },
        });

        if(!verificationToken){
            throw new UnauthorizedException('Código de verificação inválido ou expirado');
        }

        const usadoEm = new Date();

        await this.prismaService.$transaction(async (transaction) => {
            const updatedToken = await transaction.tokenVerificacaoEmail.updateMany({
                where: {
                    id: verificationToken.id,
                    usadoEm: null,
                },
                data: { usadoEm },
            });

            if(updatedToken.count !== 1){
                throw new UnauthorizedException('Código de verificação inválido ou expirado');
            }

            await transaction.conta.update({
                where: { id: conta.id },
                data: { emailVerificado: true, emailVerificadoEm: usadoEm },
            });
        });

        return { message: 'E-mail verificado com sucesso' };
    }

    async resendEmailVerification(data: ResendEmailVerificationDto){
        const conta = await this.prismaService.conta.findUnique({
            where: { email: data.email },
        });

        if(!conta){
            throw new UnauthorizedException('Conta não encontrada');
        }

        if(conta.emailVerificado){
            return { message: 'E-mail já verificado' };
        }

        const windowStartedAt = new Date(
            Date.now() - this.emailVerificationResendWindowMinutes() * 60 * 1000,
        );
        const recentCodes = await this.prismaService.tokenVerificacaoEmail.count({
            where: { contaId: conta.id, createdAt: { gte: windowStartedAt } },
        });

        if(recentCodes >= this.emailVerificationMaxResendAttempts()){
            throw new HttpException(
                'Muitas tentativas de reenvio. Tente novamente mais tarde.',
                HttpStatus.TOO_MANY_REQUESTS,
            );
        }

        await this.sendVerificationCode(conta);

        return { message: 'Código de verificação reenviado com sucesso' };
    }

    private generateVerificationCode(){
        return randomInt(0, 1_000_000).toString().padStart(6, '0');
    }

    private async sendVerificationCode(conta: { id: string; email: string }){
        const code = this.generateVerificationCode();
        const codeHash = createHash('sha256').update(code).digest('hex');
        const expiraEm = new Date(
            Date.now() + this.emailVerificationCodeExpiresMinutes() * 60 * 1000,
        );

        await this.prismaService.tokenVerificacaoEmail.create({
            data: {
                contaId: conta.id,
                token: codeHash,
                expiraEm,
            },
        });

        try {
            await this.mailerService.sendMail({
                to: conta.email,
                subject: 'Verificação de e-mail - Nutrify',
                text: `Seu código de verificação é: ${code}. Ele expira em ${this.emailVerificationCodeExpiresMinutes()} minutos.`,
                html: `<p>Seu código de verificação é:</p><p><strong>${code}</strong></p><p>Ele expira em ${this.emailVerificationCodeExpiresMinutes()} minutos.</p>`,
            });
        } catch {
            await this.prismaService.tokenVerificacaoEmail.deleteMany({
                where: { token: codeHash, usadoEm: null },
            });
            throw new ServiceUnavailableException('Não foi possível enviar o e-mail de verificação');
        }
    }

    private emailVerificationCodeExpiresMinutes(){
        return this.configService.get<number>('EMAIL_VERIFICATION_CODE_EXPIRES_MINUTES', 15);
    }

    private emailVerificationMaxResendAttempts(){
        return this.configService.get<number>('EMAIL_VERIFICATION_MAX_RESEND_ATTEMPTS', 3);
    }

    private emailVerificationResendWindowMinutes(){
        return this.configService.get<number>('EMAIL_VERIFICATION_RESEND_WINDOW_MINUTES', 15);
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

    private async gerarTokens(
        usuario: { id: string; tipoUsuario: TipoUsuario },
        conta: { id: string },
        metadata: SessionMetadata = {},
        sessionId?: string,
    ){
        const currentSessionId = sessionId || randomUUID();
        const payload = {
            sub: usuario.id,
            tipoUsuario: usuario.tipoUsuario,
            tokenType: 'access',
        };
        const accessToken = this.jwtService.sign(payload, {
            expiresIn: (this.configService.get<string>('JWT_EXPIRES_IN') || '1h') as any,
        });
        const refreshToken = this.jwtService.sign({
            sub: usuario.id,
            tokenType: 'refresh',
            sid: currentSessionId,
        }, {
            expiresIn: (this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') || '7d') as any,
        });
        const decodedRefresh = this.jwtService.decode(refreshToken) as { exp: number };
        const sessionData = {
            refreshTokenHash: await bcrypt.hash(refreshToken, 10),
            expiraEm: new Date(decodedRefresh.exp * 1000),
            userAgent: metadata.userAgent,
            ipAddress: metadata.ipAddress,
        };

        if (sessionId) {
            await this.prismaService.sessao.update({ where: { id: sessionId }, data: sessionData });
        } else {
            await this.prismaService.sessao.create({
                data: { ...sessionData, id: currentSessionId, contaId: conta.id },
            });
        }

        return { accessToken, refreshToken };
    }

    async refreshToken(refreshToken: string, metadata: SessionMetadata = {}){
        let payload: { sub: string; sid?: string; tokenType?: string };
        try {
            payload = await this.jwtService.verifyAsync(refreshToken, {
                secret: this.configService.get<string>('JWT_SECRET'),
            });
        } catch {
            throw new UnauthorizedException('Refresh token inválido');
        }

        if (payload.tokenType !== 'refresh' || !payload.sid) {
            throw new UnauthorizedException('Refresh token inválido');
        }

        const session = await this.prismaService.sessao.findUnique({
            where: { id: payload.sid },
            include: { conta: { include: { usuario: true } } },
        });
        if (
            !session ||
            session.revogadoEm ||
            session.expiraEm <= new Date() ||
            !session.conta.ativo ||
            !session.conta.usuario ||
            !(await bcrypt.compare(refreshToken, session.refreshTokenHash))
        ) {
            throw new UnauthorizedException('Refresh token inválido');
        }

        return this.gerarTokens(session.conta.usuario, session.conta, metadata, session.id);
    }

    async logout(refreshToken: string){
        let payload: { sid?: string; tokenType?: string };
        try {
            payload = await this.jwtService.verifyAsync(refreshToken, {
                secret: this.configService.get<string>('JWT_SECRET'),
            });
        } catch {
            throw new UnauthorizedException('Refresh token inválido');
        }

        if (payload?.tokenType !== 'refresh' || !payload.sid) {
            throw new UnauthorizedException('Refresh token inválido');
        }

        const session = await this.prismaService.sessao.findUnique({
            where: { id: payload.sid },
        });

        if (!session || !(await bcrypt.compare(refreshToken, session.refreshTokenHash))) {
            throw new UnauthorizedException('Refresh token inválido');
        }

        await this.prismaService.sessao.updateMany({
            where: {
                id: session.id,
                revogadoEm: null,
            },
            data: { revogadoEm: new Date() },
        });

        return { message: 'Logout realizado com sucesso' };
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
