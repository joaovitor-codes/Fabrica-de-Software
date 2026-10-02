import {
  BadRequestException,
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AuthGuard } from '../../../auth/auth.guard';
import { RolesGuard } from '../../../auth/roles.guard';
import { Roles } from '../../../auth/roles.decorator';
import { TipoUsuario } from '@prisma/client';
import type { RequestAutenticado } from '../../../auth/auth.types';
import { AdaptacaoPacienteService } from './adaptacao-paciente.service';
import { AdaptacaoProfissionalService } from './adaptacao-profissional.service';
import {
  AdaptacaoProfissionalDto,
  AdaptarReceitaDto,
  SugestoesAdaptacaoDto,
} from './dtos/adaptar-receita';

const idPipe = () =>
  new ParseUUIDPipe({
    version: '4',
    exceptionFactory: () => new BadRequestException('ID inválido'),
  });

@ApiTags('Receita')
@Controller('api/receita')
export class AdaptacaoController {
  constructor(
    private readonly adaptacaoPaciente: AdaptacaoPacienteService,
    private readonly adaptacaoProfissional: AdaptacaoProfissionalService,
  ) {}

  @ApiOperation({
    summary: 'Adapta a receita para uma restrição alimentar (IA)',
    description:
      'Troca ou remove os ingredientes que ferem a restrição. A receita adaptada nasce ' +
      'pendente de verificação por um profissional. Para quem tem a restrição como ' +
      'alergia ou grave, ela só fica disponível depois da verificação.',
  })
  @ApiCreatedResponse({ description: 'Adaptação criada ou reaproveitada.' })
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Post(':id/adaptar')
  async adaptar(
    @Param('id', idPipe()) id: string,
    @Body() dto: AdaptarReceitaDto,
    @Request() req: RequestAutenticado,
  ) {
    return this.adaptacaoPaciente.adaptar(id, dto.restricaoId, req.user);
  }

  @ApiOperation({
    summary:
      'Sugestões de adaptação da receita para um paciente (profissional)',
    description:
      'O que a receita fere para o paciente, opções de substituto por ingrediente ' +
      '(curadas e da IA) e a receita inteira adaptada pela IA, como prévia. Nada é gravado.',
  })
  @ApiCreatedResponse({
    description: 'Sugestões para o profissional escolher.',
  })
  @ApiBearerAuth()
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(TipoUsuario.profissional, TipoUsuario.admin)
  @Post(':id/sugestoes-adaptacao')
  async sugerir(
    @Param('id', idPipe()) id: string,
    @Body() dto: SugestoesAdaptacaoDto,
    @Request() req: RequestAutenticado,
  ) {
    return this.adaptacaoProfissional.sugerir(id, dto.pacienteId, req.user);
  }

  @ApiOperation({
    summary: 'Grava a adaptação escolhida pelo profissional para um paciente',
    description:
      'A lista final precisa ser segura para todas as restrições do paciente. A adaptação ' +
      'nasce verificada pelo profissional e só é visível para aquele paciente.',
  })
  @ApiCreatedResponse({ description: 'Adaptação gravada e verificada.' })
  @ApiBearerAuth()
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(TipoUsuario.profissional, TipoUsuario.admin)
  @Post(':id/adaptacao-profissional')
  async salvarDoProfissional(
    @Param('id', idPipe()) id: string,
    @Body() dto: AdaptacaoProfissionalDto,
    @Request() req: RequestAutenticado,
  ) {
    return this.adaptacaoProfissional.salvarDoProfissional(id, dto, req.user);
  }
}
