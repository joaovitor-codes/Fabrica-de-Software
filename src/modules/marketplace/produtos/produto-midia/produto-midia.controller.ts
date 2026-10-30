import {
  BadRequestException,
  Controller,
  Delete,
  Param,
  ParseUUIDPipe,
  Post,
  Request,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AuthGuard } from '../../../../auth/auth.guard';
import type { RequestAutenticado } from '../../../../auth/auth.types';
import { ProdutoMidiaService } from './produto-midia.service';

@ApiTags('Marketplace - Produtos')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('api/produto')
export class ProdutoMidiaController {
  constructor(private readonly produtoMidiaService: ProdutoMidiaService) {}

  @ApiOperation({ summary: 'Envia uma foto para um produto do vendedor' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        produto: {
          type: 'string',
          format: 'binary',
          description: 'Imagem JPEG, PNG ou WebP de até 5 MB',
        },
      },
      required: ['produto'],
    },
  })
  @ApiCreatedResponse({ description: 'Mídia enviada com sucesso.' })
  @ApiBadRequestResponse({
    description: 'Arquivo ausente, não é imagem ou é grande demais.',
  })
  @ApiForbiddenResponse({
    description: 'Produto não pertence ao usuário ou foi removido.',
  })
  @ApiNotFoundResponse({ description: 'Produto não encontrado.' })
  @Post(':id/midias')
  @UseInterceptors(FileInterceptor('produto'))
  async upload(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @UploadedFile() file: Express.Multer.File,
    @Request() request: RequestAutenticado,
  ) {
    if (!file) {
      throw new BadRequestException('file is required');
    }

    return this.produtoMidiaService.uploadMidia(id, request.user.sub, file);
  }

  @ApiOperation({ summary: 'Remove uma foto de um produto do vendedor' })
  @ApiOkResponse({ description: 'Mídia removida com sucesso.' })
  @ApiForbiddenResponse({
    description: 'Produto não pertence ao usuário ou foi removido.',
  })
  @ApiNotFoundResponse({ description: 'Produto ou mídia não encontrados.' })
  @Delete(':id/midias/:midiaId')
  async remove(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('midiaId', new ParseUUIDPipe({ version: '4' })) midiaId: string,
    @Request() request: RequestAutenticado,
  ) {
    return this.produtoMidiaService.removerMidia(id, midiaId, request.user.sub);
  }
}
