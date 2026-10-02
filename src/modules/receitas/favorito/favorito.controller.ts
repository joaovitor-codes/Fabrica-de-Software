import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
} from '@nestjs/swagger';
import { AuthGuard } from '../../../auth/auth.guard';
import type { RequestAutenticado } from '../../../auth/auth.types';
import { FavoritoService } from './favorito.service';

const uuidPipe = (mensagem: string) =>
  new ParseUUIDPipe({
    version: '4',
    errorHttpStatusCode: 400,
    exceptionFactory: () => new BadRequestException(mensagem),
  });

@Controller('api/receita')
export class FavoritoController {
  constructor(private readonly favoritoService: FavoritoService) {}

  @ApiOperation({
    summary: 'Retorna as receitas favoritas do usuário autenticado',
  })
  @ApiOkResponse({ description: 'Lista de receitas favoritas.' })
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Get('favoritos')
  async findFavorites(@Request() request: RequestAutenticado) {
    return await this.favoritoService.findFavorites(request.user.sub);
  }

  @ApiOperation({ summary: 'Adiciona uma receita aos favoritos' })
  @ApiCreatedResponse({ description: 'Receita favoritada com sucesso.' })
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Post(':id/favorito')
  async addFavorite(
    @Param('id', uuidPipe('ID inválido')) id: string,
    @Request() request: RequestAutenticado,
  ) {
    return await this.favoritoService.addFavorite(id, request.user.sub);
  }

  @ApiOperation({ summary: 'Remove uma receita dos favoritos' })
  @ApiOkResponse({ description: 'Receita removida dos favoritos com sucesso.' })
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Delete(':id/favorito')
  async removeFavorite(
    @Param('id', uuidPipe('ID inválido')) id: string,
    @Request() request: RequestAutenticado,
  ) {
    return await this.favoritoService.removeFavorite(id, request.user.sub);
  }
}
