import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Request,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadGatewayResponse,
  ApiBody,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { TipoUsuario } from '@prisma/client';
import { AuthGuard } from '../../../auth/auth.guard';
import type { RequestAutenticado } from '../../../auth/auth.types';
import { Roles } from '../../../auth/roles.decorator';
import { RolesGuard } from '../../../auth/roles.guard';
import { CompraService } from './compra.service';
import { CreateReembolsoDto, ResolverReembolsoDto } from './dtos/reembolso';
import { ReembolsoService } from './reembolso.service';

const uuidPipe = (mensagem: string) =>
  new ParseUUIDPipe({
    version: '4',
    exceptionFactory: () => new BadRequestException(mensagem),
  });

@Controller('api/receita')
export class CompraController {
  constructor(
    private readonly compraService: CompraService,
    private readonly reembolsoService: ReembolsoService,
  ) {}

  @ApiOperation({
    summary: 'Compra uma receita à venda e devolve o link de pagamento',
    description:
      'Cria a compra como pendente, com preço e taxa congelados, e a preferência do Checkout Pro. ' +
      'O comprador paga no Mercado Pago; a cópia só é liberada quando o pagamento é confirmado.',
  })
  @ApiCreatedResponse({
    description: 'Compra criada: `{ compraId, checkoutUrl }`.',
  })
  @ApiOkResponse({
    description:
      'Já havia uma compra pendente desta receita: devolve o mesmo link.',
  })
  @ApiNotFoundResponse({
    description: 'A receita não existe ou não está à venda.',
  })
  @ApiConflictResponse({ description: 'O usuário já comprou esta receita.' })
  @ApiUnprocessableEntityResponse({
    description:
      'Sem o aceite dos termos, a própria receita, ou receita que fere uma restrição estrita (com `restricoesVioladas`).',
  })
  @ApiBadGatewayResponse({ description: 'O Mercado Pago recusou a cobrança.' })
  @ApiServiceUnavailableResponse({
    description: 'Mercado Pago fora do ar ou integração não configurada.',
  })
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Post(':id/comprar')
  async comprar(
    @Param('id', uuidPipe('ID da receita inválido')) id: string,
    @Request() req: RequestAutenticado,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { reaproveitada, ...compra } = await this.compraService.comprar(
      id,
      req.user,
    );
    res.status(reaproveitada ? HttpStatus.OK : HttpStatus.CREATED);
    return compra;
  }

  @ApiOperation({
    summary: 'Retorna as receitas compradas pelo usuário',
    description:
      'Resumo das cópias (sem modo de preparo nem ingredientes), com `compradaDe` e a compra. ' +
      'Não conta como abrir a cópia: só o detalhe e os ingredientes gravam o primeiro acesso.',
  })
  @ApiOkResponse({
    description:
      'Lista das cópias com compra paga ou em análise de reembolso, mais novas primeiro. Vazia se não houver.',
  })
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  // Rota fixa: precisa vir antes de GET :id (ordem em ReceitasModule).
  @Get('compradas')
  async compradas(@Request() req: RequestAutenticado) {
    return await this.compraService.compradas(req.user);
  }

  @ApiOperation({
    summary: 'Retorna as vendas das receitas do usuário',
    description:
      'Não identifica o comprador. `valorVendedor` é o preço pago menos a taxa da plataforma, antes da tarifa do Mercado Pago.',
  })
  @ApiOkResponse({
    description:
      'Lista das vendas pagas (inclusive as com reembolso pedido ou feito, pelo `status`), mais novas primeiro. Vazia se não houver.',
  })
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Get('minhas-vendas')
  async minhasVendas(@Request() req: RequestAutenticado) {
    return await this.compraService.minhasVendas(req.user);
  }

  @ApiOperation({ summary: 'Situação de uma compra do usuário' })
  @ApiOkResponse({
    description:
      'Status, preço pago e, enquanto pendente, o link de pagamento. Depois de paga, o ID da cópia.',
  })
  @ApiNotFoundResponse({
    description: 'A compra não existe ou é de outro usuário.',
  })
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Get('compra/:compraId')
  async consultar(
    @Param('compraId', uuidPipe('ID da compra inválido')) compraId: string,
    @Request() req: RequestAutenticado,
  ) {
    return await this.compraService.consultar(compraId, req.user);
  }

