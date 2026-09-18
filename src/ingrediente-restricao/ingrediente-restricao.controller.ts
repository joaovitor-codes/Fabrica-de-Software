import { BadRequestException, Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IngredienteRestricaoService } from './ingrediente-restricao.service';
import { VincularIngredienteRestricaoDto } from './dtos/ingrediente-restricao';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { TipoUsuario } from '@prisma/client';
import { IngredienteSubstitutoService } from './ingrediente-substituto.service';

const uuidPipe = (mensagem: string) => new ParseUUIDPipe({
    version: '4',
    errorHttpStatusCode: 400,
    exceptionFactory: () => new BadRequestException(mensagem),
});


@ApiTags('Restrição do Ingrediente')
@Controller('api/ingrediente')
export class IngredienteRestricaoController {
  constructor(
    private readonly ingredienteRestricaoService: IngredienteRestricaoService,
    private readonly ingredienteSubstitutoService: IngredienteSubstitutoService,
  ) {}

  @ApiOperation({ summary: 'Vincula uma restrição alimentar a um ingrediente' })
  @ApiCreatedResponse({ description: 'Restrição vinculada ao ingrediente com sucesso.' })
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(TipoUsuario.admin, TipoUsuario.profissional)
  @Post(':ingredienteId/restricoes')
  async vincular(
    @Param('ingredienteId', uuidPipe('ID Ingrediente inválido')) ingredienteId: string,
    @Body() dto: VincularIngredienteRestricaoDto,
  ) {
    return this.ingredienteRestricaoService.vincular(ingredienteId, dto);
  }

  @ApiOperation({ summary: 'Lista as restrições alimentares vinculadas a um ingrediente' })
  @ApiOkResponse({ description: 'Lista de restrições do ingrediente.' })
  @Get(':ingredienteId/restricoes')
  async findAll(@Param('ingredienteId', uuidPipe('ID Ingrediente inválido')) ingredienteId: string) {
    return this.ingredienteRestricaoService.findAllByIngrediente(ingredienteId);
  }

  @ApiOperation({ summary: 'Remove o vínculo de uma restrição alimentar com o ingrediente' })
  @ApiOkResponse({ description: 'Vínculo removido com sucesso.' })
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(TipoUsuario.admin, TipoUsuario.profissional)
  @Delete(':ingredienteId/restricoes/:restricaoId')
  async remove(
    @Param('ingredienteId', uuidPipe('ID Ingrediente inválido')) ingredienteId: string,
    @Param('restricaoId', uuidPipe('ID Restrição inválido')) restricaoId: string,
  ) {
    return this.ingredienteRestricaoService.remove(ingredienteId, restricaoId);
  }

  @ApiOperation({ summary: 'Lista os substitutos já cadastrados para um ingrediente e restrição' })
  @ApiOkResponse({ description: 'Lista de substitutos.' })
  @Get(':ingredienteId/restricoes/:restricaoId/substitutos')
  async findSubstitutos(
    @Param('ingredienteId', uuidPipe('ID Ingrediente inválido')) ingredienteId: string,
    @Param('restricaoId', uuidPipe('ID Restrição inválido')) restricaoId: string,
  ) {
    return this.ingredienteSubstitutoService.findAll(ingredienteId, restricaoId);
  }

  @ApiOperation({ summary: 'Gera (via IA) e cadastra substitutos para um ingrediente e restrição' })
  @ApiCreatedResponse({ description: 'Substitutos gerados e cadastrados com sucesso.' })
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(TipoUsuario.admin, TipoUsuario.profissional)
  @Post(':ingredienteId/restricoes/:restricaoId/substitutos')
  async gerarSubstitutos(
    @Param('ingredienteId', uuidPipe('ID Ingrediente inválido')) ingredienteId: string,
    @Param('restricaoId', uuidPipe('ID Restrição inválido')) restricaoId: string,
  ) {
    return this.ingredienteSubstitutoService.gerarSubstituto(ingredienteId, restricaoId);
  }
}
