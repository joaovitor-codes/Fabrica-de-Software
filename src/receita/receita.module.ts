import { Module } from '@nestjs/common';
import { ReceitaService } from './receita.service';
import { ReceitaController } from './receita.controller';
import { UsuarioService } from '../usuario/usuario.service';

@Module({
  controllers: [ReceitaController],
  providers: [ReceitaService, UsuarioService],
})
export class ReceitaModule {}
