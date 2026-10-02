import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation } from '@nestjs/swagger';
import { TipoUsuario } from '@prisma/client';
import { AuthGuard } from '../../../auth/auth.guard';
import { RolesGuard } from '../../../auth/roles.guard';
import { Roles } from '../../../auth/roles.decorator';
import type { RequestAutenticado } from '../../../auth/auth.types';
import { CuradoriaReceitaService } from './curadoria-receita.service';

const uuidPipe = (mensagem: string) =>
  new ParseUUIDPipe({
    version: '4',
    errorHttpStatusCode: 400,
    exceptionFactory: () => new BadRequestException(mensagem),
  });

@Controller('api/receita')
export class CuradoriaReceitaController {
  constructor(private readonly curadoriaService: CuradoriaReceitaService) {}

  @ApiOperation({ summary: 'Lista as receitas pendentes de curadoria' })
  @ApiOkResponse({ description: 'Receitas pendentes, mais antigas primeiro.' })
  @ApiBearerAuth()
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(TipoUsuario.admin, TipoUsuario.profissional)
  @Get('pendentes')
  async findPendentes() {
    return await this.curadoriaService.findPendentes();
  }

  @ApiOperation({ summary: 'Aprova uma receita pelo ID' })
  @ApiOkResponse({ description: 'Receita aprovada com sucesso.' })
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Patch(':id/aprovar')
  async aprovarReceita(
    @Param('id', uuidPipe('ID inválido')) id: string,
    @Request() request: RequestAutenticado,
  ) {
    return await this.curadoriaService.aprovarReceita(id, request.user.sub);
  }

  @ApiOperation({ summary: 'Rejeita uma receita pelo ID' })
  @ApiOkResponse({ description: 'Receita rejeitada com sucesso.' })
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Patch(':id/rejeitar')
  async rejeitarReceita(
    @Param('id', uuidPipe('ID inválido')) id: string,
    @Request() request: RequestAutenticado,
  ) {
    return await this.curadoriaService.rejeitarReceita(id, request.user.sub);
  }
}
