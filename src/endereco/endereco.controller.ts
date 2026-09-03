import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { EnderecoService } from './endereco.service';
import { CreateEnderecoDto, UpdateEnderecoDto } from './dtos/endereco';
import { AuthGuard } from '../auth/auth.guard';

@ApiTags('Endereço')
@Controller('api/endereco')
export class EnderecoController {
  constructor(private readonly enderecoService: EnderecoService) {}

  @ApiOperation({ summary: 'Cria um novo endereço' })
  @ApiCreatedResponse({ description: 'Endereço criado com sucesso.' })
  @UseGuards(AuthGuard)
  @Post()
  async create(@Body() createEnderecoDto: CreateEnderecoDto) {
    return this.enderecoService.create(createEnderecoDto);
  }

  @ApiOperation({ summary: 'Obtém uma lista paginada de endereços' })
  @ApiOkResponse({ description: 'Lista de endereços.' })
  @Get('page/:page/limit/:limit')
  async findAll(
    @Param('page', ParseIntPipe) page: number,
    @Param('limit', ParseIntPipe) limit: number,
  ) {
    return this.enderecoService.findAll(page, limit);
  }

  @ApiOperation({ summary: 'Retorna um endereço específico pelo ID' })
  @ApiOkResponse({ description: 'Endereço retornado com sucesso.' })
  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.enderecoService.findOne(id);
  }

  @ApiOperation({ summary: 'Atualiza um endereço específico pelo ID' })
  @ApiOkResponse({ description: 'Endereço atualizado com sucesso.' })
  @UseGuards(AuthGuard)
  @Patch(':id')
  async update(@Param('id') id: string, @Body() updateEnderecoDto: UpdateEnderecoDto) {
    return this.enderecoService.update(id, updateEnderecoDto);
  }

  @ApiOperation({ summary: 'Remove um endereço específico pelo ID' })
  @ApiOkResponse({ description: 'Endereço removido com sucesso.' })
  @UseGuards(AuthGuard)
  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.enderecoService.remove(id);
  }
}
