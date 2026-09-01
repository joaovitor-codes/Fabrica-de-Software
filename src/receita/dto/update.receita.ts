import { NivelDificuldade, StatusAprovacao, Usuario, Profissional, ReceitaVersao, ReceitaMidia, ReceitaIngrediente, PontosTransacao, Favorito, PlanoAlimentarItem, Notificacao } from '@prisma/client';

export class UpdateReceitaDto {
  nome!: string;
  descricao!: string;
  modoPreparo!: string;
  tempoPreparoMin!: number;
  porcoes!: number;
  nivelDificuldade!: NivelDificuldade;
  avisoContaminacaoCruzada!: boolean;
  criadoPor!: string;
  status!: StatusAprovacao;
  profissionalAprovadorId!: string;
  dataAprovacao!: Date;
  versaoAtual!: number;

  criador!: Usuario;
  profissionalAprovador!: Profissional;
  versoes!: ReceitaVersao;
  midias!: ReceitaMidia;
  ingredientes!: ReceitaIngrediente;
  pontosTransacoes!: PontosTransacao;
  favoritos!: Favorito;
  planoAlimentarItens!: PlanoAlimentarItem;
  notificacoes!: Notificacao;
}
