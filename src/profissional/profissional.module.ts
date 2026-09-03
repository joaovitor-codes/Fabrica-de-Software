import { Module } from '@nestjs/common';
import { ProfissionalService } from './profissional.service';
import { ProfissionalController } from './profissional.controller';
import { UsuarioService } from '../usuario/usuario.service';
import { PacientesService } from '../pacientes/pacientes.service';
import { ClinicasModule } from '../clinicas/clinicas.module';

@Module({
  imports: [ClinicasModule],
  providers: [ProfissionalService, PacientesService, UsuarioService],
  controllers: [ProfissionalController]
})
export class ProfissionalModule {}
