import {
  Body,
  Controller,
  Get,
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
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { AuthGuard } from '../../../auth/auth.guard';
import { TermosService } from './termos.service';
import { AceiteTermosMarketplaceDto } from './dtos/aceite-termos-marketplace.dto';

import type { RequestAutenticado } from '../../../auth/auth.types';

@ApiTags('Marketplace - Termos')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('api/marketplace/termos')
export class TermosController {
  constructor(private readonly termosService: TermosService) {}

  @ApiOperation({
    summary:
      'Retorna a versão atual dos termos do marketplace e se o usuário já a aceitou',
  })
  @ApiOkResponse({ description: 'Objeto com versaoAtual, aceito e aceitoEm.' })
  @Get()
  async consultar(@Request() request: RequestAutenticado) {
    return this.termosService.consultar(request.user.sub);
  }

  @ApiOperation({ summary: 'Registra o aceite dos termos do marketplace' })
  @ApiCreatedResponse({ description: 'Aceite registrado.' })
  @ApiUnprocessableEntityResponse({
    description: 'A versão enviada não é a atual.',
  })
  @Post('aceite')
  async aceitar(
    @Request() request: RequestAutenticado,
    @Body() dto: AceiteTermosMarketplaceDto,
  ) {
    return this.termosService.aceitar(
      request.user.sub,
      dto.versaoDocumento,
      request.ip,
    );
  }
}