  @ApiOperation({
    summary: 'Pede o reembolso de uma compra (comprador)',
    description:
      'Uma vez por compra, em até `MARKETPLACE_REEMBOLSO_DIAS` (7) dias do pagamento. Cópia nunca aberta, ' +
      'nunca adaptada e fora de plano alimentar é estornada na hora; senão, o pedido vai para a análise do admin. ' +
      'Estorno automático que o Mercado Pago não faz inteiro também vai para a análise.',
  })
  @ApiBody({ type: CreateReembolsoDto })
  @ApiOkResponse({
    description:
      '`{ compraId, status }`: `reembolsada` (estorno automático) ou `reembolso_em_analise`.',
  })
  @ApiNotFoundResponse({
    description: 'A compra não existe ou é de outro usuário.',
  })
  @ApiConflictResponse({
    description: 'A compra não está `paga`, ou já teve um pedido de reembolso.',
  })
  @ApiUnprocessableEntityResponse({
    description: 'Passou o prazo do reembolso.',
  })
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('compra/:compraId/reembolso')
  async solicitarReembolso(
    @Param('compraId', uuidPipe('ID da compra inválido')) compraId: string,
    @Body() dto: CreateReembolsoDto,
    @Request() req: RequestAutenticado,
  ) {
    return await this.reembolsoService.solicitar(compraId, req.user, dto);
  }

  @ApiOperation({
    summary: 'Fila de reembolsos (admin)',
    description:
      '`pedidos`: compras em `reembolso_em_analise`, mais antigas primeiro, com o motivo, as datas do pedido, do ' +
      'pagamento e do primeiro acesso, e se a cópia foi adaptada ou está em plano alimentar. ' +
      '`cobrancasDuplicadas`: pagamentos aprovados que não liberaram cópia (o comprador já tinha a receita) e cujo ' +
      'estorno automático não saiu.',
  })
  @ApiOkResponse({ description: '`{ pedidos, cobrancasDuplicadas }`.' })
  @ApiBearerAuth()
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(TipoUsuario.admin)
  // Rota fixa: precisa vir antes de GET :id (ordem em ReceitasModule).
  @Get('reembolsos')
  async filaReembolsos() {
    return await this.reembolsoService.fila();
  }

  @ApiOperation({
    summary: 'Aprova ou nega um pedido de reembolso em análise (admin)',
    description:
      'Aprovado: estorna no Mercado Pago; a compra fica `reembolsada` e a cópia, as adaptações dela e os itens de ' +
      'plano que as usam saem do ar. Negado: a compra volta para `paga`. O comprador é notificado; no aprovado, o ' +
      'vendedor também.',
  })
  @ApiBody({ type: ResolverReembolsoDto })
  @ApiOkResponse({ description: '`{ compraId, status }`.' })
  @ApiNotFoundResponse({ description: 'A compra não existe.' })
  @ApiConflictResponse({
    description: 'A compra não está `reembolso_em_analise`.',
  })
  @ApiUnprocessableEntityResponse({
    description:
      'O Mercado Pago não estornou o valor inteiro (vendedor sem saldo ou desconectado, por exemplo); o pedido continua em análise.',
  })
  @ApiServiceUnavailableResponse({
    description: 'Mercado Pago fora do ar; o pedido continua em análise.',
  })
  @ApiBearerAuth()
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(TipoUsuario.admin)
  @Patch('compra/:compraId/reembolso')
  async resolverReembolso(
    @Param('compraId', uuidPipe('ID da compra inválido')) compraId: string,
    @Body() dto: ResolverReembolsoDto,
  ) {
    return await this.reembolsoService.resolver(compraId, dto);
  }

  @ApiOperation({
    summary: 'Estorna uma cobrança em dobro (admin)',
    description:
      'Para os pagamentos de `cobrancasDuplicadas` na fila de reembolsos: tenta de novo o estorno que o webhook não conseguiu.',
  })
  @ApiOkResponse({ description: '`{ pagamentoId, statusPagamento }`.' })
  @ApiConflictResponse({
    description: 'O pagamento não é uma cobrança em dobro pendente de estorno.',
  })
  @ApiUnprocessableEntityResponse({
    description: 'O Mercado Pago não estornou o valor inteiro.',
  })
  @ApiServiceUnavailableResponse({ description: 'Mercado Pago fora do ar.' })
  @ApiBearerAuth()
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(TipoUsuario.admin)
  @HttpCode(HttpStatus.OK)
  @Post('pagamento/:pagamentoId/estorno')
  async estornarCobrancaDuplicada(
    @Param('pagamentoId', uuidPipe('ID do pagamento inválido'))
    pagamentoId: string,
  ) {
    return await this.reembolsoService.estornarCobrancaDuplicada(pagamentoId);
  }
}
