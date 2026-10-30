import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { OptionalAuthGuard } from '../../../../auth/optional-auth.guard';
import type { RequestOpcional } from '../../../../auth/auth.types';
import { ListarProdutosQuery } from './dtos/listar-produtos';
import { ProdutoService } from './produto.service';

@ApiTags('Marketplace - Produtos')
@Controller('api/produto')
export class ProdutoPublicoController {
  constructor(private readonly produtoService: ProdutoService) {}

  @ApiOperation({ summary: 'Lista os produtos ativos da vitrine' })
  @ApiOkResponse({ description: 'Lista paginada de produtos.' })
  @ApiBearerAuth()
  @ApiQuery({ name: 'categoria', required: false, type: String })
  @ApiQuery({ name: 'estado', required: false, type: String })
  @ApiQuery({ name: 'cidade', required: false, type: String })
  @ApiQuery({ name: 'publicoAlvo', required: false, type: String })
  @ApiQuery({ name: 'q', required: false, type: String })
  @UseGuards(OptionalAuthGuard)
  @Get('page/:page/limit/:limit')
  async findAll(
    @Param('page', ParseIntPipe) page: number,
    @Param('limit', ParseIntPipe) limit: number,
    @Query() query: ListarProdutosQuery,
  ) {
    return this.produtoService.findAll(page, limit, query);
  }

  @ApiOperation({ summary: 'Retorna um produto ativo pelo ID' })
  @ApiOkResponse({ description: 'Produto retornado com sucesso.' })
  @ApiBearerAuth()
  @UseGuards(OptionalAuthGuard)
  @Get(':id')
  async findOne(
    @Request() request: RequestOpcional,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.produtoService.getProdutoById(id, request.user?.sub);
  }
}
