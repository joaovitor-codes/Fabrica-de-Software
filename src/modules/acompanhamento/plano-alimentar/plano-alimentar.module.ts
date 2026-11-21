import { Module } from '@nestjs/common';
import { ProfissionalService } from '../../identidade/profissional/profissional.service';
import { NotificacaoModule } from '../../notificacao/notificacao.module';
import { ClinicasService } from '../../identidade/clinicas/clinicas.service';
import { PacientesService } from '../../identidade/pacientes/pacientes.service';
import { PlanoAlimentarController } from './plano-alimentar.controller';
import { PlanoAlimentarService } from './plano-alimentar.service';
import { ChecklistRefeicaoService } from './checklist-refeicao.service';
import { ComentarioRefeicaoService } from './comentario-refeicao.service';

@Module({
  // O ProfissionalService aprova cadastros e avisa o que saiu do ar.
  imports: [NotificacaoModule],
  providers: [
    PlanoAlimentarService,
    ProfissionalService,
    ClinicasService,
    PacientesService,
    ChecklistRefeicaoService,
    ComentarioRefeicaoService,
  ],
  controllers: [PlanoAlimentarController],
})
export class PlanoAlimentarModule {}
