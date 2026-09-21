import { BadRequestException, Body, Controller, Get, Param, ParseIntPipe, ParseUUIDPipe, Post, Request, UseGuards } from '@nestjs/common';
import { DiarioDeSintomasService } from './diario-de-sintomas.service';
import { CreateDiarioSintomasDto } from './dtos/diario-de-sintomas';
import { RolesGuard } from '../auth/roles.guard';
import { AuthGuard } from '../auth/auth.guard';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { TipoUsuario } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';

const uuidPipe = (mensagem: string) => new ParseUUIDPipe({
    version: '4',
    errorHttpStatusCode: 400,
    exceptionFactory: () => new BadRequestException(mensagem),
});

@ApiTags('Diário de Sintomas')
@ApiBearerAuth()
@UseGuards(AuthGuard, RolesGuard)
@Controller('diario-de-sintomas')
export class DiarioDeSintomasController {
    constructor(
        private readonly diarioDeSintomasService: DiarioDeSintomasService
    ){}


    @ApiOperation({ summary: 'Criar um novo registro no diário de sintomas de um paciente específico' })
    @ApiResponse({ description: 'Registro do diário de sintomas criado com sucesso.' })
    @Roles(TipoUsuario.paciente, TipoUsuario.profissional, TipoUsuario.admin)
    @Post('paciente/:pacienteId')
    async criarDiarioDeSintomas(
        @Param('pacienteId', uuidPipe('ID invalido')) pacienteId: string,
        @Body() dto: CreateDiarioSintomasDto,
        @Request() request,
    ){
        return await this.diarioDeSintomasService.criarDiarioDeSintomas(pacienteId, dto, request.user.sub, request.user.tipoUsuario);
    }

    @ApiOperation({ summary: 'Obter um registro específico do diário de sintomas de um paciente' })
    @ApiResponse({ description: 'Retorna o registro do diário de sintomas solicitado.' })
    @Roles(TipoUsuario.paciente, TipoUsuario.profissional, TipoUsuario.admin)
    @Get('paciente/:pacienteId/diario/:diarioId')
    async getDiario(
        @Param('diarioId', uuidPipe('ID invalido')) diarioId: string,
        @Param('pacienteId', uuidPipe('ID invalido')) pacienteId: string,
        @Request() request,
    ){
        return await this.diarioDeSintomasService.getDiario(diarioId, pacienteId, request.user.sub, request.user.tipoUsuario);
    }

    @ApiOperation({ summary: 'Listar os registros do diário de sintomas de um paciente específico' })
    @ApiResponse({ description: 'Retorna a lista de registros do diário de sintomas do paciente.' })
    @Roles(TipoUsuario.paciente, TipoUsuario.profissional, TipoUsuario.admin)
    @Get('paciente/:pacienteId/page/:page/limit/:limit')
    async findAllPorPacienteId(
        @Param('pacienteId', uuidPipe('ID invalido')) pacienteId: string,
        @Param('page', ParseIntPipe) page: number,
        @Param('limit', ParseIntPipe) limit: number,
        @Request() request,
    ){
        return await this.diarioDeSintomasService.findAllPorPacienteId(pacienteId, request.user.sub, request.user.tipoUsuario, page, limit);
    }
}
