import { Body, Controller, Get, Post, UseGuards, Request, Query, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags, ApiCreatedResponse } from '@nestjs/swagger';
import { RolesGuard } from '../auth/roles.guard';
import { AuthGuard } from '../auth/auth.guard';
import { ProfissionalService } from './profissional.service';
import { createProfissionalDto } from './dtos/profissional';
import { Roles } from '../auth/roles.decorator';
import { TipoUsuario } from '@prisma/client';
import { CreateUsuarioDto } from '../usuario/dtos/usuario';

@ApiTags('Profissionais')
@ApiBearerAuth()
@UseGuards(AuthGuard, RolesGuard)
@Controller('profissionais')
export class ProfissionalController {
  constructor(private profissionalService: ProfissionalService) {}

  @ApiOperation({ summary: 'Listar os pacientes do profissional autenticado' })
  @ApiResponse({ description: 'Retorna a lista de pacientes vinculados ao profissional.' })
  @Roles(TipoUsuario.profissional)
  @Get('meus-pacientes')
  async listarMeusPacientes(@Request() request) {
    const profissional = await this.profissionalService.findByUsuarioId(request.user.sub);
    return this.profissionalService.listarPacientesDoProfissional(profissional.id);
  }

  @ApiOperation({ summary: 'Solicitar cadastro como profissional' })
  @ApiCreatedResponse({ description: 'Solicitação de cadastro profissional criada com sucesso, aguardando aprovação.' })
  @Roles(TipoUsuario.comum)
  @Post('solicitar')
  async solicitarCadastro(@Request() request, @Body() dto: createProfissionalDto) {
    return this.profissionalService.solicitarCadastroProfissional(request.user.sub, dto);
  }

  @ApiOperation({ summary: 'Lista solicitações pendentes de profissionais' })
  @ApiResponse({ description: 'Retorna a lista de solicitações pendentes de profissionais.' })
  @Roles(TipoUsuario.admin)
  @Get('pendentes')
  async listarPendentes(@Query('page') page = 1, @Query('limit') limit = 10) {
    return this.profissionalService.listarProfissionaisPendentes(page, limit);
  }

  @ApiOperation({ summary: 'Aprovar solicitação de cadastro profissional' })
  @ApiCreatedResponse({ description: 'Solicitação de cadastro profissional aprovada com sucesso.' })
  @Roles(TipoUsuario.admin)
  @Post(':id/aprovar')
  async aprovar(@Request() request, @Param('id') id: string) {
    return this.profissionalService.aprovarCadastroProfissional(request.user.sub, id);
  }

  @ApiOperation({ summary: 'Rejeitar solicitação de cadastro profissional' })
  @ApiCreatedResponse({ description: 'Solicitação de cadastro profissional rejeitada com sucesso.' })
  @Roles(TipoUsuario.admin)
  @Post(':id/rejeitar')
  async rejeitar(@Request() request, @Param('id') id: string) {
    return this.profissionalService.rejeitarCadastroProfissional(request.user.sub, id);
  }

  @ApiOperation({ summary: 'Criar um novo paciente associado ao profissional autenticado' })
  @ApiCreatedResponse({ description: 'Paciente criado com sucesso e associado ao profissional.' })
  @Roles(TipoUsuario.profissional)
  @Post('paciente')
  async criarPaciente(@Request() request, @Body() dto: CreateUsuarioDto) {
    const profissional = await this.profissionalService.findByUsuarioId(request.user.sub);
    return this.profissionalService.criarNovoPacienteAssociado(dto, profissional.id);
  }

  @ApiOperation({ summary: 'Vincular um paciente já existente ao profissional autenticado' })
  @ApiCreatedResponse({ description: 'Paciente vinculado ao profissional com sucesso.' })
  @Roles(TipoUsuario.profissional)
  @Post('paciente/:pacienteId/associar')
  async associarPaciente(@Request() request, @Param('pacienteId') pacienteId: string) {
    const profissional = await this.profissionalService.findByUsuarioId(request.user.sub);
    return this.profissionalService.associarPaciente(profissional.id, pacienteId);
  }

  @ApiOperation({ summary: 'Obter os dados de um profissional específico' })
  @ApiResponse({ description: 'Retorna os dados de um profissional.' })
  @Roles(TipoUsuario.admin)
  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.profissionalService.findOne(id);
  }

}