import { PartialType } from '@nestjs/swagger';
import { ReceitaDto } from './receita';

/**
 * Tudo opcional. `ingredientes`, quando vem, substitui a lista inteira e
 * não pode ser vazia.
 */
export class UpdateReceitaDto extends PartialType(ReceitaDto) {}
