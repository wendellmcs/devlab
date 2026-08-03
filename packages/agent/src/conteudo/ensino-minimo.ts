/**
 * Bloco `ensino` mínimo que satisfaz o schema — para uso em TESTE.
 *
 * `ensino` é obrigatório de propósito: uma lição sem ele pede a tarefa sem
 * nunca ter ensinado, que é exatamente a dívida que o modelo E-G-P veio pagar.
 * Mas isso obriga todo teste a carregar um bloco de ensino, inclusive os que
 * só querem saber se `montarHostConfig` derruba as capacidades certas.
 *
 * Este objeto existe para esses testes: é o menor `ensino` válido, e nada
 * mais. Conteúdo de verdade não deve se parecer com ele — o validador
 * (`scripts/valida-conteudo.py`) cobra substância que este mínimo não tem.
 */
export const ENSINO_MINIMO = {
  gancho: 'Cenário de teste.',
  objetivos: [
    { verbo: 'identificar', texto: 'reconhecer o caso de teste' },
    { verbo: 'executar', texto: 'rodar o comando do teste' },
  ],
  modelo_mental: 'Modelo mental de teste.',
  demonstracao: [{ comando: 'true', saida: '', nota: 'não faz nada, com sucesso' }],
  pratica_guiada: [{ instrucao: 'rode o comando', modelo: '____', resposta: 'true' }],
} as const

/** O mesmo em YAML, para os testes que escrevem arquivo em disco. */
export const ENSINO_MINIMO_YAML = `ensino:
  gancho: Cenário de teste.
  objetivos:
    - verbo: identificar
      texto: reconhecer o caso de teste
    - verbo: executar
      texto: rodar o comando do teste
  modelo_mental: Modelo mental de teste.
  demonstracao:
    - comando: "true"
      saida: ""
      nota: não faz nada, com sucesso
  pratica_guiada:
    - instrucao: rode o comando
      modelo: "____"
      resposta: "true"
`
