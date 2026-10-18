import { Module } from '@nestjs/common';
import { MulterConfigModule } from '../../../common/multer/multer.module';
import { ProdutoController } from './produto.controller';
import { ProdutoMidiaController } from './produto-midia.controller';
import { ProdutoPublicoController } from './produto-publico.controller';
import { ProdutoService } from './produto.service';

@Module({
  imports: [MulterConfigModule],
  controllers: [
    ProdutoController,
    ProdutoMidiaController,
    ProdutoPublicoController,
  ],
  providers: [ProdutoService],
  exports: [ProdutoService],
})
export class ProdutoModule {}
