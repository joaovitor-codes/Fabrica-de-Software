import { Controller, Param, Post, UseGuards, Get, Body, Delete, Put } from '@nestjs/common';
import { PacientesService } from './pacientes.service';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RolesGuard } from '../auth/roles.guard';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { CreatePacienteDto, UpdatePacienteDto } from './dtos/pacientes';
import { TipoUsuario } from '@prisma/client';

@ApiTags('Pacientes')
@ApiBearerAuth()
@UseGuards(AuthGuard, RolesGuard)
@Controller('api/pacientes')
export class PacientesController {
    constructor(private pacientesService: PacientesService) {}

    @ApiOperation({ summary: 'Cria um novo paciente' })
    @ApiOkResponse({ description: 'Paciente criado com sucesso.' })
    @Roles(TipoUsuario.admin)
    @Post()
    async createPaciente(@Body()CreatePacienteDto: CreatePacienteDto) {
        return this.pacientesService.createPaciente(CreatePacienteDto);
    }

    @ApiOperation({ summary: 'Obtém as informações de um paciente específico' })
    @ApiOkResponse({ description: 'Informações de um paciente.' })
    @Roles(TipoUsuario.admin)
    @Get(':id')
    async findOne(@Param('id') id: string) {
        return this.pacientesService.findOne(id);
    }

    @ApiOperation({ summary: 'Obtém as informações de um paciente específico pelo Id do Usuario' })
    @ApiOkResponse({ description: 'Informações de um paciente.' })
    @Roles(TipoUsuario.admin)
    @Get(':userId')
    async findByUserId(@Param('userId') userId: string) {
        return this.pacientesService.getPacienteByUserId(userId);
    }

    @ApiOperation({ summary: 'Obtém uma lista paginada de pacientes' })
    @ApiOkResponse({ description: 'Lista de pacientes.' })
    @Roles(TipoUsuario.admin)
    @Get('page/:page/limit/:limit')
    async findAll(@Param('page') page: number, @Param('limit') limit: number) {
        return this.pacientesService.findAll(page, limit);
    }

    @ApiOperation({ summary: 'Atualiza as informações de um paciente' })
    @ApiOkResponse({ description: 'Paciente atualizado com sucesso.' })
    @Roles(TipoUsuario.admin)
    @Put('update/:id')
    async updatePaciente(@Body() UpdatePacienteDto: UpdatePacienteDto, @Param('id') id: string) {
        return this.pacientesService.updatePaciente(UpdatePacienteDto, id);
    }

    @Delete('delete/:id')
    @ApiOperation({ summary: 'Remove um paciente específico' })
    @ApiOkResponse({ description: 'Paciente removido com sucesso.' })
    @Roles(TipoUsuario.admin)
    async deletePaciente(@Param('id') id: string) {
        return this.pacientesService.deletePaciente(id);
    }

}
