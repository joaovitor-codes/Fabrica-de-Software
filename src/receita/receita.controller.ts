import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
} from '@nestjs/common';
import { ReceitaService } from './receita.service';
import { ReceitaDto } from './dto/receita';
import { get } from 'http';

@Controller('api/receita')
export class ReceitaController {
  constructor(private readonly receitaService: ReceitaService) {}

  @Post()
  create(@Body() receita: ReceitaDto) {
    return this.receitaService.create(receita);
  }

  @Get('all')
  findAll() {
    return this.receitaService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.receitaService.findOne(id);
  }

  @Get(':name')
  findByName(@Param('name') name: string) {
    return this.receitaService.findByName(name);
  }

  @Get(':id/ingredients')
  findIngredients(@Param('id') id: string) {
    return this.receitaService.findIngredients(id);
  }

  @Get(':id/ingredients/replacement')
  findReplacementFor(@Param('id') id: string) {
    return this.receitaService.findReplacementFor(id);
  }

  @Get(':id/alerts')
  findAlerts(@Param('id') id: string) {
    return this.receitaService.findAlerts(id);
  }

  @Get('suggestions')
  findSuggestions() {
    return this.receitaService.findSuggestions();
  }

  @Get('validated')
  findValidated() {
    return this.receitaService.findValidated();
  }

  @Get(':id/feedback')
  findFeedback() {
    return this.receitaService.findFeedbacks();
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() receita: ReceitaDto) {
    return this.receitaService.update(id, receita);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.receitaService.remove(id);
  }
}
