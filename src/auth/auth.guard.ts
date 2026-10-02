import {CanActivate, ExecutionContext, Injectable, UnauthorizedException} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Request as ExpressRequest } from 'express';
import { PrismaService } from '../common/prisma/prisma.service';
import { JwtPayload, RequestAutenticado } from './auth.types';

@Injectable()
export class AuthGuard implements CanActivate {
    constructor(private jwtService: JwtService, private configService: ConfigService, private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestAutenticado>();

    const token = this.extractToken(request);

    if (!token) {
        throw new UnauthorizedException();
    }

    try{
        const payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
        secret: this.configService.get<string>('JWT_SECRET'),
      });

        if (payload.tokenType !== 'access') {
          throw new UnauthorizedException();
        }
        const user = await this.prisma.usuario.findUnique({
          where: { id: payload.sub },
        });
        if (!user) {
          throw new UnauthorizedException();
        }

        request.user = { ...user, sub: user.id };
    }catch {
        throw new UnauthorizedException();
    }

    return true;
  }

  private extractToken(request: ExpressRequest): string | undefined {
    const cookies = request.cookies as Record<string, string | undefined> | undefined;
    const cookieToken = cookies?.access_token;
    if (cookieToken) {
      return cookieToken;
    }

    const [type, token] = request.headers['authorization']?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}