import { Module } from '@nestjs/common';
import { TagSintomasService } from './tag-sintomas.service';
import { TagSintomasController } from './tag-sintomas.controller';

@Module({
  providers: [TagSintomasService],
  controllers: [TagSintomasController],
  exports: [TagSintomasService]
})
export class TagSintomasModule {}
