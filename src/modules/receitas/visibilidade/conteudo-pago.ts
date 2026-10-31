import { Prisma, StatusReceita, TipoMidia, TipoUsuario } from '@prisma/client';
import { UsuarioAutenticado } from '../../../auth/auth.types';
import { RestricaoViolada } from './restricoes-receita';

/**
 * Receita paga (com oferta) só entrega o conteúdo a quem tem acesso a ele.
 * Os demais recebem a prévia (D13, seção 4.4 das decisões do marketplace).
 */

/** A oferta como aparece na prévia: preço e público-alvo, nada interno. */
export const OFERTA_NA_PREVIA = {
  select: {
    preco: true,
    publicoAlvo: {
      select: { restricao: { select: { id: true, nome: true } } },
    },
  },
} satisfies Prisma.Receita$ofertaArgs;

type ReceitaParaAcesso = { criadoPor: string; status: StatusReceita };

/**
 * Quem vê o conteúdo inteiro de uma receita paga: o autor, o admin e o
 * profissional enquanto ela está na curadoria.
 */
export function veConteudoPago(
  receita: ReceitaParaAcesso,
  usuario?: Pick<UsuarioAutenticado, 'id' | 'tipoUsuario'>,
): boolean {
  if (!usuario) return false;
  if (usuario.id === receita.criadoPor) return true;
  if (usuario.tipoUsuario === TipoUsuario.admin) return true;
  return (
    usuario.tipoUsuario === TipoUsuario.profissional &&
    receita.status === StatusReceita.pendente
  );
}

/**
 * Quem pode adaptar uma receita paga: só o autor e o admin. O curador vê o
 * conteúdo para revisar, mas uma adaptação feita por ele para um paciente
 * entregaria o conteúdo pago de graça (P6).
 */
export function podeAdaptarPaga(
  receita: ReceitaParaAcesso,
  usuario: Pick<UsuarioAutenticado, 'id' | 'tipoUsuario'>,
): boolean {
  return (
    usuario.id === receita.criadoPor ||
    usuario.tipoUsuario === TipoUsuario.admin
  );
}

type ReceitaComOferta = {
  id: string;
  nome: string;
  descricao: string | null;
  tempoPreparoMin: number | null;
  porcoes: number | null;
  nivelDificuldade: string | null;
  avisoContaminacaoCruzada: boolean;
  status: StatusReceita;
  midias: { tipo: TipoMidia }[];
  oferta: Prisma.ReceitaOfertaGetPayload<typeof OFERTA_NA_PREVIA> | null;
  restricoesVioladas?: RestricaoViolada[];
};

/**
 * Prévia de uma receita paga: o que ajuda a decidir a compra. Ficam de fora
 * o modo de preparo, os ingredientes com quantidades e as mídias de passo a
 * passo e vídeo; só a capa vai junto.
 */
export function previaDaReceita(receita: ReceitaComOferta) {
  return {
    id: receita.id,
    nome: receita.nome,
    descricao: receita.descricao,
    tempoPreparoMin: receita.tempoPreparoMin,
    porcoes: receita.porcoes,
    nivelDificuldade: receita.nivelDificuldade,
    avisoContaminacaoCruzada: receita.avisoContaminacaoCruzada,
    status: receita.status,
    midias: receita.midias.filter((m) => m.tipo === TipoMidia.capa),
    oferta: {
      // Decimal do Prisma sairia como texto no JSON.
      preco: Number(receita.oferta!.preco),
      publicoAlvo: receita.oferta!.publicoAlvo.map((p) => p.restricao),
      // Até a compra existir (M4), ninguém comprou.
      comprada: false,
    },
    ...(receita.restricoesVioladas
      ? { restricoesVioladas: receita.restricoesVioladas }
      : {}),
  };
}
