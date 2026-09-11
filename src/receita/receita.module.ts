import { Module } from '@nestjs/common';
import { ReceitaService } from './receita.service';
import { ReceitaController } from './receita.controller';
import { AuthGuard } from '../auth/auth.guard';
import { UsuarioService } from '../usuario/usuario.service';

@Module({
  controllers: [ReceitaController],
  providers: [ReceitaService, AuthGuard, UsuarioService],
})
export class ReceitaModule {}
