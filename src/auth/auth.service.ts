import { Injectable, UnauthorizedException } from '@nestjs/common';
import { SignInDto, SignUpDto } from './dtos/auth';
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
import { createHash, randomBytes } from 'node:crypto';

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
            throw new UnauthorizedException("User is not active");
        }

        const passwordMatch = await bcrypt.compare(data.password, conta.senhaHash);

        if(!passwordMatch){
            throw new UnauthorizedException("credentials are not valid");
        }

        return this.gerarTokens(conta.usuario, conta, metadata);
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
}