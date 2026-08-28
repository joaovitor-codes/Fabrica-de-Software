import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ReceitaService } from './receita.service';
import { ReceitaDto } from './dto/receita';
import { AuthGuard } from '../auth/auth.guard';
import { UpdateReceitaDto } from './dto/update.receita';
import { ApiOkResponse, ApiOperation } from '@nestjs/swagger';

@Controller('api/receita')
export class ReceitaController {
  constructor(private readonly receitaService: ReceitaService) {}

  @ApiOperation({ summary: 'Cria uma nova receita' })
  @ApiOkResponse({ description: 'Retorna o objeto da receita criada.' })
  @UseGuards(AuthGuard)
  @Post()
  create(@Body() receita: ReceitaDto, @Request() req) {
    return this.receitaService.create(receita, req.user.sub);
  }

  @ApiOperation({ summary: 'Retorna todas as receitas' })
  @ApiOkResponse({ description: 'Array de receitas.' })
  @Get('all')
  findAll() {
    return this.receitaService.findAll();
  }

  @ApiOperation({ summary: 'Retorna uma lista de sugestões de receitas' })
  @ApiOkResponse({ description: 'Array com receitas sugeridas.' })
  @Get('sugestoes')
  findSuggestions() {
    return this.receitaService.findSuggestions();
  }

  @ApiOperation({ summary: 'Retorna uma receita pelo ID' })
  @ApiOkResponse({ description: 'Objeto da receita.' })
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.receitaService.findOne(id);
  }

  @ApiOperation({ summary: 'Retorna uma receita pelo nome' })
  @ApiOkResponse({ description: 'Objeto da receita.' })
  @Get('/nome/:nome')
  findByName(@Param('nome') nome: string) {
    return this.receitaService.findByName(nome);
  }

  @ApiOperation({ summary: 'Retorna os ingredientes de uma receita pelo ID' })
  @ApiOkResponse({ description: 'Array de ingredientes da receita.' })
  @Get(':id/ingredientes')
  findIngredients(@Param('id') id: string) {
    return this.receitaService.findIngredients(id);
  }

  @ApiOperation({
    summary: 'Retorna os ingredientes substitutos de uma receita pelo ID',
  })
  @ApiOkResponse({
    description: 'Array de ingredientes substitutos da receita.',
  })
  @Get(':id/ingredientes/substituicao')
  findReplacementFor(@Param('id') id: string) {
    return this.receitaService.findReplacementFor(id);
  }

  @ApiOperation({ summary: 'Retorna os alertas de uma receita pelo ID' })
  @ApiOkResponse({ description: 'Array de alertas da receita.' })
  @Get(':id/alertas')
  findAlerts(@Param('id') id: string) {
    return this.receitaService.findAlerts(id);
  }

  @ApiOperation({ summary: 'Retorna todas as receitas validadas' })
  @ApiOkResponse({ description: 'Array com as receitas validadas.' })
  @Get('validadas')
  findValidated() {
    return this.receitaService.findValidated();
  }

  @ApiOperation({ summary: 'Retorna todos os feedbacks de uma receita' })
  @ApiOkResponse({ description: 'Feedbacks de determinada receita.' })
  @Get(':id/feedback')
  findFeedback() {
    return this.receitaService.findFeedbacks();
  }

  @ApiOperation({ summary: 'Atualiza uma receita pelo ID' })
  @ApiOkResponse({ description: 'Objeto da receita atualizada.' })
  @Patch(':id')
  update(@Param('id') id: string, @Body() receita: UpdateReceitaDto) {
    return this.receitaService.update(id, receita);
  }

  @ApiOperation({ summary: 'Remove uma receita pelo ID' })
  @ApiOkResponse({ description: 'Mensagem de sucesso ou erro.' })
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.receitaService.remove(id);
  }
}
