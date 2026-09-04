import { Body, Controller, Get, Post, Request, UseGuards } from '@nestjs/common';
import { RefreshTokenDto, SignInDto, SignUpDto } from './dtos/auth';
import { AuthService } from './auth.service';
import { AuthGuard } from './auth.guard';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
    constructor(private authService: AuthService){}

    @ApiOperation({ summary: 'Endpoint para criar um novo usuário (Forçado como comum inicialmente)' })
    @Post('signup')
    async signup(@Body() body: SignUpDto){
        return this.authService.signUp(body);
    }
    
    @ApiOperation({ summary: 'Endpoint para fazer login' })
    @Post('signin')
    async signin(@Body() body: SignInDto, @Request() request){
        return this.authService.signIn(body, this.sessionMetadata(request));
    }

    @ApiOperation({ summary: 'Gera um token para recuperação de senha' })
    @ApiResponse({ description: 'Token de recuperação de senha gerado com sucesso' })
    @Post('esqueci-senha')
    async requestPasswordReset(@Body() body: RequestPasswordResetDto){
        return this.authService.requestPasswordReset(body);
    }

    @ApiOperation({ summary: 'Altera a senha usando um token de recuperação' })
    @ApiResponse({ description: 'Senha alterada com sucesso' })
    @Post('resetar-senha')
    async confirmPasswordReset(@Body() body: ConfirmPasswordResetDto){
        return this.authService.confirmPasswordReset(body);
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
    async refresh(@Body() body: RefreshTokenDto, @Request() request){
        return this.authService.refreshToken(body.refreshToken, this.sessionMetadata(request));
    }

    private sessionMetadata(request: any){
        return {
            userAgent: request.headers['user-agent'],
            ipAddress: request.ip,
        };
    }
}
