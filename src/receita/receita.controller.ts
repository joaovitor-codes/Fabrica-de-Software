import { Controller, Get, Post, Body, Patch, Param, Delete, Request, UseGuards } from '@nestjs/common';
import { ReceitaService } from './receita.service';
import { ReceitaDto } from './dto/receita';
import { AuthGuard } from '../auth/auth.guard';
import { UpdateReceitaDto } from './dto/update.receita';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation } from '@nestjs/swagger';
import { IngredienteDTO } from '../ingrediente/dto/ingrediente';

@Controller('api/receita')
export class ReceitaController {
  constructor(private readonly receitaService: ReceitaService) {}

  @ApiOperation({ summary: 'Cria uma nova receita' })
  @ApiCreatedResponse({ description: 'Receita criada com sucesso.' })
  @UseGuards(AuthGuard)
  @Post()
  async create(
    @Body() receita: ReceitaDto,
    @Request() req,
    @Body('ingredientes') ingredientes: IngredienteDTO[],
  ) {
    return await this.receitaService.create(receita, req.user.sub);
  }

  @ApiOperation({ summary: 'Retorna todas as receitas' })
  @ApiOkResponse({ description: 'Retorna uma lista de receitas.' })
  @Get('all')
  async findAll() {
    return await this.receitaService.findAll();
  }

  @ApiOperation({ summary: 'Retorna uma lista de sugestões de receitas' })
  @ApiOkResponse({ description: 'Array com receitas sugeridas.' })
  @Get('sugestoes')
  async findSuggestions() {
    return await this.receitaService.findSuggestions();
  }

  @ApiOperation({ summary: 'Retorna uma receita pelo ID' })
  @ApiOkResponse({ description: 'Objeto da receita.' })
  @Get(':id')
  async findOne(@Param('id') id: string) {
    return await this.receitaService.findOne(id);
  }

  @ApiOperation({ summary: 'Retorna uma receita pelo nome' })
  @ApiOkResponse({ description: 'Objeto da receita.' })
  @Get('/nome/:nome')
  async findByName(@Param('nome') nome: string) {
    return await this.receitaService.findByName(nome);
  }

  @ApiOperation({ summary: 'Retorna os ingredientes de uma receita pelo ID' })
  @ApiOkResponse({ description: 'Array de ingredientes da receita.' })
  @Get(':id/ingredientes')
  async findIngredients(@Param('id') id: string) {
    return await this.receitaService.findIngredients(id);
  }

  @ApiOperation({
    summary: 'Retorna os ingredientes substitutos de uma receita pelo ID',
  })
  @ApiOkResponse({
    description: 'Array de ingredientes substitutos da receita.',
  })
  @Get(':id/ingredientes/substituicao')
  async findReplacementFor(@Param('id') id: string) {
    return await this.receitaService.findReplacementFor(id);
  }

  @ApiOperation({ summary: 'Retorna os alertas de uma receita pelo ID' })
  @ApiOkResponse({ description: 'Array de alertas da receita.' })
  @Get(':id/alertas')
  async findAlerts(@Param('id') id: string) {
    return await this.receitaService.findAlerts(id);
  }

  @ApiOperation({ summary: 'Retorna todas as receitas validadas' })
  @ApiOkResponse({ description: 'Array com as receitas validadas.' })
  @Get('validadas')
  async findValidated() {
    return await this.receitaService.findValidated();
  }

  @ApiOperation({ summary: 'Retorna todos os feedbacks de uma receita' })
  @ApiOkResponse({ description: 'Feedbacks de determinada receita.' })
  @Get(':id/feedback')
  async findFeedback() {
    return await this.receitaService.findFeedbacks();
  }

  @ApiOperation({ summary: 'Atualiza uma receita pelo ID' })
  @ApiOkResponse({ description: 'Receita atualizada com sucesso.' })
  @UseGuards(AuthGuard)
  @Patch(':id')
  async update(@Param('id') id: string, @Body() receita: UpdateReceitaDto) {
    return await this.receitaService.update(id, receita);
  }

  @ApiOperation({ summary: 'Remove uma receita pelo ID' })
  @ApiOkResponse({ description: 'Receita removida com sucesso.' })
  @UseGuards(AuthGuard)
  @Delete(':id')
  async remove(@Param('id') id: string) {
    return await this.receitaService.remove(id);
  }
}
