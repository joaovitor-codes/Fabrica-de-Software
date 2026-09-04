import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TelefoneService } from './telefone.service';
import { CreateTelefoneDto, UpdateTelefoneDto } from './dtos/telefone';
import { AuthGuard } from '../auth/auth.guard';

@ApiTags('Telefone')
@Controller('api/telefone')
export class TelefoneController {
  constructor(private readonly telefoneService: TelefoneService) {}

  @ApiOperation({ summary: 'Cria um novo telefone a um usuario ou clinica' })
  @ApiCreatedResponse({ description: 'Telefone criado com sucesso.' })
  @UseGuards(AuthGuard)
  @Post()
  async create(@Body() createTelefoneDto: CreateTelefoneDto) {
    return this.telefoneService.create(createTelefoneDto);
  }

  @ApiOperation({ summary: 'Obtém uma lista paginada de telefones' })
  @ApiOkResponse({ description: 'Lista de telefones.' })
  @Get('page/:page/limit/:limit')
  async findAll(
    @Param('page', ParseIntPipe) page: number,
    @Param('limit', ParseIntPipe) limit: number,
  ) {
    return this.telefoneService.findAll(page, limit);
  }

  @ApiOperation({ summary: 'Retorna um telefone específico pelo ID' })
  @ApiOkResponse({ description: 'Telefone retornado com sucesso.' })
  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.telefoneService.findOne(id);
  }

  @ApiOperation({ summary: 'Atualiza um telefone específico pelo ID' })
  @ApiOkResponse({ description: 'Telefone atualizado com sucesso.' })
  @UseGuards(AuthGuard)
  @Patch(':id')
  async update(@Param('id') id: string, @Body() updateTelefoneDto: UpdateTelefoneDto) {
    return this.telefoneService.update(id, updateTelefoneDto);
  }

  @ApiOperation({ summary: 'Remove um telefone específico pelo ID' })
  @ApiOkResponse({ description: 'Telefone removido com sucesso.' })
  @UseGuards(AuthGuard)
  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.telefoneService.remove(id);
  }
}
