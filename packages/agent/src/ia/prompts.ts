import type { ContextoDaLicao, MensagemChat, Momento } from './tipos.ts'

/**
 * Regras de cada momento de uso.
 *
 * `permiteComando` é o que separa ajudar de resolver. Só depois que o aluno
 * já passou é que a IA pode mostrar comando — aí ela está revisando trabalho
 * pronto, que é o uso de maior valor (feedback de prática deliberada).
 */
export const REGRAS: Record<Momento, { permiteComando: boolean; rotulo: string }> = {
  explicar_erro: { permiteComando: false, rotulo: 'Explicação do erro' },
  revisar_solucao: { permiteComando: true, rotulo: 'Revisão da sua solução' },
  dica_socratica: { permiteComando: false, rotulo: 'Pergunta guia' },
}

const BASE = `Você é tutor de infraestrutura Linux e telefonia IP dentro do DevLab,
uma oficina prática onde o aluno trabalha num container real e descartável.

Regras invioláveis:
- Responda em português do Brasil, no máximo 6 frases curtas.
- Comandos, flags, nomes de arquivo e mensagens de erro ficam em inglês.
- Você NÃO tem acesso à solução do exercício e não deve tentar adivinhá-la para
  o aluno. Seu papel é destravar o raciocínio, nunca entregar o resultado.
- Fale sobre a evidência que está na tela: a mensagem de erro real, a saída do
  comando, o estado do sistema. Nada de conselho genérico.
- Se a informação disponível não bastar, diga qual comando de INSPEÇÃO daria a
  resposta (ls, cat, man, --help, find, stat) — inspecionar não é resolver.`

const SEM_COMANDO = `
- É PROIBIDO escrever o comando que cumpre a tarefa, inteiro ou parcial, em
  qualquer formato — inclusive em bloco de código, com lacunas ou "como
  exemplo". Se sentir vontade de escrever o comando, escreva no lugar a
  pergunta que levaria o aluno até ele.`

const POR_MOMENTO: Record<Momento, string> = {
  explicar_erro: `
Tarefa: traduzir a mensagem de erro real em causa provável e próximo passo de
investigação. Estrutura: (1) o que a mensagem está dizendo, literalmente;
(2) a causa mais provável neste contexto; (3) o que inspecionar em seguida.${SEM_COMANDO}`,

  revisar_solucao: `
Tarefa: o aluno JÁ resolveu e passou na verificação. Revise como um colega
experiente: aponte uma abordagem mais limpa, um risco que ele não viu e uma
boa prática do dia a dia de produção. Aqui você PODE mostrar comandos, porque
o exercício já foi vencido. Seja específico e elogie o que ficou bom.`,

  dica_socratica: `
Tarefa: fazer UMA pergunta que leve o aluno ao próximo passo sozinho. Comece
pela pergunta. Depois dela, no máximo duas frases situando por que ela importa.${SEM_COMANDO}`,
}

export function montarMensagens(momento: Momento, ctx: ContextoDaLicao): MensagemChat[] {
  return [
    { papel: 'sistema', texto: BASE + POR_MOMENTO[momento] },
    { papel: 'usuario', texto: montarContexto(momento, ctx) },
  ]
}

function montarContexto(momento: Momento, ctx: ContextoDaLicao): string {
  const partes: string[] = [
    `Trilha: ${ctx.trilha} · nível ${ctx.nivel}`,
    `Lição: ${ctx.titulo}`,
    `Capacidade em treino: ${ctx.capacidade}`,
    '',
    'Enunciado da tarefa:',
    ctx.objetivo.trim(),
  ]

  if (ctx.criterios.length > 0) {
    partes.push('', 'Critérios de aprovação (só as descrições; os scripts não são visíveis a você):')
    for (const c of ctx.criterios) partes.push(`- ${c}`)
  }

  if (ctx.checksReprovados.length > 0) {
    partes.push('', 'O que reprovou na última verificação:')
    for (const c of ctx.checksReprovados) {
      partes.push(`- ${c.descricao}${c.mensagem !== undefined ? ` — ${c.mensagem}` : ''}`)
    }
  }

  if (ctx.errosReconhecidos.length > 0) {
    partes.push(
      '',
      'O DevLab já mostrou ao aluno estas explicações de erro (não repita, avance):',
    )
    for (const e of ctx.errosReconhecidos) partes.push(`- ${e}`)
  }

  if (ctx.terminal.trim() !== '') {
    partes.push('', 'Últimas linhas do terminal do aluno:', '```', ctx.terminal.trim(), '```')
  }

  partes.push(
    '',
    momento === 'revisar_solucao'
      ? 'O aluno passou na verificação. Revise a solução dele.'
      : momento === 'dica_socratica'
        ? 'Faça a pergunta que destrava o próximo passo.'
        : 'Explique o erro que está na tela.',
  )

  return partes.join('\n')
}

/**
 * Rede de segurança para quando o modelo ignora a instrução.
 *
 * Prompt é pedido, não garantia — e um modelo local pequeno desobedece com
 * alguma frequência. Nos momentos em que comando é proibido, blocos de código
 * são removidos da resposta antes de ela chegar ao aluno.
 */
export function sanitizar(momento: Momento, texto: string): { texto: string; podado: boolean } {
  if (REGRAS[momento].permiteComando) return { texto, podado: false }

  let podado = false
  const semBlocos = texto.replace(/```[\s\S]*?(?:```|$)/g, () => {
    podado = true
    return '[trecho de comando removido — nesta modalidade a IA não entrega a solução]'
  })

  return { texto: semBlocos.trim(), podado }
}

/** Corta o terminal pelo fim: o que interessa é o que acabou de acontecer. */
export function recortarTerminal(saida: string, maxChars: number): string {
  if (saida.length <= maxChars) return saida
  const cortado = saida.slice(-maxChars)
  const quebra = cortado.indexOf('\n')
  return quebra === -1 ? cortado : cortado.slice(quebra + 1)
}
