import { Module } from '@nestjs/common';
import { FavoritoController } from './favorito.controller';
import { FavoritoService } from './favorito.service';
import { VisibilidadeModule } from '../visibilidade/visibilidade.module';

@Module({
  imports: [VisibilidadeModule],
  controllers: [FavoritoController],
  providers: [FavoritoService],
})
export class FavoritoModule {}
