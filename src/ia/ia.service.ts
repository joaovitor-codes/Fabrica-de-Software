import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { ConfigService } from '@nestjs/config';
import { RespostaSubstituto, SugestaoSubstituto } from './dtos/ia';

@Injectable()
export class IaService {
    private readonly logger = new Logger(IaService.name);
    private readonly client: OpenAI;
    private readonly modelo = 'gpt-5.6-luna';

    constructor(private readonly ConfigService: ConfigService){
        const apiKey = this.ConfigService.get<string>('OPENAI_API_KEY');
        if(!apiKey){
            throw new Error (
                'OPENAI_API_KEY não configurada. Defina no .env (ver .env.example).',
            );
        }
        this.client = new OpenAI({ apiKey })
    }

    private async perguntarJson<T = Record<string, unknown>>(prompt: string): Promise<T> {
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
            throw new InternalServerErrorException('Falha ao consultar o provedor de IA');
        }
        if (!conteudo) {
            throw new InternalServerErrorException('Resposta vazia do provedor de IA');
        }
        try {
            return JSON.parse(conteudo) as T;
        } catch {
            this.logger.error(`Resposta do Luna não é JSON válido: ${conteudo}`);
            throw new InternalServerErrorException('Resposta do provedor de IA em formato inesperado');
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
}
