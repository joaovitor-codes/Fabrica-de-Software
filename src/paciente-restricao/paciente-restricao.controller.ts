import { Body, Controller, Delete, Get, Param, Patch, Post, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PacienteRestricaoService } from './paciente-restricao.service';
import { UpdatePacienteRestricaoDto, VincularPacienteRestricaoDto } from './dtos/paciente-restricao';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { TipoUsuario } from '@prisma/client';

@ApiTags('Restrição do Paciente')
@ApiBearerAuth()
@UseGuards(AuthGuard, RolesGuard)
@Controller('api/pacientes')
export class PacienteRestricaoController {
    constructor(private readonly pacienteRestricaoService: PacienteRestricaoService) {}

    @ApiOperation({ summary: 'Vincula uma restrição alimentar a um paciente' })
    @ApiCreatedResponse({ description: 'Restrição vinculada ao paciente com sucesso.' })
    @Roles(TipoUsuario.admin, TipoUsuario.profissional)
    @Post(':pacienteId/restricoes')
    async vincular(
        @Request() request,
        @Param('pacienteId') pacienteId: string,
        @Body() dto: VincularPacienteRestricaoDto,
    ) {
        return this.pacienteRestricaoService.vincularRestricaoAoPaciente(
            request.user.sub,
            request.user.tipoUsuario,
            pacienteId,
            dto,
        );
    }

    @ApiOperation({ summary: 'Lista as restrições alimentares vinculadas a um paciente' })
    @ApiOkResponse({ description: 'Lista de restrições do paciente.' })
    @Roles(TipoUsuario.admin, TipoUsuario.profissional)
    @Get(':pacienteId/restricoes')
    async findAll(@Request() request, @Param('pacienteId') pacienteId: string) {
        return this.pacienteRestricaoService.findAllByPaciente(
            request.user.sub,
            request.user.tipoUsuario,
            pacienteId,
        );
    }

    @ApiOperation({ summary: 'Atualiza a gravidade/observação de uma restrição vinculada ao paciente' })
    @ApiOkResponse({ description: 'Vínculo atualizado com sucesso.' })
    @Roles(TipoUsuario.admin, TipoUsuario.profissional)
    @Patch(':pacienteId/restricoes/:restricaoId')
    async update(
        @Request() request,
        @Param('pacienteId') pacienteId: string,
        @Param('restricaoId') restricaoId: string,
        @Body() dto: UpdatePacienteRestricaoDto,
    ) {
        return this.pacienteRestricaoService.update(
            request.user.sub,
            request.user.tipoUsuario,
            pacienteId,
            restricaoId,
            dto,
        );
    }

    @ApiOperation({ summary: 'Remove o vínculo de uma restrição alimentar com o paciente' })
    @ApiOkResponse({ description: 'Vínculo removido com sucesso.' })
    @Roles(TipoUsuario.admin, TipoUsuario.profissional)
    @Delete(':pacienteId/restricoes/:restricaoId')
    async remove(
        @Request() request,
        @Param('pacienteId') pacienteId: string,
        @Param('restricaoId') restricaoId: string,
    ) {
        return this.pacienteRestricaoService.delete(
            request.user.sub,
            request.user.tipoUsuario,
            pacienteId,
            restricaoId,
        );
    }
}
