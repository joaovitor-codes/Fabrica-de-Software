import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RestricaoAlimentarService } from './restricao-alimentar.service';
import { CreateRestricaoAlimentarDto, UpdateRestricaoAlimentarDto } from './dtos/restricao-alimentar';
import { AuthGuard } from '../auth/auth.guard';

@ApiTags('Restrição Alimentar')
@Controller('api/restricao-alimentar')
export class RestricaoAlimentarController {
  constructor(private readonly restricaoAlimentarService: RestricaoAlimentarService) {}

  @ApiOperation({ summary: 'Cria uma nova restrição alimentar' })
  @ApiCreatedResponse({ description: 'Restrição alimentar criada com sucesso.' })
  @UseGuards(AuthGuard)
  @Post()
  async create(@Body() createRestricaoAlimentarDto: CreateRestricaoAlimentarDto) {
    return this.restricaoAlimentarService.create(createRestricaoAlimentarDto);
  }

  @ApiOperation({ summary: 'Obtém uma lista paginada de restrições alimentares' })
  @ApiOkResponse({ description: 'Lista de restrições alimentares.' })
  @Get('page/:page/limit/:limit')
  async findAll(
    @Param('page', ParseIntPipe) page: number,
    @Param('limit', ParseIntPipe) limit: number,
  ) {
    return this.restricaoAlimentarService.findAll(page, limit);
  }

  @ApiOperation({ summary: 'Retorna uma restrição alimentar específica pelo ID' })
  @ApiOkResponse({ description: 'Restrição alimentar retornada com sucesso.' })
  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.restricaoAlimentarService.findOne(id);
  }

  @ApiOperation({ summary: 'Atualiza uma restrição alimentar específica pelo ID' })
  @ApiOkResponse({ description: 'Restrição alimentar atualizada com sucesso.' })
  @UseGuards(AuthGuard)
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() updateRestricaoAlimentarDto: UpdateRestricaoAlimentarDto,
  ) {
    return this.restricaoAlimentarService.update(id, updateRestricaoAlimentarDto);
  }

  @ApiOperation({ summary: 'Remove uma restrição alimentar específica pelo ID' })
  @ApiOkResponse({ description: 'Restrição alimentar removida com sucesso.' })
  @UseGuards(AuthGuard)
  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.restricaoAlimentarService.remove(id);
  }
}
