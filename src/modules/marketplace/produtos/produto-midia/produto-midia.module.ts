import { Module } from '@nestjs/common';
import { MulterConfigModule } from '../../../../common/multer/multer.module';
import { ProdutoModule } from '../produto/produto.module';
import { ProdutoMidiaController } from './produto-midia.controller';
import { ProdutoMidiaService } from './produto-midia.service';

@Module({
  imports: [MulterConfigModule, ProdutoModule],
  controllers: [ProdutoMidiaController],
  providers: [ProdutoMidiaService],
})
export class ProdutoMidiaModule {}
