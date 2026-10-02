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
import type { RequestAutenticado } from '../../../auth/auth.types';
import { AdaptacaoReceitaService } from './adaptacao-receita.service';
import { AdaptarReceitaDto } from './dtos/adaptar-receita';

@ApiTags('Receita')
@Controller('api/receita')
export class AdaptacaoReceitaController {
  constructor(private readonly adaptacaoService: AdaptacaoReceitaService) {}

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
    @Param(
      'id',
      new ParseUUIDPipe({
        version: '4',
        exceptionFactory: () => new BadRequestException('ID inválido'),
      }),
    )
    id: string,
    @Body() dto: AdaptarReceitaDto,
    @Request() req: RequestAutenticado,
  ) {
    return this.adaptacaoService.adaptar(id, dto.restricaoId, req.user);
  }
}
