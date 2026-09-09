import { Body, Controller, Get, Post, Request, Res, UseGuards } from '@nestjs/common';
import {
    ConfirmPasswordResetDto,
    RefreshTokenDto,
    RequestPasswordResetDto,
    ResendEmailVerificationDto,
    SignInDto,
    SignUpDto,
    VerifyEmailDto,
} from './dtos/auth';
import { AuthService } from './auth.service';
import { AuthGuard } from './auth.guard';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';

const ACCESS_TOKEN_COOKIE = 'access_token';
const REFRESH_TOKEN_COOKIE = 'refresh_token';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
    constructor(private authService: AuthService){}

    @ApiOperation({ summary: 'Endpoint para criar um novo usuário (Forçado como comum inicialmente)' })
    @Post('signup')
    async signup(@Body() body: SignUpDto, @Res({ passthrough: true }) response: Response){
        const tokens = await this.authService.signUp(body);
        this.setAuthCookies(response, tokens);
        return tokens;
    }
    
    @Throttle({ default: { ttl: 900_000, limit: 5 } })
    @ApiOperation({ summary: 'Endpoint para fazer login' })
    @Post('signin')
    async signin(@Body() body: SignInDto, @Request() request, @Res({ passthrough: true }) response: Response){
        const tokens = await this.authService.signIn(body, this.sessionMetadata(request));
        this.setAuthCookies(response, tokens);
        return tokens;
    }

    @ApiOperation({ summary: 'Gera um token para recuperação de senha' })
    @ApiResponse({ description: 'Token de recuperação de senha gerado com sucesso' })
    @Post('esqueci-senha')
    async requestPasswordReset(@Body() body: RequestPasswordResetDto){
        return this.authService.requestPasswordReset(body);
    }

    @ApiOperation({ summary: 'Altera a senha usando um token de recuperação' })
    @ApiResponse({ description: 'Senha alterada com sucesso.' })
    @Post('resetar-senha')
    async confirmPasswordReset(@Body() body: ConfirmPasswordResetDto){
        return this.authService.confirmPasswordReset(body);
    }

    @ApiOperation({ summary: 'Confirma o e-mail do usuário usando o código de 6 dígitos enviado' })
    @ApiResponse({ status: 200, description: 'E-mail verificado com sucesso' })
    @Post('verificar-email')
    async verifyEmail(@Body() body: VerifyEmailDto){
        return this.authService.verifyEmail(body);
    }

    @ApiOperation({ summary: 'Reenvia o código de verificação de e-mail' })
    @ApiResponse({ status: 200, description: 'Código de verificação reenviado com sucesso' })
    @Post('reenviar-verificacao')
    async resendEmailVerification(@Body() body: ResendEmailVerificationDto){
        return this.authService.resendEmailVerification(body);
    }

    @ApiOperation({ summary: 'Endpoint para obter informações do usuário autenticado' })
    @UseGuards(AuthGuard)
    @Get('me')
    async me(@Request() request){
        return this.authService.me(request.user.sub);
    }


    @ApiOperation({ summary: 'Endpoint para atualizar o token de acesso'})
    @ApiResponse({ status: 200, description: 'Token atualizado com sucesso' })
    @Post('refresh')
    async refresh(@Body() body: RefreshTokenDto, @Request() request, @Res({ passthrough: true }) response: Response){
        const refreshToken = body.refreshToken || request.cookies?.[REFRESH_TOKEN_COOKIE];
        const tokens = await this.authService.refreshToken(refreshToken, this.sessionMetadata(request));
        this.setAuthCookies(response, tokens);
        return tokens;
    }

    @ApiOperation({ summary: 'Revoga a sessão associada ao refresh token' })
    @ApiResponse({ status: 200, description: 'Sessão revogada com sucesso' })
    @Post('logout')
    async logout(@Body() body: RefreshTokenDto, @Request() request, @Res({ passthrough: true }) response: Response){
        const refreshToken = body.refreshToken || request.cookies?.[REFRESH_TOKEN_COOKIE];
        const result = await this.authService.logout(refreshToken);
        response.clearCookie(ACCESS_TOKEN_COOKIE, this.cookieOptions());
        response.clearCookie(REFRESH_TOKEN_COOKIE, this.cookieOptions());
        return result;
    }

    private sessionMetadata(request: any){
        return {
            userAgent: request.headers['user-agent'],
            ipAddress: request.ip,
        };
    }

    private setAuthCookies(response: Response, tokens: { accessToken: string; refreshToken: string }){
        response.cookie(ACCESS_TOKEN_COOKIE, tokens.accessToken, this.cookieOptions());
        response.cookie(REFRESH_TOKEN_COOKIE, tokens.refreshToken, this.cookieOptions());
    }

    private cookieOptions(){
        return {
            httpOnly: true,
            sameSite: 'lax' as const,
            secure: process.env.NODE_ENV === 'production',
            path: '/',
        };
    }
}
