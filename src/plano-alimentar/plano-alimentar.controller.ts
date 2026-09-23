import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Request, UseGuards } from "@nestjs/common";
import { ApiCreatedResponse, ApiOkResponse, ApiOperation } from "@nestjs/swagger";
import { AuthGuard } from "../auth/auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { TipoUsuario } from "@prisma/client";
import { PlanoAlimentarDto, PlanoAlimentarItemDto } from "./dto/plano-alimentar";
import { PlanoAlimentarService } from "./plano-alimentar.service";
import { ProfissionalService } from "../profissional/profissional.service";
import { PacientesService } from "../pacientes/pacientes.service";
import { ChecklistRefeicaoService } from "./checklist-refeicao.service";
import { ComentarioRefeicaoService } from "./comentario-refeicao.service";
import { MarcarCheckListDto } from "./dto/checklist-refeicao";
import { CreateComentarioRefeicaoDto } from "./dto/comentario-refeicao";

const uuidPipe = (mensagem: string) => new ParseUUIDPipe({
    version: '4',
    errorHttpStatusCode: 400,
    exceptionFactory: () => new BadRequestException(mensagem),
});

@UseGuards(AuthGuard, RolesGuard)
@Controller('api/plano-alimentar')
export class PlanoAlimentarController {
  constructor(
    private planoAlimentarService: PlanoAlimentarService,
    private profissionalService: ProfissionalService,
    private pacientesService: PacientesService,
    private checklistRefeicaoService: ChecklistRefeicaoService,
    private comentarioRefeicaoService: ComentarioRefeicaoService,
  ) {}

  @ApiOperation({ summary: 'Cria um novo plano alimentar para um paciente' })
  @ApiCreatedResponse({ description: 'Plano alimentar criado com sucesso.' })
  @Roles(TipoUsuario.profissional)
  @Post('/pacientes/:pacienteId')
  async createPlanoAlimentar(@Body() planoAlimentarDto: PlanoAlimentarDto, @Request() req, @Param('pacienteId', uuidPipe('ID do paciente inválido')) pacienteId: string) {
    const profissional = await this.profissionalService.findByUsuarioId(req.user.sub);
    return await this.planoAlimentarService.createPlanoAlimentar(planoAlimentarDto, profissional.id, pacienteId);
  }

  @ApiOperation({ summary: 'Adiciona um item (grade dia x refeição) a um plano alimentar existente' })
  @ApiCreatedResponse({ description: 'Item adicionado ao plano alimentar com sucesso.' })
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(TipoUsuario.profissional)
  @Post(':id/itens')
  async adicionarItemAoPlano(
    @Param('id', uuidPipe('ID do plano alimentar inválido')) id: string,
    @Body() dto: PlanoAlimentarItemDto,
    @Request() req,
  ) {
    const profissional = await this.profissionalService.findByUsuarioId(req.user.sub);
    return this.planoAlimentarService.adicionarItemAoPlano(id, dto, profissional.id);
  }

  @ApiOperation({ summary: 'Marca (ou desmarca) uma refeição como concluída num dia específico' })
  @ApiCreatedResponse({ description: 'Checklist atualizado com sucesso.' })
  @Roles(TipoUsuario.paciente)
  @Post('itens/:itemId/checklist')
  async marcarChecklist(
    @Param('itemId', uuidPipe('ID do item inválido')) itemId: string,
    @Body() dto: MarcarCheckListDto,
    @Request() req,
  ) {
    const paciente = await this.pacientesService.getPacienteByUserId(req.user.sub);
    return this.checklistRefeicaoService.marcarCheckList(itemId, paciente.id, dto);
  }

  @ApiOperation({ summary: 'Lista o histórico de checklist de um item do plano alimentar' })
  @ApiOkResponse({ description: 'Histórico de checklist.' })
  @Roles(TipoUsuario.paciente, TipoUsuario.profissional)
  @Get('itens/:itemId/checklist')
  async findChecklist(@Param('itemId', uuidPipe('ID do item inválido')) itemId: string, @Request() req) {
    return this.checklistRefeicaoService.findAll(itemId, req.user.sub, req.user.tipoUsuario);
  }

  @ApiOperation({ summary: 'Comenta uma refeição de um item do plano alimentar' })
  @ApiCreatedResponse({ description: 'Comentário criado com sucesso.' })
  @Roles(TipoUsuario.paciente)
  @Post('itens/:itemId/comentarios')
  async criarComentario(
    @Param('itemId', uuidPipe('ID do item inválido')) itemId: string,
    @Body() dto: CreateComentarioRefeicaoDto,
    @Request() req,
  ) {
    const paciente = await this.pacientesService.getPacienteByUserId(req.user.sub);
    return this.comentarioRefeicaoService.criarComentario(itemId, paciente.id, req.user.sub, dto);
  }

  @ApiOperation({ summary: 'Lista os comentários de um item do plano alimentar' })
  @ApiOkResponse({ description: 'Lista de comentários.' })
  @Roles(TipoUsuario.paciente, TipoUsuario.profissional)
  @Get('itens/:itemId/comentarios')
  async findComentarios(@Param('itemId', uuidPipe('ID do item inválido')) itemId: string, @Request() req) {
    return this.comentarioRefeicaoService.findAll(itemId, req.user.sub, req.user.tipoUsuario);
  }

  @ApiOperation({ summary: 'Atualiza o status do checklist de uma refeição de um item do plano alimentar' })
  @ApiOkResponse({ description: 'Checklist atualizado com sucesso.' })
  @Roles(TipoUsuario.paciente)
  @Patch('itens/:itemId/checklist')
  async atualizarChecklist(
    @Param('itemId', uuidPipe('ID do item inválido')) itemId: string,
    @Body() dto: MarcarCheckListDto,
    @Request() req,
  ) {
    const paciente = await this.pacientesService.getPacienteByUserId(req.user.sub);
    return this.checklistRefeicaoService.updateCheckList(itemId, paciente.id, dto);
  }
}
