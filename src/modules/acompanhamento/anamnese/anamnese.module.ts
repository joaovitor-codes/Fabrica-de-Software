import { Module } from '@nestjs/common';
import { AnamneseService } from './anamnese.service';
import { AnamneseController } from './anamnese.controller';
import { AnamneseAcessoService } from './anamnese-acesso.service';
import { AnamnesePerguntaService } from './anamnese-pergunta.service';
import { AnamneseOpcaoService } from './anamnese-opcao.service';
import { AnamneseRespostaService } from './anamnese-resposta.service';

@Module({
  providers: [
    AnamneseAcessoService,
    AnamnesePerguntaService,
    AnamneseOpcaoService,
    AnamneseRespostaService,
    AnamneseService,
  ],
  controllers: [AnamneseController]
})
export class AnamneseModule {}
