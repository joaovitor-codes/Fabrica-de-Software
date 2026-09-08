import { Body, Controller, Get, Post, UseGuards, Request, Query, Param, BadRequestException, DefaultValuePipe, ParseIntPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags, ApiCreatedResponse } from '@nestjs/swagger';
import { RolesGuard } from '../auth/roles.guard';
import { AuthGuard } from '../auth/auth.guard';
import { ProfissionalService } from './profissional.service';
import { createProfissionalDto } from './dtos/profissional';
import { Roles } from '../auth/roles.decorator';

import { TipoUsuario } from '@prisma/client';
import { CreateUsuarioDto } from '../usuario/dtos/usuario';
import { ClinicasService } from '../clinicas/clinicas.service';


@ApiTags('Profissionais')
@ApiBearerAuth()
@UseGuards(AuthGuard, RolesGuard)
@Controller('api/profissionais')
export class ProfissionalController {
  constructor(
    private readonly profissionalService: ProfissionalService,
    private readonly clinicaService: ClinicasService,
  ) {}

  @ApiOperation({ summary: 'Listar os pacientes do profissional autenticado' })
  @ApiResponse({ description: 'Retorna a lista de pacientes vinculados ao profissional.' })
  @Roles(TipoUsuario.profissional)
  @Get('meus-pacientes')
  async listarMeusPacientes(@Request() request) {
    const profissional = await this.profissionalService.findByUsuarioId(request.user.sub);
    return this.profissionalService.listarPacientesDoProfissional(profissional.id);
  }

  @ApiOperation({ summary: 'Obter os dados da clínica do profissional autenticado' })
  @ApiResponse({ description: 'Retorna os dados da clínica vinculada ao profissional.' })
  @Roles(TipoUsuario.profissional)
  @Get('minha-clinica')
  async minhaClinica(@Request() request) {
    const profissional = await this.profissionalService.findByUsuarioId(request.user.sub);
    
    if (!profissional.clinicaId) {
      throw new BadRequestException('O profissional não está associado a uma clínica.');
    }

    return this.clinicaService.findOne(profissional.clinicaId);
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
  async listarPendentes(@Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number, @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number) {
    return this.profissionalService.listarProfissionaisPendentes(page, limit);
  }

  @ApiOperation({ summary: 'Criar um novo paciente associado ao profissional autenticado' })
  @ApiCreatedResponse({ description: 'Paciente criado com sucesso e associado ao profissional.' })
  @Roles(TipoUsuario.profissional)
  @Post('paciente')
  async criarPaciente(@Request() request, @Body() dto: CreateUsuarioDto) {
    const profissional = await this.profissionalService.findByUsuarioId(request.user.sub);
    return this.profissionalService.criarNovoPacienteAssociado(dto, profissional.id);
  }

  @ApiOperation({ summary: 'Desassociar uma clinica vinculada a um profissional' })
  @ApiCreatedResponse({ description: 'Clínica Desassociada com sucesso ao profissional.' })
  @Roles(TipoUsuario.profissional)
  @Post('clinica/desassociar')
  async desassociarClinica(@Request() request) {
    const profissional = await this.profissionalService.findByUsuarioId(request.user.sub);

    if (!profissional.clinicaId) {
      throw new BadRequestException('O profissional não está associado a uma clínica.');
    }

    return this.profissionalService.update(profissional.id, { clinicaId: null });
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

  @ApiOperation({ summary: 'Associar uma clinica vinculada a um profissional' })
  @ApiCreatedResponse({ description: 'Clínica Associada com sucesso ao profissional.' })
  @Roles(TipoUsuario.profissional)
  @Post('clinica/associar/:id')
  async associarClinica(@Request() request, @Param('id') id: string) {
    const profissional = await this.profissionalService.findByUsuarioId(request.user.sub);

    if (profissional.clinicaId) {
      throw new BadRequestException('O profissional já está associado a uma clínica. Desassocie a clínica atual antes de associar uma nova.');
    }
    
    const clinica = await this.clinicaService.findOne(id);

    return this.profissionalService.update(profissional.id, { clinicaId: clinica.id });
  }
}