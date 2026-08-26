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

@Controller('api/receita')
export class ReceitaController {
  constructor(private readonly receitaService: ReceitaService) {}

  @UseGuards(AuthGuard)
  @Post()
  create(@Body() receita: ReceitaDto, @Request() req) {
    return this.receitaService.create(receita, req.user.sub);
  }

  @Get('all')
  findAll() {
    return this.receitaService.findAll();
  }
  
  @Get('sugestoes')
  findSuggestions() {
    return this.receitaService.findSuggestions();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.receitaService.findOne(id);
  }

  @Get('/nome/:nome')
  findByName(@Param('nome') nome: string) {
    return this.receitaService.findByName(nome);
  }

  @Get(':id/ingredientes')
  findIngredients(@Param('id') id: string) {
    return this.receitaService.findIngredients(id);
  }

  @Get(':id/ingredientes/substituicao')
  findReplacementFor(@Param('id') id: string) {
    return this.receitaService.findReplacementFor(id);
  }

  @Get(':id/alertas')
  findAlerts(@Param('id') id: string) {
    return this.receitaService.findAlerts(id);
  }


  @Get('validadas')
  findValidated() {
    return this.receitaService.findValidated();
  }

  @Get(':id/feedback')
  findFeedback() {
    return this.receitaService.findFeedbacks();
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() receita: UpdateReceitaDto) {
    return this.receitaService.update(id, receita);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.receitaService.remove(id);
  }
}
