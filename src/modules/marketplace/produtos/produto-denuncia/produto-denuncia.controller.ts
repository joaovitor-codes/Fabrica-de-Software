import {
  BadRequestException,
  Body,
  Controller,
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
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { TipoUsuario } from '@prisma/client';
import { AuthGuard } from '../../../../auth/auth.guard';
import { RolesGuard } from '../../../../auth/roles.guard';
import { Roles } from '../../../../auth/roles.decorator';
import type { RequestAutenticado } from '../../../../auth/auth.types';
import { ProdutoService } from '../produto/produto.service';
import { ProdutoDenunciaService } from './produto-denuncia.service';
import {
  CreateProdutoDenunciaDto,
  ResolverProdutoDenunciaDto,
} from './dtos/produto-denuncia';

const idPipe = new ParseUUIDPipe({
  version: '4',
  errorHttpStatusCode: 400,
  exceptionFactory: () => new BadRequestException('ID inválido'),
});

// Registrado antes do ProdutoPublicoController no módulo, para que
// GET /api/produto/denuncias não seja capturado por GET /api/produto/:id.
@ApiTags('Marketplace - Moderação de produtos')
@UseGuards(AuthGuard, RolesGuard)
@ApiBearerAuth()
@Controller('api/produto')
export class ProdutoDenunciaController {
  constructor(
    private readonly produtoDenunciaService: ProdutoDenunciaService,
    private readonly produtoService: ProdutoService,
  ) {}

  @ApiOperation({ summary: 'Retorna a fila de denúncias abertas' })
  @ApiOkResponse({
    description: 'Lista de denúncias `aberta`, com o produto e o motivo.',
  })
  @ApiForbiddenResponse({ description: 'Somente admin.' })
  @Roles(TipoUsuario.admin)
  @Get('denuncias')
  async listar() {
    return this.produtoDenunciaService.listarAbertas();
  }

  @ApiOperation({ summary: 'Resolve uma denúncia' })
  @ApiOkResponse({
    description:
      'Denúncia resolvida. Se procedente, o produto fica `removido`, as outras denúncias abertas dele são fechadas como procedentes e o vendedor é notificado.',
  })
  @ApiNotFoundResponse({ description: 'Denúncia não encontrada.' })
  @ApiConflictResponse({ description: 'Denúncia já resolvida.' })
  @ApiForbiddenResponse({ description: 'Somente admin.' })
  @Roles(TipoUsuario.admin)
  @Patch('denuncias/:denunciaId')
  async resolver(
    @Request() request: RequestAutenticado,
    @Param('denunciaId', idPipe) denunciaId: string,
    @Body() resolverDto: ResolverProdutoDenunciaDto,
  ) {
    return this.produtoDenunciaService.resolver(
      denunciaId,
      request.user.sub,
      resolverDto,
    );
  }

  @ApiOperation({ summary: 'Denuncia um produto à moderação' })
  @ApiCreatedResponse({ description: 'Denúncia registrada como `aberta`.' })
  @ApiNotFoundResponse({ description: 'Produto não encontrado na vitrine.' })
  @ApiConflictResponse({ description: 'O usuário já denunciou este produto.' })
  @ApiUnprocessableEntityResponse({
    description: 'O produto é do próprio usuário.',
  })
  @Post(':id/denuncia')
  async denunciar(
    @Request() request: RequestAutenticado,
    @Param('id', idPipe) id: string,
    @Body() createDto: CreateProdutoDenunciaDto,
  ) {
    return this.produtoDenunciaService.denunciar(
      id,
      request.user.sub,
      createDto,
    );
  }

  @ApiOperation({
    summary: 'Remove um produto da vitrine, sem depender de denúncia',
  })
  @ApiOkResponse({
    description: 'Produto `removido`; o vendedor é notificado.',
  })
  @ApiNotFoundResponse({ description: 'Produto não encontrado.' })
  @ApiForbiddenResponse({ description: 'Somente admin.' })
  @Roles(TipoUsuario.admin)
  @Patch(':id/remover')
  async remover(@Param('id', idPipe) id: string) {
    return this.produtoService.removerProduto(id);
  }
}
