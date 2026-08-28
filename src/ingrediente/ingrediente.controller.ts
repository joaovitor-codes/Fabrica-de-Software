import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards } from '@nestjs/common';
import { IngredienteService } from './ingrediente.service';
import { UpdateIngredienteDto } from './dto/update-ingrediente.dto';
import { AuthGuard } from '../auth/auth.guard';
import { IngredienteDTO } from './dto/ingrediente';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation } from '@nestjs/swagger';

@Controller('api/ingrediente')
export class IngredienteController {
  constructor(private readonly ingredienteService: IngredienteService) {}

  @ApiOperation({ summary: 'Cria um novo ingrediente na base' })
  @ApiCreatedResponse({ description: 'Ingrediente criado com sucesso.' })
  @UseGuards(AuthGuard)
  @Post()
  async create(@Body() createIngredienteDto: IngredienteDTO) {
    return await this.ingredienteService.create(createIngredienteDto);
  }

  @ApiOperation({ summary: 'Retorna todos os ingredientes cadastrados na base' })
  @ApiOkResponse({ description: 'Lista de ingredientes retornada com sucesso.' })
  @Get('all')
  async findAll() {
    return await this.ingredienteService.findAll();
  }

  @ApiOperation({ summary: 'Retorna um ingrediente específico pelo ID' })
  @ApiOkResponse({ description: 'Ingrediente retornado com sucesso.' })
  @Get(':id')
  async findOne(@Param('id') id: string) {
    return await this.ingredienteService.findOne(id);
  }

  @ApiOperation({ summary: 'Atualiza um ingrediente específico pelo ID' })
  @ApiOkResponse({ description: 'Ingrediente atualizado com sucesso.' })
  @UseGuards(AuthGuard)
  @Patch(':id')
  async update(@Param('id') id: string, @Body() updateIngredienteDto: UpdateIngredienteDto) {
    return await this.ingredienteService.update(id, updateIngredienteDto);
  }

  @ApiOperation({ summary: 'Remove um ingrediente específico pelo ID' })
  @ApiOkResponse({ description: 'Ingrediente removido com sucesso.' })
  @UseGuards(AuthGuard)
  @Delete(':id')
  async remove(@Param('id') id: string) {
    return await this.ingredienteService.remove(id);
  }
}
