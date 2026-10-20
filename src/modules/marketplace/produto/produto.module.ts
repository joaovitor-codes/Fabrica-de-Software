import { Module } from '@nestjs/common';
import { MulterConfigModule } from '../../../common/multer/multer.module';
import { NotificacaoModule } from '../../notificacao/notificacao.module';
import { ProdutoController } from './produto.controller';
import { ProdutoDenunciaController } from './produto-denuncia.controller';
import { ProdutoDenunciaService } from './produto-denuncia.service';
import { ProdutoMidiaController } from './produto-midia.controller';
import { ProdutoPublicoController } from './produto-publico.controller';
import { ProdutoService } from './produto.service';

@Module({
  imports: [MulterConfigModule, NotificacaoModule],
  controllers: [
    ProdutoController,
    ProdutoMidiaController,
    // Antes do público: GET denuncias precisa vir antes de GET :id.
    ProdutoDenunciaController,
    ProdutoPublicoController,
  ],
  providers: [ProdutoService, ProdutoDenunciaService],
  exports: [ProdutoService],
})
export class ProdutoModule {}
