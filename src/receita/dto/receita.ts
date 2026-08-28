import { IsNotEmpty } from 'class-validator';
import { NivelDificuldade, StatusAprovacao, Usuario, Profissional, ReceitaVersao, ReceitaMidia, PontosTransacao, Favorito, PlanoAlimentarItem, Notificacao } from '@prisma/client';
import { ReceitaIngredienteDTO } from './receita-ingrediente';

export class ReceitaDto {
  @IsNotEmpty()
  nome!: string;
  descricao!: string;
  modoPreparo!: string;
  tempoPreparoMin!: number;
  porcoes!: number;
  @IsNotEmpty()
  nivelDificuldade!: NivelDificuldade;
  @IsNotEmpty()
  avisoContaminacaoCruzada!: boolean;
  criadoPor!: string;
  status!: StatusAprovacao;
  profissionalAprovadorId!: string;
  dataAprovacao!: Date;
  @IsNotEmpty()
  versaoAtual!: number;

  criador!: Usuario;
  profissionalAprovador!: Profissional;
  versoes!: ReceitaVersao;
  midias!: ReceitaMidia;
  @IsNotEmpty()
  ingredientes!: ReceitaIngredienteDTO[];
  pontosTransacoes!: PontosTransacao;
  favoritos!: Favorito;
  planoAlimentarItens!: PlanoAlimentarItem;
  notificacoes!: Notificacao;
}
