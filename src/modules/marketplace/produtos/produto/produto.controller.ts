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
  Request,
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
import { AuthGuard } from '../../../../auth/auth.guard';
import { RolesGuard } from '../../../../auth/roles.guard';
import { Roles } from '../../../../auth/roles.decorator';
import type { RequestAutenticado } from '../../../../auth/auth.types';
import { ProdutoService } from './produto.service';
import { CreateProduto, UpdateProduto } from './dtos/produto';

const idPipe = new ParseUUIDPipe({
  version: '4',
  errorHttpStatusCode: 400,
  exceptionFactory: () => new BadRequestException('ID inválido'),
});

@ApiTags('Marketplace - Produtos')
@UseGuards(AuthGuard, RolesGuard)
@ApiBearerAuth()
@Controller('api/produto')
export class ProdutoController {
  constructor(private readonly produtoService: ProdutoService) {}

  @ApiOperation({ summary: 'Cria um novo produto do usuário logado' })
  @ApiCreatedResponse({ description: 'Produto criado com sucesso.' })
  @Roles(TipoUsuario.comum, TipoUsuario.paciente)
  @Post()
  async create(
    @Request() request: RequestAutenticado,
    @Body() createProdutoDto: CreateProduto,
  ) {
    return this.produtoService.createProduto(
      request.user.sub,
      createProdutoDto,
    );
  }

  @ApiOperation({ summary: 'Lista as categorias para o formulário de produto' })
  @ApiOkResponse({ description: 'Lista de categorias (id e nome).' })
  @Get('opcoes/categorias')
  async categoriasOpcoes() {
    return this.produtoService.produtoCategoriasOpcoes();
  }

  @ApiOperation({
    summary: 'Lista as restrições alimentares para o formulário de produto',
  })
  @ApiOkResponse({ description: 'Lista de restrições (id e nome).' })
  @Get('opcoes/restricoes')
  async restricoesOpcoes() {
    return this.produtoService.produtoRestricoesAlimentaresOpcoes();
  }

  @ApiOperation({ summary: 'Lista os produtos do usuário logado' })
  @ApiOkResponse({
    description: 'Produtos do usuário (qualquer status, exceto apagados).',
  })
  @Get('meus')
  async meus(@Request() request: RequestAutenticado) {
    return this.produtoService.getProdutosMeus(request.user.sub);
  }

  @ApiOperation({
    summary: 'Atualiza um produto do usuário logado ou muda o status dele',
  })
  @ApiOkResponse({ description: 'Produto atualizado com sucesso.' })
  @Patch(':id')
  async update(
    @Request() request: RequestAutenticado,
    @Param('id', idPipe) id: string,
    @Body() updateProdutoDto: UpdateProduto,
  ) {
    return this.produtoService.updateProduto(
      id,
      request.user.sub,
      updateProdutoDto,
    );
  }

  @ApiOperation({ summary: 'Pausa um produto do usuário logado' })
  @ApiOkResponse({ description: 'Produto pausado com sucesso.' })
  @Patch(':id/desativar')
  async desativar(
    @Request() request: RequestAutenticado,
    @Param('id', idPipe) id: string,
  ) {
    return this.produtoService.desativarProduto(id, request.user.sub);
  }

  @ApiOperation({ summary: 'Ativa um produto do usuário logado' })
  @ApiOkResponse({ description: 'Produto ativado com sucesso.' })
  @Patch(':id/ativar')
  async ativar(
    @Request() request: RequestAutenticado,
    @Param('id', idPipe) id: string,
  ) {
    return this.produtoService.ativarProduto(id, request.user.sub);
  }

  @ApiOperation({ summary: 'Apaga (soft delete) um produto do usuário logado' })
  @ApiOkResponse({ description: 'Produto apagado com sucesso.' })
  @Delete(':id')
  async apagar(
    @Request() request: RequestAutenticado,
    @Param('id', idPipe) id: string,
  ) {
    return this.produtoService.apagarProduto(id, request.user.sub);
  }

  @ApiOperation({ summary: 'Reativa um produto removido (moderação)' })
  @ApiOkResponse({ description: 'Produto reativado com sucesso.' })
  @Roles(TipoUsuario.admin)
  @Patch(':id/reativar')
  async reativar(@Param('id', idPipe) id: string) {
    return this.produtoService.reativarProduto(id);
  }
}
