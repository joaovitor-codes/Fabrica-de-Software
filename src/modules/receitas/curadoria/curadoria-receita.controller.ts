import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiOkResponse,
  ApiOperation,
} from '@nestjs/swagger';
import { TipoUsuario } from '@prisma/client';
import { AuthGuard } from '../../../auth/auth.guard';
import { RolesGuard } from '../../../auth/roles.guard';
import { Roles } from '../../../auth/roles.decorator';
import type { RequestAutenticado } from '../../../auth/auth.types';
import { CuradoriaReceitaService } from './curadoria-receita.service';
import { AvaliarReceitaDto } from './dtos/avaliar-receita';

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
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(TipoUsuario.profissional)
  @ApiConflictResponse({
    description:
      'A receita não está pendente, ou mudou depois da revisão informada.',
  })
  @Patch(':id/aprovar')
  async aprovarReceita(
    @Param('id', uuidPipe('ID inválido')) id: string,
    @Body() dto: AvaliarReceitaDto,
    @Request() request: RequestAutenticado,
  ) {
    return await this.curadoriaService.aprovarReceita(
      id,
      request.user.sub,
      dto.revisao,
    );
  }

  @ApiOperation({ summary: 'Rejeita uma receita pelo ID' })
  @ApiOkResponse({ description: 'Receita rejeitada com sucesso.' })
  @ApiBearerAuth()
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(TipoUsuario.profissional)
  @ApiConflictResponse({
    description:
      'A receita não está pendente, ou mudou depois da revisão informada.',
  })
  @Patch(':id/rejeitar')
  async rejeitarReceita(
    @Param('id', uuidPipe('ID inválido')) id: string,
    @Body() dto: AvaliarReceitaDto,
    @Request() request: RequestAutenticado,
  ) {
    return await this.curadoriaService.rejeitarReceita(
      id,
      request.user.sub,
      dto.revisao,
    );
  }
}
