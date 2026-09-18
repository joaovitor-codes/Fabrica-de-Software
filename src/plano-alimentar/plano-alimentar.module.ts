import { Module } from '@nestjs/common';
import { ProfissionalService } from '../profissional/profissional.service';
import { ClinicasService } from '../clinicas/clinicas.service';
import { PacientesService } from '../pacientes/pacientes.service';
import { PlanoAlimentarController } from './plano-alimentar.controller';
import { PlanoAlimentarService } from './plano-alimentar.service';
import { ChecklistRefeicaoService } from './checklist-refeicao.service';
import { ComentarioRefeicaoService } from './comentario-refeicao.service';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';

@Module({
  imports: [],
  providers: [
    PlanoAlimentarService,
    ProfissionalService,
    ClinicasService,
    PacientesService,
    ChecklistRefeicaoService,
    ComentarioRefeicaoService,
    AuthGuard,
    RolesGuard,
  ],
  controllers: [PlanoAlimentarController],
})
export class PlanoAlimentarModule {}