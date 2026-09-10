import { Body, Controller, UseGuards, Patch, Request, Get, Param, Delete, Post, ParseIntPipe, UnauthorizedException, ParseUUIDPipe, BadRequestException } from '@nestjs/common';
import { UsuarioService } from './usuario.service';
import { ApiBearerAuth, ApiCreatedResponse, ApiOperation, ApiTags, ApiOkResponse } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { CreateUsuarioDto, CreateUsuarioEnderecoDto, UpdateUsuarioDto } from './dtos/usuario';
import { Roles } from '../auth/roles.decorator';
import { TipoUsuario } from '@prisma/client';
import { RolesGuard } from '../auth/roles.guard';
import { EnderecoService } from '../endereco/endereco.service';
import { UpdateEnderecoDto } from '../endereco/dtos/endereco';
import { CreateTelefoneDto, UpdateTelefoneDto } from '../telefone/dtos/telefone';
import { TelefoneService } from '../telefone/telefone.service';

@ApiTags('Usuários')
@ApiBearerAuth()
@UseGuards(AuthGuard, RolesGuard)
@Controller('api/usuarios')
export class UsuarioController {
    constructor(
        private readonly usuarioService: UsuarioService,
        private readonly enderecoService: EnderecoService,
        private readonly telefoneService: TelefoneService,
    ) {}

    @ApiOperation({ summary: 'Cria um novo usuário' })
    @ApiOkResponse({ description: "Usuario criado com sucesso."})
    @Roles(TipoUsuario.admin)
    @Post()
    async create(@Body() createUsuarioDto: CreateUsuarioDto) {
        return this.usuarioService.create(createUsuarioDto);
    }

    @ApiOperation({ summary: 'Cria um endereço vinculado ao usuário autenticado' })
    @ApiCreatedResponse({ description: 'Endereço do usuário criado com sucesso.' })
    @Post('me/endereco')
    async adicionarMeuEndereco(@Request() request, @Body() createUsuarioEnderecoDto: CreateUsuarioEnderecoDto) {
        const userId = request.user.sub;

        return this.enderecoService.create({
            ...createUsuarioEnderecoDto,
            usuarioId: userId,
        });
    }

    @ApiOperation({ summary: 'Obtém os endereços do usuário autenticado' })
    @ApiOkResponse({ description: 'Endereços do usuário.' })
    @Get('me/enderecos')
    async meusEnderecos(@Request() request) {
        const userId = request.user.sub;
        return this.enderecoService.findByUserId(userId);
    }

    @ApiOperation({ summary: 'Atualiza as informações do usuário autenticado' })
    @ApiOkResponse({ description: 'Usuário atualizado com sucesso.' })
    @Patch('me') 
    async updateMe(@Request() request, @Body() updateUsuarioDto: UpdateUsuarioDto) {
        const userId = request.user.sub; 
        return this.usuarioService.update(userId, updateUsuarioDto);
    }

    @ApiOperation({ summary: 'Desativa um usuário específico' })
    @ApiOkResponse({ description: 'Usuário desativado com sucesso.' })
    @Post('desativar')
    async desativar(@Request() request){
        return this.usuarioService.desativar(request.user.sub);
    }

    @ApiOperation({ summary:'Lista todos os telefones do usuario autenticado.'})
    @ApiOkResponse({ description: 'Telefones listados com sucesso.'})
    @Get('me/telefone')
    async listarMeusTelefones(@Request() request){
        const userId = request.user.sub;
        return await this.telefoneService.listarTelefones(userId);
    }

    @ApiOperation({ summary: 'Adiciona um telefone ao usuario autenticado.' })
    @ApiCreatedResponse({ description: 'Novo telefone adicionado com sucesso.' })
    @Post('me/telefone')
    async adicionarMeuTelefone(@Request() request, @Body() createTelefoneDto: CreateTelefoneDto){
        const userId = request.user.sub;

        return await this.telefoneService.create({
            ...createTelefoneDto,
            usuarioId: userId
        })
    }

    @ApiOperation({ summary: 'Atualiza as informações de um usuário específico' })
    @ApiOkResponse({ description: 'Usuário atualizado com sucesso.' })
    @Roles(TipoUsuario.admin)
    @Patch('admin/:id')
    async updateByAdmin(@Param('id', new ParseUUIDPipe({version: '4', 
      errorHttpStatusCode: 400, 
      exceptionFactory: () => new BadRequestException('ID inválido')})) id: string, @Body() updateUsuarioDto: UpdateUsuarioDto) {
        return this.usuarioService.updateByAdmin(id, updateUsuarioDto);
    }

