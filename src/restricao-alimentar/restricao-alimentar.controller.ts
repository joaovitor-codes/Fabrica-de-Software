import { BadRequestException, Body, Controller, Delete, Get, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RestricaoAlimentarService } from './restricao-alimentar.service';
import { RestricaoRegraNutricionalService } from './restricao-regra-nutricional-service';
import { CreateRestricaoAlimentarDto, UpdateRestricaoAlimentarDto } from './dtos/restricao-alimentar';
import {
  CreateRestricaoRegraNutricionalDto,
  UpdateRestricaoRegraNutricionalDto,
} from './dtos/restricao-regra-nutricional';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { TipoUsuario } from '@prisma/client';

@ApiTags('Restrição Alimentar')
@UseGuards(AuthGuard, RolesGuard)
@Controller('api/restricao-alimentar')
export class RestricaoAlimentarController {
  constructor(
    private readonly restricaoAlimentarService: RestricaoAlimentarService,
    private readonly restricaoRegraNutricionalService: RestricaoRegraNutricionalService,
  ) {}

  /*
    RESTRIÇÕES
  */

  @ApiOperation({ summary: 'Cria uma nova restrição alimentar' })
  @ApiCreatedResponse({ description: 'Restrição alimentar criada com sucesso.' })
  @Roles(TipoUsuario.admin)
  @Post()
  async create(@Body() createRestricaoAlimentarDto: CreateRestricaoAlimentarDto) {
    return this.restricaoAlimentarService.create(createRestricaoAlimentarDto);
  }

  @ApiOperation({ summary: 'Obtém uma lista paginada de restrições alimentares' })
  @ApiOkResponse({ description: 'Lista de restrições alimentares.' })
  @Roles(TipoUsuario.admin, TipoUsuario.profissional)
  @Get('page/:page/limit/:limit')
  async findAll(
    @Param('page', ParseIntPipe) page: number,
    @Param('limit', ParseIntPipe) limit: number,
  ) {
    return this.restricaoAlimentarService.findAll(page, limit);
  }

  @ApiOperation({ summary: 'Retorna uma restrição alimentar específica pelo ID' })
  @ApiOkResponse({ description: 'Restrição alimentar retornada com sucesso.' })
  @Roles(TipoUsuario.admin, TipoUsuario.profissional)
  @Get(':id')
  async findOne(@Param('id', new ParseUUIDPipe({version: '4', 
    errorHttpStatusCode: 400, 
    exceptionFactory: () => new BadRequestException('ID inválido')})) id: string) {
    return this.restricaoAlimentarService.findOne(id);
  }

  @ApiOperation({ summary: 'Atualiza uma restrição alimentar específica pelo ID' })
  @ApiOkResponse({ description: 'Restrição alimentar atualizada com sucesso.' })
  @Roles(TipoUsuario.admin)
  @Patch(':id')
  async update(
    @Param('id', new ParseUUIDPipe({version: '4', 
      errorHttpStatusCode: 400, 
      exceptionFactory: () => new BadRequestException('ID inválido')})) id: string,
    @Body() updateRestricaoAlimentarDto: UpdateRestricaoAlimentarDto,
  ) {
    return this.restricaoAlimentarService.update(id, updateRestricaoAlimentarDto);
  }

  @ApiOperation({ summary: 'Remove uma restrição alimentar específica pelo ID' })
  @ApiOkResponse({ description: 'Restrição alimentar removida com sucesso.' })
  @Roles(TipoUsuario.admin)
  @Delete(':id')
  async remove(@Param('id', new ParseUUIDPipe({version: '4', 
    errorHttpStatusCode: 400, 
    exceptionFactory: () => new BadRequestException('ID inválido')})) id: string) {
    return this.restricaoAlimentarService.remove(id);
  }


  /*
    REGRAS
  */

  @ApiOperation({ summary: 'Cria uma regra nutricional para a restrição' })
  @ApiCreatedResponse({ description: 'Regra nutricional criada com sucesso.' })
  @Roles(TipoUsuario.admin)
  @Post(':restricaoId/regras-nutricionais')
  async criarRegra(
    @Param('restricaoId', new ParseUUIDPipe({version: '4', 
      errorHttpStatusCode: 400, 
      exceptionFactory: () => new BadRequestException('ID Restrição inválido')})) restricaoId: string,
    @Body() dto: CreateRestricaoRegraNutricionalDto,
  ) {
    return this.restricaoRegraNutricionalService.criarRegra(restricaoId, dto);
  }

  @ApiOperation({ summary: 'Lista as regras nutricionais de uma restrição' })
  @ApiOkResponse({ description: 'Restrição com suas regras nutricionais.' })
  @Roles(TipoUsuario.admin, TipoUsuario.profissional)
  @Get(':restricaoId/regras-nutricionais')
  async getRegras(@Param('restricaoId', new ParseUUIDPipe({version: '4', 
    errorHttpStatusCode: 400, 
    exceptionFactory: () => new BadRequestException('ID Restrição inválido')})) restricaoId: string) {
    return this.restricaoRegraNutricionalService.getRegraByRestricaoId(restricaoId);
  }

  @ApiOperation({ summary: 'Atualiza uma regra nutricional da restrição' })
  @ApiOkResponse({ description: 'Regra nutricional atualizada com sucesso.' })
  @Roles(TipoUsuario.admin)
  @Patch(':restricaoId/regras-nutricionais/:regraId')
  async updateRegra(
    @Param('restricaoId', new ParseUUIDPipe({version: '4', 
      errorHttpStatusCode: 400, 
      exceptionFactory: () => new BadRequestException('ID Restrição inválido')})) restricaoId: string,
    @Param('regraId', new ParseUUIDPipe({version: '4', 
      errorHttpStatusCode: 400, 
      exceptionFactory: () => new BadRequestException('ID Regra inválido')})) regraId: string,
    @Body() dto: UpdateRestricaoRegraNutricionalDto,
  ) {
    return this.restricaoRegraNutricionalService.updateRegra(restricaoId, regraId, dto);
  }

  @ApiOperation({ summary: 'Remove uma regra nutricional da restrição' })
  @ApiOkResponse({ description: 'Regra nutricional removida com sucesso.' })
  @Roles(TipoUsuario.admin)
  @Delete(':restricaoId/regras-nutricionais/:regraId')
  async removeRegra(
    @Param('restricaoId', new ParseUUIDPipe({version: '4', 
      errorHttpStatusCode: 400, 
      exceptionFactory: () => new BadRequestException('ID Restrição inválido')})) restricaoId: string,
    @Param('regraId', new ParseUUIDPipe({version: '4', 
      errorHttpStatusCode: 400, 
      exceptionFactory: () => new BadRequestException('ID Regra inválido')})) regraId: string,
  ) {
    return this.restricaoRegraNutricionalService.delete(restricaoId, regraId);
  }
}
