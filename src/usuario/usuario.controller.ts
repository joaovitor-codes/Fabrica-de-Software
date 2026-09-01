import { Body, Controller, UseGuards, Patch, Request, Get, Param, Delete, Post, ParseIntPipe } from '@nestjs/common';
import { UsuarioService } from './usuario.service';
import { ApiBearerAuth, ApiOperation, ApiTags, ApiOkResponse } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { CreateUsuarioDto, UpdateUsuarioDto } from './dtos/usuario';
import { Roles } from '../auth/roles.decorator';
import { TipoUsuario } from '@prisma/client';
import { RolesGuard } from '../auth/roles.guard';

@ApiTags('Usuários')
@ApiBearerAuth()
@UseGuards(AuthGuard, RolesGuard)
@Controller('api/usuarios')
export class UsuarioController {
    constructor(private usuarioService: UsuarioService) {}

    @ApiOperation({ summary: 'Atualiza as informações do usuário autenticado' })
    @ApiOkResponse({ description: 'Usuário atualizado com sucesso.' })
    @Patch('me') 
    async updateMe(@Request() request, @Body() updateUsuarioDto: UpdateUsuarioDto) {
        const userId = request.user.sub; 
        return this.usuarioService.update(userId, updateUsuarioDto);
    }

    @ApiOperation({ summary: 'Atualiza as informações de um usuário específico' })
    @ApiOkResponse({ description: 'Usuário atualizado com sucesso.' })
    @Roles(TipoUsuario.admin)
    @Patch('admin/:id')
    async updateByAdmin(@Param('id') id: string, @Body() updateUsuarioDto: UpdateUsuarioDto) {
        return this.usuarioService.updateByAdmin(id, updateUsuarioDto);
    }

    @ApiOperation({ summary: 'Obtém as informações de um usuário específico' })
    @ApiOkResponse({ description: 'Informações de um usúario.' })
    @Roles(TipoUsuario.admin)
    @Get(':id')
    async findOne(@Param('id') id: string){
        return this.usuarioService.findOne(id);
    }

    @ApiOperation({ summary: 'Obtém uma lista paginada de usuários' })
    @ApiOkResponse({ description: 'Lista de usuários.' })
    @Roles(TipoUsuario.admin)
    @Get('page/:page/limit/:limit')
    async findAll(@Param('page', ParseIntPipe) page: number = 1, @Param('limit', ParseIntPipe) limit: number = 10){
        return this.usuarioService.findAll(page, limit);
    }

    @ApiOperation({ summary: 'Remove um usuário específico' })
    @ApiOkResponse({ description: 'Usuário removido com sucesso.' })
    @Roles(TipoUsuario.admin)
    @Delete(':id')
    async remove(@Param('id') id: string){
        return this.usuarioService.remove(id);
    }

    @ApiOperation({ summary: 'Desativa um usuário específico' })
    @ApiOkResponse({ description: 'Usuário desativado com sucesso.' })
    @Post('desativar')
    async desativar(@Request() request){
        return this.usuarioService.desativar(request.user.sub);
    }

    @ApiOperation({ summary: 'Ativa um usuário específico' })
    @ApiOkResponse({ description: 'Usuário ativado com sucesso.' })
    @Roles(TipoUsuario.admin)
    @Post('ativar/:id')
    async ativar(@Param('id') id: string){
        return this.usuarioService.ativar(id);
    }

    @ApiOperation({ summary: 'Cria um novo usuário' })
    @ApiOkResponse({ description: "Usuario criado com sucesso."})
    @Roles(TipoUsuario.admin)
    @Post()
    async create(@Body() createUsuarioDto: CreateUsuarioDto) {
        return this.usuarioService.create(createUsuarioDto);
    }
}
