import { BadRequestException, Body, Controller, Delete, Get, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AnamneseService } from './anamnese.service';
import { AnamnesePerguntaService } from './anamnese-pergunta.service';
import { AnamneseOpcaoService } from './anamnese-opcao.service';
import { AnamneseRespostaService } from './anamnese-resposta.service';
import {
    createAnamneseDto,
    createAnamneseOpcaoalDto,
    createAnamnesePerguntaDto,
    createAnamneseRespostaDto,
    updateAnamneseOpcaoalDto,
    updateAnamnesePerguntaDto,
    updateAnamneseRespostaDto,
} from './dtos/anamnese';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { TipoUsuario } from '@prisma/client';

const uuidPipe = (mensagem: string) => new ParseUUIDPipe({
    version: '4',
    errorHttpStatusCode: 400,
    exceptionFactory: () => new BadRequestException(mensagem),
});

@ApiTags('Anamnese')
@ApiBearerAuth()
@UseGuards(AuthGuard, RolesGuard)
@Controller('api/anamnese')
export class AnamneseController {
    constructor(
        private readonly anamneseService: AnamneseService,
        private readonly anamnesePerguntaService: AnamnesePerguntaService,
        private readonly anamneseOpcaoService: AnamneseOpcaoService,
        private readonly anamneseRespostaService: AnamneseRespostaService,
    ) {}

    /*
        PERGUNTAS (template global, escrita só admin, leitura livre para autenticados)
    */

    @ApiOperation({ summary: 'Cria uma nova pergunta de anamnese' })
    @ApiCreatedResponse({ description: 'Pergunta criada com sucesso.' })
    @Roles(TipoUsuario.admin)
    @Post('perguntas')
    async criarPergunta(@Body() dto: createAnamnesePerguntaDto) {
        return this.anamnesePerguntaService.createAnamnesePergunta(dto);
    }

    @ApiOperation({ summary: 'Lista as perguntas ativas da anamnese, paginadas' })
    @ApiOkResponse({ description: 'Lista de perguntas da anamnese.' })
    @Get('perguntas/page/:page/limit/:limit')
    async listarPerguntas(
        @Param('page', ParseIntPipe) page: number,
        @Param('limit', ParseIntPipe) limit: number,
    ) {
        return this.anamnesePerguntaService.getAllAnamnesePerguntas(page, limit);
    }

    @ApiOperation({ summary: 'Retorna uma pergunta de anamnese pelo ID' })
    @ApiOkResponse({ description: 'Pergunta retornada com sucesso.' })
    @Get('perguntas/:id')
    async buscarPergunta(@Param('id', uuidPipe('ID de pergunta inválido')) id: string) {
        return this.anamnesePerguntaService.getAnamnesePerguntaById(id);
    }

    @ApiOperation({ summary: 'Atualiza uma pergunta de anamnese' })
    @ApiOkResponse({ description: 'Pergunta atualizada com sucesso.' })
    @Roles(TipoUsuario.admin)
    @Patch('perguntas/:id')
    async atualizarPergunta(
        @Param('id', uuidPipe('ID de pergunta inválido')) id: string,
        @Body() dto: updateAnamnesePerguntaDto,
    ) {
        return this.anamnesePerguntaService.patchAnamnesePergunta(id, dto);
    }

    @ApiOperation({ summary: 'Ativa uma pergunta de anamnese' })
    @ApiOkResponse({ description: 'Pergunta ativada com sucesso.' })
    @Roles(TipoUsuario.admin)
    @Patch('perguntas/:id/ativar')
    async ativarPergunta(@Param('id', uuidPipe('ID de pergunta inválido')) id: string) {
        return this.anamnesePerguntaService.ativarAnamnesePergunta(id);
    }

    @ApiOperation({ summary: 'Desativa uma pergunta de anamnese' })
    @ApiOkResponse({ description: 'Pergunta desativada com sucesso.' })
    @Roles(TipoUsuario.admin)
    @Patch('perguntas/:id/desativar')
    async desativarPergunta(@Param('id', uuidPipe('ID de pergunta inválido')) id: string) {
        return this.anamnesePerguntaService.desativarAnamnesePergunta(id);
    }

    @ApiOperation({ summary: 'Remove uma pergunta de anamnese (falha se já houver opções ou respostas vinculadas)' })
    @ApiOkResponse({ description: 'Pergunta removida com sucesso.' })
    @Roles(TipoUsuario.admin)
    @Delete('perguntas/:id')
    async removerPergunta(@Param('id', uuidPipe('ID de pergunta inválido')) id: string) {
        return this.anamnesePerguntaService.deleteAnamnesePergunta(id);
    }

