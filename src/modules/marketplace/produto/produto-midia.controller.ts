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
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AuthGuard } from '../../../auth/auth.guard';
import type { RequestAutenticado } from '../../../auth/auth.types';
import { ProdutoService } from './produto.service';

@ApiTags('Marketplace - Produtos')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('api/produto')
export class ProdutoMidiaController {
  constructor(private readonly produtoService: ProdutoService) {}

  @ApiOperation({ summary: 'Envia uma foto para um produto do vendedor' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        produto: { type: 'string', format: 'binary' },
      },
      required: ['produto'],
    },
  })
  @ApiCreatedResponse({ description: 'Mídia enviada com sucesso.' })
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

    return this.produtoService.uploadMidia(id, request.user.sub, file);
  }

  @ApiOperation({ summary: 'Remove uma foto de um produto do vendedor' })
  @ApiOkResponse({ description: 'Mídia removida com sucesso.' })
  @Delete(':id/midias/:midiaId')
  async remove(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('midiaId', new ParseUUIDPipe({ version: '4' })) midiaId: string,
    @Request() request: RequestAutenticado,
  ) {
    return this.produtoService.removerMidia(id, midiaId, request.user.sub);
  }
}
