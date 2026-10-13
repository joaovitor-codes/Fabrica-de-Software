export const CODIGOS_NOTIFICACAO = [
  'receita_vendida',
  'compra_liberada',
  'reembolso_resolvido',
  'produto_removido',
] as const;

export type CodigoNotificacao = (typeof CODIGOS_NOTIFICACAO)[number];

export interface ReferenciaNotificacao {
  receitaId?: string;
  assinaturaId?: string;
  planoAlimentarItemId?: string;
  indicacaoId?: string;
  anamneseId?: string;
  produtoId?: string;
}

export interface CriarNotificacaoInput {
  usuarioId: string;
  codigo: CodigoNotificacao;
  titulo: string;
  mensagem?: string;
  referencia: ReferenciaNotificacao;
}