    /*
        OPÇÕES (aninhadas em pergunta na criação/listagem, escrita só admin)
    */

    @ApiOperation({ summary: 'Cria uma opção de resposta para uma pergunta' })
    @ApiCreatedResponse({ description: 'Opção criada com sucesso.' })
    @Roles(TipoUsuario.admin)
    @Post('perguntas/:perguntaId/opcoes')
    async criarOpcao(
        @Param('perguntaId', uuidPipe('ID de pergunta inválido')) perguntaId: string,
        @Body() dto: createAnamneseOpcaoalDto,
    ) {
        return this.anamneseOpcaoService.createAnamneseOpcao({ ...dto, perguntaId });
    }

    @ApiOperation({ summary: 'Lista as opções de resposta de uma pergunta' })
    @ApiOkResponse({ description: 'Lista de opções da pergunta.' })
    @Get('perguntas/:perguntaId/opcoes')
    async listarOpcoes(@Param('perguntaId', uuidPipe('ID de pergunta inválido')) perguntaId: string) {
        return this.anamneseOpcaoService.getAllOpcoes(perguntaId);
    }

    @ApiOperation({ summary: 'Atualiza uma opção de resposta' })
    @ApiOkResponse({ description: 'Opção atualizada com sucesso.' })
    @Roles(TipoUsuario.admin)
    @Patch('opcoes/:id')
    async atualizarOpcao(
        @Param('id', uuidPipe('ID de opção inválido')) id: string,
        @Body() dto: updateAnamneseOpcaoalDto,
    ) {
        return this.anamneseOpcaoService.patchAnamneseOpcao(id, dto);
    }

    @ApiOperation({ summary: 'Remove uma opção de resposta' })
    @ApiOkResponse({ description: 'Opção removida com sucesso.' })
    @Roles(TipoUsuario.admin)
    @Delete('opcoes/:id')
    async removerOpcao(@Param('id', uuidPipe('ID de opção inválido')) id: string) {
        return this.anamneseOpcaoService.deleteAnamneseOpcao(id);
    }

    /*
        RESPOSTAS (aninhadas em anamnese na criação, só o profissional dono mexe)
    */

    @ApiOperation({ summary: 'Registra uma resposta em uma anamnese' })
    @ApiCreatedResponse({ description: 'Resposta registrada com sucesso.' })
    @Roles(TipoUsuario.profissional)
    @Post(':anamneseId/respostas')
    async criarResposta(
        @Request() request,
        @Param('anamneseId', uuidPipe('ID de anamnese inválido')) anamneseId: string,
        @Body() dto: createAnamneseRespostaDto,
    ) {
        return this.anamneseRespostaService.createAnamneseResposta(anamneseId, dto, request.user.sub);
    }

    @ApiOperation({ summary: 'Atualiza uma resposta de anamnese' })
    @ApiOkResponse({ description: 'Resposta atualizada com sucesso.' })
    @Roles(TipoUsuario.profissional)
    @Patch('respostas/:id')
    async atualizarResposta(
        @Request() request,
        @Param('id', uuidPipe('ID de resposta inválido')) id: string,
        @Body() dto: updateAnamneseRespostaDto,
    ) {
        return this.anamneseRespostaService.patchAnamneseResposta(id, dto, request.user.sub);
    }

    @ApiOperation({ summary: 'Remove uma resposta de anamnese' })
    @ApiOkResponse({ description: 'Resposta removida com sucesso.' })
    @Roles(TipoUsuario.profissional)
    @Delete('respostas/:id')
    async removerResposta(@Request() request, @Param('id', uuidPipe('ID de resposta inválido')) id: string) {
        return this.anamneseRespostaService.deleteAnamneseResposta(id, request.user.sub);
    }

    /*
        ANAMNESE (container por paciente, só profissional cria/preenche)
    */

    @ApiOperation({ summary: 'Cria uma anamnese para um paciente' })
    @ApiCreatedResponse({ description: 'Anamnese criada com sucesso.' })
    @Roles(TipoUsuario.profissional)
    @Post()
    async criarAnamnese(@Request() request, @Body() dto: createAnamneseDto) {
        return this.anamneseService.createAnamnese(dto, request.user.sub);
    }

    @ApiOperation({ summary: 'Retorna uma anamnese pelo ID (profissional dono, paciente dono ou admin)' })
    @ApiOkResponse({ description: 'Anamnese retornada com sucesso.' })
    @Get(':id')
    async buscarAnamnese(@Request() request, @Param('id', uuidPipe('ID de anamnese inválido')) id: string) {
        return this.anamneseService.getAnamneseById(id, request.user.sub, request.user.tipoUsuario);
    }
}
