import { Module } from '@nestjs/common';
import { DiarioDeSintomasService } from './diario-de-sintomas.service';
import { DiarioDeSintomasController } from './diario-de-sintomas.controller';

@Module({
  providers: [DiarioDeSintomasService],
  controllers: [DiarioDeSintomasController]
})
export class DiarioDeSintomasModule {}
