import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  ParseUUIDPipe,
  BadRequestException,
} from '@nestjs/common';
import { UnidadeMedidaService } from './unidade-medida.service';
import { UnidadeMedidaDto } from './dtos/unidade-medida';
import { UpdateUnidadeMedidaDto } from './dtos/update-unidade-medida';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AuthGuard } from '../../../auth/auth.guard';
import { RolesGuard } from '../../../auth/roles.guard';
import { Roles } from '../../../auth/roles.decorator';
import { TipoUsuario } from '@prisma/client';

const uuidPipe = (mensagem: string) =>
  new ParseUUIDPipe({
    version: '4',
    errorHttpStatusCode: 400,
    exceptionFactory: () => new BadRequestException(mensagem),
  });

@Controller('/api/unidade-medida')
export class UnidadeMedidaController {
  constructor(private readonly unidadeMedidaService: UnidadeMedidaService) {}

  @ApiOperation({ summary: 'Cria uma nova unidade de medida' })
  @ApiCreatedResponse({ description: 'Unidade de medida criada com sucesso.' })
  @ApiBearerAuth()
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(TipoUsuario.admin)
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
  async findOne(@Param('id', uuidPipe('ID inválido')) id: string) {
    return await this.unidadeMedidaService.findOne(id);
  }

  @ApiOperation({ summary: 'Atualiza uma unidade de medida pelo ID' })
  @ApiOkResponse({ description: 'Unidade de medida atualizada com sucesso.' })
  @ApiBearerAuth()
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(TipoUsuario.admin)
  @Patch(':id')
  async update(
    @Param('id', uuidPipe('ID inválido')) id: string,
    @Body() updateUnidadeMedidaDto: UpdateUnidadeMedidaDto,
  ) {
    return await this.unidadeMedidaService.update(id, updateUnidadeMedidaDto);
  }

  @ApiOperation({ summary: 'Remove uma unidade de medida pelo ID' })
  @ApiOkResponse({ description: 'Unidade de medida removida com sucesso.' })
  @ApiBearerAuth()
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(TipoUsuario.admin)
  @Delete(':id')
  async remove(@Param('id', uuidPipe('ID inválido')) id: string) {
    return await this.unidadeMedidaService.remove(id);
  }
}
