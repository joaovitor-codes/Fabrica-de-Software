import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards } from '@nestjs/common';
import { UnidadeMedidaService } from './unidade-medida.service';
import { UnidadeMedidaDto } from './dto/unidade-medida.dto';
import { UpdateUnidadeMedidaDto } from './dto/update-unidade-medida.dto';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';

@Controller('/api/unidade-medida')
export class UnidadeMedidaController {
  constructor(private readonly unidadeMedidaService: UnidadeMedidaService) {}

  @ApiOperation({ summary: 'Cria uma nova unidade de medida' })
  @ApiCreatedResponse({ description: 'Unidade de medida criada com sucesso.' })
  @UseGuards(AuthGuard)
  @Post()
  async create(@Body() createUnidadeMedidaDto: UnidadeMedidaDto) {
    return await this.unidadeMedidaService.create(createUnidadeMedidaDto);
  }

  @ApiOperation({ summary: 'Retorna todas as unidades de medida' })
  @ApiOkResponse({ description: 'Retorna uma lista de unidades de medida.' })
  @Get('all')
  async findAll() {
    return await this.unidadeMedidaService.findAll();
  }

  @ApiOperation({ summary: 'Retorna uma unidade de medida pelo ID' })
  @ApiOkResponse({ description: 'Objeto da unidade de medida.' })
  @Get(':id')
  async findOne(@Param('id') id: string) {
    return await this.unidadeMedidaService.findOne(id);
  }

  @ApiOperation({ summary: 'Atualiza uma unidade de medida pelo ID' })
  @ApiOkResponse({ description: 'Unidade de medida atualizada com sucesso.' })
  @UseGuards(AuthGuard)
  @Patch(':id')
  async update(@Param('id') id: string, @Body() updateUnidadeMedidaDto: UpdateUnidadeMedidaDto) {
    return await this.unidadeMedidaService.update(id, updateUnidadeMedidaDto);
  }

  @ApiOperation({ summary: 'Remove uma unidade de medida pelo ID' })
  @ApiOkResponse({ description: 'Unidade de medida removida com sucesso.' })
  @UseGuards(AuthGuard)
  @Delete(':id')
  async remove(@Param('id') id: string) {
    return await this.unidadeMedidaService.remove(id);
  }
}
