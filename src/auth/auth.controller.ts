import { Body, Controller, Get, Post, Request, UseGuards } from '@nestjs/common';
import { SignInDto, SignUpDto } from './dtos/auth';
import { AuthService } from './auth.service';
import { AuthGuard } from './auth.guard';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

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

    @ApiOperation({ summary: 'Endpoint para obter informações do usuário autenticado' })
    @UseGuards(AuthGuard)
    @Get('me')
    async me(@Request() request){
        return this.authService.me(request.user.sub);
    }
}
