import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import OpenAI from 'openai';
import { ConfigService } from '@nestjs/config';
import { RespostaSubstituto } from './dtos/ia';

@Injectable()
export class IaService {
  private readonly logger = new Logger(IaService.name);
  private readonly client: OpenAI;
  private readonly modelo = 'gpt-5.6-luna';

  constructor(private readonly ConfigService: ConfigService) {
    const apiKey = this.ConfigService.get<string>('OPENAI_API_KEY');
    if (!apiKey) {
      throw new Error(
        'OPENAI_API_KEY não configurada. Defina no .env (ver .env.example).',
      );
    }
    this.client = new OpenAI({ apiKey });
  }

  private async perguntarJson<T = Record<string, unknown>>(
    prompt: string,
  ): Promise<T> {
    let conteudo: string | null | undefined;
    try {
      const resposta = await this.client.chat.completions.create({
        model: this.modelo,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
      });
      conteudo = resposta.choices[0]?.message?.content;
    } catch (erro) {
      this.logger.error(`Erro na chamada ao GPT-5.6 Luna: ${erro}`);
      throw new InternalServerErrorException(
        'Falha ao consultar o provedor de IA',
      );
    }
    if (!conteudo) {
      throw new InternalServerErrorException(
        'Resposta vazia do provedor de IA',
      );
    }
    try {
      return JSON.parse(conteudo) as T;
    } catch {
      this.logger.error(`Resposta do Luna não é JSON válido: ${conteudo}`);
      throw new InternalServerErrorException(
        'Resposta do provedor de IA em formato inesperado',
      );
    }
  }

  async encontrarSubstituto(nomeIngrediente: string, restricao: string) {
    const prompt = `Ingrediente a substituir: "${nomeIngrediente}"
        Motivo da restrição: ${restricao}

        Sugira 3 opções de substituto com A MESMA FUNÇÃO CULINÁRIA do ingrediente
        original, seguras para esse motivo, encontráveis no Brasil. Não repita o
        ingrediente original.

        Para cada opção, inclua também uma ESTIMATIVA aproximada dos valores
        nutricionais por 100g (calorias em kcal, proteína, carboidrato, gordura,
        fibra em gramas, sódio em mg). Deixe claro que são estimativas, não dados
        verificados.

        Responda APENAS um JSON, sem texto adicional:
        {"opcoes": [{
            "nome": "...",
            "justificativa": "até 15 palavras",
            "caloriasKcal": "...",
            "proteinasG": "...",
            "carboidratosG": "...",
            "gordurasG": "...",
            "fibrasG": "...",
            "sodioMg": "..."
        }]}`;

    const resposta = await this.perguntarJson<RespostaSubstituto>(prompt);
    const opcoes = resposta.opcoes ?? [];

    return opcoes.map((o) => ({ ...o, nutrientesVerificados: false }));
  }

  /**
   * Aponta ingredientes citados no modo de preparo que não estão na lista da
   * receita. Devolve o JSON cru: quem chama valida com
   * `interpretarIngredientesNaoListados`. Só vão textos da receita.
   */
  async ingredientesNaoListados(
    modoPreparo: string,
    ingredientes: string[],
  ): Promise<unknown> {
    const prompt = `Você confere receitas de uma plataforma de nutrição no Brasil.

        Ingredientes listados na receita:
        ${ingredientes.map((nome) => `- ${nome}`).join('\n        ')}

        Modo de preparo (entre as linhas ---):
        ---
        ${modoPreparo}
        ---

        Liste os alimentos que o modo de preparo manda usar e que NÃO estão
        na lista acima (ex: "finalize com queijo ralado" sem queijo na lista).
        Considere equivalentes como presentes (ex: "ovos" e "Ovo, de galinha").
        Ignore água e utensílios. Sal, temperos, óleos e coberturas contam.
        Escreva cada alimento como aparece no modo de preparo.

        Responda APENAS um JSON, sem texto adicional:
        {"faltando": ["..."]}`;

    return this.perguntarJson(prompt);
  }

  /**
   * Classifica um lote de ingredientes quanto às restrições informadas, para
   * a curadoria (scripts/curadoria-alergenos.ts). Devolve o JSON cru: quem
   * chama valida com `interpretarClassificacaoIa`. Só vão nomes de
   * ingrediente e de restrição, nenhum dado de paciente.
   */
  async classificarRestricoes(
    ingredientes: string[],
    restricoes: { nome: string; criterio: string }[],
  ): Promise<unknown> {
    const prompt = `Você classifica ingredientes de uma plataforma de nutrição no Brasil
        quanto a restrições alimentares. Um erro que deixe passar um alérgeno
        é grave; na dúvida, marque como incerto.

        Restrições (use exatamente estes nomes):
        ${restricoes.map((r) => `- ${r.nome}: ${r.criterio}`).join('\n        ')}

        Ingredientes (nomes da Tabela TACO ou cadastrados por usuários):
        ${ingredientes.map((nome, i) => `${i}. ${nome}`).join('\n        ')}

        Para cada ingrediente, diga quais restrições ele fere, considerando a
        composição típica do alimento no Brasil (ex: pão francês leva trigo,
        maionese leva ovo, "leite de coco" não é leite animal). Se depende da
        receita ou da marca e pode conter, coloque em "incertos".

        Responda APENAS um JSON, sem texto adicional, com todos os ingredientes,
        inclusive os que não ferem nenhuma restrição (listas vazias):
        {"itens": [{"i": 0, "contem": ["..."], "incertos": ["..."]}]}`;

    return this.perguntarJson(prompt);
  }
}
