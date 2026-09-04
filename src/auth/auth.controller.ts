import { Body, Controller, Get, Post, Request, UseGuards } from '@nestjs/common';
import {
    ConfirmPasswordResetDto,
    RequestPasswordResetDto,
    SignInDto,
    SignUpDto,
} from './dtos/auth';
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
    async signin(@Body() body: SignInDto){
        return this.authService.signIn(body);
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

}
