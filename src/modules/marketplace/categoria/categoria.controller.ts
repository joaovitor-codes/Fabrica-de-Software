import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { TipoUsuario } from '@prisma/client';
import { AuthGuard } from '../../../auth/auth.guard';
import { RolesGuard } from '../../../auth/roles.guard';
import { Roles } from '../../../auth/roles.decorator';
import { CategoriaService } from './categoria.service';
import { CreateCategoria, UpdateCategoria } from './dtos/categoria';

const idPipe = new ParseUUIDPipe({
  version: '4',
  errorHttpStatusCode: 400,
  exceptionFactory: () => new BadRequestException('ID inválido'),
});

@ApiTags('Marketplace - Categorias')
@UseGuards(AuthGuard, RolesGuard)
@ApiBearerAuth()
@Controller('api/marketplace/categorias')
export class CategoriaController {
  constructor(private readonly categoriaService: CategoriaService) {}

  @ApiOperation({ summary: 'Cria uma nova categoria de produto' })
  @ApiCreatedResponse({ description: 'Categoria criada com sucesso.' })
  @Roles(TipoUsuario.admin)
  @Post()
  async create(@Body() createCategoriaDto: CreateCategoria) {
    return this.categoriaService.create(createCategoriaDto);
  }

  @ApiOperation({ summary: 'Lista as categorias ativas' })
  @ApiOkResponse({ description: 'Lista de categorias ativas.' })
  @Get()
  async findAllAtivos() {
    return this.categoriaService.findAllAtivos();
  }

  @ApiOperation({ summary: 'Lista as categorias desativadas' })
  @ApiOkResponse({ description: 'Lista de categorias desativadas.' })
  @Roles(TipoUsuario.admin)
  @Get('desativadas')
  async findAllDesativados() {
    return this.categoriaService.findAllDesativados();
  }

  @ApiOperation({ summary: 'Retorna uma categoria ativa pelo ID' })
  @ApiOkResponse({ description: 'Categoria retornada com sucesso.' })
  @Get(':id')
  async findOne(@Param('id', idPipe) id: string) {
    return this.categoriaService.findOne(id);
  }

  @ApiOperation({ summary: 'Atualiza uma categoria pelo ID' })
  @ApiOkResponse({ description: 'Categoria atualizada com sucesso.' })
  @Roles(TipoUsuario.admin)
  @Patch(':id')
  async update(
    @Param('id', idPipe) id: string,
    @Body() updateCategoriaDto: UpdateCategoria,
  ) {
    return this.categoriaService.update(id, updateCategoriaDto);
  }

  @ApiOperation({ summary: 'Restaura uma categoria desativada' })
  @ApiOkResponse({ description: 'Categoria restaurada com sucesso.' })
  @Roles(TipoUsuario.admin)
  @Patch(':id/restaurar')
  async restaurar(@Param('id', idPipe) id: string) {
    return this.categoriaService.restaurar(id);
  }

  @ApiOperation({ summary: 'Desativa uma categoria pelo ID' })
  @ApiOkResponse({ description: 'Categoria desativada com sucesso.' })
  @Roles(TipoUsuario.admin)
  @Delete(':id')
  async remove(@Param('id', idPipe) id: string) {
    return this.categoriaService.remove(id);
  }
}
