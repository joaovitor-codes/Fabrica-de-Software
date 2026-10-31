import {
  BadRequestException,
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Request,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadGatewayResponse,
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
import { AuthGuard } from '../../../auth/auth.guard';
import type { RequestAutenticado } from '../../../auth/auth.types';
import { CompraService } from './compra.service';

const uuidPipe = (mensagem: string) =>
  new ParseUUIDPipe({
    version: '4',
    exceptionFactory: () => new BadRequestException(mensagem),
  });

@Controller('api/receita')
export class CompraController {
  constructor(private readonly compraService: CompraService) {}

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
}
