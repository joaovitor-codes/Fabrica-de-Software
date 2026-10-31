export interface DadosPreferencia {
  referencia: string;
  titulo: string;
  valor: number;
  taxaPlataforma: number;
  expiraEm: Date;
}

export type StatusPagamentoMercadoPago =
  'aprovado' | 'pendente' | 'recusado' | 'estornado';

export interface PagamentoMercadoPago {
  id: string;
  status: StatusPagamentoMercadoPago;
  valor: number;
  referencia: string;
  metodo: string;
  pagoEm: Date | null;
}
