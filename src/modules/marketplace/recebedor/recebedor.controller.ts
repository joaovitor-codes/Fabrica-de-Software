import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { AuthGuard } from '../../../auth/auth.guard';
import { RecebedorService } from './recebedor.service';

import type { RequestAutenticado } from '../../../auth/auth.types';

@ApiTags('Marketplace - Recebedor')
@Controller('api/recebedor')
export class RecebedorController {
  constructor(private readonly recebedorService: RecebedorService) {}

  @ApiOperation({
    summary: 'Devolve a URL de autorização do Mercado Pago para o vendedor',
  })
  @ApiOkResponse({ description: 'Objeto com url.' })
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Get('conectar')
  async conectar(@Request() request: RequestAutenticado) {
    return this.recebedorService.gerarUrlConexao(request.user.sub);
  }

  @ApiOperation({
    summary:
      'Destino do redirecionamento do Mercado Pago; troca o código pelos tokens',
  })
  @ApiQuery({ name: 'code', required: false })
  @ApiQuery({ name: 'state', required: false })
  @ApiQuery({ name: 'error', required: false })
  @ApiOkResponse({ description: 'Conta conectada.' })
  @ApiBadRequestResponse({
    description: 'Autorização negada ou state inválido.',
  })
  @ApiConflictResponse({
    description: 'Conta do Mercado Pago já ligada a outro usuário.',
  })
  @SkipThrottle()
  @Get('callback')
  async callback(
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('error') error?: string,
  ) {
    return this.recebedorService.concluirConexao({ code, state, error });
  }

  @ApiOperation({ summary: 'Situação da conexão com o Mercado Pago' })
  @ApiOkResponse({
    description: 'conectado, status, contaMercadoPagoId e tokenExpiraEm.',
  })
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Get('me')
  async me(@Request() request: RequestAutenticado) {
    return this.recebedorService.consultar(request.user.sub);
  }

  @ApiOperation({ summary: 'Desconecta a conta do Mercado Pago' })
  @ApiNoContentResponse({ description: 'Conta desconectada.' })
  @ApiNotFoundResponse({ description: 'Nenhuma conta conectada.' })
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete()
  async desconectar(@Request() request: RequestAutenticado) {
    await this.recebedorService.desconectar(request.user.sub);
  }
}
