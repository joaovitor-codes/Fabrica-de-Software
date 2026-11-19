-- Revisão do conteúdo da receita: sobe a cada edição ou mídia nova. A
-- curadoria avalia informando a revisão que viu, e a avaliação de um
-- conteúdo que mudou depois é recusada.
ALTER TABLE "receitas" ADD COLUMN "revisao" INTEGER NOT NULL DEFAULT 1;