    @ApiOperation({ summary: 'Obtém as informações de um usuário específico' })
    @ApiOkResponse({ description: 'Informações de um usúario.' })
    @Roles(TipoUsuario.admin)
    @Get(':id')
    async findOne(@Param('id', new ParseUUIDPipe({version: '4', 
      errorHttpStatusCode: 400, 
      exceptionFactory: () => new BadRequestException('ID inválido')})) id: string){
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
    async remove(@Param('id', new ParseUUIDPipe({version: '4', 
      errorHttpStatusCode: 400, 
      exceptionFactory: () => new BadRequestException('ID inválido')})) id: string){
        return this.usuarioService.remove(id);
    }

    @ApiOperation({ summary: 'Ativa um usuário específico' })
    @ApiOkResponse({ description: 'Usuário ativado com sucesso.' })
    @Roles(TipoUsuario.admin)
    @Post('ativar/:id')
    async ativar(@Param('id', new ParseUUIDPipe({version: '4', 
      errorHttpStatusCode: 400, 
      exceptionFactory: () => new BadRequestException('ID inválido')})) id: string){
        return this.usuarioService.ativar(id);
    }

    @ApiOperation({ summary: 'Remove um endereço específico do usuário autenticado' })
    @ApiOkResponse({ description: 'Endereço removido com sucesso.'})
    @Delete('me/endereco/:enderecoId')
    async removerMeuEndereco(@Request() request, @Param('enderecoId', new ParseUUIDPipe({version: '4', 
      errorHttpStatusCode: 400, 
      exceptionFactory: () => new BadRequestException('ID inválido')})) enderecoId: string) {
        const userId = request.user.sub;
        const endereco = await this.enderecoService.findOne(enderecoId);

        if (endereco.usuarioId !== userId) {
            throw new UnauthorizedException('Você não tem permissão para remover este endereço.');
        }

        return this.enderecoService.remove(enderecoId);
    }

    @ApiOperation({ summary: 'Edita um endereço específico do usuário autenticado' })
    @ApiOkResponse({ description: 'Endereço editado com sucesso.'})
    @Patch('me/endereco/:enderecoId')
    async editarMeuEndereco(@Request() request, @Param('enderecoId', new ParseUUIDPipe({version: '4', 
      errorHttpStatusCode: 400, 
      exceptionFactory: () => new BadRequestException('ID inválido')})) enderecoId: string, @Body() updateEnderecoDto: UpdateEnderecoDto) {
        const userId = request.user.sub;
        const endereco = await this.enderecoService.findOne(enderecoId);
        
        if (endereco.usuarioId !== userId) {
            throw new UnauthorizedException('Você não tem permissão para editar este endereço.');
        }

        return this.enderecoService.update(enderecoId, updateEnderecoDto);
    }

    @ApiOperation({ summary: 'Remove um telefone do usuario autenticado.' })
    @ApiOkResponse({ description: 'Telefone removido com sucesso.' })
    @Delete('me/telefone/remover/:telefoneId')
    async removerMeuTelefone(@Request() request, @Param('telefoneId', new ParseUUIDPipe({version: '4', 
      errorHttpStatusCode: 400, 
      exceptionFactory: () => new BadRequestException('ID inválido')})) telefoneId: string){
        const userId = request.user.sub;
        const telefone = await this.telefoneService.findOne(telefoneId);

        if (telefone.usuarioId !== userId) {
            throw new UnauthorizedException('Você não tem permissão para remover este telefone.');
        }

        return await this.telefoneService.remove(telefoneId);
    }

    @ApiOperation({ summary:'Edita um telefone do usuario autenticado' })
    @ApiOkResponse({ description:'Telefone editado com sucesso' })
    @Patch('me/telefone/atualizar/:telefoneId')
    async editarMeuTelefone(@Request() request, @Param('telefoneId', new ParseUUIDPipe({version: '4', 
      errorHttpStatusCode: 400, 
      exceptionFactory: () => new BadRequestException('ID inválido')})) telefoneId: string, @Body() updateTelefoneDto: UpdateTelefoneDto){
        const userId = request.user.sub;
        const telefone = await this.telefoneService.findOne(telefoneId);

        if (telefone.usuarioId !== userId) {
            throw new UnauthorizedException('Você não tem permissão para editar este telefone.');
        }

        return await this.telefoneService.update(telefoneId, updateTelefoneDto);
    }

}
